import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module.js";
import { CustomerAccessService } from "./customer-access.service.js";
import { CustomerIdentityGuard } from "./customer-auth.js";
import {
  CountryReferenceController,
  CustomerController,
  CustomerShareController,
  MeController,
} from "./customer.controller.js";
import { CustomerService } from "./customer.service.js";
import { ContactController } from "./contact.controller.js";
import { ContactService } from "./contact.service.js";
import {
  ProjectController,
  ProjectPartyController,
} from "./project.controller.js";
import { ProjectService } from "./project.service.js";
import { OpportunityController } from "./opportunity.controller.js";
import { OpportunityService } from "./opportunity.service.js";
import { ActivityController } from "./activity.controller.js";
import { ActivityService } from "./activity.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [
    CustomerController,
    CustomerShareController,
    ContactController,
    ProjectController,
    ProjectPartyController,
    OpportunityController,
    ActivityController,
    CountryReferenceController,
    MeController,
  ],
  providers: [
    CustomerIdentityGuard,
    CustomerAccessService,
    CustomerService,
    ContactService,
    ProjectService,
    OpportunityService,
    ActivityService,
  ],
})
// Nest modules intentionally use class metadata as their runtime identity.
export class CustomerModule {}
