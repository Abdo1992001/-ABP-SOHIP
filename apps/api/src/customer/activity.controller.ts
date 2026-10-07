import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Patch,
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
} from "./customer-auth.js";
import {
  ActivityListQuery,
  CancelActivityDto,
  CompleteActivityDto,
  CreateActivityDto,
  RescheduleActivityDto,
  UpdateActivityDto,
} from "./activity.dto.js";
import { ActivityService } from "./activity.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class ActivityController {
  constructor(private readonly activities: ActivityService) {}
  @Get("activities") list(
    @Req() request: CustomerRequest,
    @Query() query: ActivityListQuery,
  ) {
    return this.activities.list(request.customerIdentity, query);
  }
  @Get("activities/:activityId") async get(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("activityId", new ParseUUIDPipe()) id: string,
  ) {
    const data = await this.activities.get(request.customerIdentity, id);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post("activities") async create(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: CreateActivityDto,
  ) {
    const data = await this.activities.create(
      request.customerIdentity,
      body,
      key ?? "",
    );
    response.status(201).setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post("activities/:activityId/cancel") @HttpCode(200) async cancel(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("activityId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: CancelActivityDto,
  ) {
    const data = await this.activities.cancel(
      request.customerIdentity,
      id,
      tag ?? "",
      key ?? "",
      body.reason,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post("activities/:activityId/complete") @HttpCode(200) async complete(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("activityId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: CompleteActivityDto,
  ) {
    const data = await this.activities.complete(
      request.customerIdentity,
      id,
      key ?? "",
      body,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Post("activities/:activityId/reschedule") @HttpCode(200) async reschedule(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("activityId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: RescheduleActivityDto,
  ) {
    const data = await this.activities.reschedule(
      request.customerIdentity,
      id,
      key ?? "",
      body,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
  @Patch("activities/:activityId") async update(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("activityId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Body() body: UpdateActivityDto,
  ) {
    const data = await this.activities.update(
      request.customerIdentity,
      id,
      tag ?? "",
      body,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }
}
