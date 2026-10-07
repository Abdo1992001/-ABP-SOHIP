import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import {
  AnalyticsDrilldownQueryDto,
  AnalyticsExportDto,
  AnalyticsQueryDto,
} from "./analytics.dto.js";
import { AnalyticsSemanticService } from "./analytics.service.js";

@Controller("analytics")
@UseGuards(CustomerIdentityGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsSemanticService) {}

  @Get("registry/metrics")
  metricsRegistry(@Req() request: CustomerRequest) {
    return this.analytics.metricDefinitions(request.customerIdentity);
  }

  @Get("registry/reports")
  reportsRegistry(@Req() request: CustomerRequest) {
    return this.analytics.reportDefinitions(request.customerIdentity);
  }

  @Get("metrics/:metricId")
  metric(
    @Req() request: CustomerRequest,
    @Param("metricId") metricId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.metric(request.customerIdentity, metricId, query);
  }

  @Get("reports/:reportId")
  report(
    @Req() request: CustomerRequest,
    @Param("reportId") reportId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analytics.report(request.customerIdentity, reportId, query);
  }

  @Get("reports/:reportId/drilldown")
  drilldown(
    @Req() request: CustomerRequest,
    @Param("reportId") reportId: string,
    @Query() query: AnalyticsDrilldownQueryDto,
  ) {
    return this.analytics.drilldown(request.customerIdentity, reportId, query);
  }

  @Post("reports/:reportId/exports")
  @HttpCode(202)
  export(
    @Req() request: CustomerRequest,
    @Param("reportId") reportId: string,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() body: AnalyticsExportDto,
  ) {
    return this.analytics.export(
      request.customerIdentity,
      reportId,
      idempotencyKey ?? "",
      body,
    );
  }

  @Get("exports/:exportId")
  exportStatus(
    @Req() request: CustomerRequest,
    @Param("exportId", new ParseUUIDPipe()) exportId: string,
  ) {
    return this.analytics.exportStatus(request.customerIdentity, exportId);
  }
}
