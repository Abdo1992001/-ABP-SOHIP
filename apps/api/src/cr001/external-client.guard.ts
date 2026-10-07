import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import type { DatabaseClient } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import type { ExternalPortalIdentity } from "./cr001.service.js";
import { SessionAccessService } from "../platform/session-access.service.js";

export interface ExternalPortalRequest extends Request {
  externalPortalIdentity: ExternalPortalIdentity;
}

@Injectable()
export class ExternalClientGuard implements CanActivate {
  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
    private readonly sessions: SessionAccessService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<ExternalPortalRequest>();
    let issuer = request.header("x-abp-external-issuer")?.trim();
    let subject = request.header("x-abp-external-subject")?.trim();
    const cookieHeader = request.header("cookie");
    const localToken =
      readCookie(cookieHeader, "__Host-abp_session") ??
      readCookie(cookieHeader, "abp_session");
    if (localToken) {
      const session =
        await this.sessions.requireActiveCookieSession(localToken);
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
        this.sessions.verifyCsrf(
          session.csrfTokenHash,
          request.header("x-csrf-token"),
        );
      }
      const portalUser = await this.db.appUser.findFirst({
        where: {
          id: session.userId,
          active: true,
          roles: {
            some: { role: { code: "CUSTOMER_PORTAL_USER", active: true } },
          },
        },
        select: { id: true },
      });
      if (!portalUser) unauthenticated();
      issuer = "abp-local";
      subject = portalUser.id;
    } else {
      if (!issuer || !subject) unauthenticated();
      const testMode =
        process.env.NODE_ENV !== "production" &&
        process.env.ABP_TEST_AUTH_ENABLED === "true";
      if (!testMode) verifyBffAssertion(request, issuer, subject);
    }
    const now = new Date();
    const client = await this.db.externalClientIdentity.findFirst({
      where: { issuer, subject, statusCode: "ACTIVE", revokedAt: null },
    });
    if (!client) unauthenticated();
    const bindings = await this.db.clientCustomerBinding.findMany({
      where: {
        externalClientIdentityId: client.id,
        statusCode: "ACTIVE",
        validFrom: { lte: now },
        OR: [{ validTo: null }, { validTo: { gt: now } }],
      },
      select: { accountId: true },
    });
    request.externalPortalIdentity = {
      externalClientIdentityId: client.id,
      issuer,
      subject,
      accountIds: bindings.map((binding) => binding.accountId),
      traceId: safe(request.header("x-trace-id")) ?? randomUUID(),
      correlationId: safe(request.header("x-correlation-id")) ?? randomUUID(),
    };
    return true;
  }
}

function readCookie(header: string | undefined, name: string) {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value ? decodeURIComponent(value) : undefined;
  }
  return undefined;
}

function verifyBffAssertion(request: Request, issuer: string, subject: string) {
  const secret = process.env.ABP_EXTERNAL_ASSERTION_SECRET;
  const timestamp = request.header("x-abp-bff-timestamp");
  const assertion = request.header("x-abp-bff-assertion");
  if (!secret || !timestamp || !assertion) unauthenticated();
  const epoch = Number(timestamp);
  if (!Number.isFinite(epoch) || Math.abs(Date.now() - epoch) > 60_000)
    unauthenticated();
  const expected = createHmac("sha256", secret)
    .update(`${issuer}|${subject}|${timestamp}`)
    .digest("hex");
  const a = Buffer.from(assertion, "hex"),
    b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) unauthenticated();
}
function safe(value: string | undefined) {
  return value && /^[A-Za-z0-9._:-]{8,128}$/.test(value) ? value : undefined;
}
function unauthenticated(): never {
  throw new ApiProblem({
    status: 401,
    code: "EXTERNAL_IDENTITY_UNAUTHENTICATED",
  });
}
