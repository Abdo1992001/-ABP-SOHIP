import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { createPrismaClient } from "@abp/database";
import {
  askForFeedback,
  backupProblem,
  lateComplaintStage,
  lateDelivery,
  overduePayment,
  overduePaymentForManager,
  productionRisk,
  quotationExpired,
  quotationExpiring,
  wants,
  type Alert,
} from "./alert-rules.js";

type Database = ReturnType<typeof createPrismaClient>;

/**
 * Look for what has become late and tell the person who can act on it:
 * payments past due, complaint stages past their deadline, production runs
 * that will miss the customer's date, deliveries that did not arrive, and
 * orders just delivered whose customer should be asked how it went, and
 * offers about to lapse -- or lapsed, which are then marked EXPIRED.
 *
 * Each alert is written once (see alert_log); a person who muted a category
 * in Settings does not get it.
 */
/**
 * Each salesperson's name and who manages them: their own manager, or -- when
 * none is set -- everyone holding the Sales Manager role.
 */
async function managersOf(
  db: Database,
  userIds: string[],
): Promise<Map<string, { name: string; managers: string[] }>> {
  const ids = [...new Set(userIds)];
  if (ids.length === 0) return new Map();
  const [profiles, people, salesManagers] = await Promise.all([
    db.userProfile.findMany({
      where: { userId: { in: ids } },
      select: { userId: true, managerUserId: true },
    }),
    db.appUser.findMany({
      where: { id: { in: ids } },
      select: { id: true, displayName: true },
    }),
    db.$queryRaw<{ user_id: string }[]>`
      SELECT DISTINCT ur.user_id FROM user_roles ur
        JOIN roles r ON r.id = ur.role_id
        JOIN app_users u ON u.id = ur.user_id
       WHERE r.code = 'SALES_MANAGER' AND u.active`,
  ]);
  const fallback = salesManagers.map((row) => row.user_id);
  return new Map(
    ids.map((id) => {
      const manager = profiles.find((p) => p.userId === id)?.managerUserId;
      return [
        id,
        {
          name: people.find((p) => p.id === id)?.displayName ?? "A salesperson",
          managers: manager ? [manager] : fallback,
        },
      ];
    }),
  );
}

export async function scanAlerts(
  db: Database,
  now = new Date(),
): Promise<number> {
  const today = new Date(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const alerts: Alert[] = [];

  const installments = await db.receivableInstallment.findMany({
    where: { statusCode: { in: ["OPEN", "PARTIAL"] }, dueDate: { lt: today } },
    include: {
      order: { select: { id: true, orderRef: true, ownerUserId: true } },
      account: { select: { canonicalName: true } },
    },
    take: 2000,
  });
  const managers = await managersOf(
    db,
    installments.map((row) => row.order.ownerUserId),
  );
  for (const row of installments) {
    if (row.dueDate === null) continue;
    const facts = {
      id: row.id,
      label: row.label,
      dueDate: row.dueDate,
      outstanding:
        Number(row.amount) -
        Number(row.collectedAmount) -
        Number(row.writtenOffAmount),
      currencyCode: row.currencyCode,
      orderId: row.order.id,
      orderRef: row.order.orderRef,
      accountName: row.account.canonicalName,
    };
    const alert = overduePayment({
      ...facts,
      orderOwnerUserId: row.order.ownerUserId,
    });
    if (alert) alerts.push(alert);
    const owner = managers.get(row.order.ownerUserId);
    const forManager = overduePaymentForManager({
      ...facts,
      ownerName: owner?.name ?? "A salesperson",
      managerUserIds: (owner?.managers ?? []).filter(
        (id) => id !== row.order.ownerUserId,
      ),
    });
    if (forManager) alerts.push(forManager);
  }

  const complaints = await db.complaint.findMany({
    where: { statusCode: { not: "CLOSED" }, stageDueAt: { lt: now } },
    select: {
      id: true,
      complaintRef: true,
      statusCode: true,
      stageEnteredAt: true,
      stageDueAt: true,
      assigneeUserId: true,
      ownerUserId: true,
    },
    take: 2000,
  });
  for (const row of complaints)
    if (row.stageDueAt)
      alerts.push(lateComplaintStage({ ...row, stageDueAt: row.stageDueAt }));

  const work = await db.workOrder.findMany({
    where: { statusCode: { notIn: ["COMPLETED", "CANCELLED"] } },
    include: {
      order: {
        select: {
          orderRef: true,
          ownerUserId: true,
          requestedDeliveryDate: true,
        },
      },
    },
    take: 2000,
  });
  for (const row of work) {
    const alert = productionRisk({
      id: row.id,
      workOrderRef: row.workOrderRef,
      statusCode: row.statusCode,
      plannedEndDate: row.plannedEndDate,
      requestedDeliveryDate: row.order.requestedDeliveryDate,
      orderRef: row.order.orderRef,
      orderOwnerUserId: row.order.ownerUserId,
      createdByUserId: row.createdByUserId,
      today,
    });
    if (alert) alerts.push(alert);
  }

  const shipments = await db.shipment.findMany({
    where: {
      customerOrderId: { not: null },
      OR: [
        {
          milestoneCode: { notIn: ["DELIVERED", "POD_RECEIVED"] },
          expectedDeliveryDate: { lt: today },
        },
        {
          milestoneCode: { in: ["DELIVERED", "POD_RECEIVED"] },
          deliveredAt: { gte: new Date(now.getTime() - 14 * 86_400_000) },
        },
      ],
    },
    select: {
      id: true,
      shipmentRef: true,
      milestoneCode: true,
      expectedDeliveryDate: true,
      customerOrderId: true,
    },
    take: 2000,
  });
  const orderIds = [
    ...new Set(
      shipments
        .map((row) => row.customerOrderId)
        .filter((id): id is string => id !== null),
    ),
  ];
  const orders = orderIds.length
    ? await db.customerOrder.findMany({
        where: { id: { in: orderIds } },
        select: {
          id: true,
          orderRef: true,
          ownerUserId: true,
          statusCode: true,
          account: { select: { canonicalName: true } },
        },
      })
    : [];
  for (const row of shipments) {
    const order = orders.find((one) => one.id === row.customerOrderId);
    if (!order) continue;
    const delivered =
      row.milestoneCode === "DELIVERED" || row.milestoneCode === "POD_RECEIVED";
    if (!delivered && row.expectedDeliveryDate)
      alerts.push(
        lateDelivery({
          id: row.id,
          shipmentRef: row.shipmentRef,
          expectedDeliveryDate: row.expectedDeliveryDate,
          orderRef: order.orderRef,
          orderOwnerUserId: order.ownerUserId,
          accountName: order.account.canonicalName,
        }),
      );
    if (delivered && ["HANDED_OVER", "CLOSED"].includes(order.statusCode))
      alerts.push(
        askForFeedback({
          orderId: order.id,
          orderRef: order.orderRef,
          orderOwnerUserId: order.ownerUserId,
          accountName: order.account.canonicalName,
        }),
      );
  }

  // Sent offers nobody has taken, close to or past their validity date.
  const offers = await db.quotation.findMany({
    where: {
      statusCode: "SENT",
      expiresOn: { not: null, lte: new Date(today.getTime() + 3 * 86_400_000) },
    },
    select: {
      id: true,
      quotationRef: true,
      expiresOn: true,
      ownerUserId: true,
      countryCode: true,
      rowVersion: true,
      account: { select: { canonicalName: true } },
    },
    take: 2000,
  });
  const offerIds = offers.map((row) => row.id);
  const taken = new Set([
    ...(
      await db.quotationAcceptance.findMany({
        where: { quotationId: { in: offerIds }, statusCode: "VALID" },
        select: { quotationId: true },
      })
    ).map((row) => row.quotationId),
    ...(
      await db.customerOrder.findMany({
        where: { quotationId: { in: offerIds } },
        select: { quotationId: true },
      })
    ).map((row) => row.quotationId),
  ]);
  for (const row of offers) {
    if (row.expiresOn === null || taken.has(row.id)) continue;
    const facts = {
      id: row.id,
      quotationRef: row.quotationRef,
      expiresOn: row.expiresOn,
      ownerUserId: row.ownerUserId,
      accountName: row.account.canonicalName,
    };
    if (row.expiresOn >= today) {
      const alert = quotationExpiring({ ...facts, today });
      if (alert) alerts.push(alert);
      continue;
    }
    // Past its date: the offer no longer stands. Only if nobody touched it
    // since it was read -- the version guard -- and with an audit record, as
    // any other change of a quotation's status has.
    const expired = await db.$transaction(async (tx) => {
      const changed = await tx.quotation.updateMany({
        where: { id: row.id, statusCode: "SENT", rowVersion: row.rowVersion },
        data: { statusCode: "EXPIRED", rowVersion: { increment: 1 } },
      });
      if (changed.count !== 1) return false;
      await tx.auditEvent.create({
        data: {
          actorUserId: null,
          actionCode: "QUOTATION_EXPIRED",
          resourceType: "Quotation",
          resourceId: row.id,
          workspace: "SALES",
          countryCode: row.countryCode,
          beforeSnapshot: { statusCode: "SENT" },
          afterSnapshot: { statusCode: "EXPIRED" },
          metadata: { expiresOn: row.expiresOn?.toISOString().slice(0, 10) },
          traceId: randomUUID(),
          correlationId: randomUUID(),
          source: "alert-scanner",
        },
      });
      return true;
    });
    if (expired) alerts.push(quotationExpired(facts));
  }

  // Backups: only where the backup service reports to this worker.
  const statusFile = (process.env.ABP_BACKUP_STATUS_FILE ?? "").trim();
  if (statusFile) {
    const status: unknown = await readFile(statusFile, "utf8")
      .then((raw) => JSON.parse(raw) as unknown)
      .catch(() => null);
    const administrators = (
      await db.$queryRaw<{ user_id: string }[]>`
        SELECT DISTINCT ur.user_id FROM user_roles ur
          JOIN role_permissions rp ON rp.role_id = ur.role_id
         WHERE rp.permission_code = 'users.manage'`
    ).map((row) => row.user_id);
    const alert = backupProblem({ status, now, administrators });
    if (alert) alerts.push(alert);
  }

  // Once per key: drop what was already sent, then send and record the rest.
  const keys = [...new Set(alerts.map((alert) => alert.key))];
  if (keys.length === 0) return 0;
  const sent = new Set(
    (
      await db.alertLog.findMany({
        where: { alertKey: { in: keys } },
        select: { alertKey: true },
      })
    ).map((row) => row.alertKey),
  );
  const fresh = alerts.filter(
    (alert, index) =>
      !sent.has(alert.key) &&
      alerts.findIndex((one) => one.key === alert.key) === index,
  );
  let delivered = 0;
  for (const alert of fresh) {
    const people = await db.appUser.findMany({
      where: { id: { in: alert.recipients }, active: true },
      select: { id: true },
    });
    const preferences = await db.userPreference.findMany({
      where: { userId: { in: people.map((person) => person.id) } },
      select: { userId: true, preferences: true },
    });
    await db.$transaction(async (tx) => {
      let count = 0;
      for (const person of people) {
        if (
          !wants(
            preferences.find((one) => one.userId === person.id)?.preferences,
            alert.typeCode,
          )
        )
          continue;
        await tx.userNotification.create({
          data: {
            recipientUserId: person.id,
            typeCode: alert.typeCode,
            titleSafe: alert.title.slice(0, 200),
            bodySafe: alert.body.slice(0, 500),
            resourceTypeCode: alert.resourceTypeCode,
            resourceId: alert.resourceId,
          },
        });
        count += 1;
      }
      await tx.alertLog.create({
        data: {
          alertKey: alert.key,
          typeCode: alert.typeCode,
          resourceTypeCode: alert.resourceTypeCode,
          resourceId: alert.resourceId,
          recipients: count,
        },
      });
      delivered += count;
    });
  }
  return delivered;
}
