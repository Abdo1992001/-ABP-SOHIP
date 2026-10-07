import { Module } from "@nestjs/common";
import { PlatformModule } from "../platform/platform.module.js";
import { CustomerAccessService } from "../customer/customer-access.service.js";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import {
  ProductController,
  ProductImageController,
} from "./product.controller.js";
import { ProductService } from "./product.service.js";
@Module({
  imports: [PlatformModule],
  controllers: [ProductController, ProductImageController],
  providers: [CustomerIdentityGuard, CustomerAccessService, ProductService],
})
// Nest modules intentionally use class metadata as their runtime identity.
export class CatalogModule {}
