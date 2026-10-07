import type { ApiClient, components } from "@abp/api-client";
import { clearCsrfToken, writeCsrfToken } from "./csrf.ts";

type LocalAuthData = components["schemas"]["LocalAuthEnvelope"]["data"];
type MfaSetupData = components["schemas"]["MfaSetupEnvelope"]["data"];
type MfaConfirmData = components["schemas"]["MfaConfirmEnvelope"]["data"];
export type AccessRequest = components["schemas"]["AccessRequest"];

export async function submitAccessRequest(
  client: ApiClient,
  body: {
    fullName: string;
    workEmail: string;
    companyOrRole?: string | null;
    countryCode?: string | null;
    message?: string | null;
  },
): Promise<AccessRequest> {
  const result = await client.POST("/auth/request-access", { body });
  return unwrap(result).data;
}

export async function login(
  client: ApiClient,
  identifier: string,
  password: string,
): Promise<LocalAuthData> {
  const result = await client.POST("/auth/login", {
    body: { identifier, password },
  });
  return unwrap(result).data;
}

export async function verifyMfa(
  client: ApiClient,
  challengeToken: string,
  code: string,
): Promise<LocalAuthData> {
  const result = await client.POST("/auth/mfa/verify", {
    body: { challengeToken, code },
  });
  return unwrap(result).data;
}

export async function useRecoveryCode(
  client: ApiClient,
  challengeToken: string,
  recoveryCode: string,
): Promise<LocalAuthData> {
  const result = await client.POST("/auth/mfa/recovery", {
    body: { challengeToken, recoveryCode },
  });
  return unwrap(result).data;
}

export async function setupMfa(client: ApiClient): Promise<MfaSetupData> {
  const result = await client.POST("/auth/mfa/setup", {});
  return unwrap(result).data;
}

export async function confirmMfa(
  client: ApiClient,
  code: string,
): Promise<MfaConfirmData> {
  const result = await client.POST("/auth/mfa/confirm", { body: { code } });
  return (unwrap(result) as unknown as { readonly data: MfaConfirmData }).data;
}

export async function changePassword(
  client: ApiClient,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  const result = await client.POST("/auth/change-password", {
    body: { currentPassword, newPassword },
  });
  unwrap(result);
}

export async function logout(client: ApiClient): Promise<void> {
  const result = await client.POST("/auth/logout", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body: { allSessions: false },
  });
  unwrap(result);
  clearCsrfToken();
  sessionStorage.removeItem("abp.password.change.required");
  sessionStorage.removeItem("abp.mfa.setup.required");
}

export function rememberAuthenticatedSession(data: LocalAuthData): void {
  // The token has to outlive the tab, because the session cookie does.
  if (data.csrfToken) writeCsrfToken(data.csrfToken);
  if (data.state === "MFA_SETUP_REQUIRED") {
    sessionStorage.setItem("abp.mfa.setup.required", "true");
  }
  if (data.mustChangePassword === true) {
    sessionStorage.setItem("abp.password.change.required", "true");
  }
}

export function isPasswordChangeRequired(): boolean {
  return sessionStorage.getItem("abp.password.change.required") === "true";
}

export function completePasswordChange(): void {
  sessionStorage.removeItem("abp.password.change.required");
}

export function isMfaSetupRequired(): boolean {
  return sessionStorage.getItem("abp.mfa.setup.required") === "true";
}

export function completeMfaSetup(): void {
  sessionStorage.removeItem("abp.mfa.setup.required");
}

function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.data !== undefined) return result.data;
  const envelope = result.error as
    { error?: { messageKey?: string; code?: string } } | undefined;
  throw new Error(
    envelope?.error?.messageKey ??
      envelope?.error?.code ??
      `AUTH_HTTP_${String(result.response.status)}`,
  );
}
