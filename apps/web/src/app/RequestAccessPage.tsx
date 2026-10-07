import { useState, type SyntheticEvent } from "react";
import type { ApiClient } from "@abp/api-client";
import { submitAccessRequest } from "../api/auth-api.ts";
import { useI18n } from "../i18n/i18n.tsx";

const copy = {
  en: {
    brand: "ABP Commercial System",
    eyebrow: "Request access",
    title: "Ask for a workspace account",
    description:
      "This system is provisioned by an administrator. Submit your details and an admin will review and grant access — no account is created here.",
    fullName: "Full name",
    workEmail: "Work email",
    companyOrRole: "Company / role (optional)",
    message: "Reason for access (optional)",
    submit: "Submit request",
    submitting: "Submitting…",
    backToLogin: "Back to sign in",
    success: "Request submitted",
    successDescription:
      "An administrator will review your request. You'll be contacted once access is granted.",
    error: "Could not submit the request. Please try again.",
    tooMany: "Too many requests from this network. Try again later.",
  },
  ar: {
    brand: "نظام ABP التجاري",
    eyebrow: "طلب صلاحية دخول",
    title: "اطلب حساب على النظام",
    description:
      "هذا النظام يُدار من قبل الأدمن فقط. أرسل بياناتك وسيقوم أحد الأدمنز بمراجعة الطلب ومنح الصلاحية — لا يتم إنشاء أي حساب هنا مباشرة.",
    fullName: "الاسم الكامل",
    workEmail: "البريد الإلكتروني للعمل",
    companyOrRole: "الشركة / الوظيفة (اختياري)",
    message: "سبب طلب الصلاحية (اختياري)",
    submit: "إرسال الطلب",
    submitting: "جارٍ الإرسال…",
    backToLogin: "الرجوع لتسجيل الدخول",
    success: "تم إرسال الطلب",
    successDescription:
      "سيقوم أحد الأدمنز بمراجعة طلبك. سيتم التواصل معك عند منح الصلاحية.",
    error: "تعذر إرسال الطلب. حاول مرة أخرى.",
    tooMany: "عدد كبير من الطلبات من هذه الشبكة. حاول لاحقًا.",
  },
} as const;

export function RequestAccessPage({
  client,
  onBackToLogin,
}: {
  client: ApiClient;
  onBackToLogin: () => void;
}) {
  const { locale } = useI18n();
  const c = copy[locale];
  const [fullName, setFullName] = useState("");
  const [workEmail, setWorkEmail] = useState("");
  const [companyOrRole, setCompanyOrRole] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [submitted, setSubmitted] = useState(false);

  const submit = async (event: SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(undefined);
    setBusy(true);
    try {
      await submitAccessRequest(client, {
        fullName,
        workEmail,
        companyOrRole: companyOrRole || null,
        message: message || null,
      });
      setSubmitted(true);
    } catch (err) {
      setError(
        err instanceof Error && err.message.includes("429")
          ? c.tooMany
          : c.error,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="local-auth-page">
      <section
        className="local-auth-card"
        aria-labelledby="request-access-title"
      >
        <div className="local-auth-topline">
          <div className="local-auth-identity">
            <img className="local-auth-logo" src="/favicon.svg" alt="ABP" />
            <span>
              <strong>ABP</strong>
              <small>{c.brand}</small>
            </span>
          </div>
        </div>
        {submitted ? (
          <>
            <p className="eyebrow" data-abp-caption>
              {c.eyebrow}
            </p>
            <h1 id="request-access-title">{c.success}</h1>
            <p className="muted-copy">{c.successDescription}</p>
            <button
              className="primary auth-submit"
              type="button"
              onClick={onBackToLogin}
            >
              {c.backToLogin}
            </button>
          </>
        ) : (
          <>
            <p className="eyebrow" data-abp-caption>
              {c.eyebrow}
            </p>
            <h1 id="request-access-title">{c.title}</h1>
            <p className="muted-copy">{c.description}</p>
            <form onSubmit={(event) => void submit(event)}>
              <label>
                {c.fullName}
                <input
                  value={fullName}
                  onChange={(event) => {
                    setFullName(event.target.value);
                  }}
                  required
                  autoFocus
                />
              </label>
              <label>
                {c.workEmail}
                <input
                  type="email"
                  value={workEmail}
                  onChange={(event) => {
                    setWorkEmail(event.target.value);
                  }}
                  required
                />
              </label>
              <label>
                {c.companyOrRole}
                <input
                  value={companyOrRole}
                  onChange={(event) => {
                    setCompanyOrRole(event.target.value);
                  }}
                />
              </label>
              <label>
                {c.message}
                <textarea
                  value={message}
                  onChange={(event) => {
                    setMessage(event.target.value);
                  }}
                  rows={3}
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
                disabled={busy}
              >
                {busy ? c.submitting : c.submit}
              </button>
            </form>
            <button className="auth-link" type="button" onClick={onBackToLogin}>
              {c.backToLogin}
            </button>
          </>
        )}
      </section>
    </main>
  );
}
