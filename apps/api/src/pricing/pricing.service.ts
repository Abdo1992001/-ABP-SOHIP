import { createHash } from "node:crypto";
import { Inject, Injectable } from "@nestjs/common";
import { permissions } from "@abp/contracts";
import {
  Prisma,
  type DatabaseClient,
  type TransactionClient,
  TransactionManager,
} from "@abp/database";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { AuditService } from "../platform/audit.service.js";
import {
  databaseClientToken,
  transactionManagerToken,
} from "../platform/database.providers.js";
import {
  CalculationFormulaListQuery,
  CreateCalculationFormulaDto,
  CreateGuardrailDto,
  CreateTaxPolicyDto,
  PolicyListQuery,
  PriceOverrideDto,
  PricingResolveDto,
  CreateDocumentSubjectDto,
  UpdateCompanyPricingSettingsDto,
} from "./pricing.dto.js";
import { resourceIdOf } from "./resource-id.js";
import { deriveStandardRate } from "../quotation/engineering-pricing.js";
import { validateFormula } from "../quotation/formula-engine.js";
import { FORMULA_VARIABLE_NAMES } from "../quotation/formula-scope.js";

const decimalPattern = /^-?\d+(\.\d+)?$/;
/** One stored pricing rule, as every screen reads it. */
const formulaDto = (row: {
  id: string;
  formulaKey: string;
  displayName: string;
  arabicLabel: string | null;
  expression: string;
  description: string | null;
  rateUnitLabel: string | null;
  statusCode: string;
  sortOrder: number;
}) => ({
  calculationFormulaId: row.id,
  formulaKey: row.formulaKey,
  displayName: row.displayName,
  arabicLabel: row.arabicLabel,
  expression: row.expression,
  description: row.description,
  rateUnitLabel: row.rateUnitLabel,
  statusCode: row.statusCode,
  sortOrder: row.sortOrder,
});
const effective = (at: Date) => ({
  effectiveFrom: { lte: at },
  OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }],
});
const text = (value: Prisma.Decimal | null | undefined) =>
  value?.toString() ?? null;
const nowIso = (value: Date) => value.toISOString();

@Injectable()
export class PricingService {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    @Inject(transactionManagerToken) private readonly txs: TransactionManager,
    private readonly access: CustomerAccessService,
    private readonly audit: AuditService,
  ) {}

  async paymentTerms(identity: CustomerIdentity, query: PolicyListQuery) {
    this.access.requirePermission(identity, permissions.pricingPolicyView);
    const at = new Date();
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.PaymentTermWhereInput = {
      ...(query.active === false ? {} : { isActive: true }),
      ...effective(at),
      ...(query.search
        ? {
            OR: [
              { termCode: { contains: query.search, mode: "insensitive" } },
              { displayText: { contains: query.search, mode: "insensitive" } },
            ],
          }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.paymentTerm.count({ where }),
      this.db.paymentTerm.findMany({
        where,
        skip: offset,
        take: query.limit,
        orderBy: [{ termCode: "asc" }, { effectiveFrom: "desc" }],
      }),
    ]);
    return {
      data: rows.map((row) => ({
        paymentTermId: row.id,
        termCode: row.termCode,
        displayText: row.displayText,
        effectiveFrom: nowIso(row.effectiveFrom),
        effectiveTo: row.effectiveTo ? nowIso(row.effectiveTo) : null,
        isActive: row.isActive,
        createdByUserId: row.createdByUserId,
        createdAt: nowIso(row.createdAt),
      })),
      meta: pageMeta(offset, query.limit, total),
    };
  }

  async taxPolicies(identity: CustomerIdentity, query: PolicyListQuery) {
    this.access.requirePermission(identity, permissions.pricingPolicyView);
    const at = new Date();
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.TaxPolicyWhereInput = {
      ...(query.active === false ? {} : { statusCode: "ACTIVE" }),
      ...effective(at),
      ...(query.search
        ? { taxCode: { contains: query.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.taxPolicy.count({ where }),
      this.db.taxPolicy.findMany({
        where,
        skip: offset,
        take: query.limit,
        orderBy: [{ taxCode: "asc" }, { versionNo: "desc" }],
      }),
    ]);
    return {
      data: rows.map(taxDto),
      meta: pageMeta(offset, query.limit, total),
    };
  }

  async createTaxPolicy(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateTaxPolicyDto,
  ) {
    this.access.requirePermission(identity, permissions.pricingPolicyManage);
    requireKey(key);
    const rate = money(input.taxRatePct, "taxRatePct");
    if (rate.lessThan(0) || rate.greaterThan(100)) rule("INVALID_TAX_RATE");
    const from = date(input.effectiveFrom);
    const to = optionalDate(input.effectiveTo);
    if (to && to <= from) rule("INVALID_EFFECTIVE_RANGE");
    const code = input.taxCode.trim().toUpperCase();
    if (!code) rule("INVALID_TAX_CODE");
    return this.idempotent(
      identity,
      "post_tax_policies",
      key,
      input,
      async (tx) => {
        const latest = await tx.taxPolicy.aggregate({
          where: { taxCode: code },
          _max: { versionNo: true },
        });
        const row = await tx.taxPolicy.create({
          data: {
            taxCode: code,
            versionNo: (latest._max.versionNo ?? 0) + 1,
            taxRatePct: rate,
            effectiveFrom: from,
            effectiveTo: to,
            createdByUserId: identity.userId,
          },
        });
        await this.record(
          tx,
          identity,
          "TAX_POLICY_CREATED",
          "TaxPolicy",
          row.id,
          null,
          taxDto(row),
        );
        return taxDto(row);
      },
    );
  }

  async createGuardrail(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateGuardrailDto,
  ) {
    this.access.requirePermission(identity, permissions.pricingManage);
    requireKey(key);
    const from = date(input.effectiveFrom);
    const to = optionalDate(input.effectiveTo);
    if (to && to <= from) rule("INVALID_EFFECTIVE_RANGE");
    if (!input.productId && !input.productFamilyId)
      rule("PRICING_CONTEXT_REQUIRED");
    const min = optionalMoney(input.minPrice, "minPrice"),
      reference = optionalMoney(input.referencePrice, "referencePrice"),
      max = optionalMoney(input.maxPrice, "maxPrice");
    ordered(min, reference, max);
    const currency = currencyCode(input.currencyCode);
    return this.idempotent(
      identity,
      "post_pricing_guardrails",
      key,
      input,
      async (tx) => {
        if (input.productId) await requireProduct(tx, input.productId);
        if (input.productFamilyId)
          await requireFamily(tx, input.productFamilyId);
        const row = await tx.pricingGuardrail.create({
          data: {
            productId: input.productId ?? null,
            productFamilyId: input.productFamilyId ?? null,
            minPrice: min,
            referencePrice: reference,
            maxPrice: max,
            currencyCode: currency,
            effectiveFrom: from,
            effectiveTo: to,
            createdByUserId: identity.userId,
          },
        });
        const dto = guardrailDto(row);
        await this.record(
          tx,
          identity,
          "PRICING_GUARDRAIL_CREATED",
          "PricingGuardrail",
          row.id,
          null,
          dto,
        );
        return dto;
      },
    );
  }

  async resolve(
    identity: CustomerIdentity,
    key: string | undefined,
    input: PricingResolveDto,
  ) {
    this.access.requirePermission(identity, permissions.pricingView);
    requireKey(key);
    const qty = money(input.qty, "qty");
    if (qty.lessThanOrEqualTo(0)) rule("QUANTITY_MUST_BE_POSITIVE");
    const at = input.at ? date(input.at) : new Date();
    const currency = currencyCode(input.currencyCode);
    return this.idempotent(
      identity,
      "post_pricing_resolve",
      key,
      input,
      async (tx) => {
        const product = await tx.product.findFirst({
          where: { id: input.productId, recordStatusCode: "ACTIVE" },
          select: { id: true, productFamilyId: true },
        });
        if (!product) missing("PRODUCT_NOT_FOUND");
        const ruleRow = await tx.pricingRule.findFirst({
          where: {
            productId: product.id,
            currencyCode: currency,
            statusCode: "ACTIVE",
            ...effective(at),
          },
          orderBy: { effectiveFrom: "desc" },
        });
        const productGuardrail = await tx.pricingGuardrail.findFirst({
          where: {
            productId: product.id,
            currencyCode: currency,
            ...effective(at),
          },
          orderBy: { effectiveFrom: "desc" },
        });
        const familyGuardrail = productGuardrail
          ? null
          : await tx.pricingGuardrail.findFirst({
              where: {
                productFamilyId: product.productFamilyId,
                currencyCode: currency,
                ...effective(at),
              },
              orderBy: { effectiveFrom: "desc" },
            });
        const guardrail = productGuardrail ?? familyGuardrail;
        const min = guardrail?.minPrice ?? ruleRow?.minPrice ?? null,
          reference =
            guardrail?.referencePrice ?? ruleRow?.referencePrice ?? null,
          max = guardrail?.maxPrice ?? ruleRow?.maxPrice ?? null;
        if (!reference) missing("EFFECTIVE_PRICE_NOT_FOUND");
        ordered(min, reference, max);
        const warnings: {
          code: string;
          severity: "INFO" | "WARNING" | "BLOCKER";
          message: string;
          field?: string;
        }[] = [];
        if (max && reference.greaterThan(max))
          warnings.push({
            code: "ABOVE_MAX_PRICE",
            severity: "WARNING",
            message: "Reference price is above the configured maximum price.",
            field: "unitPrice",
          });
        const result = {
          productId: product.id,
          currencyCode: currency,
          unitPrice: reference.toString(),
          minPrice: text(min),
          referencePrice: text(reference),
          maxPrice: text(max),
          fxRateId: null,
          fxRate: null,
          fxEffectiveAt: null,
          calculationVersion: "pricing-v1",
          warnings,
        };
        await this.record(
          tx,
          identity,
          "PRICING_RESOLVED",
          "Product",
          product.id,
          null,
          {
            productId: product.id,
            qty: qty.toString(),
            currencyCode: currency,
            quotationId: input.quotationId ?? null,
          },
        );
        return result;
      },
    );
  }

  async calculationFormulas(
    identity: CustomerIdentity,
    query: CalculationFormulaListQuery,
  ) {
    this.access.requirePermission(identity, permissions.pricingView);
    const where = query.includeRetired === true ? {} : { statusCode: "ACTIVE" };
    const [total, rows] = await this.db.$transaction([
      this.db.calculationFormula.count({ where }),
      this.db.calculationFormula.findMany({
        where,
        skip: query.offset ?? 0,
        take: query.limit,
        orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
      }),
    ]);
    return {
      data: rows.map(formulaDto),
      meta: {
        offset: query.offset ?? 0,
        limit: query.limit,
        total,
        hasNext: (query.offset ?? 0) + rows.length < total,
      },
    };
  }

  /**
   * Saving a formula checks it first. The expression is evaluated against
   * every variable a quotation line provides, with each bound to 1 -- so a
   * misspelt name or a stray bracket is refused here, naming the symbol,
   * rather than silently pricing somebody's order at zero later.
   */
  async createCalculationFormula(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateCalculationFormulaDto,
  ) {
    this.access.requirePermission(identity, permissions.pricingPolicyManage);
    requireKey(key);
    return this.idempotent(
      identity,
      "post_pricing_calculation_formulas",
      key,
      input,
      async (tx) => {
        const formulaKey = input.formulaKey.trim().toLowerCase();
        if (!/^[a-z][a-z0-9_]*$/.test(formulaKey))
          rule("INVALID_FORMULA_KEY", "formulaKey");
        const check = validateFormula(input.expression, FORMULA_VARIABLE_NAMES);
        if (!check.ok) rule(`FORMULA_${check.code}`, "expression");
        const existing = await tx.calculationFormula.findUnique({
          where: { formulaKey },
        });
        if (existing) rule("CALCULATION_FORMULA_KEY_IN_USE", "formulaKey");
        const row = await tx.calculationFormula.create({
          data: {
            formulaKey,
            displayName: input.displayName.trim(),
            arabicLabel: input.arabicLabel?.trim() ?? null,
            expression: input.expression.trim(),
            description: input.description?.trim() ?? null,
            rateUnitLabel: input.rateUnitLabel?.trim() ?? null,
            sortOrder: input.sortOrder ?? 100,
            createdByUserId: identity.userId,
          },
        });
        await this.record(
          tx,
          identity,
          "CALCULATION_FORMULA_CREATED",
          "CALCULATION_FORMULA",
          row.id,
          null,
          formulaDto(row),
        );
        return formulaDto(row);
      },
    );
  }

  /**
   * Retiring hides a rule from the picker without deleting it. Quotations
   * already priced by it keep their snapshot, and the audit trail keeps the
   * expression that produced those numbers.
   */
  async retireCalculationFormula(
    identity: CustomerIdentity,
    formulaKey: string,
    key: string | undefined,
  ) {
    this.access.requirePermission(identity, permissions.pricingPolicyManage);
    requireKey(key);
    return this.idempotent(
      identity,
      "post_pricing_calculation_formulas_retire",
      key,
      { formulaKey },
      async (tx) => {
        const row = await tx.calculationFormula.findUnique({
          where: { formulaKey: formulaKey.trim().toLowerCase() },
        });
        if (!row) missing("CALCULATION_FORMULA_NOT_FOUND");
        const updated = await tx.calculationFormula.update({
          where: { id: row.id },
          data: { statusCode: "RETIRED" },
        });
        await this.record(
          tx,
          identity,
          "CALCULATION_FORMULA_RETIRED",
          "CALCULATION_FORMULA",
          row.id,
          formulaDto(row),
          formulaDto(updated),
        );
        return formulaDto(updated);
      },
    );
  }

  /**
   * The subject lines a document can carry.
   *
   * Default first, then the company's own order, then alphabetically -- so the
   * subject nine offers in ten want is the one already selected and nobody
   * scrolls for it.
   */
  async documentSubjects(identity: CustomerIdentity, query: PolicyListQuery) {
    this.access.requirePermission(identity, permissions.quotationsView);
    const offset = query.offset ?? (query.page - 1) * query.limit;
    const where: Prisma.DocumentSubjectWhereInput = {
      ...(query.active === false ? {} : { isActive: true }),
      ...(query.search
        ? { subjectText: { contains: query.search, mode: "insensitive" } }
        : {}),
    };
    const [total, rows] = await this.db.$transaction([
      this.db.documentSubject.count({ where }),
      this.db.documentSubject.findMany({
        where,
        skip: offset,
        take: query.limit,
        orderBy: [
          { isDefault: "desc" },
          { sortOrder: "asc" },
          { subjectText: "asc" },
        ],
      }),
    ]);
    return {
      data: rows.map(subjectDto),
      meta: pageMeta(offset, query.limit, total),
    };
  }

  /**
   * Add a subject, once, for everybody.
   *
   * A subject that is already on the list -- in any casing -- is returned
   * rather than added again: the person typing it wants that subject selected,
   * and a second row differing only in capitals is how a list stops being
   * usable. Adding one needs only `quotations.edit`, because the person who
   * needs a new subject is the person writing the offer, and sending them to
   * an administrator is how they end up typing it into a spreadsheet instead.
   */
  async createDocumentSubject(
    identity: CustomerIdentity,
    key: string | undefined,
    input: CreateDocumentSubjectDto,
  ) {
    this.access.requirePermission(identity, permissions.quotationsEdit);
    requireKey(key);
    const text = input.subjectText.trim();
    if (text.length < 2) rule("INVALID_DOCUMENT_SUBJECT", "subjectText");
    return this.idempotent(
      identity,
      "post_document_subjects",
      key,
      { subjectText: text },
      async (tx) => {
        const existing = await tx.documentSubject.findFirst({
          where: { subjectText: { equals: text, mode: "insensitive" } },
        });
        if (existing) {
          // Retired once, wanted again: reactivate rather than refuse, so the
          // list cannot get stuck with a subject nobody can select.
          if (existing.isActive) return subjectDto(existing);
          const revived = await tx.documentSubject.update({
            where: { id: existing.id },
            data: { isActive: true },
          });
          return subjectDto(revived);
        }
        const row = await tx.documentSubject.create({
          data: {
            subjectText: text,
            // The default stays whatever it already is: adding a subject is
            // not a decision to make it the one every new offer starts with.
            isDefault: false,
            sortOrder: 100,
            createdByUserId: identity.userId,
          },
        });
        const dto = subjectDto(row);
        await this.record(
          tx,
          identity,
          "DOCUMENT_SUBJECT_ADDED",
          "DocumentSubject",
          row.id,
          null,
          dto,
        );
        return dto;
      },
    );
  }

  async basis(identity: CustomerIdentity) {
    this.access.requirePermission(identity, permissions.pricingView);
    const at = new Date();
    const row = await this.db.pricingBaseConfig.findFirst({
      where: effective(at),
      orderBy: { effectiveFrom: "desc" },
    });
    if (!row) missing("STANDARD_BOARD_BASIS_NOT_FOUND");
    if (row.standardWeightKg.lessThanOrEqualTo(0))
      rule("INVALID_STANDARD_BOARD_WEIGHT");
    // The formula library rides along with the defaults: every screen that
    // needs one already needs the other, and a second round trip to populate
    // a dropdown is a second thing that can be slow or fail.
    const formulas = await this.db.calculationFormula.findMany({
      where: { statusCode: "ACTIVE" },
      orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }],
      take: 200,
    });
    return {
      data: {
        ...basisDto(row),
        calculationFormulas: formulas.map((formula) => ({
          formulaKey: formula.formulaKey,
          displayName: formula.displayName,
          arabicLabel: formula.arabicLabel,
          expression: formula.expression,
          description: formula.description,
          rateUnitLabel: formula.rateUnitLabel,
        })),
      },
    };
  }

  async updateBasis(
    identity: CustomerIdentity,
    key: string | undefined,
    input: UpdateCompanyPricingSettingsDto,
  ) {
    this.access.requirePermission(identity, permissions.pricingPolicyManage);
    requireKey(key);
    return this.idempotent(
      identity,
      "post_pricing_standard_board_basis",
      key,
      input,
      async (tx) => {
        const at = new Date();
        const previous = await tx.pricingBaseConfig.findFirst({
          where: effective(at),
          orderBy: { effectiveFrom: "desc" },
        });
        const referenceBoard = {
          referenceBoardWidthMm:
            optionalMoney(
              input.referenceBoardWidthMm,
              "referenceBoardWidthMm",
            ) ??
            previous?.referenceBoardWidthMm ??
            new Prisma.Decimal("1220"),
          referenceBoardLengthMm:
            optionalMoney(
              input.referenceBoardLengthMm,
              "referenceBoardLengthMm",
            ) ??
            previous?.referenceBoardLengthMm ??
            new Prisma.Decimal("2440"),
          defaultThicknessMm:
            optionalMoney(input.defaultThicknessMm, "defaultThicknessMm") ??
            previous?.defaultThicknessMm ??
            new Prisma.Decimal("18"),
          defaultDensityKgM3:
            optionalMoney(input.defaultDensityKgM3, "defaultDensityKgM3") ??
            previous?.defaultDensityKgM3 ??
            new Prisma.Decimal("600"),
        };
        const standardPricePerKgInput = optionalMoney(
          input.standardPricePerKg,
          "standardPricePerKg",
        );
        const standardBoardPriceInput = optionalMoney(
          input.standardBoardPrice,
          "standardBoardPrice",
        );
        if (standardPricePerKgInput && standardBoardPriceInput)
          rule("STANDARD_RATE_INPUT_MODE_CONFLICT");
        const derived = standardBoardPriceInput
          ? deriveStandardRate({
              mode: "BOARD_PRICE",
              standardBoardPrice: standardBoardPriceInput,
              referenceBoard,
            })
          : deriveStandardRate({
              mode: "PRICE_PER_KG",
              standardPricePerKg:
                standardPricePerKgInput ??
                previous?.standardPricePerKg ??
                new Prisma.Decimal("90"),
              referenceBoard,
            });
        const curvedPricePerKg =
          optionalMoney(input.curvedPricePerKg, "curvedPricePerKg") ??
          previous?.curvedPricePerKg ??
          new Prisma.Decimal("120");
        const circularPricePerKg =
          optionalMoney(input.circularPricePerKg, "circularPricePerKg") ??
          previous?.circularPricePerKg ??
          new Prisma.Decimal("120");
        const defaultDiscountPct =
          optionalMoney(input.defaultDiscountPct, "defaultDiscountPct") ??
          previous?.defaultDiscountPct ??
          new Prisma.Decimal("0");
        // The workbook's MASTER SETTINGS takeoff figures. The closure
        // allowance is the one that moves money: it makes a rectangular
        // column's faces A / B / A+allowance / B+allowance.
        const takeoff = {
          maxPanelWidthMm:
            optionalMoney(input.maxPanelWidthMm, "maxPanelWidthMm") ??
            previous?.maxPanelWidthMm ??
            new Prisma.Decimal("1220"),
          maxPanelLengthMm:
            optionalMoney(input.maxPanelLengthMm, "maxPanelLengthMm") ??
            previous?.maxPanelLengthMm ??
            new Prisma.Decimal("2000"),
          defaultColumnHeightMm:
            optionalMoney(
              input.defaultColumnHeightMm,
              "defaultColumnHeightMm",
            ) ??
            previous?.defaultColumnHeightMm ??
            new Prisma.Decimal("4000"),
          columnClosureAllowanceMm:
            optionalMoney(
              input.columnClosureAllowanceMm,
              "columnClosureAllowanceMm",
            ) ??
            previous?.columnClosureAllowanceMm ??
            new Prisma.Decimal("20"),
        };
        for (const [field, value] of [
          ["maxPanelWidthMm", takeoff.maxPanelWidthMm],
          ["maxPanelLengthMm", takeoff.maxPanelLengthMm],
          ["defaultColumnHeightMm", takeoff.defaultColumnHeightMm],
        ] as const)
          if (value.lessThanOrEqualTo(0))
            rule(`INVALID_${field.toUpperCase()}`, field);
        // A zero closure allowance is legitimate -- a column detailed with
        // butt joints has no lap -- but a negative one is not.
        if (takeoff.columnClosureAllowanceMm.lessThan(0))
          rule("INVALID_COLUMNCLOSUREALLOWANCEMM", "columnClosureAllowanceMm");
        for (const [field, value] of [
          ["standardPricePerKg", derived.standardPricePerKg],
          ["curvedPricePerKg", curvedPricePerKg],
          ["circularPricePerKg", circularPricePerKg],
          ["defaultDensityKgM3", referenceBoard.defaultDensityKgM3],
        ] as const)
          if (value.lessThanOrEqualTo(0))
            rule(`INVALID_${field.toUpperCase()}`, field);
        if (
          defaultDiscountPct.lessThan(0) ||
          defaultDiscountPct.greaterThan(100)
        )
          rule("INVALID_DEFAULT_DISCOUNT_PCT", "defaultDiscountPct");

        if (previous)
          await tx.pricingBaseConfig.update({
            where: { id: previous.id },
            data: { effectiveTo: at },
          });
        const row = await tx.pricingBaseConfig.create({
          data: {
            standardBoardPrice: derived.standardBoardPrice,
            currencyCode: previous?.currencyCode ?? "EGP",
            standardWeightKg: derived.boardWeightKg,
            standardPricePerKg: derived.standardPricePerKg,
            curvedPricePerKg,
            circularPricePerKg,
            defaultDensityKgM3: referenceBoard.defaultDensityKgM3,
            defaultThicknessMm: referenceBoard.defaultThicknessMm,
            referenceBoardWidthMm: referenceBoard.referenceBoardWidthMm,
            referenceBoardLengthMm: referenceBoard.referenceBoardLengthMm,
            defaultDiscountPct,
            ...takeoff,
            // Carried forward, not dropped. `updateBasis` writes a *new*
            // versioned row, so anything the previous row held and this one
            // does not is silently lost -- and editing a price per kilo was
            // blanking the delivery wording on every document that followed.
            // The sales engineer and the mobile are the writer's and are read
            // from their profile; these columns only ever held a fallback.
            documentSalesEngineer: previous?.documentSalesEngineer ?? null,
            documentMobile: previous?.documentMobile ?? null,
            documentDeliveryTerms:
              input.documentDeliveryTerms !== undefined
                ? blankToNull(input.documentDeliveryTerms)
                : (previous?.documentDeliveryTerms ?? null),
            documentDeliveryPoint:
              input.documentDeliveryPoint !== undefined
                ? blankToNull(input.documentDeliveryPoint)
                : (previous?.documentDeliveryPoint ?? null),
            documentOfferValidity:
              input.documentOfferValidity !== undefined
                ? blankToNull(input.documentOfferValidity)
                : (previous?.documentOfferValidity ?? null),
            effectiveFrom: at,
            createdByUserId: identity.userId,
          },
        });
        const dto = basisDto(row);
        await this.record(
          tx,
          identity,
          "COMPANY_PRICING_SETTINGS_UPDATED",
          "PricingBaseConfig",
          row.id,
          previous ? basisDto(previous) : null,
          dto,
        );
        return dto;
      },
    );
  }

  async requestOverride(
    identity: CustomerIdentity,
    key: string | undefined,
    input: PriceOverrideDto,
  ) {
    this.access.requirePermission(identity, permissions.pricingOverrideMin);
    requireKey(key);
    const expected = rowVersion(input.expectedRowVersion);
    const requested = money(input.requestedUnitPrice, "requestedUnitPrice");
    if (!input.reason.trim()) rule("OVERRIDE_REASON_REQUIRED");
    return this.idempotent(
      identity,
      "post_pricing_manager_overrides",
      key,
      input,
      async (tx) => {
        const quotation = await tx.quotation.findUnique({
          where: { id: input.quotationId },
          select: {
            id: true,
            countryCode: true,
            statusCode: true,
            currencyCode: true,
            rowVersion: true,
          },
        });
        if (!quotation) missing("QUOTATION_NOT_FOUND");
        this.access.requireCountry(identity, quotation.countryCode.trim());
        if (quotation.statusCode !== "DRAFT")
          rule("PRICE_OVERRIDE_REQUIRES_DRAFT");
        if (quotation.rowVersion !== expected)
          throw new ApiProblem({ status: 412, code: "PRECONDITION_FAILED" });
        const line = input.quotationLineId
          ? await tx.quotationLine.findFirst({
              where: { id: input.quotationLineId, quotationId: quotation.id },
              select: { id: true, productId: true },
            })
          : null;
        if (input.quotationLineId && !line) missing("QUOTATION_LINE_NOT_FOUND");
        if (!line?.productId) rule("PRICE_OVERRIDE_PRODUCT_REQUIRED");
        const pricing = await tx.pricingRule.findFirst({
          where: {
            productId: line.productId,
            currencyCode: quotation.currencyCode ?? "",
            statusCode: "ACTIVE",
            ...effective(new Date()),
          },
          orderBy: { effectiveFrom: "desc" },
        });
        if (!pricing) missing("EFFECTIVE_PRICE_NOT_FOUND");
        if (!requested.lessThan(pricing.minPrice))
          rule("PRICE_OVERRIDE_NOT_REQUIRED");
        const row = await tx.priceOverride.create({
          data: {
            quotationId: quotation.id,
            quotationLineId: line.id,
            requestedBelowMinPrice: requested,
            minPriceSnapshot: pricing.minPrice,
            currencyCode: pricing.currencyCode,
            reason: input.reason.trim(),
            requestedByUserId: identity.userId,
          },
        });
        const dto = overrideDto(row);
        await this.record(
          tx,
          identity,
          "PRICE_OVERRIDE_REQUESTED",
          "PriceOverride",
          row.id,
          null,
          dto,
          quotation.countryCode.trim(),
        );
        return dto;
      },
    );
  }

  private async idempotent<T>(
    identity: CustomerIdentity,
    operation: string,
    key: string,
    input: unknown,
    work: (tx: TransactionClient) => Promise<T>,
  ): Promise<{ data: T }> {
    const hash = createHash("sha256")
      .update(JSON.stringify(input))
      .digest("hex");
    return this.txs.run(identity, async (tx) => {
      const previous = await tx.commandIdempotency.findUnique({
        where: {
          actorUserId_operationCode_idempotencyKey: {
            actorUserId: identity.userId,
            operationCode: operation,
            idempotencyKey: key,
          },
        },
      });
      if (previous) {
        if (previous.requestHash !== hash)
          throw new ApiProblem({ status: 409, code: "IDEMPOTENCY_KEY_REUSED" });
        throw new ApiProblem({
          status: 409,
          code: "IDEMPOTENT_REPLAY_REQUIRES_GET",
        });
      }
      const data = await work(tx);
      const resourceId = resourceIdOf(data);
      await tx.commandIdempotency.create({
        data: {
          actorUserId: identity.userId,
          operationCode: operation,
          idempotencyKey: key,
          requestHash: hash,
          responseResourceId: resourceId,
        },
      });
      return { data };
    });
  }
  private record(
    tx: TransactionClient,
    identity: CustomerIdentity,
    actionCode: string,
    resourceType: string,
    resourceId: string,
    beforeSnapshot: Record<string, unknown> | null,
    afterSnapshot: Record<string, unknown>,
    countryCode: string | null = null,
  ) {
    return this.audit.record(tx, {
      actorUserId: identity.userId,
      actorSessionId: identity.sessionId,
      actionCode,
      resourceType,
      resourceId,
      workspace: "SALES",
      countryCode,
      beforeSnapshot,
      afterSnapshot,
      traceId: identity.traceId,
      correlationId: identity.correlationId,
      source: "pricing-api",
    });
  }
}

function pageMeta(offset: number, limit: number, total: number) {
  return {
    page: Math.floor(offset / limit) + 1,
    offset,
    limit,
    total,
    hasNext: offset + limit < total,
  };
}
/**
 * A box someone emptied means "there is nothing here", not "there is a space
 * here": a whitespace delivery term prints as a blank line that looks filled.
 */
function blankToNull(value: string | null): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}
function subjectDto(row: {
  id: string;
  subjectText: string;
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: Date;
}) {
  return {
    documentSubjectId: row.id,
    subjectText: row.subjectText,
    isDefault: row.isDefault,
    isActive: row.isActive,
    sortOrder: row.sortOrder,
    createdAt: nowIso(row.createdAt),
  };
}
function basisDto(row: {
  id: string;
  standardBoardPrice: Prisma.Decimal;
  currencyCode: string;
  standardWeightKg: Prisma.Decimal;
  standardPricePerKg: Prisma.Decimal | null;
  curvedPricePerKg: Prisma.Decimal | null;
  circularPricePerKg: Prisma.Decimal | null;
  defaultDensityKgM3: Prisma.Decimal | null;
  defaultThicknessMm: Prisma.Decimal | null;
  referenceBoardWidthMm: Prisma.Decimal | null;
  referenceBoardLengthMm: Prisma.Decimal | null;
  defaultDiscountPct: Prisma.Decimal | null;
  maxPanelWidthMm: Prisma.Decimal | null;
  maxPanelLengthMm: Prisma.Decimal | null;
  defaultColumnHeightMm: Prisma.Decimal | null;
  columnClosureAllowanceMm: Prisma.Decimal | null;
  documentSalesEngineer: string | null;
  documentMobile: string | null;
  documentDeliveryTerms: string | null;
  documentDeliveryPoint: string | null;
  documentOfferValidity: string | null;
  effectiveFrom: Date;
}) {
  return {
    pricingBaseConfigId: row.id,
    standardBoardPrice: row.standardBoardPrice.toString(),
    currencyCode: row.currencyCode.trim(),
    standardWeightKg: row.standardWeightKg.toString(),
    derivedKgRate: row.standardBoardPrice.div(row.standardWeightKg).toString(),
    standardPricePerKg: text(row.standardPricePerKg),
    curvedPricePerKg: text(row.curvedPricePerKg),
    maxPanelWidthMm: text(row.maxPanelWidthMm),
    maxPanelLengthMm: text(row.maxPanelLengthMm),
    defaultColumnHeightMm: text(row.defaultColumnHeightMm),
    columnClosureAllowanceMm: text(row.columnClosureAllowanceMm),
    documentSalesEngineer: row.documentSalesEngineer,
    documentMobile: row.documentMobile,
    documentDeliveryTerms: row.documentDeliveryTerms,
    documentDeliveryPoint: row.documentDeliveryPoint,
    documentOfferValidity: row.documentOfferValidity,
    circularPricePerKg: text(row.circularPricePerKg),
    defaultDensityKgM3: text(row.defaultDensityKgM3),
    defaultThicknessMm: text(row.defaultThicknessMm),
    referenceBoardWidthMm: text(row.referenceBoardWidthMm),
    referenceBoardLengthMm: text(row.referenceBoardLengthMm),
    defaultDiscountPct: text(row.defaultDiscountPct),
    effectiveAt: nowIso(row.effectiveFrom),
  };
}
function taxDto(row: {
  id: string;
  taxCode: string;
  versionNo: number;
  taxRatePct: Prisma.Decimal;
  effectiveFrom: Date;
  effectiveTo: Date | null;
  statusCode: string;
  createdByUserId: string;
  createdAt: Date;
}) {
  return {
    taxPolicyId: row.id,
    taxCode: row.taxCode,
    versionNo: row.versionNo,
    taxRatePct: row.taxRatePct.toString(),
    effectiveFrom: nowIso(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? nowIso(row.effectiveTo) : null,
    statusCode: row.statusCode,
    createdByUserId: row.createdByUserId,
    createdAt: nowIso(row.createdAt),
  };
}
function guardrailDto(row: {
  id: string;
  productId: string | null;
  productFamilyId: string | null;
  minPrice: Prisma.Decimal | null;
  referencePrice: Prisma.Decimal | null;
  maxPrice: Prisma.Decimal | null;
  currencyCode: string;
  effectiveFrom: Date;
  effectiveTo: Date | null;
}) {
  return {
    guardrailId: row.id,
    productId: row.productId,
    productFamilyId: row.productFamilyId,
    minPrice: text(row.minPrice),
    referencePrice: text(row.referencePrice),
    maxPrice: text(row.maxPrice),
    currencyCode: row.currencyCode.trim(),
    effectiveFrom: nowIso(row.effectiveFrom),
    effectiveTo: row.effectiveTo ? nowIso(row.effectiveTo) : null,
  };
}
function overrideDto(row: {
  id: string;
  quotationId: string;
  quotationLineId: string | null;
  requestedBelowMinPrice: Prisma.Decimal;
  minPriceSnapshot: Prisma.Decimal;
  currencyCode: string;
  reason: string;
  statusCode: string;
  approvalRequestId: string | null;
  requestedByUserId: string;
  requestedAt: Date;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  appliedAt: Date | null;
  rowVersion: bigint;
}) {
  return {
    pricingOverrideId: row.id,
    quotationId: row.quotationId,
    quotationLineId: row.quotationLineId,
    requestedBelowMinPrice: row.requestedBelowMinPrice.toString(),
    minPriceSnapshot: row.minPriceSnapshot.toString(),
    currencyCode: row.currencyCode.trim(),
    reason: row.reason,
    statusCode: row.statusCode,
    approvalRequestId: row.approvalRequestId,
    requestedByUserId: row.requestedByUserId,
    requestedAt: nowIso(row.requestedAt),
    approvedByUserId: row.approvedByUserId,
    approvedAt: row.approvedAt ? nowIso(row.approvedAt) : null,
    appliedAt: row.appliedAt ? nowIso(row.appliedAt) : null,
    rowVersion: row.rowVersion.toString(),
  };
}
function money(value: string, field: string) {
  if (!decimalPattern.test(value.trim())) rule("INVALID_DECIMAL", field);
  try {
    return new Prisma.Decimal(value);
  } catch {
    rule("INVALID_DECIMAL", field);
  }
}
function optionalMoney(value: string | null | undefined, field: string) {
  return value == null ? null : money(value, field);
}
function ordered(
  min: Prisma.Decimal | null,
  reference: Prisma.Decimal | null,
  max: Prisma.Decimal | null,
) {
  if (
    (min && min.lessThan(0)) ||
    (reference && reference.lessThan(0)) ||
    (max && max.lessThan(0)) ||
    (min && reference && min.greaterThan(reference)) ||
    (reference && max && reference.greaterThan(max)) ||
    (min && max && min.greaterThan(max))
  )
    rule("INVALID_PRICE_GUARDRAIL");
}
function currencyCode(value: string) {
  const code = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) rule("INVALID_CURRENCY_CODE");
  return code;
}
function date(value: string) {
  const result = new Date(value);
  if (Number.isNaN(result.getTime())) rule("INVALID_DATE");
  return result;
}
function optionalDate(value: string | null | undefined) {
  return value == null ? null : date(value);
}
function rowVersion(value: string) {
  if (!/^\d+$/.test(value))
    throw new ApiProblem({ status: 428, code: "IF_MATCH_REQUIRED" });
  return BigInt(value);
}
function requireKey(value: string | undefined): asserts value is string {
  if (!value || value.trim().length < 8 || value.length > 200)
    throw new ApiProblem({ status: 400, code: "IDEMPOTENCY_KEY_REQUIRED" });
}
async function requireProduct(tx: TransactionClient, id: string) {
  if (!(await tx.product.findUnique({ where: { id }, select: { id: true } })))
    missing("PRODUCT_NOT_FOUND");
}
async function requireFamily(tx: TransactionClient, id: string) {
  if (
    !(await tx.productFamily.findUnique({
      where: { id },
      select: { id: true },
    }))
  )
    missing("PRODUCT_FAMILY_NOT_FOUND");
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
function missing(code: string): never {
  throw new ApiProblem({ status: 404, code });
}
