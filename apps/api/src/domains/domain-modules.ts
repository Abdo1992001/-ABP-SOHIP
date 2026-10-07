import { Module, type Type } from "@nestjs/common";
import { CustomerModule } from "../customer/customer.module.js";
import { CatalogModule } from "../catalog/catalog.module.js";
import { PricingRuntimeModule } from "../pricing/pricing.module.js";
import { QuotationRuntimeModule } from "../quotation/quotation.module.js";
import { ErpRuntimeModule } from "../erp/erp.module.js";
import { OrdersRuntimeModule } from "../orders/orders.module.js";
import { ImportRuntimeModule } from "../imports/import.module.js";
import { CapacityRuntimeModule } from "../capacity/capacity.module.js";
import { LogisticsRuntimeModule } from "../logistics/logistics.module.js";
import { FinanceRuntimeModule } from "../finance/finance.module.js";
import { ReturnsRuntimeModule } from "../returns/returns.module.js";
import { FeedbackRuntimeModule } from "../feedback/feedback.module.js";
import { MapRuntimeModule } from "../map/map.module.js";
import { SystemRuntimeModule } from "../system/system.module.js";
import { TargetsRuntimeModule } from "../targets/targets.module.js";
import { SupportRuntimeModule } from "../support/support.module.js";
import { Cr001Module } from "../cr001/cr001.module.js";
import { MarketIntelligenceModule } from "../market-intelligence/market-intelligence.module.js";

@Module({})
export class IdentityAccessModule {}
@Module({ imports: [CustomerModule, MapRuntimeModule, SystemRuntimeModule] })
export class SalesModule {}
@Module({ imports: [CatalogModule, PricingRuntimeModule] })
export class PricingModule {}
@Module({ imports: [QuotationRuntimeModule] })
export class QuotationsModule {}
@Module({ imports: [ErpRuntimeModule, OrdersRuntimeModule] })
export class ErpOrdersModule {}
@Module({ imports: [CapacityRuntimeModule] })
export class CapacityModule {}
@Module({ imports: [LogisticsRuntimeModule] })
export class LogisticsModule {}
@Module({ imports: [FinanceRuntimeModule] })
export class FinanceModule {}
@Module({ imports: [ReturnsRuntimeModule, FeedbackRuntimeModule] })
export class ReturnsComplaintsModule {}
@Module({ imports: [ImportRuntimeModule] })
export class ImportsDataQualityModule {}
@Module({ imports: [TargetsRuntimeModule] })
export class AnalyticsAdvisoryModule {}
@Module({})
export class DocumentsModule {}
@Module({})
export class NotificationsModule {}
@Module({})
export class AdminAuditModule {}

export const domainModules: Type<unknown>[] = [
  IdentityAccessModule,
  SalesModule,
  PricingModule,
  QuotationsModule,
  ErpOrdersModule,
  CapacityModule,
  LogisticsModule,
  FinanceModule,
  ReturnsComplaintsModule,
  ImportsDataQualityModule,
  AnalyticsAdvisoryModule,
  DocumentsModule,
  NotificationsModule,
  AdminAuditModule,
  SupportRuntimeModule,
  Cr001Module,
  MarketIntelligenceModule,
];
