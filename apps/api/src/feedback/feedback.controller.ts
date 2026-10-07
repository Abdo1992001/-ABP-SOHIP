import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
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
import { ApiProblem } from "../platform/api-exception.filter.js";
import {
  FeedbackFollowUpDto,
  FeedbackLinkDto,
  FeedbackListQuery,
  SubmitFeedbackDto,
} from "./feedback.dto.js";
import { FeedbackService } from "./feedback.service.js";

const attempts = new Map<string, number[]>();
const WINDOW_MS = 60 * 60 * 1000;
const MAX_PER_WINDOW = 6;

/**
 * The public side: no session, no account. Limited per address, because a
 * form anyone can post to is a form someone will post to a thousand times.
 */
@Controller("public")
export class PublicFeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Post("feedback")
  @HttpCode(201)
  submit(@Body() body: SubmitFeedbackDto, @Req() request: { ip?: string }) {
    const key = request.ip ?? "unknown";
    const now = Date.now();
    const recent = (attempts.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW)
      throw new ApiProblem({ status: 429, code: "TOO_MANY_REQUESTS" });
    recent.push(now);
    attempts.set(key, recent);
    return this.service.submit(body, key);
  }
}

@Controller()
@UseGuards(CustomerIdentityGuard)
export class FeedbackController {
  constructor(private readonly service: FeedbackService) {}

  @Get("customer-feedback") list(
    @Req() r: CustomerRequest,
    @Query() q: FeedbackListQuery,
  ) {
    return this.service.list(r.customerIdentity, q);
  }

  @Get("customer-feedback/summary") summary(@Req() r: CustomerRequest) {
    return this.service.summary(r.customerIdentity);
  }

  @Get("customer-feedback/:feedbackId") async get(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("feedbackId", new ParseUUIDPipe()) id: string,
  ) {
    const o = await this.service.get(r.customerIdentity, id);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Post("customer-feedback/:feedbackId/follow-ups")
  @HttpCode(200)
  async followUp(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("feedbackId", new ParseUUIDPipe()) id: string,
    @Body() b: FeedbackFollowUpDto,
  ) {
    const o = await this.service.followUp(r.customerIdentity, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }

  @Post("customer-feedback/:feedbackId/link")
  @HttpCode(200)
  async link(
    @Req() r: CustomerRequest,
    @Res({ passthrough: true }) res: Response,
    @Param("feedbackId", new ParseUUIDPipe()) id: string,
    @Body() b: FeedbackLinkDto,
  ) {
    const o = await this.service.link(r.customerIdentity, id, b);
    res.setHeader("ETag", o.etag);
    return { data: o.data };
  }
}
