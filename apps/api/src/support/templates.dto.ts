import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class TemplateListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @MaxLength(50) documentTypeCode?: string;
  @IsOptional() @IsString() @MaxLength(10) languageCode?: string;
  @IsOptional() @IsString() @MaxLength(50) brandCode?: string;
  @IsOptional() @IsIn(["ACTIVE", "INACTIVE"]) statusCode?: string;
}

export class CreateTemplateDto {
  @IsString() @Matches(/^[A-Z0-9_-]{2,80}$/) code!: string;
  @IsString() @MaxLength(200) name!: string;
  @IsString() @Matches(/^[A-Z0-9_-]{2,50}$/) documentTypeCode!: string;
  @IsString() @Matches(/^[a-z]{2}(?:-[A-Z]{2})?$/) languageCode!: string;
  @IsString() @Matches(/^[A-Z0-9_-]{2,50}$/) brandCode!: string;
}

export class CreateTemplateVersionDto {
  @IsString() @MaxLength(100_000) content!: string;
  @IsOptional()
  @IsString()
  @Matches(/^[a-z]{2}(?:-[A-Z]{2})?$/)
  languageCode?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z0-9_-]{2,50}$/) brandCode?: string;
}

export class UpdateTemplateVersionDto {
  @IsString() @MaxLength(100_000) content!: string;
}

export class TemplateVersionTransitionDto {
  @IsIn(["ACTIVATE", "ARCHIVE"]) targetStatusCode!: "ACTIVATE" | "ARCHIVE";
  @IsString() @MaxLength(500) reason!: string;
}
