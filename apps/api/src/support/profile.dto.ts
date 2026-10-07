import {
  IsBase64,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  MaxLength,
} from "class-validator";

/**
 * What a person may change about themselves.
 *
 * The security-critical fields are absent by construction rather than
 * filtered later: there is no property here for role, country scope, manager,
 * team or account status, so no request can carry one even by accident.
 */
export class UpdateMyProfileDto {
  /** The name colleagues see. The account's legal name is not editable here. */
  @IsOptional() @IsString() @Length(2, 120) displayName?: string;
  /** Null clears it. Visibility is a separate preference. */
  @IsOptional() @IsString() @MaxLength(40) phone?: string | null;
  /**
   * What colleagues see. Only optional personal information has a switch:
   * name, role and email are business identity -- the directory finds people
   * by them and work is assigned by them -- so they have none.
   */
  @IsOptional() @IsBoolean() photoVisible?: boolean;
  @IsOptional() @IsBoolean() phoneVisible?: boolean;
}

export class UploadProfilePhotoDto {
  /**
   * The image itself. The declared type is not trusted -- the service sniffs
   * the file's magic number -- so there is no contentType field to disagree
   * with. 6 MB of base64 is roughly the 4 MB binary ceiling.
   */
  @IsString() @IsBase64() @Length(4, 6_000_000) contentBase64!: string;
}
