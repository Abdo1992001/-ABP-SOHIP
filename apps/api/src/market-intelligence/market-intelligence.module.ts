import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module.js";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { MarketIntelligenceController } from "./market-intelligence.controller.js";
import { MarketIntelligenceService } from "./market-intelligence.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [MarketIntelligenceController],
  providers: [CustomerIdentityGuard, MarketIntelligenceService],
})
export class MarketIntelligenceModule {}
