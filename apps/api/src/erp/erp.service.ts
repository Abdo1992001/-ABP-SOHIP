import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import { Prisma, type DatabaseClient, syncOrderToMockErp } from "@abp/database";
import {
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import type {
  SalesOrderLineListQuery,
  SalesOrderListQuery,
} from "./erp.dto.js";

@Injectable()
export class ErpService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    private readonly access: CustomerAccessService,
  ) {}

  /** Local integration seam used by the worker and integration tests. */
  async syncOrderToERP(orderId: string) {
    return syncOrderToMockErp(this.db, orderId);
  }

  async listOrders(identity: CustomerIdentity, query: SalesOrderListQuery) {
    this.access.requirePermission(identity, permissions.salesOrdersView);
    const accounts = await this.accessibleAccounts(identity);
    const accountIds = [...accounts.keys()];
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const term = query.search?.trim() ?? "";
    const where: Prisma.ERPOrderWhereInput = {
      accountId: {
        in: accountIds,
        ...(query.accountId ? { equals: query.accountId } : {}),
      },
      ...(query.statusCode ? { statusCode: query.statusCode } : {}),
      ...(query.countryCode ? { countryCode: query.countryCode } : {}),
      // EXTERNAL vs GROUP is the difference between "what the market bought"
      // and "what we moved between our own companies".
      ...(query.relationship
        ? { isIntercompany: query.relationship === "GROUP" }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            orderDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(term
        ? {
            // Searching orders means searching for an order number, a customer,
            // or a customer's own PO reference - those are the three things a
            // salesperson has in front of them when they go looking.
            OR: [
              { sourceOrderKey: { contains: term, mode: "insensitive" } },
              { orderNumberRaw: { contains: term, mode: "insensitive" } },
              { customerPoNumber: { contains: term, mode: "insensitive" } },
              { customerNameRaw: { contains: term, mode: "insensitive" } },
              { salesRep: { contains: term, mode: "insensitive" } },
              {
                account: {
                  canonicalName: { contains: term, mode: "insensitive" },
                },
              },
            ],
          }
        : {}),
    };
    const orderBy = sortOrders(query.sort);
    const [total, rows] = await this.db.$transaction([
      this.db.eRPOrder.count({ where }),
      this.db.eRPOrder.findMany({
        where,
        orderBy,
        skip: offset,
        take: query.limit,
        include: { account: { select: { canonicalName: true } } },
      }),
    ]);
    const shipped = rows.length
      ? await this.db.eRPOrderLine.groupBy({
          by: ["erpOrderId"],
          where: { erpOrderId: { in: rows.map((row) => row.id) } },
          _sum: { qtyShipped: true },
        })
      : [];
    const shippedByOrder = new Map(
      shipped.map((row) => [row.erpOrderId, row._sum.qtyShipped]),
    );
    return {
      data: rows.map((row) =>
        orderDto(
          row,
          accounts.get(row.accountId ?? "") ?? row.countryCode,
          shippedByOrder.get(row.id) ?? null,
        ),
      ),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  async getOrder(identity: CustomerIdentity, id: string) {
    this.access.requirePermission(identity, permissions.salesOrdersView);
    const accounts = await this.accessibleAccounts(identity);
    const row = await this.db.eRPOrder.findFirst({
      where: { id, accountId: { in: [...accounts.keys()] } },
      include: { account: { select: { canonicalName: true } } },
    });
    if (!row) missing("SALES_ORDER_NOT_FOUND");
    const shipped = await this.db.eRPOrderLine.aggregate({
      where: { erpOrderId: id },
      _sum: { qtyShipped: true },
    });
    return {
      data: orderDto(
        row,
        accounts.get(row.accountId ?? "") ?? row.countryCode,
        shipped._sum.qtyShipped,
      ),
    };
  }

  /**
   * The items on an order.
   *
   * Every line carries how it was matched and what it was classified as, because
   * "ACROW Board 18mm" and "Transportation" arrive in the same column and a
   * reader has to be able to tell which of the two they are looking at.
   */
  async listOrderLines(
    identity: CustomerIdentity,
    id: string,
    query: SalesOrderLineListQuery,
  ) {
    this.access.requirePermission(identity, permissions.salesOrdersView);
    const accounts = await this.accessibleAccounts(identity);
    const order = await this.db.eRPOrder.findFirst({
      where: { id, accountId: { in: [...accounts.keys()] } },
      select: { id: true },
    });
    if (!order) missing("SALES_ORDER_NOT_FOUND");
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const [total, rows] = await this.db.$transaction([
      this.db.eRPOrderLine.count({ where: { erpOrderId: id } }),
      this.db.eRPOrderLine.findMany({
        where: { erpOrderId: id },
        orderBy: [{ lineNo: "asc" }, { sourceLineKey: "asc" }],
        skip: offset,
        take: query.limit,
        include: { product: { select: { canonicalDescription: true } } },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        salesOrderLineId: row.id,
        lineNo: row.lineNo,
        orderedItem: row.orderedItemRaw,
        description: row.itemDescriptionRaw,
        productId: row.productId,
        productDescription: row.product?.canonicalDescription ?? null,
        matchStatusCode: row.matchStatusCode,
        itemClassificationCode: row.itemClassificationCode,
        uomCode: row.uomCode,
        qtyOrdered: row.qtyBooked.toString(),
        qtyShipped: row.qtyShipped.toString(),
        qtyRemaining: row.qtyRemaining?.toString() ?? null,
        unitSellingPrice: row.unitSellingPrice?.toString() ?? null,
        lineAmount: row.lineAmount?.toString() ?? null,
        lineAmountEgp: row.lineAmountEgp?.toString() ?? null,
        currencyCode: row.currencyCode?.trim() ?? null,
        lineStatusRaw: row.lineStatusRaw,
        bookedDate: row.bookedDate?.toISOString().slice(0, 10) ?? null,
        actualShipmentDate:
          row.actualShipmentDate?.toISOString().slice(0, 10) ?? null,
      })),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  async getOrderSource(identity: CustomerIdentity, id: string) {
    this.access.requirePermission(identity, permissions.importSourceView);
    const accounts = await this.accessibleAccounts(identity);
    const row = await this.db.eRPOrder.findFirst({
      where: { id, accountId: { in: [...accounts.keys()] } },
    });
    if (!row) missing("SALES_ORDER_NOT_FOUND");
    const sourceRow = row.importRowId
      ? await this.db.importRow.findUnique({ where: { id: row.importRowId } })
      : await this.db.importRow.findFirst({
          where: {
            importBatchId: row.importBatchId,
            sourceRowKey: row.sourceOrderKey,
          },
          orderBy: { id: "asc" },
        });
    const raw = sourceRow?.rawPayload;
    const rawObject =
      raw && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as Record<string, Prisma.JsonValue>)
        : {};
    return {
      data: {
        sourceSalesOrderId: row.sourceSalesOrderId,
        sourceSystemId: row.sourceSystemId,
        sourceOrderKey: row.sourceOrderKey,
        rawOrderNumber:
          stringField(rawObject, "orderNumber") ?? row.sourceOrderKey,
        rawCustomerNumber: stringField(rawObject, "customerNumber"),
        rawStatus: row.statusRaw ?? stringField(rawObject, "status"),
        rawPayloadJsonb: rawObject,
        importRowId: sourceRow?.id ?? row.importRowId,
      },
    };
  }

  private async accessibleAccounts(identity: CustomerIdentity) {
    const now = new Date();
    const scope = isSystemAdmin(identity)
      ? {}
      : {
          OR: [
            { ownerUserId: identity.userId },
            {
              shares: {
                some: {
                  recipientUserId: identity.userId,
                  statusCode: "ACTIVE",
                  accessLevelCode: { in: ["VIEW", "COLLABORATE_EDIT"] },
                  OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
                },
              },
            },
          ],
        };
    const rows = await this.db.account.findMany({
      where: {
        countryCode: { in: [...identity.countryCodes] },
        ...scope,
      },
      select: { id: true, countryCode: true },
    });
    return new Map(rows.map((row) => [row.id, row.countryCode.trim()]));
  }
}

/** Sorting a list of orders by anything other than "newest" has to be explicit. */
function sortOrders(
  sort: string | undefined,
): Prisma.ERPOrderOrderByWithRelationInput[] {
  const [field, direction] = (sort ?? "").split(":");
  const dir: Prisma.SortOrder = direction === "asc" ? "asc" : "desc";
  // Postgres sorts NULLs first on DESC, so the handful of orders with no booked
  // date would otherwise head a list titled "newest first". They go last.
  const nullsLast = { sort: dir, nulls: "last" } as const;
  switch (field) {
    case "orderDate":
      return [{ orderDate: nullsLast }, { id: "asc" }];
    case "totalAmount":
      return [{ totalAmountEgp: nullsLast }, { id: "asc" }];
    case "orderNumber":
      return [{ sourceOrderKey: dir }, { id: "asc" }];
    default:
      // Newest first. importedAt is identical across a whole batch, so ordering
      // by it leaves the list looking unsorted; the order date is what reads.
      return [{ orderDate: { sort: "desc", nulls: "last" } }, { id: "asc" }];
  }
}

type OrderRow = Prisma.ERPOrderGetPayload<{
  include: { account: { select: { canonicalName: true } } };
}>;
function orderDto(
  row: OrderRow,
  countryCode: string | null | undefined,
  shippedQty: Prisma.Decimal | null,
) {
  return {
    salesOrderId: row.id,
    accountName: row.account?.canonicalName ?? row.customerNameRaw ?? null,
    salesRep: row.salesRep,
    customerPoNumber: row.customerPoNumber,
    orderTypeRaw: row.orderTypeRaw,
    lineCount: row.lineCount,
    isIntercompany: row.isIntercompany,
    totalAmountEgp: row.totalAmountEgp?.toString() ?? null,
    sourceSalesOrderId: row.sourceSalesOrderId,
    sourceSystemId: row.sourceSystemId,
    orderNumber: row.sourceOrderKey,
    accountId: row.accountId,
    countryCode: countryCode?.trim() ?? null,
    orderDate: row.orderDate?.toISOString().slice(0, 10) ?? null,
    statusRaw: row.statusRaw,
    statusCode: row.statusCode,
    currencyCode: row.currencyCode?.trim() ?? null,
    totalAmount:
      row.totalAmount?.toString() ?? row.bookedAmount?.toString() ?? null,
    shippedQtySummary: shippedQty?.toString() ?? null,
    invoicedAmount: row.invoicedAmount?.toString() ?? null,
    sourceUpdatedAt: row.sourceUpdatedAt?.toISOString() ?? null,
    importedAt: row.importedAt.toISOString(),
  };
}
function stringField(value: Record<string, Prisma.JsonValue>, key: string) {
  const field = value[key];
  return typeof field === "string" ? field : null;
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
