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
} from "./customer-auth.js";
import {
  CreateOpportunityDto,
  OpportunityListQuery,
  ProbabilityOverrideDto,
  CancelOpportunityDto,
  TransitionOpportunityDto,
  UpdateOpportunityDto,
} from "./opportunity.dto.js";
import { OpportunityService } from "./opportunity.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class OpportunityController {
  constructor(private readonly opportunities: OpportunityService) {}
  @Get("opportunities") list(
    @Req() request: CustomerRequest,
    @Query() query: OpportunityListQuery,
  ) {
    return this.opportunities.list(request.customerIdentity, query);
  }
  @Post("opportunities") async create(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CreateOpportunityDto,
  ) {
    const data = await this.opportunities.create(
      request.customerIdentity,
      input,
      key ?? "",
    );
    response.status(201).setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Get("opportunities/:opportunityId") async get(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("opportunityId", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.opportunities.get(request.customerIdentity, id);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Patch("opportunities/:opportunityId") async update(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("opportunityId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Body() input: UpdateOpportunityDto,
  ) {
    const data = await this.opportunities.update(
      request.customerIdentity,
      id,
      tag ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post("opportunities/:opportunityId/stage-transitions")
  @HttpCode(200)
  async transition(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("opportunityId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: TransitionOpportunityDto,
  ) {
    const data = await this.opportunities.transition(
      request.customerIdentity,
      id,
      tag ?? "",
      key ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post("opportunities/:opportunityId/cancel")
  @HttpCode(200)
  async cancel(
    @Req() request: CustomerRequest,
    @Param("opportunityId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: CancelOpportunityDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.opportunities.cancel(
      request.customerIdentity,
      id,
      key ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post("opportunities/:opportunityId/probability-overrides")
  @HttpCode(200)
  async override(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("opportunityId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ProbabilityOverrideDto,
  ) {
    const data = await this.opportunities.overrideProbability(
      request.customerIdentity,
      id,
      tag ?? "",
      key ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Get("reference/opportunity-stage-policies") stages(
    @Req() request: CustomerRequest,
  ) {
    return this.opportunities.stagePolicies(request.customerIdentity);
  }
  @Get("reference/opportunity-lost-reasons") reasons(
    @Req() request: CustomerRequest,
  ) {
    return this.opportunities.lostReasons(request.customerIdentity);
  }
}
