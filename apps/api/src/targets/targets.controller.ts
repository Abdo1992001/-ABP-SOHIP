import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
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
  SetPersonTargetDto,
  SetTargetDto,
  SetTargetPeriodsDto,
} from "./targets.dto.js";
import { TargetsService } from "./targets.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class TargetsController {
  constructor(private readonly service: TargetsService) {}
  @Get("company-targets") get(@Req() r: CustomerRequest) {
    return this.service.getCurrent(r.customerIdentity);
  }
  @Put("company-targets/:year") async set(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-match") e: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Param("year") year: string,
    @Body() b: SetTargetDto,
  ) {
    const o = await this.service.set(r.customerIdentity, e, k, year, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data, analyticsMetadata: o.analyticsMetadata };
  }
  @Put("company-targets/:year/periods") async periods(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-match") e: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Param("year") year: string,
    @Body() b: SetTargetPeriodsDto,
  ) {
    const o = await this.service.setPeriods(r.customerIdentity, e, k, year, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data, analyticsMetadata: o.analyticsMetadata };
  }
  // Targets by salesperson. A manager reads everyone's; anybody else reads
  // their own. Only a manager sets them.
  @Get("targets/:year/people") people(
    @Req() r: CustomerRequest,
    @Param("year") year: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
  ) {
    return this.service.people(r.customerIdentity, year, from, to);
  }
  @Put("targets/:year/people/:userId") setPerson(
    @Req() r: CustomerRequest,
    @Param("year") year: string,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() dto: SetPersonTargetDto,
  ) {
    return this.service.setPerson(r.customerIdentity, year, userId, dto);
  }
  @Get("company-targets/:year/performance") performance(
    @Req() r: CustomerRequest,
    @Param("year") year: string,
  ) {
    return this.service.performance(r.customerIdentity, year);
  }
}
