import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsISO8601,
  IsUUID,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class SalesOrderListQuery {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(40) statusCode?: string;
  @IsOptional() @IsString() @MaxLength(2) countryCode?: string;
  /**
   * Over half of ACROW's order history is to its own group companies. Without
   * this filter an "orders" screen silently mixes external demand with
   * intercompany transfers.
   */
  @IsOptional() @IsIn(["EXTERNAL", "GROUP"]) relationship?:
    "EXTERNAL" | "GROUP";
  @IsOptional() @IsISO8601() dateFrom?: string;
  @IsOptional() @IsISO8601() dateTo?: string;
  @IsOptional() @IsString() @MaxLength(60) sort?: string;
}

export class SalesOrderLineListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(500) limit = 200;
}
