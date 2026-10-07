import { Prisma, type TransactionClient } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  addDays,
  isoDate,
  planInstallments,
  splitByWeights,
} from "./receivable-plan.js";

/**
 * Keeps an order's installments in step with the order, inside the order's
 * own transaction: written at confirmation, dated at hand-over, re-split when
 * an amendment changes the total, released when the order is cancelled.
 */

type OrderForPlan = {
  id: string;
  accountId: string;
  countryCode: string;
  currencyCode: string;
  totalAmount: Prisma.Decimal;
  paymentScheduleJsonb: Prisma.JsonValue | null;
};

export async function writePlan(
  tx: TransactionClient,
  order: OrderForPlan,
  confirmedAt: Date,
) {
  const existing = await tx.receivableInstallment.count({
    where: { customerOrderId: order.id },
  });
  if (existing > 0) return;
  const plan = planInstallments({
    schedule: order.paymentScheduleJsonb,
    total: order.totalAmount.toString(),
    confirmedOn: isoDate(confirmedAt),
  });
  await tx.receivableInstallment.createMany({
    data: plan.map((row) => ({
      customerOrderId: order.id,
      accountId: order.accountId,
      countryCode: order.countryCode,
      currencyCode: order.currencyCode,
      installmentNo: row.installmentNo,
      label: row.label,
      stageCode: row.stageCode,
      dueBasisCode: row.dueBasisCode,
      daysAfter: row.daysAfter,
      dueDate: row.dueDate === null ? null : new Date(row.dueDate),
      amount: new Prisma.Decimal(row.amount),
      methodCode: row.methodCode,
    })),
  });
}

/** "N days after delivery" starts counting the day the order is handed over. */
export async function dateFromHandover(
  tx: TransactionClient,
  orderId: string,
  handedOverAt: Date,
) {
  const rows = await tx.receivableInstallment.findMany({
    where: { customerOrderId: orderId, dueBasisCode: "AFTER_HANDOVER" },
  });
  const day = isoDate(handedOverAt);
  for (const row of rows) {
    await tx.receivableInstallment.update({
      where: { id: row.id },
      data: {
        dueDate: new Date(addDays(day, row.daysAfter ?? 0)),
        rowVersion: { increment: 1 },
      },
    });
  }
}

/**
 * An amendment that changes the total re-splits what is still owed. Once
 * money has been collected against the plan, the split is no longer the
 * order's to change -- finance has to settle the difference -- so that is
 * refused rather than quietly rewriting collected installments.
 */
export async function resplit(
  tx: TransactionClient,
  orderId: string,
  newTotal: string,
) {
  const rows = await tx.receivableInstallment.findMany({
    where: { customerOrderId: orderId },
    orderBy: { installmentNo: "asc" },
  });
  if (rows.length === 0) return;
  if (
    rows.some(
      (row) => !row.collectedAmount.isZero() || !row.writtenOffAmount.isZero(),
    )
  )
    throw new ApiProblem({
      status: 409,
      code: "RECEIVABLE_ALREADY_COLLECTED",
    });
  const amounts = splitByWeights(
    newTotal,
    rows.map((row) => Number(row.amount)),
  );
  for (const [index, row] of rows.entries()) {
    await tx.receivableInstallment.update({
      where: { id: row.id },
      data: {
        amount: new Prisma.Decimal(amounts[index] ?? "0"),
        rowVersion: { increment: 1 },
      },
    });
  }
}

/**
 * A cancelled order owes nothing more. What was already collected stays on
 * record against its installment -- a refund is finance's call, not this one.
 */
export async function releaseOnCancel(tx: TransactionClient, orderId: string) {
  await tx.receivableInstallment.updateMany({
    where: {
      customerOrderId: orderId,
      statusCode: { in: ["OPEN", "PARTIAL"] },
    },
    data: { statusCode: "CANCELLED", rowVersion: { increment: 1 } },
  });
}
