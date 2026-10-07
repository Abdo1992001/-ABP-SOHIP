import { Type } from "class-transformer";
import {
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class PricingResolveDto {
  @IsUUID() productId!: string;
  @IsString() @MaxLength(40) qty!: string;
  @IsString() @MaxLength(3) currencyCode!: string;
  @IsOptional() @IsDateString() at?: string | null;
  @IsOptional() @IsUUID() quotationId?: string | null;
}

export class CreateGuardrailDto {
  @IsOptional() @IsUUID() productId?: string | null;
  @IsOptional() @IsUUID() productFamilyId?: string | null;
  @IsOptional() @IsString() @MaxLength(40) minPrice?: string | null;
  @IsOptional() @IsString() @MaxLength(40) referencePrice?: string | null;
  @IsOptional() @IsString() @MaxLength(40) maxPrice?: string | null;
  @IsString() @MaxLength(3) currencyCode!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string | null;
}

export class PriceOverrideDto {
  @IsUUID() quotationId!: string;
  @IsOptional() @IsUUID() quotationLineId?: string | null;
  @IsString() @MaxLength(40) expectedRowVersion!: string;
  @IsString() @MaxLength(40) requestedUnitPrice!: string;
  @IsString() @MaxLength(2000) reason!: string;
}

export class CreateTaxPolicyDto {
  @IsString() @MaxLength(80) taxCode!: string;
  @IsString() @MaxLength(40) taxRatePct!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string | null;
}

export class UpdateCompanyPricingSettingsDto {
  // Exactly one of these two may be set (mutually exclusive input modes,
  // spec's "USE COMPANY DEFAULT / PRICE PER KG / BOARD PRICE"); the other
  // is derived server-side. Omit both to leave the STANDARD rate unchanged.
  @IsOptional() @IsString() @MaxLength(40) standardPricePerKg?: string | null;
  @IsOptional() @IsString() @MaxLength(40) standardBoardPrice?: string | null;
  @IsOptional() @IsString() @MaxLength(40) curvedPricePerKg?: string | null;
  @IsOptional() @IsString() @MaxLength(40) circularPricePerKg?: string | null;
  @IsOptional() @IsString() @MaxLength(40) defaultDensityKgM3?: string | null;
  @IsOptional() @IsString() @MaxLength(40) defaultThicknessMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) referenceBoardWidthMm?:
    string | null;
  @IsOptional() @IsString() @MaxLength(40) referenceBoardLengthMm?:
    string | null;
  @IsOptional() @IsString() @MaxLength(40) defaultDiscountPct?: string | null;
  // The ACROW BOARD workbook's MASTER SETTINGS. columnClosureAllowanceMm is
  // the lap the two closing panels of a rectangular column gain, so its faces
  // are A / B / A+allowance / B+allowance -- see column-faces.ts.
  @IsOptional() @IsString() @MaxLength(40) maxPanelWidthMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) maxPanelLengthMm?: string | null;
  @IsOptional() @IsString() @MaxLength(40) defaultColumnHeightMm?:
    string | null;
  @IsOptional() @IsString() @MaxLength(40) columnClosureAllowanceMm?:
    string | null;
  /**
   * The three boxes on every issued document that are the company's, not the
   * writer's: the delivery wording, the yard the goods leave from, and how
   * long an offer stands. The sales engineer's name and number are the
   * writer's and come from their profile -- see the migration.
   */
  @IsOptional() @IsString() @MaxLength(500) documentDeliveryTerms?:
    string | null;
  @IsOptional() @IsString() @MaxLength(500) documentDeliveryPoint?:
    string | null;
  @IsOptional() @IsString() @MaxLength(200) documentOfferValidity?:
    string | null;
}

/**
 * A pricing rule stored as data. The expression is checked against the
 * variables a quotation line actually provides before it is saved -- a formula
 * that cannot evaluate is a formula that will price something at zero.
 */
export class CreateCalculationFormulaDto {
  @IsString() @MaxLength(80) formulaKey!: string;
  @IsString() @MaxLength(160) displayName!: string;
  @IsOptional() @IsString() @MaxLength(160) arabicLabel?: string | null;
  @IsString() @MaxLength(500) expression!: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsString() @MaxLength(40) rateUnitLabel?: string | null;
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(9999)
  sortOrder?: number;
}

export class CalculationFormulaListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
  @IsOptional() @IsBoolean() includeRetired?: boolean;
}

/**
 * A subject to add to the company-wide list.
 *
 * Two characters is the floor because a one-letter subject is a typo, and the
 * server folds case before comparing -- "Acrow board" is not a second subject.
 */
export class CreateDocumentSubjectDto {
  @IsString() @MinLength(2) @MaxLength(300) subjectText!: string;
}

export class PolicyListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsBoolean() active?: boolean;
}
