import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service.js";
import { AuthorizationPolicyService } from "./authorization-policy.service.js";
import { DurableJobsService } from "./durable-jobs.service.js";
import { OutboxService } from "./outbox.service.js";
import {
  auditRepositoryToken,
  databaseClientToken,
  databaseProviders,
  transactionManagerToken,
} from "./database.providers.js";
import { PlatformProofController } from "./platform-proof.controller.js";
import { PlatformProofService } from "./platform-proof.service.js";
import { HealthController } from "./health.controller.js";
import { SessionAccessService } from "./session-access.service.js";
import { APP_GUARD } from "@nestjs/core";
import { RequestRateLimitGuard } from "../security/request-rate-limit.guard.js";

@Module({
  controllers: [HealthController, PlatformProofController],
  providers: [
    ...databaseProviders,
    AuthorizationPolicyService,
    SessionAccessService,
    AuditService,
    OutboxService,
    DurableJobsService,
    PlatformProofService,
    { provide: APP_GUARD, useClass: RequestRateLimitGuard },
  ],
  exports: [
    databaseClientToken,
    transactionManagerToken,
    auditRepositoryToken,
    AuthorizationPolicyService,
    SessionAccessService,
    AuditService,
    OutboxService,
    DurableJobsService,
    PlatformProofService,
  ],
})
export class PlatformModule {}
