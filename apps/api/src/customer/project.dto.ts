import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const projectSorts = [
  "projectRef:asc",
  "projectRef:desc",
  "name:asc",
  "name:desc",
  "countryCode:asc",
  "countryCode:desc",
  "stageCode:asc",
  "stageCode:desc",
  "recordStatusCode:asc",
  "recordStatusCode:desc",
  "updatedAt:asc",
  "updatedAt:desc",
] as const;

export class ProjectListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional()
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode?: string;
  @IsOptional() @IsIn(["ACTIVE", "ARCHIVED", "ALL"]) archiveState = "ACTIVE";
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) stageCode?: string;
  @IsOptional() @IsIn(projectSorts) sort = "updatedAt:desc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}

export class CreateProjectDto {
  @IsString() @MinLength(1) @MaxLength(300) name!: string;
  @IsString()
  @Length(2, 2)
  @Transform(({ value }) => String(value).toUpperCase())
  countryCode!: string;
  @IsOptional() @IsString() @MaxLength(200) city?: string | null;
  @IsOptional() @IsString() @MaxLength(200) region?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) addressText?: string | null;
  @IsUUID() primaryAccountId!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => String(value).trim().toUpperCase())
  primaryRoleCode!: string;
}

export class UpdateProjectDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(300) name?: string | null;
  @IsOptional() @IsString() @MaxLength(200) city?: string | null;
  @IsOptional() @IsString() @MaxLength(200) region?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) addressText?: string | null;
  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) =>
    value === null ? null : String(value).trim().toUpperCase(),
  )
  stageCode?: string | null;
}

export class ArchiveProjectDto {
  @IsString() @MinLength(3) @MaxLength(500) reason!: string;
}

export class AddProjectPartyDto {
  @IsUUID() accountId!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => String(value).trim().toUpperCase())
  roleCode!: string;
  @IsOptional() primaryFlag = false;
}

export class AddProjectContactRoleDto {
  @IsUUID() contactId!: string;
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Transform(({ value }) => String(value).trim().toUpperCase())
  roleCode!: string;
}
