import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  TransactionManager,
} from "@abp/database";
import {
  isSystemAdmin,
  type CustomerIdentity,
} from "../customer/customer-auth.js";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import { DurableJobsService } from "../platform/durable-jobs.service.js";
import { OutboxService } from "../platform/outbox.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  ApprovalDecisionDto,
  ApprovalListQuery,
  CreateAcceptanceDto,
  CreateQuotationDto,
  QuotationListQuery,
  SaveQuotationDraftDto,
  SupersedeQuotationDto,
  QuotationPreviewDto,
  RequestQuotationApprovalDto,
  SendQuotationDto,
  VersionedQuotationCommandDto,
} from "./quotation.dto.js";
import {
  boardsPerUnitFromExtension,
  computeEngineeringUnitPrice,
  computeWeightKg,
  pricedQuantity,
} from "./engineering-pricing.js";
import { computePaymentSchedule } from "./payment-schedule.js";
import { resolveAppliedRate } from "./pricing-hierarchy.js";
import { boardDescriptor } from "./board-descriptor.js";
import { checkQuotationLine } from "./quotation-validation.js";
import { reconcileQuotation } from "./quotation-reconciliation.js";
import { evaluateFormula, FormulaError } from "./formula-engine.js";
import { buildLineFormulaScope } from "./formula-scope.js";
import {
  parseQuotationDocument,
  reconcilesWithPrintedTotal,
} from "./quotation-pdf.js";
import {
  extractQuotationPdfText,
  QuotationPdfProblem,
} from "./quotation-pdf-text.js";
import { computeCircularColumnSchedule } from "./circular-column.js";
import {
  computeColumnPanelSchedule,
  MAX_ELEMENT_FACES,
  MAX_IRREGULAR_FACES,
} from "./column-faces.js";
import {
  canCopyQuotationStatus,
  copyClosesSource,
} from "./quotation-copy-policy.js";
import { mailStatus } from "../system/system.service.js";
const decimal = /^-?\d+(\.\d+)?$/;
@Injectable()
export class QuotationService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly access: CustomerAccessService,
    private readonly audit: AuditService,
    private readonly jobs: DurableJobsService,
    private readonly outbox: OutboxService,
  ) {}
  async list(identity: CustomerIdentity, query: QuotationListQuery) {
    this.access.requirePermission(identity, permissions.quotationsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.QuotationWhereInput = {
      ...(query.accountId ? { accountId: query.accountId } : {}),
      countryCode: { in: [...identity.countryCodes] },
      account: { OR: accountAccess(identity) },
      ...(query.search
        ? {
            OR: [
              {
                quotationRef: {
                  contains: query.search.trim(),
                  mode: "insensitive",
                },
              },
              {
                account: {
                  canonicalName: {
                    contains: query.search.trim(),
                    mode: "insensitive",
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.quotation.count({ where }),
      this.db.quotation.findMany({
        where,
        orderBy: quotationOrder(query.sort),
        skip: offset,
        take: query.limit,
      }),
    ]);
    // A quotation the customer accepted stays SENT -- acceptance is evidence
    // beside it, not a status -- so the list read "Sent" for quotations that
    // were already won and booked. The acceptance and the order travel with
    // each row so the list can say so.
    const ids = rows.map((row) => row.id);
    const [acceptances, orders] = await Promise.all([
      this.db.quotationAcceptance.findMany({
        where: { quotationId: { in: ids }, statusCode: "VALID" },
        select: { quotationId: true, acceptedAt: true },
      }),
      this.db.customerOrder.findMany({
        where: { quotationId: { in: ids } },
        select: { quotationId: true, id: true, orderRef: true },
      }),
    ]);
    const acceptedAt = new Map(
      acceptances.map((one) => [one.quotationId, one.acceptedAt]),
    );
    const orderOf = new Map(orders.map((one) => [one.quotationId, one]));
    return {
      data: rows.map((row) => ({
        ...toDto(row),
        acceptedAt: acceptedAt.get(row.id)?.toISOString() ?? null,
        customerOrderId: orderOf.get(row.id)?.id ?? null,
        orderRef: orderOf.get(row.id)?.orderRef ?? null,
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
  async get(identity: CustomerIdentity, id: string) {
    this.access.requirePermission(identity, permissions.quotationsView);
    const row = await this.db.quotation.findFirst({
      where: {
        id,
        countryCode: { in: [...identity.countryCodes] },
        account: { OR: accountAccess(identity) },
      },
      include: { owner: { select: { displayName: true } } },
    });
    if (!row) missing("QUOTATION_NOT_FOUND");
    const lines = await this.db.quotationLine.findMany({
      where: { quotationId: id },
      orderBy: { lineNo: "asc" },
    });
    const adjustments = await this.db.quotationAdjustment.findMany({
      where: { quotationId: id },
    });
    return {
      ...toDto(row),
      ownerDisplayName: row.owner.displayName,
      paymentTermsCode: row.paymentTermsCode,
      customPaymentTerms: row.customPaymentTerms,
      adjustments: adjustments.map((a) => ({
        typeCode: a.typeCode,
        modeCode: a.modeCode,
        value: a.value.toString(),
        label: a.label,
      })),
      lines: lines.map((line) => ({
        quotationLineId: line.id,
        productId: line.productId,
        sectionLabel: line.sectionLabel,
        description: line.description,
        qty: line.qty.toString(),
        unitCode: line.unitCode,
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        lineTotal: line.lineTotal.toString(),
        priceRuleId: line.priceRuleId,
        priceSnapshot: line.priceSnapshot,
      })),
    };
  }
  async chain(identity: CustomerIdentity, id: string) {
    await this.get(identity, id);
    const rows = await this.db.$queryRaw<
      Array<{
        id: string;
        quotation_ref: string;
        status_code: string;
        sent_at: Date | null;
        supersedes_quotation_id: string | null;
        created_at: Date;
      }>
    >(Prisma.sql`
      WITH RECURSIVE ancestors AS (
        SELECT quotation_id, quotation_ref, status_code, sent_at,
               supersedes_quotation_id, created_at
        FROM quotations WHERE quotation_id = ${id}::uuid
        UNION ALL
        SELECT q.quotation_id, q.quotation_ref, q.status_code, q.sent_at,
               q.supersedes_quotation_id, q.created_at
        FROM quotations q JOIN ancestors a
          ON q.quotation_id = a.supersedes_quotation_id
      ), descendants AS (
        SELECT quotation_id, quotation_ref, status_code, sent_at,
               supersedes_quotation_id, created_at
        FROM quotations WHERE supersedes_quotation_id = ${id}::uuid
        UNION ALL
        SELECT q.quotation_id, q.quotation_ref, q.status_code, q.sent_at,
               q.supersedes_quotation_id, q.created_at
        FROM quotations q JOIN descendants d
          ON q.supersedes_quotation_id = d.quotation_id
      )
      SELECT DISTINCT quotation_id AS id, quotation_ref, status_code, sent_at,
             supersedes_quotation_id, created_at
      FROM (SELECT * FROM ancestors UNION ALL SELECT * FROM descendants) chain
      ORDER BY created_at, quotation_id
    `);
    return {
      data: rows.map((row) => ({
        quotationId: row.id,
        quoteRef: row.quotation_ref,
        statusCode: row.status_code,
        sentAt: row.sent_at?.toISOString() ?? null,
        supersedesQuotationId: row.supersedes_quotation_id,
      })),
    };
  }
  /**
   * Read a past quotation PDF and hand back what it was read to contain.
   *
   * Nothing is written. This is deliberately a reading rather than an import:
   * the sample of 167 real quotations includes rows no arithmetic can resolve,
   * and the only safe thing to do with those is put them in front of a person
   * alongside the rows that did resolve. Accepting the reading is a separate,
   * ordinary create.
   *
   * It needs the right to create a quotation, because that is what a reading
   * is for, and it is the only permission the outcome could be used with.
   */
  async readPdf(identity: CustomerIdentity, file: Buffer) {
    this.access.requirePermission(identity, permissions.quotationsCreate);
    if (!Buffer.isBuffer(file) || file.length === 0)
      throw new ApiProblem({ status: 400, code: "QUOTATION_PDF_EMPTY" });
    let text: string;
    try {
      text = await extractQuotationPdfText(file);
    } catch (error) {
      throw new ApiProblem({
        status: 422,
        code:
          error instanceof QuotationPdfProblem ? error.code : "PDF_UNREADABLE",
      });
    }
    const reading = parseQuotationDocument(text);
    return {
      ...reading,
      reconciled: reconcilesWithPrintedTotal(reading),
    };
  }
  async create(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateQuotationDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsCreate);
    requireKey(key);
    // A draft may be empty. Creating the quotation is how you get somewhere to
    // put the lines: the wizard picks the customer and the deal and opens the
    // studio, and there is nothing to price until it does. Refusing here made
    // that flow impossible -- "Open the quotation" answered
    // QUOTATION_LINE_REQUIRED and no quotation could be started at all.
    //
    // Nothing is lost by allowing it. `readinessBlockers` raises the same code
    // where it belongs, at the point a quotation is approved or sent, so an
    // empty one still cannot reach a customer.
    return this.txs.run(identity, async (tx) => {
      const hash = hashOf(input);
      const replay = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: identity.userId,
            operationCode: "post_quotations",
            idempotencyKey: key,
          },
        },
      });
      if (replay) {
        if (replay.requestHash !== hash) conflict("IDEMPOTENCY_KEY_REUSED");
        const existing = await tx.quotation.findUnique({
          where: { id: replay.responseResourceId },
        });
        if (!existing) conflict("IDEMPOTENCY_REPLAY_MISSING");
        return toDto(existing);
      }
      const opportunity = await tx.opportunity.findFirst({
        where: {
          id: input.opportunityId,
          countryCode: { in: [...identity.countryCodes] },
          account: { OR: accountAccess(identity) },
        },
      });
      if (!opportunity) missing("OPPORTUNITY_NOT_FOUND");
      if (input.projectId) {
        const project = await tx.project.findFirst({
          where: { id: input.projectId, countryCode: opportunity.countryCode },
        });
        if (!project) missing("PROJECT_NOT_FOUND");
      }
      const row = await tx.quotation.create({
        data: {
          accountId: opportunity.accountId,
          opportunityId: opportunity.id,
          projectId: input.projectId ?? null,
          countryCode: opportunity.countryCode,
          ownerUserId: identity.userId,
          currencyCode: currency(input.currencyCode ?? "USD"),
          createdByUserId: identity.userId,
          updatedByUserId: identity.userId,
          validFrom: today(),
          expiresOn: plusDays(7),
        },
      });
      await this.record(tx, identity, "QUOTATION_CREATED", row);
      const saved = await this.saveDraftInTransaction(
        tx,
        identity,
        row.id,
        row.rowVersion,
        input.draft,
      );
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "post_quotations",
          idempotencyKey: key,
          requestHash: hash,
          responseResourceId: row.id,
        },
      });
      return saved;
    });
  }
  async saveDraft(
    identity: CustomerIdentity,
    id: string,
    tag: string,
    input: SaveQuotationDraftDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsEdit);
    const version = versionOf(tag);
    // Saving an empty draft is allowed for the same reason, and for one more:
    // deleting the last line and pressing save is an ordinary thing to do, and
    // refusing it trapped the editor in a state it could not save its way out
    // of. Readiness still blocks an empty quotation before it is sent.
    return this.txs.run(identity, (tx) =>
      this.saveDraftInTransaction(tx, identity, id, version, input),
    );
  }

  /**
   * The one authoritative quotation calculator/persister.
   *
   * Both initial creation and later edits pass through this exact function.
   * On creation it runs inside the same transaction that allocates the
   * quotation reference; any validation or pricing failure rolls everything
   * back, including the reference and audit rows.
   */
  private async saveDraftInTransaction(
    tx: TransactionClient,
    identity: CustomerIdentity,
    id: string,
    version: bigint,
    input: SaveQuotationDraftDto,
  ) {
    const quote = await tx.quotation.findFirst({
      where: {
        id,
        countryCode: { in: [...identity.countryCodes] },
        account: { OR: accountAccess(identity) },
      },
    });
    if (!quote) missing("QUOTATION_NOT_FOUND");
    if (quote.statusCode !== "DRAFT") rule("QUOTATION_NOT_DRAFT");
    if (quote.rowVersion !== version)
      throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
    if (quote.contentHash) {
      await tx.quotationApproval.updateMany({
        where: { quotationId: id, statusCode: "PENDING" },
        data: {
          statusCode: "INVALIDATED",
          invalidatedAt: new Date(),
          invalidationReasonCode: "MATERIAL_CONTENT_CHANGED",
        },
      });
    }
    // Resolve quotation-level overrides once, from THIS save's input (not
    // the pre-save row) so a line added in the same save prices against
    // the override the user just set, not a stale one.
    const resolvedStandardOverride =
      input.standardPricePerKgOverride !== undefined
        ? optionalDecimal(
            input.standardPricePerKgOverride,
            "standardPricePerKgOverride",
          )
        : quote.standardPricePerKgOverride;
    const resolvedCurvedOverride =
      input.curvedPricePerKgOverride !== undefined
        ? optionalDecimal(
            input.curvedPricePerKgOverride,
            "curvedPricePerKgOverride",
          )
        : quote.curvedPricePerKgOverride;
    // Circular work is sold as part of the curved family but carries its
    // own rate, so discounting curved work must not silently discount
    // circular work as well. It falls back to the curved override only
    // when nothing circular-specific has been set.
    const resolvedCircularOverride =
      input.circularPricePerKgOverride !== undefined
        ? optionalDecimal(
            input.circularPricePerKgOverride,
            "circularPricePerKgOverride",
          )
        : quote.circularPricePerKgOverride;
    const resolvedDensityOverride =
      input.densityOverrideKgM3 !== undefined
        ? optionalDecimal(input.densityOverrideKgM3, "densityOverrideKgM3")
        : quote.densityOverrideKgM3;
    // The studio sends an engineering line back with the price it was
    // quoted at, and a line sent with a price is otherwise treated as a
    // hand-priced one. Its engineering record is kept when nothing that
    // priced it has changed, so re-saving a quotation never turns a board or
    // a column into a manual line and never loses its weights.
    const storedLines = await tx.quotationLine.findMany({
      where: { quotationId: id },
      select: { id: true, unitPrice: true, priceSnapshot: true },
    });
    const storedById = new Map(storedLines.map((row) => [row.id, row]));
    const keptEngineering = (
      line: SaveQuotationDraftDto["lines"][number],
      qty: Prisma.Decimal,
    ): Prisma.InputJsonValue | null => {
      if (!line.materialClass || line.unitPrice == null) return null;
      if (!line.quotationLineId) return null;
      const stored = storedById.get(line.quotationLineId);
      if (!stored) return null;
      const snapshot = stored.priceSnapshot;
      if (
        snapshot === null ||
        typeof snapshot !== "object" ||
        Array.isArray(snapshot)
      )
        return null;
      const record = snapshot as Record<string, unknown>;
      if (record["source"] !== "ENGINEERING_CALC") return null;
      if (record["materialClass"] !== line.materialClass) return null;
      if (!stored.unitPrice.equals(number(line.unitPrice, "unitPrice")))
        return null;
      if (record["totalPieces"] === qty.toNumber())
        return record as Prisma.InputJsonValue;
      // A changed quantity keeps the per-piece weight and rescales the total.
      const perPiece =
        typeof record["weightPerPieceKg"] === "string"
          ? new Prisma.Decimal(record["weightPerPieceKg"])
          : null;
      return {
        ...record,
        totalPieces: qty.toNumber(),
        totalWeightKg: perPiece ? perPiece.mul(qty).toFixed(3) : null,
      };
    };
    const lines = await Promise.all(
      input.lines.map(async (line, index) => {
        const qty = number(line.qty, "qty");
        if (qty.lessThanOrEqualTo(0)) rule("QUANTITY_MUST_BE_POSITIVE");
        const product = line.productId
          ? await tx.product.findFirst({
              where: { id: line.productId, recordStatusCode: "ACTIVE" },
            })
          : null;
        if (line.productId && !product) missing("PRODUCT_NOT_FOUND");
        const now = new Date();
        const priceRule = product
          ? await tx.pricingRule.findFirst({
              where: {
                productId: product.id,
                currencyCode: quote.currencyCode ?? "USD",
                statusCode: "ACTIVE",
                effectiveFrom: { lte: now },
                OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
                AND: [
                  {
                    OR: [
                      { countryCode: quote.countryCode },
                      { countryCode: null },
                    ],
                  },
                ],
              },
              orderBy: [{ countryCode: "desc" }, { effectiveFrom: "desc" }],
            })
          : null;
        let engineeringSnapshot: Prisma.InputJsonValue | null = null;
        let engineeringUnitPrice: Prisma.Decimal | null = null;
        // Filled in by the ACROW BOARD branch below, then merged into the
        // snapshot once the priced quantity is known.
        let weightPerPieceKg: Prisma.Decimal | null = null;
        let scheduleWeightKg: Prisma.Decimal | null = null;
        /**
         * What a multi-size schedule is worth: each piece priced to the
         * piastre on its own weight, times its count, added up. The line
         * total is this figure exactly, not a rounded average multiplied
         * back -- see where it is used below.
         */
        let scheduleValue: Prisma.Decimal | null = null;
        let clientDescription: string | null = null;
        let formulaFailed = false;
        let appliedRate: Prisma.Decimal | null = null;
        let appliedDensity: Prisma.Decimal | null = null;
        let appliedThickness: Prisma.Decimal | null = null;
        let deliveredWidthMm: Prisma.Decimal | null = null;
        let deliveredLengthMm: Prisma.Decimal | null = null;
        if (line.pricingMethodCode && line.unitPrice == null) {
          const baseConfig = await tx.pricingBaseConfig.findFirst({
            where: {
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: [{ effectiveFrom: "desc" }],
          });
          if (!baseConfig) missing("PRICING_BASE_CONFIG_NOT_FOUND");
          const engInputs = {
            lengthMm: number(line.lengthMm ?? "", "lengthMm"),
            widthMm: number(line.widthMm ?? "", "widthMm"),
            thicknessMm:
              line.thicknessMm == null
                ? undefined
                : number(line.thicknessMm, "thicknessMm"),
            densityKgM3:
              line.densityKgM3 == null
                ? undefined
                : number(line.densityKgM3, "densityKgM3"),
            pricePerKg:
              line.pricePerKg == null
                ? undefined
                : number(line.pricePerKg, "pricePerKg"),
          };
          const computed = computeEngineeringUnitPrice(
            line.pricingMethodCode,
            engInputs,
            { standardBoardPrice: baseConfig.standardBoardPrice },
          );
          engineeringUnitPrice = computed.unitPrice;
          engineeringSnapshot = {
            source: "ENGINEERING_CALC",
            method: line.pricingMethodCode,
            inputs: {
              lengthMm: engInputs.lengthMm.toString(),
              widthMm: engInputs.widthMm.toString(),
              thicknessMm: engInputs.thicknessMm?.toString() ?? null,
              densityKgM3: engInputs.densityKgM3?.toString() ?? null,
              pricePerKg: engInputs.pricePerKg?.toString() ?? null,
            },
            breakdown: computed.breakdown,
          };
        }
        let circularSchedule: ReturnType<
          typeof computeCircularColumnSchedule
        > | null = null;
        let columnSchedule: ReturnType<
          typeof computeColumnPanelSchedule
        > | null = null;
        if (line.materialClass && line.unitPrice == null) {
          const baseConfig = await tx.pricingBaseConfig.findFirst({
            where: {
              effectiveFrom: { lte: now },
              OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
            },
            orderBy: [{ effectiveFrom: "desc" }],
          });
          if (!baseConfig) missing("PRICING_BASE_CONFIG_NOT_FOUND");
          const isStandardLike =
            line.materialClass === "STANDARD" ||
            line.materialClass === "REGULAR" ||
            line.materialClass === "CORE" ||
            line.materialClass === "WALL";
          const companyDefaultRate = isStandardLike
            ? (baseConfig.standardPricePerKg ?? new Prisma.Decimal("90"))
            : line.materialClass === "CURVED"
              ? (baseConfig.curvedPricePerKg ?? new Prisma.Decimal("120"))
              : (baseConfig.circularPricePerKg ?? new Prisma.Decimal("120"));
          const quotationOverride = isStandardLike
            ? resolvedStandardOverride
            : line.materialClass === "CIRCULAR"
              ? (resolvedCircularOverride ?? resolvedCurvedOverride)
              : line.materialClass === "CURVED"
                ? resolvedCurvedOverride
                : null;
          const itemOverride =
            line.pricePerKg == null
              ? null
              : number(line.pricePerKg, "pricePerKg");
          const applied = resolveAppliedRate(
            itemOverride,
            quotationOverride,
            companyDefaultRate,
          );
          const densityKgM3 =
            line.densityKgM3 != null
              ? number(line.densityKgM3, "densityKgM3")
              : (resolvedDensityOverride ??
                baseConfig.defaultDensityKgM3 ??
                new Prisma.Decimal("600"));
          const thicknessMm =
            line.thicknessMm != null
              ? number(line.thicknessMm, "thicknessMm")
              : (baseConfig.defaultThicknessMm ?? new Prisma.Decimal("18"));

          let lengthMm: Prisma.Decimal;
          let widthMm: Prisma.Decimal;
          let diameterForName: Prisma.Decimal | null = null;
          if (line.materialClass === "CIRCULAR") {
            const diameterMm =
              line.diameterMm == null
                ? undefined
                : number(line.diameterMm, "diameterMm");
            const radiusMm =
              line.radiusMm == null
                ? undefined
                : number(line.radiusMm, "radiusMm");
            if (diameterMm == null && radiusMm == null)
              rule("CIRCULAR_REQUIRES_DIAMETER_OR_RADIUS", "diameterMm");
            circularSchedule = computeCircularColumnSchedule({
              diameterMm,
              radiusMm,
              columnHeightMm: number(
                line.columnHeightMm ?? "",
                "columnHeightMm",
              ),
              mouldSegments: line.mouldSegments ?? undefined,
              arcModuleMm:
                line.arcModuleMm == null
                  ? undefined
                  : number(line.arcModuleMm, "arcModuleMm"),
              verticalCourseMm:
                line.verticalCourseMm == null
                  ? undefined
                  : number(line.verticalCourseMm, "verticalCourseMm"),
              columnQuantity: qty.toNumber(),
            });
            // What gets weighed and priced is the piece that leaves the
            // factory, not the mould module it was cut from: a 1200mm column
            // has a 1884.96mm working arc, which is ONE 1885mm piece. Pricing
            // the full 2440mm module instead overcharges it by 29%.
            const primary = circularSchedule.pieces[0];
            widthMm = primary?.widthMm ?? circularSchedule.arcModuleMm;
            lengthMm = primary?.heightMm ?? circularSchedule.verticalCourseMm;
            diameterForName = circularSchedule.diameterMm;
          } else if (
            line.materialClass === "REGULAR" ||
            // A core or a wall only goes through the face engine once its
            // faces have actually been entered. A line saved before the
            // engine existed still carries a plain panel size, and reopening
            // it must not start refusing to save.
            ((line.materialClass === "CORE" || line.materialClass === "WALL") &&
              (line.faceWidthsMm?.length ?? 0) > 0)
          ) {
            // A column of A x B is cut as A / B / A+closure / B+closure: the
            // two closing panels lap the thickness of their neighbours. The
            // height is then split into lifts. Both are the workbook's own
            // rules -- see column-faces.ts.
            // A core and a wall have no A/B rule to apply: their faces come
            // off the drawing, twenty of them if need be, which is the
            // workbook's own F01:F20 engine for both.
            const isElement =
              line.materialClass === "CORE" || line.materialClass === "WALL";
            const shape = isElement
              ? ("IRREGULAR" as const)
              : (line.columnShape ?? "RECTANGULAR");
            columnSchedule = computeColumnPanelSchedule({
              shape,
              sideAMm:
                line.sideAMm == null
                  ? null
                  : number(line.sideAMm, "sideAMm").toNumber(),
              sideBMm:
                line.sideBMm == null
                  ? null
                  : number(line.sideBMm, "sideBMm").toNumber(),
              faceWidthsMm: (line.faceWidthsMm ?? []).map((face, position) =>
                number(face, `faceWidthsMm[${String(position)}]`).toNumber(),
              ),
              columnHeightMm:
                line.columnHeightMm == null
                  ? (baseConfig.defaultColumnHeightMm?.toNumber() ?? undefined)
                  : number(line.columnHeightMm, "columnHeightMm").toNumber(),
              maxPanelWidthMm:
                line.maxPanelWidthMm == null
                  ? (baseConfig.maxPanelWidthMm?.toNumber() ?? undefined)
                  : number(line.maxPanelWidthMm, "maxPanelWidthMm").toNumber(),
              maxPanelLengthMm:
                line.maxPanelLengthMm == null
                  ? (baseConfig.maxPanelLengthMm?.toNumber() ?? undefined)
                  : number(
                      line.maxPanelLengthMm,
                      "maxPanelLengthMm",
                    ).toNumber(),
              closureAllowanceMm:
                baseConfig.columnClosureAllowanceMm?.toNumber() ?? undefined,
              maxFaces: isElement ? MAX_ELEMENT_FACES : MAX_IRREGULAR_FACES,
              curvedFaceNumbers: line.curvedFaceNumbers ?? undefined,
              expectedFaces: line.expectedFaces ?? undefined,
              quantity: qty.toNumber(),
            });
            if (columnSchedule.faceWidthsMm.length === 0)
              rule(
                shape === "RECTANGULAR"
                  ? "REGULAR_COLUMN_REQUIRES_SIDE_A_AND_B"
                  : "ELEMENT_REQUIRES_FACE_WIDTHS",
                shape === "RECTANGULAR" ? "sideAMm" : "faceWidthsMm",
              );
            const primaryPanel = columnSchedule.panels[0];
            widthMm = new Prisma.Decimal(primaryPanel?.widthMm ?? 0);
            lengthMm = new Prisma.Decimal(primaryPanel?.lengthMm ?? 0);
          } else {
            lengthMm = number(line.lengthMm ?? "", "lengthMm");
            widthMm = number(line.widthMm ?? "", "widthMm");
            if (line.diameterMm != null)
              diameterForName = number(line.diameterMm, "diameterMm");
          }
          const calculatedWeightKg = computeWeightKg({
            lengthMm,
            widthMm,
            thicknessMm,
            densityKgM3,
          });
          weightPerPieceKg = calculatedWeightKg;
          engineeringUnitPrice = calculatedWeightKg
            .mul(applied.value)
            .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
          // A column whose arc does not divide evenly delivers two cut sizes.
          // Each is weighed and priced on its own, and the line is worth their
          // sum. The unit price is that sum spread over the pieces, for
          // display; the line total is the sum itself.
          if (circularSchedule && circularSchedule.pieces.length > 1) {
            let value = new Prisma.Decimal(0);
            let weight = new Prisma.Decimal(0);
            for (const piece of circularSchedule.pieces) {
              const pieceWeight = computeWeightKg({
                lengthMm: piece.heightMm,
                widthMm: piece.widthMm,
                thicknessMm,
                densityKgM3,
              });
              weight = weight.plus(pieceWeight.mul(piece.totalCount));
              value = value.plus(
                pieceWeight
                  .mul(applied.value)
                  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                  .mul(piece.totalCount),
              );
            }
            scheduleWeightKg = weight;
            if (circularSchedule.totalPieces > 0) {
              weightPerPieceKg = weight.div(circularSchedule.totalPieces);
              scheduleValue = value;
              // Four places: the column holds four, and the average is only
              // shown -- the line total is `value` itself.
              engineeringUnitPrice = value
                .div(circularSchedule.totalPieces)
                .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
            }
          } else if (circularSchedule) {
            scheduleWeightKg = calculatedWeightKg.mul(
              circularSchedule.totalPieces,
            );
          }
          // A column rarely delivers one panel size: A, B, A+closure and
          // B+closure are up to three different widths, and the top lift may
          // be a remainder. Each is weighed and priced on its own, and the line
          // is worth their sum.
          //
          // It used to round the average to two places and multiply it back,
          // which is not the sum: four panel sizes worth 13,706.00 averaged
          // 856.625, rounded to 856.63, and came back as 13,706.08 -- eight
          // piastres more than the panels the customer's document lists.
          if (columnSchedule && columnSchedule.totalPanels > 0) {
            let value = new Prisma.Decimal(0);
            let weight = new Prisma.Decimal(0);
            // A curved face on a core is curved work, and it is charged as
            // curved work even though the rest of the element is flat.
            const curvedRate = resolveAppliedRate(
              itemOverride,
              resolvedCurvedOverride,
              baseConfig.curvedPricePerKg ?? new Prisma.Decimal("120"),
            ).value;
            for (const panel of columnSchedule.panels) {
              const panelWeight = computeWeightKg({
                lengthMm: new Prisma.Decimal(panel.lengthMm),
                widthMm: new Prisma.Decimal(panel.widthMm),
                thicknessMm,
                densityKgM3,
              });
              weight = weight.plus(panelWeight.mul(panel.totalCount));
              value = value.plus(
                panelWeight
                  .mul(panel.curved ? curvedRate : applied.value)
                  .toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP)
                  .mul(panel.totalCount),
              );
            }
            scheduleWeightKg = weight;
            weightPerPieceKg = weight.div(columnSchedule.totalPanels);
            scheduleValue = value;
            engineeringUnitPrice = value
              .div(columnSchedule.totalPanels)
              .toDecimalPlaces(4, Prisma.Decimal.ROUND_HALF_UP);
          }
          // The name the customer reads is generated, never typed: thickness
          // x width x length, then the family, then the diameter (spec SS16).
          clientDescription = boardDescriptor({
            materialClass: line.materialClass,
            thicknessMm: thicknessMm.toNumber(),
            widthMm: widthMm.toNumber(),
            lengthMm: lengthMm.toNumber(),
            diameterMm: diameterForName?.toNumber() ?? null,
            ...(circularSchedule && circularSchedule.pieces.length > 1
              ? { extraSizeCount: circularSchedule.pieces.length - 1 }
              : columnSchedule && columnSchedule.panels.length > 1
                ? { extraSizeCount: columnSchedule.panels.length - 1 }
                : {}),
          });
          appliedRate = applied.value;
          appliedDensity = densityKgM3;
          appliedThickness = thicknessMm;
          deliveredWidthMm = widthMm;
          deliveredLengthMm = lengthMm;
          engineeringSnapshot = {
            source: "ENGINEERING_CALC",
            method: "WEIGHT_BASED",
            materialClass: line.materialClass,
            category: line.category ?? null,
            reference: line.reference ?? null,
            cadMark: line.cadMark ?? null,
            priceSource: applied.source,
            appliedPricePerKg: applied.value.toString(),
            calculatedWeightKg: calculatedWeightKg.toFixed(3),
            inputs: {
              lengthMm: lengthMm.toString(),
              widthMm: widthMm.toString(),
              thicknessMm: thicknessMm.toString(),
              densityKgM3: densityKgM3.toString(),
            },
            // What this one line was given, as opposed to what it inherited.
            // The applied figures above cannot tell the two apart, so a line
            // with its own rate reopened on the company's and was saved back
            // at it -- a 90 EGP/kg line quietly repriced at 77.76.
            own: {
              pricePerKg: line.pricePerKg ?? null,
              densityKgM3: line.densityKgM3 ?? null,
            },
            ...(circularSchedule
              ? {
                  circular: {
                    columnQuantity: qty.toString(),
                    columnHeightMm: line.columnHeightMm ?? null,
                    mouldSegments: line.mouldSegments ?? null,
                    diameterMm: circularSchedule.diameterMm.toString(),
                    radiusMm: circularSchedule.radiusMm.toString(),
                    circumferenceMm:
                      circularSchedule.circumferenceMm.toFixed(2),
                    arcPieceCount: circularSchedule.arcPieceCount,
                    verticalCourseCount: circularSchedule.verticalCourseCount,
                    piecesPerColumn: circularSchedule.piecesPerColumn,
                    totalPieces: circularSchedule.totalPieces,
                    arcModuleMm: circularSchedule.arcModuleMm.toString(),
                    verticalCourseMm:
                      circularSchedule.verticalCourseMm.toString(),
                    pieces: circularSchedule.pieces.map((piece) => ({
                      widthMm: piece.widthMm.toString(),
                      heightMm: piece.heightMm.toString(),
                      countPerColumn: piece.countPerColumn,
                      totalCount: piece.totalCount,
                      fullModule: piece.fullModule,
                    })),
                  },
                }
              : {}),
            ...(columnSchedule
              ? {
                  column: {
                    shape: line.columnShape ?? "RECTANGULAR",
                    columnQuantity: qty.toString(),
                    // The inputs themselves, beside what they produced: a
                    // reopened line is rebuilt from these. Which faces were
                    // curved in particular cannot be read back from the
                    // panels, and without it a curved face would be repriced
                    // at the flat rate.
                    sideAMm: line.sideAMm ?? null,
                    sideBMm: line.sideBMm ?? null,
                    columnHeightMm: line.columnHeightMm ?? null,
                    curvedFaceNumbers: line.curvedFaceNumbers ?? [],
                    faceWidthsMm: columnSchedule.faceWidthsMm,
                    totalFaceWidthMm: columnSchedule.totalFaceWidthMm,
                    facesPerColumn: columnSchedule.facesPerColumn,
                    totalFaces: columnSchedule.totalFaces,
                    verticalCourses: columnSchedule.verticalCourses,
                    courseLengthsMm: columnSchedule.courseLengthsMm,
                    panelsPerColumn: columnSchedule.panelsPerColumn,
                    totalPanels: columnSchedule.totalPanels,
                    curvedFaceCount: columnSchedule.curvedFaceCount,
                    panels: columnSchedule.panels.map((panel) => ({
                      widthMm: panel.widthMm,
                      lengthMm: panel.lengthMm,
                      countPerColumn: panel.countPerColumn,
                      totalCount: panel.totalCount,
                      fullPanel: panel.fullPanel,
                      curved: panel.curved,
                    })),
                    notes: columnSchedule.notes,
                  },
                }
              : {}),
          };
        }
        // A stored pricing rule wins over the per-kilogram default: it was
        // chosen for this line precisely because the kilogram is not how this
        // item is sold. It still reads the resolved rate and the line's own
        // dimensions, so nothing is entered twice.
        if (line.customFormulaKey && line.unitPrice == null) {
          const formula = await tx.calculationFormula.findFirst({
            where: {
              formulaKey: line.customFormulaKey,
              statusCode: "ACTIVE",
            },
          });
          if (!formula) missing("CALCULATION_FORMULA_NOT_FOUND");
          const formulaRate =
            optionalDecimal(line.formulaRate, "formulaRate") ??
            appliedRate ??
            optionalDecimal(line.pricePerKg, "pricePerKg");
          const scope = buildLineFormulaScope({
            widthMm:
              deliveredWidthMm ?? optionalDecimal(line.widthMm, "widthMm"),
            lengthMm:
              deliveredLengthMm ?? optionalDecimal(line.lengthMm, "lengthMm"),
            heightMm: optionalDecimal(line.columnHeightMm, "columnHeightMm"),
            thicknessMm:
              appliedThickness ??
              optionalDecimal(line.thicknessMm, "thicknessMm"),
            diameterMm: optionalDecimal(line.diameterMm, "diameterMm"),
            radiusMm: optionalDecimal(line.radiusMm, "radiusMm"),
            densityKgM3:
              appliedDensity ??
              optionalDecimal(line.densityKgM3, "densityKgM3"),
            quantity: qty,
            rate: formulaRate,
            fabricationCost: optionalDecimal(
              line.fabricationCost,
              "fabricationCost",
            ),
            fixedCost: optionalDecimal(line.fixedCost, "fixedCost"),
          });
          const base =
            engineeringSnapshot === null
              ? { source: "ENGINEERING_CALC", method: "CUSTOM_FORMULA" }
              : engineeringSnapshot;
          try {
            scheduleValue = null;
            engineeringUnitPrice = evaluateFormula(
              formula.expression,
              scope,
            ).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
            engineeringSnapshot = {
              ...base,
              formula: {
                key: formula.formulaKey,
                displayName: formula.displayName,
                expression: formula.expression,
                rate: formulaRate?.toString() ?? null,
                rateUnitLabel: formula.rateUnitLabel,
                unitPrice: engineeringUnitPrice.toString(),
              },
            };
          } catch (error) {
            // A formula that will not evaluate must not quietly price the
            // line at zero: it is recorded as a failure and the line comes
            // back CHECK_FORMULA, which blocks the quotation from issue.
            if (!(error instanceof FormulaError)) throw error;
            formulaFailed = true;
            scheduleValue = null;
            engineeringUnitPrice = new Prisma.Decimal(0);
            engineeringSnapshot = {
              ...base,
              formula: {
                key: formula.formulaKey,
                displayName: formula.displayName,
                expression: formula.expression,
                error: { code: error.code, message: error.message },
              },
            };
          }
        }
        const unitPrice =
          line.unitPrice == null
            ? (engineeringUnitPrice ??
              priceRule?.referencePrice ??
              new Prisma.Decimal(0))
            : number(line.unitPrice, "unitPrice");
        const discountAmount =
          line.discountAmount == null
            ? new Prisma.Decimal(0)
            : number(line.discountAmount, "discountAmount");
        if (unitPrice.lessThan(0) || discountAmount.lessThan(0))
          rule("INVALID_QUOTATION_AMOUNT");
        // For CIRCULAR lines, unitPrice is per delivered piece (weight of
        // one arcModule x verticalCourse piece x appliedRate) — so the
        // priced quantity is the computed total delivered piece count, not
        // the user-entered column count (qty is still the column count
        // used above as circularSchedule's columnQuantity input).
        // The sheet's rule, ported in engineering-pricing.ts: a Linear row
        // covering a span is multiplied by the boards that span needs, while
        // a curved or circular row is already one complete piece and is
        // never multiplied. Getting that backwards quotes an order at
        // sixteen times its value.
        const extensionM =
          line.extensionLengthM == null || line.extensionLengthM.trim() === ""
            ? null
            : number(line.extensionLengthM, "extensionLengthM");
        const boardsPerUnit =
          extensionM === null ? 0 : boardsPerUnitFromExtension(extensionM);
        const isSheetPriced =
          line.pricingMethodCode === "LINEAR" ||
          line.materialClass === "STANDARD";
        const extendedQty =
          boardsPerUnit > 0 && isSheetPriced
            ? new Prisma.Decimal(
                pricedQuantity(
                  "LINEAR",
                  qty.toNumber(),
                  boardsPerUnit,
                  line.quantityMode === "DIRECT" ? "direct" : "extension",
                ),
              )
            : qty;
        const pricedQty = circularSchedule
          ? new Prisma.Decimal(circularSchedule.totalPieces)
          : columnSchedule
            ? new Prisma.Decimal(columnSchedule.totalPanels)
            : extendedQty;
        // The snapshot is a read-only Json input type, so the extension
        // record is merged in rather than assigned onto it.
        if (engineeringSnapshot && boardsPerUnit > 0) {
          engineeringSnapshot = {
            ...engineeringSnapshot,
            extension: {
              extensionLengthM: extensionM?.toString() ?? null,
              boardsPerUnit,
              quantityMode: line.quantityMode ?? "EXTENSION",
              applied: isSheetPriced && line.quantityMode !== "DIRECT",
            },
          };
        }
        // The generated name replaces what was typed only when the studio
        // asks for it, so a line someone deliberately worded by hand keeps
        // its wording.
        // Kept as it was priced: its weights and checks were worked out from
        // sizes this save does not carry, so they are not recomputed.
        const kept =
          engineeringSnapshot === null
            ? keptEngineering(line, pricedQty)
            : null;
        const description =
          line.autoDescribe === true && clientDescription !== null
            ? clientDescription
            : line.description.trim();
        // Nothing is priced silently: every line carries an explicit status,
        // the studio shows it while the line is being entered, and a
        // quotation holding a CHECK cannot be issued (spec SS23).
        const check = checkQuotationLine({
          materialClass: line.materialClass ?? null,
          description,
          // The quantity that was entered, not the piece count derived from
          // it -- a column with no diameter derives zero pieces, and the
          // actionable message is the missing diameter.
          quantity: qty.toNumber(),
          thicknessMm: appliedThickness?.toNumber() ?? null,
          widthMm: deliveredWidthMm?.toNumber() ?? null,
          lengthMm: deliveredLengthMm?.toNumber() ?? null,
          densityKgM3: appliedDensity?.toNumber() ?? null,
          appliedPricePerKg: appliedRate?.toNumber() ?? null,
          unitPrice: unitPrice.toNumber(),
          diameterMm: line.diameterMm == null ? null : Number(line.diameterMm),
          radiusMm: line.radiusMm == null ? null : Number(line.radiusMm),
          columnHeightMm:
            line.columnHeightMm == null ? null : Number(line.columnHeightMm),
          totalPieces: circularSchedule
            ? circularSchedule.totalPieces
            : columnSchedule
              ? columnSchedule.totalPanels
              : null,
          formulaError: formulaFailed,
        });
        if (engineeringSnapshot) {
          const totalWeightKg =
            scheduleWeightKg ?? weightPerPieceKg?.mul(pricedQty) ?? null;
          engineeringSnapshot = {
            ...engineeringSnapshot,
            clientDescription,
            weightPerPieceKg: weightPerPieceKg?.toFixed(3) ?? null,
            totalWeightKg: totalWeightKg?.toFixed(3) ?? null,
            totalPieces: pricedQty.toNumber(),
            validation: {
              status: check.status,
              issues: check.issues.map((issue) => ({
                status: issue.status,
                field: issue.field,
              })),
            },
          };
        }
        return {
          id: line.quotationLineId ?? undefined,
          productId: line.productId ?? null,
          lineNo: index + 1,
          sectionLabel: line.sectionLabel?.trim() || null,
          description,
          qty: pricedQty,
          unitCode: line.unitCode.trim(),
          unitPrice,
          discountAmount,
          lineTotal:
            scheduleValue !== null &&
            line.unitPrice == null &&
            engineeringUnitPrice !== null &&
            unitPrice.equals(engineeringUnitPrice)
              ? scheduleValue.minus(discountAmount)
              : pricedQty.mul(unitPrice).minus(discountAmount),
          priceRuleId:
            engineeringSnapshot || kept ? null : (priceRule?.id ?? null),
          priceSnapshot: engineeringSnapshot
            ? engineeringSnapshot
            : kept
              ? kept
              : priceRule
                ? {
                    pricingRuleId: priceRule.id,
                    minPrice: priceRule.minPrice.toString(),
                    referencePrice: priceRule.referencePrice.toString(),
                    maxPrice: priceRule.maxPrice.toString(),
                    currencyCode: priceRule.currencyCode.trim(),
                    version: priceRule.version,
                    effectiveFrom: priceRule.effectiveFrom.toISOString(),
                    sourceCode: priceRule.sourceCode,
                  }
                : Prisma.JsonNull,
        };
      }),
    );
    const subtotal = lines.reduce(
      (sum, line) => sum.plus(line.lineTotal),
      new Prisma.Decimal(0),
    );
    const adjustments = input.adjustments ?? [];
    const adjustmentAmount = adjustments.reduce((sum, a) => {
      const value = number(a.value, "adjustment.value");
      if (a.modeCode === "PERCENT")
        return sum.plus(subtotal.mul(value).div(100));
      if (a.modeCode === "FIXED_AMOUNT") return sum.plus(value);
      rule("INVALID_ADJUSTMENT_MODE");
    }, new Prisma.Decimal(0));
    const terms = input.paymentTermsCode
      ? await tx.paymentTerm.findFirst({
          where: {
            termCode: input.paymentTermsCode,
            isActive: true,
            effectiveFrom: { lte: new Date() },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
          },
        })
      : null;
    if (input.paymentTermsCode && !terms) missing("PAYMENT_TERM_NOT_FOUND");
    const taxPolicy = await tx.taxPolicy.findFirst({
      where: {
        taxCode: "VAT",
        statusCode: "ACTIVE",
        effectiveFrom: { lte: new Date() },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: new Date() } }],
      },
      orderBy: [{ effectiveFrom: "desc" }, { versionNo: "desc" }],
    });
    const taxableAmount = subtotal.plus(adjustmentAmount);
    const taxAmount = taxPolicy
      ? taxableAmount.mul(taxPolicy.taxRatePct).div(100)
      : new Prisma.Decimal(0);
    const grandTotal = taxableAmount.plus(taxAmount);
    let paymentScheduleJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      Prisma.JsonNull;
    if (input.paymentScheduleCode === "ADVANCE_INSTALLMENTS") {
      const advancePct = number(input.advancePct ?? "", "advancePct");
      if (advancePct.lessThan(0) || advancePct.greaterThan(100))
        rule("INVALID_ADVANCE_PERCENTAGE", "advancePct");
      const installments = input.installments ?? 0;
      if (!Number.isInteger(installments) || installments < 1)
        rule("INVALID_INSTALLMENTS", "installments");
      const frequencyDays = input.frequencyDays ?? 0;
      if (!Number.isInteger(frequencyDays) || frequencyDays < 1)
        rule("INVALID_FREQUENCY_DAYS", "frequencyDays");
      paymentScheduleJson = computePaymentSchedule({
        advancePct,
        installments,
        frequencyDays,
        referenceDate: input.referenceDate ? day(input.referenceDate) : null,
        paymentMethod: input.paymentMethod ?? "CHEQUE",
        grandTotal,
      }) as unknown as Prisma.InputJsonValue;
    }
    const materialSnapshot = {
      lines: lines.map((line) => ({
        productId: line.productId,
        sectionLabel: line.sectionLabel,
        description: line.description,
        qty: line.qty.toString(),
        unitCode: line.unitCode,
        unitPrice: line.unitPrice.toString(),
        discountAmount: line.discountAmount.toString(),
        priceRuleId: line.priceRuleId,
        priceSnapshot: line.priceSnapshot,
      })),
      adjustments,
      paymentTermsCode: input.paymentTermsCode ?? null,
      paymentTermsSnapshot:
        terms?.displayText ?? input.customPaymentTerms ?? null,
      paymentScheduleJson,
      taxPolicy: taxPolicy
        ? {
            taxPolicyId: taxPolicy.id,
            taxCode: taxPolicy.taxCode,
            ratePct: taxPolicy.taxRatePct.toString(),
            versionNo: taxPolicy.versionNo,
          }
        : null,
      currencyCode: quote.currencyCode?.trim() ?? "USD",
      calculationVersion: quote.calculationVersion,
    };
    await tx.quotationLine.deleteMany({ where: { quotationId: id } });
    await tx.quotationAdjustment.deleteMany({ where: { quotationId: id } });
    await tx.quotationLine.createMany({
      data: lines.map((line) => ({
        quotationId: id,
        productId: line.productId,
        lineNo: line.lineNo,
        sectionLabel: line.sectionLabel,
        description: line.description,
        qty: line.qty,
        unitCode: line.unitCode,
        unitPrice: line.unitPrice,
        discountAmount: line.discountAmount,
        lineTotal: line.lineTotal,
        priceRuleId: line.priceRuleId,
        priceSnapshot: line.priceSnapshot,
      })),
    });
    if (adjustments.length)
      await tx.quotationAdjustment.createMany({
        data: adjustments.map((a) => ({
          quotationId: id,
          typeCode: a.typeCode.trim(),
          modeCode: a.modeCode,
          value: number(a.value, "adjustment.value"),
          label: a.label ?? null,
        })),
      });
    const update = await tx.quotation.updateMany({
      where: { id, rowVersion: version },
      data: {
        paymentTermsCode: input.paymentTermsCode ?? null,
        customPaymentTerms: input.customPaymentTerms ?? null,
        paymentTermsSnapshot:
          terms?.displayText ?? input.customPaymentTerms ?? null,
        paymentScheduleJson,
        validFrom: input.validFrom ? day(input.validFrom) : quote.validFrom,
        expiresOn: input.expiresOn ? day(input.expiresOn) : quote.expiresOn,
        documentTypeCode: input.documentTypeCode ?? quote.documentTypeCode,
        incotermCode:
          input.incotermCode !== undefined
            ? input.incotermCode
            : quote.incotermCode,
        subject: input.subject !== undefined ? input.subject : quote.subject,
        customerPoNumber:
          input.customerPoNumber !== undefined
            ? input.customerPoNumber
            : quote.customerPoNumber,
        leadTime:
          input.leadTime !== undefined ? input.leadTime : quote.leadTime,
        freightAmount:
          input.freightAmount !== undefined
            ? optionalDecimal(input.freightAmount, "freightAmount")
            : quote.freightAmount,
        deliveryAddress:
          input.deliveryAddress !== undefined
            ? input.deliveryAddress
            : quote.deliveryAddress,
        portOfLoading:
          input.portOfLoading !== undefined
            ? input.portOfLoading
            : quote.portOfLoading,
        portOfDischarge:
          input.portOfDischarge !== undefined
            ? input.portOfDischarge
            : quote.portOfDischarge,
        contactId:
          input.contactId !== undefined ? input.contactId : quote.contactId,
        standardPricePerKgOverride: resolvedStandardOverride,
        curvedPricePerKgOverride: resolvedCurvedOverride,
        circularPricePerKgOverride: resolvedCircularOverride,
        densityOverrideKgM3: resolvedDensityOverride,
        subtotalAmount: subtotal,
        adjustmentAmount,
        taxAmount,
        totalAmount: grandTotal,
        contentHash: createHash("sha256")
          .update(JSON.stringify(materialSnapshot))
          .digest("hex"),
        rowVersion: { increment: 1 },
        updatedByUserId: identity.userId,
      },
    });
    if (update.count !== 1)
      throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
    const row = await tx.quotation.findUnique({ where: { id } });
    if (!row) missing("QUOTATION_NOT_FOUND");
    await this.record(tx, identity, "QUOTATION_DRAFT_SAVED", row, quote);
    return toDto(row);
  }

  async supersede(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: SupersedeQuotationDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsCreate);
    requireKey(key);
    const expected = versionOf(input.expectedRowVersion);
    return this.txs.run(identity, async (tx) => {
      const priorCommand = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: identity.userId,
            operationCode: "post_quotations_by_quotationId_supersede",
            idempotencyKey: key,
          },
        },
      });
      if (priorCommand) {
        if (priorCommand.requestHash !== hashOf(commandBody(id, input)))
          conflict("IDEMPOTENCY_KEY_REUSED");
        const replay = await tx.quotation.findUnique({
          where: { id: priorCommand.responseResourceId },
        });
        if (!replay) conflict("IDEMPOTENCY_REPLAY_MISSING");
        return toDto(replay);
      }
      const source = await tx.quotation.findFirst({
        where: {
          id,
          countryCode: { in: [...identity.countryCodes] },
          account: { OR: accountAccess(identity) },
        },
        include: { lines: true, adjustments: true },
      });
      if (!source) missing("QUOTATION_NOT_FOUND");
      if (!canCopyQuotationStatus(source.statusCode))
        rule("QUOTATION_COPY_REQUIRES_HISTORICAL_SOURCE");
      if (source.rowVersion !== expected)
        throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
      const created = await tx.quotation.create({
        data: {
          accountId: source.accountId,
          opportunityId: source.opportunityId,
          projectId: source.projectId,
          contactId: source.contactId,
          countryCode: source.countryCode,
          ownerUserId: identity.userId,
          documentTypeCode: source.documentTypeCode,
          currencyCode: source.currencyCode,
          paymentTermsCode: source.paymentTermsCode,
          customPaymentTerms: source.customPaymentTerms,
          paymentTermsSnapshot: source.paymentTermsSnapshot,
          paymentScheduleJson:
            source.paymentScheduleJson === null
              ? Prisma.JsonNull
              : (source.paymentScheduleJson as Prisma.InputJsonValue),
          standardPricePerKgOverride: source.standardPricePerKgOverride,
          curvedPricePerKgOverride: source.curvedPricePerKgOverride,
          circularPricePerKgOverride: source.circularPricePerKgOverride,
          densityOverrideKgM3: source.densityOverrideKgM3,
          calculationVersion: source.calculationVersion,
          validFrom: today(),
          expiresOn: plusDays(7),
          incotermCode: source.incotermCode,
          subject: source.subject,
          customerPoNumber: source.customerPoNumber,
          leadTime: source.leadTime,
          freightAmount: source.freightAmount,
          deliveryAddress: source.deliveryAddress,
          portOfLoading: source.portOfLoading,
          portOfDischarge: source.portOfDischarge,
          supersedesQuotationId: source.id,
          createdByUserId: identity.userId,
          updatedByUserId: identity.userId,
        },
      });
      if (source.lines.length > 0)
        await tx.quotationLine.createMany({
          data: source.lines.map((line) => ({
            quotationId: created.id,
            productId: line.productId,
            productImageId: line.productImageId,
            lineNo: line.lineNo,
            sectionLabel: line.sectionLabel,
            description: line.description,
            qty: line.qty,
            unitCode: line.unitCode,
            unitPrice: line.unitPrice,
            discountAmount: line.discountAmount,
            lineTotal: line.lineTotal,
            priceRuleId: line.priceRuleId,
            priceSnapshot:
              line.priceSnapshot === null
                ? Prisma.JsonNull
                : (line.priceSnapshot as Prisma.InputJsonValue),
          })),
        });
      if (source.adjustments.length > 0)
        await tx.quotationAdjustment.createMany({
          data: source.adjustments.map((adjustment) => ({
            quotationId: created.id,
            typeCode: adjustment.typeCode,
            modeCode: adjustment.modeCode,
            value: adjustment.value,
            label: adjustment.label,
          })),
        });
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: "post_quotations_by_quotationId_supersede",
          idempotencyKey: key,
          requestHash: hashOf(commandBody(id, input)),
          responseResourceId: created.id,
        },
      });
      // A SENT document is still live, so replacing it closes that version.
      // Historical documents (expired/rejected/cancelled/already superseded)
      // keep their truthful terminal status; the new draft links back to them
      // without rewriting history.
      if (copyClosesSource(source.statusCode)) {
        const replaced = await tx.quotation.update({
          where: { id: source.id },
          data: {
            statusCode: "SUPERSEDED",
            supersededAt: new Date(),
            updatedByUserId: identity.userId,
            rowVersion: { increment: 1 },
          },
        });
        await this.record(
          tx,
          identity,
          "QUOTATION_SUPERSEDED",
          replaced,
          source,
        );
      }
      await this.record(tx, identity, "QUOTATION_CREATED", created);
      return toDto(created);
    });
  }

  /**
   * Cancel a quotation.
   *
   * Cancelling is not superseding. A superseded quotation was replaced by a
   * better one and the deal is alive; a cancelled quotation is off the table -
   * the customer walked away, or it was raised in error. Keeping them apart is
   * what stops "we sent 400 quotations" from counting abandoned paperwork.
   */
  async cancel(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: { expectedRowVersion: string; reason: string },
  ) {
    this.access.requirePermission(identity, permissions.quotationsEdit);
    requireKey(key);
    const expected = versionOf(input.expectedRowVersion);
    return this.txs.run(identity, async (tx) => {
      await this.reserveCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_cancel",
        key,
        commandBody(id, input),
        id,
      );
      const quote = await tx.quotation.findFirst({
        where: {
          id,
          countryCode: { in: [...identity.countryCodes] },
          account: { OR: accountAccess(identity) },
        },
      });
      if (!quote) missing("QUOTATION_NOT_FOUND");
      if (quote.statusCode === "CANCELLED") rule("QUOTATION_ALREADY_CANCELLED");
      if (quote.statusCode === "SUPERSEDED")
        rule("QUOTATION_ALREADY_SUPERSEDED");
      if (quote.rowVersion !== expected)
        throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
      const reason = input.reason.trim();
      if (reason === "") rule("CANCELLATION_REASON_REQUIRED");
      const changed = await tx.quotation.updateMany({
        where: { id, rowVersion: expected },
        data: {
          statusCode: "CANCELLED",
          cancelledAt: new Date(),
          cancellationReason: reason,
          updatedByUserId: identity.userId,
          rowVersion: { increment: 1 },
        },
      });
      if (changed.count !== 1)
        throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
      const row = await tx.quotation.findUniqueOrThrow({ where: { id } });
      await this.record(tx, identity, "QUOTATION_CANCELLED", row, quote);
      return toDto(row);
    });
  }

  async prepare(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: VersionedQuotationCommandDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsEdit);
    requireKey(key);
    const expected = versionOf(input.expectedRowVersion);
    return this.txs.run(identity, async (tx) => {
      await this.reserveCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_prepare",
        key,
        commandBody(id, input),
        id,
      );
      const quote = await this.scopedQuote(tx, identity, id);
      if (quote.rowVersion !== expected) precondition();
      if (quote.statusCode !== "DRAFT") rule("QUOTATION_NOT_DRAFT");
      const blockers = await this.readinessBlockers(tx, quote);
      const pending = await tx.quotationApproval.findFirst({
        where: {
          quotationId: id,
          statusCode: "PENDING",
          contentHash: quote.contentHash ?? "",
        },
        orderBy: { requestedAt: "desc" },
      });
      const approved = await tx.quotationApproval.findFirst({
        where: {
          quotationId: id,
          statusCode: "APPROVED",
          contentHash: quote.contentHash ?? "",
        },
        orderBy: { decidedAt: "desc" },
      });
      let documentJobId: string | null = null;
      if (blockers.length === 0 && approved && quote.contentHash) {
        const job = await this.jobs.enqueue(tx, {
          type: "QUOTATION_DOCUMENT",
          payload: {
            quotationId: id,
            candidateHash: quote.contentHash,
            quotationRowVersionSnapshot: quote.rowVersion.toString(),
            createdByUserId: identity.userId,
          },
          traceId: identity.traceId,
          correlationId: identity.correlationId,
          idempotencyKey: key,
          sourceType: "Quotation",
          sourceId: id,
        });
        documentJobId = job.jobId;
        await this.outbox.enqueue(tx, {
          eventType: "QUOTATION_DOCUMENT_REQUESTED",
          aggregateType: "Quotation",
          aggregateId: id,
          payload: {
            quotationId: id,
            jobId: job.jobId,
            candidateHash: quote.contentHash,
          },
          traceId: identity.traceId,
          correlationId: identity.correlationId,
          idempotencyKey: key,
        });
      }
      await this.record(tx, identity, "QUOTATION_PREPARED", quote);
      return {
        data: {
          quotationId: id,
          ready: blockers.length === 0,
          statusCode: quote.statusCode,
          blockers,
          approvalRequestId: pending?.id ?? null,
          documentJobId,
          statusUrl: documentJobId ? `/api/v1/jobs/${documentJobId}` : null,
        },
      };
    });
  }

  async requestApproval(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: RequestQuotationApprovalDto,
  ) {
    this.access.requirePermission(
      identity,
      permissions.quotationsRequestApproval,
    );
    requireKey(key);
    const expected = versionOf(input.expectedRowVersion);
    return this.txs.run(identity, async (tx) => {
      const prior = await this.findCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_approval_requests",
        key,
        commandBody(id, input),
      );
      if (prior) {
        const replay = await tx.quotationApproval.findUnique({
          where: { id: prior.responseResourceId },
        });
        if (!replay) conflict("IDEMPOTENCY_REPLAY_MISSING");
        return { data: approvalDto(replay) };
      }
      const quote = await this.scopedQuote(tx, identity, id);
      if (quote.rowVersion !== expected) precondition();
      if (quote.statusCode !== "DRAFT") rule("QUOTATION_NOT_DRAFT");
      const blockers = await this.readinessBlockers(tx, quote);
      if (blockers.length) rule("QUOTATION_NOT_READY");
      const contentHash = quote.contentHash;
      if (!contentHash) rule("CONTENT_HASH_REQUIRED");
      const duplicate = await tx.quotationApproval.findFirst({
        where: {
          quotationId: id,
          contentHash,
          statusCode: "PENDING",
        },
      });
      if (duplicate) conflict("APPROVAL_ALREADY_PENDING");
      const requester = await tx.userProfile.findUnique({
        where: { userId: identity.userId },
      });
      const snapshot = {
        comment: input.comment ?? null,
        totalAmount: quote.totalAmount.toString(),
        currencyCode: quote.currencyCode?.trim() ?? "USD",
        pricing: quote.lines.map((line) => ({
          lineId: line.id,
          priceRuleId: line.priceRuleId,
          priceSnapshot: line.priceSnapshot,
        })),
      } as Prisma.InputJsonValue;
      const approval = await tx.quotationApproval.create({
        data: {
          quotationId: id,
          contentHash,
          statusCode: "PENDING",
          requestedByUserId: identity.userId,
          reason: input.comment ?? null,
          snapshot,
          requiredAuthorityTier: 1,
          currentAssigneeUserId: requester?.managerUserId ?? null,
          quotationRowVersionSnapshot: quote.rowVersion,
          calculationVersionSnapshot: quote.calculationVersion,
        },
      });
      await this.rememberCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_approval_requests",
        key,
        commandBody(id, input),
        approval.id,
      );
      await this.outbox.enqueue(tx, {
        eventType: "QUOTATION_APPROVAL_REQUESTED",
        aggregateType: "Quotation",
        aggregateId: id,
        payload: {
          quotationId: id,
          approvalRequestId: approval.id,
          assigneeUserId: approval.currentAssigneeUserId,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
      });
      await this.record(tx, identity, "QUOTATION_APPROVAL_REQUESTED", quote);
      return { data: approvalDto(approval) };
    });
  }

  async listApprovals(identity: CustomerIdentity, query: ApprovalListQuery) {
    this.access.requirePermission(identity, permissions.approvalsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.QuotationApprovalWhereInput = {
      quotation: { countryCode: { in: [...identity.countryCodes] } },
      OR: [
        { requestedByUserId: identity.userId },
        { currentAssigneeUserId: identity.userId },
        ...(identity.permissions.has(permissions.approvalsDecide)
          ? [{ currentAssigneeUserId: null }]
          : []),
      ],
      ...(query.search
        ? {
            quotation: {
              quotationRef: {
                contains: query.search.trim(),
                mode: "insensitive",
              },
              countryCode: { in: [...identity.countryCodes] },
            },
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.quotationApproval.count({ where }),
      this.db.quotationApproval.findMany({
        where,
        orderBy: [{ requestedAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: rows.map(approvalDto),
      meta: {
        page: Math.floor(offset / query.limit) + 1,
        offset,
        limit: query.limit,
        total,
        hasNext: offset + rows.length < total,
      },
    };
  }

  async approvalContext(identity: CustomerIdentity, id: string) {
    this.access.requirePermission(identity, permissions.approvalsView);
    const row = await this.db.quotationApproval.findFirst({
      where: {
        id,
        quotation: { countryCode: { in: [...identity.countryCodes] } },
        OR: [
          { requestedByUserId: identity.userId },
          { currentAssigneeUserId: identity.userId },
        ],
      },
    });
    if (!row) missing("APPROVAL_REQUEST_NOT_FOUND");
    const quote = await this.db.quotation.findUnique({
      where: { id: row.quotationId },
      include: { account: true, project: true },
    });
    if (!quote) missing("QUOTATION_NOT_FOUND");
    return { data: approvalContextDto(row, quote) };
  }

  async decideApproval(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: ApprovalDecisionDto,
  ) {
    // Two rights, not one. `approvals.decide` says this person takes
    // decisions at all; `quotation.approve` says they may take *this* kind.
    // The second was defined in the contract and enforced nowhere, so a role
    // granted the general right could approve a quotation it had no authority
    // over. Both roles that decide today already hold both, so this closes the
    // gap without taking access from anyone.
    this.access.requirePermission(identity, permissions.approvalsDecide);
    this.access.requirePermission(identity, permissions.quotationApprove);
    requireKey(key);
    return this.txs.run(identity, async (tx) => {
      const prior = await this.findCommand(
        tx,
        identity,
        "post_approval_requests_by_requestId_decisions",
        key,
        commandBody(id, input),
      );
      if (prior) {
        const replay = await tx.quotationApproval.findUnique({ where: { id } });
        if (!replay) missing("APPROVAL_REQUEST_NOT_FOUND");
        return { data: approvalDto(replay) };
      }
      const approval = await tx.quotationApproval.findFirst({
        where: {
          id,
          quotation: { countryCode: { in: [...identity.countryCodes] } },
        },
      });
      if (!approval) missing("APPROVAL_REQUEST_NOT_FOUND");
      if (approval.statusCode !== "PENDING")
        conflict("APPROVAL_ALREADY_RESOLVED");
      if (approval.requestedByUserId === identity.userId) this.access.forbid();
      if (
        approval.currentAssigneeUserId &&
        approval.currentAssigneeUserId !== identity.userId
      )
        this.access.forbid();
      const quote = await tx.quotation.findUnique({
        where: { id: approval.quotationId },
      });
      if (!quote) missing("QUOTATION_NOT_FOUND");
      if (
        quote.contentHash !== approval.contentHash ||
        quote.rowVersion !== approval.quotationRowVersionSnapshot
      )
        conflict("APPROVAL_CONTENT_INVALIDATED");
      const statusCode =
        input.decision === "APPROVE"
          ? "APPROVED"
          : input.decision === "REJECT"
            ? "REJECTED"
            : "CHANGES_REQUESTED";
      const updated = await tx.quotationApproval.update({
        where: { id },
        data: {
          statusCode,
          decidedByUserId: identity.userId,
          decidedAt: new Date(),
          reason: input.comment ?? approval.reason,
        },
      });
      await this.rememberCommand(
        tx,
        identity,
        "post_approval_requests_by_requestId_decisions",
        key,
        commandBody(id, input),
        id,
      );
      await this.outbox.enqueue(tx, {
        eventType: `QUOTATION_APPROVAL_${statusCode}`,
        aggregateType: "Quotation",
        aggregateId: quote.id,
        payload: {
          quotationId: quote.id,
          approvalRequestId: id,
          decision: input.decision,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
      });
      await this.record(
        tx,
        identity,
        `QUOTATION_APPROVAL_${statusCode}`,
        quote,
      );
      return { data: approvalDto(updated) };
    });
  }

  async preview(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: QuotationPreviewDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsView);
    requireKey(key);
    const expected = versionOf(input.expectedRowVersion);
    const quote = await this.db.quotation.findFirst({
      where: {
        id,
        countryCode: { in: [...identity.countryCodes] },
        account: { OR: accountAccess(identity) },
      },
      include: { lines: true, account: true },
    });
    if (!quote) missing("QUOTATION_NOT_FOUND");
    if (quote.rowVersion !== expected) precondition();
    const html = renderPreviewHtml(quote, input.locale ?? "en");
    return {
      data: {
        contentType: "text/html; charset=utf-8",
        previewUrl: `data:text/html;base64,${Buffer.from(html).toString("base64")}`,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        sourceRowVersion: Number(quote.rowVersion),
      },
    };
  }

  async send(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: SendQuotationDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsSend);
    requireKey(key);
    if (!input.recipients.length) rule("RECIPIENT_REQUIRED");
    if (input.channelCode === "EMAIL") {
      if (!mailStatus().configured) rule("EMAIL_NOT_CONFIGURED");
      if (input.recipients.some((recipient) => !recipient.email?.trim()))
        rule("RECIPIENT_EMAIL_REQUIRED");
    }
    const expected = versionOf(input.expectedRowVersion);
    return this.txs.run(identity, async (tx) => {
      const prior = await this.findCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_send",
        key,
        commandBody(id, input),
      );
      if (prior) {
        const job = await tx.durableJob.findUnique({
          where: { id: prior.responseResourceId },
        });
        if (!job) conflict("IDEMPOTENCY_REPLAY_MISSING");
        return { data: sendJobDto(job, id) };
      }
      const quote = await this.scopedQuote(tx, identity, id);
      if (quote.rowVersion !== expected) precondition();
      if (!quote.contentHash) rule("QUOTATION_CONTENT_HASH_REQUIRED");
      const approval = await tx.quotationApproval.findFirst({
        where: {
          quotationId: id,
          contentHash: quote.contentHash,
          statusCode: "APPROVED",
        },
        orderBy: { decidedAt: "desc" },
      });
      if (!approval) rule("QUOTATION_APPROVAL_REQUIRED");
      const job = await this.jobs.enqueue(tx, {
        type: "QUOTATION_SEND",
        payload: {
          quotationId: id,
          candidateHash: quote.contentHash,
          quotationRowVersionSnapshot: quote.rowVersion.toString(),
          createdByUserId: identity.userId,
          channelCode: input.channelCode,
          recipients: input.recipients,
          subject: input.subject ?? null,
          message: input.message ?? null,
          ccSelf: input.ccSelf === true,
          languageCode: input.languageCode ?? "en",
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
        sourceType: "Quotation",
        sourceId: id,
      });
      await this.rememberCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_send",
        key,
        commandBody(id, input),
        job.jobId,
      );
      await this.outbox.enqueue(tx, {
        eventType: "QUOTATION_SEND_REQUESTED",
        aggregateType: "Quotation",
        aggregateId: id,
        payload: {
          quotationId: id,
          jobId: job.jobId,
          candidateHash: quote.contentHash,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
      });
      await this.record(tx, identity, "QUOTATION_SEND_REQUESTED", quote);
      const persisted = await tx.durableJob.findUniqueOrThrow({
        where: { id: job.jobId },
      });
      return { data: sendJobDto(persisted, id) };
    });
  }

  async accept(
    identity: CustomerIdentity,
    id: string,
    key: string | undefined,
    input: CreateAcceptanceDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsAccept);
    requireKey(key);
    if (!input.documentId && !input.externalReference?.trim())
      rule("ACCEPTANCE_EVIDENCE_REQUIRED");
    return this.txs.run(identity, async (tx) => {
      const prior = await this.findCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_acceptances",
        key,
        commandBody(id, input),
      );
      if (prior) {
        const replay = await tx.quotationAcceptance.findUnique({
          where: { id: prior.responseResourceId },
        });
        if (!replay) conflict("IDEMPOTENCY_REPLAY_MISSING");
        const opp = await tx.opportunity.findUniqueOrThrow({
          where: {
            id: (await tx.quotation.findUniqueOrThrow({ where: { id } }))
              .opportunityId,
          },
        });
        return {
          data: {
            acceptance: acceptanceDto(replay),
            opportunity: opportunityDto(opp),
          },
        };
      }
      const quote = await this.scopedQuote(tx, identity, id);
      if (quote.statusCode !== "SENT")
        rule("ACCEPTANCE_REQUIRES_SENT_QUOTATION");
      if (input.documentId) {
        const document = await tx.documentMetadata.findFirst({
          where: {
            id: input.documentId,
            resourceTypeCode: "Quotation",
            resourceId: id,
          },
        });
        if (!document) missing("ACCEPTANCE_DOCUMENT_NOT_FOUND");
      }
      const acceptedAt = new Date(input.acceptedAt);
      if (Number.isNaN(acceptedAt.getTime()) || acceptedAt > new Date())
        rule("INVALID_ACCEPTED_AT");
      const acceptance = await tx.quotationAcceptance.create({
        data: {
          quotationId: id,
          evidenceTypeCode: input.evidenceTypeCode,
          documentId: input.documentId ?? null,
          externalReference: input.externalReference?.trim() ?? null,
          acceptedAt,
          verifiedByUserId: identity.userId,
        },
      });
      const opportunity = await tx.opportunity.findUnique({
        where: { id: quote.opportunityId },
      });
      if (!opportunity) missing("OPPORTUNITY_NOT_FOUND");
      if (opportunity.stageCode === "LOST")
        conflict("LOST_OPPORTUNITY_CANNOT_BE_ACCEPTED");
      let updatedOpportunity = opportunity;
      if (opportunity.stageCode !== "WON") {
        const transition = await tx.opportunityStageTransition.create({
          data: {
            opportunityId: opportunity.id,
            fromStageCode: opportunity.stageCode,
            toStageCode: "WON",
            actorUserId: identity.userId,
          },
        });
        const wonAt = acceptedAt;
        const wonValue = quote.totalAmount;
        updatedOpportunity = await tx.opportunity.update({
          where: { id: opportunity.id },
          data: {
            stageCode: "WON",
            probabilityPct: new Prisma.Decimal(100),
            wonAt,
            wonValueSnapshot: wonValue,
            estimatedValue: opportunity.estimatedValue ?? wonValue,
            currencyCode:
              opportunity.currencyCode ?? quote.currencyCode?.trim() ?? "USD",
            rowVersion: { increment: 1 },
            updatedByUserId: identity.userId,
          },
        });
        await tx.opportunityWonSnapshot.create({
          data: {
            opportunityId: opportunity.id,
            stageTransitionId: transition.id,
            wonAt,
            value: wonValue,
            currencyCode: quote.currencyCode?.trim() ?? "USD",
          },
        });
      }
      await this.rememberCommand(
        tx,
        identity,
        "post_quotations_by_quotationId_acceptances",
        key,
        commandBody(id, input),
        acceptance.id,
      );
      await this.outbox.enqueue(tx, {
        eventType: "QUOTATION_ACCEPTED",
        aggregateType: "Quotation",
        aggregateId: id,
        payload: {
          quotationId: id,
          acceptanceId: acceptance.id,
          opportunityId: quote.opportunityId,
        },
        traceId: identity.traceId,
        correlationId: identity.correlationId,
        idempotencyKey: key,
      });
      await this.record(tx, identity, "QUOTATION_ACCEPTED", quote);
      return {
        data: {
          acceptance: acceptanceDto(acceptance),
          opportunity: opportunityDto(updatedOpportunity),
        },
      };
    });
  }

  async documents(
    identity: CustomerIdentity,
    id: string,
    query: QuotationListQuery,
  ) {
    this.access.requirePermission(identity, permissions.documentsView);
    await this.get(identity, id);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const [total, rows] = await this.db.$transaction([
      this.db.officialQuotationDocument.count({ where: { quotationId: id } }),
      this.db.officialQuotationDocument.findMany({
        where: { quotationId: id },
        orderBy: [{ generatedAt: "desc" }, { id: "asc" }],
        skip: offset,
        take: query.limit,
      }),
    ]);
    return {
      data: rows.map((row) => ({
        documentId: row.documentMetadataId,
        documentTypeCode: "QUOTE",
        title: `Official quotation ${row.templateVersion}`,
        statusCode: row.isFinal ? "FINAL" : "DRAFT",
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

  private async scopedQuote(
    tx: TransactionClient,
    identity: CustomerIdentity,
    id: string,
  ) {
    const quote = await tx.quotation.findFirst({
      where: {
        id,
        countryCode: { in: [...identity.countryCodes] },
        account: { OR: accountAccess(identity) },
      },
      include: { lines: true },
    });
    if (!quote) missing("QUOTATION_NOT_FOUND");
    return quote;
  }

  private async readinessBlockers(
    tx: TransactionClient,
    quote: Awaited<ReturnType<QuotationService["scopedQuote"]>>,
  ) {
    const blockers: Array<{
      code: string;
      severity: "BLOCKER";
      message: string;
      field: string | null;
    }> = [];
    if (!quote.lines.length)
      blockers.push(blocker("QUOTATION_LINE_REQUIRED", "lines"));
    if (!quote.contentHash)
      blockers.push(blocker("CONTENT_HASH_REQUIRED", null));
    if (!quote.paymentTermsSnapshot)
      blockers.push(blocker("PAYMENT_TERMS_REQUIRED", "paymentTermsCode"));
    if (!quote.currencyCode)
      blockers.push(blocker("CURRENCY_REQUIRED", "currencyCode"));
    if (!quote.expiresOn || quote.expiresOn < today())
      blockers.push(blocker("VALIDITY_EXPIRED", "expiresOn"));
    const now = new Date();
    for (const line of quote.lines) {
      if (!line.productId) continue;
      const ruleRow = await tx.pricingRule.findFirst({
        where: {
          productId: line.productId,
          currencyCode: quote.currencyCode ?? "USD",
          statusCode: "ACTIVE",
          effectiveFrom: { lte: now },
          OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }],
          AND: [
            { OR: [{ countryCode: quote.countryCode }, { countryCode: null }] },
          ],
        },
        orderBy: [{ countryCode: "desc" }, { effectiveFrom: "desc" }],
      });
      if (!ruleRow) {
        blockers.push(blocker("PRICING_RULE_REQUIRED", `lines.${line.id}`));
        continue;
      }
      if (line.unitPrice.lessThan(ruleRow.minPrice)) {
        const override = await tx.priceOverride.findFirst({
          where: {
            quotationId: quote.id,
            OR: [{ quotationLineId: line.id }, { quotationLineId: null }],
            statusCode: "APPROVED",
            requestedBelowMinPrice: line.unitPrice,
            minPriceSnapshot: ruleRow.minPrice,
          },
        });
        if (!override)
          blockers.push(
            blocker("PRICE_BELOW_MINIMUM", `lines.${line.id}.unitPrice`),
          );
      }
    }
    // The workbook's own gate: "MATCH / READY is required before commercial
    // issue." A line the engine flagged while it was being typed must not
    // reach a customer just because nobody looked at the chip, and the
    // commercial totals have to follow from the lines they claim to sum.
    for (const line of quote.lines) {
      const snapshot =
        line.priceSnapshot !== null && typeof line.priceSnapshot === "object"
          ? (line.priceSnapshot as Record<string, unknown>)
          : null;
      const validation =
        snapshot !== null &&
        typeof snapshot.validation === "object" &&
        snapshot.validation !== null
          ? (snapshot.validation as Record<string, unknown>)
          : null;
      if (
        validation !== null &&
        typeof validation.status === "string" &&
        validation.status !== "READY"
      )
        blockers.push(blocker(`LINE_${validation.status}`, `lines.${line.id}`));
    }
    const reconciliation = reconcileQuotation({
      lines: quote.lines.map((line) => ({
        lineNo: line.lineNo,
        qty: line.qty.toNumber(),
        unitPrice: line.unitPrice.toNumber(),
        discountAmount: line.discountAmount.toNumber(),
        lineTotal: line.lineTotal.toNumber(),
      })),
      subtotal: quote.subtotalAmount.toNumber(),
      adjustmentAmount: quote.adjustmentAmount.toNumber(),
      taxAmount: quote.taxAmount.toNumber(),
      totalAmount: quote.totalAmount.toNumber(),
    });
    for (const check of reconciliation.checks) {
      if (check.verdict === "MATCH") continue;
      blockers.push(
        blocker(
          `RECONCILIATION_${check.code}`,
          check.lineNo === undefined ? null : `lines.${String(check.lineNo)}`,
        ),
      );
    }
    return blockers;
  }

  private async findCommand(
    tx: TransactionClient,
    identity: CustomerIdentity,
    operationCode: string,
    key: string,
    body: unknown,
  ) {
    const prior = await tx.commandIdempotency.findUnique({
      where: {
        actorUserId_operationCode_idempotencyKey: {
          actorUserId: identity.userId,
          operationCode,
          idempotencyKey: key,
        },
      },
    });
    if (prior && prior.requestHash !== hashOf(body))
      conflict("IDEMPOTENCY_KEY_REUSED");
    return prior;
  }
  private async rememberCommand(
    tx: TransactionClient,
    identity: CustomerIdentity,
    operationCode: string,
    key: string,
    body: unknown,
    resourceId: string,
  ) {
    await tx.commandIdempotency.create({
      data: {
        actorUserId: identity.userId,
        operationCode,
        idempotencyKey: key,
        requestHash: hashOf(body),
        responseResourceId: resourceId,
      },
    });
  }
  private async reserveCommand(
    tx: TransactionClient,
    identity: CustomerIdentity,
    operationCode: string,
    key: string,
    body: unknown,
    resourceId: string,
  ) {
    const prior = await this.findCommand(
      tx,
      identity,
      operationCode,
      key,
      body,
    );
    if (!prior)
      await this.rememberCommand(
        tx,
        identity,
        operationCode,
        key,
        body,
        resourceId,
      );
  }
  /**
   * `before` is what the quotation looked like going in.
   *
   * Without it the trail could say a quotation now totals 1,400,000 but never
   * that it had been 2,000,000 an hour earlier, so the one question anyone
   * actually asks of an audit log -- who moved this, and by how much -- had no
   * answer in it. The column was always there; nothing on this path filled it.
   * Passed only where a genuine pre-change row was read; a create has no
   * before, and inventing one would be worse than leaving it null.
   */
  private record(
    tx: TransactionClient,
    identity: CustomerIdentity,
    action: string,
    quote: QuotationAuditState,
    before?: QuotationAuditState,
  ) {
    return this.audit.record(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode: action,
      resourceType: "Quotation",
      resourceId: quote.id,
      workspace: "SALES",
      countryCode: quote.countryCode.trim(),
      ...(before === undefined
        ? {}
        : { beforeSnapshot: auditSnapshot(before) }),
      afterSnapshot: auditSnapshot(quote),
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "quotation-api",
    });
  }
}
interface QuotationAuditState {
  id: string;
  countryCode: string;
  rowVersion: bigint;
  statusCode: string;
  totalAmount: Prisma.Decimal;
}

function auditSnapshot(quote: QuotationAuditState) {
  return {
    statusCode: quote.statusCode,
    rowVersion: quote.rowVersion.toString(),
    totalAmount: quote.totalAmount.toString(),
  };
}

/* The DTO's @IsIn has already rejected anything not on the allow-list, so the
   field name reaching Prisma is one of a fixed set. `id` breaks ties, without
   which two rows updated in the same millisecond can swap places between pages
   and a quotation is shown twice or not at all. */
function quotationOrder(
  sort: string,
): Prisma.QuotationOrderByWithRelationInput[] {
  const [field, direction] = sort.split(":") as [string, "asc" | "desc"];
  return [{ [field]: direction }, { id: "asc" }];
}

function accountAccess(identity: CustomerIdentity): Prisma.AccountWhereInput[] {
  // An empty object inside `OR: [...]` does NOT mean "match everything" in
  // Prisma — it matches nothing, silently blocking SYSTEM_ADMIN from every
  // account-scoped query that spreads this into `account: { OR: accountAccess(identity) } }`.
  // `{ id: { not: "00000000-0000-0000-0000-000000000000" } }` is the idiomatic always-true stand-in.
  if (isSystemAdmin(identity))
    return [{ id: { not: "00000000-0000-0000-0000-000000000000" } }];
  const now = new Date();
  return [
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
  ];
}
function toDto(row: {
  id: string;
  quotationRef: string;
  supersedesQuotationId: string | null;
  opportunityId: string;
  accountId: string;
  projectId: string | null;
  contactId: string | null;
  countryCode: string;
  ownerUserId: string;
  statusCode: string;
  documentTypeCode: string;
  incotermCode: string | null;
  commercialStateCode: string;
  firstSubmittedAt: Date | null;
  currencyCode: string | null;
  fxRateId: string | null;
  fxRateSnapshot: Prisma.Decimal | null;
  calculationVersion: string;
  validFrom: Date | null;
  expiresOn: Date | null;
  paymentTermsSnapshot: string | null;
  paymentScheduleJson: Prisma.JsonValue | null;
  standardPricePerKgOverride: Prisma.Decimal | null;
  curvedPricePerKgOverride: Prisma.Decimal | null;
  circularPricePerKgOverride: Prisma.Decimal | null;
  densityOverrideKgM3: Prisma.Decimal | null;
  subtotalAmount: Prisma.Decimal;
  adjustmentAmount: Prisma.Decimal;
  taxAmount: Prisma.Decimal;
  totalAmount: Prisma.Decimal;
  sentAt: Date | null;
  piNumber: string | null;
  piIssuedAt: Date | null;
  subject: string | null;
  customerPoNumber: string | null;
  leadTime: string | null;
  freightAmount: Prisma.Decimal | null;
  deliveryAddress: string | null;
  portOfLoading: string | null;
  portOfDischarge: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  supersededAt: Date | null;
  rowVersion: bigint;
  fxEffectiveAtSnapshot: Date | null;
}) {
  return {
    quotationId: row.id,
    quoteRef: row.quotationRef,
    supersedesQuotationId: row.supersedesQuotationId,
    opportunityId: row.opportunityId,
    accountId: row.accountId,
    projectId: row.projectId,
    contactId: row.contactId,
    countryCode: row.countryCode.trim(),
    ownerUserId: row.ownerUserId,
    statusCode: row.statusCode,
    documentTypeCode: row.documentTypeCode,
    incotermCode: row.incotermCode,
    commercialState: row.commercialStateCode,
    firstSubmittedAt: row.firstSubmittedAt?.toISOString() ?? null,
    currencyCode: row.currencyCode?.trim() ?? "USD",
    fxRateId: row.fxRateId,
    fxRateSnapshot: row.fxRateSnapshot?.toString() ?? null,
    calculationVersion: row.calculationVersion,
    validFrom: row.validFrom?.toISOString().slice(0, 10) ?? null,
    expiresOn: row.expiresOn?.toISOString().slice(0, 10) ?? null,
    paymentTermsSnapshot: row.paymentTermsSnapshot,
    paymentScheduleJson: row.paymentScheduleJson,
    standardPricePerKgOverride:
      row.standardPricePerKgOverride?.toString() ?? null,
    curvedPricePerKgOverride: row.curvedPricePerKgOverride?.toString() ?? null,
    circularPricePerKgOverride:
      row.circularPricePerKgOverride?.toString() ?? null,
    densityOverrideKgM3: row.densityOverrideKgM3?.toString() ?? null,
    subtotalAmount: row.subtotalAmount.toString(),
    adjustmentAmount: row.adjustmentAmount.toString(),
    discountAmount: "0",
    taxAmount: row.taxAmount.toString(),
    grandTotalAmount: row.totalAmount.toString(),
    sentAt: row.sentAt?.toISOString() ?? null,
    piNumber: row.piNumber,
    piIssuedAt: row.piIssuedAt?.toISOString() ?? null,
    subject: row.subject,
    customerPoNumber: row.customerPoNumber,
    leadTime: row.leadTime,
    freightAmount: row.freightAmount?.toString() ?? null,
    deliveryAddress: row.deliveryAddress,
    portOfLoading: row.portOfLoading,
    portOfDischarge: row.portOfDischarge,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancellationReason: row.cancellationReason,
    supersededAt: row.supersededAt?.toISOString() ?? null,
    rowVersion: `"rv-${row.rowVersion.toString()}"`,
    fxEffectiveAtSnapshot: row.fxEffectiveAtSnapshot?.toISOString() ?? null,
  };
}
function requireKey(value: string | undefined): asserts value is string {
  if (!value || value.length < 8)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
}
function hashOf(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
function currency(value: string) {
  const c = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(c)) rule("INVALID_CURRENCY_CODE");
  return c;
}
function number(value: string, field: string) {
  if (!decimal.test(value.trim())) rule("INVALID_DECIMAL", field);
  return new Prisma.Decimal(value);
}
function optionalDecimal(value: string | null | undefined, field: string) {
  return value == null ? null : number(value, field);
}
function versionOf(value: string) {
  const m = /^"rv-(\d+)"$/.exec(value);
  if (!m) throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  const version = m[1];
  if (!version)
    throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  return BigInt(version);
}
function today() {
  const d = new Date();
  return new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
}
function plusDays(days: number) {
  const d = today();
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}
function day(value: string) {
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) rule("INVALID_DATE");
  return d;
}
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
function conflict(code: string): never {
  throw new ApiProblem({ status: 409, code });
}
function rule(code: string, field?: string): never {
  throw new ApiProblem({
    status: 422,
    code,
    ...(field
      ? {
          fieldErrors: [
            {
              field,
              code,
              messageKey: `errors.${code.toLowerCase()}`,
              params: {},
            },
          ],
        }
      : {}),
  });
}

function precondition(): never {
  throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
}

function blocker(code: string, field: string | null) {
  return {
    code,
    severity: "BLOCKER" as const,
    message: `errors.${code.toLowerCase()}`,
    field,
  };
}

function approvalDto(row: {
  id: string;
  quotationId: string;
  requestedByUserId: string;
  statusCode: string;
  requiredAuthorityTier: number | null;
  currentAssigneeUserId: string | null;
  requestedAt: Date;
  decidedAt: Date | null;
  quotationRowVersionSnapshot: bigint;
  contentHash: string;
  calculationVersionSnapshot: string;
  snapshot: Prisma.JsonValue | null;
  invalidatedAt: Date | null;
  invalidationReasonCode: string | null;
}) {
  return {
    approvalRequestId: row.id,
    quotationId: row.quotationId,
    requestedByUserId: row.requestedByUserId,
    statusCode: row.statusCode,
    requiredAuthorityTier: row.requiredAuthorityTier,
    currentAssigneeUserId: row.currentAssigneeUserId,
    requestedAt: row.requestedAt.toISOString(),
    resolvedAt: row.decidedAt?.toISOString() ?? null,
    quotationRowVersionSnapshot: Number(row.quotationRowVersionSnapshot),
    materialContentHash: row.contentHash,
    calculationVersionSnapshot: row.calculationVersionSnapshot,
    policySnapshotJsonb: row.snapshot ?? {},
    invalidatedAt: row.invalidatedAt?.toISOString() ?? null,
    invalidationReasonCode: row.invalidationReasonCode,
  };
}

function approvalContextDto(
  approval: Parameters<typeof approvalDto>[0],
  quote: {
    id: string;
    quotationRef: string;
    statusCode: string;
    currencyCode: string | null;
    totalAmount: Prisma.Decimal;
    account: { canonicalName: string };
    project: { name: string } | null;
  },
) {
  return {
    approvalRequest: approvalDto(approval),
    quotation: {
      quotationId: quote.id,
      quoteRef: quote.quotationRef,
      statusCode: quote.statusCode,
      currencyCode: quote.currencyCode?.trim() ?? "USD",
      grandTotalAmount: quote.totalAmount.toString(),
      customerDisplayName: quote.account.canonicalName,
      projectName: quote.project?.name ?? null,
      pricingWarnings: [],
    },
  };
}

function sendJobDto(
  row: {
    id: string;
    status: string;
    payload: Prisma.JsonValue;
    createdAt: Date;
    startedAt: Date | null;
    finishedAt: Date | null;
    errorCode: string | null;
    version: number;
    resultReference: string | null;
    sourceId: string | null;
  },
  quotationId: string,
) {
  const payload = row.payload as Record<string, unknown>;
  const statusCode =
    row.status === "PENDING"
      ? "QUEUED"
      : row.status === "PROCESSING"
        ? "RUNNING"
        : row.status === "DEAD"
          ? "FAILED"
          : row.status;
  return {
    quotationSendJobId: row.id,
    quotationId,
    candidateHash:
      typeof payload.candidateHash === "string" ? payload.candidateHash : "",
    quotationRowVersionSnapshot: Number(
      payload.quotationRowVersionSnapshot ?? 0,
    ),
    statusCode,
    documentVersionId: row.status === "SUCCEEDED" ? row.resultReference : null,
    sendEventId: null,
    createdByUserId:
      typeof payload.createdByUserId === "string"
        ? payload.createdByUserId
        : "00000000-0000-0000-0000-000000000000",
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    failureCode: row.errorCode,
    rowVersion: `"rv-${row.version.toString()}"`,
    statusUrl: `/jobs/${row.id}`,
  };
}

function acceptanceDto(row: {
  id: string;
  quotationId: string;
  evidenceTypeCode: string;
  documentId: string | null;
  externalReference: string | null;
  acceptedAt: Date;
  verifiedByUserId: string | null;
  statusCode: string;
}) {
  return {
    acceptanceId: row.id,
    quotationId: row.quotationId,
    evidenceTypeCode: row.evidenceTypeCode,
    documentId: row.documentId,
    externalReference: row.externalReference,
    acceptedAt: row.acceptedAt.toISOString(),
    verifiedByUserId: row.verifiedByUserId,
    statusCode: row.statusCode,
  };
}

function opportunityDto(row: {
  id: string;
  opportunityRef: string;
  accountId: string;
  projectId: string | null;
  countryCode: string;
  ownerUserId: string;
  stageCode: string;
  probabilityPct: Prisma.Decimal | null;
  probabilitySourceCode: string;
  estimatedValue: Prisma.Decimal | null;
  currencyCode: string | null;
  expectedCloseDate: Date | null;
  noProjectReasonCode: string | null;
  lostReasonCode: string | null;
  wonAt: Date | null;
  wonValueSnapshot: Prisma.Decimal | null;
  rowVersion: bigint;
}) {
  return {
    opportunityId: row.id,
    opportunityRef: row.opportunityRef,
    accountId: row.accountId,
    projectId: row.projectId,
    countryCode: row.countryCode.trim(),
    ownerUserId: row.ownerUserId,
    stageCode: row.stageCode,
    probabilityPct: row.probabilityPct?.toString() ?? null,
    probabilitySourceCode: row.probabilitySourceCode,
    estimatedValue: row.estimatedValue?.toString() ?? null,
    currencyCode: row.currencyCode?.trim() ?? null,
    expectedCloseDate:
      row.expectedCloseDate?.toISOString().slice(0, 10) ?? null,
    noProjectReasonCode: row.noProjectReasonCode,
    lostReasonCode: row.lostReasonCode,
    wonAt: row.wonAt?.toISOString() ?? null,
    wonValueSnapshot: row.wonValueSnapshot?.toString() ?? null,
    rowVersion: `"rv-${row.rowVersion.toString()}"`,
  };
}

function renderPreviewHtml(
  quote: {
    quotationRef: string;
    currencyCode: string | null;
    totalAmount: Prisma.Decimal;
    account: { canonicalName: string };
    lines: Array<{
      description: string;
      qty: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
    }>;
  },
  locale: string,
) {
  const entities: Record<string, string> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  };
  const escape = (value: string) =>
    value.replace(/[&<>"']/g, (char) => entities[char] ?? char);
  const rows = quote.lines
    .map(
      (line) =>
        `<tr><td>${escape(line.description)}</td><td>${line.qty.toString()}</td><td>${line.unitPrice.toString()}</td><td>${line.lineTotal.toString()}</td></tr>`,
    )
    .join("");
  return `<!doctype html><html lang="${escape(locale)}"><head><meta charset="utf-8"><title>${escape(quote.quotationRef)}</title></head><body><h1>${escape(quote.quotationRef)}</h1><p>${escape(quote.account.canonicalName)}</p><table><thead><tr><th>Item</th><th>Qty</th><th>Unit price</th><th>Total</th></tr></thead><tbody>${rows}</tbody></table><strong>${quote.totalAmount.toString()} ${escape(quote.currencyCode?.trim() ?? "USD")}</strong></body></html>`;
}

function commandBody(id: string, input: object) {
  return { id, input };
}
