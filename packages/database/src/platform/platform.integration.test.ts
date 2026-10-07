import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { createPrismaClient, type DatabaseClient } from "../client.js";
import { AuditRepository } from "./audit-repository.js";
import { DurableJobRepository } from "./durable-job-repository.js";
import { OutboxRepository } from "./outbox-repository.js";
import {
  createPlatformProofHandlers,
  startPlatformProof,
} from "./platform-proof.js";
import {
  createPlatformWorkerDependencies,
  PlatformWorker,
} from "./platform-worker.js";
import { silentPlatformLogger } from "./structured-logger.js";
import { TransactionManager } from "./transaction-manager.js";

const connectionString = process.env.TEST_DATABASE_URL;
const describeDatabase =
  connectionString === undefined ? describe.skip : describe;

describeDatabase("PostgreSQL platform foundation", () => {
  let database: DatabaseClient;
  let transactions: TransactionManager;
  let audit: AuditRepository;
  let outbox: OutboxRepository;
  let jobs: DurableJobRepository;

  beforeAll(async () => {
    if (connectionString === undefined) {
      return;
    }
    database = createPrismaClient(connectionString);
    transactions = new TransactionManager(database, silentPlatformLogger);
    audit = new AuditRepository();
    outbox = new OutboxRepository(database, silentPlatformLogger);
    jobs = new DurableJobRepository(database, silentPlatformLogger);
    await database.$connect();
  });

  beforeEach(async () => {
    await database.$executeRawUnsafe(
      "TRUNCATE TABLE platform_proof_runs, durable_jobs, outbox_messages, audit_events CASCADE",
    );
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it("commits a business record, audit record, and outbox event atomically", async () => {
    await transactions.run(context(), async (transaction) => {
      const proof = await transaction.platformProofRun.create({
        data: { traceId: "trace-commit", correlationId: "correlation-commit" },
      });
      await audit.append(transaction, auditInput(proof.id, "trace-commit"));
      await outbox.enqueue(transaction, outboxInput(proof.id, "trace-commit"));
    });

    await expect(database.platformProofRun.count()).resolves.toBe(1);
    await expect(database.auditEvent.count()).resolves.toBe(1);
    await expect(database.outboxMessage.count()).resolves.toBe(1);
  });

  it("rolls back the business record, audit, and outbox together", async () => {
    await expect(
      transactions.run(context(), async (transaction) => {
        const proof = await transaction.platformProofRun.create({
          data: {
            traceId: "trace-rollback",
            correlationId: "correlation-rollback",
          },
        });
        await audit.append(transaction, auditInput(proof.id, "trace-rollback"));
        await outbox.enqueue(
          transaction,
          outboxInput(proof.id, "trace-rollback"),
        );
        throw new Error("SYNTHETIC_ROLLBACK");
      }),
    ).rejects.toThrow("SYNTHETIC_ROLLBACK");

    await expect(database.platformProofRun.count()).resolves.toBe(0);
    await expect(database.auditEvent.count()).resolves.toBe(0);
    await expect(database.outboxMessage.count()).resolves.toBe(0);
  });

  it("redacts sensitive audit values and rejects audit mutation", async () => {
    const created = await transactions.run(context(), async (transaction) =>
      audit.append(transaction, {
        ...auditInput("synthetic-audit", "trace-audit"),
        afterSnapshot: { password: "secret", nested: { accessToken: "token" } },
      }),
    );
    const record = await database.auditEvent.findUniqueOrThrow({
      where: { id: created.auditEventId },
    });
    expect(record.afterSnapshot).toEqual({
      password: "[REDACTED]",
      nested: { accessToken: "[REDACTED]" },
    });
    await expect(
      database.auditEvent.update({
        where: { id: created.auditEventId },
        data: { actionCode: "MUTATION_NOT_ALLOWED" },
      }),
    ).rejects.toThrow();
  });

  it("allows only one outbox worker to claim one event", async () => {
    await enqueueOutbox("race", 3);
    const [first, second] = await Promise.all([
      outbox.claimBatch("outbox-worker-a", 1, 30),
      outbox.claimBatch("outbox-worker-b", 1, 30),
    ]);
    expect(first.length + second.length).toBe(1);
  });

  it("leaves unsupported workflow events and jobs pending for their owning worker", async () => {
    await enqueueOutbox("step8-boundary", 3);
    await enqueueJob("step8-boundary", 3);

    await expect(
      outbox.claimBatch("platform-worker", 10, 30, [
        "platform.proof.requested.v1",
      ]),
    ).resolves.toEqual([]);
    await expect(
      jobs.claimBatch("platform-worker", 10, 30, [
        "platform.proof.complete.v1",
      ]),
    ).resolves.toEqual([]);
    await expect(
      database.outboxMessage.findFirstOrThrow(),
    ).resolves.toMatchObject({
      status: "PENDING",
      attempts: 0,
    });
    await expect(database.durableJob.findFirstOrThrow()).resolves.toMatchObject(
      {
        status: "PENDING",
        attemptCount: 0,
      },
    );
  });

  it("reclaims an expired outbox lease", async () => {
    await enqueueOutbox("lease", 3);
    const [claimed] = await outbox.claimBatch("outbox-crashed", 1, 30);
    const firstClaim = requireDefined(claimed);
    await database.outboxMessage.update({
      where: { id: firstClaim.eventId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const [reclaimed] = await outbox.claimBatch("outbox-recovery", 1, 30);
    expect(reclaimed?.eventId).toBe(firstClaim.eventId);
    expect(reclaimed?.leaseRecovered).toBe(true);
  });

  it("moves an outbox event to DEAD after bounded retries", async () => {
    await enqueueOutbox("dead", 2);
    const [first] = await outbox.claimBatch("outbox-retry", 1, 30);
    await outbox.markFailed(
      requireDefined(first),
      "outbox-retry",
      new Error("FAIL_ONE"),
      0,
    );
    const [second] = await outbox.claimBatch("outbox-retry", 1, 30);
    const secondClaim = requireDefined(second);
    const status = await outbox.markFailed(
      secondClaim,
      "outbox-retry",
      new Error("FAIL_TWO"),
      0,
    );
    expect(status).toBe("DEAD");
    await expect(
      database.outboxMessage.findUniqueOrThrow({
        where: { id: secondClaim.eventId },
      }),
    ).resolves.toMatchObject({ status: "DEAD", attempts: 2 });
  });

  it("allows only one durable-job worker to claim one job", async () => {
    await enqueueJob("race", 3);
    const [first, second] = await Promise.all([
      jobs.claimBatch("job-worker-a", 1, 30),
      jobs.claimBatch("job-worker-b", 1, 30),
    ]);
    expect(first.length + second.length).toBe(1);
  });

  it("reclaims a durable job after a crashed worker lease expires", async () => {
    await enqueueJob("lease", 3);
    const [claimed] = await jobs.claimBatch("job-crashed", 1, 30);
    const firstClaim = requireDefined(claimed);
    await database.durableJob.update({
      where: { id: firstClaim.jobId },
      data: { leaseExpiresAt: new Date(Date.now() - 1_000) },
    });
    const [reclaimed] = await jobs.claimBatch("job-recovery", 1, 30);
    expect(reclaimed?.jobId).toBe(firstClaim.jobId);
    expect(reclaimed?.leaseRecovered).toBe(true);
  });

  it("retries a durable job then moves it to DEAD at max attempts", async () => {
    await enqueueJob("retry-dead", 2);
    const [first] = await jobs.claimBatch("job-retry", 1, 30);
    expect(
      await jobs.markFailed(
        requireDefined(first),
        "job-retry",
        new Error("FAIL_ONE"),
        0,
      ),
    ).toBe("FAILED");
    const [second] = await jobs.claimBatch("job-retry", 1, 30);
    expect(
      await jobs.markFailed(
        requireDefined(second),
        "job-retry",
        new Error("FAIL_TWO"),
        0,
      ),
    ).toBe("DEAD");
  });

  it("deduplicates configured logical job submissions", async () => {
    const enqueue = async (): Promise<string> =>
      transactions.run(context(), async (transaction) => {
        const result = await jobs.enqueue(transaction, {
          type: "synthetic.idempotent",
          payload: { synthetic: true },
          traceId: "trace-idempotent",
          correlationId: "correlation-idempotent",
          idempotencyKey: "same-logical-submission",
        });
        return result.jobId;
      });
    const [first, second] = await Promise.all([enqueue(), enqueue()]);
    expect(first).toBe(second);
    await expect(database.durableJob.count()).resolves.toBe(1);
  });

  it("executes the synthetic proof through outbox and durable-job worker stages", async () => {
    const dependencies = createPlatformWorkerDependencies(
      database,
      silentPlatformLogger,
    );
    const started = await startPlatformProof(
      dependencies,
      "trace-platform-proof",
      "correlation-platform-proof",
    );
    const worker = new PlatformWorker(
      dependencies,
      createPlatformProofHandlers(),
      {
        workerId: "proof-worker",
        batchSize: 10,
        pollingDelayMs: 10,
        leaseSeconds: 30,
        baseRetryDelayMs: 0,
        maxRetryDelayMs: 0,
      },
      silentPlatformLogger,
    );
    expect(worker.health().ready).toBe(false);
    await worker.pollOnce();
    expect(worker.health().ready).toBe(true);

    await expect(
      database.platformProofRun.findUniqueOrThrow({
        where: { id: started.proofRunId },
      }),
    ).resolves.toMatchObject({ status: "COMPLETED" });
    await expect(
      database.outboxMessage.findUniqueOrThrow({
        where: { id: started.eventId },
      }),
    ).resolves.toMatchObject({ status: "SUCCEEDED" });
    await expect(database.durableJob.findFirstOrThrow()).resolves.toMatchObject(
      {
        status: "SUCCEEDED",
        progress: 100,
      },
    );
    await expect(database.auditEvent.count()).resolves.toBe(2);
    worker.stop();
    expect(worker.health().ready).toBe(false);
  });

  async function enqueueOutbox(
    suffix: string,
    maxAttempts: number,
  ): Promise<void> {
    await transactions.run(context(), async (transaction) => {
      await outbox.enqueue(
        transaction,
        outboxInput(suffix, `trace-${suffix}`, maxAttempts),
      );
    });
  }

  async function enqueueJob(
    suffix: string,
    maxAttempts: number,
  ): Promise<void> {
    await transactions.run(context(), async (transaction) => {
      await jobs.enqueue(transaction, {
        type: `synthetic.${suffix}`,
        payload: { synthetic: true },
        traceId: `trace-${suffix}`,
        correlationId: `correlation-${suffix}`,
        maxAttempts,
      });
    });
  }
});

function context(): { traceId: string; correlationId: string } {
  return { traceId: "trace-test", correlationId: "correlation-test" };
}

function auditInput(resourceId: string, traceId: string) {
  return {
    actorUserId: null,
    actorSessionId: null,
    actionCode: "SYNTHETIC_CREATED",
    resourceType: "PlatformProofRun",
    resourceId,
    workspace: "PLATFORM",
    countryCode: null,
    metadata: { synthetic: true },
    traceId,
    correlationId: `correlation-${traceId}`,
    source: "integration-test",
  } as const;
}

function outboxInput(resourceId: string, traceId: string, maxAttempts = 3) {
  return {
    eventType: "synthetic.created.v1",
    aggregateType: "PlatformProofRun",
    aggregateId: resourceId,
    payload: { synthetic: true },
    traceId,
    correlationId: `correlation-${traceId}`,
    maxAttempts,
  } as const;
}

function requireDefined<T>(value: T | undefined): T {
  if (value === undefined) {
    throw new Error("EXPECTED_CLAIM_NOT_RETURNED");
  }
  return value;
}
