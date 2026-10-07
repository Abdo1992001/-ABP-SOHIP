import { Transform, Type } from "class-transformer";
import {
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

export class IntelligenceListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode?: string;
}

export class CreateMarketSignalDto {
  @IsString() @MinLength(2) @MaxLength(240) title!: string;
  @IsString() @MinLength(2) @MaxLength(200) sourceName!: string;
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2_000)
  sourceUrl?: string;
  @IsDateString() publishedDate!: string;
  @IsDateString() retrievedDate!: string;
  @IsOptional() @IsDateString() eventDate?: string;
  @IsString() @MinLength(3) @MaxLength(20_000) evidence!: string;
  @IsIn(["VERIFIED", "UNVERIFIED", "REJECTED"]) verificationCode!: string;
  @IsIn(["FACT", "FORECAST", "OPINION", "UNVERIFIED"])
  classificationCode!: string;
  @IsOptional() @IsString() @MaxLength(4_000) summary?: string;
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode?: string;
}

export class CreateTargetMarketDto {
  @IsString() @MinLength(2) @MaxLength(240) name!: string;
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode!: string;
  @IsOptional() @IsString() @MaxLength(100) segmentCode?: string;
  @IsString() @MinLength(3) @MaxLength(4_000) rationale!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(100) priorityScore?: number;
  @IsOptional() @IsString() @MaxLength(120) rankingSource?: string;
}

export class CreateTargetAccountDto {
  @IsString() @MinLength(2) @MaxLength(300) companyName!: string;
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode!: string;
  @IsOptional() @IsString() @MaxLength(100) segmentCode?: string;
  @IsOptional()
  @IsUrl({ require_tld: false })
  @MaxLength(2_000)
  website?: string;
  @IsString() @MinLength(3) @MaxLength(4_000) rationale!: string;
  @IsOptional() @IsUUID() sourceSignalId?: string;
  @IsOptional() @IsUUID() ownerUserId?: string;
}

export class CreateCompetitorDto {
  @IsString() @MinLength(2) @MaxLength(300) name!: string;
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode?: string;
  @IsOptional() @IsString() @MaxLength(4_000) strengths?: string;
  @IsOptional() @IsString() @MaxLength(4_000) weaknesses?: string;
  @IsOptional() @IsString() @MaxLength(4_000) notes?: string;
}

export class CreateWatchlistEntryDto {
  @IsIn(["MARKET_SIGNAL", "TARGET_MARKET", "TARGET_ACCOUNT", "COMPETITOR"])
  resourceType!: string;
  @IsUUID() resourceId!: string;
  @IsString() @MinLength(1) @MaxLength(300) label!: string;
  @IsOptional() @IsString() @MaxLength(2_000) notes?: string;
}

export class CreateRepeatBusinessRequestDto {
  @IsUUID() accountId!: string;
  @IsString() @MinLength(2) @MaxLength(300) subject!: string;
  @IsString() @MinLength(3) @MaxLength(10_000) description!: string;
}

export class UpdateRepeatBusinessRequestDto {
  @IsIn(["IN_REVIEW", "PREPARED", "CLOSED"]) statusCode!: string;
  @IsOptional() @IsString() @MaxLength(10_000) salesResponse?: string;
}
