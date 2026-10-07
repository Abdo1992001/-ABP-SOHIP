import { Type } from "class-transformer";
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import {
  PRIORITIES,
  PRODUCTION_LINES,
  QC_RESULTS,
  WORK_ORDER_STATUSES,
} from "./work-order-flow.js";

const decimal = /^\d+(\.\d{1,4})?$/;
const version = /^\d+$/;
const day = /^\d{4}-\d{2}-\d{2}$/;

export class WorkOrderListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsIn(WORK_ORDER_STATUSES) status?: string;
  @IsOptional() @IsUUID() customerOrderId?: string;
  @IsOptional() @IsIn(PRODUCTION_LINES) productionLineCode?: string;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}

/** Plan a run of an order's boards on a line. */
export class CreateWorkOrderDto {
  @IsUUID() customerOrderId!: string;
  @IsIn(PRODUCTION_LINES) productionLineCode!: string;
  @IsString() @MaxLength(50) capacityCategoryCode!: string;
  /** Defaults to every board on the order. */
  @IsOptional() @IsString() @Matches(decimal) quantityPlanned?: string;
  @Matches(day) plannedStartDate!: string;
  /** Defaults to what the category's capacity rate says the run takes. */
  @IsOptional() @Matches(day) plannedEndDate?: string;
  @IsOptional() @IsIn(PRIORITIES) priorityCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

/** Move the run: another line, other dates, another priority. */
export class RescheduleWorkOrderDto {
  @IsString() @Matches(version) expectedRowVersion!: string;
  @IsOptional() @IsIn(PRODUCTION_LINES) productionLineCode?: string;
  @IsOptional() @Matches(day) plannedStartDate?: string;
  @IsOptional() @Matches(day) plannedEndDate?: string;
  @IsOptional() @IsIn(PRIORITIES) priorityCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsString() @MaxLength(500) reason!: string;
}

export class WorkOrderTransitionDto {
  @IsString() @Matches(version) expectedRowVersion!: string;
  @IsIn(WORK_ORDER_STATUSES) targetStatusCode!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsOptional() @IsString() @Matches(decimal) quantityProduced?: string;
  @IsOptional() @IsString() @Matches(decimal) quantityRejected?: string;
  @IsOptional() @IsIn(QC_RESULTS) qcResultCode?: string;
  @IsOptional() @IsString() @MaxLength(2000) qcNotes?: string;
}

/** A window on the production schedule, at most about four months. */
export class ProductionScheduleQuery {
  @Matches(day) from!: string;
  @Matches(day) to!: string;
}
