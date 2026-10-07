/* eslint-disable @typescript-eslint/consistent-type-imports, @typescript-eslint/no-unsafe-member-access */
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { DatabaseClient } from "@abp/database";
import { Secret, TOTP } from "otpauth";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "./password.service.js";

const userId = "f1000000-0000-4000-8000-000000000001";
const username = "local.security.admin";
const password = "ABP-Local-Secure-Password!2026";

describe.runIf(process.env.TEST_DATABASE_URL !== undefined)(
  "local authentication and MFA PostgreSQL integration",
  () => {
    let application: INestApplication;
    let database: DatabaseClient;

    beforeAll(async () => {
      process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
      process.env.ABP_TEST_AUTH_ENABLED = "true";
      process.env.ABP_SESSION_COOKIE_SECURE = "false";
      process.env.ABP_MFA_MASTER_KEY = Buffer.alloc(32, 23).toString("base64");
      process.env.ABP_MAX_FAILED_LOGIN_ATTEMPTS = "2";
      const loadBuilt = async <T>(relativePath: string): Promise<T> =>
        import(
          /* @vite-ignore */ new URL(
            `../../dist/${relativePath}`,
            import.meta.url,
          ).href
        ) as Promise<T>;
      const { AppModule } =
        await loadBuilt<typeof import("../app.module.js")>("app.module.js");
      const { configureHttpApplication } = await loadBuilt<
        typeof import("../configure-http-app.js")
      >("configure-http-app.js");
      const { databaseClientToken } = await loadBuilt<
        typeof import("../platform/database.providers.js")
      >("platform/database.providers.js");
      const module = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      application = module.createNestApplication();
      configureHttpApplication(application);
      await application.init();
      database = application.get(databaseClientToken);
      await database.requestRateLimit.deleteMany();
      const role = await database.role.upsert({
        where: { code: "SYSTEM_ADMIN" },
        create: {
          code: "SYSTEM_ADMIN",
          name: "System Administrator",
          workspace: "ADMINISTRATION",
          systemProtected: true,
        },
        update: {},
      });
      await database.appUser.upsert({
        where: { id: userId },
        update: {
          usernameNormalized: username,
          emailNormalized: "local.security.admin@abp.local",
          authProvider: "LOCAL",
          passwordHash: await hashPassword(password),
          authStatusCode: "ACTIVE",
          active: true,
          failedLoginCount: 0,
          lockedUntil: null,
          mfaEnabled: false,
          mfaRequired: false,
          mfaSecretCiphertext: null,
          mfaSecretIv: null,
          mfaSecretAuthTag: null,
          mfaSecretVersion: null,
        },
        create: {
          id: userId,
          externalSubject: `local:${username}`,
          usernameNormalized: username,
          emailNormalized: "local.security.admin@abp.local",
          displayName: "Local Security Admin",
          authProvider: "LOCAL",
          passwordHash: await hashPassword(password),
          passwordChangedAt: new Date(),
          roles: { create: { roleId: role.id } },
          profile: { create: { displayName: "Local Security Admin" } },
        },
      });
      await database.authChallenge.deleteMany({ where: { userId } });
      await database.mfaRecoveryCode.deleteMany({ where: { userId } });
    }, 60_000);

    afterAll(async () => {
      await application.close();
      delete process.env.ABP_TEST_AUTH_ENABLED;
      delete process.env.ABP_SESSION_COOKIE_SECURE;
      delete process.env.ABP_MFA_MASTER_KEY;
      delete process.env.ABP_MAX_FAILED_LOGIN_ATTEMPTS;
    });

    it("uses a generic failure, increments attempts, and locks the account", async () => {
      const server = application.getHttpServer();
      await request(server)
        .post("/api/v1/auth/login")
        .send({ identifier: username, password: "Wrong-Password!2026" })
        .expect(401);
      await request(server)
        .post("/api/v1/auth/login")
        .send({ identifier: username, password: "Wrong-Password!2026" })
        .expect(401);
      const user = await database.appUser.findUniqueOrThrow({
        where: { id: userId },
      });
      expect(user.lockedUntil).toBeInstanceOf(Date);
      await request(server)
        .post("/api/v1/auth/login")
        .send({ identifier: "missing-user", password: "Wrong-Password!2026" })
        .expect(401);
      await database.appUser.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: null },
      });
    });

    it("creates an authoritative cookie session for a correct password", async () => {
      const response = await request(application.getHttpServer())
        .post("/api/v1/auth/login")
        .send({ identifier: "LOCAL.SECURITY.ADMIN@ABP.LOCAL", password })
        .expect(200);
      expect(response.body.data.state).toBe("AUTHENTICATED");
      expect(response.headers["set-cookie"]?.[0]).toContain("abp_session=");
      expect(response.body.data.csrfToken).toHaveLength(43);
      expect(
        await database.appSession.count({
          where: { userId, tokenHash: { not: null } },
        }),
      ).toBeGreaterThan(0);
    });

    it("forces a password change before MFA enrollment and preserves the current session", async () => {
      const server = application.getHttpServer();
      await database.appUser.update({
        where: { id: userId },
        data: {
          mustChangePassword: true,
          mfaRequired: true,
          mfaEnabled: false,
        },
      });
      const login = await request(server)
        .post("/api/v1/auth/login")
        .send({ identifier: username, password })
        .expect(200);
      expect(login.body.data.state).toBe("MFA_SETUP_REQUIRED");
      expect(login.body.data.mustChangePassword).toBe(true);
      const cookie = login.headers["set-cookie"]?.[0] as string;
      const csrf = login.body.data.csrfToken as string;

      await request(server)
        .post("/api/v1/auth/mfa/setup")
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .send({})
        .expect(403);

      const nextPassword = "ABP-Changed-Secure-Password!2026";
      const changed = await request(server)
        .post("/api/v1/auth/change-password")
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .send({ currentPassword: password, newPassword: nextPassword })
        .expect(200);
      expect(changed.body.data.changed).toBe(true);

      await request(server)
        .post("/api/v1/auth/mfa/setup")
        .set("Cookie", cookie)
        .set("x-csrf-token", csrf)
        .send({})
        .expect(201);

      await database.$transaction([
        database.authChallenge.deleteMany({ where: { userId } }),
        database.mfaRecoveryCode.deleteMany({ where: { userId } }),
        database.appSession.deleteMany({ where: { userId } }),
        database.appUser.update({
          where: { id: userId },
          data: {
            passwordHash: await hashPassword(password),
            mustChangePassword: false,
            mfaRequired: false,
            mfaEnabled: false,
            mfaSecretCiphertext: null,
            mfaSecretIv: null,
            mfaSecretAuthTag: null,
            mfaSecretVersion: null,
          },
        }),
      ]);
      await database.requestRateLimit.deleteMany();
    });

    it("enrolls TOTP, returns one-time recovery codes, and completes MFA login", async () => {
      const server = application.getHttpServer();
      const authHeaders = {
        "x-abp-test-user-id": userId,
        "x-abp-test-session-id": "local-auth-mfa-setup",
      };
      const setup = await request(server)
        .post("/api/v1/auth/mfa/setup")
        .set(authHeaders)
        .send({})
        .expect(201);
      expect(setup.body.data.qrCodeDataUrl).toMatch(/^data:image\/png;base64,/);
      const secret = setup.body.data.manualSecret as string;
      const token = new TOTP({ secret: Secret.fromBase32(secret) }).generate();
      const confirmed = await request(server)
        .post("/api/v1/auth/mfa/confirm")
        .set(authHeaders)
        .send({ code: token })
        .expect(201);
      expect(confirmed.body.data.recoveryCodes).toHaveLength(10);

      const login = await request(server)
        .post("/api/v1/auth/login")
        .send({ identifier: username, password })
        .expect(200);
      expect(login.body.data.state).toBe("MFA_REQUIRED");
      const verified = await request(server)
        .post("/api/v1/auth/mfa/verify")
        .send({
          challengeToken: login.body.data.challengeToken,
          code: new TOTP({ secret: Secret.fromBase32(secret) }).generate(),
        })
        .expect(200);
      expect(verified.body.data.state).toBe("AUTHENTICATED");
      expect(verified.headers["set-cookie"]?.[0]).toContain("abp_session=");
    });
  },
);
