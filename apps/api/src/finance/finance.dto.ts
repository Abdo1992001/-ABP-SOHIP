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
export class FinanceListQuery {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class CreateFxRateDto {
  @IsIn(["USD"]) baseCurrencyCode!: string;
  @IsIn(["EGP"]) quoteCurrencyCode!: string;
  @IsString() @Matches(decimal) rate!: string;
  @IsDateString() effectiveAt!: string;
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsUUID() supersedesFxRateId?: string | null;
}
export class FxResolveQuery {
  @IsOptional() @IsIn(["USD"]) baseCurrencyCode = "USD";
  @IsOptional() @IsIn(["EGP"]) quoteCurrencyCode = "EGP";
  @IsOptional() @IsDateString() effectiveAt?: string;
}
export class CreatePaymentDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsUUID() salesOrderId?: string | null;
  @IsDateString() paymentDate!: string;
  @IsString() @Matches(decimal) amount!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currencyCode!: string;
  @IsOptional() @IsString() @MaxLength(100) paymentMethodCode?: string | null;
  @IsIn(["IMPORT", "MANUAL"]) sourceTypeCode!: string;
  @IsOptional() @IsString() @MaxLength(200) sourcePaymentKey?: string | null;
  @IsOptional() @IsString() @MaxLength(500) rawReference?: string | null;
  @IsOptional() @IsUUID() correctionOfPaymentId?: string | null;
}
export class PaymentAllocationLineDto {
  @IsOptional() @IsUUID() salesOrderId?: string | null;
  @IsString() @Matches(decimal) allocatedAmount!: string;
}
export class AllocatePaymentDto {
  @IsUUID() paymentId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => PaymentAllocationLineDto)
  allocations!: PaymentAllocationLineDto[];
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}
export class CreateChequeDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsUUID() salesOrderId?: string | null;
  @IsString() @MaxLength(100) chequeNumber!: string;
  @IsOptional() @IsString() @MaxLength(200) bankName?: string | null;
  @IsString() @Matches(decimal) amount!: string;
  @IsString() @Matches(/^[A-Z]{3}$/) currencyCode!: string;
  @IsOptional() @IsDateString() issueDate?: string | null;
  @IsOptional() @IsDateString() dueDate?: string | null;
  @IsString() @MaxLength(100) sourceTypeCode!: string;
  @IsOptional() @IsString() @MaxLength(200) sourceChequeKey?: string | null;
}
export class ChequeTransitionDto {
  @IsIn(["DEPOSITED", "CLEARED", "BOUNCED", "CANCELLED"])
  targetStatusCode!: string;
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
  @IsOptional() @IsUUID() evidenceDocumentId?: string | null;
}
