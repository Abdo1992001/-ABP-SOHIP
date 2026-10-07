import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import {
  DataQualityController,
  ImportController,
  ItemResolverController,
  ReconciliationController,
  ReconciliationIssueController,
} from "./import.controller.js";
import { ImportService } from "./import.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [
    ImportController,
    DataQualityController,
    ReconciliationController,
    ReconciliationIssueController,
    ItemResolverController,
  ],
  providers: [CustomerIdentityGuard, ImportService],
  exports: [ImportService],
})
// Nest modules are declarative classes by design.
export class ImportRuntimeModule {}
