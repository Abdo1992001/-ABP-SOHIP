import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import {
  createPlatformProofHandlers,
  createPlatformWorkerDependencies,
  createPrismaClient,
  PlatformWorker,
  silentPlatformLogger,
} from "@abp/database";
import { AppModule } from "./app.module.js";

interface ProofResponse {
  data: {
    proofRunId: string;
    eventId: string;
    traceId: string;
    correlationId: string;
  };
}

async function runProof(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  process.env.ABP_PLATFORM_PROOF_ENABLED = "true";
  const application = await NestFactory.create(AppModule, {
    logger: ["error"],
  });
  const { configureHttpApplication } = await import("./configure-http-app.js");
  configureHttpApplication(application);
  const workerDatabase = createPrismaClient(connectionString);

  try {
    await application.listen(0, "127.0.0.1");
    const response = await fetch(
      `${await application.getUrl()}/api/v1/_platform/proof`,
      {
        method: "POST",
        headers: {
          "x-trace-id": "ws0-platform-proof-trace",
          "x-correlation-id": "ws0-platform-proof-correlation",
        },
      },
    );
    if (response.status !== 202) {
      throw new Error(
        `PLATFORM_PROOF_API_FAILED_${response.status.toString()}`,
      );
    }
    const started = readProofResponse(await response.json());
    const startedData = started.data;
    const dependencies = createPlatformWorkerDependencies(
      workerDatabase,
      silentPlatformLogger,
    );
    const worker = new PlatformWorker(
      dependencies,
      createPlatformProofHandlers(),
      {
        workerId: "ws0-platform-proof-worker",
        batchSize: 10,
        pollingDelayMs: 10,
        leaseSeconds: 30,
        baseRetryDelayMs: 0,
        maxRetryDelayMs: 0,
      },
      silentPlatformLogger,
    );
    await worker.pollOnce();

    const [proof, outbox, job, auditCount] = await Promise.all([
      workerDatabase.platformProofRun.findUniqueOrThrow({
        where: { id: startedData.proofRunId },
      }),
      workerDatabase.outboxMessage.findUniqueOrThrow({
        where: { id: startedData.eventId },
      }),
      workerDatabase.durableJob.findFirstOrThrow({
        where: { sourceType: "OutboxMessage", sourceId: startedData.eventId },
      }),
      workerDatabase.auditEvent.count({
        where: {
          resourceType: "PlatformProofRun",
          resourceId: startedData.proofRunId,
        },
      }),
    ]);
    if (
      proof.status !== "COMPLETED" ||
      outbox.status !== "SUCCEEDED" ||
      job.status !== "SUCCEEDED" ||
      auditCount !== 2
    ) {
      throw new Error("PLATFORM_PROOF_FINAL_STATE_INVALID");
    }

    console.info(
      JSON.stringify({
        verdict: "PASS",
        pipeline: [
          "API",
          "PostgreSQL transaction",
          "Audit",
          "Outbox",
          "Worker",
          "Durable Job",
          "Final state",
        ],
        proofRunId: startedData.proofRunId,
        eventId: startedData.eventId,
        jobId: job.id,
        finalState: proof.status,
        auditEvents: auditCount,
        traceId: startedData.traceId,
        correlationId: startedData.correlationId,
      }),
    );
  } finally {
    await application.close();
    await workerDatabase.$disconnect();
  }
}

function readProofResponse(value: unknown): ProofResponse {
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    typeof value.data === "object" &&
    value.data !== null &&
    "proofRunId" in value.data &&
    typeof value.data.proofRunId === "string" &&
    "eventId" in value.data &&
    typeof value.data.eventId === "string" &&
    "traceId" in value.data &&
    typeof value.data.traceId === "string" &&
    "correlationId" in value.data &&
    typeof value.data.correlationId === "string"
  ) {
    return {
      data: {
        proofRunId: value.data.proofRunId,
        eventId: value.data.eventId,
        traceId: value.data.traceId,
        correlationId: value.data.correlationId,
      },
    };
  }
  throw new Error("PLATFORM_PROOF_RESPONSE_INVALID");
}

void runProof().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "PLATFORM_PROOF_FAILED";
  console.error(JSON.stringify({ verdict: "FAIL", errorCode: message }));
  process.exitCode = 1;
});
