import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class ImportListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class DataQualityListQuery extends ImportListQuery {
  @IsOptional() @IsIn(["OPEN", "RESOLVED", "WAIVED"]) statusCode?: string;
  @IsOptional() @IsString() @MaxLength(30) severityCode?: string;
  @IsOptional() @IsString() @MaxLength(50) issueCode?: string;
  @IsOptional() @IsString() @MaxLength(50) sourceEntityCode?: string;
  @IsOptional() @IsUUID() importJobId?: string;
}
export class ReconciliationListQuery extends ImportListQuery {
  @IsOptional() @IsString() @MaxLength(30) statusCode?: string;
  @IsOptional() @IsString() @MaxLength(50) reconciliationTypeCode?: string;
  @IsOptional() @IsUUID() importJobId?: string;
}
export class CreateImportJobDto {
  @IsString() @Matches(/^[A-Z0-9_-]{2,50}$/) sourceSystemCode!: string;
  @IsString() @Matches(/^[A-Z0-9_-]{2,50}$/) importTypeCode!: string;
  @IsString() @MaxLength(255) fileName!: string;
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(104_857_600)
  expectedSizeBytes!: number;
  @IsString() @MaxLength(100) mimeType!: string;
}
export class ValidateImportDto {
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) parserVersion!: string;
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) mappingVersion!: string;
}
export class UploadImportQuery {
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) parserVersion = "safe-1";
  @IsString() @Matches(/^[A-Za-z0-9._-]{1,50}$/) mappingVersion = "v1";
}
export class CommitImportDto {
  @IsString() @MaxLength(128) previewFingerprint!: string;
}
export class RetryImportDto {
  @IsIn(["VALIDATE", "COMMIT", "ROLLBACK"]) stageCode!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}
export class RollbackImportDto {
  @IsString() @MaxLength(500) reason!: string;
}
export class ResolveIssueDto {
  @IsString() @MaxLength(50) resolutionCode!: string;
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsUUID() mappingTargetId?: string | null;
}
export class CreateReconciliationRunDto {
  @IsString() @Matches(/^[A-Z0-9_-]{2,50}$/) reconciliationTypeCode!: string;
  @IsOptional() @IsUUID() sourceSystemId?: string | null;
  @IsOptional() @IsObject() filters?: Record<
    string,
    string | number | boolean | null
  >;
}
export class ResolveReconciliationIssueDto {
  @IsString() @MaxLength(50) resolutionCode!: string;
  @IsOptional() @IsUUID() resourceId?: string | null;
  @IsString() @MaxLength(500) reason!: string;
}
export class ResolveItemDto {
  @IsOptional() @IsUUID() sourceSystemId?: string | null;
  @IsOptional() @IsString() @MaxLength(200) sourceItemKey?: string | null;
  @IsOptional() @IsString() @MaxLength(100) sku?: string | null;
  @IsOptional() @IsString() @MaxLength(100) barcode?: string | null;
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsObject() dimensions?: Record<string, string | null>;
}
export class CreateItemMappingDto {
  @IsUUID() sourceItemId!: string;
  @IsUUID() productId!: string;
  @IsString() @MaxLength(50) mappingMethodCode!: string;
  @IsOptional() @IsString() @Matches(/^\d+(\.\d+)?$/) confidencePct?:
    string | null;
  @IsString() @MaxLength(500) rationale!: string;
}
