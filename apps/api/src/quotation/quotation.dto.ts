import { Type } from "class-transformer";
import {
  IsArray,
  IsDefined,
  ArrayMaxSize,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
  IsBoolean,
  IsIn,
  IsEmail,
  MinLength,
} from "class-validator";

export class QuoteLineDto {
  @IsOptional() @IsUUID() quotationLineId?: string | null;
  @IsOptional() @IsUUID() productId?: string | null;
  @IsOptional() @IsString() @MaxLength(120) sectionLabel?: string | null;
  @IsString() @MaxLength(2000) description!: string;
  @IsString() @MaxLength(40) qty!: string;
  @IsString() @MaxLength(30) unitCode!: string;
  @IsOptional() @IsString() @MaxLength(40) unitPrice?: string | null;
  @IsOptional() @IsString() @MaxLength(40) discountAmount?: string | null;
  // Engineering pricing (opt-in): when pricingMethodCode is set and unitPrice
  // is omitted, quotation.service.ts computes unitPrice from these dimension
  // inputs instead of requiring a manually typed price. See engineering-pricing.ts.
  @IsOptional() @IsIn(["LINEAR", "WEIGHT_BASED"]) pricingMethodCode?:
    "LINEAR" | "WEIGHT_BASED" | null;
  @IsOptional() @IsString() @MaxLength(40) lengthMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) widthMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) thicknessMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) densityKgM3?: string | null;
  @IsOptional() @IsString() @MaxLength(40) pricePerKg?: string | null;
  // ACROW BOARD pricing hierarchy (opt-in, supersedes pricingMethodCode when
  // set): materialClass selects which company-default/quotation-override
  // rate resolves for this line — see pricing-hierarchy.ts. pricePerKg above
  // remains the item-level override, highest priority in that hierarchy.
  @IsOptional()
  @IsIn(["STANDARD", "REGULAR", "CURVED", "CIRCULAR", "CORE", "WALL"])
  materialClass?:
    "STANDARD" | "REGULAR" | "CURVED" | "CIRCULAR" | "CORE" | "WALL" | null;
  @IsOptional() @IsIn(["COLUMN", "CORE", "WALL", "SLAB", "CUSTOM"]) category?:
    string | null;
  @IsOptional() @IsString() @MaxLength(60) reference?: string | null;
  @IsOptional() @IsString() @MaxLength(60) cadMark?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  // Circular column engine inputs — see circular-column.ts. Only diameterMm
  // (or radiusMm) + columnHeightMm are required; the rest default from
  // company settings.
  @IsOptional() @IsString() @MaxLength(40) diameterMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) radiusMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) columnHeightMm?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) mouldSegments?:
    number | null;
  @IsOptional() @IsString() @MaxLength(40) arcModuleMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) verticalCourseMm?: string | null;
  /* Rectangular column geometry. The workbook's rule is that a column of
     A x B is cut as A / B / A+closure / B+closure -- the two closing panels
     lap the thickness of their neighbours (column-faces.ts). An IRREGULAR
     column skips the rule and names its faces off the drawing instead. */
  @IsOptional() @IsIn(["RECTANGULAR", "IRREGULAR"]) columnShape?:
    "RECTANGULAR" | "IRREGULAR" | null;
  @IsOptional() @IsString() @MaxLength(40) sideAMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) sideBMm?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(6)
  @IsString({ each: true })
  @MaxLength(40, { each: true })
  faceWidthsMm?: string[] | null;
  @IsOptional() @IsString() @MaxLength(40) maxPanelWidthMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) maxPanelLengthMm?: string | null;
  /* Which faces the drawing marks as curved, numbered from 1. A core with
     two curved faces is two rates on one element, so those panels are
     charged at the curved rate and the rest at the class rate. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Type(() => Number)
  @IsInt({ each: true })
  @Min(1, { each: true })
  curvedFaceNumbers?: number[] | null;
  /* How many faces the drawing is expected to have, so a core entered with
     nineteen of its twenty is caught while it is being typed. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(20) expectedFaces?:
    number | null;
  /* The span this item has to cover, in metres. The sheet turns it into a
     board count with ceil(extension / 2.44) and multiplies Linear rows by it.
     Optional: leave it out and the entered quantity is priced as entered. */
  @IsOptional() @IsString() @MaxLength(40) extensionLengthM?: string | null;
  @IsOptional() @IsIn(["EXTENSION", "DIRECT"]) quantityMode?:
    "EXTENSION" | "DIRECT" | null;
  /* Let the server name the line. The canonical ACROW name is thickness x
     width x length, then the family, then the diameter (board-descriptor.ts);
     typing it by hand is how two lines for the same product end up reading
     differently on the same page. Off by default so a line someone
     deliberately worded keeps its wording. */
  @IsOptional() @IsBoolean() autoDescribe?: boolean;
  /* A pricing rule stored as data, selected by key from calculation_formulas.
     ACROW does not only sell by the kilogram -- by m2, by m3, by linear metre,
     a flat price per piece, weight plus fabrication. The expression is
     evaluated by formula-engine.ts over this line's own dimensions; formulaRate
     is the rate it reads, in whatever unit that formula says. */
  @IsOptional() @IsString() @MaxLength(80) customFormulaKey?: string | null;
  @IsOptional() @IsString() @MaxLength(40) formulaRate?: string | null;
  @IsOptional() @IsString() @MaxLength(40) fabricationCost?: string | null;
  @IsOptional() @IsString() @MaxLength(40) fixedCost?: string | null;
}
export class QuoteAdjustmentDto {
  @IsString() @MaxLength(80) typeCode!: string;
  @IsString() @MaxLength(30) modeCode!: string;
  @IsString() @MaxLength(40) value!: string;
  @IsOptional() @IsString() @MaxLength(500) label?: string | null;
}
export class SaveQuotationDraftDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteLineDto)
  lines!: QuoteLineDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuoteAdjustmentDto)
  adjustments?: QuoteAdjustmentDto[];
  @IsOptional() @IsString() @MaxLength(100) paymentTermsCode?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) customPaymentTerms?: string | null;
  // Payment schedule (opt-in, alternative to paymentTermsCode): advance % +
  // N equal installments. When paymentScheduleCode is set, the server
  // computes and persists the exact per-row amounts/due dates/prose from
  // the quotation's own grand total — see payment-schedule.ts.
  @IsOptional() @IsIn(["ADVANCE_INSTALLMENTS"]) paymentScheduleCode?:
    "ADVANCE_INSTALLMENTS" | null;
  @IsOptional() @IsString() @MaxLength(10) advancePct?: string | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(60) installments?:
    number | null;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(365) frequencyDays?:
    number | null;
  @IsOptional() @IsDateString() referenceDate?: string | null;
  @IsOptional()
  @IsIn(["CHEQUE", "BANK_TRANSFER", "CASH", "LC"])
  paymentMethod?: string | null;
  @IsOptional() @IsDateString() validFrom?: string | null;
  @IsOptional() @IsDateString() expiresOn?: string | null;
  @IsOptional()
  @IsIn(["QUOTATION", "PROFORMA_INVOICE"])
  documentTypeCode?: string;
  @IsOptional() @IsIn(["DDP", "CIF", "FOB"]) incotermCode?: string | null;
  /**
   * The shipping block. Which of these is meaningful depends on the incoterm:
   * DDP delivers to the customer's site, CIF to the customer's port, FOB hands
   * over at ours. All three are stored so that changing the incoterm does not
   * destroy an address someone already typed.
   */
  @IsOptional() @IsString() @MaxLength(500) deliveryAddress?: string | null;
  @IsOptional() @IsString() @MaxLength(200) portOfLoading?: string | null;
  @IsOptional() @IsString() @MaxLength(200) portOfDischarge?: string | null;
  @IsOptional() @IsUUID() contactId?: string | null;
  /**
   * What this offer is for, and what this particular shipment is.
   *
   * The subject is chosen from the company-wide list
   * (GET /document-subjects) so it reads the same on every document.
   * The other three genuinely belong to the shipment rather than to
   * the customer: the same customer's next order has a different
   * purchase-order number, lead time and freight cost.
   */
  @IsOptional() @IsString() @MaxLength(300) subject?: string | null;
  @IsOptional() @IsString() @MaxLength(100) customerPoNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(200) leadTime?: string | null;
  @IsOptional() @IsString() @MaxLength(40) freightAmount?: string | null;
  // Quotation-level pricing overrides (hierarchy: item override > these >
  // company default). Never mutate company defaults — see pricing-hierarchy.ts.
  @IsOptional() @IsString() @MaxLength(40) standardPricePerKgOverride?:
    string | null;
  @IsOptional() @IsString() @MaxLength(40) curvedPricePerKgOverride?:
    string | null;
  @IsOptional() @IsString() @MaxLength(40) circularPricePerKgOverride?:
    string | null;
  @IsOptional() @IsString() @MaxLength(40) densityOverrideKgM3?: string | null;
}
export class CreateQuotationDto {
  @IsUUID() opportunityId!: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(3) currencyCode?: string | null;
  /**
   * The complete first version of the quotation.
   *
   * Creation and pricing are one command so a failed calculation can never
   * leave a numbered, empty DRAFT behind.
   */
  @IsDefined()
  @ValidateNested()
  @Type(() => SaveQuotationDraftDto)
  draft!: SaveQuotationDraftDto;
}
/* The contract has always declared a `sort` parameter on GET /quotations, and
   every screen that lists quotations sends one. This DTO did not accept it, so
   with forbidNonWhitelisted every sorted request came back 400 — including the
   Sales overview's own quotation panel, which is why the dashboard looked
   empty. The allowed values mirror the opportunity list's. */
const sorts = [
  "quotationRef:asc",
  "quotationRef:desc",
  "statusCode:asc",
  "statusCode:desc",
  "validUntil:asc",
  "validUntil:desc",
  "updatedAt:asc",
  "updatedAt:desc",
] as const;

export class QuotationListQuery {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(sorts) sort = "updatedAt:desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}

export class SupersedeQuotationDto {
  @IsString() @MaxLength(40) expectedRowVersion!: string;
  @IsOptional() copyRecipients?: boolean;
}
export class VersionedQuotationCommandDto {
  @IsString() @MaxLength(40) expectedRowVersion!: string;
}
export class RequestQuotationApprovalDto extends VersionedQuotationCommandDto {
  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;
}
export class QuotationPreviewDto extends VersionedQuotationCommandDto {
  @IsOptional() @IsString() @MaxLength(20) locale?: string | null;
}
export class SendRecipientDto {
  @IsOptional() @IsUUID() contactId?: string | null;
  @IsOptional() @IsString() @MaxLength(300) name?: string | null;
  @IsOptional() @IsEmail() email?: string | null;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
export class SendQuotationDto extends VersionedQuotationCommandDto {
  /** EMAIL: the system sends it. MANUAL / EXTERNAL: someone already did. */
  @IsString() @IsIn(["EMAIL", "MANUAL", "EXTERNAL"]) channelCode!: string;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SendRecipientDto)
  recipients!: SendRecipientDto[];
  @IsOptional() @IsString() @MaxLength(250) subject?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) message?: string | null;
  /** A copy to the salesperson sending it. */
  @IsOptional() @IsBoolean() ccSelf?: boolean;
  @IsOptional() @IsIn(["en", "ar"]) languageCode?: "en" | "ar";
}
export class CreateAcceptanceDto {
  @IsString() @MaxLength(60) evidenceTypeCode!: string;
  @IsOptional() @IsUUID() documentId?: string | null;
  @IsOptional() @IsString() @MaxLength(500) externalReference?: string | null;
  @IsDateString() acceptedAt!: string;
}
export class ApprovalListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class ApprovalDecisionDto {
  @IsIn(["APPROVE", "REJECT", "REQUEST_CHANGES"])
  decision!: "APPROVE" | "REJECT" | "REQUEST_CHANGES";
  @IsOptional() @IsString() @MaxLength(2000) comment?: string | null;
}

/** Cancelling needs a stated reason: a cancelled quotation with no explanation
 *  is indistinguishable from one someone forgot about. */
export class CancelQuotationDto {
  @IsString() @MaxLength(40) expectedRowVersion!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
