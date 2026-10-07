import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import { ErrorBanner, SlideOver, useToast } from "./CommercialUI.tsx";

/**
 * Emailing the customer their order confirmation: the PDF of what they
 * ordered, at what price and on what terms, from the company mailbox, with
 * replies coming back to the salesperson.
 */

const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function OrderConfirmationButton(props: {
  client: ApiClient;
  orderId: string;
  orderRef: string;
  accountId: string;
  accountName: string;
  onSent: () => Promise<void> | void;
}) {
  const { locale } = useI18n();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="ghost"
        onClick={() => {
          setOpen(true);
        }}
      >
        {locale === "ar" ? "ابعت تأكيد الأوردر" : "Send confirmation"}
      </button>
      {open && (
        <OrderConfirmationDialog
          {...props}
          onClose={() => {
            setOpen(false);
          }}
        />
      )}
    </>
  );
}

function OrderConfirmationDialog({
  client,
  orderId,
  orderRef,
  accountId,
  accountName,
  onSent,
  onClose,
}: {
  client: ApiClient;
  orderId: string;
  orderRef: string;
  accountId: string;
  accountName: string;
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
        { path: {} },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
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
  const canEmail = mail.data?.configured === true;
  const people = (contacts.data ?? [])
    .map((row) => ({
      contactId: text(row.contactId),
      name: text(row.displayName),
      role: text(row.jobTitle),
      email: isObject(row.primaryChannel) ? text(row.primaryChannel.value) : "",
    }))
    .filter((person) => person.email !== "");

  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [extra, setExtra] = useState("");
  const [language, setLanguage] = useState<"en" | "ar">(ar ? "ar" : "en");
  const [message, setMessage] = useState("");
  const [ccSelf, setCcSelf] = useState(true);
  const typed = extra
    .split(/[,;\s]+/)
    .map((value) => value.trim())
    .filter((value) => value !== "");
  const badTyped = typed.filter((value) => !EMAIL.test(value));
  const recipients = [
    ...people
      .filter((person) => chosen.has(person.contactId))
      .map((person) => ({
        contactId: person.contactId,
        name: person.name,
        email: person.email,
      })),
    ...typed.filter((value) => EMAIL.test(value)).map((email) => ({ email })),
  ];

  const send = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "POST",
        "/customer-orders/{customerOrderId}/confirmation-emails",
        {
          path: { customerOrderId: orderId },
          body: {
            recipients,
            ccSelf,
            languageCode: language,
            ...(message.trim() ? { message: message.trim() } : {}),
          },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: async () => {
      toast.success(
        txt(
          "The confirmation is on its way. You will be told if it does not arrive.",
          "التأكيد في الطريق. هيوصلك تنبيه لو موصلش.",
        ),
      );
      onClose();
      await onSent();
    },
  });

  const ready = canEmail && recipients.length > 0 && badTyped.length === 0;
  return (
    <SlideOver
      title={txt(
        `Confirm ${orderRef} to the customer`,
        `تأكيد ${orderRef} للعميل`,
      )}
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
          {canEmail
            ? txt(
                `A PDF of the order — items, prices, VAT, payment schedule and delivery — goes to ${accountName} from ${text(mail.data?.sender)}. Replies come to you.`,
                `PDF بالأوردر — البنود والأسعار والضريبة وجدول الدفع والتسليم — هيروح لـ ${accountName} من ${text(mail.data?.sender)}. والرد بييجي لك.`,
              )
            : txt(
                "Email is not set up yet. An administrator sets it up under Administration → System.",
                "الإيميل لسه مش متظبط. الأدمن يظبطه من الإدارة ← النظام.",
              )}
        </p>
        <fieldset className="send-people">
          <legend>{txt("Who receives it", "مين يستلمه")}</legend>
          {people.length === 0 && !contacts.isLoading && (
            <p className="settings-hint">
              {txt(
                "No contact of this customer has an email saved. Type the address below.",
                "مفيش جهة اتصال للعميل ده ليها إيميل. اكتب الإيميل تحت.",
              )}
            </p>
          )}
          {people.map((person) => (
            <label key={person.contactId}>
              <input
                type="checkbox"
                checked={chosen.has(person.contactId)}
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
                <small dir="ltr">{person.email}</small>
              </span>
            </label>
          ))}
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
        </fieldset>
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
            {txt("Message (optional)", "الرسالة (اختياري)")}
            <textarea
              rows={4}
              maxLength={5000}
              value={message}
              placeholder={
                language === "ar"
                  ? `السادة ${accountName}،\n\nشكراً لطلبكم. مرفق تأكيد أمر التوريد ${orderRef}.`
                  : `Dear ${accountName} team,\n\nThank you for your order. Please find attached our confirmation of ${orderRef}.`
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
        <ErrorBanner
          error={send.error ?? contacts.error}
          retry={() => {
            send.reset();
          }}
        />
        <button className="primary" disabled={!ready || send.isPending}>
          {send.isPending
            ? "…"
            : txt(
                `Send to ${String(recipients.length)} ${recipients.length === 1 ? "person" : "people"}`,
                `ابعت لـ ${String(recipients.length)}`,
              )}
        </button>
      </form>
    </SlideOver>
  );
}
