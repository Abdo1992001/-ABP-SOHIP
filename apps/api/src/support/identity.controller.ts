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
  AdminListQuery,
  ApproveAccessRequestDto,
  CountriesDto,
  CreateRoleDto,
  CreateUserDto,
  InviteDto,
  LifecycleDto,
  LogoutDto,
  RejectAccessRequestDto,
  RevokeDto,
  RolesDto,
  UpdateRoleDto,
  UpdateUserDto,
} from "./identity.dto.js";
import { IdentityService } from "./identity.service.js";
@Controller()
@UseGuards(CustomerIdentityGuard)
export class IdentityController {
  constructor(private readonly s: IdentityService) {}
  @Get("admin/permissions") permissions(
    @Req() r: CustomerRequest,
    @Query() q: AdminListQuery,
  ) {
    return this.s.permissions(r.customerIdentity, q);
  }
  @Get("admin/roles") roles(
    @Req() r: CustomerRequest,
    @Query() q: AdminListQuery,
  ) {
    return this.s.roles(r.customerIdentity, q);
  }
  @Post("admin/roles") async createRole(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateRoleDto,
  ) {
    const o = await this.s.createRole(r.customerIdentity, k ?? "", b);
    res.status(201).setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Patch("admin/roles/:roleId") async updateRole(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("roleId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Body() b: UpdateRoleDto,
  ) {
    const o = await this.s.updateRole(r.customerIdentity, id, t ?? "", b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Get("team/roster") roster(@Req() r: CustomerRequest) {
    return this.s.roster(r.customerIdentity);
  }
  @Get("admin/users") users(
    @Req() r: CustomerRequest,
    @Query() q: AdminListQuery,
  ) {
    return this.s.users(r.customerIdentity, q);
  }
  @Post("admin/users") async createUser(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CreateUserDto,
  ) {
    const o = await this.s.createUser(r.customerIdentity, k ?? "", b);
    res.status(201).setHeader("ETag", o.etag);
    return { data: o.data, tempPassword: o.tempPassword };
  }
  @Get("admin/access-requests") accessRequests(
    @Req() r: CustomerRequest,
    @Query() q: AdminListQuery,
  ) {
    return this.s.accessRequests(r.customerIdentity, q);
  }
  @Post("admin/access-requests/:requestId/approve") async approveAccessRequest(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: ApproveAccessRequestDto,
  ) {
    const o = await this.s.approveAccessRequest(
      r.customerIdentity,
      id,
      t ?? "",
      k ?? "",
      b,
    );
    return { data: o.data, user: o.user, tempPassword: o.tempPassword };
  }
  @Post("admin/access-requests/:requestId/reject")
  @HttpCode(200)
  rejectAccessRequest(
    @Req() r: CustomerRequest,
    @Param("requestId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Body() b: RejectAccessRequestDto,
  ) {
    return this.s.rejectAccessRequest(r.customerIdentity, id, t ?? "", b);
  }
  @Get("admin/users/:userId") userAccess(
    @Req() r: CustomerRequest,
    @Param("userId", new ParseUUIDPipe()) id: string,
  ) {
    return this.s.userAccess(r.customerIdentity, id);
  }
  @Patch("admin/users/:userId") async updateUser(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Body() b: UpdateUserDto,
  ) {
    const o = await this.s.updateUser(r.customerIdentity, id, t ?? "", b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("admin/users/:userId/activate")
  @HttpCode(200)
  activate(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Body() b: LifecycleDto,
  ) {
    return this.s.lifecycle(r.customerIdentity, id, k ?? "", b, "ACTIVE");
  }
  @Post("admin/users/:userId/suspend")
  @HttpCode(200)
  suspend(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Body() b: LifecycleDto,
  ) {
    return this.s.lifecycle(r.customerIdentity, id, k ?? "", b, "SUSPENDED");
  }
  @Post("admin/users/:userId/disable")
  @HttpCode(200)
  disable(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Body() b: LifecycleDto,
  ) {
    return this.s.lifecycle(r.customerIdentity, id, k ?? "", b, "DISABLED");
  }
  @Post("admin/users/:userId/invite")
  @HttpCode(200)
  invite(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Body() b: InviteDto,
  ) {
    return this.s.invite(r.customerIdentity, id, k ?? "", b);
  }
  @Put("admin/users/:userId/country-access") async countries(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: CountriesDto,
  ) {
    const o = await this.s.countries(
      r.customerIdentity,
      id,
      t ?? "",
      k ?? "",
      b,
    );
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Put("admin/users/:userId/roles") async setRoles(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") t: string | undefined,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: RolesDto,
  ) {
    const o = await this.s.setRoles(
      r.customerIdentity,
      id,
      t ?? "",
      k ?? "",
      b,
    );
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("admin/users/:userId/revoke-sessions")
  @HttpCode(200)
  revoke(
    @Req() r: CustomerRequest,
    @Param("userId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: RevokeDto,
  ) {
    return this.s.revoke(r.customerIdentity, id, k ?? "", b);
  }
  @Post("auth/logout")
  @HttpCode(200)
  logout(
    @Req() r: CustomerRequest,
    @Headers("idempotency-key") k: string | undefined,
    @Body() b: LogoutDto,
  ) {
    return this.s.logout(r.customerIdentity, k ?? "", b);
  }
}
