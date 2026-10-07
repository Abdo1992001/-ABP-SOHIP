import { Type } from "class-transformer";
import {
  IsBoolean,
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
  MinLength,
} from "class-validator";
import {
  CONTACT_CHANNELS,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
  REFERENCE_TYPES,
} from "./feedback-rules.js";

export const FEEDBACK_TOPICS = [
  "PRODUCT_QUALITY",
  "DELIVERY_DELAY",
  "DAMAGED_GOODS",
  "BILLING",
  "SERVICE",
  "OTHER",
] as const;

/** What a customer sends from the public page. */
export class SubmitFeedbackDto {
  @IsIn(FEEDBACK_KINDS) kindCode!: string;
  @IsOptional() @IsIn(FEEDBACK_TOPICS) topicCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(5) rating?: number;
  @IsOptional() @IsBoolean() isCritical?: boolean;
  @IsIn(REFERENCE_TYPES) referenceTypeCode!: string;
  @IsString() @MinLength(2) @MaxLength(120) referenceText!: string;
  @IsString() @MinLength(2) @MaxLength(150) contactName!: string;
  @IsOptional() @IsString() @MaxLength(200) companyName?: string;
  @IsOptional() @IsString() @MaxLength(120) jobTitle?: string;
  @IsOptional() @IsString() @Matches(/^[+\d][\d\s()-]{6,24}$/) phone?: string;
  @IsOptional() @IsEmail() @MaxLength(254) email?: string;
  @IsOptional() @IsIn(CONTACT_CHANNELS) preferredChannelCode?: string;
  @IsOptional() @IsBoolean() consentToContact?: boolean;
  @IsString() @MinLength(5) @MaxLength(4000) message!: string;
  /** Left empty by people; bots fill every field they find. */
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}

export class FeedbackListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsIn(FEEDBACK_STATUSES) status?: string;
  @IsOptional() @IsIn(FEEDBACK_KINDS) kind?: string;
  @IsOptional() @IsIn(["true", "false"]) critical?: string;
  @IsOptional() @IsIn(["true", "false"]) mine?: string;
  @IsOptional() @IsIn(["true", "false"]) unmatched?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

export class FeedbackFollowUpDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsIn(FEEDBACK_STATUSES) targetStatusCode!: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
}

/** Tie unmatched feedback to the customer it came from. */
export class FeedbackLinkDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsUUID() accountId!: string;
  @IsOptional() @IsBoolean() openComplaint?: boolean;
}
