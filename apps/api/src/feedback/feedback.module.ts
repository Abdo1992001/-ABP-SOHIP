import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import {
  FeedbackController,
  PublicFeedbackController,
} from "./feedback.controller.js";
import { FeedbackService } from "./feedback.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [PublicFeedbackController, FeedbackController],
  providers: [CustomerIdentityGuard, FeedbackService],
})
export class FeedbackRuntimeModule {}
