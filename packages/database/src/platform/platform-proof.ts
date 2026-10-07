import type { AuditRepository } from "./audit-repository.js";
import type { OutboxRepository } from "./outbox-repository.js";
import type { PlatformWorkerHandlers } from "./platform-worker.js";
import type { TransactionManager } from "./transaction-manager.js";

export const platformProofEventType = "platform.proof.requested.v1";
export const platformProofJobType = "platform.proof.complete.v1";

export interface StartPlatformProofDependencies {
  transactionManager: TransactionManager;
  auditRepository: AuditRepository;
  outboxRepository: OutboxRepository;
}

export async function startPlatformProof(
  dependencies: StartPlatformProofDependencies,
  traceId: string,
  correlationId: string,
): Promise<{ proofRunId: string; eventId: string }> {
  return dependencies.transactionManager.run(
    { traceId, correlationId },
    async (transaction) => {
      const proof = await transaction.platformProofRun.create({
        data: { traceId, correlationId },
        select: { id: true },
      });
      await dependencies.auditRepository.append(transaction, {
        actorUserId: null,
        actorSessionId: null,
        actionCode: "PLATFORM_PROOF_REQUESTED",
        resourceType: "PlatformProofRun",
        resourceId: proof.id,
        workspace: "PLATFORM",
        countryCode: null,
        afterSnapshot: { status: "REQUESTED" },
        metadata: { synthetic: true },
        traceId,
        correlationId,
        source: "platform-proof-api",
      });
      const event = await dependencies.outboxRepository.enqueue(transaction, {
        eventType: platformProofEventType,
        aggregateType: "PlatformProofRun",
        aggregateId: proof.id,
        payload: { proofRunId: proof.id, synthetic: true },
        traceId,
        correlationId,
        idempotencyKey: proof.id,
      });
      return { proofRunId: proof.id, eventId: event.eventId };
    },
  );
}

export function createPlatformProofHandlers(): PlatformWorkerHandlers {
  return {
    outbox: {
      [platformProofEventType]: async (message, dependencies) => {
        await dependencies.transactionManager.run(
          {
            traceId: message.traceId,
            correlationId: message.correlationId,
          },
          async (transaction) => {
            await dependencies.durableJobRepository.enqueue(transaction, {
              type: platformProofJobType,
              payload: { proofRunId: message.aggregateId, synthetic: true },
              traceId: message.traceId,
              correlationId: message.correlationId,
              idempotencyKey: message.eventId,
              sourceType: "OutboxMessage",
              sourceId: message.eventId,
            });
          },
        );
      },
    },
    jobs: {
      [platformProofJobType]: async (job, dependencies) => {
        const proofRunId = readProofRunId(job.payload);
        await dependencies.transactionManager.run(
          { traceId: job.traceId, correlationId: job.correlationId },
          async (transaction) => {
            const updated = await transaction.platformProofRun.updateMany({
              where: { id: proofRunId, status: { not: "COMPLETED" } },
              data: { status: "COMPLETED", completedAt: new Date() },
            });
            if (updated.count === 1) {
              await dependencies.auditRepository.append(transaction, {
                actorUserId: null,
                actorSessionId: null,
                actionCode: "PLATFORM_PROOF_COMPLETED",
                resourceType: "PlatformProofRun",
                resourceId: proofRunId,
                workspace: "PLATFORM",
                countryCode: null,
                beforeSnapshot: { status: "REQUESTED" },
                afterSnapshot: { status: "COMPLETED" },
                metadata: { synthetic: true, jobId: job.jobId },
                traceId: job.traceId,
                correlationId: job.correlationId,
                source: "platform-proof-worker",
              });
            }
          },
        );
        return { resultReference: `platform-proof:${proofRunId}` };
      },
    },
  };
}

function readProofRunId(payload: unknown): string {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "proofRunId" in payload &&
    typeof payload.proofRunId === "string"
  ) {
    return payload.proofRunId;
  }
  throw Object.assign(new Error("PLATFORM_PROOF_PAYLOAD_INVALID"), {
    code: "PLATFORM_PROOF_PAYLOAD_INVALID",
  });
}
