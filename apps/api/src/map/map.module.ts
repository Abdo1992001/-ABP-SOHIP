import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { MapController } from "./map.controller.js";
import { MapService } from "./map.service.js";

@Module({
  imports: [PlatformModule],
  controllers: [MapController],
  providers: [CustomerIdentityGuard, MapService],
})
export class MapRuntimeModule {}
