import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import type { components } from "@abp/api-client";
import { permissions } from "@abp/contracts";
import {
  AuditRepository,
  type DatabaseClient,
  Prisma,
  TransactionManager,
  type TransactionClient,
} from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { OutboxService } from "../platform/outbox.service.js";
import {
  auditRepositoryToken,
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import { accountAccessWhere } from "./account-scope.js";
import { CustomerAccessService } from "./customer-access.service.js";
import {
  canUseManagerContext,
  isSystemAdmin,
  type CustomerIdentity,
} from "./customer-auth.js";
import { classifyMarketScope } from "./market-scope.js";
import type {
  AccountListQuery,
  ArchiveAccountDto,
  CreateAccountDto,
  UpdateAccountDto,
  CreateCustomerShareDto,
  DuplicateCheckDto,
  CustomerShareListQuery,
  MergeAccountDto,
  MergePreviewDto,
  TransferOwnershipDto,
} from "./customer.dto.js";

type AccountDetail = components["schemas"]["AccountDetail"];
type AccountListItem = components["schemas"]["AccountListItem"];
type AccountListEnvelope = components["schemas"]["AccountListEnvelope"];
type CountryReference = components["schemas"]["CountryReference"];
type CustomerShareListEnvelope =
  components["schemas"]["CustomerShareListEnvelope"];

const accountDetailInclude = {
  country: true,
  hqCountry: true,
  groupMemberships: {
    include: { groupNetwork: true },
  },
  contacts: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
  },
  opportunities: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
  },
  quotations: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
  },
  activities: {
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: 100,
  },
  erpOrders: {
    orderBy: [{ importedAt: "desc" }, { id: "asc" }],
    take: 100,
  },
} satisfies Prisma.AccountInclude;

type AccountWithDetail = Prisma.AccountGetPayload<{
  include: typeof accountDetailInclude;
}>;

@Injectable()
export class CustomerService {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
    @Inject(transactionManagerToken)
    private readonly transactions: TransactionManager,
    @Inject(auditRepositoryToken) private readonly audit: AuditRepository,
    private readonly access: CustomerAccessService,
    private readonly outbox: OutboxService,
  ) {}

  async list(
    identity: CustomerIdentity,
    query: AccountListQuery,
  ): Promise<AccountListEnvelope> {
    this.access.requireView(identity);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.AccountWhereInput = {
      countryCode: { in: [...identity.countryCodes] },
      ...(query.archiveState === "ALL"
        ? {}
        : { recordStatusCode: query.archiveState }),
      ...(query.countryCode === undefined
        ? {}
        : { countryCode: query.countryCode }),
      ...(query.accountCategoryCode === undefined
        ? {}
        : { accountCategoryCode: query.accountCategoryCode }),
      ...(query.businessTypeCode === undefined
        ? {}
        : { businessTypeCode: query.businessTypeCode }),
      ...(query.search === undefined || query.search.trim() === ""
        ? {}
        : {
            OR: [
              { normalizedName: { contains: normalizeName(query.search) } },
              {
                accountRef: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                customerNumber: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
            ],
          }),
      AND: [{ OR: accountAccessWhere(identity, "VIEW") }],
    };
    const [total, records] = await this.database.$transaction([
      this.database.account.count({ where }),
      this.database.account.findMany({
        where,
        include: { country: true },
        orderBy: orderBy(query.sort),
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: records.map((record): AccountListItem => ({
        accountId: record.id,
        accountRef: record.accountRef,
        customerNumber: record.customerNumber,
        canonicalName: record.canonicalName,
        accountCategoryCode: record.accountCategoryCode,
        businessTypeCode: businessType(record.businessTypeCode),
        ownerUserId: record.ownerUserId,
        recordStatusCode: toRecordStatus(record.recordStatusCode),
        country: countryReference(record.country),
      })),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + records.length < total,
      },
    };
  }

  async get(
    identity: CustomerIdentity,
    accountId: string,
  ): Promise<AccountDetail> {
    this.access.requireView(identity);
    const account = await this.database.account.findFirst({
      where: this.viewableRecordWhere(identity, accountId),
      include: accountDetailInclude,
    });
    if (account === null) this.notFound();
    return this.toDetail(account);
  }

  /**
   * What this customer has actually bought, from the imported ERP history.
   *
   * Amounts are summed in EGP (`line_amount_egp`) because the source orders are
   * a mix of EGP and USD; adding the raw line amounts would produce a number in
   * no currency at all. Visibility reuses the same record scope as the account
   * itself — if you cannot see the customer, you cannot see its orders.
   */
  async commercialHistory(identity: CustomerIdentity, accountId: string) {
    this.access.requireView(identity);
    const account = await this.database.account.findFirst({
      where: this.viewableRecordWhere(identity, accountId),
      select: {
        id: true,
        relationshipTypeCode: true,
        businessTypeCode: true,
      },
    });
    if (account === null) this.notFound();

    const [summary] = await this.database.$queryRaw<
      {
        total_value: string;
        order_count: bigint;
        item_count: bigint;
        first_order_date: Date | null;
        last_order_date: Date | null;
      }[]
    >(Prisma.sql`
      SELECT COALESCE(SUM(l.line_amount_egp), 0)::text AS total_value,
             COUNT(DISTINCT o.erp_order_id) AS order_count,
             COUNT(l.erp_order_line_id)     AS item_count,
             MIN(o.order_date)              AS first_order_date,
             MAX(o.order_date)              AS last_order_date
      FROM erp_orders o
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      WHERE o.account_id = ${accountId}::uuid`);

    const markets = await this.database.$queryRaw<
      {
        country_code: string;
        country_name: string;
        value: string;
        order_count: bigint;
      }[]
    >(Prisma.sql`
      SELECT o.country_code, c.name AS country_name,
             COALESCE(SUM(l.line_amount_egp), 0)::text AS value,
             COUNT(DISTINCT o.erp_order_id) AS order_count
      FROM erp_orders o
      JOIN erp_order_lines l ON l.erp_order_id = o.erp_order_id
      JOIN countries c ON c.code = o.country_code
      WHERE o.account_id = ${accountId}::uuid
      GROUP BY o.country_code, c.name
      ORDER BY SUM(l.line_amount_egp) DESC NULLS LAST
      LIMIT 12`);

    // Only resolved, sellable items: a freight charge is not something the
    // customer "bought" in any sense a salesperson would act on.
    const products = await this.database.$queryRaw<
      {
        product_id: string;
        description: string;
        quantity: string;
        value: string;
        last_order_date: Date | null;
      }[]
    >(Prisma.sql`
      SELECT p.product_id, p.canonical_description AS description,
             COALESCE(SUM(l.qty_booked), 0)::text      AS quantity,
             COALESCE(SUM(l.line_amount_egp), 0)::text AS value,
             MAX(o.order_date)                         AS last_order_date
      FROM erp_order_lines l
      JOIN erp_orders o ON o.erp_order_id = l.erp_order_id
      JOIN products p ON p.product_id = l.product_id
      WHERE o.account_id = ${accountId}::uuid
        AND l.item_classification_code = 'SELLABLE_PRODUCT'
      GROUP BY p.product_id, p.canonical_description
      ORDER BY SUM(l.line_amount_egp) DESC NULLS LAST
      LIMIT 25`);

    const orders = await this.database.$queryRaw<
      {
        order_id: string;
        order_number: string | null;
        order_date: Date | null;
        status_code: string;
        currency_code: string | null;
        value: string;
        line_count: number;
        customer_po_number: string | null;
      }[]
    >(Prisma.sql`
      SELECT o.erp_order_id AS order_id, o.order_number_raw AS order_number,
             o.order_date, o.status_code, o.currency_code,
             COALESCE(o.total_amount_egp, 0)::text AS value,
             o.line_count, o.customer_po_number
      FROM erp_orders o
      WHERE o.account_id = ${accountId}::uuid
      ORDER BY o.order_date DESC NULLS LAST
      LIMIT 50`);

    const priceHistory = await this.database.$queryRaw<
      {
        quotation_id: string;
        quotation_ref: string;
        quotation_status_code: string;
        quoted_on: Date;
        line_no: number;
        description: string;
        material_class: string | null;
        unit_code: string;
        unit_price: string;
        price_per_kg: string | null;
        weight_per_piece_kg: string | null;
        board_width_mm: string | null;
        board_length_mm: string | null;
        thickness_mm: string | null;
        currency_code: string;
      }[]
    >(Prisma.sql`
      SELECT q.quotation_id,
             q.quotation_ref,
             q.status_code AS quotation_status_code,
             COALESCE(q.sent_at, q.updated_at)::date AS quoted_on,
             l.line_no,
             l.description,
             NULLIF(l.price_snapshot->>'materialClass', '') AS material_class,
             l.unit_code,
             l.unit_price::text,
             COALESCE(
               NULLIF(l.price_snapshot->>'appliedPricePerKg', ''),
               NULLIF(l.price_snapshot->'inputs'->>'pricePerKg', '')
             ) AS price_per_kg,
             NULLIF(l.price_snapshot->>'weightPerPieceKg', '') AS weight_per_piece_kg,
             NULLIF(l.price_snapshot->'inputs'->>'widthMm', '') AS board_width_mm,
             NULLIF(l.price_snapshot->'inputs'->>'lengthMm', '') AS board_length_mm,
             NULLIF(l.price_snapshot->'inputs'->>'thicknessMm', '') AS thickness_mm,
             COALESCE(q.currency_code, 'EGP') AS currency_code
      FROM quotations q
      JOIN quotation_lines l ON l.quotation_id = q.quotation_id
      WHERE q.account_id = ${accountId}::uuid
        AND q.status_code <> 'CANCELLED'
        AND l.unit_price > 0
      ORDER BY COALESCE(q.sent_at, q.updated_at) DESC, l.line_no ASC
      LIMIT 75`);

    const day = (value: Date | null) =>
      value === null ? "" : value.toISOString().slice(0, 10);

    return {
      data: {
        accountId,
        currencyCode: "EGP",
        relationshipTypeCode: account.relationshipTypeCode,
        businessTypeCode: businessType(account.businessTypeCode),
        totalValue: summary?.total_value ?? "0",
        orderCount: Number(summary?.order_count ?? 0),
        itemCount: Number(summary?.item_count ?? 0),
        firstOrderDate: day(summary?.first_order_date ?? null),
        lastOrderDate: day(summary?.last_order_date ?? null),
        markets: markets.map((row) => ({
          countryCode: row.country_code,
          countryName: row.country_name,
          value: row.value,
          orderCount: Number(row.order_count),
        })),
        products: products.map((row) => ({
          productId: row.product_id,
          description: row.description,
          quantity: row.quantity,
          value: row.value,
          lastOrderDate: day(row.last_order_date),
        })),
        orders: orders.map((row) => ({
          orderId: row.order_id,
          orderNumber: row.order_number ?? "",
          orderDate: day(row.order_date),
          statusCode: row.status_code,
          currencyCode: row.currency_code ?? "EGP",
          value: row.value,
          lineCount: row.line_count,
          customerPoNumber: row.customer_po_number ?? "",
        })),
        priceHistory: priceHistory.map((row) => ({
          quotationId: row.quotation_id,
          quotationRef: row.quotation_ref,
          quotationStatusCode: row.quotation_status_code,
          quotedOn: day(row.quoted_on),
          lineNo: row.line_no,
          description: row.description,
          materialClass: row.material_class,
          unitCode: row.unit_code,
          unitPrice: row.unit_price,
          pricePerKg: row.price_per_kg,
          weightPerPieceKg: row.weight_per_piece_kg,
          boardWidthMm: row.board_width_mm,
          boardLengthMm: row.board_length_mm,
          thicknessMm: row.thickness_mm,
          currencyCode: row.currency_code.trim(),
        })),
      },
      analyticsMetadata: {
        metricId: "account-commercial-history",
        metricVersion: "v1",
        asOf: new Date().toISOString(),
        source: "POSTGRESQL_SSOT",
        currency: "EGP",
        basis: "Imported ERP sales orders",
        scope: `account:${accountId}`,
      },
    };
  }

  async formworkMix(identity: CustomerIdentity) {
    this.access.requireView(identity);
    const visibleAccounts = await this.database.account.findMany({
      where: {
        countryCode: { in: [...identity.countryCodes] },
        recordStatusCode: "ACTIVE",
        AND: [{ OR: accountAccessWhere(identity, "VIEW") }],
      },
      select: { id: true },
    });
    const accountIds = visibleAccounts.map((account) => account.id);
    const now = new Date();
    const monthFrom = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );
    const monthTo = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1),
    );
    const yearFrom = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
    const yearTo = new Date(Date.UTC(now.getUTCFullYear() + 1, 0, 1));
    const empty = (from: Date, to: Date) => mixPeriod(from, to, 0, 0);
    if (accountIds.length === 0) {
      return {
        data: {
          targetPct: 70,
          month: empty(monthFrom, monthTo),
          year: empty(yearFrom, yearTo),
        },
        analyticsMetadata: mixMetadata(identity, now),
      };
    }
    const rows = await this.database.$queryRaw<
      {
        period_code: "MONTH" | "YEAR";
        formwork_customers: bigint;
        other_customers: bigint;
      }[]
    >(Prisma.sql`
      SELECT period_code,
             COUNT(DISTINCT o.account_id) FILTER (
               WHERE a.business_type_code = 'FORMWORK'
             ) AS formwork_customers,
             COUNT(DISTINCT o.account_id) FILTER (
               WHERE a.business_type_code <> 'FORMWORK'
             ) AS other_customers
      FROM (
        VALUES
          ('MONTH'::text, ${monthFrom}::date, ${monthTo}::date),
          ('YEAR'::text, ${yearFrom}::date, ${yearTo}::date)
      ) period(period_code, date_from, date_to)
      JOIN erp_orders o
        ON o.order_date >= period.date_from
       AND o.order_date < period.date_to
      JOIN accounts a ON a.account_id = o.account_id
      WHERE o.account_id IN (${Prisma.join(accountIds)})
        AND o.dq_status_code = 'VALID'
      GROUP BY period_code`);
    const byPeriod = new Map(rows.map((row) => [row.period_code, row]));
    const month = byPeriod.get("MONTH");
    const year = byPeriod.get("YEAR");
    return {
      data: {
        targetPct: 70,
        month: mixPeriod(
          monthFrom,
          monthTo,
          Number(month?.formwork_customers ?? 0),
          Number(month?.other_customers ?? 0),
        ),
        year: mixPeriod(
          yearFrom,
          yearTo,
          Number(year?.formwork_customers ?? 0),
          Number(year?.other_customers ?? 0),
        ),
      },
      analyticsMetadata: mixMetadata(identity, now),
    };
  }

  async create(
    identity: CustomerIdentity,
    input: CreateAccountDto,
    idempotencyKey: string,
  ): Promise<AccountDetail> {
    this.access.requireCountry(identity, input.countryCode);
    this.access.requirePermission(identity, permissions.accountsCreate);
    requireIdempotencyKey(idempotencyKey);
    const requestHash = hashJson(input);
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_CREATE",
          idempotencyKey,
        },
      },
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) this.idempotencyConflict();
      return this.get(identity, existing.responseResourceId);
    }

    return this.transactions.run(identity, async (tx) => {
      await requireCountry(tx, input.countryCode);
      const account = await tx.account.create({
        data: {
          canonicalName: input.canonicalName.trim(),
          normalizedName: normalizeName(input.canonicalName),
          countryCode: input.countryCode,
          accountCategoryCode: input.accountCategoryCode ?? null,
          businessTypeCode: input.businessTypeCode ?? "OTHER",
          ownerUserId: identity.userId,
          createdByUserId: identity.userId,
          updatedByUserId: identity.userId,
        },
        include: accountDetailInclude,
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_CREATE",
          idempotencyKey,
          requestHash,
          responseResourceId: account.id,
        },
      });
      const detail = this.toDetail(account);
      await this.appendAudit(
        tx,
        identity,
        "ACCOUNT_CREATED",
        account,
        null,
        detail,
      );
      return detail;
    });
  }

  async update(
    identity: CustomerIdentity,
    accountId: string,
    expectedTag: string,
    input: UpdateAccountDto,
  ): Promise<AccountDetail> {
    this.access.requirePermission(identity, permissions.accountsEdit);
    const expectedVersion = parseRowVersion(expectedTag);
    const before = await this.database.account.findFirst({
      where: this.editableRecordWhere(identity, accountId),
      include: accountDetailInclude,
    });
    if (before === null) this.notFound();
    this.access.requireCountry(identity, before.countryCode.trim());
    if (before.recordStatusCode === "ARCHIVED") {
      throw new ApiProblem({ status: 422, code: "ACCOUNT_ARCHIVED" });
    }
    if (input.hqCountryCode !== undefined && input.hqCountryCode !== null) {
      this.access.requireCountry(identity, input.hqCountryCode);
    }

    const outcome = await this.transactions.run(identity, async (tx) => {
      if (input.hqCountryCode !== undefined && input.hqCountryCode !== null) {
        await requireCountry(tx, input.hqCountryCode);
      }
      const result = await tx.account.updateMany({
        where: { id: accountId, rowVersion: expectedVersion },
        data: {
          ...(input.canonicalName == null
            ? {}
            : {
                canonicalName: input.canonicalName.trim(),
                normalizedName: normalizeName(input.canonicalName),
              }),
          ...(input.accountCategoryCode === undefined
            ? {}
            : { accountCategoryCode: input.accountCategoryCode }),
          ...(input.businessTypeCode === undefined
            ? {}
            : { businessTypeCode: input.businessTypeCode }),
          // Trimmed, and an emptied box clears the column rather than
          // storing a space: a blank line on a customs document is better
          // than a whitespace one that looks filled in.
          ...(input.address === undefined
            ? {}
            : { address: blankToNull(input.address) }),
          ...(input.taxNumber === undefined
            ? {}
            : { taxNumber: blankToNull(input.taxNumber) }),
          ...(input.defaultCurrencyCode === undefined
            ? {}
            : { defaultCurrencyCode: input.defaultCurrencyCode }),
          ...(input.hqCountryCode === undefined
            ? {}
            : { hqCountryCode: input.hqCountryCode }),
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await tx.account.findUnique({
          where: { id: accountId },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      const updated = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        include: accountDetailInclude,
      });
      const detail = this.toDetail(updated);
      await this.appendAudit(
        tx,
        identity,
        "ACCOUNT_UPDATED",
        updated,
        this.toDetail(before),
        detail,
      );
      return { detail } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(accountId, expectedTag, outcome.conflictVersion);
    }
    return outcome.detail;
  }

  async archive(
    identity: CustomerIdentity,
    accountId: string,
    expectedTag: string,
    input: ArchiveAccountDto,
    idempotencyKey: string,
  ): Promise<AccountDetail> {
    this.access.requirePermission(identity, permissions.accountsArchive);
    requireIdempotencyKey(idempotencyKey);
    const expectedVersion = parseRowVersion(expectedTag);
    const requestHash = hashJson({
      accountId,
      expectedTag,
      reason: input.reason,
    });
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_ARCHIVE",
          idempotencyKey,
        },
      },
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) this.idempotencyConflict();
      return this.get(identity, existing.responseResourceId);
    }
    const before = await this.database.account.findFirst({
      where: {
        id: accountId,
        ownerUserId: identity.userId,
        countryCode: { in: [...identity.countryCodes] },
      },
      include: accountDetailInclude,
    });
    if (before === null) this.notFound();
    this.access.requireCountry(identity, before.countryCode.trim());

    const outcome = await this.transactions.run(identity, async (tx) => {
      const result = await tx.account.updateMany({
        where: {
          id: accountId,
          rowVersion: expectedVersion,
          recordStatusCode: "ACTIVE",
        },
        data: {
          recordStatusCode: "ARCHIVED",
          archivedAt: new Date(),
          archivedByUserId: identity.userId,
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (result.count !== 1) {
        const current = await tx.account.findUnique({
          where: { id: accountId },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      const updated = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        include: accountDetailInclude,
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_ARCHIVE",
          idempotencyKey,
          requestHash,
          responseResourceId: updated.id,
        },
      });
      const detail = this.toDetail(updated);
      await this.appendAudit(
        tx,
        identity,
        "ACCOUNT_ARCHIVED",
        updated,
        this.toDetail(before),
        detail,
        input.reason,
      );
      return { detail } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(accountId, expectedTag, outcome.conflictVersion);
    }
    return outcome.detail;
  }

  async countries(): Promise<readonly CountryReference[]> {
    const countries = await this.database.country.findMany({
      where: { active: true },
      orderBy: { name: "asc" },
    });
    return countries.map(countryReference);
  }

  async duplicateCheck(identity: CustomerIdentity, input: DuplicateCheckDto) {
    this.access.requirePermission(identity, permissions.accountsCreate);
    const signals = [
      input.companyName,
      input.phone,
      input.email,
      input.customerNumber,
    ]
      .filter(
        (value): value is string =>
          value !== undefined && value !== null && value.trim() !== "",
      )
      .map((value) => value.trim());
    if (signals.length === 0) {
      throw new ApiProblem({ status: 422, code: "DUPLICATE_SIGNAL_REQUIRED" });
    }
    const conditions: Prisma.AccountWhereInput[] = [];
    if (input.companyName?.trim()) {
      conditions.push({ normalizedName: normalizeName(input.companyName) });
    }
    if (input.customerNumber?.trim()) {
      conditions.push({ customerNumber: input.customerNumber.trim() });
    }
    const channels = [input.phone, input.email]
      .filter(
        (value): value is string =>
          value !== undefined && value !== null && value.trim() !== "",
      )
      .map((value) => normalizeDuplicateChannel(value));
    if (channels.length > 0) {
      conditions.push({
        contacts: {
          some: { channels: { some: { normalizedValue: { in: channels } } } },
        },
      });
    }
    if (conditions.length === 0) {
      throw new ApiProblem({
        status: 422,
        code: "UNSUPPORTED_DUPLICATE_SIGNAL",
      });
    }
    const scopedWhere: Prisma.AccountWhereInput = {
      countryCode: { in: [...identity.countryCodes] },
      OR: conditions,
    };
    const [scopedMatches, accessibleMatches] = await this.database.$transaction(
      [
        this.database.account.findMany({
          where: scopedWhere,
          select: { id: true },
        }),
        this.database.account.findMany({
          where: {
            ...scopedWhere,
            AND: [{ OR: accountAccessWhere(identity, "VIEW") }],
          },
          select: { id: true, accountRef: true, canonicalName: true },
          take: 25,
        }),
      ],
    );
    return {
      data: {
        potentialDuplicate: scopedMatches.length > 0,
        action: scopedMatches.length > 0 ? "REQUEST_REVIEW" : "CONTINUE",
        accessibleMatches: accessibleMatches.map((account) => ({
          accountId: account.id,
          accountRef: account.accountRef,
          canonicalName: account.canonicalName,
        })),
      },
    };
  }

  async mergePreview(
    identity: CustomerIdentity,
    masterAccountId: string,
    input: MergePreviewDto,
  ) {
    this.requireMergeApprover(identity);
    const [master, source] = await Promise.all([
      this.database.account.findFirst({
        where: this.shareableRecordWhere(identity, masterAccountId),
        include: accountDetailInclude,
      }),
      this.database.account.findFirst({
        where: this.shareableRecordWhere(identity, input.sourceAccountId),
        include: accountDetailInclude,
      }),
    ]);
    if (master === null || source === null) this.notFound();
    if (master.id === source.id) {
      throw new ApiProblem({ status: 422, code: "MERGE_SOURCE_EQUALS_MASTER" });
    }
    const [contacts, projects, opportunities] =
      await this.database.$transaction([
        this.database.contact.count({ where: { accountId: source.id } }),
        this.database.projectParty.count({ where: { accountId: source.id } }),
        this.database.opportunity.count({ where: { accountId: source.id } }),
      ]);
    return {
      data: {
        masterAccountId: master.id,
        sourceAccountId: source.id,
        fieldConflicts: mergeConflicts(master, source),
        relationCounts: { contacts, projects, opportunities, quotations: 0 },
        blockingIssues: [
          ...(master.countryCode !== source.countryCode
            ? ["COUNTRY_MISMATCH"]
            : []),
          ...(master.recordStatusCode !== "ACTIVE" ||
          source.recordStatusCode !== "ACTIVE"
            ? ["ARCHIVED_ACCOUNT"]
            : []),
          ...(projects > 0
            ? ["PROJECT_PARTIES_REQUIRE_SEPARATE_GOVERNED_REASSIGNMENT"]
            : []),
        ],
      },
    };
  }

  async merge(
    identity: CustomerIdentity,
    masterAccountId: string,
    input: MergeAccountDto,
    idempotencyKey: string,
  ): Promise<AccountDetail> {
    this.requireMergeApprover(identity);
    requireIdempotencyKey(idempotencyKey);
    const masterVersion = parseRowVersion(input.masterExpectedRowVersion);
    const sourceVersion = parseRowVersion(input.sourceExpectedRowVersion);
    const requestHash = hashJson({
      masterAccountId,
      ...mergeRequestValue(input),
    });
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_MERGE",
          idempotencyKey,
        },
      },
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) this.idempotencyConflict();
      return this.get(identity, existing.responseResourceId);
    }
    const preview = await this.mergePreview(identity, masterAccountId, input);
    if (preview.data.blockingIssues.length > 0) {
      throw new ApiProblem({
        status: 422,
        code: "MERGE_BLOCKED",
        fieldErrors: preview.data.blockingIssues.map((code) => ({
          field: "sourceAccountId",
          code,
          messageKey: "errors.merge.blocked",
          params: {},
        })),
      });
    }
    const [masterBefore, sourceBefore] = await Promise.all([
      this.database.account.findFirst({
        where: this.shareableRecordWhere(identity, masterAccountId),
        include: accountDetailInclude,
      }),
      this.database.account.findFirst({
        where: this.shareableRecordWhere(identity, input.sourceAccountId),
        include: accountDetailInclude,
      }),
    ]);
    if (masterBefore === null || sourceBefore === null) this.notFound();
    return this.transactions.run(identity, async (tx) => {
      const masterChanged = await tx.account.updateMany({
        where: {
          id: masterBefore.id,
          rowVersion: masterVersion,
          recordStatusCode: "ACTIVE",
        },
        data: {
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      const sourceChanged = await tx.account.updateMany({
        where: {
          id: sourceBefore.id,
          rowVersion: sourceVersion,
          recordStatusCode: "ACTIVE",
        },
        data: {
          recordStatusCode: "ARCHIVED",
          archivedAt: new Date(),
          archivedByUserId: identity.userId,
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (masterChanged.count !== 1 || sourceChanged.count !== 1) {
        const current = await tx.account.findUnique({
          where: {
            id: masterChanged.count === 1 ? sourceBefore.id : masterBefore.id,
          },
        });
        this.concurrency(
          current?.id ?? masterBefore.id,
          masterChanged.count === 1
            ? input.sourceExpectedRowVersion
            : input.masterExpectedRowVersion,
          current?.rowVersion,
        );
      }
      await Promise.all([
        tx.contact.updateMany({
          where: { accountId: sourceBefore.id },
          data: {
            accountId: masterBefore.id,
            updatedByUserId: identity.userId,
            rowVersion: { increment: 1 },
          },
        }),
        tx.opportunity.updateMany({
          where: { accountId: sourceBefore.id },
          data: {
            accountId: masterBefore.id,
            updatedByUserId: identity.userId,
            rowVersion: { increment: 1 },
          },
        }),
        tx.activity.updateMany({
          where: { accountId: sourceBefore.id },
          data: { accountId: masterBefore.id },
        }),
        tx.customerShare.updateMany({
          where: { accountId: sourceBefore.id },
          data: { accountId: masterBefore.id, rowVersion: { increment: 1 } },
        }),
        tx.contactShare.updateMany({
          where: { accountId: sourceBefore.id },
          data: { accountId: masterBefore.id, rowVersion: { increment: 1 } },
        }),
      ]);
      const [masterAfter, sourceAfter] = await Promise.all([
        tx.account.findUniqueOrThrow({
          where: { id: masterBefore.id },
          include: accountDetailInclude,
        }),
        tx.account.findUniqueOrThrow({
          where: { id: sourceBefore.id },
          include: accountDetailInclude,
        }),
      ]);
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_MERGE",
          idempotencyKey,
          requestHash,
          responseResourceId: masterBefore.id,
        },
      });
      const detail = this.toDetail(masterAfter);
      await this.appendAudit(
        tx,
        identity,
        "ACCOUNT_MERGED_IN",
        masterAfter,
        this.toDetail(masterBefore),
        detail,
      );
      await this.appendAudit(
        tx,
        identity,
        "ACCOUNT_MERGED_ARCHIVED",
        sourceAfter,
        this.toDetail(sourceBefore),
        this.toDetail(sourceAfter),
      );
      await this.outbox.enqueue(tx, {
        eventType: "CUSTOMER_MERGED",
        aggregateType: "ACCOUNT",
        aggregateId: masterBefore.id,
        payload: {
          masterAccountId: masterBefore.id,
          sourceAccountId: sourceBefore.id,
          approvedByUserId: identity.userId,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey,
      });
      return detail;
    });
  }

  async transferOwnership(
    identity: CustomerIdentity,
    accountId: string,
    input: TransferOwnershipDto,
    idempotencyKey: string,
  ): Promise<AccountDetail> {
    this.access.requirePermission(identity, permissions.accountsTransfer);
    requireIdempotencyKey(idempotencyKey);
    const expectedVersion = parseRowVersion(input.expectedRowVersion);
    const requestHash = hashJson({
      accountId,
      targetUserId: input.targetUserId,
      expectedRowVersion: input.expectedRowVersion,
    });
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_TRANSFER_OWNERSHIP",
          idempotencyKey,
        },
      },
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) this.idempotencyConflict();
      return this.get(identity, existing.responseResourceId);
    }
    const before = await this.database.account.findFirst({
      where: this.shareableRecordWhere(identity, accountId),
      include: accountDetailInclude,
    });
    if (before === null) this.notFound();
    if (before.recordStatusCode !== "ACTIVE") {
      throw new ApiProblem({ status: 422, code: "ACCOUNT_ARCHIVED" });
    }
    const target = await this.database.appUser.findFirst({
      where: {
        id: input.targetUserId,
        active: true,
        authStatusCode: "ACTIVE",
        countries: {
          some: {
            countryCode: before.countryCode,
            statusCode: "ACTIVE",
            validFrom: { lte: new Date() },
            OR: [{ validTo: null }, { validTo: { gt: new Date() } }],
          },
        },
      },
    });
    if (target === null) {
      throw new ApiProblem({
        status: 422,
        code: "TRANSFER_TARGET_COUNTRY_SCOPE_REQUIRED",
      });
    }
    const outcome = await this.transactions.run(identity, async (tx) => {
      const changed = await tx.account.updateMany({
        where: {
          id: accountId,
          rowVersion: expectedVersion,
          recordStatusCode: "ACTIVE",
        },
        data: {
          ownerUserId: target.id,
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1) {
        const current = await tx.account.findUnique({
          where: { id: accountId },
        });
        return { conflictVersion: current?.rowVersion } as const;
      }
      const updated = await tx.account.findUniqueOrThrow({
        where: { id: accountId },
        include: accountDetailInclude,
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "ACCOUNT_TRANSFER_OWNERSHIP",
          idempotencyKey,
          requestHash,
          responseResourceId: accountId,
        },
      });
      const detail = this.toDetail(updated);
      await this.appendAudit(
        tx,
        identity,
        "ACCOUNT_OWNERSHIP_TRANSFERRED",
        updated,
        this.toDetail(before),
        detail,
      );
      await this.outbox.enqueue(tx, {
        eventType: "CUSTOMER_OWNERSHIP_TRANSFERRED",
        aggregateType: "ACCOUNT",
        aggregateId: accountId,
        payload: {
          accountId,
          previousOwnerUserId: before.ownerUserId,
          targetUserId: target.id,
          notificationOnly: true,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey,
      });
      return { detail } as const;
    });
    if ("conflictVersion" in outcome) {
      this.concurrency(
        accountId,
        input.expectedRowVersion,
        outcome.conflictVersion,
      );
    }
    return outcome.detail;
  }

  async listShares(
    identity: CustomerIdentity,
    accountId: string,
    query: CustomerShareListQuery,
  ): Promise<CustomerShareListEnvelope> {
    this.access.requirePermission(identity, permissions.accountsShare);
    const account = await this.database.account.findFirst({
      where: this.shareableRecordWhere(identity, accountId),
    });
    if (account === null) this.notFound();
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.CustomerShareWhereInput = {
      accountId,
      ...(query.search === undefined || query.search.trim() === ""
        ? {}
        : {
            recipient: {
              emailNormalized: {
                contains: query.search.trim(),
                mode: "insensitive",
              },
            },
          }),
    };
    const [total, rows] = await this.database.$transaction([
      this.database.customerShare.count({ where }),
      this.database.customerShare.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: rows.map(customerShare),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  async createShare(
    identity: CustomerIdentity,
    accountId: string,
    input: CreateCustomerShareDto,
    idempotencyKey: string,
  ) {
    this.access.requirePermission(identity, permissions.accountsShare);
    requireIdempotencyKey(idempotencyKey);
    const account = await this.database.account.findFirst({
      where: this.shareableRecordWhere(identity, accountId),
    });
    if (account === null) this.notFound();
    this.access.requireCountry(identity, account.countryCode.trim());
    const recipient = await this.database.appUser.findFirst({
      where: {
        id: input.recipientUserId,
        active: true,
        countries: {
          some: { countryCode: account.countryCode, statusCode: "ACTIVE" },
        },
      },
    });
    if (recipient === null)
      throw new ApiProblem({
        status: 422,
        code: "RECIPIENT_COUNTRY_SCOPE_REQUIRED",
      });
    const requestHash = hashJson({ accountId, input });
    const old = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "CUSTOMER_SHARE_CREATE",
          idempotencyKey,
        },
      },
    });
    if (old !== null) {
      if (old.requestHash !== requestHash) this.idempotencyConflict();
      const found = await this.database.customerShare.findUniqueOrThrow({
        where: { id: old.responseResourceId },
      });
      return customerShare(found);
    }
    return this.transactions.run(identity, async (tx) => {
      const row = await tx.customerShare.create({
        data: {
          accountId,
          ownerUserIdSnapshot: account.ownerUserId,
          recipientUserId: input.recipientUserId,
          shareScopeCode: input.shareScopeCode,
          accessLevelCode: input.accessLevelCode,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          createdByUserId: identity.userId,
        },
      });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "CUSTOMER_SHARE_CREATE",
          idempotencyKey,
          requestHash,
          responseResourceId: row.id,
        },
      });
      const projection = customerShare(row);
      await this.appendShareAudit(
        tx,
        identity,
        "CUSTOMER_SHARE_CREATED",
        account.countryCode,
        row.id,
        null,
        projection,
      );
      return projection;
    });
  }

  async revokeShare(
    identity: CustomerIdentity,
    shareId: string,
    tag: string,
    key: string,
  ): Promise<{ rowVersion: string }> {
    this.access.requirePermission(identity, permissions.accountsShare);
    requireIdempotencyKey(key);
    const version = parseRowVersion(tag);
    const requestHash = hashJson({ shareId, tag });
    const existing = await this.database.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode: "CUSTOMER_SHARE_REVOKE",
          idempotencyKey: key,
        },
      },
    });
    if (existing !== null) {
      if (existing.requestHash !== requestHash) this.idempotencyConflict();
      const replay = await this.database.customerShare.findFirst({
        where: {
          id: existing.responseResourceId,
          account: this.shareableRecordWhere(identity, undefined),
        },
      });
      if (replay === null) this.notFound();
      return { rowVersion: formatRowVersion(replay.rowVersion) };
    }
    const before = await this.database.customerShare.findFirst({
      where: {
        id: shareId,
        account: {
          countryCode: { in: [...identity.countryCodes] },
          OR: [
            { ownerUserId: identity.userId },
            { owner: { profile: { is: { managerUserId: identity.userId } } } },
          ],
        },
      },
      include: { account: { select: { countryCode: true } } },
    });
    if (before === null) this.notFound();
    return this.transactions
      .run(identity, async (tx) => {
        const changed = await tx.customerShare.updateMany({
          where: { id: shareId, rowVersion: version, statusCode: "ACTIVE" },
          data: {
            statusCode: "REVOKED",
            revokedAt: new Date(),
            revokedByUserId: identity.userId,
            rowVersion: { increment: 1 },
          },
        });
        if (changed.count !== 1) {
          const current = await tx.customerShare.findUnique({
            where: { id: shareId },
          });
          return { conflictVersion: current?.rowVersion } as const;
        }
        const updated = await tx.customerShare.findUniqueOrThrow({
          where: { id: shareId },
        });
        await tx.commandIdempotency.create({
          data: {
            actorUserId: identity.userId,
            operationCode: "CUSTOMER_SHARE_REVOKE",
            idempotencyKey: key,
            requestHash,
            responseResourceId: shareId,
          },
        });
        const projection = customerShare(updated);
        await this.appendShareAudit(
          tx,
          identity,
          "CUSTOMER_SHARE_REVOKED",
          before.account.countryCode,
          shareId,
          customerShare(before),
          projection,
        );
        return { rowVersion: projection.rowVersion } as const;
      })
      .then((outcome) => {
        if ("conflictVersion" in outcome) {
          this.shareConcurrency(shareId, tag, outcome.conflictVersion);
        }
        return outcome;
      });
  }

  private shareableRecordWhere(
    identity: CustomerIdentity,
    accountId: string | undefined,
  ): Prisma.AccountWhereInput {
    const base = {
      ...(accountId === undefined ? {} : { id: accountId }),
      countryCode: { in: [...identity.countryCodes] },
    };
    if (isSystemAdmin(identity)) return base;
    return {
      ...base,
      OR: [
        { ownerUserId: identity.userId },
        ...(canUseManagerContext(identity)
          ? [
              {
                owner: { profile: { is: { managerUserId: identity.userId } } },
              },
            ]
          : []),
      ],
    };
  }

  private viewableRecordWhere(
    identity: CustomerIdentity,
    accountId: string,
  ): Prisma.AccountWhereInput {
    return {
      id: accountId,
      countryCode: { in: [...identity.countryCodes] },
      ...(isSystemAdmin(identity)
        ? {}
        : { OR: accountAccessWhere(identity, "VIEW") }),
    };
  }

  /**
   * Who may edit this customer record.
   *
   * This used to be a second, hand-written copy of a policy the file already
   * states, and the two disagreed: `accessContextWhere` grants edit access to
   * a system administrator, to the owner, to a manager whose report owns the
   * record, and to an active COLLABORATE_EDIT share -- and this listed only
   * the last two. So a manager could open a customer their own salesperson
   * owned, read it, press Edit, type an address, and get a 404 back; and an
   * administrator, whose job is to fix exactly that kind of data, could not
   * edit any record they did not personally own.
   *
   * `accountAccessWhere(identity, "COLLABORATE_EDIT")` is that policy, and its
   * COLLABORATE_EDIT branch had no caller at all until now -- it was written
   * for this and never wired up. The country restriction stays on top of it:
   * editing is bounded by the countries in scope whoever you are.
   */
  private editableRecordWhere(
    identity: CustomerIdentity,
    accountId: string,
  ): Prisma.AccountWhereInput {
    return {
      id: accountId,
      countryCode: { in: [...identity.countryCodes] },
      OR: accountAccessWhere(identity, "COLLABORATE_EDIT"),
    };
  }

  private toDetail(account: AccountWithDetail): AccountDetail {
    const now = Date.now();
    return {
      accountId: account.id,
      accountRef: account.accountRef,
      customerNumber: account.customerNumber,
      canonicalName: account.canonicalName,
      address: account.address,
      taxNumber: account.taxNumber,
      accountCategoryCode: account.accountCategoryCode,
      businessTypeCode: businessType(account.businessTypeCode),
      ownerUserId: account.ownerUserId,
      defaultCurrencyCode: account.defaultCurrencyCode?.trim() ?? null,
      recordStatusCode: toRecordStatus(account.recordStatusCode),
      archivedAt: account.archivedAt?.toISOString() ?? null,
      rowVersion: formatRowVersion(account.rowVersion),
      geography: {
        country: countryReference(account.country),
        continent: toContinent(account.country.continentCode),
        marketScope: classifyMarketScope(account.country.code),
      },
      hqCountry:
        account.hqCountry === null ? null : countryReference(account.hqCountry),
      effectiveGroupMemberships: account.groupMemberships
        .filter(
          ({ validFrom, validTo, groupNetwork }) =>
            groupNetwork.active &&
            (validFrom === null || validFrom.getTime() <= now) &&
            (validTo === null || validTo.getTime() >= now),
        )
        .map(({ id, validFrom, validTo, createdAt, groupNetwork }) => ({
          membershipId: id,
          groupNetworkId: groupNetwork.id,
          groupCode: groupNetwork.groupCode,
          groupName: groupNetwork.name,
          groupTypeCode: groupNetwork.groupTypeCode,
          effectiveFrom: validFrom?.toISOString().slice(0, 10) ?? null,
          effectiveTo: validTo?.toISOString().slice(0, 10) ?? null,
          // Ending a membership requires this exact value in `If-Match`, and
          // it was not published anywhere — so a membership could be read
          // here and never ended. The delete derives its own expectation the
          // same way, from the creation instant in whole seconds.
          rowVersion: formatRowVersion(
            BigInt(Math.floor(createdAt.getTime() / 1000)),
          ),
        })),
      contacts: account.contacts.map((contact) => ({
        contactId: contact.id,
        accountId: contact.accountId,
        displayName: contact.displayName,
        jobTitle: contact.jobTitle,
        statusCode: contact.statusCode,
        rowVersion: formatRowVersion(contact.rowVersion),
      })),
      opportunities: account.opportunities.map((opportunity) => ({
        opportunityId: opportunity.id,
        opportunityRef: opportunity.opportunityRef,
        title: opportunity.title,
        accountId: opportunity.accountId,
        projectId: opportunity.projectId,
        countryCode: opportunity.countryCode.trim(),
        ownerUserId: opportunity.ownerUserId,
        stageCode: opportunity.stageCode,
        probabilityPct: opportunity.probabilityPct?.toString() ?? null,
        probabilitySourceCode:
          opportunity.probabilitySourceCode === "MANUAL_OVERRIDE"
            ? "MANUAL_OVERRIDE"
            : "STAGE_DEFAULT",
        estimatedValue: opportunity.estimatedValue?.toString() ?? null,
        currencyCode: opportunity.currencyCode?.trim() ?? null,
        expectedCloseDate:
          opportunity.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
      })),
      quotations: account.quotations.map((quotation) => ({
        quotationId: quotation.id,
        quotationRef: quotation.quotationRef,
        opportunityId: quotation.opportunityId,
        accountId: quotation.accountId,
        statusCode: quotation.statusCode,
        commercialStateCode: quotation.commercialStateCode,
        currencyCode: quotation.currencyCode?.trim() ?? null,
        totalAmount: quotation.totalAmount.toString(),
        sentAt: quotation.sentAt?.toISOString() ?? null,
        rowVersion: formatRowVersion(quotation.rowVersion),
      })),
      activities: account.activities.map((activity) => ({
        activityId: activity.id,
        countryCode: activity.countryCode.trim(),
        ownerUserId: activity.ownerUserId,
        typeCode: activity.typeCode,
        subject: activity.subject,
        notes: activity.notes,
        occurredAt: activity.occurredAt?.toISOString() ?? null,
        scheduledAt: activity.scheduledAt?.toISOString() ?? null,
        dueAt: activity.dueAt?.toISOString() ?? null,
        taskStatusCode: activity.taskStatusCode,
        outcomeCode: activity.outcomeCode,
        completedAt: activity.completedAt?.toISOString() ?? null,
        rowVersion: formatRowVersion(activity.rowVersion),
      })),
      erpSyncStatus: erpSyncStatus(account.erpOrders),
    };
  }

  private async appendAudit(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    account: AccountWithDetail,
    before: AccountDetail | null,
    after: AccountDetail,
    reason?: string,
  ): Promise<void> {
    await this.audit.append(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType: "ACCOUNT",
      resourceId: account.id,
      workspace: "SALES",
      countryCode: account.countryCode.trim(),
      beforeSnapshot: before,
      afterSnapshot: after,
      metadata: reason === undefined ? null : { reason },
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "API",
    });
  }

  private requireMergeApprover(identity: CustomerIdentity): void {
    this.access.requirePermission(identity, permissions.accountsMerge);
    this.access.requirePermission(identity, permissions.accountsMergeApprove);
    if (!identity.roles.some(({ code }) => code === "SALES_MANAGER")) {
      this.access.forbid();
    }
  }

  private async appendShareAudit(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    countryCode: string,
    shareId: string,
    before: ReturnType<typeof customerShare> | null,
    after: ReturnType<typeof customerShare>,
  ): Promise<void> {
    await this.audit.append(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType: "CUSTOMER_SHARE",
      resourceId: shareId,
      workspace: "SALES",
      countryCode: countryCode.trim(),
      beforeSnapshot: before,
      afterSnapshot: after,
      metadata: null,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "API",
    });
  }

  private shareConcurrency(
    shareId: string,
    expected: string,
    current?: bigint,
  ): never {
    throw new ApiProblem({
      status: 412,
      code: "CONCURRENCY_CONFLICT",
      conflict: {
        currentRowVersion:
          current === undefined ? "rv-unknown" : formatRowVersion(current),
        expectedRowVersion: expected,
        resource: { resourceType: "CUSTOMER_SHARE", resourceId: shareId },
      },
    });
  }

  private concurrency(
    accountId: string,
    expected: string,
    current?: bigint,
  ): never {
    throw new ApiProblem({
      status: 412,
      code: "CONCURRENCY_CONFLICT",
      conflict: {
        currentRowVersion:
          current === undefined ? "rv-unknown" : formatRowVersion(current),
        expectedRowVersion: expected,
        resource: { resourceType: "ACCOUNT", resourceId: accountId },
      },
    });
  }

  private notFound(): never {
    throw new ApiProblem({ status: 404, code: "RESOURCE_NOT_FOUND" });
  }

  private idempotencyConflict(): never {
    throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
  }
}

function orderBy(sort: string): Prisma.AccountOrderByWithRelationInput[] {
  const [field, direction] = sort.split(":") as [string, "asc" | "desc"];
  return [{ [field]: direction }, { id: "asc" }];
}

/**
 * A box someone emptied means "there is nothing here", not "there is a space
 * here". A whitespace address on a customs document looks filled in and is
 * not, which is worse than a blank one.
 */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
function normalizeName(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("en");
}

function normalizeDuplicateChannel(value: string): string {
  const normalized = value.normalize("NFKC").trim();
  if (normalized.includes("@")) return normalized.toLocaleLowerCase("en");
  const leadingPlus = normalized.startsWith("+") ? "+" : "";
  return `${leadingPlus}${normalized.replace(/\D/g, "")}`;
}

function mergeRequestValue(input: MergeAccountDto) {
  return {
    sourceAccountId: input.sourceAccountId,
    masterExpectedRowVersion: input.masterExpectedRowVersion,
    sourceExpectedRowVersion: input.sourceExpectedRowVersion,
  };
}

function mergeConflicts(
  master: AccountWithDetail,
  source: AccountWithDetail,
): Array<{
  field: string;
  masterValue: string | null;
  sourceValue: string | null;
}> {
  const pairs = [
    ["canonicalName", master.canonicalName, source.canonicalName],
    ["customerNumber", master.customerNumber, source.customerNumber],
    [
      "defaultCurrencyCode",
      master.defaultCurrencyCode,
      source.defaultCurrencyCode,
    ],
    [
      "accountCategoryCode",
      master.accountCategoryCode,
      source.accountCategoryCode,
    ],
  ] as const;
  return pairs
    .filter(([, masterValue, sourceValue]) => masterValue !== sourceValue)
    .map(([field, masterValue, sourceValue]) => ({
      field,
      masterValue: masterValue?.trim() ?? null,
      sourceValue: sourceValue?.trim() ?? null,
    }));
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function formatRowVersion(value: bigint): string {
  return `"rv-${value.toString()}"`;
}

function erpSyncStatus(
  orders: AccountWithDetail["erpOrders"],
): AccountDetail["erpSyncStatus"] {
  const allowed = new Set([
    "NOT_REQUIRED",
    "PENDING_SYNC",
    "SYNCING",
    "SYNCED",
    "SYNC_FAILED",
  ]);
  const statuses = new Set(
    orders
      .map((order) => order.integrationStatusCode)
      .filter((status) => allowed.has(status)),
  );
  const [onlyStatus] = statuses;
  const latestSyncedAt = orders.reduce<Date | null>(
    (latest, order) =>
      order.interfacedAt !== null &&
      (latest === null || order.interfacedAt > latest)
        ? order.interfacedAt
        : latest,
    null,
  );
  return {
    statusCode:
      orders.length === 0
        ? "NOT_CONFIGURED"
        : statuses.size === 1 && onlyStatus !== undefined
          ? (onlyStatus as Exclude<
              AccountDetail["erpSyncStatus"]["statusCode"],
              "NOT_CONFIGURED" | "MIXED"
            >)
          : "MIXED",
    totalOrders: orders.length,
    pendingCount: orders.filter((order) =>
      ["PENDING_SYNC", "SYNCING"].includes(order.integrationStatusCode),
    ).length,
    syncedCount: orders.filter(
      (order) => order.integrationStatusCode === "SYNCED",
    ).length,
    failedCount: orders.filter(
      (order) => order.integrationStatusCode === "SYNC_FAILED",
    ).length,
    latestSyncedAt: latestSyncedAt?.toISOString() ?? null,
  };
}

function parseRowVersion(value: string): bigint {
  const match = /^"rv-([1-9][0-9]*)"$/.exec(value);
  if (match === null) {
    throw new ApiProblem({
      status: 400,
      code: "INVALID_IF_MATCH",
      fieldErrors: [
        {
          field: "If-Match",
          code: "INVALID_ROW_VERSION",
          messageKey: "errors.concurrency.invalid_row_version",
          params: {},
        },
      ],
    });
  }
  const version = match[1];
  if (version === undefined) throw new Error("ROW_VERSION_CAPTURE_MISSING");
  return BigInt(version);
}

function requireIdempotencyKey(value: string): void {
  if (value.length < 8 || value.length > 200) {
    throw new ApiProblem({ status: 400, code: "INVALID_IDEMPOTENCY_KEY" });
  }
}

async function requireCountry(
  tx: TransactionClient,
  code: string,
): Promise<void> {
  const country = await tx.country.findFirst({ where: { code, active: true } });
  if (country === null) {
    throw new ApiProblem({
      status: 422,
      code: "UNKNOWN_COUNTRY",
      fieldErrors: [
        {
          field: "countryCode",
          code: "UNKNOWN_COUNTRY",
          messageKey: "errors.country.unknown",
          params: { countryCode: code },
        },
      ],
    });
  }
}

function countryReference(country: {
  code: string;
  name: string;
  continentCode: string;
}): CountryReference {
  return {
    countryCode: country.code.trim(),
    displayName: country.name,
    continent: toContinent(country.continentCode),
    marketScope: classifyMarketScope(country.code),
  };
}

function toContinent(value: string): CountryReference["continent"] {
  const allowed = new Set([
    "AFRICA",
    "ASIA",
    "EUROPE",
    "NORTH_AMERICA",
    "SOUTH_AMERICA",
    "OCEANIA",
    // The importer parks an unresolvable country here instead of guessing one.
    // Rejecting it made the country reference endpoint - and every screen with
    // a country filter - fail outright the first time such a row existed.
    "UNKNOWN",
  ]);
  if (!allowed.has(value)) throw new Error("INVALID_CONTINENT_IN_DATABASE");
  return value as CountryReference["continent"];
}

function toRecordStatus(value: string): "ACTIVE" | "ARCHIVED" {
  if (value !== "ACTIVE" && value !== "ARCHIVED")
    throw new Error("INVALID_ACCOUNT_STATUS_IN_DATABASE");
  return value;
}

function businessType(value: string): "FORMWORK" | "OTHER" {
  if (value !== "FORMWORK" && value !== "OTHER")
    throw new Error("INVALID_ACCOUNT_BUSINESS_TYPE_IN_DATABASE");
  return value;
}

function mixPeriod(
  from: Date,
  toExclusive: Date,
  formworkCustomers: number,
  otherCustomers: number,
) {
  const totalCustomers = formworkCustomers + otherCustomers;
  const sharePct =
    totalCustomers === 0
      ? 0
      : Math.round((formworkCustomers / totalCustomers) * 1000) / 10;
  return {
    from: from.toISOString().slice(0, 10),
    to: new Date(toExclusive.getTime() - 1).toISOString().slice(0, 10),
    formworkCustomers,
    otherCustomers,
    totalCustomers,
    sharePct,
    gapPct: Math.round((sharePct - 70) * 10) / 10,
    statusCode:
      totalCustomers === 0
        ? ("NO_DATA" as const)
        : sharePct >= 70
          ? ("ON_TARGET" as const)
          : ("BELOW_TARGET" as const),
  };
}

function mixMetadata(identity: CustomerIdentity, asOf: Date) {
  return {
    metricId: "customer-formwork-mix",
    metricVersion: "v1",
    asOf: asOf.toISOString(),
    source: "POSTGRESQL_SSOT",
    currency: null,
    basis: "Distinct customers with valid ERP orders in the selected period",
    scope: `countries:${[...identity.countryCodes].join(",")}`,
  };
}

function customerShare(row: {
  id: string;
  accountId: string;
  recipientUserId: string;
  shareScopeCode: string;
  accessLevelCode: string;
  expiresAt: Date | null;
  statusCode: string;
  createdByUserId: string;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  rowVersion: bigint;
}) {
  return {
    customerShareId: row.id,
    accountId: row.accountId,
    recipientUserId: row.recipientUserId,
    shareScopeCode: row.shareScopeCode,
    accessLevelCode: row.accessLevelCode,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    statusCode: row.statusCode,
    createdByUserId: row.createdByUserId,
    revokedByUserId: row.revokedByUserId,
    revokedAt: row.revokedAt?.toISOString() ?? null,
    rowVersion: formatRowVersion(row.rowVersion),
  };
}
