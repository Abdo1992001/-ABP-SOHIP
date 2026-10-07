import { useState } from "react";
import { Link } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import {
  ErrorBanner,
  LoadingSkeleton,
  PageHeader,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";
import { UserAvatar } from "./UserAvatar.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { CommercialPortfolio } from "./UserProfileCard.tsx";

/**
 * My profile — who this person is inside ABP.
 *
 * This is the one place identity is edited: photo, the name colleagues see,
 * and how to reach you. Preferences (theme, language, notifications, privacy
 * switches, password) live in Settings, so nothing here is a second copy of a
 * control that exists there — a setting with two homes is a setting that
 * disagrees with itself.
 *
 * Everything below the editable block is an organisational fact — role,
 * country scope, workspaces, session — rendered as a fact and not as a
 * disabled field. Administration sets those, and a greyed-out input would
 * suggest otherwise.
 */

function formatDateTime(value: string | null | undefined, locale: string) {
  if (typeof value !== "string" || value.length === 0) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function MyProfilePage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();

  const profile = useQuery({
    queryKey: ["my-profile"],
    queryFn: () => commercialRequest(client, "GET", "/me/profile"),
  });
  const colleagueProfile = useQuery({
    queryKey: ["colleague", me.user.userId],
    queryFn: () =>
      commercialRequest(client, "GET", "/users/{userId}/profile", {
        path: { userId: me.user.userId },
      }),
  });
  const data =
    isObject(profile.data?.data) && isObject(profile.data.data.data)
      ? profile.data.data.data
      : {};

  const savedName = (() => {
    const value = str(data.displayName);
    return value === "—" ? me.user.displayName : value;
  })();
  const savedPhone = typeof data.phone === "string" ? data.phone : "";
  const photoUpdatedAt =
    typeof data.photoUpdatedAt === "string" ? data.photoUpdatedAt : null;
  const jobTitle = typeof data.jobTitle === "string" ? data.jobTitle : null;
  const photoVisible = data.photoVisible !== false;
  const phoneVisible = data.phoneVisible !== false;
  const colleagueData =
    isObject(colleagueProfile.data?.data) &&
    isObject(colleagueProfile.data.data.data)
      ? colleagueProfile.data.data.data
      : null;
  const portfolio =
    colleagueData && isObject(colleagueData.commercialPortfolio)
      ? colleagueData.commercialPortfolio
      : null;

  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [phoneDraft, setPhoneDraft] = useState<string | null>(null);
  const name = nameDraft ?? savedName;
  const phone = phoneDraft ?? savedPhone;
  const dirty =
    (nameDraft !== null && nameDraft !== savedName) ||
    (phoneDraft !== null && phoneDraft !== savedPhone);

  /** The header avatar and name read `me`, so both are re-read on every save
      and the change is visible immediately rather than after a reload. */
  const refresh = async () => {
    await profile.refetch();
    await cache.invalidateQueries({ queryKey: ["me"] });
  };

  const save = useMutation({
    mutationFn: () =>
      commercialRequest(client, "PATCH", "/me/profile", {
        path: {},
        body: { displayName: name.trim(), phone: phone.trim() },
      }),
    onSuccess: async () => {
      setNameDraft(null);
      setPhoneDraft(null);
      await refresh();
      toast.success(txt("Profile saved", "تم حفظ الملف الشخصي"));
    },
  });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const view = new Uint8Array(buffer);
      let binary = "";
      // Chunked: String.fromCharCode on a spread of a multi-megabyte array
      // overflows the argument limit.
      for (let i = 0; i < view.length; i += 8192)
        binary += String.fromCharCode(...view.subarray(i, i + 8192));
      return commercialRequest(client, "PUT", "/me/profile/photo", {
        path: {},
        body: { contentBase64: btoa(binary) },
      });
    },
    onSuccess: async () => {
      await refresh();
      toast.success(txt("Photo updated", "تم تحديث الصورة"));
    },
  });

  const removePhoto = useMutation({
    mutationFn: () =>
      commercialRequest(client, "DELETE", "/me/profile/photo", { path: {} }),
    onSuccess: async () => {
      await refresh();
      toast.success(txt("Photo removed", "تم حذف الصورة"));
    },
  });

  /**
   * What is still missing — and only things this person can actually do
   * something about. A checklist that lists items somebody else owns is a
   * list of complaints, not a task.
   */
  const emailLocalPart = me.user.email.split("@")[0] ?? "";
  const steps = [
    {
      id: "photo",
      done: photoUpdatedAt !== null,
      en: "Add a profile photo",
      ar: "ضيف صورة شخصية",
      whyEn: "Colleagues recognise a face faster than a name in a list.",
      whyAr: "زمايلك بيعرفوا الصورة أسرع من الاسم في قايمة.",
      to: null,
    },
    {
      id: "name",
      done:
        savedName.trim().length > 0 &&
        savedName.trim().toLowerCase() !== emailLocalPart.toLowerCase() &&
        !savedName.includes("@"),
      en: "Set the name colleagues see",
      ar: "اكتب الاسم اللي زمايلك يشوفوه",
      whyEn: "Your sign-in address is not a name.",
      whyAr: "بريد الدخول مش اسم.",
      to: null,
    },
    {
      id: "phone",
      done: savedPhone.trim().length > 0,
      en: "Add a phone number",
      ar: "ضيف رقم تليفون",
      whyEn: "So an urgent deal can reach you off the system.",
      whyAr: "عشان صفقة مستعجلة توصلك من برة النظام.",
      to: null,
    },
    // Only shown when it is genuinely outstanding: MFA that is neither
    // enabled nor required is a choice, not an unfinished step.
    ...(me.user.mfaRequired && !me.user.mfaEnabled
      ? [
          {
            id: "mfa",
            done: false,
            en: "Finish two-step verification",
            ar: "كمّل التحقق بخطوتين",
            whyEn: "Required on your account and not yet set up.",
            whyAr: "مطلوب لحسابك ولسه متفعّلش.",
            to: "/settings?section=security",
          },
        ]
      : []),
  ];
  const remaining = steps.filter((step) => !step.done);
  const doneCount = steps.length - remaining.length;

  if (profile.isLoading) return <LoadingSkeleton rows={4} variant="detail" />;

  const sessionIssued = formatDateTime(me.session.issuedAt, locale);
  const sessionExpires = formatDateTime(me.session.expiresAt, locale);
  const lastSignIn = formatDateTime(me.user.lastSignInAt, locale);

  return (
    <section className="workspace-page my-profile-page">
      <PageHeader
        kicker={txt("My profile", "ملفي الشخصي")}
        title={savedName}
        sub={txt(
          "How you appear across ABP, and what your account is allowed to do.",
          "شكلك في ABP كله، وإيه اللي حسابك مسموح له بيه.",
        )}
        actions={
          <Link className="ghost-button" to="/settings">
            {txt("Settings", "الإعدادات")}
          </Link>
        }
      />

      <ErrorBanner error={profile.error} retry={() => void profile.refetch()} />

      {portfolio && <CommercialPortfolio value={portfolio} />}

      {/* § Complete your profile — disappears on its own when there is
          nothing left, so it never becomes a banner people learn to ignore. */}
      {remaining.length > 0 && (
        <section className="profile-complete" aria-live="polite">
          <header>
            <h2>{txt("Finish setting up", "كمّل ملفك")}</h2>
            <span className="profile-complete-count">
              {doneCount}/{steps.length}
            </span>
          </header>
          <div
            className="profile-complete-bar"
            role="img"
            aria-label={txt(
              `${String(doneCount)} of ${String(steps.length)} done`,
              `${String(doneCount)} من ${String(steps.length)} تمام`,
            )}
          >
            <span
              style={{
                inlineSize: `${String(Math.round((doneCount / steps.length) * 100))}%`,
              }}
            />
          </div>
          <ul>
            {remaining.map((step) => (
              <li key={step.id}>
                <strong>{locale === "ar" ? step.ar : step.en}</strong>
                <span>{locale === "ar" ? step.whyAr : step.whyEn}</span>
                {step.to !== null && (
                  <Link to={step.to}>{txt("Open", "افتح")}</Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="profile-grid">
        <section className="profile-panel">
          <h2>{txt("Identity", "بياناتك")}</h2>
          <p className="settings-hint">
            {txt(
              "The only part of your record you control. Everything else on this page is set by administration.",
              "ده الجزء الوحيد اللي بإيدك. باقي الصفحة إدارة النظام هي اللي بتحدده.",
            )}
          </p>

          <div className="profile-photo-row">
            <UserAvatar
              userId={me.user.userId}
              displayName={name || me.user.displayName}
              photoUpdatedAt={photoUpdatedAt}
              size="lg"
            />
            <div className="profile-photo-actions">
              <label className="button secondary" htmlFor="my-profile-photo">
                {photoUpdatedAt
                  ? txt("Replace photo", "تغيير الصورة")
                  : txt("Upload photo", "رفع صورة")}
              </label>
              <input
                id="my-profile-photo"
                type="file"
                accept="image/png,image/jpeg,image/gif,image/webp"
                hidden
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) uploadPhoto.mutate(file);
                }}
              />
              {photoUpdatedAt !== null && (
                <button
                  type="button"
                  className="ghost-button"
                  disabled={removePhoto.isPending}
                  onClick={() => {
                    removePhoto.mutate();
                  }}
                >
                  {txt("Remove", "إزالة")}
                </button>
              )}
            </div>
            <p className="profile-photo-hint">
              {txt(
                "PNG, JPEG, GIF or WebP, up to 4 MB. Without one, your initials are shown.",
                "PNG أو JPEG أو GIF أو WebP، حتى ٤ ميجابايت. من غير صورة بتظهر أحرف اسمك.",
              )}
            </p>
          </div>
          <ErrorBanner
            error={uploadPhoto.error ?? removePhoto.error}
            retry={() => void profile.refetch()}
          />

          <label className="settings-field">
            {txt("Display name", "الاسم المعروض")}
            <input
              value={name}
              maxLength={120}
              onChange={(event) => {
                setNameDraft(event.target.value);
              }}
            />
          </label>
          <label className="settings-field">
            {txt("Phone number", "رقم الهاتف")}
            <input
              value={phone}
              maxLength={40}
              inputMode="tel"
              onChange={(event) => {
                setPhoneDraft(event.target.value);
              }}
            />
            <small>
              {phoneVisible
                ? txt("Colleagues can see this.", "زمايلك بيشوفوا الرقم ده.")
                : txt("Hidden from colleagues.", "مخفي عن زمايلك.")}{" "}
              <Link to="/settings?section=privacy">
                {txt("Change", "غيّر")}
              </Link>
            </small>
          </label>
          <ErrorBanner
            error={save.error}
            retry={() => {
              save.mutate();
            }}
          />
          <div className="profile-save-row">
            <button
              type="button"
              className="primary"
              disabled={save.isPending || !dirty}
              onClick={() => {
                save.mutate();
              }}
            >
              {save.isPending
                ? txt("Saving…", "جارٍ الحفظ…")
                : txt("Save changes", "حفظ التغييرات")}
            </button>
            {dirty && (
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setNameDraft(null);
                  setPhoneDraft(null);
                }}
              >
                {txt("Discard", "تراجع")}
              </button>
            )}
          </div>
        </section>

        <section className="profile-panel">
          <h2>{txt("Access", "الصلاحيات")}</h2>
          <p className="settings-hint">
            {txt(
              "Set by system administration. Shown here so you can see what you have.",
              "إدارة النظام هي اللي بتحددها. معروضة هنا عشان تشوف عندك إيه.",
            )}
          </p>
          <dl className="settings-facts">
            <dt>{txt("Email", "البريد")}</dt>
            <dd>{me.user.email}</dd>
            {jobTitle !== null && (
              <>
                <dt>{txt("Job title", "المسمى الوظيفي")}</dt>
                <dd>{jobTitle}</dd>
              </>
            )}
            <dt>{txt("Account status", "حالة الحساب")}</dt>
            <dd>
              <StatusChip code={me.user.authStatusCode} />
            </dd>
            <dt>{txt("Roles", "الأدوار")}</dt>
            <dd>
              {me.access.roles.length === 0
                ? txt("No role assigned.", "مفيش دور متعيّن.")
                : me.access.roles.map((role) => role.name).join(" · ")}
            </dd>
            <dt>{txt("Country scope", "الدول المصرح بها")}</dt>
            <dd>
              {me.access.countryScope.countryCodes.length === 0
                ? txt("No country granted.", "مفيش دولة مصرح بيها.")
                : me.access.countryScope.countryCodes.join(", ")}
            </dd>
            <dt>{txt("Workspaces", "مساحات العمل")}</dt>
            <dd>
              {me.access.workspaces
                .filter((workspace) => workspace.enabled)
                .map((workspace) => enumLabel(workspace.workspace, locale))
                .join(" · ") || txt("None.", "لا شيء.")}
            </dd>
            <dt>{txt("Permissions", "الأذونات")}</dt>
            <dd>
              {txt(
                `${String(me.access.permissions.length)} granted`,
                `${String(me.access.permissions.length)} إذن`,
              )}
            </dd>
          </dl>
        </section>

        <section className="profile-panel">
          <h2>{txt("This session", "الجلسة الحالية")}</h2>
          {/* Only the session you are in: the API exposes the current one and
              no list of the others, so there is nothing else honest to show
              here. Ending them all is offered in Settings, where it belongs. */}
          <dl className="settings-facts">
            <dt>{txt("Signed in", "بدأت")}</dt>
            <dd>{sessionIssued ?? txt("Unknown", "غير معروف")}</dd>
            <dt>{txt("Expires", "تنتهي")}</dt>
            <dd>{sessionExpires ?? txt("Unknown", "غير معروف")}</dd>
            <dt>{txt("Sign-in strength", "قوة الدخول")}</dt>
            <dd>
              <StatusChip code={me.session.assurance} />
            </dd>
            {lastSignIn !== null && (
              <>
                <dt>{txt("Previous sign-in", "آخر دخول سابق")}</dt>
                <dd>{lastSignIn}</dd>
              </>
            )}
          </dl>
          <p className="settings-hint">
            {txt(
              "There is no list of your other devices — the server does not expose one. You can end every session from Settings.",
              "مفيش قايمة بأجهزتك التانية لأن الخادم ما بيوفرهاش. تقدر تنهي كل الجلسات من الإعدادات.",
            )}
          </p>
          <Link className="ghost-button" to="/settings?section=security">
            {txt("Open security settings", "افتح إعدادات الأمان")}
          </Link>
        </section>

        <section className="profile-panel">
          <h2>{txt("How colleagues see you", "كده زمايلك بيشوفوك")}</h2>
          <div className="profile-preview">
            <UserAvatar
              userId={me.user.userId}
              displayName={name || me.user.displayName}
              photoUpdatedAt={photoVisible ? photoUpdatedAt : null}
              size="lg"
            />
            <div>
              <strong>{name || me.user.displayName}</strong>
              {jobTitle !== null && <span>{jobTitle}</span>}
              <span>
                {me.access.roles.map((role) => role.name).join(" · ")}
              </span>
              <span>{me.user.email}</span>
              {phoneVisible && phone.trim() ? <span>{phone}</span> : null}
            </div>
          </div>
          <div className="profile-panel-links">
            <Link className="ghost-button" to="/settings?section=privacy">
              {txt("Privacy & visibility", "الخصوصية والظهور")}
            </Link>
            <Link className="ghost-button" to="/people">
              {txt("Team directory", "دليل الفريق")}
            </Link>
          </div>
        </section>
      </div>
    </section>
  );
}
