import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";

const decimal = /^\d+(\.\d+)?$/;
export class LogisticsListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class LogisticsLineDto {
  @IsOptional() @IsUUID() planLineId?: string | null;
  @IsOptional() @IsUUID() productId?: string | null;
  @IsString() @Matches(decimal) qty!: string;
  @IsString() @Matches(decimal) lengthMm!: string;
  @IsString() @Matches(decimal) widthMm!: string;
  @IsString() @Matches(decimal) thicknessMm!: string;
  @IsOptional() @IsString() @Matches(decimal) weightKg?: string | null;
  @IsIn(["FLAT_ON_FACE"]) orientationCode!: string;
}
export class CreateLogisticsPlanDto {
  @IsIn(["QUOTATION", "SALES_ORDER", "MANUAL_SCENARIO"])
  sourceTypeCode!: string;
  @IsOptional() @IsUUID() sourceResourceId?: string | null;
  @IsOptional() @IsString() @MaxLength(2) countryCode?: string | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LogisticsLineDto)
  manualLines?: LogisticsLineDto[];
}
export class CreateLogisticsVersionDto {
  @IsOptional() @IsUUID() cloneFromVersionId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string | null;
}
export class TransportUnitDto {
  @IsOptional() @IsUUID() templateId?: string | null;
  @Type(() => Number) @IsInt() @Min(1) instanceNo!: number;
}
export class SaveLogisticsDraftDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => LogisticsLineDto)
  lines!: LogisticsLineDto[];
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => TransportUnitDto)
  transportUnits?: TransportUnitDto[];
  @IsIn(["COMPLETE", "PARTIAL"]) completenessMode!: string;
}
export class ExpectedVersionDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
}
export class OptimizePlanDto extends ExpectedVersionDto {
  @IsOptional() @IsString() @MaxLength(100) objectiveCode?: string | null;
}
export class CompareLogisticsDto {
  @IsArray()
  @ArrayMinSize(2)
  @IsUUID(undefined, { each: true })
  planVersionIds!: string[];
}
export class CreateLogisticsExportDto {
  @IsIn(["PDF", "XLSX", "PNG"]) formatCode!: string;
  @IsOptional() @IsBoolean() includeValidation?: boolean;
}
