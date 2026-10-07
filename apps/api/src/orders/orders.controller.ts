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
  AmendOrderDto,
  CreateOrderDto,
  OrderListQuery,
  OrderTransitionDto,
  SendOrderConfirmationDto,
} from "./orders.dto.js";
import { OrdersService } from "./orders.service.js";
import { OverviewService } from "./overview.service.js";
import {
  ReceivableListQuery,
  RecordCollectionDto,
  WriteOffDto,
} from "./receivables.dto.js";
import { ReceivablesService } from "./receivables.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class OrdersController {
  constructor(
    private readonly service: OrdersService,
    private readonly receivablesService: ReceivablesService,
    private readonly overview: OverviewService,
  ) {}

  @Get("overview/order-to-cash") orderToCash(@Req() r: CustomerRequest) {
    return this.overview.orderToCash(r.customerIdentity);
  }

  @Get("customer-orders") list(
    @Req() r: CustomerRequest,
    @Query() q: OrderListQuery,
  ) {
    return this.service.list(r.customerIdentity, q);
  }

  @Post("customer-orders") async create(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateOrderDto,
  ) {
    const o = await this.service.create(r.customerIdentity, k, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  // Before the :customerOrderId route, which would otherwise take "bookable".
  @Get("customer-orders/bookable") bookable(@Req() r: CustomerRequest) {
    return this.service.bookable(r.customerIdentity);
  }

  @Get("customer-orders/:customerOrderId") async get(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("customerOrderId", new ParseUUIDPipe()) id: string,
  ) {
    const o = await this.service.get(r.customerIdentity, id);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Patch("customer-orders/:customerOrderId") async amend(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("customerOrderId", new ParseUUIDPipe()) id: string,
    @Body() b: AmendOrderDto,
  ) {
    const o = await this.service.amend(r.customerIdentity, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Get("receivables") receivables(
    @Req() r: CustomerRequest,
    @Query() q: ReceivableListQuery,
  ) {
    return this.receivablesService.list(r.customerIdentity, q);
  }

  @Get("receivables/summary") receivablesSummary(@Req() r: CustomerRequest) {
    return this.receivablesService.summary(r.customerIdentity);
  }

  @Post("receivables/:receivableInstallmentId/collections") collect(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("receivableInstallmentId", new ParseUUIDPipe()) id: string,
    @Body() b: RecordCollectionDto,
  ) {
    return this.receivablesService.collect(r.customerIdentity, k, id, b);
  }

  @Post("receivables/:receivableInstallmentId/write-offs")
  @HttpCode(200)
  writeOff(
    @Req() r: CustomerRequest,
    @Param("receivableInstallmentId", new ParseUUIDPipe()) id: string,
    @Body() b: WriteOffDto,
  ) {
    return this.receivablesService.writeOff(r.customerIdentity, id, b);
  }

  @Post("customer-orders/:customerOrderId/transitions")
  @HttpCode(200)
  async transition(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("customerOrderId", new ParseUUIDPipe()) id: string,
    @Body() b: OrderTransitionDto,
  ) {
    const o = await this.service.transition(r.customerIdentity, k, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Post("customer-orders/:customerOrderId/confirmation-emails")
  @HttpCode(202)
  async sendConfirmation(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("customerOrderId", new ParseUUIDPipe()) id: string,
    @Body() b: SendOrderConfirmationDto,
  ) {
    const o = await this.service.sendConfirmation(r.customerIdentity, k, id, b);
    return { data: o.data };
  }
}
