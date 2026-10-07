import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
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
  MinLength,
  ValidateNested,
} from "class-validator";

const contactSorts = [
  "displayName:asc",
  "displayName:desc",
  "statusCode:asc",
  "statusCode:desc",
  "updatedAt:asc",
  "updatedAt:desc",
] as const;

export class ContactListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(contactSorts) sort = "displayName:asc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}

/** The contact directory, optionally for one customer. */
export class ContactDirectoryQuery extends ContactListQuery {
  @IsOptional() @IsUUID() accountId?: string;
}

export class ContactChannelInputDto {
  @IsString()
  @MinLength(2)
  @MaxLength(50)
  @Matches(/^[A-Za-z][A-Za-z0-9_]*$/)
  @Transform(({ value }) => String(value).toUpperCase())
  @IsIn(["EMAIL"], { message: "Enter an email address." })
  channelTypeCode!: string;

  @IsString() @MinLength(1) @MaxLength(500) value!: string;
  @IsOptional() @IsBoolean() isPrimary = false;
}

export class CreateContactDto {
  @IsString() @MinLength(1) @MaxLength(300) displayName!: string;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => ContactChannelInputDto)
  channels?: ContactChannelInputDto[];
}

export class UpdateContactDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) displayName?:
    string | null;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string | null;
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE", "ARCHIVED"]) statusCode?:
    string | null;
}

export class CreateContactShareDto {
  @IsUUID() recipientUserId!: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID(undefined, { each: true })
  contactIds!: string[];
  @IsIn(["VIEW", "COLLABORATE_EDIT"]) accessLevelCode!: string;
  @IsOptional() @IsDateString() expiresAt?: string | null;
}
