import { Type } from "class-transformer";
import {
  IsDateString,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  IsUUID,
} from "class-validator";
export class ScopedQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class SearchQuery extends ScopedQuery {
  /** Legacy runtime alias retained for old callers; canonical OpenAPI uses search. */
  @IsOptional() @IsString() @MaxLength(200) q?: string;
}
/** Optional reporting window for the commercial history report. Omitting both
 *  keeps the previous behaviour: the whole history the user can see. */
export class SalesHistoryQuery {
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
}
export class MarkAllDto {
  @IsOptional() @IsDateString() before?: string | null;
}
export class DismissDto {
  @IsOptional() @IsString() @MaxLength(500) reasonCode?: string | null;
}

export class GenerateAdvisoryDto {
  @IsString() @MaxLength(80) resourceTypeCode!: string;
  @IsUUID() resourceId!: string;
}
export class PreferencesDto {
  @IsObject() preferences!: Record<string, unknown>;
}
