import {
  IsIn,
  IsNumber,
  IsOptional,
  IsUUID,
  Matches,
  Max,
  Min,
  ValidateIf,
} from "class-validator";

export class MapPlacesQuery {
  @IsOptional() @Matches(/^[A-Z]{2}$/) countryCode?: string;
}

/** A pin for a customer or a project; nulls take the pin away. */
export class PinLocationDto {
  @IsIn(["ACCOUNT", "PROJECT"]) resourceTypeCode!: "ACCOUNT" | "PROJECT";
  @IsUUID() resourceId!: string;
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude!: number | null;
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude!: number | null;
}
