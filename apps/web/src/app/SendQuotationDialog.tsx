import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import { ErrorBanner, SlideOver, useToast } from "./CommercialUI.tsx";

/**
 * Sending a quotation to the customer.
 *
 * By email from the system when the company mailbox is set up: the official
 * PDF is attached, it leaves from the company address, and replies come back
 * to the salesperson. Or recorded as sent by hand, for a quotation handed over
 * in a meeting or sent from someone's own Outlook.
 */

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SendQuotationButton(props: {
  client: ApiClient;
  quotationId: string;
  quoteRef: string;
  accountId: string;
  accountName: string;
  rowVersion: string;
  onSent: () => Promise<void> | void;
}) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="primary"
        onClick={() => {
          setOpen(true);
        }}
      >
        {locale === "ar" ? "إرسال عرض السعر" : "Send quotation"}
      </button>
      {open && (
        <SendQuotationDialog
          {...props}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function SendQuotationDialog({
  client,
  quotationId,
  quoteRef,
  accountId,
  accountName,
  rowVersion,
  onSent,
  onClose,
}: {
  client: ApiClient;
  quotationId: string;
  quoteRef: string;
  accountId: string;
  accountName: string;
  rowVersion: string;
  onSent: () => Promise<void> | void;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const toast = useToast();

  const mail = useQuery({
    queryKey: ["system-mail-status"],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/system/mail-status",
        {
          path: {},
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const canEmail = mail.data?.configured === true;
  const contacts = useQuery({
    queryKey: ["contact-directory", "account", accountId],
    enabled: accountId !== "",
    queryFn: async () =>
      rows(
        (
          await commercialRequest(client, "GET", "/contacts", {
            path: {},
            query: { accountId, page: 1, limit: 100 },
          })
        ).data,
      ),
  });

  const [how, setHow] = useState<"EMAIL" | "MANUAL" | null>(null);
  const mode = how ?? (canEmail ? "EMAIL" : "MANUAL");
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [handedTo, setHandedTo] = useState("");
  const [language, setLanguage] = useState<"en" | "ar">(ar ? "ar" : "en");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [ccSelf, setCcSelf] = useState(true);

  const people = (contacts.data ?? []).map((row) => ({
    contactId: text(row.contactId),
    name: text(row.displayName),
    role: text(row.jobTitle),
    email: isObject(row.primaryChannel) ? text(row.primaryChannel.value) : "",
  }));
  const typed = extra
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const badTyped = typed.filter((value) => !EMAIL.test(value));
  const picked = people.filter((person) => chosen.has(person.contactId));

  const recipients =
    mode === "EMAIL"
      ? [
          ...picked
            .filter((person) => person.email !== "")
            .map((person) => ({
              contactId: person.contactId,
              name: person.name,
              email: person.email,
            })),
          ...typed
            .filter((value) => EMAIL.test(value))
            .map((email) => ({ email })),
        ]
      : [
          ...picked.map((person) => ({
            contactId: person.contactId,
            name: person.name,
          })),
          ...(handedTo.trim() ? [{ name: handedTo.trim() }] : []),
        ];

  const send = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/quotations/{quotationId}/send", {
        path: { quotationId },
        body: {
          expectedRowVersion: rowVersion,
          channelCode: mode,
          recipients,
          ...(mode === "EMAIL"
            ? {
                ccSelf,
                languageCode: language,
                ...(subject.trim() ? { subject: subject.trim() } : {}),
                ...(message.trim() ? { message: message.trim() } : {}),
              }
            : {}),
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      toast.success(
        mode === "EMAIL"
          ? txt(
              "The quotation is on its way. You will be told if it does not arrive.",
              "عرض السعر في الطريق. هيوصلك تنبيه لو موصلش.",
            )
          : txt("Recorded as sent", "اتسجّل إنه اتبعت"),
      );
      onClose();
      await onSent();
    },
  });

  const ready =
    recipients.length > 0 && (mode === "MANUAL" || badTyped.length === 0);
  return (
    <SlideOver
      title={txt(`Send ${quoteRef}`, `إرسال ${quoteRef}`)}
      onClose={onClose}
    >
      <form
        className="send-quotation"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) send.mutate();
        }}
      >
        <p className="settings-hint">
          {txt("To", "إلى")} <strong>{accountName}</strong>
        </p>
        <div
          className="send-mode"
          role="radiogroup"
          aria-label={txt("How", "إزاي")}
        >
          <label className={mode === "EMAIL" ? "is-active" : ""}>
            <input
              type="radio"
              name="send-mode"
              checked={mode === "EMAIL"}
              disabled={!canEmail}
              onChange={() => {
                setHow("EMAIL");
              }}
            />
            <span>
              <strong>
                {txt("Email it from the system", "ابعته إيميل من السيستم")}
              </strong>
              <small>
                {canEmail
                  ? txt(
                      `From ${text(mail.data?.sender)}, PDF attached, replies come to you.`,
                      `من ${text(mail.data?.sender)}، والـPDF مرفق، والرد بييجي لك.`,
                    )
                  : txt(
                      "Email is not set up yet. An administrator sets it up under Administration → System.",
                      "الإيميل لسه مش متظبط. الأدمن يظبطه من الإدارة ← النظام.",
                    )}
              </small>
            </span>
          </label>
          <label className={mode === "MANUAL" ? "is-active" : ""}>
            <input
              type="radio"
              name="send-mode"
              checked={mode === "MANUAL"}
              onChange={() => {
                setHow("MANUAL");
              }}
            />
            <span>
              <strong>{txt("I sent it myself", "أنا بعته بنفسي")}</strong>
              <small>
                {txt(
                  "From my own Outlook, by hand, or in a meeting — just record it.",
                  "من الأوتلوك بتاعي أو سلّمته بإيدي — سجّله بس.",
                )}
              </small>
            </span>
          </label>
        </div>

        <fieldset className="send-people">
          <legend>{txt("Who receives it", "مين يستلمه")}</legend>
          {people.length === 0 && !contacts.isLoading && (
            <p className="settings-hint">
              {txt(
                "No contacts saved for this customer.",
                "مفيش جهات اتصال متسجلة للعميل ده.",
              )}
            </p>
          )}
          {people.map((person) => {
            const blocked = mode === "EMAIL" && person.email === "";
            return (
              <label
                key={person.contactId}
                className={blocked ? "is-muted" : ""}
              >
                <input
                  type="checkbox"
                  disabled={blocked}
                  checked={chosen.has(person.contactId) && !blocked}
                  onChange={(event) => {
                    const next = new Set(chosen);
                    if (event.target.checked) next.add(person.contactId);
                    else next.delete(person.contactId);
                    setChosen(next);
                  }}
                />
                <span>
                  <strong>{person.name}</strong>
                  {person.role && <small>{person.role}</small>}
                  <small dir="ltr">
                    {person.email ||
                      (mode === "EMAIL" ? txt("no email", "مفيش إيميل") : "")}
                  </small>
                </span>
              </label>
            );
          })}
          {mode === "EMAIL" ? (
            <label className="send-extra">
              {txt("Other email addresses", "إيميلات تانية")}
              <input
                type="text"
                inputMode="email"
                dir="ltr"
                value={extra}
                placeholder="name@company.com"
                onChange={(event) => {
                  setExtra(event.target.value);
                }}
              />
              {badTyped.length > 0 && (
                <small className="form-error">
                  {txt("Not an email address:", "مش عنوان إيميل:")}{" "}
                  {badTyped.join(", ")}
                </small>
              )}
            </label>
          ) : (
            <label className="send-extra">
              {txt("Handed to (name)", "اتسلّم لمين (الاسم)")}
              <input
                value={handedTo}
                onChange={(event) => {
                  setHandedTo(event.target.value);
                }}
              />
            </label>
          )}
        </fieldset>

        {mode === "EMAIL" && (
          <fieldset className="send-message">
            <legend>{txt("Message", "الرسالة")}</legend>
            <label>
              {txt("Language", "اللغة")}
              <select
                value={language}
                onChange={(event) => {
                  setLanguage(event.target.value === "ar" ? "ar" : "en");
                }}
              >
                <option value="en">English</option>
                <option value="ar">العربية</option>
              </select>
            </label>
            <label>
              {txt("Subject", "الموضوع")}
              <input
                value={subject}
                maxLength={250}
                placeholder={
                  language === "ar"
                    ? `عرض سعر ${quoteRef} — أكرو لمنتجات البناء`
                    : `Quotation ${quoteRef} — ACROW Building Products`
                }
                onChange={(event) => {
                  setSubject(event.target.value);
                }}
              />
            </label>
            <label>
              {txt("Message (optional)", "الرسالة (اختياري)")}
              <textarea
                rows={5}
                maxLength={5000}
                value={message}
                placeholder={
                  language === "ar"
                    ? `السادة ${accountName}،\n\nمرفق عرض السعر ${quoteRef}…`
                    : `Dear ${accountName} team,\n\nPlease find attached our quotation ${quoteRef}…`
                }
                onChange={(event) => {
                  setMessage(event.target.value);
                }}
              />
            </label>
            <label className="send-cc">
              <input
                type="checkbox"
                checked={ccSelf}
                onChange={(event) => {
                  setCcSelf(event.target.checked);
                }}
              />
              {txt("Send me a copy", "ابعتلي نسخة")}
            </label>
          </fieldset>
        )}

        <ErrorBanner
          error={send.error ?? contacts.error}
          retry={() => {
            send.reset();
          }}
        />
        <button className="primary" disabled={!ready || send.isPending}>
          {send.isPending
            ? "…"
            : mode === "EMAIL"
              ? txt(
                  `Send to ${String(recipients.length)} ${recipients.length === 1 ? "person" : "people"}`,
                  `ابعت لـ ${String(recipients.length)}`,
                )
              : txt("Record as sent", "سجّل إنه اتبعت")}
        </button>
      </form>
    </SlideOver>
  );
}
