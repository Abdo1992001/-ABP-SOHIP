import type { TransactionClient } from "./transaction-manager.js";
import { toInputJson } from "./json.js";

export interface AuditRecordInput {
  occurredAtUtc?: Date;
  actorUserId: string | null;
  actorSessionId: string | null;
  actionCode: string;
  resourceType: string;
  resourceId: string | null;
  workspace: string;
  countryCode: string | null;
  beforeSnapshot?: Readonly<Record<string, unknown>> | null;
  afterSnapshot?: Readonly<Record<string, unknown>> | null;
  metadata?: Readonly<Record<string, unknown>> | null;
  traceId: string;
  correlationId: string;
  source: string;
  schemaVersion?: number;
}

export class AuditRepository {
  async append(
    transaction: TransactionClient,
    input: AuditRecordInput,
  ): Promise<{ auditEventId: string }> {
    const record = await transaction.auditEvent.create({
      data: {
        ...(input.occurredAtUtc === undefined
          ? {}
          : { occurredAt: input.occurredAtUtc }),
        actorUserId: input.actorUserId,
        actorSessionId: input.actorSessionId,
        actionCode: input.actionCode,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        workspace: input.workspace,
        countryCode: input.countryCode,
        ...(input.beforeSnapshot == null
          ? {}
          : { beforeSnapshot: toInputJson(input.beforeSnapshot, true) }),
        ...(input.afterSnapshot == null
          ? {}
          : { afterSnapshot: toInputJson(input.afterSnapshot, true) }),
        ...(input.metadata == null
          ? {}
          : { metadata: toInputJson(input.metadata, true) }),
        traceId: input.traceId,
        correlationId: input.correlationId,
        source: input.source,
        schemaVersion: input.schemaVersion ?? 1,
      },
      select: { id: true },
    });
    return { auditEventId: record.id };
  }
}
