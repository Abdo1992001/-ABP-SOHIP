import { Inject, Injectable } from "@nestjs/common";
import { createHash, timingSafeEqual } from "node:crypto";
import type { DatabaseClient } from "@abp/database";
import { ApiProblem } from "./api-exception.filter.js";
import { databaseClientToken } from "./database.providers.js";

/** Session records are authorization truth; test issuance is test-only. */
@Injectable()
export class SessionAccessService {
  private readonly issuedTestSessions = new Set<string>();

  constructor(
    @Inject(databaseClientToken) private readonly database: DatabaseClient,
  ) {}

  async requireActiveForTestUser(
    userId: string,
    requestedSessionId: string | undefined,
  ): Promise<string> {
    const sessionId = requestedSessionId ?? `test-${userId}`;
    const now = new Date();
    const existing = await this.database.appSession.findUnique({
      where: { id: sessionId },
    });
    if (existing === null) {
      await this.database.appSession.create({
        data: {
          id: sessionId,
          userId,
          policyVersionSnapshot: 1,
          lastSeenAt: now,
          authTime: now,
          absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });
      this.issuedTestSessions.add(sessionId);
      return sessionId;
    }
    if (existing.userId !== userId)
      throw new ApiProblem({ status: 401, code: "UNAUTHENTICATED" });
    if (
      existing.statusCode !== "ACTIVE" ||
      existing.revokedAt !== null ||
      existing.expiresAt <= now
    ) {
      if (requestedSessionId !== undefined) {
        throw new ApiProblem({ status: 401, code: "UNAUTHENTICATED" });
      }
      await this.database.appSession.update({
        where: { id: sessionId },
        data: {
          statusCode: "ACTIVE",
          revokedAt: null,
          lastSeenAt: now,
          authTime: now,
          absoluteExpiresAt: new Date(now.getTime() + 12 * 60 * 60 * 1000),
          expiresAt: new Date(now.getTime() + 60 * 60 * 1000),
        },
      });
    }
    this.issuedTestSessions.add(sessionId);
    return sessionId;
  }

  async requireActiveCookieSession(rawToken: string): Promise<{
    sessionId: string;
    userId: string;
    csrfTokenHash: string;
  }> {
    if (rawToken.length < 32 || rawToken.length > 512) {
      throw new ApiProblem({ status: 401, code: "UNAUTHENTICATED" });
    }
    const now = new Date();
    const tokenHash = hashSecret(rawToken);
    const session = await this.database.appSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          select: { active: true, authStatusCode: true, policyVersion: true },
        },
      },
    });
    const idleMinutes = session?.privileged === true ? 15 : 30;
    if (
      session === null ||
      session.statusCode !== "ACTIVE" ||
      session.revokedAt !== null ||
      !session.user.active ||
      session.user.authStatusCode !== "ACTIVE" ||
      session.policyVersionSnapshot !== session.user.policyVersion ||
      session.expiresAt <= now ||
      session.absoluteExpiresAt <= now ||
      session.lastSeenAt.getTime() + idleMinutes * 60_000 <= now.getTime() ||
      session.csrfTokenHash === null
    ) {
      throw new ApiProblem({ status: 401, code: "UNAUTHENTICATED" });
    }
    await this.database.appSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        expiresAt: new Date(
          Math.min(
            now.getTime() + idleMinutes * 60_000,
            session.absoluteExpiresAt.getTime(),
          ),
        ),
      },
    });
    return {
      sessionId: session.id,
      userId: session.userId,
      csrfTokenHash: session.csrfTokenHash,
    };
  }

  verifyCsrf(expectedHash: string, suppliedToken: string | undefined): void {
    if (suppliedToken === undefined) {
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
    }
    const actual = Buffer.from(hashSecret(suppliedToken), "hex");
    const expected = Buffer.from(expectedHash, "hex");
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
    }
  }
}

export function hashSecret(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}
