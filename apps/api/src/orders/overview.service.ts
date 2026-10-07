import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import type { DatabaseClient } from "@abp/database";
import {
  hasWorkspace,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { accountAccessWhere } from "../customer/account-scope.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import { addDays, isoDate, outstanding } from "./receivable-plan.js";
import { scheduleRisk } from "./work-order-flow.js";
import { satisfaction } from "../feedback/feedback-rules.js";

type Money = Record<string, number>;
const add = (bucket: Money, currency: string, amount: number) => {
  const code = currency.trim() || "—";
  if (!Number.isFinite(amount) || amount === 0) return;
  bucket[code] = Math.round(((bucket[code] ?? 0) + amount) * 100) / 100;
};

/**
 * From order to cash, on one card: the question a managing director asks
 * every Monday -- what did we sell, is it being made, has it left, has it
 * been paid, and are the customers happy -- answered from the records each
 * department keeps, not from a separate report someone has to update.
 *
 * Each figure is counted only over what the caller may see, and only where
 * they hold the permission for that area; a missing permission leaves that
 * figure out rather than failing the whole card.
 */
@Injectable()
export class OverviewService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  async orderToCash(i: CustomerIdentity) {
    if (
      !hasWorkspace(i, "SALES") &&
      !hasWorkspace(i, "FINANCE") &&
      !hasWorkspace(i, "LOGISTICS")
    )
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
    const holds = (code: string) =>
      i.permissions.has(code) && !i.deniedPermissions.has(code);
    const countries = { in: [...i.countryCodes] };
    const scope = {
      countryCode: countries,
      account: { OR: accountAccessWhere(i, "VIEW") },
    };
    const now = new Date();
    const today = isoDate(now);
    const weekAhead = new Date(addDays(today, 7));

    const [orders, installments, work, shipments, complaints, feedback] =
      await Promise.all([
        holds(permissions.salesOrdersView)
          ? this.db.customerOrder.findMany({
              where: {
                ...scope,
                statusCode: { notIn: ["CLOSED", "CANCELLED"] },
              },
              select: {
                statusCode: true,
                currencyCode: true,
                totalAmount: true,
                requestedDeliveryDate: true,
              },
              take: 10_000,
            })
          : null,
        holds(permissions.paymentsView)
          ? this.db.receivableInstallment.findMany({
              where: { ...scope, statusCode: { in: ["OPEN", "PARTIAL"] } },
              select: {
                currencyCode: true,
                amount: true,
                collectedAmount: true,
                writtenOffAmount: true,
                dueDate: true,
              },
              take: 20_000,
            })
          : null,
        holds(permissions.workOrdersView)
          ? this.db.workOrder.findMany({
              where: {
                ...scope,
                statusCode: { notIn: ["COMPLETED", "CANCELLED"] },
              },
              select: {
                statusCode: true,
                plannedEndDate: true,
                order: { select: { requestedDeliveryDate: true } },
              },
              take: 5_000,
            })
          : null,
        holds(permissions.shipmentsView)
          ? this.db.shipment.findMany({
              where: {
                countryCode: countries,
                milestoneCode: { notIn: ["DELIVERED", "POD_RECEIVED"] },
                expectedDeliveryDate: { not: null },
              },
              select: { expectedDeliveryDate: true },
              take: 5_000,
            })
          : null,
        holds(permissions.complaintsView)
          ? this.db.complaint.findMany({
              where: { countryCode: countries, statusCode: { not: "CLOSED" } },
              select: { stageDueAt: true },
              take: 5_000,
            })
          : null,
        holds(permissions.feedbackView)
          ? this.db.customerFeedback.findMany({
              where: {
                createdAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
                OR: [{ countryCode: null }, { countryCode: countries }],
              },
              select: { rating: true, isCritical: true, statusCode: true },
              take: 20_000,
            })
          : null,
      ]);

    const stages: Record<string, number> = {};
    const openValue: Money = {};
    for (const order of orders ?? []) {
      stages[order.statusCode] = (stages[order.statusCode] ?? 0) + 1;
      if (order.statusCode !== "DRAFT")
        add(openValue, order.currencyCode, Number(order.totalAmount));
    }

    const owed: Money = {};
    const overdue: Money = {};
    let overdueCount = 0;
    for (const row of installments ?? []) {
      const left = Number(
        outstanding(
          row.amount.toString(),
          row.collectedAmount.toString(),
          row.writtenOffAmount.toString(),
        ),
      );
      add(owed, row.currencyCode, left);
      if (row.dueDate !== null && isoDate(row.dueDate) < today) {
        add(overdue, row.currencyCode, left);
        overdueCount += 1;
      }
    }

    let atRisk = 0;
    for (const row of work ?? []) {
      const risk = scheduleRisk({
        status: row.statusCode,
        plannedEnd: isoDate(row.plannedEndDate),
        requestedDelivery: row.order.requestedDeliveryDate
          ? isoDate(row.order.requestedDeliveryDate)
          : null,
        today,
      });
      if (risk === "LATE_FOR_CUSTOMER" || risk === "OVERDUE") atRisk += 1;
    }

    const dueThisWeek = (shipments ?? []).filter(
      (row) =>
        row.expectedDeliveryDate !== null &&
        row.expectedDeliveryDate <= weekAhead,
    );
    const lateDeliveries = dueThisWeek.filter(
      (row) =>
        row.expectedDeliveryDate !== null &&
        isoDate(row.expectedDeliveryDate) < today,
    ).length;

    const happiness = feedback
      ? satisfaction(feedback.map((row) => row.rating))
      : null;

    return {
      data: {
        asOf: today,
        orders: orders ? { stages, open: orders.length, openValue } : null,
        receivables: installments ? { owed, overdue, overdueCount } : null,
        production: work ? { active: work.length, atRisk } : null,
        deliveries: shipments
          ? {
              dueThisWeek: dueThisWeek.length - lateDeliveries,
              late: lateDeliveries,
            }
          : null,
        complaints: complaints
          ? {
              open: complaints.length,
              late: complaints.filter(
                (row) => row.stageDueAt !== null && row.stageDueAt < now,
              ).length,
            }
          : null,
        satisfaction:
          happiness && feedback
            ? {
                average: happiness.average,
                csatPct: happiness.csatPct,
                responses: happiness.responses,
                criticalOpen: feedback.filter(
                  (row) => row.isCritical && row.statusCode !== "CLOSED",
                ).length,
              }
            : null,
      },
    };
  }
}
