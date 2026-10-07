import type { DatabaseClient } from "../client.js";

export interface MockErpSyncResult {
  orderId: string;
  success: true;
  erpId: string;
  syncedAt: string;
}

/**
 * Deterministic local ERP adapter used by development and integration tests.
 * Repeated calls return the same external identifier and never duplicate work.
 */
export async function syncOrderToMockErp(
  database: DatabaseClient,
  orderId: string,
): Promise<MockErpSyncResult> {
  const order = await database.eRPOrder.findUnique({ where: { id: orderId } });
  if (order === null) {
    throw Object.assign(new Error("ERP_ORDER_NOT_FOUND"), {
      code: "ERP_ORDER_NOT_FOUND",
    });
  }

  if (
    order.integrationStatusCode === "SYNCED" &&
    order.externalErpId !== null &&
    order.interfacedAt !== null
  ) {
    return {
      orderId,
      success: true,
      erpId: order.externalErpId,
      syncedAt: order.interfacedAt.toISOString(),
    };
  }

  const attemptedAt = new Date();
  await database.eRPOrder.update({
    where: { id: orderId },
    data: {
      integrationStatusCode: "SYNCING",
      syncAttemptedAt: attemptedAt,
      syncErrorCode: null,
      rowVersion: { increment: 1 },
    },
  });

  const erpId = `MOCK-ERP-${order.sourceOrderKey}`;
  const syncedAt = new Date();
  await database.eRPOrder.update({
    where: { id: orderId },
    data: {
      integrationStatusCode: "SYNCED",
      externalErpId: erpId,
      interfacedAt: syncedAt,
      syncErrorCode: null,
      rowVersion: { increment: 1 },
    },
  });

  return {
    orderId,
    success: true,
    erpId,
    syncedAt: syncedAt.toISOString(),
  };
}
