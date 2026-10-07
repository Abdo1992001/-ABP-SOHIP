import { Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class AnalyticsQueryDto {
  @IsOptional() @IsDateString() asOf?: string;
  @IsOptional() @IsDateString() from?: string;
  @IsOptional() @IsDateString() to?: string;
  @IsOptional() @IsIn(["USD", "EGP"]) currency: "USD" | "EGP" = "USD";
  @IsOptional() @IsString() @MaxLength(2) countryCode?: string;
}

export class AnalyticsDrilldownQueryDto extends AnalyticsQueryDto {
  @IsOptional() @IsString() @MaxLength(40) metricId?: string;
  @IsOptional() @IsString() @MaxLength(40) stageCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(80) sort = "date_desc";
}

export class AnalyticsExportDto extends AnalyticsQueryDto {
  @IsIn(["CSV", "XLSX", "PDF"]) formatCode!: "CSV" | "XLSX" | "PDF";
}
