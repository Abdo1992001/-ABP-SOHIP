import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

const sorts = [
  "opportunityRef:asc",
  "opportunityRef:desc",
  "stageCode:asc",
  "stageCode:desc",
  "updatedAt:asc",
  "updatedAt:desc",
] as const;
export class OpportunityListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() projectId?: string;
  @IsOptional() @IsString() @MaxLength(100) stageCode?: string;
  @IsOptional() @IsIn(sorts) sort = "updatedAt:desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}
export class CreateOpportunityDto {
  /**
   * Required, because an unnamed deal is the thing this field exists to stop.
   * The reference is how the system finds the row; the title is how a person
   * recognises it in a pipeline of forty.
   */
  @IsString() @MinLength(3) @MaxLength(200) title!: string;
  @IsUUID() accountId!: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MaxLength(100) requirementTypeCode?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) noProjectReasonCode?:
    string | null;
  @IsOptional() @IsString() @MatchesDecimal() estimatedValue?: string | null;
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    value === null ? null : String(value).toUpperCase(),
  )
  currencyCode?: string | null;
  @IsOptional() @IsDateString() expectedCloseDate?: string | null;
}
export class UpdateOpportunityDto {
  @IsOptional() @IsString() @MinLength(3) @MaxLength(200) title?: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsString() @MatchesDecimal() estimatedValue?: string | null;
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    value === null ? null : String(value).toUpperCase(),
  )
  currencyCode?: string | null;
  @IsOptional() @IsDateString() expectedCloseDate?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) noProjectReasonCode?:
    string | null;
}
export class TransitionOpportunityDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => String(value).trim().toUpperCase())
  targetStageCode!: string;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    value === null ? null : String(value).trim().toUpperCase(),
  )
  lostReasonCode?: string | null;
}
class OverrideSourceDto {
  @IsString() @MinLength(1) @MaxLength(100) sourceCode!: string;
  @IsOptional() @IsString() @MaxLength(300) reference?: string | null;
}
export class ProbabilityOverrideDto {
  @IsString() @MatchesDecimal() probabilityPct!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
  @ValidateNested()
  @Type(() => OverrideSourceDto)
  sourceMetadata!: OverrideSourceDto;
}
function MatchesDecimal() {
  return Matches(/^-?\d+(\.\d+)?$/);
}

/**
 * Cancelling a deal is not losing it.
 *
 * LOST means a competitor took it and the lost-reason taxonomy applies. CANCELLED
 * means the customer dropped the requirement entirely - counting that as a loss
 * would make the win rate look worse than the sales team performed.
 */
export class CancelOpportunityDto {
  @IsString() @MaxLength(40) expectedRowVersion!: string;
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}
