import { randomBytes, randomUUID } from "node:crypto";
// The API owns the pinned OTP dependency; keep this UAT helper on that exact version.
// @ts-expect-error package-local runtime import has no project declaration file.
import { TOTP } from "../../apps/api/node_modules/otpauth/dist/otpauth.node.mjs";
import { createPrismaClient } from "../../packages/database/dist/index.js";

type Credential = { username: string; password: string; userId: string };
const baseUrl = (
  process.env.ABP_UAT_API_URL ?? "http://127.0.0.1:3101/api/v1"
).replace(/\/$/, "");
const credentials = JSON.parse(
  process.env.ABP_UAT_CREDENTIALS_JSON ?? "[]",
) as Credential[];
if (credentials.length !== 9)
  throw new Error("UAT_CREDENTIALS_JSON_MUST_CONTAIN_9_USERS");

function strongPassword() {
  return `Uat!${randomBytes(24).toString("base64url")}Aa9#`;
}

async function call(
  path: string,
  init: RequestInit = {},
  session?: { cookie: string; csrf: string },
) {
  const headers = new Headers(init.headers);
  headers.set("content-type", "application/json");
  if (session) {
    headers.set("cookie", session.cookie);
    if (init.method && !["GET", "HEAD", "OPTIONS"].includes(init.method))
      headers.set("x-csrf-token", session.csrf);
  }
  const response = await fetch(`${baseUrl}${path}`, { ...init, headers });
  const raw = await response.text();
  let body: unknown = undefined;
  try {
    body = raw.length ? JSON.parse(raw) : undefined;
  } catch {
    body = raw;
  }
  const setCookie = response.headers.get("set-cookie");
  return {
    response,
    body: body as any,
    cookie: setCookie?.split(";")[0] ?? session?.cookie ?? "",
  };
}

function totp(secret: string) {
  return new TOTP({
    issuer: "ABP Commercial System",
    label: "UAT",
    secret,
  }).generate();
}

async function login(username: string, password: string) {
  const result = await call("/auth/login", {
    method: "POST",
    body: JSON.stringify({ identifier: username, password }),
  });
  if (!result.response.ok)
    throw new Error(`${username}:LOGIN_${result.response.status}`);
  const data = result.body?.data;
  const csrf = data?.csrfToken;
  const session =
    typeof csrf === "string" && result.cookie
      ? { cookie: result.cookie, csrf }
      : undefined;
  return { data, session };
}

async function runUser(credential: Credential) {
  const permanent = strongPassword();
  const first = await login(credential.username, credential.password);
  if (
    first.data.state !== "MFA_SETUP_REQUIRED" ||
    first.data.mustChangePassword !== true ||
    !first.session
  )
    throw new Error(`${credential.username}:BOOTSTRAP_STATE`);
  const changed = await call(
    "/auth/change-password",
    {
      method: "POST",
      body: JSON.stringify({
        currentPassword: credential.password,
        newPassword: permanent,
      }),
    },
    first.session,
  );
  if (!changed.response.ok)
    throw new Error(
      `${credential.username}:PASSWORD_CHANGE_${changed.response.status}`,
    );
  const setup = await call(
    "/auth/mfa/setup",
    { method: "POST", body: "{}" },
    first.session,
  );
  const secret = setup.body?.data?.manualSecret;
  if (!setup.response.ok || typeof secret !== "string")
    throw new Error(
      `${credential.username}:MFA_SETUP_${setup.response.status}`,
    );
  const confirmed = await call(
    "/auth/mfa/confirm",
    { method: "POST", body: JSON.stringify({ code: totp(secret) }) },
    first.session,
  );
  if (
    !confirmed.response.ok ||
    confirmed.body?.data?.recoveryCodes?.length !== 10
  )
    throw new Error(
      `${credential.username}:MFA_CONFIRM_${confirmed.response.status}`,
    );
  const logout = await call(
    "/auth/logout",
    {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ allSessions: false }),
    },
    first.session,
  );
  if (!logout.response.ok)
    throw new Error(
      `${credential.username}:LOGOUT_BOOTSTRAP_${logout.response.status}`,
    );
  const second = await login(credential.username, permanent);
  if (
    second.data.state !== "MFA_REQUIRED" ||
    typeof second.data.challengeToken !== "string"
  )
    throw new Error(`${credential.username}:MFA_CHALLENGE_STATE`);
  const verified = await call("/auth/mfa/verify", {
    method: "POST",
    body: JSON.stringify({
      challengeToken: second.data.challengeToken,
      code: totp(secret),
    }),
  });
  if (!verified.response.ok || verified.body?.data?.state !== "AUTHENTICATED")
    throw new Error(
      `${credential.username}:MFA_VERIFY_${verified.response.status}`,
    );
  const session = {
    cookie: verified.cookie,
    csrf: verified.body?.data?.csrfToken ?? "",
  };
  const me = await call("/me", {}, session);
  if (
    !me.response.ok ||
    me.body?.data?.user?.mustChangePassword !== false ||
    me.body?.data?.user?.mfaEnabled !== true
  )
    throw new Error(`${credential.username}:ME_STATE_${me.response.status}`);
  const role = me.body?.data?.access?.roles?.[0]?.code ?? "UNKNOWN";
  const forbiddenByRole: Readonly<Record<string, string>> = {
    SALES_MANAGER: "/finance/payments?page=1&limit=25",
    SALES_SUPPORT: "/opportunities?page=1&limit=25",
    LOGISTICS: "/accounts?page=1&limit=25",
    OPERATIONS: "/finance/payments?page=1&limit=25",
    FINANCE: "/accounts?page=1&limit=25",
    CUSTOMER_PORTAL_USER: "/accounts?page=1&limit=25",
  };
  const forbiddenPath = forbiddenByRole[role];
  if (forbiddenPath) {
    const forbidden = await call(forbiddenPath, {}, session);
    if (forbidden.response.status !== 403)
      throw new Error(
        `${credential.username}:ROLE_ISOLATION_${forbidden.response.status}`,
      );
  }
  if (credential.username === "uat.sales.user") {
    const expectations = [
      [1, 200],
      [2, 404],
      [3, 404],
      [4, 200],
      [5, 404],
    ] as const;
    for (const [recordNumber, expectedStatus] of expectations) {
      const accountId = `00000002-0000-4000-8000-${String(recordNumber).padStart(12, "0")}`;
      const result = await call(`/accounts/${accountId}`, {}, session);
      if (result.response.status !== expectedStatus)
        throw new Error(
          `${credential.username}:ACCOUNT_${recordNumber}_${result.response.status}_EXPECTED_${expectedStatus}`,
        );
    }
  }
  if (role === "CUSTOMER_PORTAL_USER") {
    const portal = await call("/portal/customer-contexts", {}, session);
    if (!portal.response.ok || portal.body?.data?.length !== 1)
      throw new Error(
        `${credential.username}:PORTAL_BINDING_${portal.response.status}`,
      );
  }
  const logoutFinal = await call(
    "/auth/logout",
    {
      method: "POST",
      headers: { "idempotency-key": randomUUID() },
      body: JSON.stringify({ allSessions: false }),
    },
    session,
  );
  if (!logoutFinal.response.ok)
    throw new Error(
      `${credential.username}:LOGOUT_${logoutFinal.response.status}`,
    );
  return {
    username: credential.username,
    role,
    state: "PASS",
  };
}

async function main() {
  const db = createPrismaClient(process.env.DATABASE_URL!);
  const results: Array<{
    username: string;
    role?: string;
    state: string;
    error?: string;
  }> = [];
  for (const credential of credentials) {
    try {
      await db.requestRateLimit.deleteMany();
      results.push(await runUser(credential));
    } catch (error) {
      results.push({
        username: credential.username,
        state: "FAIL",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const audit = await db.auditEvent.groupBy({
    by: ["actionCode"],
    where: {
      resourceType: "APP_USER",
      actionCode: { in: ["PASSWORD_CHANGED", "MFA_ENROLLED", "LOGIN_SUCCESS"] },
    },
    _count: { _all: true },
  });
  const rows = await db.appUser.count({
    where: {
      usernameNormalized: { startsWith: "uat." },
      mustChangePassword: false,
      mfaEnabled: true,
    },
  });
  await db.$disconnect();
  const failed = results.filter((x) => x.state === "FAIL");
  process.stdout.write(
    JSON.stringify(
      {
        results,
        passed: results.length - failed.length,
        failed: failed.length,
        finalizedUsers: rows,
        audit,
        credentials: credentials.map(({ username, userId }) => ({
          username,
          userId,
        })),
      },
      null,
      2,
    ),
  );
  if (failed.length) process.exitCode = 1;
}

await main();
