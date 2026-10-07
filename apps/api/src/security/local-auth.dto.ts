import {
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
} from "class-validator";

export class LoginDto {
  @IsString() @Length(3, 254) identifier!: string;
  @IsString() @Length(1, 256) password!: string;
}

export class MfaVerifyDto {
  @IsString() @Length(32, 512) challengeToken!: string;
  @IsString() @Matches(/^\d{6}$/) code!: string;
}

export class MfaRecoveryDto {
  @IsString() @Length(32, 512) challengeToken!: string;
  @IsString() @Length(8, 64) recoveryCode!: string;
}

export class MfaCodeDto {
  @IsString() @Matches(/^\d{6}$/) code!: string;
}

export class ResetPasswordDto {
  @IsString() @Length(12, 256) password!: string;
  @IsOptional() @IsBoolean() mustChangePassword?: boolean;
  @IsOptional() @IsBoolean() revokeSessions?: boolean;
}

export class ChangePasswordDto {
  @IsString() @Length(1, 256) currentPassword!: string;
  @IsString() @Length(12, 256) newPassword!: string;
}
