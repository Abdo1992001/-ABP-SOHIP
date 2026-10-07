import {
  Body,
  Controller,
  Get,
  Headers,
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
  AllocatePaymentDto,
  ChequeTransitionDto,
  CreateChequeDto,
  CreateFxRateDto,
  CreatePaymentDto,
  FinanceListQuery,
  FxResolveQuery,
} from "./finance.dto.js";
import { FinanceService } from "./finance.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class FinanceController {
  constructor(private readonly service: FinanceService) {}
  @Get("finance/fx-rates") fx(
    @Req() r: CustomerRequest,
    @Query() q: FinanceListQuery,
  ) {
    return this.service.listFx(r.customerIdentity, q);
  }
  @Post("finance/fx-rates") createFx(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateFxRateDto,
  ) {
    return this.service.createFx(r.customerIdentity, k, b);
  }
  @Get("finance/fx-rates/resolve") resolveFx(
    @Req() r: CustomerRequest,
    @Query() q: FxResolveQuery,
  ) {
    return this.service.resolveFx(r.customerIdentity, q);
  }
  @Get("finance/payments") payments(
    @Req() r: CustomerRequest,
    @Query() q: FinanceListQuery,
  ) {
    return this.service.listPayments(r.customerIdentity, q);
  }
  @Get("finance/payments/:paymentId") payment(
    @Req() r: CustomerRequest,
    @Param("paymentId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.getPayment(r.customerIdentity, id);
  }
  @Post("finance/payments") createPayment(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreatePaymentDto,
  ) {
    return this.service.createPayment(r.customerIdentity, k, b);
  }
  @Post("finance/payment-allocations") @HttpCode(200) allocate(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: AllocatePaymentDto,
  ) {
    return this.service.allocate(r.customerIdentity, k, b);
  }
  @Get("finance/cheques") cheques(
    @Req() r: CustomerRequest,
    @Query() q: FinanceListQuery,
  ) {
    return this.service.listCheques(r.customerIdentity, q);
  }
  @Post("finance/cheques") @HttpCode(200) createCheque(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateChequeDto,
  ) {
    return this.service.createCheque(r.customerIdentity, k, b);
  }
  @Post("finance/cheques/:chequeId/status-transitions")
  @HttpCode(200)
  async transition(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("chequeId", new ParseUUIDPipe()) id: string,
    @Body() b: ChequeTransitionDto,
  ) {
    const out = await this.service.transitionCheque(
      r.customerIdentity,
      k,
      id,
      b,
    );
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
}
