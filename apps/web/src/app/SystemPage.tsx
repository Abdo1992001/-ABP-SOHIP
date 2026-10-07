import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { formatBytes } from "../lib/downloads.ts";
import { commercialRequest, isObject } from "./commercial-api.ts";
import { ErrorBanner, PageHeader, useToast } from "./CommercialUI.tsx";

/**
 * The two things an administrator must be able to trust without looking at a
 * server: that email leaves, and that last night's backup exists and restores.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
const num = (value: unknown) =>
  typeof value === "number" ? value : Number(value) || 0;

const STATUS: Record<string, { en: string; ar: string; tone: string }> = {
  SENT: { en: "Sent", ar: "اتبعت", tone: "ok" },
  QUEUED: { en: "Waiting", ar: "مستني", tone: "wait" },
  SENDING: { en: "Sending", ar: "بيتبعت", tone: "wait" },
  FAILED: { en: "Not delivered", ar: "موصلش", tone: "bad" },
};
const PURPOSE: Record<string, { en: string; ar: string }> = {
  QUOTATION: { en: "Quotation", ar: "عرض سعر" },
  NOTIFICATION: { en: "Notifications", ar: "إشعارات" },
  TEST: { en: "Test", ar: "تجربة" },
};

export function SystemPage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const toast = useToast();
  const when = (value: unknown) =>
    text(value)
      ? new Date(text(value)).toLocaleString(ar ? "ar-EG" : "en-GB", {
          dateStyle: "medium",
          timeStyle: "short",
        })
      : "—";

  const get =
    (
      path: "/system/mail-status" | "/system/emails" | "/system/backup-status",
    ) =>
    async () => {
      const result = await commercialRequest(client, "GET", path, {
        path: {},
        ...(path === "/system/emails" ? { query: { limit: 30 } } : {}),
      });
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    };
  const mail = useQuery({
    queryKey: ["system-mail-status"],
    queryFn: get("/system/mail-status"),
  });
  const emails = useQuery({
    queryKey: ["system-emails"],
    queryFn: get("/system/emails"),
    refetchInterval: 15_000,
  });
  const backup = useQuery({
    queryKey: ["system-backup"],
    queryFn: get("/system/backup-status"),
  });

  const test = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/system/mail-test", { path: {} }),
    onSuccess: (result) => {
      const to =
        isObject(result.data) && isObject(result.data.data)
          ? text(result.data.data.to)
          : "";
      toast.success(
        txt(
          `Test email queued to ${to}`,
          `الإيميل التجريبي في الطريق لـ ${to}`,
        ),
      );
      setTimeout(() => void emails.refetch(), 4000);
    },
  });

  const configured = mail.data?.configured === true;
  const week = isObject(emails.data?.week) ? emails.data.week : {};
  const list = Array.isArray(emails.data?.emails)
    ? (emails.data.emails.filter(isObject) as Rec[])
    : [];
  const last = isObject(backup.data?.lastRun) ? backup.data.lastRun : null;
  const lastAt = last ? Date.parse(text(last.finishedAt)) : NaN;
  const stale = Number.isFinite(lastAt) && Date.now() - lastAt > 36 * 3_600_000;
  const backupOk = last?.ok === true && !stale;

  return (
    <section className="workspace-page system-page">
      <PageHeader
        kicker={txt("Administration", "الإدارة")}
        title={txt("System", "النظام")}
      />

      <div className="system-grid">
        <article
          className={`panel system-card ${configured ? "is-ok" : "is-warn"}`}
        >
          <header>
            <h2>{txt("Email", "الإيميل")}</h2>
            <span className={`system-dot ${configured ? "ok" : "warn"}`}>
              {configured
                ? txt("Working", "شغال")
                : txt("Not set up", "مش متظبط")}
            </span>
          </header>
          <ErrorBanner error={mail.error} retry={() => void mail.refetch()} />
          {configured ? (
            <>
              <dl className="system-facts">
                <dt>{txt("Sends through", "بيبعت عن طريق")}</dt>
                <dd>
                  {text(mail.data?.provider) === "GRAPH"
                    ? "Microsoft 365 (Outlook)"
                    : txt(
                        "Company mail server (SMTP)",
                        "سيرفر الإيميل بتاع الشركة (SMTP)",
                      )}
                </dd>
                <dt>{txt("From", "من")}</dt>
                <dd dir="ltr">{text(mail.data?.sender)}</dd>
                <dt>{txt("Last 7 days", "آخر 7 أيام")}</dt>
                <dd>
                  {num(week.SENT)} {txt("sent", "اتبعت")} ·{" "}
                  {num(week.QUEUED) + num(week.SENDING)}{" "}
                  {txt("waiting", "مستني")} ·{" "}
                  <span className={num(week.FAILED) > 0 ? "system-bad" : ""}>
                    {num(week.FAILED)} {txt("not delivered", "موصلش")}
                  </span>
                </dd>
              </dl>
              <button
                type="button"
                className="secondary"
                disabled={test.isPending}
                onClick={() => {
                  test.mutate();
                }}
              >
                {test.isPending
                  ? "…"
                  : txt("Send me a test email", "ابعتلي إيميل تجريبي")}
              </button>
              <ErrorBanner
                error={test.error}
                retry={() => {
                  test.mutate();
                }}
              />
            </>
          ) : (
            <div className="system-setup">
              <p>
                {txt(
                  "Until email is set up, quotations are recorded as sent by hand and notifications stay in the app.",
                  "لحد ما الإيميل يتظبط، عروض الأسعار بتتسجل إنها اتبعتت باليد، والإشعارات جوه السيستم بس.",
                )}
              </p>
              <p>
                {txt(
                  "Your IT administrator adds the Outlook settings to the server's environment file and restarts the system. The guide is in docs/guides/email-and-backups.md.",
                  "مسؤول الـIT يضيف إعدادات Outlook في ملف إعدادات السيرفر ويعيد تشغيل السيستم. الشرح في docs/guides/email-and-backups.md.",
                )}
              </p>
            </div>
          )}
        </article>

        <article
          className={`panel system-card ${backupOk ? "is-ok" : "is-warn"}`}
        >
          <header>
            <h2>{txt("Backups", "النسخ الاحتياطي")}</h2>
            <span className={`system-dot ${backupOk ? "ok" : "warn"}`}>
              {!backup.data?.configured
                ? txt("Not running", "مش شغال")
                : last === null
                  ? txt("No backup yet", "مفيش نسخة لسه")
                  : last.ok !== true
                    ? txt("Last backup failed", "آخر نسخة فشلت")
                    : stale
                      ? txt("Overdue", "متأخرة")
                      : txt("Up to date", "متحدّثة")}
            </span>
          </header>
          <ErrorBanner
            error={backup.error}
            retry={() => void backup.refetch()}
          />
          {last ? (
            <dl className="system-facts">
              <dt>{txt("Last backup", "آخر نسخة")}</dt>
              <dd>{when(last.finishedAt)}</dd>
              <dt>{txt("Database", "الداتابيز")}</dt>
              <dd>
                {isObject(last.database)
                  ? formatBytes(num(last.database.bytes))
                  : "—"}
              </dd>
              <dt>{txt("Documents and PDFs", "المستندات والـPDF")}</dt>
              <dd>
                {isObject(last.documents)
                  ? formatBytes(num(last.documents.bytes))
                  : "—"}
              </dd>
              <dt>{txt("Restore check", "اختبار الاسترجاع")}</dt>
              <dd
                className={
                  isObject(last.verified) && last.verified.ok === true
                    ? ""
                    : "system-bad"
                }
              >
                {isObject(last.verified) && last.verified.ok === true
                  ? txt(
                      `Restored into a scratch database: ${text(last.verified.tables)} tables, ${text(last.verified.customers)} customers`,
                      `اتسترجعت في داتابيز تجريبية: ${text(last.verified.tables)} جدول، ${text(last.verified.customers)} عميل`,
                    )
                  : txt("Did not restore", "متسترجعتش")}
              </dd>
              <dt>{txt("Copies kept", "النسخ المحفوظة")}</dt>
              <dd>{text(last.keptCopies) || "—"}</dd>
              {text(last.offsiteCopy) && (
                <>
                  <dt>{txt("Second copy", "النسخة التانية")}</dt>
                  <dd>{text(last.offsiteCopy)}</dd>
                </>
              )}
              <dt>{txt("Next backup", "النسخة الجاية")}</dt>
              <dd>{when(last.nextRunAt)}</dd>
              {text(last.error) && (
                <>
                  <dt>{txt("What went wrong", "إيه اللي حصل")}</dt>
                  <dd className="system-bad">{text(last.error)}</dd>
                </>
              )}
            </dl>
          ) : (
            <p className="settings-hint">
              {backup.data?.configured
                ? txt(
                    "The backup service is running; the first backup is taken at its scheduled hour.",
                    "خدمة النسخ شغالة؛ أول نسخة هتتاخد في ميعادها.",
                  )
                : txt(
                    "The backup service is not running on this server. See docs/guides/email-and-backups.md.",
                    "خدمة النسخ مش شغالة على السيرفر ده. الشرح في docs/guides/email-and-backups.md.",
                  )}
            </p>
          )}
        </article>
      </div>

      {list.length > 0 && (
        <article className="panel">
          <h2 className="settings-section-title">
            {txt("Recent emails", "آخر الإيميلات")}
          </h2>
          <ErrorBanner
            error={emails.error}
            retry={() => void emails.refetch()}
          />
          <div className="enterprise-table-scroll">
            <table className="data-table system-emails">
              <thead>
                <tr>
                  <th>{txt("Queued", "اتحط")}</th>
                  <th>{txt("Kind", "النوع")}</th>
                  <th>{txt("To", "إلى")}</th>
                  <th>{txt("Subject", "الموضوع")}</th>
                  <th>{txt("Status", "الحالة")}</th>
                </tr>
              </thead>
              <tbody>
                {list.map((row) => {
                  const status = STATUS[text(row.statusCode)];
                  const purpose = PURPOSE[text(row.purposeCode)];
                  return (
                    <tr key={text(row.emailMessageId)}>
                      <td>{when(row.createdAt)}</td>
                      <td>
                        {purpose
                          ? ar
                            ? purpose.ar
                            : purpose.en
                          : text(row.purposeCode)}
                      </td>
                      <td dir="ltr">
                        {Array.isArray(row.to)
                          ? row.to.map(text).join(", ")
                          : ""}
                      </td>
                      <td>{text(row.subject)}</td>
                      <td>
                        <span className={`system-chip ${status?.tone ?? ""}`}>
                          {status
                            ? ar
                              ? status.ar
                              : status.en
                            : text(row.statusCode)}
                        </span>
                        {text(row.lastError) && (
                          <small
                            className="system-error"
                            title={text(row.lastError)}
                          >
                            {text(row.lastError)}
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </article>
      )}
    </section>
  );
}
