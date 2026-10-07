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
  CreateWorkOrderDto,
  ProductionScheduleQuery,
  RescheduleWorkOrderDto,
  WorkOrderListQuery,
  WorkOrderTransitionDto,
} from "./work-orders.dto.js";
import { WorkOrdersService } from "./work-orders.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class WorkOrdersController {
  constructor(private readonly service: WorkOrdersService) {}

  @Get("work-orders") list(
    @Req() r: CustomerRequest,
    @Query() q: WorkOrderListQuery,
  ) {
    return this.service.list(r.customerIdentity, q);
  }

  @Post("work-orders") async create(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateWorkOrderDto,
  ) {
    const o = await this.service.create(r.customerIdentity, k, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Get("operations/production-schedule") schedule(
    @Req() r: CustomerRequest,
    @Query() q: ProductionScheduleQuery,
  ) {
    return this.service.schedule(r.customerIdentity, q);
  }

  @Get("work-orders/:workOrderId") async get(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("workOrderId", new ParseUUIDPipe()) id: string,
  ) {
    const o = await this.service.get(r.customerIdentity, id);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Patch("work-orders/:workOrderId") async reschedule(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("workOrderId", new ParseUUIDPipe()) id: string,
    @Body() b: RescheduleWorkOrderDto,
  ) {
    const o = await this.service.reschedule(r.customerIdentity, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Post("work-orders/:workOrderId/transitions")
  @HttpCode(200)
  async transition(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("workOrderId", new ParseUUIDPipe()) id: string,
    @Body() b: WorkOrderTransitionDto,
  ) {
    const o = await this.service.transition(r.customerIdentity, k, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
}
