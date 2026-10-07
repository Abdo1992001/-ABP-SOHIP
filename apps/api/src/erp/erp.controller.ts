import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import { SalesOrderLineListQuery, SalesOrderListQuery } from "./erp.dto.js";
import { ErpService } from "./erp.service.js";

@Controller("sales-orders")
@UseGuards(CustomerIdentityGuard)
export class ErpController {
  constructor(private readonly erp: ErpService) {}
  @Get() list(
    @Req() request: CustomerRequest,
    @Query() query: SalesOrderListQuery,
  ) {
    return this.erp.listOrders(request.customerIdentity, query);
  }
  @Get(":salesOrderId") get(
    @Req() request: CustomerRequest,
    @Param("salesOrderId", new ParseUUIDPipe()) id: string,
  ) {
    return this.erp.getOrder(request.customerIdentity, id);
  }
  @Get(":salesOrderId/lines") lines(
    @Req() request: CustomerRequest,
    @Param("salesOrderId", new ParseUUIDPipe()) id: string,
    @Query() query: SalesOrderLineListQuery,
  ) {
    return this.erp.listOrderLines(request.customerIdentity, id, query);
  }
  @Get(":salesOrderId/source") source(
    @Req() request: CustomerRequest,
    @Param("salesOrderId", new ParseUUIDPipe()) id: string,
  ) {
    return this.erp.getOrderSource(request.customerIdentity, id);
  }
}
