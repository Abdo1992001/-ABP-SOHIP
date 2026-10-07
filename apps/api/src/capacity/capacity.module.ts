import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { CapacityController } from "./capacity.controller.js";
import { CapacityService } from "./capacity.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [CapacityController],
  providers: [CustomerIdentityGuard, CapacityService],
})
// Nest modules are declarative classes by design.
export class CapacityRuntimeModule {}
