import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
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
  CreateTemplateDto,
  CreateTemplateVersionDto,
  TemplateListQuery,
  TemplateVersionTransitionDto,
  UpdateTemplateVersionDto,
} from "./templates.dto.js";
import { TemplatesService } from "./templates.service.js";

@Controller("admin/document-templates")
@UseGuards(CustomerIdentityGuard)
export class TemplatesController {
  constructor(private readonly templates: TemplatesService) {}
  @Get() list(@Req() r: CustomerRequest, @Query() q: TemplateListQuery) {
    return this.templates.list(r.customerIdentity, q);
  }
  @Post() create(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateTemplateDto,
  ) {
    return this.templates.create(r.customerIdentity, k, b);
  }
  @Get(":templateId") get(
    @Req() r: CustomerRequest,
    @Param("templateId", new ParseUUIDPipe()) id: string,
  ) {
    return this.templates.get(r.customerIdentity, id);
  }
  @Get(":templateId/versions") versions(
    @Req() r: CustomerRequest,
    @Param("templateId", new ParseUUIDPipe()) id: string,
  ) {
    return this.templates.versions(r.customerIdentity, id);
  }
  @Post(":templateId/versions") createVersion(
    @Req() r: CustomerRequest,
    @Param("templateId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateTemplateVersionDto,
  ) {
    return this.templates.createVersion(r.customerIdentity, id, k, b);
  }
}

@Controller("admin/document-template-versions")
@UseGuards(CustomerIdentityGuard)
export class TemplateVersionsController {
  constructor(private readonly templates: TemplatesService) {}
  @Patch(":versionId") async update(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("versionId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") m: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: UpdateTemplateVersionDto,
  ) {
    const out = await this.templates.updateVersion(
      r.customerIdentity,
      id,
      m,
      k,
      b,
    );
    response.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Post(":versionId/status-transitions") @HttpCode(200) async transition(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("versionId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") m: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: TemplateVersionTransitionDto,
  ) {
    const out = await this.templates.transition(
      r.customerIdentity,
      id,
      m,
      k,
      b,
    );
    response.setHeader("ETag", out.etag);
    return { data: out.data };
  }
  @Get(":versionId/preview") preview(
    @Req() r: CustomerRequest,
    @Param("versionId", new ParseUUIDPipe()) id: string,
  ) {
    return this.templates.preview(r.customerIdentity, id);
  }
}
