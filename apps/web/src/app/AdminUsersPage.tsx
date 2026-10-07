import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UserRecoveryPanel } from "./UserRecoveryPanel.tsx";
import { UserAccessPanel } from "./UserAccessPanel.tsx";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { listCountries } from "../api/customer-api.ts";
import {
  approveAccessRequest,
  createUser,
  listAccessRequests,
  listRoles,
  listUsers,
  rejectAccessRequest,
  type AccessRequest,
} from "../api/identity-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import {
  ErrorBanner,
  ScreenIntro,
  SlideOver,
  StatusChip,
  TabBar,
  useToast,
} from "./CommercialUI.tsx";

const tabs = [
  { id: "users", en: "Users", ar: "المستخدمون" },
  { id: "access-requests", en: "Access requests", ar: "طلبات الصلاحيات" },
];

export function AdminUsersPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("users");
  const [createOpen, setCreateOpen] = useState(false);
  const [revealedPassword, setRevealedPassword] = useState<{
    displayName: string;
    password: string;
  }>();
  const [approvingId, setApprovingId] = useState<string>();
  const [recovering, setRecovering] = useState<{
    userId: string;
    displayName: string;
    email: string;
  } | null>(null);
  const [editingAccess, setEditingAccess] = useState<{
    userId: string;
    displayName: string;
    email: string;
    authStatusCode: string;
    rowVersion: string;
  } | null>(null);
  // Both recovery endpoints require users.manage; without it the column would
  // offer a button that can only fail.
  const canManageUsers = me.access.permissions.includes("users.manage");
  // Access is a separate question from recovery, and separate permissions:
  // assigning roles and setting country scope are their own grants.
  const canSeeAccess =
    me.access.permissions.includes("roles.assign") ||
    me.access.permissions.includes("country-access.manage") ||
    canManageUsers;

  const users = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listUsers(client, { limit: 100 }),
    enabled: tab === "users",
  });
  const accessRequests = useQuery({
    queryKey: ["admin-access-requests"],
    queryFn: () => listAccessRequests(client, { limit: 100 }),
    enabled: tab === "access-requests",
  });
  const roles = useQuery({
    queryKey: ["admin-roles"],
    queryFn: () => listRoles(client),
    enabled: createOpen || approvingId !== undefined,
  });
  const countries = useQuery({
    queryKey: ["reference-countries"],
    queryFn: () => listCountries(client),
    enabled: createOpen || approvingId !== undefined,
  });

  const reject = useMutation({
    mutationFn: ({ id, rowVersion }: { id: string; rowVersion: string }) => {
      const reason =
        window.prompt(locale === "ar" ? "سبب الرفض" : "Reason for rejection") ??
        "";
      if (!reason.trim()) throw new Error("REJECT_REASON_REQUIRED");
      return rejectAccessRequest(client, id, rowVersion, reason.trim());
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: ["admin-access-requests"],
      });
      toast.success(locale === "ar" ? "تم رفض الطلب" : "Request rejected");
    },
  });

  return (
    <section className="workspace-page">
      <header className="page-heading">
        <h1>{locale === "ar" ? "المستخدمون والصلاحيات" : "Users & access"}</h1>
        <button
          type="button"
          className="button primary"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          {locale === "ar" ? "+ إضافة مستخدم" : "+ Create user"}
        </button>
      </header>
      <ScreenIntro />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />

      {tab === "users" && (
        <>
          <ErrorBanner error={users.error} retry={() => void users.refetch()} />
          <table className="data-table">
            <thead>
              <tr>
                <th>{locale === "ar" ? "الاسم" : "Name"}</th>
                <th>{locale === "ar" ? "البريد الإلكتروني" : "Email"}</th>
                <th>{locale === "ar" ? "الحالة" : "Status"}</th>
                <th>{locale === "ar" ? "آخر دخول" : "Last sign-in"}</th>
                <th>{locale === "ar" ? "إجراءات" : "Actions"}</th>
              </tr>
            </thead>
            <tbody>
              {(users.data?.data ?? []).map((u) => (
                <tr key={u.userId}>
                  <td>
                    <strong>{u.displayName}</strong>
                  </td>
                  <td>{u.email}</td>
                  <td>
                    <StatusChip code={u.authStatusCode} />
                  </td>
                  <td>
                    {u.lastSignInAt
                      ? new Date(u.lastSignInAt).toLocaleDateString(locale)
                      : "—"}
                  </td>
                  {/* Somebody locked out of their account has no other way
                      back: both recovery endpoints existed with no caller. */}
                  <td>
                    {canManageUsers && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setRecovering({
                            userId: u.userId,
                            displayName: u.displayName,
                            email: u.email,
                          });
                        }}
                      >
                        {locale === "ar" ? "استعادة" : "Recover"}
                      </button>
                    )}
                    {/* A created user with no role and no country scope can
                        sign in and see an empty application. Seven endpoints
                        for this existed with nothing calling them. */}
                    {canSeeAccess && (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => {
                          setEditingAccess({
                            userId: u.userId,
                            displayName: u.displayName,
                            email: u.email,
                            authStatusCode: u.authStatusCode,
                            rowVersion: u.rowVersion,
                          });
                        }}
                      >
                        {locale === "ar" ? "الصلاحيات" : "Access"}
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tab === "access-requests" && (
        <>
          <ErrorBanner
            error={accessRequests.error}
            retry={() => void accessRequests.refetch()}
          />
          <table className="data-table">
            <thead>
              <tr>
                <th>{locale === "ar" ? "الاسم" : "Name"}</th>
                <th>{locale === "ar" ? "البريد الإلكتروني" : "Email"}</th>
                <th>
                  {locale === "ar" ? "الشركة / الوظيفة" : "Company / role"}
                </th>
                <th>{locale === "ar" ? "الحالة" : "Status"}</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {(accessRequests.data?.data ?? []).map((request) => (
                <AccessRequestRow
                  key={request.accessRequestId}
                  request={request}
                  locale={locale}
                  isApproving={approvingId === request.accessRequestId}
                  roleOptions={roles.data?.data ?? []}
                  countryOptions={countries.data ?? []}
                  onOpenApprove={() => {
                    setApprovingId(request.accessRequestId);
                  }}
                  onCancelApprove={() => {
                    setApprovingId(undefined);
                  }}
                  onApproved={(user, tempPassword) => {
                    setApprovingId(undefined);
                    void queryClient.invalidateQueries({
                      queryKey: ["admin-access-requests"],
                    });
                    if (tempPassword) {
                      setRevealedPassword({
                        displayName: user.displayName,
                        password: tempPassword,
                      });
                    }
                  }}
                  onReject={() => {
                    reject.mutate({
                      id: request.accessRequestId,
                      rowVersion: request.rowVersion,
                    });
                  }}
                  client={client}
                />
              ))}
            </tbody>
          </table>
        </>
      )}

      {createOpen && (
        <SlideOver
          title={locale === "ar" ? "إضافة مستخدم" : "Create user"}
          onClose={() => {
            setCreateOpen(false);
          }}
        >
          <CreateUserForm
            client={client}
            locale={locale}
            roleOptions={roles.data?.data ?? []}
            countryOptions={countries.data ?? []}
            onCreated={(user, tempPassword) => {
              setCreateOpen(false);
              void queryClient.invalidateQueries({ queryKey: ["admin-users"] });
              if (tempPassword) {
                setRevealedPassword({
                  displayName: user.displayName,
                  password: tempPassword,
                });
              }
            }}
          />
        </SlideOver>
      )}

      {revealedPassword && (
        <div
          className="slideover-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label={
            locale === "ar" ? "كلمة المرور المؤقتة" : "Temporary password"
          }
        >
          <section className="local-auth-card" style={{ maxWidth: 420 }}>
            <h2>
              {locale === "ar"
                ? `كلمة المرور المؤقتة لـ ${revealedPassword.displayName}`
                : `Temporary password for ${revealedPassword.displayName}`}
            </h2>
            <p className="muted-copy">
              {locale === "ar"
                ? "انسخها الآن وشاركها مع المستخدم بأمان — لن تظهر مرة أخرى."
                : "Copy it now and share it with the user securely — it will not be shown again."}
            </p>
            <pre className="recovery-codes">{revealedPassword.password}</pre>
            <button
              className="primary auth-submit"
              type="button"
              onClick={() => {
                void navigator.clipboard.writeText(revealedPassword.password);
              }}
            >
              {locale === "ar" ? "نسخ" : "Copy"}
            </button>
            <button
              className="auth-link"
              type="button"
              onClick={() => {
                setRevealedPassword(undefined);
              }}
            >
              {locale === "ar" ? "إغلاق" : "Close"}
            </button>
          </section>
        </div>
      )}

      {editingAccess !== null && (
        <UserAccessPanel
          client={client}
          me={me}
          user={editingAccess}
          onClose={() => {
            setEditingAccess(null);
          }}
        />
      )}

      {recovering !== null && (
        <UserRecoveryPanel
          client={client}
          user={recovering}
          onClose={() => {
            setRecovering(null);
          }}
        />
      )}
    </section>
  );
}

function AccessRequestRow({
  request,
  locale,
  isApproving,
  roleOptions,
  countryOptions,
  onOpenApprove,
  onCancelApprove,
  onApproved,
  onReject,
  client,
}: {
  request: AccessRequest;
  locale: "en" | "ar";
  isApproving: boolean;
  roleOptions: readonly { roleId: string; name: string }[];
  countryOptions: readonly { countryCode: string; displayName: string }[];
  onOpenApprove: () => void;
  onCancelApprove: () => void;
  onApproved: (
    user: { displayName: string },
    tempPassword: string | null,
  ) => void;
  onReject: () => void;
  client: ApiClient;
}) {
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    if (roleIds.length === 0 || countryCodes.length === 0) return;
    setBusy(true);
    try {
      const result = await approveAccessRequest(
        client,
        request.accessRequestId,
        request.rowVersion,
        { roleIds, countryCodes, jobTitle: request.companyOrRole },
      );
      onApproved(result.user, result.tempPassword);
    } finally {
      setBusy(false);
    }
  };
  return (
    <tr>
      <td>
        <strong>{request.fullName}</strong>
      </td>
      <td>{request.workEmail}</td>
      <td>{request.companyOrRole ?? "—"}</td>
      <td>
        <StatusChip code={request.statusCode} />
      </td>
      <td>
        {request.statusCode === "PENDING" && !isApproving && (
          <>
            <button
              type="button"
              className="button secondary"
              onClick={onOpenApprove}
            >
              {locale === "ar" ? "مراجعة" : "Review"}
            </button>
            <button type="button" className="button danger" onClick={onReject}>
              {locale === "ar" ? "رفض" : "Reject"}
            </button>
          </>
        )}
        {isApproving && (
          <div className="settings-field">
            <select
              multiple
              value={roleIds}
              onChange={(event) => {
                setRoleIds(
                  Array.from(event.target.selectedOptions, (o) => o.value),
                );
              }}
            >
              {roleOptions.map((role) => (
                <option key={role.roleId} value={role.roleId}>
                  {role.name}
                </option>
              ))}
            </select>
            <select
              multiple
              value={countryCodes}
              onChange={(event) => {
                setCountryCodes(
                  Array.from(event.target.selectedOptions, (o) => o.value),
                );
              }}
            >
              {countryOptions.map((country) => (
                <option key={country.countryCode} value={country.countryCode}>
                  {country.displayName}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="button primary"
              disabled={
                busy || roleIds.length === 0 || countryCodes.length === 0
              }
              onClick={() => void approve()}
            >
              {locale === "ar" ? "تأكيد الموافقة" : "Confirm approval"}
            </button>
            <button
              type="button"
              className="button secondary"
              onClick={onCancelApprove}
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </div>
        )}
      </td>
    </tr>
  );
}

function CreateUserForm({
  client,
  locale,
  roleOptions,
  countryOptions,
  onCreated,
}: {
  client: ApiClient;
  locale: "en" | "ar";
  roleOptions: readonly { roleId: string; name: string }[];
  countryOptions: readonly { countryCode: string; displayName: string }[];
  onCreated: (
    user: { displayName: string },
    tempPassword: string | null,
  ) => void;
}) {
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  // Once the person has typed their own sign-in name, stop overwriting it from
  // the full name — the suggestion is a convenience, not a rule.
  const [usernameEdited, setUsernameEdited] = useState(false);
  const [jobTitle, setJobTitle] = useState("");
  const [roleIds, setRoleIds] = useState<string[]>([]);
  const [countryCodes, setCountryCodes] = useState<string[]>([]);
  const create = useMutation({
    mutationFn: () =>
      createUser(client, {
        email,
        displayName,
        username: username.trim() || null,
        jobTitle: jobTitle || null,
        roleIds,
        countryCodes,
      }),
    onSuccess: (result) => {
      onCreated(result.data, result.tempPassword);
    },
  });
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate();
      }}
    >
      <ErrorBanner
        error={create.error}
        retry={() => {
          create.mutate();
        }}
      />
      <label className="settings-field">
        {locale === "ar" ? "البريد الإلكتروني" : "Email"}
        <input
          type="email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
          }}
          required
        />
      </label>
      <label className="settings-field">
        {locale === "ar" ? "الاسم الكامل" : "Full name"}
        <input
          value={displayName}
          onChange={(event) => {
            setDisplayName(event.target.value);
            if (!usernameEdited)
              setUsername(suggestUsername(event.target.value));
          }}
          required
        />
      </label>
      <label className="settings-field">
        {locale === "ar" ? "اسم المستخدم" : "Username"}
        <input
          value={username}
          onChange={(event) => {
            setUsernameEdited(true);
            setUsername(event.target.value.toLowerCase());
          }}
          minLength={3}
          maxLength={50}
          pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{1,48}[a-zA-Z0-9]"
          autoComplete="off"
          spellCheck={false}
        />
        <small>
          {locale === "ar"
            ? "الاسم اللي هيسجّل بيه الدخول بدل الإيميل. سيبه فاضي لو مش محتاجه."
            : "The name they sign in with instead of their email. Leave blank to use the email only."}
        </small>
      </label>
      <label className="settings-field">
        {locale === "ar" ? "الوظيفة" : "Job title"}
        <input
          value={jobTitle}
          onChange={(event) => {
            setJobTitle(event.target.value);
          }}
        />
      </label>
      <label className="settings-field">
        {locale === "ar" ? "الأدوار" : "Roles"}
        <select
          multiple
          value={roleIds}
          onChange={(event) => {
            setRoleIds(
              Array.from(event.target.selectedOptions, (o) => o.value),
            );
          }}
          required
        >
          {roleOptions.map((role) => (
            <option key={role.roleId} value={role.roleId}>
              {role.name}
            </option>
          ))}
        </select>
      </label>
      <label className="settings-field">
        {locale === "ar" ? "نطاق الدول" : "Country access"}
        <select
          multiple
          value={countryCodes}
          onChange={(event) => {
            setCountryCodes(
              Array.from(event.target.selectedOptions, (o) => o.value),
            );
          }}
          required
        >
          {countryOptions.map((country) => (
            <option key={country.countryCode} value={country.countryCode}>
              {country.displayName}
            </option>
          ))}
        </select>
      </label>
      <button
        type="submit"
        className="primary auth-submit"
        disabled={
          create.isPending || roleIds.length === 0 || countryCodes.length === 0
        }
      >
        {create.isPending
          ? locale === "ar"
            ? "جارٍ الإنشاء…"
            : "Creating…"
          : locale === "ar"
            ? "إنشاء المستخدم"
            : "Create user"}
      </button>
    </form>
  );
}

/**
 * A first suggestion only — "Mohamed Al-Sayed" becomes "mohamed.al-sayed".
 * Non-Latin names (Arabic, for instance) produce nothing rather than a run of
 * stripped characters, so the field simply stays empty and is typed by hand.
 */
function suggestUsername(fullName: string): string {
  const parts = fullName
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .split(/\s+/)
    .map((part) => part.replace(/[^a-z0-9-]/g, ""))
    .filter(Boolean);
  const candidate = parts.join(".").replace(/^[.\-_]+|[.\-_]+$/g, "");
  return candidate.length >= 3 ? candidate.slice(0, 50) : "";
}
