import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  CompareLogisticsDto,
  CreateLogisticsExportDto,
  CreateLogisticsPlanDto,
  CreateLogisticsVersionDto,
  ExpectedVersionDto,
  LogisticsListQuery,
  OptimizePlanDto,
  SaveLogisticsDraftDto,
} from "./logistics.dto.js";
import { LogisticsService } from "./logistics.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class LogisticsController {
  constructor(private readonly service: LogisticsService) {}
  @Get("logistics/plans") list(
    @Req() r: CustomerRequest,
    @Query() q: LogisticsListQuery,
  ) {
    return this.service.list(r.customerIdentity, q);
  }
  @Post("logistics/plans") create(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateLogisticsPlanDto,
  ) {
    return this.service.create(r.customerIdentity, k, b);
  }
  @Get("logistics/plans/:planId") get(
    @Req() r: CustomerRequest,
    @Param("planId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.get(r.customerIdentity, id);
  }
  @Post("logistics/plans/:planId/versions") createVersion(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("planId", new ParseUUIDPipe()) id: string,
    @Body() b: CreateLogisticsVersionDto,
  ) {
    return this.service.createVersion(r.customerIdentity, k, id, b);
  }
  @Put("logistics/plan-versions/:versionId/draft-content") async save(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("if-match") etag: string | undefined,
    @Param("versionId", new ParseUUIDPipe()) id: string,
    @Body() b: SaveLogisticsDraftDto,
  ) {
    const out = await this.service.saveDraft(r.customerIdentity, etag, id, b);
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("logistics/plan-versions/:versionId/optimize")
  @HttpCode(202)
  async optimize(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("versionId", new ParseUUIDPipe()) id: string,
    @Body() b: OptimizePlanDto,
  ) {
    const out = await this.service.optimize(r.customerIdentity, k, id, b);
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post("logistics/plan-versions/:versionId/validate")
  @HttpCode(200)
  async validate(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Param("versionId", new ParseUUIDPipe()) id: string,
    @Body() b: ExpectedVersionDto,
  ) {
    const out = await this.service.validate(r.customerIdentity, k, id, b);
    res.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get("logistics/plan-versions/:versionId/visualization") visualization(
    @Req() r: CustomerRequest,
    @Param("versionId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.visualization(r.customerIdentity, id);
  }
  @Post("logistics/compare")
  @HttpCode(200)
  compare(@Req() r: CustomerRequest, @Body() b: CompareLogisticsDto) {
    return this.service.compare(r.customerIdentity, b);
  }
  @Get("logistics/optimizer-runs/:runId") run(
    @Req() r: CustomerRequest,
    @Param("runId", new ParseUUIDPipe()) id: string,
  ) {
    return this.service.optimizerRun(r.customerIdentity, id);
  }
  @Post("logistics/plan-versions/:versionId/exports")
  @HttpCode(202)
  exportPlan(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("versionId", new ParseUUIDPipe()) id: string,
    @Body() b: CreateLogisticsExportDto,
  ) {
    return this.service.exportPlan(r.customerIdentity, k, id, b);
  }
}
