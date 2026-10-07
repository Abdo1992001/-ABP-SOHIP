import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  CapacityEstimateDto,
  CapacityListQuery,
  CapacityRateResolveQuery,
  CreateCapacityRateDto,
} from "./capacity.dto.js";
import { CapacityService } from "./capacity.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class CapacityController {
  constructor(private readonly capacity: CapacityService) {}
  @Post("capacity/estimates") estimate(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: CapacityEstimateDto,
  ) {
    return this.capacity.createEstimate(r.customerIdentity, key, body);
  }
  @Get("capacity/estimates") estimates(
    @Req() r: CustomerRequest,
    @Query() q: CapacityListQuery,
  ) {
    return this.capacity.listEstimates(r.customerIdentity, q);
  }
  @Get("capacity/estimates/:estimateId") getEstimate(
    @Req() r: CustomerRequest,
    @Param("estimateId", new ParseUUIDPipe()) id: string,
  ) {
    return this.capacity.getEstimate(r.customerIdentity, id);
  }
  @Get("capacity/rates") rates(
    @Req() r: CustomerRequest,
    @Query() q: CapacityListQuery,
  ) {
    return this.capacity.listRates(r.customerIdentity, q);
  }
  @Post("capacity/rates") createRate(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") key: string | undefined,
    @Body() body: CreateCapacityRateDto,
  ) {
    return this.capacity.createRate(r.customerIdentity, key, body);
  }
  @Get("capacity/rates/resolve") resolveRate(
    @Req() r: CustomerRequest,
    @Query() q: CapacityRateResolveQuery,
  ) {
    return this.capacity.resolveRate(r.customerIdentity, q);
  }
}
