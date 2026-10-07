import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
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

export class CapacityListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class CapacityEstimateItemDto {
  @IsIn(["STANDARD", "ORDINARY", "CURVED"]) categoryCode!: string;
  @IsString() @Matches(/^\d+(\.\d+)?$/) quantityBoards!: string;
}
export class CapacityEstimateDto {
  @IsIn(["QUOTATION", "SALES_ORDER", "MANUAL"]) sourceTypeCode!: string;
  @IsOptional() @IsUUID() sourceResourceId?: string | null;
  @IsOptional() @IsDateString() startAt?: string | null;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CapacityEstimateItemDto)
  items!: CapacityEstimateItemDto[];
}
export class CreateCapacityRateDto {
  @IsIn(["STANDARD", "ORDINARY", "CURVED"]) categoryCode!: string;
  @IsString() @Matches(/^\d+(\.\d+)?$/) boardsPerDay!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsDateString() effectiveTo?: string | null;
  @IsString() @MaxLength(100) sourceCode!: string;
}
export class CapacityRateResolveQuery {
  @IsIn(["STANDARD", "ORDINARY", "CURVED"]) categoryCode!: string;
  @IsOptional() @IsDateString() effectiveAt?: string;
}
