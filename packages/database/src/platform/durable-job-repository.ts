import type { DatabaseClient } from "../client.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "../generated/prisma/client.js";
import { safeError, toInputJson } from "./json.js";
import {
  JsonConsolePlatformLogger,
  type PlatformLogger,
} from "./structured-logger.js";
import type { TransactionClient } from "./transaction-manager.js";

export const durableJobStatuses = [
  "PENDING",
  "PROCESSING",
  "SUCCEEDED",
  "FAILED",
  "DEAD",
] as const;
export type DurableJobStatus = (typeof durableJobStatuses)[number];

export interface EnqueueDurableJobInput {
  type: string;
  payload: Readonly<Record<string, unknown>>;
  maxAttempts?: number;
  availableAt?: Date;
  traceId: string;
  correlationId: string;
  idempotencyKey?: string;
  sourceType?: string;
  sourceId?: string;
}

export interface ClaimedDurableJob {
  jobId: string;
  type: string;
  payload: unknown;
  progress: number;
  attemptCount: number;
  maxAttempts: number;
  traceId: string;
  correlationId: string;
  idempotencyKey: string | null;
  sourceType: string | null;
  sourceId: string | null;
  leaseRecovered: boolean;
}

type DurableJobClaimRow = ClaimedDurableJob;

interface ExhaustedJobRow {
  jobId: string;
  traceId: string;
  correlationId: string;
  attemptCount: number;
}

export class DurableJobRepository {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: PlatformLogger = new JsonConsolePlatformLogger(),
  ) {}

  async enqueue(
    transaction: TransactionClient,
    input: EnqueueDurableJobInput,
  ): Promise<{ jobId: string }> {
    const data = {
      type: input.type,
      payload: toInputJson(input.payload),
      maxAttempts: input.maxAttempts ?? 5,
      ...(input.availableAt === undefined
        ? {}
        : { availableAt: input.availableAt }),
      traceId: input.traceId,
      correlationId: input.correlationId,
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: input.idempotencyKey }),
      ...(input.sourceType === undefined
        ? {}
        : { sourceType: input.sourceType }),
      ...(input.sourceId === undefined ? {} : { sourceId: input.sourceId }),
    };
    const job =
      input.idempotencyKey === undefined
        ? await transaction.durableJob.create({ data, select: { id: true } })
        : readSingleRow(
            await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
              INSERT INTO durable_jobs (
                id, type, status, payload, progress, attempt_count, max_attempts,
                available_at, trace_id, correlation_id, idempotency_key,
                source_type, source_id
              ) VALUES (
                ${randomUUID()}::uuid, ${input.type}, 'PENDING',
                ${JSON.stringify(toInputJson(input.payload))}::jsonb, 0, 0,
                ${input.maxAttempts ?? 5}, ${input.availableAt ?? new Date()},
                ${input.traceId}, ${input.correlationId}, ${input.idempotencyKey},
                ${input.sourceType ?? null}, ${input.sourceId ?? null}
              )
              ON CONFLICT (type, idempotency_key)
              DO UPDATE SET type = EXCLUDED.type
              RETURNING id
            `),
            "DURABLE_JOB_IDEMPOTENT_INSERT_FAILED",
          );
    return { jobId: job.id };
  }

  async claimBatch(
    workerId: string,
    batchSize: number,
    leaseSeconds: number,
    supportedTypes?: readonly string[],
  ): Promise<ClaimedDurableJob[]> {
    assertClaimConfiguration(batchSize, leaseSeconds);
    await this.markExhaustedExpiredLeasesDead();

    const rows = await this.database.$queryRaw<DurableJobClaimRow[]>(Prisma.sql`
      WITH claimable AS (
        SELECT id, status AS previous_status
        FROM durable_jobs
        WHERE attempt_count < max_attempts
          AND ${supportedTypePredicate("type", supportedTypes)}
          AND (
            (status IN ('PENDING', 'FAILED') AND COALESCE(retry_at, available_at) <= clock_timestamp())
            OR
            (status = 'PROCESSING' AND lease_expires_at < clock_timestamp())
          )
        ORDER BY COALESCE(retry_at, available_at), created_at, id
        FOR UPDATE SKIP LOCKED
        LIMIT ${batchSize}
      )
      UPDATE durable_jobs AS job
      SET status = 'PROCESSING',
          attempt_count = job.attempt_count + 1,
          lease_owner = ${workerId},
          lease_expires_at = clock_timestamp() + make_interval(secs => ${leaseSeconds}),
          started_at = COALESCE(job.started_at, clock_timestamp()),
          retry_at = NULL,
          error_code = NULL,
          error_message = NULL,
          version = job.version + 1
      FROM claimable
      WHERE job.id = claimable.id
      RETURNING
        job.id AS "jobId",
        job.type,
        job.payload,
        job.progress,
        job.attempt_count AS "attemptCount",
        job.max_attempts AS "maxAttempts",
        job.trace_id AS "traceId",
        job.correlation_id AS "correlationId",
        job.idempotency_key AS "idempotencyKey",
        job.source_type AS "sourceType",
        job.source_id AS "sourceId",
        (claimable.previous_status = 'PROCESSING') AS "leaseRecovered"
    `);

    for (const row of rows) {
      this.logger.log("info", {
        event: "durable_job_claimed",
        jobId: row.jobId,
        workerId,
        traceId: row.traceId,
        correlationId: row.correlationId,
        attempt: row.attemptCount,
        leaseRecovered: row.leaseRecovered,
      });
    }
    return rows;
  }

  async updateProgress(
    jobId: string,
    workerId: string,
    progress: number,
  ): Promise<boolean> {
    if (!Number.isInteger(progress) || progress < 0 || progress > 100) {
      throw new Error("JOB_PROGRESS_INVALID");
    }
    const updated = await this.database.durableJob.updateMany({
      where: { id: jobId, status: "PROCESSING", leaseOwner: workerId },
      data: { progress, version: { increment: 1 } },
    });
    return updated.count === 1;
  }

  async markSucceeded(
    jobId: string,
    workerId: string,
    resultReference: string | null,
  ): Promise<boolean> {
    const updated = await this.database.durableJob.updateMany({
      where: { id: jobId, status: "PROCESSING", leaseOwner: workerId },
      data: {
        status: "SUCCEEDED",
        progress: 100,
        resultReference,
        finishedAt: new Date(),
        leaseOwner: null,
        leaseExpiresAt: null,
        version: { increment: 1 },
      },
    });
    return updated.count === 1;
  }

  async markFailed(
    job: ClaimedDurableJob,
    workerId: string,
    error: unknown,
    retryDelayMs: number,
  ): Promise<DurableJobStatus> {
    const safe = safeError(error);
    const dead = job.attemptCount >= job.maxAttempts;
    const status: DurableJobStatus = dead ? "DEAD" : "FAILED";
    const updated = await this.database.durableJob.updateMany({
      where: { id: job.jobId, status: "PROCESSING", leaseOwner: workerId },
      data: {
        status,
        retryAt: dead ? null : new Date(Date.now() + retryDelayMs),
        finishedAt: dead ? new Date() : null,
        leaseOwner: null,
        leaseExpiresAt: null,
        errorCode: safe.code,
        errorMessage: safe.message,
        version: { increment: 1 },
      },
    });
    if (updated.count !== 1) {
      return "PROCESSING";
    }
    this.logger.log(dead ? "error" : "warn", {
      event: dead ? "durable_job_dead" : "durable_job_retry_scheduled",
      jobId: job.jobId,
      workerId,
      traceId: job.traceId,
      correlationId: job.correlationId,
      attempt: job.attemptCount,
      errorCode: safe.code,
    });
    return status;
  }

  private async markExhaustedExpiredLeasesDead(): Promise<void> {
    const exhausted = await this.database.$queryRaw<
      ExhaustedJobRow[]
    >(Prisma.sql`
      UPDATE durable_jobs
      SET status = 'DEAD',
          lease_owner = NULL,
          lease_expires_at = NULL,
          finished_at = clock_timestamp(),
          error_code = 'LEASE_EXPIRED_AFTER_MAX_ATTEMPTS',
          error_message = 'Worker lease expired after the final permitted attempt.',
          version = version + 1
      WHERE status = 'PROCESSING'
        AND lease_expires_at < clock_timestamp()
        AND attempt_count >= max_attempts
      RETURNING id AS "jobId", trace_id AS "traceId",
        correlation_id AS "correlationId", attempt_count AS "attemptCount"
    `);
    for (const job of exhausted) {
      this.logger.log("error", {
        event: "durable_job_dead",
        jobId: job.jobId,
        traceId: job.traceId,
        correlationId: job.correlationId,
        attempt: job.attemptCount,
        leaseRecovered: true,
        errorCode: "LEASE_EXPIRED_AFTER_MAX_ATTEMPTS",
      });
    }
  }
}

function supportedTypePredicate(
  column: "type",
  supportedTypes: readonly string[] | undefined,
): Prisma.Sql {
  if (supportedTypes === undefined) return Prisma.sql`TRUE`;
  if (supportedTypes.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(column)} IN (${Prisma.join(supportedTypes)})`;
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
    throw new Error("JOB_BATCH_SIZE_INVALID");
  }
  if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1) {
    throw new Error("JOB_LEASE_SECONDS_INVALID");
  }
}
