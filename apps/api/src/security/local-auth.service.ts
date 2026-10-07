import { Inject, Injectable } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import QRCode from "qrcode";
import { Secret, TOTP } from "otpauth";
import type { DatabaseClient } from "@abp/database";
import type { CustomerIdentity } from "../customer/customer-auth.js";
import { ApiProblem } from "../platform/api-exception.filter.js";
import { databaseClientToken } from "../platform/database.providers.js";
import { hashSecret } from "../platform/session-access.service.js";
import type {
  ChangePasswordDto,
  LoginDto,
  MfaCodeDto,
  MfaRecoveryDto,
  MfaVerifyDto,
  ResetPasswordDto,
} from "./local-auth.dto.js";
import { decryptMfaSecret, encryptMfaSecret } from "./mfa-crypto.js";
import {
  hashPassword,
  needsRehash,
  validatePassword,
  verifyPassword,
} from "./password.service.js";

const DUMMY_PASSWORD = "ABP-Dummy-Password-Only-For-Timing!42";

@Injectable()
export class LocalAuthService {
  private readonly dummyHash = hashPassword(DUMMY_PASSWORD);

  constructor(
    @Inject(databaseClientToken) private readonly db: DatabaseClient,
  ) {}

  async login(body: LoginDto) {
    const identifier = normalizeIdentifier(body.identifier);
    const now = new Date();
    const user = await this.db.appUser.findFirst({
      where: {
        authProvider: "LOCAL",
        OR: [
          { emailNormalized: identifier },
          { usernameNormalized: identifier },
        ],
      },
      include: { roles: { include: { role: true } } },
    });
    const encodedHash = user?.passwordHash ?? (await this.dummyHash);
    const passwordValid = await verifyPassword(encodedHash, body.password);
    const locked =
      user?.lockedUntil !== null &&
      user?.lockedUntil !== undefined &&
      user.lockedUntil > now;
    if (
      user === null ||
      !passwordValid ||
      locked ||
      !user.active ||
      user.authStatusCode !== "ACTIVE"
    ) {
      if (user !== null && !locked) await this.recordFailure(user.id, now);
      throw invalidCredentials();
    }

    const passwordHash = needsRehash(encodedHash)
      ? await hashPassword(body.password)
      : undefined;
    await this.db.appUser.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastSignInAt: now,
        ...(passwordHash === undefined ? {} : { passwordHash }),
      },
    });
    await this.audit("LOGIN_SUCCESS", user.id, null);

    if (user.mfaEnabled) {
      const challengeToken = randomToken();
      await this.db.authChallenge.create({
        data: {
          userId: user.id,
          tokenHash: hashSecret(challengeToken),
          expiresAt: new Date(now.getTime() + 5 * 60_000),
        },
      });
      return { state: "MFA_REQUIRED" as const, challengeToken };
    }
    return {
      state: user.mfaRequired
        ? ("MFA_SETUP_REQUIRED" as const)
        : ("AUTHENTICATED" as const),
      ...(await this.issueSession(
        user.id,
        user.policyVersion,
        privileged(user),
      )),
      mustChangePassword: user.mustChangePassword,
    };
  }

  async verifyMfa(body: MfaVerifyDto) {
    const challenge = await this.challenge(body.challengeToken);
    const secret = this.readSecret(challenge.user);
    if (!validTotp(secret, body.code)) {
      await this.bumpChallenge(challenge.id);
      throw invalidCredentials();
    }
    return this.completeChallenge(challenge.id, challenge.user);
  }

  async recoverMfa(body: MfaRecoveryDto) {
    const challenge = await this.challenge(body.challengeToken);
    const codeHash = recoveryHash(body.recoveryCode);
    const recovery = await this.db.mfaRecoveryCode.findUnique({
      where: { userId_codeHash: { userId: challenge.userId, codeHash } },
    });
    if (recovery === null || recovery.usedAt !== null) {
      await this.bumpChallenge(challenge.id);
      throw invalidCredentials();
    }
    await this.db.$transaction([
      this.db.mfaRecoveryCode.update({
        where: { id: recovery.id },
        data: { usedAt: new Date() },
      }),
      this.db.authChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    await this.audit("MFA_RECOVERY_USED", challenge.userId, null);
    return {
      state: "AUTHENTICATED" as const,
      ...(await this.issueSession(
        challenge.user.id,
        challenge.user.policyVersion,
        privileged(challenge.user),
      )),
      mustChangePassword: challenge.user.mustChangePassword,
    };
  }

  async setupMfa(identity: CustomerIdentity) {
    const secret = new Secret({ size: 20 });
    const encrypted = encryptMfaSecret(secret.base32);
    await this.db.appUser.update({
      where: { id: identity.userId },
      data: {
        mfaEnabled: false,
        mfaSecretCiphertext: encrypted.ciphertext,
        mfaSecretIv: encrypted.iv,
        mfaSecretAuthTag: encrypted.authTag,
        mfaSecretVersion: encrypted.version,
      },
    });
    const uri = totp(secret.base32, identity.email).toString();
    await this.audit("MFA_SETUP_STARTED", identity.userId, identity.sessionId);
    return {
      data: {
        manualSecret: secret.base32,
        provisioningUri: uri,
        qrCodeDataUrl: await QRCode.toDataURL(uri, {
          errorCorrectionLevel: "M",
        }),
      },
    };
  }

  async confirmMfa(identity: CustomerIdentity, body: MfaCodeDto) {
    const user = await this.db.appUser.findUnique({
      where: { id: identity.userId },
    });
    if (user === null || !validTotp(this.readSecret(user), body.code))
      throw invalidCredentials();
    const recoveryCodes = Array.from({ length: 10 }, () => recoveryCode());
    await this.db.$transaction([
      this.db.appUser.update({
        where: { id: identity.userId },
        data: { mfaEnabled: true, mfaRequired: true },
      }),
      this.db.mfaRecoveryCode.deleteMany({
        where: { userId: identity.userId },
      }),
      this.db.mfaRecoveryCode.createMany({
        data: recoveryCodes.map((code) => ({
          userId: identity.userId,
          codeHash: recoveryHash(code),
        })),
      }),
    ]);
    await this.audit("MFA_ENROLLED", identity.userId, identity.sessionId);
    return { data: { enabled: true, recoveryCodes } };
  }

  async changeOwnPassword(identity: CustomerIdentity, body: ChangePasswordDto) {
    const user = await this.db.appUser.findUnique({
      where: { id: identity.userId },
    });
    if (
      user?.passwordHash === null ||
      user?.passwordHash === undefined ||
      !(await verifyPassword(user.passwordHash, body.currentPassword))
    ) {
      throw invalidCredentials();
    }
    validatePassword(body.newPassword);
    if (await verifyPassword(user.passwordHash, body.newPassword)) {
      throw new ApiProblem({ status: 422, code: "PASSWORD_REUSE_NOT_ALLOWED" });
    }
    const nextPolicyVersion = user.policyVersion + 1;
    await this.db.$transaction([
      this.db.appUser.update({
        where: { id: identity.userId },
        data: {
          passwordHash: await hashPassword(body.newPassword),
          passwordChangedAt: new Date(),
          mustChangePassword: false,
          failedLoginCount: 0,
          lockedUntil: null,
          policyVersion: nextPolicyVersion,
          rowVersion: { increment: 1 },
        },
      }),
      this.db.appSession.update({
        where: { id: identity.sessionId },
        data: { policyVersionSnapshot: nextPolicyVersion },
      }),
      this.db.appSession.updateMany({
        where: {
          userId: identity.userId,
          id: { not: identity.sessionId },
          statusCode: "ACTIVE",
        },
        data: { statusCode: "REVOKED", revokedAt: new Date() },
      }),
    ]);
    await this.audit("PASSWORD_CHANGED", identity.userId, identity.sessionId);
    return { data: { changed: true } };
  }

  async disableMfa(identity: CustomerIdentity, body: MfaCodeDto) {
    const user = await this.db.appUser.findUnique({
      where: { id: identity.userId },
    });
    if (user === null || !validTotp(this.readSecret(user), body.code))
      throw invalidCredentials();
    await this.clearMfa(identity.userId);
    await this.audit("MFA_DISABLED", identity.userId, identity.sessionId);
    return { data: { enabled: false } };
  }

  async adminResetMfa(identity: CustomerIdentity, userId: string) {
    requirePermission(identity, "users.manage");
    await this.clearMfa(userId);
    await this.db.appSession.updateMany({
      where: { userId, statusCode: "ACTIVE" },
      data: {
        statusCode: "REVOKED",
        revokedAt: new Date(),
        revokedByUserId: identity.userId,
      },
    });
    await this.audit(
      "MFA_ADMIN_RESET",
      userId,
      identity.sessionId,
      identity.userId,
    );
    return { data: { reset: true } };
  }

  async resetPassword(
    identity: CustomerIdentity,
    userId: string,
    body: ResetPasswordDto,
  ) {
    requirePermission(identity, "users.manage");
    validatePassword(body.password);
    await this.db.appUser.update({
      where: { id: userId },
      data: {
        passwordHash: await hashPassword(body.password),
        passwordChangedAt: new Date(),
        mustChangePassword: body.mustChangePassword ?? true,
        failedLoginCount: 0,
        lockedUntil: null,
        rowVersion: { increment: 1 },
      },
    });
    if (body.revokeSessions ?? true) {
      await this.db.appSession.updateMany({
        where: { userId, statusCode: "ACTIVE" },
        data: {
          statusCode: "REVOKED",
          revokedAt: new Date(),
          revokedByUserId: identity.userId,
        },
      });
    }
    await this.audit(
      "PASSWORD_ADMIN_RESET",
      userId,
      identity.sessionId,
      identity.userId,
    );
    return { data: { reset: true } };
  }

  private async recordFailure(userId: string, now: Date) {
    const user = await this.db.appUser.findUnique({ where: { id: userId } });
    if (user === null) return;
    const maximum = envInteger("ABP_MAX_FAILED_LOGIN_ATTEMPTS", 5);
    const next = user.failedLoginCount + 1;
    const lockedUntil =
      next >= maximum
        ? new Date(
            now.getTime() + envInteger("ABP_LOCKOUT_MINUTES", 15) * 60_000,
          )
        : null;
    await this.db.appUser.update({
      where: { id: userId },
      data: { failedLoginCount: next >= maximum ? 0 : next, lockedUntil },
    });
    await this.audit(
      lockedUntil === null ? "LOGIN_FAILED" : "ACCOUNT_LOCKED",
      userId,
      null,
    );
  }

  private async issueSession(
    userId: string,
    policyVersion: number,
    isPrivileged: boolean,
  ) {
    const now = new Date();
    const idleMinutes = isPrivileged ? 15 : 30;
    const absoluteHours = isPrivileged ? 8 : 12;
    const rawToken = randomToken();
    const csrfToken = randomToken();
    const absoluteExpiresAt = new Date(
      now.getTime() + absoluteHours * 3_600_000,
    );
    await this.db.appSession.create({
      data: {
        id: randomUUID(),
        userId,
        tokenHash: hashSecret(rawToken),
        csrfTokenHash: hashSecret(csrfToken),
        privileged: isPrivileged,
        policyVersionSnapshot: policyVersion,
        issuedAt: now,
        authTime: now,
        lastSeenAt: now,
        expiresAt: new Date(now.getTime() + idleMinutes * 60_000),
        absoluteExpiresAt,
      },
    });
    return { sessionToken: rawToken, csrfToken, absoluteExpiresAt };
  }

  private async challenge(token: string) {
    const challenge = await this.db.authChallenge.findUnique({
      where: { tokenHash: hashSecret(token) },
      include: { user: { include: { roles: { include: { role: true } } } } },
    });
    if (
      challenge === null ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= new Date() ||
      challenge.attemptCount >= 5 ||
      !challenge.user.mfaEnabled
    )
      throw invalidCredentials();
    return challenge;
  }

  private async completeChallenge(challengeId: string, user: SessionUser) {
    await this.db.authChallenge.update({
      where: { id: challengeId },
      data: { consumedAt: new Date() },
    });
    await this.audit("MFA_LOGIN_SUCCESS", user.id, null);
    return {
      state: "AUTHENTICATED" as const,
      ...(await this.issueSession(
        user.id,
        user.policyVersion,
        privileged(user),
      )),
      mustChangePassword: user.mustChangePassword,
    };
  }

  private async bumpChallenge(id: string) {
    await this.db.authChallenge.update({
      where: { id },
      data: { attemptCount: { increment: 1 } },
    });
  }

  private readSecret(user: {
    mfaSecretCiphertext: string | null;
    mfaSecretIv: string | null;
    mfaSecretAuthTag: string | null;
    mfaSecretVersion: number | null;
  }) {
    if (
      user.mfaSecretCiphertext === null ||
      user.mfaSecretIv === null ||
      user.mfaSecretAuthTag === null ||
      user.mfaSecretVersion === null
    )
      throw new ApiProblem({ status: 409, code: "MFA_NOT_CONFIGURED" });
    return decryptMfaSecret({
      ciphertext: user.mfaSecretCiphertext,
      iv: user.mfaSecretIv,
      authTag: user.mfaSecretAuthTag,
      version: user.mfaSecretVersion,
    });
  }

  private async clearMfa(userId: string) {
    await this.db.$transaction([
      this.db.mfaRecoveryCode.deleteMany({ where: { userId } }),
      this.db.authChallenge.deleteMany({ where: { userId } }),
      this.db.appUser.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaRequired: false,
          mfaSecretCiphertext: null,
          mfaSecretIv: null,
          mfaSecretAuthTag: null,
          mfaSecretVersion: null,
          policyVersion: { increment: 1 },
        },
      }),
    ]);
  }

  private async audit(
    actionCode: string,
    resourceId: string,
    sessionId: string | null,
    actorUserId: string | null = resourceId,
  ) {
    const traceId = randomUUID();
    await this.db.auditEvent.create({
      data: {
        actorUserId,
        actorSessionId: sessionId,
        actionCode,
        resourceType: "APP_USER",
        resourceId,
        workspace: "ADMIN",
        traceId,
        correlationId: traceId,
        source: "LOCAL_AUTH",
      },
    });
  }
}

interface SessionUser {
  id: string;
  policyVersion: number;
  mustChangePassword: boolean;
  roles: { role: { code: string } }[];
}

function privileged(user: { roles: { role: { code: string } }[] }) {
  return user.roles.some(({ role }) =>
    ["SYSTEM_ADMIN", "ADMIN", "FINANCE"].includes(role.code),
  );
}

function totp(secret: string, label: string) {
  return new TOTP({
    issuer: "ABP Commercial System",
    label,
    secret,
    algorithm: "SHA1",
    digits: 6,
    period: 30,
  });
}

function validTotp(secret: string, code: string) {
  return totp(secret, "ABP User").validate({ token: code, window: 1 }) !== null;
}

function normalizeIdentifier(value: string) {
  return value.trim().toLowerCase();
}

function randomToken() {
  return randomBytes(32).toString("base64url");
}

function recoveryCode() {
  return `${randomBytes(4).toString("hex")}-${randomBytes(4).toString("hex")}`.toUpperCase();
}

function recoveryHash(value: string) {
  return createHash("sha256")
    .update(value.replaceAll("-", "").toUpperCase())
    .digest("hex");
}

function envInteger(name: string, fallback: number) {
  const value = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function invalidCredentials() {
  return new ApiProblem({ status: 401, code: "INVALID_CREDENTIALS" });
}

function requirePermission(identity: CustomerIdentity, permission: string) {
  if (
    identity.deniedPermissions.has(permission) ||
    !identity.permissions.has(permission)
  )
    throw new ApiProblem({ status: 403, code: "FORBIDDEN" });
}
