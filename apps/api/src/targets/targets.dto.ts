import { Type } from "class-transformer";
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from "class-validator";
const decimal = /^\d+(\.\d+)?$/;
export class TargetYearParam {
  @Type(() => Number) @IsInt() @Min(2000) @Max(2200) year!: number;
}
/**
 * One salesperson's target for the year, in EGP. Null clears it, so the person
 * goes back to having no personal target rather than a target of zero.
 */
export class SetPersonTargetDto {
  @IsOptional() @IsString() @Matches(decimal) amountEgp!: string | null;
}
export class SetTargetDto {
  @IsString() @Matches(decimal) annualTargetAmount!: string;
  @IsIn(["USD"]) baseCurrencyCode!: string;
}
export class TargetPeriodDto {
  @IsIn(["MONTH", "QUARTER"]) periodTypeCode!: string;
  @IsDateString() periodStart!: string;
  @IsDateString() periodEnd!: string;
  @IsString() @Matches(decimal) targetAmount!: string;
}
export class SetTargetPeriodsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TargetPeriodDto)
  periods!: TargetPeriodDto[];
}
