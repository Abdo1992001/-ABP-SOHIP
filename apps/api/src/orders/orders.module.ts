import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { OrdersController } from "./orders.controller.js";
import { OrdersService } from "./orders.service.js";
import { ReceivablesService } from "./receivables.service.js";
import { OverviewService } from "./overview.service.js";
import { WorkOrdersController } from "./work-orders.controller.js";
import { WorkOrdersService } from "./work-orders.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [OrdersController, WorkOrdersController],
  providers: [
    CustomerIdentityGuard,
    OrdersService,
    ReceivablesService,
    WorkOrdersService,
    OverviewService,
  ],
  exports: [OrdersService],
})
export class OrdersRuntimeModule {}
