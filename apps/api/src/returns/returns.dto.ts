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
const decimal = /^\d+(\.\d+)?$/;
export class ReturnListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class ReturnLineDto {
  @IsUUID() originalQuotationLineId!: string;
  @IsString() @Matches(decimal) returnedQty!: string;
}
export class CreateReturnDto {
  @IsUUID() accountId!: string;
  @IsUUID() originalQuotationId!: string;
  @IsIn(["CREDIT", "REPLACEMENT"]) benefitTypeCode!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines!: ReturnLineDto[];
}
export class UpdateReturnDto {
  @IsOptional() @IsIn(["CREDIT", "REPLACEMENT"]) benefitTypeCode?: string;
  @IsOptional() @IsDateString() receivedAt?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReturnLineDto)
  lines?: ReturnLineDto[];
}
export class ExpectedReturnDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsOptional() @IsString() @MaxLength(1000) comment?: string | null;
}
export class ApproveReturnDto extends ExpectedReturnDto {
  @IsIn(["APPROVE", "REJECT"]) decision!: string;
}
