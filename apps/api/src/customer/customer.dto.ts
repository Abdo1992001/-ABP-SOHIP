import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
  IsUUID,
} from "class-validator";

const sorts = [
  "accountRef:asc",
  "accountRef:desc",
  "canonicalName:asc",
  "canonicalName:desc",
  "countryCode:asc",
  "countryCode:desc",
  "accountCategoryCode:asc",
  "accountCategoryCode:desc",
  "recordStatusCode:asc",
  "recordStatusCode:desc",
  "updatedAt:asc",
  "updatedAt:desc",
] as const;

export class AccountListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) archiveState = "ACTIVE";
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode?: string;
  @IsOptional() @IsString() @MaxLength(100) accountCategoryCode?: string;
  @IsOptional() @IsIn(["FORMWORK", "OTHER"]) businessTypeCode?:
    "FORMWORK" | "OTHER";
  @IsOptional() @IsIn(sorts) sort = "updatedAt:desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}

export class CreateAccountDto {
  @IsString() @MinLength(1) @MaxLength(300) canonicalName!: string;
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode!: string;
  @IsOptional() @IsString() @MaxLength(100) accountCategoryCode?: string | null;
  @IsOptional() @IsIn(["FORMWORK", "OTHER"]) businessTypeCode?:
    "FORMWORK" | "OTHER";
}

export class UpdateAccountDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) canonicalName?:
    string | null;
  /**
   * What a customer carries onto every document it is ever sent.
   *
   * A proforma invoice is a customs document: the buyer's postal address and
   * tax number have to be on it. They do not change from one order to the
   * next, so they are typed once, here, rather than on each quotation.
   */
  @IsOptional() @IsString() @MaxLength(500) address?: string | null;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string | null;
  @IsOptional() @IsString() @MaxLength(100) accountCategoryCode?: string | null;
  @IsOptional() @IsIn(["FORMWORK", "OTHER"]) businessTypeCode?:
    "FORMWORK" | "OTHER";
  @IsOptional()
  @IsString()
  @Length(3, 3)
  @Transform(({ value }) =>
    value === null ? null : String(value).toUpperCase(),
  )
  defaultCurrencyCode?: string | null;
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) =>
    value === null ? null : String(value).toUpperCase(),
  )
  hqCountryCode?: string | null;
}

export class ArchiveAccountDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class CreateCustomerShareDto {
  @IsUUID() recipientUserId!: string;
  @IsIn(["CONTACT_ONLY", "CUSTOMER_CONTACTS", "COMMERCIAL_WORKSPACE"])
  shareScopeCode!: string;
  @IsIn(["VIEW", "COLLABORATE_EDIT"]) accessLevelCode!: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
}

export class TransferOwnershipDto {
  @IsUUID() targetUserId!: string;
  @IsString() expectedRowVersion!: string;
}

export class DuplicateCheckDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) companyName?:
    string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) phone?: string | null;
  @IsOptional() @IsString() @MinLength(3) @MaxLength(320) email?: string | null;
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) customerNumber?:
    string | null;
}

export class MergePreviewDto {
  @IsUUID() sourceAccountId!: string;
}

export class MergeAccountDto extends MergePreviewDto {
  @IsString() masterExpectedRowVersion!: string;
  @IsString() sourceExpectedRowVersion!: string;
}

export class CustomerShareListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
