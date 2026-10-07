import "reflect-metadata";
import { createServer, type Server } from "node:http";
import {
  createPlatformProofHandlers,
  createPlatformWorkerDependencies,
  createPrismaClient,
  PlatformWorker,
  workerConfigurationFromEnvironment,
} from "@abp/database";
import {
  createStep8WorkflowHandlers,
  enqueuePendingErpSyncJobs,
  mergeHandlers,
} from "./workflow-handlers.js";
import { scanAlerts } from "./alert-scanner.js";
import { readMailConfig } from "./mail/mail-config.js";
import { queueNotificationEmails, sendDueEmails } from "./mail/mail-outbox.js";
import { createMailTransport } from "./mail/mail-transport.js";

async function bootstrap(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString === undefined || connectionString.length === 0) {
    throw new Error("DATABASE_URL_REQUIRED");
  }
  const database = createPrismaClient(connectionString);
  const worker = new PlatformWorker(
    createPlatformWorkerDependencies(database),
    mergeHandlers(createPlatformProofHandlers(), createStep8WorkflowHandlers()),
    workerConfigurationFromEnvironment(process.env),
  );
  const abortController = new AbortController();
  const healthServer = await startHealthServer(worker);
  const stop = (): void => {
    abortController.abort();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await Promise.all([
      worker.run(abortController.signal),
      runErpSyncScanner(database, abortController.signal),
      runAlertScanner(database, abortController.signal),
      runMailer(database, abortController.signal),
    ]);
  } finally {
    worker.stop();
    await closeServer(healthServer);
    await database.$disconnect();
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
  }
}

async function runErpSyncScanner(
  database: ReturnType<typeof createPrismaClient>,
  signal: AbortSignal,
): Promise<void> {
  const intervalMs = positiveInteger(
    process.env.ABP_ERP_SYNC_SCAN_INTERVAL_MS,
    5_000,
  );
  const batchSize = positiveInteger(process.env.ABP_ERP_SYNC_BATCH_SIZE, 25);
  while (!signal.aborted) {
    try {
      await enqueuePendingErpSyncJobs(database, batchSize);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "erp_sync_scan_failed",
          message:
            error instanceof Error ? error.message : "ERP_SYNC_SCAN_FAILED",
        }),
      );
    }
    await waitForAbort(intervalMs, signal);
  }
}

/**
 * Every ten minutes, tell people about what has become late. A failed pass
 * is logged and the next one tries again; alerts already sent are not
 * repeated.
 */
async function runAlertScanner(
  database: ReturnType<typeof createPrismaClient>,
  signal: AbortSignal,
): Promise<void> {
  const intervalMs = positiveInteger(
    process.env.ABP_ALERT_SCAN_INTERVAL_MS,
    600_000,
  );
  // A short pause first, so the scanner does not race the migrations.
  await waitForAbort(30_000, signal);
  while (!signal.aborted) {
    try {
      const sent = await scanAlerts(database);
      if (sent > 0)
        console.log(
          JSON.stringify({ level: "info", event: "alerts_sent", count: sent }),
        );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "alert_scan_failed",
          message: error instanceof Error ? error.message : "ALERT_SCAN_FAILED",
        }),
      );
    }
    await waitForAbort(intervalMs, signal);
  }
}

/**
 * Email: every twenty seconds, gather new notifications into one email per
 * person and send whatever is due. With no mail settings it only keeps the
 * notification queue tidy, and quotations are recorded as sent by hand.
 */
async function runMailer(
  database: ReturnType<typeof createPrismaClient>,
  signal: AbortSignal,
): Promise<void> {
  const config = readMailConfig();
  const transport = createMailTransport(config);
  const intervalMs = positiveInteger(process.env.ABP_MAIL_INTERVAL_MS, 20_000);
  console.log(
    JSON.stringify({
      level: "info",
      event: "mail_ready",
      provider: config.provider,
    }),
  );
  await waitForAbort(15_000, signal);
  while (!signal.aborted) {
    try {
      const digests = await queueNotificationEmails(database, config);
      const result = transport
        ? await sendDueEmails(database, transport)
        : { sent: 0, failed: 0 };
      if (digests > 0 || result.sent > 0 || result.failed > 0)
        console.log(
          JSON.stringify({
            level: "info",
            event: "mail_pass",
            digests,
            ...result,
          }),
        );
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "mail_pass_failed",
          message: error instanceof Error ? error.message : "MAIL_PASS_FAILED",
        }),
      );
    }
    await waitForAbort(intervalMs, signal);
  }
}

async function waitForAbort(
  milliseconds: number,
  signal: AbortSignal,
): Promise<void> {
  if (signal.aborted) return;
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

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

async function startHealthServer(worker: PlatformWorker): Promise<Server> {
  const port = Number(process.env.ABP_WORKER_HEALTH_PORT ?? 3001);
  const server = createServer((request, response) => {
    const health = worker.health();
    if (request.url === "/health/live") {
      response.writeHead(health.live ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify({ live: health.live }));
      return;
    }
    if (request.url === "/health/ready") {
      response.writeHead(health.ready ? 200 : 503, {
        "content-type": "application/json",
      });
      response.end(JSON.stringify(health));
      return;
    }
    response.writeHead(404).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "0.0.0.0", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  return server;
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error === undefined) {
        resolve();
      } else {
        reject(error);
      }
    });
  });
}

void bootstrap().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "WORKER_BOOTSTRAP_FAILED";
  console.error(
    JSON.stringify({
      level: "error",
      event: "worker_bootstrap_failed",
      message,
    }),
  );
  process.exitCode = 1;
});
