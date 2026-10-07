import { Module } from "@nestjs/common";
import { CustomerIdentityGuard } from "../customer/customer-auth.js";
import { PlatformModule } from "../platform/platform.module.js";
import { ClientPortalController, Cr001Controller } from "./cr001.controller.js";
import { Cr001Service } from "./cr001.service.js";
import { ExternalClientGuard } from "./external-client.guard.js";

@Module({
  imports: [PlatformModule],
  controllers: [Cr001Controller, ClientPortalController],
  providers: [CustomerIdentityGuard, ExternalClientGuard, Cr001Service],
})
export class Cr001Module {}
