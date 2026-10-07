import { Inject, Injectable } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { TransactionManager } from "@abp/database";
import { AuditService } from "./audit.service.js";
import { OutboxService } from "./outbox.service.js";
import { transactionManagerToken } from "./database.providers.js";

export const platformProofEventType = "platform.proof.requested.v1";

@Injectable()
export class PlatformProofService {
  constructor(
    @Inject(transactionManagerToken)
    private readonly transactionManager: TransactionManager,
    @Inject(AuditService)
    private readonly audit: AuditService,
    @Inject(OutboxService)
    private readonly outbox: OutboxService,
  ) {}

  async start(
    requestedTraceId?: string,
    requestedCorrelationId?: string,
  ): Promise<{
    proofRunId: string;
    eventId: string;
    traceId: string;
    correlationId: string;
  }> {
    const traceId = requestedTraceId ?? randomUUID();
    const correlationId = requestedCorrelationId ?? randomUUID();
    const result = await this.transactionManager.run(
      { traceId, correlationId },
      async (transaction) => {
        const proof = await transaction.platformProofRun.create({
          data: { traceId, correlationId },
          select: { id: true },
        });
        await this.audit.record(transaction, {
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
        const event = await this.outbox.enqueue(transaction, {
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
    return { ...result, traceId, correlationId };
  }
}
