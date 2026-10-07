import { Module } from "@nestjs/common";
import { PlatformModule } from "./platform/platform.module.js";
import { domainModules } from "./domains/domain-modules.js";

@Module({
  imports: [PlatformModule, ...domainModules],
})
export class AppModule {}
