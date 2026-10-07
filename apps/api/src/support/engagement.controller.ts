import {
  Body,
  Controller,
  Delete,
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
  ComplaintListQuery,
  ComplaintTransitionDto,
  CreateComplaintDto,
  GroupMembershipDto,
  PageQuery,
  UpdateComplaintDto,
} from "./engagement.dto.js";
import { EngagementService } from "./engagement.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class EngagementController {
  constructor(private readonly service: EngagementService) {}
  @Get("group-networks") groups(
    @Req() r: CustomerRequest,
    @Query() q: PageQuery,
  ) {
    return this.service.groups(r.customerIdentity, q);
  }
  @Post("group-networks/:groupId/memberships")
  @HttpCode(200)
  membership(
    @Req() r: CustomerRequest,
    @Param("groupId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: GroupMembershipDto,
  ) {
    return this.service.addMembership(r.customerIdentity, id, key ?? "", b);
  }
  @Delete("group-memberships/:membershipId") async endMembership(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("membershipId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Headers("idempotency-key") key: string | undefined,
  ) {
    const o = await this.service.endMembership(
      r.customerIdentity,
      id,
      tag ?? "",
      key ?? "",
    );
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Get("complaints") complaints(
    @Req() r: CustomerRequest,
    @Query() q: ComplaintListQuery,
  ) {
    return this.service.complaints(r.customerIdentity, q);
  }
  @Post("complaints") async createComplaint(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: CreateComplaintDto,
  ) {
    const o = await this.service.createComplaint(
      r.customerIdentity,
      key ?? "",
      b,
    );
    res.status(201).setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Get("complaints/:complaintId") async complaint(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("complaintId", new ParseUUIDPipe()) id: string,
  ) {
    const o = await this.service.complaint(r.customerIdentity, id);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Patch("complaints/:complaintId") async updateComplaint(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("complaintId", new ParseUUIDPipe()) id: string,
    @Headers("if-match") tag: string | undefined,
    @Body() b: UpdateComplaintDto,
  ) {
    const o = await this.service.updateComplaint(
      r.customerIdentity,
      id,
      tag ?? "",
      b,
    );
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
  @Post("complaints/:complaintId/status-transitions")
  @HttpCode(200)
  async transition(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("complaintId", new ParseUUIDPipe()) id: string,
    @Headers("idempotency-key") key: string | undefined,
    @Body() b: ComplaintTransitionDto,
  ) {
    const o = await this.service.transitionComplaint(
      r.customerIdentity,
      id,
      key ?? "",
      b,
    );
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
}
