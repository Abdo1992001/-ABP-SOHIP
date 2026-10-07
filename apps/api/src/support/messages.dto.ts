import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from "class-validator";
import { Type } from "class-transformer";

export class MessageListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit = 50;
}

export class MessageSearchQuery extends MessageListQuery {
  @IsString() @Length(2, 200) q!: string;
}

export class CreateConversationDto {
  @IsString() @IsIn(["DM", "GROUP"]) typeCode!: "DM" | "GROUP";
  @IsOptional() @IsString() @Length(1, 120) title?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(49)
  @IsUUID("4", { each: true })
  participantUserIds!: string[];
  @IsOptional() @IsString() @Length(1, 80) businessContextType?: string;
  @IsOptional() @IsUUID("4") businessContextId?: string;
}

export class SendMessageDto {
  @IsString() @Length(1, 10_000) body!: string;
  @IsOptional() @IsUUID("4") replyToMessageId?: string;
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUUID("4", { each: true })
  attachmentIds?: string[];
}

export class ReactionDto {
  @IsString() @Length(1, 16) emoji!: string;
}

export class MessageAttachmentDto {
  @IsString() @Length(1, 180) fileName!: string;
  @IsString() @Length(3, 120) contentType!: string;
  @IsString() @Length(4, 14_000_000) contentBase64!: string;
}
