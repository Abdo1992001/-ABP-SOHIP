import { useEffect, useState, type SyntheticEvent } from "react";
import type { ApiClient } from "@abp/api-client";
import {
  changePassword,
  completePasswordChange,
  completeMfaSetup,
  confirmMfa,
  login,
  rememberAuthenticatedSession,
  setupMfa,
  useRecoveryCode,
  verifyMfa,
} from "../api/auth-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { AbpLogo } from "./AbpLogo.tsx";

const authCopy = {
  en: {
    brand: "ABP Commercial System",
    secureAccess: "Secure workspace",
    language: "العربية",
    requiredSetup: "Required security setup",
    passwordTitle: "Create your permanent password",
    passwordDescription:
      "Replace the temporary password before enrolling your authenticator.",
    temporaryPassword: "Temporary password",
    newPassword: "New password",
    confirmPassword: "Confirm new password",
    passwordMismatch: "The new passwords do not match.",
    passwordError:
      "The current password is incorrect or the new password does not meet the security policy.",
    updating: "Updating…",
    updatePassword: "Update password",
    securityVerification: "Security verification",
    signIn: "Sign in",
    verificationDescription: "Enter the code from your authenticator app.",
    signInDescription: "Use your company username or email address.",
    // Split rather than string-sliced: the accent falls on a different word in
    // each language, and a slice would put it on the wrong one.
    sloganLead: "A Smarter Way to",
    sloganAccent: "Build.",
    rememberMe: "Remember my username",
    recoveryCode: "Recovery code",
    authenticatorCode: "6-digit authenticator code",
    username: "Username or email",
    password: "Password",
    pleaseWait: "Please wait…",
    verify: "Verify",
    useAuthenticator: "Use authenticator code",
    useRecovery: "Use a recovery code",
    loginError:
      "The login details are invalid or the account is temporarily locked.",
    verificationError: "The verification code is invalid or expired.",
    mfaTitle: "Protect this account with MFA",
    recoveryNote:
      "Save these one-time recovery codes now. They will not be shown again.",
    savedCodes: "I saved the codes",
    manualKey: "Manual key",
    preparingMfa: "Preparing MFA",
    enableMfa: "Enable MFA",
    verifying: "Verifying…",
    mfaStartError: "MFA setup could not be started. Try again.",
    mfaCodeError:
      "The authenticator code is invalid. Check the device time and retry.",
    showPassword: "Show password",
    hidePassword: "Hide password",
  },
  ar: {
    brand: "نظام ABP التجاري",
    secureAccess: "بوابة عمل آمنة",
    language: "English",
    requiredSetup: "إعداد أمني مطلوب",
    passwordTitle: "أنشئ كلمة المرور الدائمة",
    passwordDescription: "استبدل كلمة المرور المؤقتة قبل ربط تطبيق المصادقة.",
    temporaryPassword: "كلمة المرور المؤقتة",
    newPassword: "كلمة المرور الجديدة",
    confirmPassword: "تأكيد كلمة المرور الجديدة",
    passwordMismatch: "كلمتا المرور الجديدتان غير متطابقتين.",
    passwordError:
      "كلمة المرور الحالية غير صحيحة أو أن كلمة المرور الجديدة لا تطابق سياسة الأمان.",
    updating: "جارٍ التحديث…",
    updatePassword: "تحديث كلمة المرور",
    securityVerification: "التحقق الأمني",
    signIn: "تسجيل الدخول",
    verificationDescription: "أدخل الرمز من تطبيق المصادقة.",
    signInDescription:
      "استخدم اسم المستخدم أو البريد الإلكتروني الخاص بالشركة.",
    sloganLead: "طريقة أذكى",
    sloganAccent: "للبناء.",
    rememberMe: "تذكّر اسم المستخدم",
    recoveryCode: "رمز الاسترداد",
    authenticatorCode: "رمز المصادقة المكوّن من 6 أرقام",
    username: "اسم المستخدم أو البريد الإلكتروني",
    password: "كلمة المرور",
    pleaseWait: "يرجى الانتظار…",
    verify: "تحقق",
    useAuthenticator: "استخدام رمز تطبيق المصادقة",
    useRecovery: "استخدام رمز استرداد",
    loginError: "بيانات الدخول غير صحيحة أو أن الحساب مقفل مؤقتًا.",
    verificationError: "رمز التحقق غير صحيح أو انتهت صلاحيته.",
    mfaTitle: "احمِ هذا الحساب بالمصادقة متعددة العوامل",
    recoveryNote:
      "احفظ رموز الاسترداد أحادية الاستخدام الآن؛ لن تظهر مرة أخرى.",
    savedCodes: "حفظت الرموز",
    manualKey: "المفتاح اليدوي",
    preparingMfa: "جارٍ تجهيز المصادقة متعددة العوامل",
    enableMfa: "تفعيل المصادقة متعددة العوامل",
    verifying: "جارٍ التحقق…",
    mfaStartError: "تعذر بدء إعداد المصادقة. أعد المحاولة.",
    mfaCodeError: "رمز المصادقة غير صحيح. تحقق من وقت الجهاز وأعد المحاولة.",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
  },
} as const;

function EyeIcon({ hidden }: { hidden: boolean }) {
  return hidden ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M3 3l18 18M10.58 10.58a2 2 0 002.83 2.83M9.88 4.24A9.53 9.53 0 0112 4c5 0 9 4 10 8-.32 1.17-.87 2.27-1.61 3.25M6.6 6.6C4.4 8 2.9 9.9 2 12c1 4 5 8 10 8 1.52 0 2.96-.36 4.24-1"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 12c1-4 5-8 10-8s9 4 10 8c-1 4-5 8-10 8s-9-4-10-8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  );
}

function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  minLength,
  required,
  autoFocus,
  showLabel,
  hideLabel,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  minLength?: number;
  required?: boolean;
  autoFocus?: boolean;
  showLabel: string;
  hideLabel: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <label>
      {label}
      <div className="auth-password-field">
        <input
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
          minLength={minLength}
          required={required}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          className="auth-password-toggle"
          aria-label={visible ? hideLabel : showLabel}
          aria-pressed={visible}
          onClick={() => {
            setVisible((current) => !current);
          }}
        >
          <EyeIcon hidden={visible} />
        </button>
      </div>
    </label>
  );
}

/**
 * The company lockup, deliberately outside the sign-in card.
 *
 * The card is the task ("sign in"); the mark is whose product this is. Nesting
 * the brand inside the form made the two compete for the same visual weight.
 */
function AuthLockup({ lead, accent }: { lead: string; accent: string }) {
  return (
    <div className="local-auth-lockup">
      <AbpLogo className="local-auth-wordmark" size="lg" />
      {/* The two halves carry the mark's own two colours: navy for the phrase,
          crimson for the word the logo underlines. */}
      <p className="auth-slogan">
        <span className="auth-slogan-lead">{lead}</span>{" "}
        <span className="auth-slogan-accent">{accent}</span>
      </p>
    </div>
  );
}

function AuthBrand() {
  const { locale, toggle } = useI18n();
  const copy = authCopy[locale];
  return (
    <div className="local-auth-topline">
      <button className="auth-language" type="button" onClick={toggle}>
        {copy.language}
      </button>
    </div>
  );
}

export function PasswordChangePage({
  client,
  onComplete,
}: {
  client: ApiClient;
  onComplete: () => void;
}) {
  const { locale } = useI18n();
  const copy = authCopy[locale];
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    if (newPassword !== confirmation) {
      setError(copy.passwordMismatch);
      return;
    }
    setBusy(true);
    try {
      await changePassword(client, currentPassword, newPassword);
      completePasswordChange();
      onComplete();
    } catch {
      setError(copy.passwordError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="local-auth-page">
      <section className="local-auth-card" aria-labelledby="password-title">
        <AuthBrand />
        <p className="eyebrow" data-abp-caption>
          {copy.requiredSetup}
        </p>
        <h1 id="password-title">{copy.passwordTitle}</h1>
        <p className="muted-copy">{copy.passwordDescription}</p>
        <form onSubmit={(event) => void submit(event)}>
          <PasswordField
            label={copy.temporaryPassword}
            value={currentPassword}
            onChange={setCurrentPassword}
            autoComplete="current-password"
            required
            autoFocus
            showLabel={copy.showPassword}
            hideLabel={copy.hidePassword}
          />
          <PasswordField
            label={copy.newPassword}
            value={newPassword}
            onChange={setNewPassword}
            autoComplete="new-password"
            minLength={12}
            required
            showLabel={copy.showPassword}
            hideLabel={copy.hidePassword}
          />
          <PasswordField
            label={copy.confirmPassword}
            value={confirmation}
            onChange={setConfirmation}
            autoComplete="new-password"
            minLength={12}
            required
            showLabel={copy.showPassword}
            hideLabel={copy.hidePassword}
          />
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy ? copy.updating : copy.updatePassword}
          </button>
        </form>
      </section>
    </main>
  );
}

export function LocalLoginPage({
  client,
  onAuthenticated,
  onRequestAccess,
}: {
  client: ApiClient;
  onAuthenticated: () => void;
  onRequestAccess?: () => void;
}) {
  const { locale } = useI18n();
  const copy = authCopy[locale];
  // The remembered username, not a session. Nothing that could log someone in
  // is persisted here: the password lives only in the browser's own manager.
  const [identifier, setIdentifier] = useState(
    () => window.localStorage.getItem("abp.auth.username") ?? "",
  );
  const [remember, setRemember] = useState(
    () => window.localStorage.getItem("abp.auth.username") !== null,
  );
  const [password, setPassword] = useState("");
  const [challengeToken, setChallengeToken] = useState<string>();
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const submitLogin = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await login(client, identifier, password);
      setPassword("");
      // Remember only after the credentials were accepted, so a typo is never
      // the thing that gets saved and re-offered tomorrow.
      if (remember) {
        window.localStorage.setItem("abp.auth.username", identifier);
      } else {
        window.localStorage.removeItem("abp.auth.username");
      }
      if (result.state === "MFA_REQUIRED" && result.challengeToken) {
        setChallengeToken(result.challengeToken);
        return;
      }
      rememberAuthenticatedSession(result);
      onAuthenticated();
    } catch {
      setError(copy.loginError);
    } finally {
      setBusy(false);
    }
  };

  const submitMfa = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!challengeToken) return;
    setBusy(true);
    setError(undefined);
    try {
      const result = useRecovery
        ? await useRecoveryCode(client, challengeToken, code)
        : await verifyMfa(client, challengeToken, code);
      rememberAuthenticatedSession(result);
      onAuthenticated();
    } catch {
      setError(copy.verificationError);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="local-auth-page">
      {!challengeToken && (
        <AuthLockup lead={copy.sloganLead} accent={copy.sloganAccent} />
      )}
      <section className="local-auth-card" aria-labelledby="local-auth-title">
        <AuthBrand />
        <p className="eyebrow" data-abp-caption>
          {copy.secureAccess}
        </p>
        <h1 id="local-auth-title">
          {challengeToken ? copy.securityVerification : copy.signIn}
        </h1>
        <p className="muted-copy">
          {challengeToken
            ? copy.verificationDescription
            : copy.signInDescription}
        </p>
        <form
          onSubmit={(event) => {
            void (challengeToken ? submitMfa(event) : submitLogin(event));
          }}
        >
          {challengeToken ? (
            <label>
              {useRecovery ? copy.recoveryCode : copy.authenticatorCode}
              <input
                autoComplete="one-time-code"
                inputMode={useRecovery ? "text" : "numeric"}
                value={code}
                onChange={(event) => {
                  setCode(event.target.value);
                }}
                required
                minLength={useRecovery ? 8 : 6}
                maxLength={useRecovery ? 64 : 6}
                autoFocus
              />
            </label>
          ) : (
            <>
              <label>
                {copy.username}
                <input
                  name="username"
                  type="text"
                  autoComplete="username"
                  value={identifier}
                  onChange={(event) => {
                    setIdentifier(event.target.value);
                  }}
                  required
                  autoFocus
                />
              </label>
              <PasswordField
                label={copy.password}
                value={password}
                onChange={setPassword}
                autoComplete="current-password"
                required
                showLabel={copy.showPassword}
                hideLabel={copy.hidePassword}
              />
              {/* Remembering the username is all this does. The password is
                  never stored by the app - `autoComplete` above is what lets
                  the browser's own password manager offer to save it, which is
                  the only place a password should live. */}
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={remember}
                  onChange={(event) => {
                    setRemember(event.target.checked);
                  }}
                />
                <span>{copy.rememberMe}</span>
              </label>
            </>
          )}
          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}
          <button className="primary auth-submit" type="submit" disabled={busy}>
            {busy
              ? copy.pleaseWait
              : challengeToken
                ? copy.verify
                : copy.signIn}
          </button>
        </form>
        {challengeToken && (
          <button
            className="auth-link"
            type="button"
            onClick={() => {
              setUseRecovery((current) => !current);
              setCode("");
              setError(undefined);
            }}
          >
            {useRecovery ? copy.useAuthenticator : copy.useRecovery}
          </button>
        )}
        {!challengeToken && onRequestAccess && (
          <button className="auth-link" type="button" onClick={onRequestAccess}>
            {locale === "ar"
              ? "لا تملك حسابًا؟ اطلب صلاحية دخول"
              : "Don't have an account? Request access"}
          </button>
        )}
        {!challengeToken && (
          <a className="auth-link" href="/feedback">
            {locale === "ar"
              ? "عميل؟ شاركنا رأيك من غير حساب"
              : "A customer? Share your feedback — no account needed"}
          </a>
        )}
      </section>
    </main>
  );
}

export function MfaEnrollmentPage({
  client,
  onComplete,
}: {
  client: ApiClient;
  onComplete: () => void;
}) {
  const { locale } = useI18n();
  const copy = authCopy[locale];
  const [setup, setSetup] = useState<Awaited<ReturnType<typeof setupMfa>>>();
  const [recoveryCodes, setRecoveryCodes] = useState<readonly string[]>();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void setupMfa(client)
      .then(setSetup)
      .catch(() => {
        setError(copy.mfaStartError);
      });
  }, [client, copy.mfaStartError]);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const result = await confirmMfa(client, code);
      setRecoveryCodes(result.recoveryCodes);
    } catch {
      setError(copy.mfaCodeError);
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    completeMfaSetup();
    onComplete();
  };

  return (
    <main className="local-auth-page">
      <section
        className="local-auth-card mfa-enrollment"
        aria-labelledby="mfa-title"
      >
        <AuthBrand />
        <p className="eyebrow" data-abp-caption>
          {copy.requiredSetup}
        </p>
        <h1 id="mfa-title">{copy.mfaTitle}</h1>
        {recoveryCodes ? (
          <>
            <p>{copy.recoveryNote}</p>
            <pre className="recovery-codes">{recoveryCodes.join("\n")}</pre>
            <button
              className="primary auth-submit"
              type="button"
              onClick={finish}
            >
              {copy.savedCodes}
            </button>
          </>
        ) : (
          <>
            {setup?.qrCodeDataUrl && (
              <img
                className="mfa-qr"
                src={setup.qrCodeDataUrl}
                alt={copy.mfaTitle}
              />
            )}
            {setup?.manualSecret && (
              <p className="manual-secret">
                {copy.manualKey}: <strong>{setup.manualSecret}</strong>
              </p>
            )}
            {!setup && !error && (
              <div className="spinner" aria-label={copy.preparingMfa} />
            )}
            <form
              onSubmit={(event) => {
                void submit(event);
              }}
            >
              <label>
                {copy.authenticatorCode}
                <input
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={(event) => {
                    setCode(event.target.value);
                  }}
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                />
              </label>
              {error && (
                <div className="auth-error" role="alert">
                  {error}
                </div>
              )}
              <button
                className="primary auth-submit"
                type="submit"
                disabled={!setup || busy}
              >
                {busy ? copy.verifying : copy.enableMfa}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}
