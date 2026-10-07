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
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import { ApprovalDecisionDto, ApprovalListQuery } from "./quotation.dto.js";
import { QuotationService } from "./quotation.service.js";

@Controller("approval-requests")
@UseGuards(CustomerIdentityGuard)
export class ApprovalController {
  constructor(private readonly quotations: QuotationService) {}

  @Get()
  list(@Req() request: CustomerRequest, @Query() query: ApprovalListQuery) {
    return this.quotations.listApprovals(request.customerIdentity, query);
  }

  @Get(":requestId")
  get(
    @Req() request: CustomerRequest,
    @Param("requestId", new ParseUUIDPipe()) id: string,
  ) {
    return this.quotations.approvalContext(request.customerIdentity, id);
  }

  @Post(":requestId/decisions")
  @HttpCode(200)
  decide(
    @Req() request: CustomerRequest,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: ApprovalDecisionDto,
  ) {
    return this.quotations.decideApproval(
      request.customerIdentity,
      id,
      key,
      input,
    );
  }
}
