import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { ReturnsController } from "./returns.controller.js";
import { ReturnsService } from "./returns.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [ReturnsController],
  providers: [CustomerIdentityGuard, ReturnsService],
})
export class ReturnsRuntimeModule {}
