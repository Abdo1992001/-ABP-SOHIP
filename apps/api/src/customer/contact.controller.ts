import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
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
} from "./customer-auth.js";
import {
  ContactChannelInputDto,
  ContactDirectoryQuery,
  ContactListQuery,
  CreateContactDto,
  CreateContactShareDto,
  UpdateContactDto,
} from "./contact.dto.js";
import { ContactService } from "./contact.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class ContactController {
  constructor(private readonly contacts: ContactService) {}

  @Get("accounts/:accountId/contacts")
  list(
    @Req() request: CustomerRequest,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Query() query: ContactListQuery,
  ) {
    return this.contacts.list(request.customerIdentity, accountId, query);
  }

  @Post("accounts/:accountId/contacts")
  async create(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: CreateContactDto,
  ) {
    const data = await this.contacts.create(
      request.customerIdentity,
      accountId,
      input,
      idempotencyKey ?? "",
    );
    response.status(201).setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Get("contacts")
  directory(
    @Req() request: CustomerRequest,
    @Query() query: ContactDirectoryQuery,
  ) {
    return this.contacts.directory(request.customerIdentity, query);
  }

  @Get("contacts/:contactId")
  async get(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("contactId", new ParseUUIDPipe()) contactId: string,
  ) {
    const data = await this.contacts.get(request.customerIdentity, contactId);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Patch("contacts/:contactId")
  async update(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("contactId", new ParseUUIDPipe()) contactId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() input: UpdateContactDto,
  ) {
    const data = await this.contacts.update(
      request.customerIdentity,
      contactId,
      ifMatch ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post("contacts/:contactId/channels")
  @HttpCode(200)
  async addChannel(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("contactId", new ParseUUIDPipe()) contactId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: ContactChannelInputDto,
  ) {
    const data = await this.contacts.addChannel(
      request.customerIdentity,
      contactId,
      input,
      idempotencyKey ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Delete("contact-channels/:channelId")
  async removeChannel(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("channelId", new ParseUUIDPipe()) channelId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    const data = await this.contacts.removeChannel(
      request.customerIdentity,
      channelId,
      ifMatch ?? "",
      idempotencyKey ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post("accounts/:accountId/contact-shares")
  @HttpCode(200)
  async share(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("accountId", new ParseUUIDPipe()) accountId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: CreateContactShareDto,
  ) {
    const data = await this.contacts.share(
      request.customerIdentity,
      accountId,
      input,
      idempotencyKey ?? "",
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Delete("contact-shares/:shareId")
  async revokeShare(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("shareId", new ParseUUIDPipe()) shareId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
  ) {
    const result = await this.contacts.revokeShare(
      request.customerIdentity,
      shareId,
      ifMatch ?? "",
      idempotencyKey ?? "",
    );
    response.setHeader("ETag", result.rowVersion);
    return {
      data: {
        success: true,
        resourceId: shareId,
        statusCode: "REVOKED",
        jobId: null,
      },
    };
  }
}
