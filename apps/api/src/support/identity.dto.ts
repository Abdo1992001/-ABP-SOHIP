import { Type } from "class-transformer";
import {
  ArrayUnique,
  IsArray,
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
export class AdminListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class CreateRoleDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,99}$/) roleCode!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  permissionIds!: string[];
}
export class UpdateRoleDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(200) name?: string | null;
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID("4", { each: true })
  permissionIds?: string[];
  @IsOptional() @IsBoolean() isSystemProtected?: boolean | null;
}
/** Sign-in names: letters, digits, dot, underscore and hyphen, and they may
 *  not start or end with a separator. Matches the contract's own pattern. */
export const usernamePattern = /^[a-zA-Z0-9][a-zA-Z0-9._-]{1,48}[a-zA-Z0-9]$/;

export class CreateUserDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) @MaxLength(200) displayName!: string;
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(usernamePattern)
  username?: string | null;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string | null;
  @IsOptional() @IsUUID() managerUserId?: string | null;
  @IsOptional() @IsUUID() teamId?: string | null;
  @IsArray() @ArrayUnique() @IsUUID("4", { each: true }) roleIds!: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) countryCodes!: string[];
}
export class UpdateUserDto {
  @IsOptional() @IsString() @MaxLength(200) displayName?: string | null;
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string | null;
  @IsOptional() @IsUUID() managerUserId?: string | null;
  @IsOptional() @IsUUID() teamId?: string | null;
}
export class LifecycleDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class InviteDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsIn(["EMAIL", "MANUAL"]) deliveryChannel!: string;
  @IsInt() @Min(1) @Max(168) expiresInHours!: number;
}
export class CountriesDto {
  @IsArray() @ArrayUnique() @IsString({ each: true }) countryCodes!: string[];
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class RolesDto {
  @IsArray() @ArrayUnique() @IsUUID("4", { each: true }) roleIds!: string[];
  @IsOptional() @IsString() validFrom?: string | null;
  @IsOptional() @IsString() validTo?: string | null;
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
export class RevokeDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsOptional() @IsBoolean() exceptCurrentSession = false;
}
export class LogoutDto {
  @IsBoolean() allSessions!: boolean;
}
export class SubmitAccessRequestDto {
  @IsString() @MinLength(1) @MaxLength(200) fullName!: string;
  @IsEmail() workEmail!: string;
  @IsOptional() @IsString() @MaxLength(200) companyOrRole?: string | null;
  @IsOptional() @IsString() @MaxLength(2) countryCode?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) message?: string | null;
}
export class ApproveAccessRequestDto {
  @IsOptional() @IsString() @MaxLength(200) jobTitle?: string | null;
  @IsArray() @ArrayUnique() @IsUUID("4", { each: true }) roleIds!: string[];
  @IsArray() @ArrayUnique() @IsString({ each: true }) countryCodes!: string[];
}
export class RejectAccessRequestDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
}
