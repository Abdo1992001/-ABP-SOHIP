import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEmail,
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
import { ORDER_STATUSES } from "./order-lifecycle.js";

const decimal = /^\d+(\.\d+)?$/;
const version = /^\d+$/;

export class OrderListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsIn(ORDER_STATUSES) status?: string;
  @IsOptional() @IsUUID() quotationId?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

/** Book an order from an accepted quotation. */
export class CreateOrderDto {
  @IsUUID() quotationId!: string;
  @IsOptional() @IsString() @MaxLength(120) customerPoNumber?: string;
  @IsOptional() @IsDateString() requestedDeliveryDate?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  /** Why a customer with overdue payments may still order (managers only). */
  @IsOptional() @IsString() @MaxLength(500) creditOverrideReason?: string;
}

export class AmendOrderLineDto {
  @IsUUID() lineId!: string;
  @IsString() @Matches(decimal) quantity!: string;
}

/** What may change before production: the header, and line quantities. */
export class AmendOrderDto {
  @IsString() @Matches(version) expectedRowVersion!: string;
  @IsOptional() @IsString() @MaxLength(120) customerPoNumber?: string | null;
  @IsOptional() @IsDateString() requestedDeliveryDate?: string | null;
  @IsOptional() @IsString() @MaxLength(500) deliveryTerms?: string | null;
  @IsOptional() @IsString() @MaxLength(500) deliveryPoint?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string | null;
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AmendOrderLineDto)
  lines?: AmendOrderLineDto[];
  @IsString() @MaxLength(500) reason!: string;
}

export class ConfirmationRecipientDto {
  @IsOptional() @IsUUID() contactId?: string;
  @IsOptional() @IsString() @MaxLength(300) name?: string;
  @IsEmail() email!: string;
}

/** The order confirmation, emailed to the customer as a PDF. */
export class SendOrderConfirmationDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ConfirmationRecipientDto)
  recipients!: ConfirmationRecipientDto[];
  @IsOptional() @IsString() @MaxLength(5000) message?: string;
  @IsOptional() @IsBoolean() ccSelf?: boolean;
  @IsOptional() @IsIn(["en", "ar"]) languageCode?: "en" | "ar";
}

export class OrderTransitionDto {
  @IsString() @Matches(version) expectedRowVersion!: string;
  @IsIn(ORDER_STATUSES) targetStatusCode!: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  /** Required when cancelling. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
