import { Module } from "@nestjs/common";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { PricingController } from "./pricing.controller.js";
import { PricingService } from "./pricing.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [PricingController],
  providers: [CustomerIdentityGuard, CustomerAccessService, PricingService],
})
// Nest modules are declarative classes by design.
export class PricingRuntimeModule {}
