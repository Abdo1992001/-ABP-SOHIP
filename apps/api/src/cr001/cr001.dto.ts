import { Type } from "class-transformer";
import {
  ArrayMaxSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from "class-validator";
import {
  DELIVERY_CONDITIONS,
  LOAD_UNIT_TYPES,
  TRANSPORT_MODES,
} from "./shipment-flow.js";

export class CrPageQuery {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset = 0;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsUUID() customerOrderId?: string;
}

export class CreateSegmentDto {
  @IsString() @Matches(/^[A-Z][A-Z0-9_]{1,49}$/) code!: string;
  @IsString() @MinLength(1) @MaxLength(150) displayNameEn!: string;
  @IsString() @MinLength(1) @MaxLength(150) displayNameAr!: string;
}

export class AssignSegmentDto {
  @IsUUID() segmentId!: string;
  @IsDateString() effectiveFrom!: string;
  @IsOptional() @IsString() @MaxLength(100) sourceCode?: string;
  @IsOptional() @IsString() @MaxLength(300) sourceReference?: string;
}

export class ArchiveSegmentDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
}

export class CommercialStateDto {
  @IsIn(["UNDER_NEGOTIATION"]) targetStateCode!: "UNDER_NEGOTIATION";
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

export class LoadPlanUnitDto {
  @IsIn(LOAD_UNIT_TYPES) typeCode!: string;
  @Type(() => Number) @IsInt() @Min(1) @Max(500) count!: number;
}

/** What the Cargo Loader worked out: the units, their weight, a note. */
export class LoadPlanDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => LoadPlanUnitDto)
  units!: LoadPlanUnitDto[];
  @IsOptional() @IsNumber() @Min(0) @Max(10_000_000) totalWeightKg?: number;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}

/**
 * A shipment is made for an ERP export order (as before) or for a CRM
 * customer order -- exactly one of the two.
 */
export class CreateShipmentDto {
  @IsOptional() @IsUUID() erpOrderId?: string;
  @IsOptional() @IsUUID() customerOrderId?: string;
  @IsDateString() businessOccurredAt!: string;
  @IsOptional() @IsIn(TRANSPORT_MODES) transportModeCode?: string;
  @IsOptional() @IsDateString() plannedDispatchDate?: string;
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => LoadPlanDto)
  loadPlan?: LoadPlanDto;
}

/** The truck or container leaves: what it is, and who drives it. */
export class DispatchShipmentDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsDateString() dispatchedAt!: string;
  @IsOptional() @IsString() @MaxLength(100) vehicleRef?: string;
  @IsOptional() @IsString() @MaxLength(100) containerNo?: string;
  @IsOptional() @IsString() @MaxLength(100) sealNo?: string;
  @IsOptional() @IsString() @MaxLength(200) driverName?: string;
  @IsOptional() @IsString() @MaxLength(50) driverPhone?: string;
  /** A revised arrival date, now that it is on the road. */
  @IsOptional() @IsDateString() expectedDeliveryDate?: string;
}

/** The customer takes the goods: when, who signed, in what state. */
export class DeliverShipmentDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsDateString() deliveredAt!: string;
  @IsString() @MinLength(2) @MaxLength(200) receivedByName!: string;
  @IsIn(DELIVERY_CONDITIONS) deliveryConditionCode!: string;
  @IsOptional() @IsString() @MaxLength(2000) deliveryNotes?: string;
}

/** The signed delivery note is back: its number, its scan, or both. */
export class ShipmentPodDto {
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsDateString() podReceivedAt!: string;
  @IsOptional() @IsString() @MaxLength(200) podReference?: string;
  @IsOptional() @IsUUID() podDocumentId?: string;
}

export class ShipmentMilestoneDto {
  @IsIn(["SHIPPED", "VESSEL_DEPARTED", "ARRIVED_AT_PORT_OF_DISCHARGE"])
  milestoneCode!:
    "SHIPPED" | "VESSEL_DEPARTED" | "ARRIVED_AT_PORT_OF_DISCHARGE";
  @IsDateString() businessOccurredAt!: string;
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsOptional() @IsDateString() blDate?: string;
  @IsOptional() @IsString() @MaxLength(200) portOfDischarge?: string;
  @IsOptional() @IsDateString() actualArrivalAt?: string;
}

export class ShipmentCorrectionDto {
  @IsString() @MinLength(3) @MaxLength(1000) reason!: string;
  @IsDateString() businessOccurredAt!: string;
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsOptional() @IsDateString() blDate?: string | null;
  @IsOptional() @IsString() @MaxLength(200) portOfDischarge?: string | null;
  @IsOptional() @IsDateString() actualArrivalAt?: string | null;
}

export class ProvisionClientIdentityDto {
  @IsString() @MinLength(3) @MaxLength(300) issuer!: string;
  @IsString() @MinLength(3) @MaxLength(300) subject!: string;
  @IsOptional() @IsString() @MaxLength(200) displayName?: string;
  @IsOptional() @IsString() @MaxLength(320) email?: string;
}

export class ClientBindingDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsDateString() validFrom?: string;
}

export class PortalComplaintDto {
  @IsString() @MinLength(1) @MaxLength(100) complaintTypeCode!: string;
  @IsString() @MinLength(3) @MaxLength(5000) description!: string;
  @IsOptional() @IsUUID() productId?: string;
}

export class AsOfQuery extends CrPageQuery {
  @IsOptional() @IsDateString() asOf?: string;
}

/** A window of days on the delivery calendar, at most about three months. */
export class DeliveryCalendarQuery {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) from!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) to!: string;
}
