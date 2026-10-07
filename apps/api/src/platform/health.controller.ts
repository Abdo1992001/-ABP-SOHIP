import { Controller, Get, Inject, Res } from "@nestjs/common";
import type { Response } from "express";
import type { DatabaseClient } from "@abp/database";
import {
  getLivenessResponse,
  getReadinessResponse,
  type HealthEnvelope,
} from "./health.js";
import { databaseClientToken } from "./database.providers.js";

@Controller("health")
export class HealthController {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
  ) {}

  @Get("live")
  getLiveness(): HealthEnvelope {
    return getLivenessResponse();
  }

  @Get("ready")
  async getReadiness(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthEnvelope> {
    try {
      await this.database.$queryRawUnsafe("SELECT 1 AS ready");
      return getReadinessResponse(true);
    } catch {
      response.status(503);
      return getReadinessResponse(false);
    }
  }
}
