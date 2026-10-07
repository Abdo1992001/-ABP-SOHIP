import { Transform, Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

const sorts = [
  "canonicalDescription:asc",
  "canonicalDescription:desc",
  "skuCode:asc",
  "skuCode:desc",
] as const;
export class ProductListQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(sorts) sort = "canonicalDescription:asc";
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}
export class UpdateProductDto {
  @IsOptional() @IsString() @MaxLength(100) skuCode?: string | null;
  @IsOptional() @IsString() @MaxLength(100) barcode?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) canonicalDescription?:
    string | null;
  @IsOptional() @IsString() @Decimal() thicknessMm?: string | null;
  @IsOptional() @IsString() @Decimal() widthMm?: string | null;
  @IsOptional() @IsString() @Decimal() lengthMm?: string | null;
  @IsOptional() @IsString() @Decimal() weightKg?: string | null;
  @IsOptional() @IsString() @Decimal() densityKgM3?: string | null;
  @IsOptional() @IsString() @MaxLength(100) statusCode?: string | null;
}
function Decimal() {
  return Transform(({ value }) =>
    value === null ? null : String(value).trim(),
  );
}

/**
 * A product photo, uploaded once and reused by every quotation that sells the
 * product. Base64 in the body follows the existing attachment upload: it keeps
 * the request inside the same CSRF and validation path as everything else, at
 * the cost of about a third in transfer size on an image of a few hundred KB.
 */
export class ProductImageUploadDto {
  @IsString() @MaxLength(255) fileName!: string;
  @IsIn(["image/png", "image/jpeg", "image/webp", "image/gif"])
  contentType!: string;
  @IsString() @MaxLength(14000000) contentBase64!: string;
}
