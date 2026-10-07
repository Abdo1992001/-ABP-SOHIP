import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
} from "@nestjs/common";
import { randomUUID } from "node:crypto";
import type { Request } from "express";
import type { DatabaseClient } from "@abp/database";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import { SessionAccessService } from "../platform/session-access.service.js";

export interface CustomerIdentity {
  userId: string;
  email: string;
  displayName: string;
  authStatusCode: "ACTIVE";
  rowVersion: bigint;
  lastSignInAt: Date | null;
  jobTitle: string | null;
  /** When their avatar last changed; display only. */
  photoUpdatedAt?: Date | null;
  managerUserId: string | null;
  teamId: string | null;
  sessionId: string;
  roles: readonly {
    roleId: string;
    code: string;
    name: string;
    workspace: string;
  }[];
  workspaces: ReadonlySet<string>;
  permissions: ReadonlySet<string>;
  deniedPermissions: ReadonlySet<string>;
  countryCodes: ReadonlySet<string>;
  policyVersion: number;
  mustChangePassword?: boolean;
  mfaRequired?: boolean;
  mfaEnabled?: boolean;
  traceId: string;
  correlationId: string;
}

export interface CustomerRequest extends Request {
  customerIdentity: CustomerIdentity;
}

/*
 * These three moved to `account-scope.ts` and are re-exported here.
 *
 * They are pure predicates over an identity, and this file also defines a
 * Nest guard -- so anything that wanted to unit-test them had to import a
 * module full of decorators, which the test runner cannot parse. Keeping the
 * re-export means no caller had to change.
 */
export {
  isSystemAdmin,
  hasWorkspace,
  canUseManagerContext,
} from "./account-scope.js";

@Injectable()
export class CustomerIdentityGuard implements CanActivate {
  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
    private readonly sessions: SessionAccessService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<CustomerRequest>();
    const testUserId = request.header("x-abp-test-user-id");
    const testAuthEnabled =
      process.env.NODE_ENV !== "production" &&
      process.env.ABP_TEST_AUTH_ENABLED === "true";
    let userId: string;
    let sessionId: string;
    if (testAuthEnabled && testUserId !== undefined) {
      userId = testUserId;
      sessionId = await this.sessions.requireActiveForTestUser(
        userId,
        safeId(request.header("x-abp-test-session-id")),
      );
    } else {
      const cookieHeader = request.header("cookie");
      const rawToken =
        readCookie(cookieHeader, "__Host-abp_session") ??
        readCookie(cookieHeader, "abp_session");
      if (rawToken === undefined) {
        throw new ApiProblem({ status: 401, code: "UNAUTHENTICATED" });
      }
      const active = await this.sessions.requireActiveCookieSession(rawToken);
      userId = active.userId;
      sessionId = active.sessionId;
      if (!["GET", "HEAD", "OPTIONS"].includes(request.method.toUpperCase())) {
        this.sessions.verifyCsrf(
          active.csrfTokenHash,
          request.header("x-csrf-token"),
        );
      }
    }

    const now = new Date();
    const user = await this.database.appUser.findFirst({
      where: { id: userId, active: true, authStatusCode: "ACTIVE" },
      include: {
        profile: true,
        countries: {
          where: {
            statusCode: "ACTIVE",
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
        },
        roles: {
          where: { role: { active: true } },
          include: { role: { include: { permissions: true } } },
        },
        permissionOverrides: {
          where: {
            validFrom: { lte: now },
            OR: [{ validTo: null }, { validTo: { gt: now } }],
          },
        },
      },
    });
    if (user === null) {
      throw new ApiProblem({ status: 401, code: "UNAUTHENTICATED" });
    }

    const route = request.path;
    const allowedDuringPasswordChange =
      (request.method === "GET" && route.endsWith("/me")) ||
      (request.method === "POST" &&
        ["/auth/change-password", "/auth/logout"].some((path) =>
          route.endsWith(path),
        ));
    if (user.mustChangePassword && !allowedDuringPasswordChange) {
      throw new ApiProblem({ status: 403, code: "PASSWORD_CHANGE_REQUIRED" });
    }
    const allowedDuringMfaEnrollment =
      (request.method === "GET" && route.endsWith("/me")) ||
      (request.method === "POST" &&
        [
          "/auth/change-password",
          "/auth/mfa/setup",
          "/auth/mfa/confirm",
          "/auth/logout",
        ].some((path) => route.endsWith(path)));
    if (user.mfaRequired && !user.mfaEnabled && !allowedDuringMfaEnrollment) {
      throw new ApiProblem({ status: 403, code: "MFA_ENROLLMENT_REQUIRED" });
    }

    const rolePermissions = user.roles.flatMap(({ role }) =>
      role.permissions.map(({ permissionCode }) => permissionCode),
    );
    const allowedOverrides = user.permissionOverrides
      .filter(({ effectCode }) => effectCode === "ALLOW")
      .map(({ permissionCode }) => permissionCode);
    const deniedPermissions = new Set(
      user.permissionOverrides
        .filter(({ effectCode }) => effectCode === "DENY")
        .map(({ permissionCode }) => permissionCode),
    );

    request.customerIdentity = {
      userId: user.id,
      email: user.emailNormalized,
      displayName: user.profile?.displayName ?? user.displayName,
      authStatusCode: "ACTIVE",
      rowVersion: user.rowVersion,
      lastSignInAt: user.lastSignInAt,
      jobTitle: user.profile?.jobTitle ?? null,
      photoUpdatedAt: user.profile?.photoUpdatedAt ?? null,
      managerUserId: user.profile?.managerUserId ?? null,
      teamId: user.profile?.teamId ?? null,
      sessionId,
      roles: user.roles.map(({ role }) => ({
        roleId: role.id,
        code: role.code,
        name: role.name,
        workspace: role.workspace,
      })),
      workspaces: new Set(user.roles.map(({ role }) => role.workspace)),
      permissions: new Set([...rolePermissions, ...allowedOverrides]),
      deniedPermissions,
      countryCodes: new Set(
        user.countries.map(({ countryCode }) => countryCode.trim()),
      ),
      policyVersion: user.policyVersion,
      mustChangePassword: user.mustChangePassword,
      mfaRequired: user.mfaRequired,
      mfaEnabled: user.mfaEnabled,
      traceId: safeId(request.header("x-trace-id")) ?? randomUUID(),
      correlationId: safeId(request.header("x-correlation-id")) ?? randomUUID(),
    };
    return true;
  }
}

function readCookie(
  header: string | undefined,
  name: string,
): string | undefined {
  if (header === undefined) return undefined;
  for (const part of header.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? decodeURIComponent(value) : undefined;
    }
  }
  return undefined;
}

function safeId(value: string | undefined): string | undefined {
  if (value === undefined || value.length < 8 || value.length > 128)
    return undefined;
  return /^[A-Za-z0-9._:-]+$/.test(value) ? value : undefined;
}
