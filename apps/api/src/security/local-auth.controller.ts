import {
  Body,
  Controller,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
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
  ChangePasswordDto,
  LoginDto,
  MfaCodeDto,
  MfaRecoveryDto,
  MfaVerifyDto,
  ResetPasswordDto,
} from "./local-auth.dto.js";
import { LocalAuthService } from "./local-auth.service.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { SubmitAccessRequestDto } from "../support/identity.dto.js";
import { IdentityService } from "../support/identity.service.js";

const accessRequestAttempts = new Map<string, number[]>();
const ACCESS_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const ACCESS_REQUEST_MAX_PER_WINDOW = 5;

@Controller("auth")
export class LocalAuthController {
  constructor(
    private readonly auth: LocalAuthService,
    private readonly identity: IdentityService,
  ) {}

  @Post("login")
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(body);
    return setSession(response, result);
  }

  @Post("request-access")
  @HttpCode(202)
  requestAccess(
    @Body() body: SubmitAccessRequestDto,
    @Req() request: { ip?: string },
  ) {
    const key = request.ip ?? "unknown";
    const now = Date.now();
    const attempts = (accessRequestAttempts.get(key) ?? []).filter(
      (t) => now - t < ACCESS_REQUEST_WINDOW_MS,
    );
    if (attempts.length >= ACCESS_REQUEST_MAX_PER_WINDOW) {
      throw new ApiProblem({ status: 429, code: "TOO_MANY_REQUESTS" });
    }
    attempts.push(now);
    accessRequestAttempts.set(key, attempts);
    return this.identity.submitAccessRequest(body);
  }

  @Post("mfa/verify")
  @HttpCode(200)
  async verify(
    @Body() body: MfaVerifyDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return setSession(response, await this.auth.verifyMfa(body));
  }

  @Post("mfa/recovery")
  @HttpCode(200)
  async recovery(
    @Body() body: MfaRecoveryDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return setSession(response, await this.auth.recoverMfa(body));
  }
}

@Controller("auth")
@UseGuards(CustomerIdentityGuard)
export class LocalAccountController {
  constructor(private readonly auth: LocalAuthService) {}

  @Post("change-password")
  @HttpCode(200)
  changePassword(
    @Req() request: CustomerRequest,
    @Body() body: ChangePasswordDto,
  ) {
    return this.auth.changeOwnPassword(request.customerIdentity, body);
  }
}

@Controller("auth/mfa")
@UseGuards(CustomerIdentityGuard)
export class LocalMfaController {
  constructor(private readonly auth: LocalAuthService) {}

  @Post("setup") setup(@Req() request: CustomerRequest) {
    return this.auth.setupMfa(request.customerIdentity);
  }
  @Post("confirm") confirm(
    @Req() request: CustomerRequest,
    @Body() body: MfaCodeDto,
  ) {
    return this.auth.confirmMfa(request.customerIdentity, body);
  }
  @Post("disable") disable(
    @Req() request: CustomerRequest,
    @Body() body: MfaCodeDto,
  ) {
    return this.auth.disableMfa(request.customerIdentity, body);
  }
}

@Controller("admin/users")
@UseGuards(CustomerIdentityGuard)
export class LocalAuthAdminController {
  constructor(private readonly auth: LocalAuthService) {}
  @Post(":userId/reset-mfa") resetMfa(
    @Req() request: CustomerRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
  ) {
    return this.auth.adminResetMfa(request.customerIdentity, userId);
  }
  @Post(":userId/reset-password") resetPassword(
    @Req() request: CustomerRequest,
    @Param("userId", new ParseUUIDPipe()) userId: string,
    @Body() body: ResetPasswordDto,
  ) {
    return this.auth.resetPassword(request.customerIdentity, userId, body);
  }
}

function setSession(
  response: Response,
  result: {
    state: string;
    sessionToken?: string;
    csrfToken?: string;
    absoluteExpiresAt?: Date;
    mustChangePassword?: boolean;
    challengeToken?: string;
  },
) {
  if (
    result.sessionToken !== undefined &&
    result.absoluteExpiresAt !== undefined
  ) {
    const secure = process.env.ABP_SESSION_COOKIE_SECURE !== "false";
    response.cookie(
      secure ? "__Host-abp_session" : "abp_session",
      result.sessionToken,
      {
        httpOnly: true,
        secure,
        sameSite: "strict",
        path: "/",
        expires: result.absoluteExpiresAt,
      },
    );
  }
  return {
    data: {
      state: result.state,
      csrfToken: result.csrfToken,
      challengeToken: result.challengeToken,
      mustChangePassword: result.mustChangePassword,
    },
  };
}
