import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, StatusChip, useToast } from "./CommercialUI.tsx";

/**
 * Letting a colleague in on one customer.
 *
 * All three endpoints for this existed and none were called: listing the
 * grants, creating one, and revoking one. Without them the only way to give
 * somebody access to an account was to widen their country scope — which hands
 * them every customer in the country to solve a problem about one.
 *
 * A grant is deliberately narrow in three ways at once, because "share this
 * account" means very different things: how much of it (contacts only, or the
 * commercial workspace), what they may do (look, or edit), and for how long.
 * The expiry is the one people forget, so it is offered on the form rather
 * than buried — cover for a week's leave should end when the leave does.
 */

const SCOPES = [
  {
    code: "CONTACT_ONLY",
    en: "Contacts only",
    ar: "جهات الاتصال بس",
    hintEn: "Names and numbers. Not the customer file.",
    hintAr: "أسماء وأرقام. من غير ملف العميل.",
  },
  {
    code: "CUSTOMER_CONTACTS",
    en: "Customer and contacts",
    ar: "العميل وجهات الاتصال",
    hintEn: "The customer file and the people on it.",
    hintAr: "ملف العميل والناس اللي عليه.",
  },
  {
    code: "COMMERCIAL_WORKSPACE",
    en: "Full commercial workspace",
    ar: "مساحة العمل التجارية كاملة",
    hintEn: "Projects, opportunities and quotations as well.",
    hintAr: "والمشاريع والفرص وعروض الأسعار كمان.",
  },
] as const;

const LEVELS = [
  { code: "VIEW", en: "Can view", ar: "يشوف بس" },
  { code: "COLLABORATE_EDIT", en: "Can edit", ar: "يشوف ويعدّل" },
] as const;

interface Share {
  customerShareId: string;
  recipientUserId: string;
  shareScopeCode: string;
  accessLevelCode: string;
  statusCode: string;
  expiresAt: string | null;
  rowVersion: string;
}

function toShare(row: Record<string, unknown>): Share {
  return {
    customerShareId: str(row.customerShareId),
    recipientUserId: str(row.recipientUserId),
    shareScopeCode: str(row.shareScopeCode),
    accessLevelCode: str(row.accessLevelCode),
    statusCode: str(row.statusCode),
    expiresAt: typeof row.expiresAt === "string" ? row.expiresAt : null,
    rowVersion: str(row.rowVersion),
  };
}

export function CustomerSharePanel({
  client,
  me,
  accountId,
  ownerUserId,
}: {
  client: ApiClient;
  me: Me;
  accountId: string;
  ownerUserId: string | null;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();

  // Sharing is the owner's call, not everybody's. The server enforces it too;
  // this only keeps the form off a screen where it could not succeed.
  const canShare =
    me.access.permissions.includes("accounts.share") &&
    (ownerUserId === null ||
      ownerUserId === me.user.userId ||
      me.access.roles.some((role) => role.code === "SYSTEM_ADMIN"));

  const [recipientUserId, setRecipientUserId] = useState("");
  const [scope, setScope] = useState<string>("CUSTOMER_CONTACTS");
  const [level, setLevel] = useState<string>("VIEW");
  const [expiresOn, setExpiresOn] = useState("");
  const [revoking, setRevoking] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: ["customer-shares", accountId],
    queryFn: () =>
      commercialRequest(client, "GET", "/accounts/{accountId}/shares", {
        path: { accountId },
        query: { page: 1, limit: 50 },
      }),
  });

  const people = useQuery({
    queryKey: ["people-directory"],
    queryFn: () =>
      commercialRequest(client, "GET", "/messages/directory", {
        path: {},
        query: { page: 1, limit: 100 },
      }),
    enabled: canShare,
  });

  const rows =
    isObject(shares.data?.data) && Array.isArray(shares.data.data.data)
      ? shares.data.data.data.filter(isObject).map(toShare)
      : [];
  const directory =
    isObject(people.data?.data) && Array.isArray(people.data.data.data)
      ? people.data.data.data.filter(isObject)
      : Array.isArray(people.data?.data)
        ? people.data.data.filter(isObject)
        : [];

  const nameOf = (userId: string) => {
    const person = directory.find((entry) => str(entry.userId) === userId);
    return person ? str(person.displayName) : userId;
  };

  const refresh = () =>
    cache.invalidateQueries({ queryKey: ["customer-shares", accountId] });

  const grant = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/accounts/{accountId}/shares", {
        path: { accountId },
        body: {
          recipientUserId,
          shareScopeCode: scope,
          accessLevelCode: level,
          // End of the chosen day, so "until Thursday" includes Thursday.
          ...(expiresOn === ""
            ? {}
            : { expiresAt: `${expiresOn}T23:59:59.000Z` }),
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setRecipientUserId("");
      setExpiresOn("");
      await refresh();
      toast.success(txt("Access granted", "تم منح الصلاحية"));
    },
  });

  const revoke = useMutation({
    mutationFn: (share: Share) =>
      commercialRequest(client, "DELETE", "/customer-shares/{shareId}", {
        path: { shareId: share.customerShareId },
        ifMatch: share.rowVersion,
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setRevoking(null);
      await refresh();
      toast.success(txt("Access revoked", "تم سحب الصلاحية"));
    },
  });

  const when = (iso: string | null) => {
    if (iso === null) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
    }).format(date);
  };

  const active = rows.filter((row) => row.statusCode === "ACTIVE");
  const ended = rows.filter((row) => row.statusCode !== "ACTIVE");

  return (
    <div className="customer-shares">
      <p className="settings-hint">
        {txt(
          "Give one colleague access to this customer without widening their country scope — which would hand them every customer in the country to solve a problem about one.",
          "تدّي زميل صلاحية على العميل ده من غير ما توسّع نطاق دوله — اللي هيديله كل عملاء الدولة عشان مشكلة في عميل واحد.",
        )}
      </p>

      <ErrorBanner
        error={shares.error ?? grant.error ?? revoke.error}
        retry={() => {
          grant.reset();
          revoke.reset();
          void shares.refetch();
        }}
      />

      {active.length === 0 ? (
        <p className="today-empty">
          {txt(
            "This customer is not shared with anybody.",
            "العميل ده مش متشارك مع حد.",
          )}
        </p>
      ) : (
        <ul className="share-list">
          {active.map((share) => {
            const expiry = when(share.expiresAt);
            return (
              <li key={share.customerShareId}>
                <strong>{nameOf(share.recipientUserId)}</strong>
                <StatusChip code={share.shareScopeCode} />
                <span className="share-level">
                  {LEVELS.find((l) => l.code === share.accessLevelCode)?.[
                    locale === "ar" ? "ar" : "en"
                  ] ?? share.accessLevelCode}
                </span>
                {/* An open-ended grant is the one that outlives its reason, so
                    it says so rather than leaving the column blank. */}
                <span className="share-expiry">
                  {expiry === null
                    ? txt("No end date", "من غير تاريخ انتهاء")
                    : `${txt("until", "لحد")} ${expiry}`}
                </span>
                {canShare &&
                  (revoking === share.customerShareId ? (
                    <>
                      <button
                        type="button"
                        className="danger"
                        disabled={revoke.isPending}
                        onClick={() => {
                          revoke.mutate(share);
                        }}
                      >
                        {txt("Yes, revoke", "أيوه، اسحبها")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setRevoking(null);
                        }}
                      >
                        {txt("Cancel", "إلغاء")}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setRevoking(share.customerShareId);
                      }}
                    >
                      {txt("Revoke", "سحب")}
                    </button>
                  ))}
              </li>
            );
          })}
        </ul>
      )}

      {canShare && (
        <form
          className="share-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!grant.isPending && recipientUserId !== "") grant.mutate();
          }}
        >
          <label className="settings-field">
            {txt("Colleague", "الزميل")}
            <select
              value={recipientUserId}
              onChange={(event) => {
                setRecipientUserId(event.target.value);
              }}
            >
              <option value="">
                {people.isLoading
                  ? txt("Loading…", "جارٍ التحميل…")
                  : txt("Choose a colleague", "اختر زميل")}
              </option>
              {directory
                .filter((entry) => str(entry.userId) !== me.user.userId)
                .map((entry) => (
                  <option key={str(entry.userId)} value={str(entry.userId)}>
                    {str(entry.displayName)}
                  </option>
                ))}
            </select>
          </label>

          <label className="settings-field">
            {txt("How much", "قد إيه")}
            <select
              value={scope}
              onChange={(event) => {
                setScope(event.target.value);
              }}
            >
              {SCOPES.map((option) => (
                <option key={option.code} value={option.code}>
                  {locale === "ar" ? option.ar : option.en}
                </option>
              ))}
            </select>
            <small>
              {(() => {
                const chosen = SCOPES.find((option) => option.code === scope);
                if (!chosen) return null;
                return locale === "ar" ? chosen.hintAr : chosen.hintEn;
              })()}
            </small>
          </label>

          <label className="settings-field">
            {txt("What they may do", "يعمل إيه")}
            <select
              value={level}
              onChange={(event) => {
                setLevel(event.target.value);
              }}
            >
              {LEVELS.map((option) => (
                <option key={option.code} value={option.code}>
                  {locale === "ar" ? option.ar : option.en}
                </option>
              ))}
            </select>
          </label>

          <label className="settings-field">
            {txt("Until (optional)", "لحد (اختياري)")}
            <input
              type="date"
              value={expiresOn}
              onChange={(event) => {
                setExpiresOn(event.target.value);
              }}
            />
            <small>
              {txt(
                "Cover for leave should end when the leave does.",
                "التغطية بتاعة الأجازة المفروض تنتهي بانتهائها.",
              )}
            </small>
          </label>

          <button
            type="submit"
            className="primary"
            disabled={grant.isPending || recipientUserId === ""}
          >
            {grant.isPending
              ? txt("Granting…", "بيتعمل…")
              : txt("Grant access", "امنح الصلاحية")}
          </button>
        </form>
      )}

      {ended.length > 0 && (
        <>
          <h3 className="settings-section-title">{txt("Ended", "انتهت")}</h3>
          <ul className="share-list share-list-ended">
            {ended.map((share) => (
              <li key={share.customerShareId}>
                <span>{nameOf(share.recipientUserId)}</span>
                <StatusChip code={share.statusCode} />
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
