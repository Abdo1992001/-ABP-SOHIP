import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { TargetsController } from "./targets.controller.js";
import { TargetsService } from "./targets.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [TargetsController],
  providers: [CustomerIdentityGuard, TargetsService],
})
export class TargetsRuntimeModule {}
