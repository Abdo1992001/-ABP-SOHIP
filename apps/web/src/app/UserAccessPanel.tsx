import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import {
  ErrorBanner,
  SlideOver,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";

/**
 * What a user can do, and where they can do it.
 *
 * Until now the admin screen could create a user and then nothing else: no
 * role, no country scope, no way to suspend or reactivate. A created account
 * was inert — it could sign in and see an empty application, because the
 * country scope is the boundary every other screen obeys and the roles are
 * what every permission comes from.
 *
 * Seven endpoints existed for this and none were called:
 * `PUT .../roles`, `PUT .../country-access`, `POST .../activate`,
 * `POST .../suspend`, `POST .../disable`, `POST .../invite`, and
 * `PATCH /admin/users/{userId}`.
 *
 * An eighth had to be added. Both access PUTs return the user's access *after*
 * replacing it, and nothing returned it before — so an administrator setting
 * roles was overwriting a list they could not see. `GET /admin/users/{userId}`
 * now exposes the projection the service already built internally.
 */

interface UserRow {
  userId: string;
  email: string;
  displayName: string;
  authStatusCode: string;
  rowVersion: string;
}

interface Access {
  roleIds: string[];
  roleNames: string[];
  countryCodes: string[];
  permissionCount: number;
  rowVersion: string;
}

function toAccess(payload: unknown): Access | null {
  if (!isObject(payload)) return null;
  const body = isObject(payload.data) ? payload.data : payload;
  if (!Array.isArray(body.roles) || !Array.isArray(body.countryCodes))
    return null;
  const roles = body.roles.filter(isObject);
  const user = isObject(body.user) ? body.user : {};
  return {
    roleIds: roles.map((role) => str(role.roleId ?? role.id)),
    roleNames: roles.map((role) => str(role.name ?? role.code)),
    countryCodes: body.countryCodes.filter(
      (code): code is string => typeof code === "string",
    ),
    permissionCount: Array.isArray(body.permissions)
      ? body.permissions.length
      : 0,
    rowVersion: str(user.rowVersion),
  };
}

/**
 * Every change here is somebody's access, so every one of them takes a reason.
 * The endpoints require it, and they are right to: six months later the audit
 * row is the only account of why a person could or could not do something.
 */
const MIN_REASON = 4;

export function UserAccessPanel({
  client,
  me,
  user,
  onClose,
}: {
  client: ApiClient;
  me: Me;
  user: UserRow;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();

  const granted = useMemo(
    () => new Set(me.access.permissions),
    [me.access.permissions],
  );
  const canAssignRoles = granted.has("roles.assign");
  const canSetCountries = granted.has("country-access.manage");
  const canManage = granted.has("users.manage");

  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState<string | null>(null);

  const access = useQuery({
    queryKey: ["user-access", user.userId],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/admin/users/{userId}",
        { path: { userId: user.userId } },
      );
      return toAccess(result.data);
    },
  });

  const roles = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () =>
      commercialRequest(client, "GET", "/admin/roles", {
        path: {},
        query: { page: 1, limit: 100 },
      }),
    enabled: canAssignRoles,
  });

  const countries = useQuery({
    queryKey: ["reference-countries-all"],
    queryFn: () =>
      commercialRequest(client, "GET", "/reference/countries", { path: {} }),
    enabled: canSetCountries,
  });

  // Start from what they have, so a save that changes one thing does not
  // silently drop everything else.
  useEffect(() => {
    if (!access.data) return;
    setRoleIds(access.data.roleIds);
    setCountryCodes(access.data.countryCodes);
  }, [access.data]);

  const currentRowVersion = access.data?.rowVersion ?? user.rowVersion;

  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["user-access", user.userId] });
    await cache.invalidateQueries({ queryKey: ["admin-users"] });
  };

  const saveRoles = useMutation({
    mutationFn: () =>
      commercialRequest(client, "PUT", "/admin/users/{userId}/roles", {
        path: { userId: user.userId },
        body: { roleIds, reason: reason.trim() },
        ifMatch: currentRowVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setReason("");
      await refresh();
      toast.success(txt("Roles updated", "تم تحديث الأدوار"));
    },
  });

  const saveCountries = useMutation({
    mutationFn: () =>
      commercialRequest(client, "PUT", "/admin/users/{userId}/country-access", {
        path: { userId: user.userId },
        body: { countryCodes, reason: reason.trim() },
        ifMatch: currentRowVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setReason("");
      await refresh();
      toast.success(txt("Country access updated", "تم تحديث نطاق الدول"));
    },
  });

  const lifecycle = useMutation({
    mutationFn: (action: "activate" | "suspend" | "disable") =>
      commercialRequest(client, "POST", `/admin/users/{userId}/${action}`, {
        path: { userId: user.userId },
        body: {
          expectedRowVersion: currentRowVersion,
          reason: reason.trim(),
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setConfirming(null);
      setReason("");
      await refresh();
      toast.success(txt("Account updated", "تم تحديث الحساب"));
    },
  });

  const roleRows =
    isObject(roles.data?.data) && Array.isArray(roles.data.data.data)
      ? roles.data.data.data.filter(isObject)
      : [];
  const countryRows = Array.isArray(countries.data?.data)
    ? countries.data.data.filter(isObject)
    : isObject(countries.data?.data) && Array.isArray(countries.data.data.data)
      ? countries.data.data.data.filter(isObject)
      : [];

  const reasonOk = reason.trim().length >= MIN_REASON;
  const rolesChanged =
    access.data !== null &&
    access.data !== undefined &&
    JSON.stringify([...roleIds].sort()) !==
      JSON.stringify([...access.data.roleIds].sort());
  const countriesChanged =
    access.data !== null &&
    access.data !== undefined &&
    JSON.stringify([...countryCodes].sort()) !==
      JSON.stringify([...access.data.countryCodes].sort());

  const toggle = (list: string[], value: string) =>
    list.includes(value)
      ? list.filter((item) => item !== value)
      : [...list, value];

  return (
    <SlideOver title={txt("Access", "الصلاحيات")} onClose={onClose}>
      <p className="settings-hint">
        <strong>{user.displayName}</strong> · {user.email}{" "}
        <StatusChip code={user.authStatusCode} />
      </p>

      <ErrorBanner
        error={
          access.error ??
          saveRoles.error ??
          saveCountries.error ??
          lifecycle.error
        }
        retry={() => {
          saveRoles.reset();
          saveCountries.reset();
          lifecycle.reset();
          void access.refetch();
        }}
      />

      {access.data !== null && access.data !== undefined && (
        <p className="settings-hint">
          {txt(
            `Currently ${String(access.data.permissionCount)} permissions, from ${
              access.data.roleNames.length === 0
                ? "no role"
                : access.data.roleNames.join(", ")
            }.`,
            `عنده دلوقتي ${String(access.data.permissionCount)} صلاحية، من ${
              access.data.roleNames.length === 0
                ? "غير دور"
                : access.data.roleNames.join("، ")
            }.`,
          )}
        </p>
      )}

      {/* One reason box for the panel: every endpoint here demands one, and
          three separate boxes would be three chances to write "update". */}
      <label className="settings-field">
        {txt("Reason for this change", "سبب التغيير")}
        <input
          value={reason}
          onChange={(event) => {
            setReason(event.target.value);
          }}
        />
        <small>
          {txt(
            "Written to the audit trail. In six months this is the only account of why.",
            "بيتكتب في سجل التدقيق. بعد ٦ شهور ده هيكون التفسير الوحيد للي حصل.",
          )}
        </small>
      </label>

      {canAssignRoles && (
        <>
          <h3>{txt("Roles", "الأدوار")}</h3>
          <p className="settings-hint">
            {txt(
              "Every permission a person has comes from a role. A user with none can sign in and do nothing.",
              "كل صلاحية عند الشخص جاية من دور. اللي معندوش دور بيدخل ومش هيقدر يعمل حاجة.",
            )}
          </p>
          <div className="access-options">
            {roleRows.map((role) => {
              const id = str(role.roleId ?? role.id);
              return (
                <label key={id} className="access-option">
                  <input
                    type="checkbox"
                    checked={roleIds.includes(id)}
                    onChange={() => {
                      setRoleIds((current) => toggle(current, id));
                    }}
                  />
                  <span>{str(role.name ?? role.code)}</span>
                </label>
              );
            })}
          </div>
          <button
            type="button"
            className="primary"
            disabled={saveRoles.isPending || !rolesChanged || !reasonOk}
            onClick={() => {
              saveRoles.mutate();
            }}
          >
            {saveRoles.isPending
              ? txt("Saving…", "بيحفظ…")
              : txt("Save roles", "حفظ الأدوار")}
          </button>
        </>
      )}

      {canSetCountries && (
        <>
          <h3>{txt("Countries they can see", "الدول اللي بيشوفها")}</h3>
          <p className="settings-hint">
            {txt(
              "Enforced on the server for every request — this is not a filter on the screen.",
              "بيتطبّق في السيرفر على كل طلب — مش مجرد فلتر في الشاشة.",
            )}
          </p>
          <div className="access-options">
            {countryRows.map((country) => {
              const code = str(country.countryCode ?? country.code);
              return (
                <label key={code} className="access-option">
                  <input
                    type="checkbox"
                    checked={countryCodes.includes(code)}
                    onChange={() => {
                      setCountryCodes((current) => toggle(current, code));
                    }}
                  />
                  <span>
                    {str(country.displayName ?? country.name)}{" "}
                    <small data-abp-num>{code}</small>
                  </span>
                </label>
              );
            })}
          </div>
          {countryCodes.length === 0 && (
            <p className="settings-hint">
              {txt(
                "With no country selected they will see no customers at all.",
                "من غير أي دولة مختارة مش هيشوف ولا عميل.",
              )}
            </p>
          )}
          <button
            type="button"
            className="primary"
            disabled={saveCountries.isPending || !countriesChanged || !reasonOk}
            onClick={() => {
              saveCountries.mutate();
            }}
          >
            {saveCountries.isPending
              ? txt("Saving…", "بيحفظ…")
              : txt("Save countries", "حفظ الدول")}
          </button>
        </>
      )}

      {canManage && (
        <>
          <h3>{txt("Account", "الحساب")}</h3>
          <div className="approval-actions">
            {(
              [
                {
                  action: "activate" as const,
                  en: "Activate",
                  ar: "تفعيل",
                  tone: "secondary",
                  when: user.authStatusCode !== "ACTIVE",
                },
                {
                  action: "suspend" as const,
                  en: "Suspend",
                  ar: "إيقاف مؤقت",
                  tone: "secondary",
                  when: user.authStatusCode === "ACTIVE",
                },
                {
                  action: "disable" as const,
                  en: "Disable",
                  ar: "تعطيل",
                  tone: "danger",
                  when: user.authStatusCode !== "DISABLED",
                },
              ] as const
            )
              .filter((option) => option.when)
              .map((option) =>
                confirming === option.action ? (
                  <button
                    key={option.action}
                    type="button"
                    className="danger"
                    disabled={lifecycle.isPending || !reasonOk}
                    onClick={() => {
                      lifecycle.mutate(option.action);
                    }}
                  >
                    {txt("Confirm", "تأكيد")}{" "}
                    {locale === "ar" ? option.ar : option.en}
                  </button>
                ) : (
                  <button
                    key={option.action}
                    type="button"
                    className={option.tone}
                    disabled={!reasonOk}
                    onClick={() => {
                      setConfirming(option.action);
                    }}
                  >
                    {locale === "ar" ? option.ar : option.en}
                  </button>
                ),
              )}
          </div>
          {!reasonOk && (
            <p className="settings-hint">
              {txt(
                "Give a reason first — none of these are allowed without one.",
                "اكتب السبب الأول — مفيش حاجة فيهم بتتعمل من غيره.",
              )}
            </p>
          )}
        </>
      )}
    </SlideOver>
  );
}
