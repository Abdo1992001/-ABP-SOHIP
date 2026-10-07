import type { DatabaseClient } from "../client.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { safeError, toInputJson } from "./json.js";
import {
  JsonConsolePlatformLogger,
  type PlatformLogger,
} from "./structured-logger.js";
import type { TransactionClient } from "./transaction-manager.js";

export const outboxStatuses = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;
export type OutboxStatus = (typeof outboxStatuses)[number];

export interface OutboxMessageInput {
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion?: number;
  payload: Readonly<Record<string, unknown>>;
  availableAt?: Date;
  maxAttempts?: number;
  traceId: string;
  correlationId: string;
  idempotencyKey?: string;
}

export interface ClaimedOutboxMessage {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion: number;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  traceId: string;
  correlationId: string;
  idempotencyKey: string | null;
  leaseRecovered: boolean;
}

interface OutboxClaimRow {
  eventId: string;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  schemaVersion: number;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
  traceId: string;
  correlationId: string;
  idempotencyKey: string | null;
  leaseRecovered: boolean;
}

interface ExhaustedOutboxRow {
  eventId: string;
  traceId: string;
  correlationId: string;
  attempts: number;
}

export class OutboxRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: PlatformLogger = new JsonConsolePlatformLogger(),
  ) {}

  async enqueue(
    transaction: TransactionClient,
    input: OutboxMessageInput,
  ): Promise<{ eventId: string }> {
    const data = {
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      schemaVersion: input.schemaVersion ?? 1,
      payload: toInputJson(input.payload),
      ...(input.availableAt === undefined
        ? {}
        : { availableAt: input.availableAt }),
      maxAttempts: input.maxAttempts ?? 5,
      traceId: input.traceId,
      correlationId: input.correlationId,
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
    };
    const message =
      input.idempotencyKey === undefined
        ? await transaction.outboxMessage.create({ data, select: { id: true } })
        : readSingleRow(
            await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              INSERT INTO outbox_messages (
                id, event_type, aggregate_type, aggregate_id, schema_version,
                payload, status, available_at, max_attempts, trace_id,
                correlation_id, idempotency_key
              ) VALUES (
                ${randomUUID()}::uuid, ${input.eventType}, ${input.aggregateType},
                ${input.aggregateId}, ${input.schemaVersion ?? 1},
                ${JSON.stringify(toInputJson(input.payload))}::jsonb, 'PENDING',
                ${input.availableAt ?? new Date()}, ${input.maxAttempts ?? 5},
                ${input.traceId}, ${input.correlationId}, ${input.idempotencyKey}
              )
              ON CONFLICT (event_type, idempotency_key)
              DO UPDATE SET event_type = EXCLUDED.event_type
              RETURNING id
            `),
            "OUTBOX_IDEMPOTENT_INSERT_FAILED",
          );
    return { eventId: message.id };
  }

  async claimBatch(
    workerId: string,
    batchSize: number,
    leaseSeconds: number,
    supportedEventTypes?: readonly string[],
  ): Promise<ClaimedOutboxMessage[]> {
    assertClaimConfiguration(batchSize, leaseSeconds);
    await this.markExhaustedExpiredLeasesDead();

    const rows = await this.database.$queryRaw<OutboxClaimRow[]>(Prisma.sql`
      WITH claimable AS (
        SELECT id, status AS previous_status
        FROM outbox_messages
        WHERE attempts < max_attempts
          AND ${supportedEventTypePredicate(supportedEventTypes)}
          AND (
            (status IN ('PENDING', 'FAILED') AND available_at <= clock_timestamp())
            OR
            (status = 'PROCESSING' AND lease_expires_at < clock_timestamp())
          )
        ORDER BY available_at, created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE outbox_messages AS message
      SET status = 'PROCESSING',
          attempts = message.attempts + 1,
          lease_owner = ${workerId},
          lease_expires_at = clock_timestamp() + make_interval(secs => ${leaseSeconds}),
          last_error_code = NULL,
          last_error_message = NULL
      FROM claimable
      WHERE message.id = claimable.id
      RETURNING
        message.id AS "eventId",
        message.event_type AS "eventType",
        message.aggregate_type AS "aggregateType",
        message.aggregate_id AS "aggregateId",
        message.schema_version AS "schemaVersion",
        message.payload,
        message.attempts,
        message.max_attempts AS "maxAttempts",
        message.trace_id AS "traceId",
        message.correlation_id AS "correlationId",
        message.idempotency_key AS "idempotencyKey",
        (claimable.previous_status = 'PROCESSING') AS "leaseRecovered"
    `);

    for (const row of rows) {
      this.logger.log("info", {
        event: "outbox_claimed",
        eventId: row.eventId,
        workerId,
        traceId: row.traceId,
        correlationId: row.correlationId,
        attempt: row.attempts,
        leaseRecovered: row.leaseRecovered,
      });
    }
    return rows;
  }

  async markSucceeded(eventId: string, workerId: string): Promise<boolean> {
    const updated = await this.database.outboxMessage.updateMany({
      where: { id: eventId, status: "PROCESSING", leaseOwner: workerId },
      data: {
        status: "SUCCEEDED",
        processedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
      },
    });
    return updated.count === 1;
  }

  async markFailed(
    message: ClaimedOutboxMessage,
    workerId: string,
    error: unknown,
    retryDelayMs: number,
  ): Promise<OutboxStatus> {
    const safe = safeError(error);
    const dead = message.attempts >= message.maxAttempts;
    const status: OutboxStatus = dead ? "DEAD" : "FAILED";
    const updated = await this.database.outboxMessage.updateMany({
      where: {
        id: message.eventId,
        status: "PROCESSING",
        leaseOwner: workerId,
      },
      data: {
        status,
        availableAt: new Date(Date.now() + retryDelayMs),
        leaseOwner: null,
        leaseExpiresAt: null,
        lastErrorCode: safe.code,
        lastErrorMessage: safe.message,
      },
    });
    if (updated.count !== 1) {
      return "PROCESSING";
    }
    this.logger.log(dead ? "error" : "warn", {
      event: dead ? "outbox_dead" : "outbox_retry_scheduled",
      eventId: message.eventId,
      workerId,
      traceId: message.traceId,
      correlationId: message.correlationId,
      attempt: message.attempts,
      errorCode: safe.code,
    });
    return status;
  }

  private async markExhaustedExpiredLeasesDead(): Promise<void> {
    const exhausted = await this.database.$queryRaw<
      ExhaustedOutboxRow[]
    >(Prisma.sql`
      UPDATE outbox_messages
      SET status = 'DEAD',
          lease_owner = NULL,
          lease_expires_at = NULL,
          last_error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
          last_error_message = 'Worker lease expired after the final permitted attempt.'
      WHERE status = 'PROCESSING'
        AND lease_expires_at < clock_timestamp()
        AND attempts >= max_attempts
      RETURNING id AS "eventId", trace_id AS "traceId",
        correlation_id AS "correlationId", attempts
    `);
    for (const message of exhausted) {
      this.logger.log("error", {
        event: "outbox_dead",
        eventId: message.eventId,
        traceId: message.traceId,
        correlationId: message.correlationId,
        attempt: message.attempts,
        leaseRecovered: true,
        errorCode: "LEASE_EXPIRED_AFTER_MAX_ATTEMPTS",
      });
    }
  }
}

function supportedEventTypePredicate(
  supportedEventTypes: readonly string[] | undefined,
): Prisma.Sql {
  if (supportedEventTypes === undefined) return Prisma.sql`TRUE`;
  if (supportedEventTypes.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`event_type IN (${Prisma.join(supportedEventTypes)})`;
}

function readSingleRow<T>(rows: T[], errorCode: string): T {
  const [row] = rows;
  if (row === undefined) {
    throw new Error(errorCode);
  }
  return row;
}

function assertClaimConfiguration(
  batchSize: number,
  leaseSeconds: number,
): void {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error("OUTBOX_BATCH_SIZE_INVALID");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error("OUTBOX_LEASE_SECONDS_INVALID");
  }
}
