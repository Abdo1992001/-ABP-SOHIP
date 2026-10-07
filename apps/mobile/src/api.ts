import * as SecureStore from "expo-secure-store";
import type { components } from "@abp/api-client";

declare const process: { env: Record<string, string | undefined> };

export type Me = components["schemas"]["Me"];
export type AuthResult = components["schemas"]["LocalAuthEnvelope"]["data"];
export type Account = components["schemas"]["AccountListItem"];
export type AccountDetail = components["schemas"]["AccountDetail"];
export type ActionItem = components["schemas"]["ActionQueueItem"];
export type Activity = components["schemas"]["Activity"];
export type Opportunity = components["schemas"]["OpportunityListItem"];
export type OpportunityDetail = components["schemas"]["OpportunityDetail"];
export type Quotation =
  components["schemas"]["QuotationListEnvelope"]["data"][number];
export type Notification = components["schemas"]["Notification"];
export type TargetPerformance = components["schemas"]["TargetPerformance"];
export type PageMeta = components["schemas"]["OffsetPaginationMeta"];
export type MfaSetup = components["schemas"]["MfaSetupEnvelope"]["data"];

const baseUrl = (
  process.env.EXPO_PUBLIC_API_BASE_URL ?? "http://10.0.2.2:3000/api/v1"
).replace(/\/$/, "");
const csrfKey = "abp.csrfToken";

type Envelope<T> = { data: T; meta?: PageMeta };
type RequestOptions = {
  method?: "GET" | "POST";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  idempotent?: boolean;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

function requestId() {
  return `mobile-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

async function request<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const method = options.method ?? "GET";
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value !== undefined && String(value).trim() !== "") {
      url.searchParams.set(key, String(value));
    }
  }

  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (method !== "GET") {
    const csrf = await SecureStore.getItemAsync(csrfKey);
    if (csrf) headers.set("X-CSRF-Token", csrf);
    if (options.idempotent) headers.set("Idempotency-Key", requestId());
  }
  if (__DEV__ && process.env.EXPO_PUBLIC_DEMO_USER_ID) {
    headers.set("x-abp-test-user-id", process.env.EXPO_PUBLIC_DEMO_USER_ID);
    headers.set(
      "x-abp-test-session-id",
      process.env.EXPO_PUBLIC_DEMO_SESSION_ID ?? "abp-mobile-demo",
    );
  }

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method,
      headers,
      credentials: "include",
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    });
  } catch {
    throw new ApiError(
      "تعذر الاتصال بالخادم. راجع عنوان الـ API واتصال الشبكة.",
      0,
      "NETWORK_ERROR",
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    error?: { code?: string; messageKey?: string };
    message?: string;
  } | null;
  if (!response.ok) {
    const message =
      payload?.message ??
      payload?.error?.messageKey ??
      (response.status === 401
        ? "انتهت الجلسة أو بيانات الدخول غير صحيحة."
        : `حدث خطأ من الخادم (${String(response.status)}).`);
    throw new ApiError(message, response.status, payload?.error?.code);
  }
  return payload as T;
}

async function rememberAuth(result: AuthResult) {
  if (result.csrfToken)
    await SecureStore.setItemAsync(csrfKey, result.csrfToken);
  return result;
}

export const salesApi = {
  baseUrl,
  async me() {
    return (await request<Envelope<Me>>("/me")).data;
  },
  async login(identifier: string, password: string) {
    const result = await request<Envelope<AuthResult>>("/auth/login", {
      method: "POST",
      body: { identifier, password },
    });
    return rememberAuth(result.data);
  },
  async verifyMfa(challengeToken: string, code: string) {
    const result = await request<Envelope<AuthResult>>("/auth/mfa/verify", {
      method: "POST",
      body: { challengeToken, code },
    });
    return rememberAuth(result.data);
  },
  async recoverMfa(challengeToken: string, recoveryCode: string) {
    const result = await request<Envelope<AuthResult>>("/auth/mfa/recovery", {
      method: "POST",
      body: { challengeToken, recoveryCode },
    });
    return rememberAuth(result.data);
  },
  async changePassword(currentPassword: string, newPassword: string) {
    await request("/auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  },
  async setupMfa() {
    return (
      await request<Envelope<MfaSetup>>("/auth/mfa/setup", { method: "POST" })
    ).data;
  },
  async confirmMfa(code: string) {
    return (
      await request<
        Envelope<{ enabled: boolean; recoveryCodes: readonly string[] }>
      >("/auth/mfa/confirm", { method: "POST", body: { code } })
    ).data;
  },
  async logout() {
    await request("/auth/logout", {
      method: "POST",
      body: { allSessions: false },
      idempotent: true,
    });
    await SecureStore.deleteItemAsync(csrfKey);
  },
  async actionQueue() {
    return (await request<Envelope<readonly ActionItem[]>>("/action-queue"))
      .data;
  },
  async target(year: number) {
    return (
      await request<Envelope<TargetPerformance>>(
        `/company-targets/${String(year)}/performance`,
      )
    ).data;
  },
  async accounts(search = "") {
    return request<Envelope<readonly Account[]>>("/accounts", {
      query: { search, limit: 50, offset: 0 },
    });
  },
  async account(accountId: string) {
    return (await request<Envelope<AccountDetail>>(`/accounts/${accountId}`))
      .data;
  },
  async opportunities(search = "", stageCode?: string) {
    return request<Envelope<readonly Opportunity[]>>("/opportunities", {
      query: { search, stageCode, limit: 50, offset: 0 },
    });
  },
  async opportunity(opportunityId: string) {
    return (
      await request<Envelope<OpportunityDetail>>(
        `/opportunities/${opportunityId}`,
      )
    ).data;
  },
  async activities(search = "") {
    return request<Envelope<readonly Activity[]>>("/activities", {
      query: { search, limit: 50, offset: 0, sort: "dueAt:asc" },
    });
  },
  async completeActivity(activity: Activity) {
    if (!activity.rowVersion)
      throw new Error("بيانات النسخة غير متاحة لهذه المتابعة.");
    return request(`/activities/${activity.activityId}/complete`, {
      method: "POST",
      idempotent: true,
      body: { expectedRowVersion: activity.rowVersion },
    });
  },
  async quotations(search = "") {
    return request<Envelope<readonly Quotation[]>>("/quotations", {
      query: { search, limit: 50, offset: 0 },
    });
  },
  async notifications(search = "") {
    return request<Envelope<readonly Notification[]>>("/notifications", {
      query: { search, limit: 50, offset: 0, sort: "createdAt:desc" },
    });
  },
  async markNotificationRead(notificationId: string) {
    return request(`/notifications/${notificationId}/read`, {
      method: "POST",
      idempotent: true,
    });
  },
};
