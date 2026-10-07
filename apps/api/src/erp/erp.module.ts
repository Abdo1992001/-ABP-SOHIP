import { Module } from "@nestjs/common";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { ErpController } from "./erp.controller.js";
import { ErpService } from "./erp.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [ErpController],
  providers: [CustomerIdentityGuard, CustomerAccessService, ErpService],
})
// Nest modules are declarative classes by design.
export class ErpRuntimeModule {}
