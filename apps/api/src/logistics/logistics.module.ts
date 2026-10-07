import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { LogisticsController } from "./logistics.controller.js";
import { LogisticsService } from "./logistics.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [LogisticsController],
  providers: [CustomerIdentityGuard, LogisticsService],
})
export class LogisticsRuntimeModule {}
