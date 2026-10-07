import { randomUUID } from "node:crypto";
import { permissions } from "@abp/contracts";
import { createPrismaClient } from "@abp/database";
import { hashPassword, validatePassword } from "./password.service.js";

const command = process.argv[2];
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL_REQUIRED");
const db = createPrismaClient(databaseUrl);

try {
  if (command === "create") await createAdmin();
  else if (command === "reset-password") await resetPassword();
  else if (command === "reset-mfa") await resetMfa();
  else
    throw new Error(
      "USAGE: local-admin-cli.ts create|reset-password|reset-mfa",
    );
} finally {
  await db.$disconnect();
}

async function createAdmin() {
  const username = required("ABP_ADMIN_USERNAME").trim().toLowerCase();
  const email = required("ABP_ADMIN_EMAIL").trim().toLowerCase();
  const displayName = required("ABP_ADMIN_DISPLAY_NAME").trim();
  const password = required("ABP_ADMIN_PASSWORD");
  validatePassword(password);
  const matches = await db.appUser.findMany({
    where: {
      OR: [{ usernameNormalized: username }, { emailNormalized: email }],
    },
  });
  if (
    matches.length > 1 ||
    (matches[0] !== undefined &&
      (matches[0].usernameNormalized !== username ||
        matches[0].emailNormalized !== email ||
        matches[0].authProvider !== "LOCAL"))
  ) {
    throw new Error("LOCAL_ADMIN_IDENTITY_CONFLICT");
  }
  const existing = matches[0];
  const passwordHash = await hashPassword(password);
  const user = await db.$transaction(async (tx) => {
    for (const [code, name, continentCode] of [
      ["EG", "Egypt", "AFRICA"],
      ["SA", "Saudi Arabia", "ASIA"],
      ["AE", "United Arab Emirates", "ASIA"],
    ] as const) {
      await tx.country.upsert({
        where: { code },
        create: { code, name, continentCode },
        update: {},
      });
    }
    const role = await tx.role.upsert({
      where: { code: "SYSTEM_ADMIN" },
      create: {
        code: "SYSTEM_ADMIN",
        name: "System Administrator",
        workspace: "ADMIN",
        systemProtected: true,
      },
      update: { active: true, systemProtected: true },
    });
    for (const permissionCode of Object.values(permissions)) {
      await tx.permission.upsert({
        where: { code: permissionCode },
        create: { code: permissionCode, description: permissionCode },
        update: {},
      });
      await tx.rolePermission.upsert({
        where: {
          roleId_permissionCode: { roleId: role.id, permissionCode },
        },
        create: { roleId: role.id, permissionCode },
        update: {},
      });
    }
    const createdUser =
      existing === undefined
        ? await tx.appUser.create({
            data: {
              externalSubject: `local:${username}`,
              usernameNormalized: username,
              emailNormalized: email,
              displayName,
              authProvider: "LOCAL",
              authStatusCode: "ACTIVE",
              active: true,
              passwordHash,
              passwordChangedAt: new Date(),
              mustChangePassword: true,
              mfaRequired: true,
              mfaEnabled: false,
            },
          })
        : await tx.appUser.update({
            where: { id: existing.id },
            data: {
              displayName,
              authStatusCode: "ACTIVE",
              active: true,
              passwordHash,
              passwordChangedAt: new Date(),
              mustChangePassword: true,
              mfaRequired: true,
              failedLoginCount: 0,
              lockedUntil: null,
              policyVersion: { increment: 1 },
              rowVersion: { increment: 1 },
            },
          });
    await tx.userProfile.upsert({
      where: { userId: createdUser.id },
      create: { userId: createdUser.id, displayName },
      update: { displayName },
    });
    await tx.userRole.upsert({
      where: { userId_roleId: { userId: createdUser.id, roleId: role.id } },
      create: { userId: createdUser.id, roleId: role.id },
      update: {},
    });
    const countries = await tx.country.findMany({
      where: { active: true },
      select: { code: true },
    });
    for (const { code: countryCode } of countries) {
      await tx.userCountryAccess.upsert({
        where: {
          userId_countryCode: { userId: createdUser.id, countryCode },
        },
        create: {
          userId: createdUser.id,
          countryCode,
          grantedBy: createdUser.id,
        },
        update: {
          statusCode: "ACTIVE",
          validFrom: new Date(),
          validTo: null,
          grantedBy: createdUser.id,
        },
      });
    }
    await tx.userPreference.upsert({
      where: { userId: createdUser.id },
      create: {
        userId: createdUser.id,
        preferences: { language: "en", timezone: "Africa/Cairo" },
      },
      update: {
        preferences: { language: "en", timezone: "Africa/Cairo" },
        rowVersion: { increment: 1 },
      },
    });
    if (existing !== undefined) {
      await tx.appSession.updateMany({
        where: { userId: createdUser.id, statusCode: "ACTIVE" },
        data: { statusCode: "REVOKED", revokedAt: new Date() },
      });
    }
    return createdUser;
  });
  if (existing === undefined) await audit("USER_CREATED", user.id);
  await audit("ROLE_ASSIGNED", user.id);
  await audit("COUNTRY_SCOPE_ASSIGNED", user.id);
  await audit("ADMIN_BOOTSTRAP", user.id);
  process.stdout.write(
    `${existing === undefined ? "Created" : "Updated"} local administrator ${user.id}\n`,
  );
}

async function resetPassword() {
  const username = required("ABP_TARGET_USERNAME").trim().toLowerCase();
  const password = required("ABP_ADMIN_PASSWORD");
  validatePassword(password);
  const user = await db.appUser.findUnique({
    where: { usernameNormalized: username },
  });
  if (!user || user.authProvider !== "LOCAL")
    throw new Error("LOCAL_USER_NOT_FOUND");
  await db.$transaction([
    db.appUser.update({
      where: { id: user.id },
      data: {
        passwordHash: await hashPassword(password),
        passwordChangedAt: new Date(),
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
        policyVersion: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    }),
    db.appSession.updateMany({
      where: { userId: user.id, statusCode: "ACTIVE" },
      data: { statusCode: "REVOKED", revokedAt: new Date() },
    }),
  ]);
  await audit("PASSWORD_ADMIN_RESET", user.id);
  process.stdout.write(`Reset password and revoked sessions for ${user.id}\n`);
}

async function resetMfa() {
  const username = required("ABP_TARGET_USERNAME").trim().toLowerCase();
  const user = await db.appUser.findUnique({
    where: { usernameNormalized: username },
  });
  if (!user || user.authProvider !== "LOCAL")
    throw new Error("LOCAL_USER_NOT_FOUND");
  await db.$transaction([
    db.mfaRecoveryCode.deleteMany({ where: { userId: user.id } }),
    db.authChallenge.deleteMany({ where: { userId: user.id } }),
    db.appUser.update({
      where: { id: user.id },
      data: {
        mfaEnabled: false,
        mfaRequired: true,
        mfaSecretCiphertext: null,
        mfaSecretIv: null,
        mfaSecretAuthTag: null,
        mfaSecretVersion: null,
        policyVersion: { increment: 1 },
        rowVersion: { increment: 1 },
      },
    }),
    db.appSession.updateMany({
      where: { userId: user.id, statusCode: "ACTIVE" },
      data: { statusCode: "REVOKED", revokedAt: new Date() },
    }),
  ]);
  await audit("MFA_ADMIN_RESET", user.id);
  process.stdout.write(`Reset MFA and revoked sessions for ${user.id}\n`);
}

async function audit(actionCode: string, resourceId: string) {
  const traceId = randomUUID();
  await db.auditEvent.create({
    data: {
      actionCode,
      resourceType: "APP_USER",
      resourceId,
      workspace: "ADMIN",
      traceId,
      correlationId: traceId,
      source: "LOCAL_ADMIN_CLI",
    },
  });
}

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name}_REQUIRED`);
  return value;
}
