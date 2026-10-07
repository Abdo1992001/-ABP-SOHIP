import {
  Body,
  Controller,
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
} from "../customer/customer-auth.js";
import {
  ApproveReturnDto,
  CreateReturnDto,
  ExpectedReturnDto,
  ReturnListQuery,
  UpdateReturnDto,
} from "./returns.dto.js";
import { ReturnsService } from "./returns.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class ReturnsController {
  constructor(private readonly service: ReturnsService) {}
  @Get("returned-scrap-cases") list(
    @Req() r: CustomerRequest,
    @Query() q: ReturnListQuery,
  ) {
    return this.service.list(r.customerIdentity, q);
  }
  @Post("returned-scrap-cases") create(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateReturnDto,
  ) {
    return this.service.create(r.customerIdentity, k, b);
  }
  @Get("returned-scrap-cases/:caseId") get(
    @Req() r: CustomerRequest,
    @Param("caseId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(r.customerIdentity, id);
  }
  @Patch("returned-scrap-cases/:caseId") async update(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-match") e: string | undefined,
    @Param("caseId", new ParseUUIDPipe()) id: string,
    @Body() b: UpdateReturnDto,
  ) {
    const o = await this.service.update(r.customerIdentity, e, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("returned-scrap-cases/:caseId/submit-approval")
  @HttpCode(200)
  async submit(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("caseId", new ParseUUIDPipe()) id: string,
    @Body() b: ExpectedReturnDto,
  ) {
    const o = await this.service.submit(r.customerIdentity, k, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("returned-scrap-cases/:caseId/approve") @HttpCode(200) async approve(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("caseId", new ParseUUIDPipe()) id: string,
    @Body() b: ApproveReturnDto,
  ) {
    const o = await this.service.approve(r.customerIdentity, k, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("returned-scrap-cases/:caseId/finalize") @HttpCode(200) async finalize(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("caseId", new ParseUUIDPipe()) id: string,
    @Body() b: ExpectedReturnDto,
  ) {
    const o = await this.service.finalize(r.customerIdentity, k, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
}
