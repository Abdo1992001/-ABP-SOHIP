import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { SystemController } from "./system.controller.js";
import { SystemService } from "./system.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [SystemController],
  providers: [CustomerIdentityGuard, SystemService],
})
export class SystemRuntimeModule {}
