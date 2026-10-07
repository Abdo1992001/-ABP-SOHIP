import type { Prisma } from "../generated/prisma/client.js";
import type { DatabaseClient } from "../client.js";
import { safeError } from "./json.js";
import {
  JsonConsolePlatformLogger,
  type PlatformLogger,
} from "./structured-logger.js";

export type TransactionClient = Prisma.TransactionClient;

export interface TransactionContext {
  traceId: string;
  correlationId: string;
}

export interface TransactionRunOptions {
  maxWaitMs?: number;
  timeoutMs?: number;
  isolationLevel?: Prisma.TransactionIsolationLevel;
}

export class TransactionManager {
  constructor(
    private readonly database: DatabaseClient,
    private readonly logger: PlatformLogger = new JsonConsolePlatformLogger(),
  ) {}

  /**
   * Own the boundary in an application service. Callbacks must contain database work only:
   * never HTTP, email, storage, queue, or other network side effects.
   */
  async run<T>(
    context: TransactionContext,
    work: (transaction: TransactionClient) => Promise<T>,
    options: TransactionRunOptions = {},
  ): Promise<T> {
    try {
      return await this.database.$transaction(
        async (transaction) => work(transaction),
        {
          maxWait: options.maxWaitMs ?? 5_000,
          timeout: options.timeoutMs ?? 10_000,
          ...(options.isolationLevel === undefined
            ? {}
            : { isolationLevel: options.isolationLevel }),
        },
      );
    } catch (error) {
      const safe = safeError(error);
      this.logger.log("error", {
        event: "database_transaction_failed",
        traceId: context.traceId,
        correlationId: context.correlationId,
        errorCode: safe.code,
        errorMessage: safe.message,
      });
      throw error;
    }
  }
}
