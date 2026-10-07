import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { FinanceController } from "./finance.controller.js";
import { FinanceService } from "./finance.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [FinanceController],
  providers: [CustomerIdentityGuard, FinanceService],
})
export class FinanceRuntimeModule {}
