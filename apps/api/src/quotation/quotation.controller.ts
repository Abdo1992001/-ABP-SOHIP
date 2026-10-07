import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
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
  CreateQuotationDto,
  CreateAcceptanceDto,
  QuotationPreviewDto,
  RequestQuotationApprovalDto,
  SendQuotationDto,
  VersionedQuotationCommandDto,
  QuotationListQuery,
  SaveQuotationDraftDto,
  CancelQuotationDto,
  SupersedeQuotationDto,
} from "./quotation.dto.js";
import { QuotationService } from "./quotation.service.js";
@Controller("quotations")
@UseGuards(CustomerIdentityGuard)
export class QuotationController {
  constructor(private readonly quotations: QuotationService) {}
  @Get() list(
    @Req() request: CustomerRequest,
    @Query() query: QuotationListQuery,
  ) {
    return this.quotations.list(request.customerIdentity, query);
  }
  @Post() async create(
    @Req() request: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateQuotationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.quotations.create(
      request.customerIdentity,
      key,
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  // Declared before any route with a parameter in the same position, so the
  // literal is not swallowed as an id.
  @Post("read-pdf") @HttpCode(200) async readPdf(
    @Req() request: CustomerRequest,
    @Body() file: Buffer,
  ) {
    return {
      data: await this.quotations.readPdf(request.customerIdentity, file),
    };
  }
  @Get(":quotationId") async get(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.quotations.get(request.customerIdentity, id);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Get(":quotationId/supersession-chain") chain(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.chain(request.customerIdentity, id);
  }
  @Put(":quotationId/draft-content") async saveDraft(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Body() input: SaveQuotationDraftDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.quotations.saveDraft(
      request.customerIdentity,
      id,
      tag ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post(":quotationId/supersede")
  @HttpCode(200)
  async supersede(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: SupersedeQuotationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.quotations.supersede(
      request.customerIdentity,
      id,
      key,
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post(":quotationId/cancel")
  @HttpCode(200)
  async cancel(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CancelQuotationDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.quotations.cancel(
      request.customerIdentity,
      id,
      key,
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post(":quotationId/prepare")
  @HttpCode(202)
  prepare(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: VersionedQuotationCommandDto,
  ) {
    return this.quotations.prepare(request.customerIdentity, id, key, input);
  }

  @Post(":quotationId/approval-requests")
  @HttpCode(200)
  requestApproval(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: RequestQuotationApprovalDto,
  ) {
    return this.quotations.requestApproval(
      request.customerIdentity,
      id,
      key,
      input,
    );
  }

  @Post(":quotationId/preview")
  @HttpCode(200)
  preview(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: QuotationPreviewDto,
  ) {
    return this.quotations.preview(request.customerIdentity, id, key, input);
  }

  @Post(":quotationId/send")
  @HttpCode(202)
  send(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: SendQuotationDto,
  ) {
    return this.quotations.send(request.customerIdentity, id, key, input);
  }

  @Post(":quotationId/acceptances")
  async accept(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateAcceptanceDto,
  ) {
    return this.quotations.accept(request.customerIdentity, id, key, input);
  }

  @Get(":quotationId/documents")
  documents(
    @Req() request: CustomerRequest,
    @Param("quotationId", new ParseUUIDPipe()) id: string,
    @Query() query: QuotationListQuery,
  ) {
    return this.quotations.documents(request.customerIdentity, id, query);
  }
}
