import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  useToast,
} from "./CommercialUI.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { UserAvatar } from "./UserAvatar.tsx";
import { StatusChip } from "./CommercialUI.tsx";
import type { ThemePreference } from "./theme.ts";

/**
 * Settings — the preferences a person owns.
 *
 * Identity (photo, name, phone) is not here: it lives on My profile, because
 * a field that can be edited in two places is a field that will one day show
 * two different answers. What is here is everything that changes how ABP
 * behaves for this one person, grouped the way people look for it rather than
 * the way the API happens to be organised.
 */

/**
 * The navigation. Groups, not a tab strip: five flat tabs across the top stop
 * being scannable at the width a laptop actually has, and they give no room
 * for the one line of description that stops people opening the wrong one.
 */
const SECTION_GROUPS: readonly {
  id: string;
  en: string;
  ar: string;
  items: readonly {
    id: string;
    en: string;
    ar: string;
    subEn: string;
    subAr: string;
  }[];
}[] = [
  {
    id: "account",
    en: "Account",
    ar: "الحساب",
    items: [
      {
        id: "privacy",
        en: "Privacy & visibility",
        ar: "الخصوصية والظهور",
        subEn: "What colleagues can see",
        subAr: "زمايلك بيشوفوا إيه",
      },
    ],
  },
  {
    id: "workspace",
    en: "Workspace",
    ar: "مساحة العمل",
    items: [
      {
        id: "display",
        en: "Appearance & language",
        ar: "المظهر واللغة",
        subEn: "Theme, light or dark, Arabic or English",
        subAr: "الثيم، فاتح أو داكن، عربي أو إنجليزي",
      },
      {
        id: "notifications",
        en: "Notifications",
        ar: "الإشعارات",
        subEn: "What reaches you",
        subAr: "إيه اللي يوصلك",
      },
    ],
  },
  {
    id: "security",
    en: "Security",
    ar: "الأمان",
    items: [
      {
        id: "security",
        en: "Password & sessions",
        ar: "كلمة المرور والجلسات",
        subEn: "Sign-in and devices",
        subAr: "الدخول والأجهزة",
      },
    ],
  },
];

const SECTION_IDS = SECTION_GROUPS.flatMap((group) =>
  group.items.map((item) => item.id),
);

const THEME_CHOICES: readonly {
  id: ThemePreference;
  en: string;
  ar: string;
}[] = [
  { id: "light", en: "Light", ar: "فاتح" },
  { id: "dark", en: "Dark", ar: "داكن" },
  { id: "system", en: "System", ar: "تبع النظام" },
];
/** What the server actually emits, so no switch here is decorative. */
const NOTIFICATION_CATEGORIES: readonly {
  code: string;
  en: string;
  ar: string;
}[] = [
  { code: "QUOTATION_ACCEPTED", en: "Quotation accepted", ar: "قبول عرض سعر" },
  { code: "SHIPMENT_UPDATE", en: "Shipment updates", ar: "تحديثات الشحن" },
  { code: "OVERDUE_TASK", en: "Overdue follow-ups", ar: "متابعات متأخرة" },
  { code: "AI_INSIGHT", en: "Commercial insights", ar: "ملاحظات تجارية" },
  {
    code: "REPEAT_BUSINESS_REQUEST",
    en: "Repeat business requests",
    ar: "طلبات أعمال متكررة",
  },
  {
    code: "CUSTOMER_FEEDBACK",
    en: "Customer feedback",
    ar: "آراء العملاء",
  },
  { code: "PAYMENT_OVERDUE", en: "Overdue payments", ar: "أقساط متأخرة" },
  {
    code: "PRODUCTION_AT_RISK",
    en: "Production at risk",
    ar: "إنتاج ممكن يتأخر",
  },
  { code: "DELIVERY_LATE", en: "Late deliveries", ar: "تسليمات متأخرة" },
  {
    code: "FEEDBACK_REQUEST",
    en: "Reminders to ask for feedback",
    ar: "تذكير بطلب رأي العميل",
  },
  {
    code: "QUOTATION_EXPIRING",
    en: "Quotations about to expire",
    ar: "عروض أسعار قربت تنتهي",
  },
];
export function SettingsPage({
  client,
  me,
  theme,
  setTheme,
}: {
  client: ApiClient;
  me: Me;
  theme: ThemePreference;
  setTheme: (value: ThemePreference) => void;
}) {
  const { locale, toggle } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  /** The open section lives in the URL, so a link can point at one and the
      back button walks between them. */
  const [params, setParams] = useSearchParams();
  const requested = params.get("section");
  const tab =
    requested !== null && SECTION_IDS.includes(requested)
      ? requested
      : "privacy";
  const setTab = (next: string) => {
    setParams(
      (current) => {
        const copy = new URLSearchParams(current);
        copy.set("section", next);
        return copy;
      },
      { replace: true },
    );
  };
  const [confirm, setConfirm] = useState(false);
  const toast = useToast();
  const cache = useQueryClient();
  const profile = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => commercialRequest(client, "GET", "/me/profile"),
  });
  const profileData =
    isObject(profile.data?.data) && isObject(profile.data.data.data)
      ? profile.data.data.data
      : {};
  const photoUpdatedAt =
    typeof profileData.photoUpdatedAt === "string"
      ? profileData.photoUpdatedAt
      : null;
  const savedName = (() => {
    const value = str(profileData.displayName);
    return value === "—" ? me.user.displayName : value;
  })();
  const savedPhone =
    typeof profileData.phone === "string" ? profileData.phone : "";

  /** Every profile change re-reads `me` too, so the header avatar and name
      follow immediately rather than after a reload. */
  const afterProfileChange = async () => {
    await profile.refetch();
    await cache.invalidateQueries({ queryKey: ["me"] });
  };

  const visibility = {
    photoVisible: profileData.photoVisible !== false,
    phoneVisible: profileData.phoneVisible !== false,
  };

  /** A switch saves the moment it moves: there is nothing to review, and a
      Save button next to a toggle only invites people to forget it. */
  const saveVisibility = useMutation({
    mutationFn: (patch: Record<string, boolean>) =>
      commercialRequest(client, "PATCH", "/me/profile", {
        path: {},
        body: patch,
      }),
    onSuccess: afterProfileChange,
  });

  /**
   * Two-step verification, for real.
   *
   * This section used to show a status chip and a sentence, on the belief that
   * enrolment was not implemented server-side. It is: /auth/mfa/setup returns a
   * provisioning URI and a QR code, /auth/mfa/confirm verifies a TOTP code and
   * hands back ten recovery codes, /auth/mfa/disable turns it off again. The
   * secret is encrypted at rest and every step is audited. A read-only chip in
   * front of all that was the fiction, not the flow.
   */
  const [mfaSetup, setMfaSetup] = useState<{
    qrCodeDataUrl: string;
    manualSecret: string;
  } | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [disarming, setDisarming] = useState(false);
  const digitsOnly = (raw: string) => raw.replace(/[^0-9]/g, "");

  const startMfa = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/auth/mfa/setup", { path: {} }),
    onSuccess: (result) => {
      const payload =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : {};
      setMfaSetup({
        qrCodeDataUrl: str(payload.qrCodeDataUrl),
        manualSecret: str(payload.manualSecret),
      });
      setMfaCode("");
    },
  });

  const confirmMfa = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/auth/mfa/confirm", {
        path: {},
        body: { code: mfaCode },
      }),
    onSuccess: async (result) => {
      const payload =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : {};
      // Shown once, and only once: the server keeps hashes, not the codes.
      setRecoveryCodes(
        Array.isArray(payload.recoveryCodes)
          ? payload.recoveryCodes.map((code) => str(code))
          : [],
      );
      setMfaSetup(null);
      setMfaCode("");
      await cache.invalidateQueries({ queryKey: ["me"] });
      toast.success(
        txt("Two-step verification is on", "تم تفعيل التحقق بخطوتين"),
      );
    },
  });

  const disableMfa = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/auth/mfa/disable", {
        path: {},
        body: { code: mfaCode },
      }),
    onSuccess: async () => {
      setDisarming(false);
      setMfaCode("");
      await cache.invalidateQueries({ queryKey: ["me"] });
      toast.success(
        txt("Two-step verification is off", "تم إيقاف التحقق بخطوتين"),
      );
    },
  });

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const changePassword = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/auth/change-password", {
        path: {},
        body: { currentPassword, newPassword },
      }),
    onSuccess: () => {
      setCurrentPassword("");
      setNewPassword("");
      toast.success(txt("Password changed", "تم تغيير كلمة المرور"));
    },
  });

  const query = useQuery({
    queryKey: ["preferences"],
    queryFn: () => commercialRequest(client, "GET", "/preferences"),
  });
  const envelope =
    isObject(query.data?.data) && isObject(query.data.data.data)
      ? query.data.data.data
      : {};
  const preferences = isObject(envelope.preferencesJsonb)
    ? envelope.preferencesJsonb
    : {};
  /** Categories a person may silence, matching what the server emits. */
  const muted = Array.isArray(preferences.mutedNotifications)
    ? preferences.mutedNotifications.filter(
        (code): code is string => typeof code === "string",
      )
    : [];
  // Email: on unless turned off, in the language chosen for it.
  const byEmail = preferences.emailNotifications !== false;
  const emailLanguage = preferences.language === "ar" ? "ar" : "en";
  const savePreferences = useMutation({
    mutationFn: (patch: Record<string, unknown>) =>
      commercialRequest(client, "PATCH", "/preferences", {
        path: {},
        body: { preferences: { ...preferences, ...patch } },
        ifMatch: query.data?.etag ?? `"rv-${String(envelope.rowVersion)}"`,
      }),
    onSuccess: () => {
      void query.refetch();
      toast.success(txt("Saved", "تم الحفظ"));
    },
  });
  const saveMuted = useMutation({
    mutationFn: (next: string[]) =>
      commercialRequest(client, "PATCH", "/preferences", {
        path: {},
        body: { preferences: { ...preferences, mutedNotifications: next } },
        ifMatch: query.data?.etag ?? `"rv-${String(envelope.rowVersion)}"`,
      }),
    onSuccess: () => {
      void query.refetch();
      toast.success(txt("Saved", "تم الحفظ"));
    },
  });

  const revoke = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "POST",
        "/admin/users/{userId}/revoke-sessions",
        {
          path: { userId: me.user.userId },
          body: { reason: "User requested session revocation" },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: () => {
      setConfirm(false);
      toast.success(txt("Sessions revoked", "تم إنهاء الجلسات"));
    },
  });

  const activeLabel = SECTION_GROUPS.flatMap((group) => group.items).find(
    (item) => item.id === tab,
  );

  return (
    <section className="workspace-page settings-page">
      <PageHeader
        kicker={txt("Settings", "الإعدادات")}
        title={txt("Settings & preferences", "الإعدادات والتفضيلات")}
        sub={txt(
          "How ABP behaves for you. Your photo, name and phone are on My profile.",
          "ABP بيشتغل معاك إزاي. الصورة والاسم والرقم في ملفك الشخصي.",
        )}
      />

      <div className="settings-shell">
        <nav
          className="settings-sidebar"
          aria-label={txt("Settings sections", "أقسام الإعدادات")}
        >
          {/* Identity is one click away rather than duplicated here: it is a
              different kind of thing from a preference, and it has its own
              page. */}
          <Link className="settings-sidebar-me" to="/profile">
            <UserAvatar
              userId={me.user.userId}
              displayName={savedName}
              photoUpdatedAt={photoUpdatedAt}
              size="md"
            />
            <span>
              <strong>{savedName}</strong>
              <small>{txt("My profile", "ملفي الشخصي")}</small>
            </span>
          </Link>

          {SECTION_GROUPS.map((group) => (
            <div className="settings-sidebar-group" key={group.id}>
              <h2>{locale === "ar" ? group.ar : group.en}</h2>
              <ul>
                {group.items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      aria-current={tab === item.id ? "page" : undefined}
                      className={tab === item.id ? "is-active" : ""}
                      onClick={() => {
                        setTab(item.id);
                      }}
                    >
                      <strong>{locale === "ar" ? item.ar : item.en}</strong>
                      <small>{locale === "ar" ? item.subAr : item.subEn}</small>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>

        <div className="settings-content" role="region" aria-live="polite">
          <h2 className="settings-section-title">
            {activeLabel
              ? locale === "ar"
                ? activeLabel.ar
                : activeLabel.en
              : ""}
          </h2>
          <ErrorBanner error={query.error} retry={() => void query.refetch()} />
          <ErrorBanner
            error={profile.error}
            retry={() => void profile.refetch()}
          />
          {tab === "display" && (
            <>
              <h3>{txt("Language", "اللغة")}</h3>
              <div className="settings-toggle-row">
                {["en", "ar"].map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={locale === value}
                    className={`settings-option ${locale === value ? "active" : ""}`}
                    onClick={() => {
                      if (locale !== value) toggle();
                    }}
                  >
                    {value === "ar" ? "العربية" : "English"}
                  </button>
                ))}
              </div>
              <h3>{txt("Theme", "المظهر")}</h3>
              <div className="settings-toggle-row">
                {THEME_CHOICES.map((choice) => (
                  <button
                    key={choice.id}
                    type="button"
                    aria-pressed={theme === choice.id}
                    className={`settings-option ${theme === choice.id ? "active" : ""}`}
                    onClick={() => {
                      setTheme(choice.id);
                    }}
                  >
                    {locale === "ar" ? choice.ar : choice.en}
                  </button>
                ))}
              </div>
              <p className="settings-hint">
                {txt(
                  "System follows your device setting and changes with it.",
                  "«تبع النظام» يتبع إعداد جهازك ويتغيّر معه.",
                )}
              </p>
            </>
          )}
          {tab === "privacy" && (
            <>
              <p className="settings-hint">
                {txt(
                  "Choose what colleagues can see. Only optional details have a switch.",
                  "اختار إيه اللي زمايلك يشوفوه. الحاجات الاختيارية بس هي اللي ليها مفتاح.",
                )}
              </p>

              <ul className="visibility-list">
                {[
                  {
                    key: "photoVisible" as const,
                    en: "Profile photo",
                    ar: "الصورة الشخصية",
                  },
                  {
                    key: "phoneVisible" as const,
                    en: "Phone number",
                    ar: "رقم الهاتف",
                  },
                ].map((field) => (
                  <li key={field.key}>
                    <span>{locale === "ar" ? field.ar : field.en}</span>
                    <label className="visibility-switch">
                      <input
                        type="checkbox"
                        checked={visibility[field.key]}
                        onChange={(event) => {
                          saveVisibility.mutate({
                            [field.key]: event.target.checked,
                          });
                        }}
                      />
                      <span>
                        {visibility[field.key]
                          ? txt("Visible to everyone", "ظاهر للجميع")
                          : txt("Hidden", "مخفي")}
                      </span>
                    </label>
                  </li>
                ))}

                {/* Shown as fixed rows, not disabled switches: a control you
                    cannot move is worse than an explanation of why. */}
                {[
                  { en: "Name", ar: "الاسم" },
                  { en: "Role", ar: "الدور" },
                  { en: "Email", ar: "البريد" },
                ].map((field) => (
                  <li key={field.en} className="is-required">
                    <span>{locale === "ar" ? field.ar : field.en}</span>
                    <span className="visibility-fixed">
                      {txt(
                        "Always visible — required for ABP to work",
                        "ظاهر دائمًا — مطلوب لعمل ABP",
                      )}
                    </span>
                  </li>
                ))}
              </ul>
              <ErrorBanner
                error={saveVisibility.error}
                retry={() => {
                  void profile.refetch();
                }}
              />

              {/* The preview is the point: a toggle whose effect you cannot see
                  is a toggle people get wrong. */}
              <h3>
                {txt("This is how colleagues see you", "كده زمايلك بيشوفوك")}
              </h3>
              <div className="profile-preview">
                <UserAvatar
                  userId={me.user.userId}
                  displayName={savedName}
                  photoUpdatedAt={
                    visibility.photoVisible ? photoUpdatedAt : null
                  }
                  size="lg"
                />
                <div>
                  <strong>{savedName}</strong>
                  <span>
                    {me.access.roles.map((role) => role.name).join(" · ")}
                  </span>
                  <span>{me.user.email}</span>
                  {visibility.phoneVisible && savedPhone.trim() ? (
                    <span>{savedPhone}</span>
                  ) : null}
                </div>
              </div>
              <p className="settings-hint">
                {txt(
                  "Your photo and phone are edited on ",
                  "الصورة والرقم بتتعدلوا في ",
                )}
                <Link to="/profile">{txt("My profile", "ملفي الشخصي")}</Link>.
              </p>
            </>
          )}
          {tab === "notifications" && (
            <>
              <p className="settings-hint">
                {txt(
                  "Choose what reaches you. Changes save immediately.",
                  "اختار توصلك إشعارات إيه. التغيير بيتحفظ فورًا.",
                )}
              </p>
              <ul className="visibility-list">
                <li>
                  <span>
                    {txt(
                      "Also send them to my email",
                      "ابعتهالي على الإيميل كمان",
                    )}
                    <small className="settings-hint">
                      {txt(
                        "New notifications are gathered into one email, about a minute after they arrive.",
                        "الإشعارات الجديدة بتتجمع في إيميل واحد بعد حوالي دقيقة.",
                      )}
                    </small>
                  </span>
                  <label className="visibility-switch">
                    <input
                      type="checkbox"
                      checked={byEmail}
                      disabled={savePreferences.isPending}
                      onChange={(event) => {
                        savePreferences.mutate({
                          emailNotifications: event.target.checked,
                        });
                      }}
                    />
                    <span>
                      {byEmail ? txt("On", "شغال") : txt("Off", "مقفول")}
                    </span>
                  </label>
                </li>
                <li>
                  <span>{txt("Email language", "لغة الإيميل")}</span>
                  <select
                    value={emailLanguage}
                    disabled={savePreferences.isPending}
                    onChange={(event) => {
                      savePreferences.mutate({ language: event.target.value });
                    }}
                  >
                    <option value="en">English</option>
                    <option value="ar">العربية</option>
                  </select>
                </li>
              </ul>
              <ul className="visibility-list">
                {NOTIFICATION_CATEGORIES.map((category) => (
                  <li key={category.code}>
                    <span>{locale === "ar" ? category.ar : category.en}</span>
                    <label className="visibility-switch">
                      <input
                        type="checkbox"
                        checked={!muted.includes(category.code)}
                        onChange={(event) => {
                          saveMuted.mutate(
                            event.target.checked
                              ? muted.filter((code) => code !== category.code)
                              : [...muted, category.code],
                          );
                        }}
                      />
                      <span>
                        {muted.includes(category.code)
                          ? txt("Muted", "مكتوم")
                          : txt("On", "يوصلني")}
                      </span>
                    </label>
                  </li>
                ))}
                {/* Always on, shown as a row rather than a switch that would do
                    nothing: an approval request is somebody waiting on you, and
                    silencing it does not make the decision go away. */}
                <li className="is-required">
                  <span>{txt("Approval requests", "طلبات الموافقة")}</span>
                  <span className="visibility-fixed">
                    {txt(
                      "Always on — someone is waiting on your decision",
                      "دائمًا — حد مستنيك تقرر",
                    )}
                  </span>
                </li>
              </ul>
              <ErrorBanner
                error={saveMuted.error}
                retry={() => {
                  void query.refetch();
                }}
              />
              <p className="settings-hint">
                {txt(
                  "This system sends no email, so there is no switch for it.",
                  "مفيش إشعارات بريد في النظام ده، فمفيش مفتاح ليها.",
                )}
              </p>
            </>
          )}
          {tab === "security" && (
            <>
              <h3>{txt("Password", "كلمة المرور")}</h3>
              <form
                className="security-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  changePassword.mutate();
                }}
              >
                <label className="settings-field">
                  {txt("Current password", "كلمة المرور الحالية")}
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(event) => {
                      setCurrentPassword(event.target.value);
                    }}
                  />
                </label>
                <label className="settings-field">
                  {txt("New password", "كلمة المرور الجديدة")}
                  <input
                    type="password"
                    autoComplete="new-password"
                    minLength={12}
                    value={newPassword}
                    onChange={(event) => {
                      setNewPassword(event.target.value);
                    }}
                  />
                  <small>
                    {txt(
                      "At least 12 characters. Changing it signs out your other sessions.",
                      "١٢ حرف على الأقل. تغييرها بينهي جلساتك التانية.",
                    )}
                  </small>
                </label>
                <ErrorBanner
                  error={changePassword.error}
                  retry={() => {
                    changePassword.mutate();
                  }}
                />
                <button
                  className="primary"
                  disabled={
                    changePassword.isPending ||
                    currentPassword.length === 0 ||
                    newPassword.length < 12
                  }
                >
                  {changePassword.isPending
                    ? txt("Changing…", "جارٍ التغيير…")
                    : txt("Change password", "تغيير كلمة المرور")}
                </button>
              </form>

              <h3>{txt("Two-step verification", "التحقق بخطوتين")}</h3>
              <p className="settings-hint">
                {me.user.mfaEnabled
                  ? txt(
                      "On. You are asked for a code from your authenticator app when you sign in.",
                      "مفعّل. بيتطلب منك كود من تطبيق المصادقة وقت الدخول.",
                    )
                  : me.user.mfaRequired
                    ? txt(
                        "Required for your account and not yet set up.",
                        "مطلوب لحسابك ولسه متفعّلش.",
                      )
                    : txt(
                        "Off. A code from your phone, on top of your password.",
                        "غير مفعّل. كود من تليفونك بالإضافة لكلمة المرور.",
                      )}
              </p>
              <StatusChip
                code={
                  me.user.mfaEnabled
                    ? "ENABLED"
                    : me.user.mfaRequired
                      ? "REQUIRED"
                      : "DISABLED"
                }
              />

              {/* Ten codes, shown exactly once: the server stores only their
                  hashes, so no screen can ever show them again. */}
              {recoveryCodes !== null && (
                <div className="mfa-recovery">
                  <h4>
                    {txt("Save your recovery codes", "احفظ أكواد الاسترجاع")}
                  </h4>
                  <p>
                    {txt(
                      "Each one works once, if you lose your phone. They are not shown again.",
                      "كل كود بيشتغل مرة واحدة لو ضاع منك التليفون. مش هتظهر تاني.",
                    )}
                  </p>
                  <ul>
                    {recoveryCodes.map((code) => (
                      <li key={code}>{code}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setRecoveryCodes(null);
                    }}
                  >
                    {txt("I have saved them", "حفظتهم")}
                  </button>
                </div>
              )}

              {!me.user.mfaEnabled &&
                mfaSetup === null &&
                recoveryCodes === null && (
                  <>
                    <ErrorBanner
                      error={startMfa.error}
                      retry={() => {
                        startMfa.mutate();
                      }}
                    />
                    <button
                      type="button"
                      className="primary"
                      disabled={startMfa.isPending}
                      onClick={() => {
                        startMfa.mutate();
                      }}
                    >
                      {startMfa.isPending
                        ? txt("Preparing…", "جارٍ التحضير…")
                        : txt(
                            "Set up two-step verification",
                            "فعّل التحقق بخطوتين",
                          )}
                    </button>
                  </>
                )}

              {mfaSetup !== null && (
                <div className="mfa-enrol">
                  <ol>
                    <li>
                      {txt(
                        "Scan this with your authenticator app.",
                        "امسح الكود ده بتطبيق المصادقة.",
                      )}
                    </li>
                    <li>
                      {txt(
                        "Type the six digits it shows.",
                        "اكتب الستة أرقام اللي هيظهروا.",
                      )}
                    </li>
                  </ol>
                  <img
                    className="mfa-qr"
                    src={mfaSetup.qrCodeDataUrl}
                    alt={txt(
                      "Two-step verification QR code",
                      "كود QR للتحقق بخطوتين",
                    )}
                    width={168}
                    height={168}
                  />
                  <p className="settings-hint">
                    {txt(
                      "Cannot scan? Enter this key:",
                      "مش قادر تمسح؟ اكتب المفتاح ده:",
                    )}{" "}
                    <code>{mfaSetup.manualSecret}</code>
                  </p>
                  <label className="settings-field">
                    {txt("Six-digit code", "الكود المكوّن من ٦ أرقام")}
                    <input
                      inputMode="numeric"
                      autoComplete="one-time-code"
                      maxLength={6}
                      value={mfaCode}
                      onChange={(event) => {
                        setMfaCode(digitsOnly(event.target.value));
                      }}
                    />
                  </label>
                  <ErrorBanner
                    error={confirmMfa.error}
                    retry={() => {
                      confirmMfa.mutate();
                    }}
                  />
                  <div className="profile-save-row">
                    <button
                      type="button"
                      className="primary"
                      disabled={mfaCode.length !== 6 || confirmMfa.isPending}
                      onClick={() => {
                        confirmMfa.mutate();
                      }}
                    >
                      {txt("Turn on", "تفعيل")}
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      onClick={() => {
                        setMfaSetup(null);
                        setMfaCode("");
                      }}
                    >
                      {txt("Cancel", "إلغاء")}
                    </button>
                  </div>
                </div>
              )}

              {me.user.mfaEnabled &&
                !me.user.mfaRequired &&
                (disarming ? (
                  <div className="mfa-enrol">
                    <label className="settings-field">
                      {txt(
                        "Enter a current code to turn it off",
                        "اكتب كود حالي عشان توقفه",
                      )}
                      <input
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        value={mfaCode}
                        onChange={(event) => {
                          setMfaCode(digitsOnly(event.target.value));
                        }}
                      />
                    </label>
                    <ErrorBanner
                      error={disableMfa.error}
                      retry={() => {
                        disableMfa.mutate();
                      }}
                    />
                    <div className="profile-save-row">
                      <button
                        type="button"
                        className="danger"
                        disabled={mfaCode.length !== 6 || disableMfa.isPending}
                        onClick={() => {
                          disableMfa.mutate();
                        }}
                      >
                        {txt("Turn off", "إيقاف")}
                      </button>
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setDisarming(false);
                          setMfaCode("");
                        }}
                      >
                        {txt("Cancel", "إلغاء")}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="ghost-button"
                    onClick={() => {
                      setDisarming(true);
                      setMfaCode("");
                    }}
                  >
                    {txt(
                      "Turn off two-step verification",
                      "إيقاف التحقق بخطوتين",
                    )}
                  </button>
                ))}
              {me.user.mfaEnabled && me.user.mfaRequired && (
                <p className="settings-hint">
                  {txt(
                    "Your account requires it, so it cannot be turned off here.",
                    "حسابك مطلوب له التحقق، فمينفعش يتوقف من هنا.",
                  )}
                </p>
              )}

              <h3>{txt("Sessions", "الجلسات")}</h3>
              {/* Deliberately not a session list: the API has no endpoint that
                  enumerates a user's sessions, and a list assembled from
                  guesses would be worse than none. Ending them all is a real
                  operation, so that is what is offered. */}
              <p className="settings-hint">
                {txt(
                  "You can end every session on all your devices. There is no per-session list because the server does not expose one.",
                  "تقدر تنهي كل جلساتك على كل الأجهزة. مفيش قائمة بالجلسات لأن الخادم ما بيوفرهاش.",
                )}
              </p>
              {me.access.permissions.includes("sessions.revoke") && (
                <button
                  type="button"
                  className="danger"
                  onClick={() => {
                    setConfirm(true);
                  }}
                >
                  {txt("Sign out everywhere", "إنهاء جميع الجلسات")}
                </button>
              )}
            </>
          )}
        </div>
      </div>
      {confirm && (
        <SlideOver
          title={txt("Confirm session revocation", "تأكيد إنهاء الجلسات")}
          onClose={() => {
            setConfirm(false);
          }}
        >
          <p>
            {txt(
              "All devices will need to sign in again.",
              "سيُطلب تسجيل الدخول مجدداً على جميع الأجهزة.",
            )}
          </p>
          <ErrorBanner
            error={revoke.error}
            retry={() => {
              revoke.mutate();
            }}
          />
          <button
            type="button"
            className="danger"
            disabled={revoke.isPending}
            onClick={() => {
              revoke.mutate();
            }}
          >
            {txt("Confirm", "تأكيد")}
          </button>
        </SlideOver>
      )}
    </section>
  );
}
