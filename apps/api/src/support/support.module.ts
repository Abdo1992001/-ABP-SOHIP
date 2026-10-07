import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { EngagementController } from "./engagement.controller.js";
import { EngagementService } from "./engagement.service.js";
import { InsightController } from "./insight.controller.js";
import { InsightService } from "./insight.service.js";
import { DocumentsController } from "./documents.controller.js";
import { DocumentsService } from "./documents.service.js";
import { IdentityController } from "./identity.controller.js";
import { IdentityService } from "./identity.service.js";
import { JobsController } from "./jobs.controller.js";
import { JobsService } from "./jobs.service.js";
import {
  TemplatesController,
  TemplateVersionsController,
} from "./templates.controller.js";
import { TemplatesService } from "./templates.service.js";
import { AnalyticsController } from "../analytics/analytics.controller.js";
import { AnalyticsSemanticService } from "../analytics/analytics.service.js";
import {
  LocalAccountController,
  LocalAuthAdminController,
  LocalAuthController,
  LocalMfaController,
} from "../security/local-auth.controller.js";
import { LocalAuthService } from "../security/local-auth.service.js";
import { MessagesController } from "./messages.controller.js";
import { MessagesService } from "./messages.service.js";
import { ProfileController } from "./profile.controller.js";
import { ProfileService } from "./profile.service.js";
import { OpenAiAdvisoryService } from "./openai-advisory.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [
    EngagementController,
    InsightController,
    DocumentsController,
    IdentityController,
    JobsController,
    TemplatesController,
    TemplateVersionsController,
    AnalyticsController,
    LocalAuthController,
    LocalAccountController,
    LocalMfaController,
    LocalAuthAdminController,
    MessagesController,
    ProfileController,
  ],
  providers: [
    CustomerIdentityGuard,
    EngagementService,
    InsightService,
    DocumentsService,
    IdentityService,
    JobsService,
    TemplatesService,
    AnalyticsSemanticService,
    LocalAuthService,
    MessagesService,
    ProfileService,
    OpenAiAdvisoryService,
  ],
})
export class SupportRuntimeModule {}
