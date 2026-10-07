import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  CreateConversationDto,
  MessageAttachmentDto,
  MessageListQuery,
  MessageSearchQuery,
  ReactionDto,
  SendMessageDto,
} from "./messages.dto.js";
import { MessagesService } from "./messages.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Get("conversations")
  list(@Req() request: CustomerRequest, @Query() query: MessageListQuery) {
    return this.messages.list(request.customerIdentity, query);
  }

  @Post("conversations")
  create(@Req() request: CustomerRequest, @Body() body: CreateConversationDto) {
    return this.messages.create(request.customerIdentity, body);
  }

  @Get("conversations/:conversationId")
  detail(
    @Req() request: CustomerRequest,
    @Param("conversationId", new ParseUUIDPipe()) conversationId: string,
    @Query() query: MessageListQuery,
  ) {
    return this.messages.detail(
      request.customerIdentity,
      conversationId,
      query,
    );
  }

  @Post("conversations/:conversationId/messages")
  send(
    @Req() request: CustomerRequest,
    @Param("conversationId", new ParseUUIDPipe()) conversationId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messages.send(request.customerIdentity, conversationId, body);
  }

  @Post("conversations/:conversationId/read")
  @HttpCode(200)
  read(
    @Req() request: CustomerRequest,
    @Param("conversationId", new ParseUUIDPipe()) conversationId: string,
  ) {
    return this.messages.markRead(request.customerIdentity, conversationId);
  }

  @Post("conversations/:conversationId/attachments")
  upload(
    @Req() request: CustomerRequest,
    @Param("conversationId", new ParseUUIDPipe()) conversationId: string,
    @Body() body: MessageAttachmentDto,
  ) {
    return this.messages.upload(request.customerIdentity, conversationId, body);
  }

  /**
   * The thread for one commercial record. Addressed by what it is about, not
   * by a conversation id, so a screen showing a deal can ask for "the
   * conversation about this deal" without first knowing whether one exists.
   */
  @Get("record-conversations/:contextType/:contextId")
  recordThread(
    @Req() request: CustomerRequest,
    @Param("contextType") contextType: string,
    @Param("contextId", new ParseUUIDPipe()) contextId: string,
    @Query() query: MessageListQuery,
  ) {
    return this.messages.recordThread(
      request.customerIdentity,
      contextType,
      contextId,
      query,
    );
  }

  @Post("record-conversations/:contextType/:contextId/messages")
  postToRecord(
    @Req() request: CustomerRequest,
    @Param("contextType") contextType: string,
    @Param("contextId", new ParseUUIDPipe()) contextId: string,
    @Body() body: SendMessageDto,
  ) {
    return this.messages.postToRecord(
      request.customerIdentity,
      contextType,
      contextId,
      body,
    );
  }

  @Get("messages/directory")
  directory(
    @Req() request: CustomerRequest,
    @Query("search") search?: string,
    @Query("limit") limit?: string,
  ) {
    return this.messages.directory(
      request.customerIdentity,
      search,
      limit === undefined ? undefined : Number(limit),
    );
  }

  @Get("messages/search")
  search(@Req() request: CustomerRequest, @Query() query: MessageSearchQuery) {
    return this.messages.search(request.customerIdentity, query);
  }

  @Get("messages/:messageId")
  message(
    @Req() request: CustomerRequest,
    @Param("messageId", new ParseUUIDPipe()) messageId: string,
  ) {
    return this.messages.message(request.customerIdentity, messageId);
  }

  @Post("messages/:messageId/reactions")
  @HttpCode(200)
  react(
    @Req() request: CustomerRequest,
    @Param("messageId", new ParseUUIDPipe()) messageId: string,
    @Body() body: ReactionDto,
  ) {
    return this.messages.react(request.customerIdentity, messageId, body);
  }

  @Get("message-attachments/:attachmentId/download")
  async download(
    @Req() request: CustomerRequest,
    @Param("attachmentId", new ParseUUIDPipe()) attachmentId: string,
    @Res() response: Response,
  ) {
    const result = await this.messages.download(
      request.customerIdentity,
      attachmentId,
    );
    response.setHeader("Content-Type", result.attachment.contentType);
    response.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(result.attachment.fileName)}`,
    );
    response.setHeader("Content-Length", String(result.bytes.length));
    response.send(result.bytes);
  }
}
