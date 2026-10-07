import { Type } from "class-transformer";
import {
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
} from "class-validator";

const decimal = /^\d+(\.\d{1,2})?$/;
const version = /^\d+$/;

export const RECEIVABLE_VIEWS = [
  "OPEN",
  "OVERDUE",
  "DUE_SOON",
  "NOT_SCHEDULED",
  "SETTLED",
  "ALL",
] as const;
export const COLLECTION_METHODS = [
  "CASH",
  "TRANSFER",
  "CHEQUE",
  "CARD",
  "OTHER",
] as const;

export class ReceivableListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 50;
  /** Which installments: still owed (default), overdue, due in 30 days, … */
  @IsOptional()
  @IsIn(RECEIVABLE_VIEWS)
  view: (typeof RECEIVABLE_VIEWS)[number] = "OPEN";
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsUUID() customerOrderId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

/** Money received against one installment. */
export class RecordCollectionDto {
  @IsString() @Matches(version) expectedRowVersion!: string;
  @IsString() @Matches(decimal) amount!: string;
  @IsDateString() receivedOn!: string;
  @IsIn(COLLECTION_METHODS) methodCode!: (typeof COLLECTION_METHODS)[number];
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/** Give up on what is left of an installment, with the reason on record. */
export class WriteOffDto {
  @IsString() @Matches(version) expectedRowVersion!: string;
  @IsString() @MaxLength(500) reason!: string;
}
