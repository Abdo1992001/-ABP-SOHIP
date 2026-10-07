import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createPlatformWorkerDependencies,
  createPrismaClient,
  PlatformWorker,
  type DatabaseClient,
} from "@abp/database";
import {
  createStep8WorkflowHandlers,
  enqueuePendingErpSyncJobs,
} from "./workflow-handlers.js";

const connectionString = process.env.TEST_DATABASE_URL;
const integration = connectionString === undefined ? describe.skip : describe;

integration("ERP worker integration", () => {
  let database: DatabaseClient;
  const userId = "97000000-0000-4000-8000-000000000001";
  const accountId = "97000000-0000-4000-8000-000000000002";
  const batchId = "97000000-0000-4000-8000-000000000003";
  const sourceId = "97000000-0000-4000-8000-000000000004";
  const orderId = "97000000-0000-4000-8000-000000000005";

  beforeAll(async () => {
    if (connectionString === undefined) return;
    database = createPrismaClient(connectionString);
    await database.country.upsert({
      where: { code: "EG" },
      create: { code: "EG", name: "Egypt", continentCode: "AFRICA" },
      update: {},
    });
    await database.appUser.upsert({
      where: { id: userId },
      create: {
        id: userId,
        externalSubject: "erp-worker-integration",
        displayName: "ERP Worker Integration",
        emailNormalized: "erp-worker@example.test",
      },
      update: {},
    });
    await database.account.upsert({
      where: { id: accountId },
      create: {
        id: accountId,
        accountRef: "ACC-ERP-WORKER-TEST",
        canonicalName: "ERP Worker Test Customer",
        normalizedName: "erp worker test customer",
        countryCode: "EG",
        ownerUserId: userId,
      },
      update: {},
    });
    await database.importBatch.upsert({
      where: { id: batchId },
      create: {
        id: batchId,
        sourceSystemCode: "ERP_WORKER_TEST",
        sourceSystemId: sourceId,
        importTypeCode: "ERP_ORDERS",
        sourceFingerprint: "erp-worker-integration",
        statusCode: "COMMITTED",
        actorUserId: userId,
      },
      update: {},
    });
  });

  afterAll(async () => {
    await database.$disconnect();
  });

  it("queues pending orders and marks them synced with a stable mock ERP id", async () => {
    await database.durableJob.deleteMany({ where: { sourceId: orderId } });
    await database.eRPOrder.deleteMany({ where: { id: orderId } });
    await database.eRPOrder.create({
      data: {
        id: orderId,
        sourceSystemCode: "ABP_LOCAL",
        sourceOrderKey: "SO-WORKER-0001",
        sourceSystemId: sourceId,
        sourceSalesOrderId: orderId,
        importBatchId: batchId,
        accountId,
        countryCode: "EG",
        statusCode: "BOOKED",
        integrationStatusCode: "PENDING_SYNC",
      },
    });

    await expect(enqueuePendingErpSyncJobs(database)).resolves.toBeGreaterThan(
      0,
    );
    const worker = new PlatformWorker(
      createPlatformWorkerDependencies(database),
      createStep8WorkflowHandlers(),
      {
        workerId: "erp-worker-integration",
        batchSize: 10,
        pollingDelayMs: 10,
        leaseSeconds: 30,
        baseRetryDelayMs: 10,
        maxRetryDelayMs: 100,
      },
    );
    await worker.pollOnce();
    worker.stop();

    const [order, job] = await Promise.all([
      database.eRPOrder.findUniqueOrThrow({ where: { id: orderId } }),
      database.durableJob.findFirstOrThrow({
        where: { sourceId: orderId, type: "ERP_ORDER_SYNC" },
      }),
    ]);
    expect(order).toMatchObject({
      integrationStatusCode: "SYNCED",
      externalErpId: "MOCK-ERP-SO-WORKER-0001",
      syncErrorCode: null,
    });
    expect(order.interfacedAt).not.toBeNull();
    expect(job.status).toBe("SUCCEEDED");
    expect(job.resultReference).toContain("MOCK-ERP-SO-WORKER-0001");
  });
});
