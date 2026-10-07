import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Delete,
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
} from "./customer-auth.js";
import {
  ArchiveProjectDto,
  AddProjectPartyDto,
  AddProjectContactRoleDto,
  CreateProjectDto,
  ProjectListQuery,
  UpdateProjectDto,
} from "./project.dto.js";
import { ProjectService } from "./project.service.js";

@Controller("projects")
@UseGuards(CustomerIdentityGuard)
export class ProjectController {
  constructor(private readonly projects: ProjectService) {}

  @Get()
  list(@Req() request: CustomerRequest, @Query() query: ProjectListQuery) {
    return this.projects.list(request.customerIdentity, query);
  }

  @Post()
  async create(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: CreateProjectDto,
  ) {
    const data = await this.projects.create(
      request.customerIdentity,
      input,
      idempotencyKey ?? "",
    );
    response.status(201).setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Get(":projectId")
  async get(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
  ) {
    const data = await this.projects.get(request.customerIdentity, projectId);
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Patch(":projectId")
  async update(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Body() input: UpdateProjectDto,
  ) {
    const data = await this.projects.update(
      request.customerIdentity,
      projectId,
      ifMatch ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post(":projectId/archive")
  @HttpCode(200)
  async archive(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Headers("if-match") ifMatch: string | undefined,
    @Headers("idempotency-key") idempotencyKey: string | undefined,
    @Body() input: ArchiveProjectDto,
  ) {
    const data = await this.projects.archive(
      request.customerIdentity,
      projectId,
      ifMatch ?? "",
      idempotencyKey ?? "",
      input,
    );
    response.setHeader("ETag", data.rowVersion);
    return { data };
  }

  @Post(":projectId/parties")
  @HttpCode(200)
  async addParty(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("projectId", new ParseUUIDPipe()) projectId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: AddProjectPartyDto,
  ) {
    const result = await this.projects.addParty(
      request.customerIdentity,
      projectId,
      key ?? "",
      input,
    );
    response.setHeader("ETag", result.etag);
    return { data: result.data };
  }
}

@Controller()
@UseGuards(CustomerIdentityGuard)
export class ProjectPartyController {
  constructor(private readonly projects: ProjectService) {}

  @Delete("project-parties/:partyId")
  async remove(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("partyId", new ParseUUIDPipe()) partyId: string,
    @Headers("if-match") tag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const result = await this.projects.removeParty(
      request.customerIdentity,
      partyId,
      tag ?? "",
      key ?? "",
    );
    response.setHeader("ETag", result.etag);
    return { data: result.data };
  }

  @Post("project-parties/:partyId/contact-roles")
  @HttpCode(200)
  async addContactRole(
    @Req() request: CustomerRequest,
    @Res({ passthrough: true }) response: Response,
    @Param("partyId", new ParseUUIDPipe()) partyId: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() input: AddProjectContactRoleDto,
  ) {
    const result = await this.projects.addContactRole(
      request.customerIdentity,
      partyId,
      key ?? "",
      input,
    );
    return { data: result };
  }
}
