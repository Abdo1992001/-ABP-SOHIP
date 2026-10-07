import {
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import { SystemService } from "./system.service.js";

@Controller("system")
@UseGuards(CustomerIdentityGuard)
export class SystemController {
  constructor(private readonly service: SystemService) {}

  @Get("mail-status") mail() {
    return this.service.mail();
  }

  @Post("mail-test") @HttpCode(202) test(@Req() r: CustomerRequest) {
    return this.service.sendTest(r.customerIdentity);
  }

  @Get("emails") emails(
    @Req() r: CustomerRequest,
    @Query("limit") limit?: string,
  ) {
    return this.service.emails(r.customerIdentity, Number(limit) || 30);
  }

  @Get("backup-status") backup(@Req() r: CustomerRequest) {
    return this.service.backup(r.customerIdentity);
  }
}
