import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Max,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";

export class CancelActivityDto {
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}
class ActivityLinkDto {
  @IsString() @MaxLength(50) resourceTypeCode!: string;
  @IsUUID() resourceId!: string;
  @IsOptional() @IsBoolean() isPrimary?: boolean;
}
export class CreateActivityDto {
  @IsString() @MinLength(1) @MaxLength(100) typeCode!: string;
  @IsOptional() @IsString() @MaxLength(300) subject?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @IsDateString() occurredAt?: string | null;
  @IsOptional() @IsDateString() scheduledAt?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ActivityLinkDto)
  links!: ActivityLinkDto[];
}
export class ActivityListQuery {
  @IsOptional() @IsDateString() dueFrom?: string;
  @IsOptional() @IsDateString() dueTo?: string;
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
}
export class CompleteActivityDto {
  @IsString() expectedRowVersion!: string;
  @IsOptional() @IsString() @MaxLength(100) outcomeCode?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
}
export class RescheduleActivityDto {
  @IsString() expectedRowVersion!: string;
  @IsDateString() newDueAt!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string | null;
}
export class UpdateActivityDto {
  @IsOptional() @IsString() @MaxLength(300) subject?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @IsDateString() scheduledAt?: string | null;
  @IsOptional() @IsDateString() dueAt?: string | null;
  @IsOptional() @IsString() @MaxLength(100) outcomeCode?: string | null;
}
