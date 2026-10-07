import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Put,
  Req,
  Res,
  UseGuards,
} from "@nestjs/common";
import type { Response } from "express";
import {
  CustomerIdentityGuard,
  type CustomerRequest,
} from "../customer/customer-auth.js";
import { UpdateMyProfileDto, UploadProfilePhotoDto } from "./profile.dto.js";
import { ProfileService } from "./profile.service.js";

@Controller()
@UseGuards(CustomerIdentityGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get("me/profile")
  get(@Req() request: CustomerRequest) {
    return this.profile.myProfile(request.customerIdentity);
  }

  @Patch("me/profile")
  update(@Req() request: CustomerRequest, @Body() body: UpdateMyProfileDto) {
    return this.profile.updateMyProfile(request.customerIdentity, body);
  }

  @Put("me/profile/photo")
  @HttpCode(200)
  upload(@Req() request: CustomerRequest, @Body() body: UploadProfilePhotoDto) {
    return this.profile.uploadMyPhoto(request.customerIdentity, body);
  }

  @Delete("me/profile/photo")
  @HttpCode(200)
  remove(@Req() request: CustomerRequest) {
    return this.profile.removeMyPhoto(request.customerIdentity);
  }

  /** A colleague as they have chosen to appear. */
  @Get("users/:userId/profile")
  colleague(
    @Req() request: CustomerRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ) {
    return this.profile.colleague(request.customerIdentity, userId);
  }

  /**
   * A colleague's avatar. Cached hard and keyed by the `v` the client appends
   * from photoUpdatedAt: a replaced photo is a different URL, so it appears
   * without anyone having to force-refresh, and an unchanged one is not
   * re-fetched on every screen that draws it.
   */
  @Get("users/:userId/avatar")
  async avatar(
    @Req() request: CustomerRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Res() response: Response,
  ) {
    const { contentType, bytes } = await this.profile.readPhoto(
      request.customerIdentity,
      userId,
    );
    response.setHeader("Content-Type", contentType);
    response.setHeader("Content-Length", String(bytes.length));
    response.setHeader("Cache-Control", "private, max-age=86400");
    response.send(bytes);
  }
}
