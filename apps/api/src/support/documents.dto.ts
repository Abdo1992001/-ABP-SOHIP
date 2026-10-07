import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";
import { Type } from "class-transformer";
export class DocumentListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(100) documentTypeCode?: string;
  @IsOptional() @IsString() @MaxLength(100) resourceTypeCode?: string;
  @IsOptional() @IsUUID() resourceId?: string;
  @IsOptional() @IsString() @MaxLength(50) statusCode?: string;
  @IsOptional() @IsIn(["true", "false"]) official?: string;
}
export class CreateUploadDto {
  @IsString() @MinLength(1) @MaxLength(100) documentTypeCode!: string;
  @IsString() @MinLength(1) @MaxLength(255) fileName!: string;
  @IsString() @MaxLength(200) mimeType!: string;
  @IsInt() @Min(1) @Max(104857600) sizeBytes!: number;
  @IsOptional() @IsString() @MaxLength(100) targetResourceType?: string | null;
  @IsOptional() @IsUUID() targetResourceId?: string | null;
}
export class CompleteUploadDto {
  @IsOptional() @IsString() @MaxLength(128) actualSha256?: string | null;
}
export class LinkDocumentDto {
  @IsString() @MaxLength(100) resourceTypeCode!: string;
  @IsUUID() resourceId!: string;
  @IsString() @MaxLength(100) relationshipTypeCode!: string;
}
export class CreateExportDto {
  @IsString() @MaxLength(100) exportTypeCode!: string;
  @IsOptional() @IsString() @MaxLength(100) resourceTypeCode?: string | null;
  @IsObject() filters: Record<string, string | number | boolean | null> = {};
  @IsIn(["XLSX", "CSV", "PDF"]) formatCode!: string;
}
