import { randomUUID } from "node:crypto";
import type { DatabaseClient } from "../client.js";
import { AuditRepository } from "./audit-repository.js";
import {
  type ClaimedDurableJob,
  DurableJobRepository,
} from "./durable-job-repository.js";
import {
  type ClaimedOutboxMessage,
  OutboxRepository,
} from "./outbox-repository.js";
import {
  JsonConsolePlatformLogger,
  type PlatformLogger,
} from "./structured-logger.js";
import { TransactionManager } from "./transaction-manager.js";

export interface WorkerConfiguration {
  workerId: string;
  batchSize: number;
  pollingDelayMs: number;
  leaseSeconds: number;
  baseRetryDelayMs: number;
  maxRetryDelayMs: number;
}

export interface WorkerHealth {
  live: boolean;
  ready: boolean;
  stopping: boolean;
  lastPollAtUtc: string | null;
  lastPollSucceeded: boolean | null;
}

export interface PlatformWorkerDependencies {
  database: DatabaseClient;
  transactionManager: TransactionManager;
  auditRepository: AuditRepository;
  outboxRepository: OutboxRepository;
  durableJobRepository: DurableJobRepository;
}

export type OutboxHandler = (
  message: ClaimedOutboxMessage,
  dependencies: PlatformWorkerDependencies,
) => Promise<void>;

export interface JobHandlerResult {
  resultReference: string | null;
}

export type DurableJobHandler = (
  job: ClaimedDurableJob,
  dependencies: PlatformWorkerDependencies,
) => Promise<JobHandlerResult>;

export interface PlatformWorkerHandlers {
  outbox: Readonly<Record<string, OutboxHandler>>;
  jobs: Readonly<Record<string, DurableJobHandler>>;
}

export class PlatformWorker {
  private stopping = false;
  private lastPollAtUtc: string | null = null;
  private lastPollSucceeded: boolean | null = null;

  constructor(
    private readonly dependencies: PlatformWorkerDependencies,
    private readonly handlers: PlatformWorkerHandlers,
    private readonly configuration: WorkerConfiguration,
    private readonly logger: PlatformLogger = new JsonConsolePlatformLogger(),
  ) {
    validateConfiguration(configuration);
  }

  health(): WorkerHealth {
    return {
      live: true,
      ready: !this.stopping && this.lastPollSucceeded === true,
      stopping: this.stopping,
      lastPollAtUtc: this.lastPollAtUtc,
      lastPollSucceeded: this.lastPollSucceeded,
    };
  }

  async pollOnce(): Promise<{
    outboxProcessed: number;
    jobsProcessed: number;
  }> {
    if (this.stopping) {
      return { outboxProcessed: 0, jobsProcessed: 0 };
    }
    try {
      const outboxProcessed = await this.processOutboxBatch();
      const jobsProcessed = await this.processJobBatch();
      this.lastPollAtUtc = new Date().toISOString();
      this.lastPollSucceeded = true;
      return { outboxProcessed, jobsProcessed };
    } catch (error) {
      this.lastPollAtUtc = new Date().toISOString();
      this.lastPollSucceeded = false;
      this.logger.log("error", { event: "worker_poll_failed" });
      throw error;
    }
  }

  async run(signal: AbortSignal): Promise<void> {
    if (signal.aborted) {
      this.stopping = true;
      return;
    }
    const abort = (): void => {
      this.stopping = true;
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      while (!this.stopping) {
        await this.pollOnce().catch(() => undefined);
        await abortableDelay(this.configuration.pollingDelayMs, signal);
      }
    } finally {
      this.stopping = true;
      signal.removeEventListener("abort", abort);
    }
  }

  stop(): void {
    this.stopping = true;
  }

  private async processOutboxBatch(): Promise<number> {
    const messages = await this.dependencies.outboxRepository.claimBatch(
      this.configuration.workerId,
      this.configuration.batchSize,
      this.configuration.leaseSeconds,
      Object.keys(this.handlers.outbox),
    );
    for (const message of messages) {
      const handler = this.handlers.outbox[message.eventType];
      try {
        if (handler === undefined) {
          throw codedError("OUTBOX_HANDLER_NOT_REGISTERED");
        }
        await handler(message, this.dependencies);
        const completed =
          await this.dependencies.outboxRepository.markSucceeded(
            message.eventId,
            this.configuration.workerId,
          );
        if (!completed) {
          throw codedError("OUTBOX_LEASE_LOST");
        }
      } catch (error) {
        await this.dependencies.outboxRepository.markFailed(
          message,
          this.configuration.workerId,
          error,
          retryDelay(
            message.attempts,
            this.configuration.baseRetryDelayMs,
            this.configuration.maxRetryDelayMs,
          ),
        );
      }
    }
    return messages.length;
  }

  private async processJobBatch(): Promise<number> {
    const jobs = await this.dependencies.durableJobRepository.claimBatch(
      this.configuration.workerId,
      this.configuration.batchSize,
      this.configuration.leaseSeconds,
      Object.keys(this.handlers.jobs),
    );
    for (const job of jobs) {
      const handler = this.handlers.jobs[job.type];
      try {
        if (handler === undefined) {
          throw codedError("JOB_HANDLER_NOT_REGISTERED");
        }
        const result = await handler(job, this.dependencies);
        const completed =
          await this.dependencies.durableJobRepository.markSucceeded(
            job.jobId,
            this.configuration.workerId,
            result.resultReference,
          );
        if (!completed) {
          throw codedError("JOB_LEASE_LOST");
        }
      } catch (error) {
        await this.dependencies.durableJobRepository.markFailed(
          job,
          this.configuration.workerId,
          error,
          retryDelay(
            job.attemptCount,
            this.configuration.baseRetryDelayMs,
            this.configuration.maxRetryDelayMs,
          ),
        );
      }
    }
    return jobs.length;
  }
}

export function createPlatformWorkerDependencies(
  database: DatabaseClient,
  logger: PlatformLogger = new JsonConsolePlatformLogger(),
): PlatformWorkerDependencies {
  return {
    database,
    transactionManager: new TransactionManager(database, logger),
    auditRepository: new AuditRepository(),
    outboxRepository: new OutboxRepository(database, logger),
    durableJobRepository: new DurableJobRepository(database, logger),
  };
}

export function workerConfigurationFromEnvironment(
  environment: NodeJS.ProcessEnv,
): WorkerConfiguration {
  return {
    workerId:
      environment.ABP_WORKER_ID ??
      `worker-${process.pid.toString()}-${randomUUID()}`,
    batchSize: parseInteger(environment.ABP_WORKER_BATCH_SIZE, 10),
    pollingDelayMs: parseInteger(environment.ABP_WORKER_POLL_DELAY_MS, 1_000),
    leaseSeconds: parseInteger(environment.ABP_WORKER_LEASE_SECONDS, 30),
    baseRetryDelayMs: parseInteger(environment.ABP_WORKER_RETRY_BASE_MS, 1_000),
    maxRetryDelayMs: parseInteger(environment.ABP_WORKER_RETRY_MAX_MS, 60_000),
  };
}

function retryDelay(attempt: number, baseMs: number, maxMs: number): number {
  return Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function validateConfiguration(configuration: WorkerConfiguration): void {
  if (
    !Number.isInteger(configuration.batchSize) ||
    configuration.batchSize < 1 ||
    configuration.batchSize > 100 ||
    configuration.pollingDelayMs < 10 ||
    configuration.leaseSeconds < 1 ||
    configuration.baseRetryDelayMs < 0 ||
    configuration.maxRetryDelayMs < configuration.baseRetryDelayMs
  ) {
    throw new Error("WORKER_CONFIGURATION_INVALID");
  }
}

async function abortableDelay(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timeout = setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        resolve();
      },
      { once: true },
    );
  });
}

function codedError(code: string): Error {
  return Object.assign(new Error(code), { code });
}
