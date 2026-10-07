import { Type } from "class-transformer";
import {
  IsDateString,
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
import { COMPLAINT_STAGES, ROOT_CAUSES } from "./complaint-flow.js";

export class PageQuery {
  @IsOptional() @IsUUID() accountId?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) offset?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit = 25;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
/** The complaints list, optionally narrowed to a stage or to one's own queue. */
export class ComplaintListQuery extends PageQuery {
  @IsOptional() @IsIn(COMPLAINT_STAGES) statusCode?: string;
  @IsOptional() @IsIn(["true", "false"]) assignedToMe?: string;
  @IsOptional() @IsIn(["true", "false"]) overdue?: string;
}
export class GroupMembershipDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsDateString() validFrom?: string | null;
  @IsOptional() @IsDateString() validTo?: string | null;
  @IsOptional() @IsString() @MaxLength(300) sourceRef?: string | null;
}
export class CreateComplaintDto {
  @IsUUID() accountId!: string;
  @IsOptional() @IsUUID() projectId?: string | null;
  @IsOptional() @IsUUID() salesOrderId?: string | null;
  @IsOptional() @IsUUID() contactId?: string | null;
  @IsOptional() @IsUUID() productId?: string | null;
  @IsString() @MinLength(1) @MaxLength(100) complaintTypeCode!: string;
  @IsOptional()
  @IsIn(["PHONE_CALL", "MESSAGE", "VISIT", "EMAIL"])
  channelCode?: string | null;
  @IsOptional() @IsString() @MaxLength(100) severityCode?: string | null;
  @IsString() @MinLength(3) @MaxLength(5000) description!: string;
  @IsOptional() @IsUUID() customerOrderId?: string | null;
}
/** The working fields of each stage, which can be saved before moving on. */
class ComplaintStageFields {
  @IsOptional() @IsUUID() assigneeUserId?: string | null;
  @IsOptional() @IsUUID() customerOrderId?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) operationsFindings?: string | null;
  @IsOptional() @IsIn(ROOT_CAUSES) rootCauseCode?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) rootCauseDetail?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) correctiveAction?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) preventiveAction?: string | null;
  @IsOptional() @IsUUID() solutionOwnerUserId?: string | null;
  @IsOptional() @IsDateString() solutionDueDate?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) resolution?: string | null;
}
export class UpdateComplaintDto extends ComplaintStageFields {
  @IsOptional() @IsString() @MaxLength(100) severityCode?: string | null;
  @IsOptional() @IsUUID() ownerUserId?: string | null;
  @IsOptional() @IsString() @MaxLength(5000) description?: string | null;
}
export class ComplaintTransitionDto extends ComplaintStageFields {
  @IsString()
  @IsIn(COMPLAINT_STAGES)
  targetStatusCode!: string;
  @IsString() @Matches(/^\d+$/) expectedRowVersion!: string;
  @IsOptional() @IsString() @MaxLength(1000) reason?: string | null;
  @IsOptional() @IsString() @MaxLength(2000) note?: string | null;
}
