import { Module } from "@nestjs/common";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { QuotationController } from "./quotation.controller.js";
import { QuotationService } from "./quotation.service.js";
import { ApprovalController } from "./approval.controller.js";
@Module({
  imports: [PlatformModule],
  controllers: [QuotationController, ApprovalController],
  providers: [CustomerIdentityGuard, CustomerAccessService, QuotationService],
})
// Nest modules are declarative classes by design.
export class QuotationRuntimeModule {}
