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
  DismissDto,
  GenerateAdvisoryDto,
  MarkAllDto,
  PreferencesDto,
  SalesHistoryQuery,
  ScopedQuery,
  SearchQuery,
} from "./insight.dto.js";
import { InsightService } from "./insight.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class InsightController {
  constructor(private readonly s: InsightService) {}
  @Get("notifications") notifications(
    @Req() r: CustomerRequest,
    @Query() q: ScopedQuery,
  ) {
    return this.s.notifications(r.customerIdentity, q);
  }
  @Post("notifications/:notificationId/read")
  @HttpCode(200)
  read(
    @Req() r: CustomerRequest,
    @Param("notificationId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.read(r.customerIdentity, id);
  }
  @Post("notifications/read-all")
  @HttpCode(200)
  readAll(@Req() r: CustomerRequest, @Body() b: MarkAllDto) {
    return this.s.readAll(r.customerIdentity, b);
  }
  @Get("preferences") async preferences(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const o = await this.s.preferences(r.customerIdentity);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Patch("preferences") async updatePreferences(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-match") tag: string | undefined,
    @Body() b: PreferencesDto,
  ) {
    const o = await this.s.updatePreferences(r.customerIdentity, tag ?? "", b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Get("ai/advisories") advisories(
    @Req() r: CustomerRequest,
    @Query() q: ScopedQuery,
  ) {
    return this.s.advisories(r.customerIdentity, q);
  }
  @Post("ai/advisories/generate")
  @HttpCode(201)
  generateAdvisory(@Req() r: CustomerRequest, @Body() b: GenerateAdvisoryDto) {
    return this.s.generateAdvisory(r.customerIdentity, b);
  }
  @Post("ai/advisories/:advisoryId/dismiss")
  @HttpCode(200)
  dismiss(
    @Req() r: CustomerRequest,
    @Param("advisoryId", new ParseUUIDPipe()) id: string,
    @Body() b: DismissDto,
  ) {
    return this.s.dismiss(r.customerIdentity, id, b);
  }
  @Get("action-queue") queue(
    @Req() r: CustomerRequest,
    @Query() q: ScopedQuery,
  ) {
    return this.s.queue(r.customerIdentity, q);
  }
  @Get("search") search(@Req() r: CustomerRequest, @Query() q: SearchQuery) {
    return this.s.search(r.customerIdentity, q);
  }
  @Get("audit") audit(@Req() r: CustomerRequest, @Query() q: ScopedQuery) {
    return this.s.auditEvents(r.customerIdentity, q);
  }
  @Get("security-events") security(
    @Req() r: CustomerRequest,
    @Query() q: ScopedQuery,
  ) {
    return this.s.securityEvents(r.customerIdentity, q);
  }
  @Get("metrics/commercial") metrics(@Req() r: CustomerRequest) {
    return this.s.metrics(r.customerIdentity);
  }
  @Get("reports/pipeline") pipeline(@Req() r: CustomerRequest) {
    return this.s.report(r.customerIdentity, "PIPELINE", "reports.pipeline");
  }
  @Get("reports/quotations") quotations(@Req() r: CustomerRequest) {
    return this.s.report(
      r.customerIdentity,
      "QUOTATIONS",
      "reports.quotations",
    );
  }
  @Get("reports/orders") orders(@Req() r: CustomerRequest) {
    return this.s.report(r.customerIdentity, "ORDERS", "reports.orders");
  }
  @Get("reports/sales-history") salesHistory(
    @Req() r: CustomerRequest,
    @Query() q: SalesHistoryQuery,
  ) {
    return this.s.salesHistory(r.customerIdentity, q);
  }
  @Get("reports/finance") finance(@Req() r: CustomerRequest) {
    return this.s.report(r.customerIdentity, "FINANCE", "reports.finance");
  }
}
