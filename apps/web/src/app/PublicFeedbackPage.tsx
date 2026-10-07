import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { AbpLogo } from "./AbpLogo.tsx";
import { commercialRequest, isObject } from "./commercial-api.ts";
import { ErrorBanner } from "./CommercialUI.tsx";

/**
 * The customer's page: feedback without an account.
 *
 * A customer should not need a username and a password to tell us the boards
 * arrived swollen. They say who they are, how to reach them, and something
 * that ties them to us -- an order, quotation or proforma number, or an item
 * code -- and the right salesperson hears about it. A link from a salesperson
 * can carry the reference already filled in (?ref=SO-000123&type=ORDER).
 */

const KINDS = [
  { code: "SATISFACTION", en: "I'm satisfied", ar: "أنا راضي", icon: "☺" },
  { code: "PROBLEM", en: "I have a problem", ar: "عندي مشكلة", icon: "!" },
  { code: "SUGGESTION", en: "A suggestion", ar: "اقتراح", icon: "✎" },
  { code: "QUESTION", en: "A question", ar: "سؤال", icon: "?" },
] as const;
const TOPICS = [
  { code: "PRODUCT_QUALITY", en: "Product quality", ar: "جودة المنتج" },
  { code: "DELIVERY_DELAY", en: "Delivery was late", ar: "التسليم اتأخر" },
  {
    code: "DAMAGED_GOODS",
    en: "Goods arrived damaged",
    ar: "البضاعة وصلت تالفة",
  },
  { code: "BILLING", en: "Invoice or payment", ar: "الفاتورة أو الدفع" },
  { code: "SERVICE", en: "Service from our team", ar: "الخدمة من فريقنا" },
  { code: "OTHER", en: "Something else", ar: "حاجة تانية" },
];
const REFERENCES = [
  { code: "ORDER", en: "Order number", ar: "رقم الأوردر", hint: "SO-000123" },
  {
    code: "QUOTATION",
    en: "Quotation number",
    ar: "رقم عرض السعر",
    hint: "QT-2026-0010",
  },
  {
    code: "PROFORMA",
    en: "Proforma invoice number",
    ar: "رقم الفاتورة المبدئية",
    hint: "QT-2026-0010",
  },
  { code: "ITEM_CODE", en: "Item code", ar: "كود الصنف", hint: "ACROW-PLY-18" },
  { code: "OTHER", en: "Another reference", ar: "مرجع تاني", hint: "" },
];
const STAR_WORDS = [
  { en: "Very unhappy", ar: "مش راضي خالص" },
  { en: "Unhappy", ar: "مش راضي" },
  { en: "It was okay", ar: "مقبول" },
  { en: "Happy", ar: "راضي" },
  { en: "Delighted", ar: "راضي جدًا" },
];

export function PublicFeedbackPage({ client }: { client: ApiClient }) {
  const { locale, toggle } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const [params] = useSearchParams();
  const initialType = params.get("type") ?? "ORDER";
  const [kind, setKind] = useState("SATISFACTION");
  const [topic, setTopic] = useState("PRODUCT_QUALITY");
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [critical, setCritical] = useState(false);
  const [refType, setRefType] = useState(
    REFERENCES.some((one) => one.code === initialType) ? initialType : "ORDER",
  );
  const [refText, setRefText] = useState(params.get("ref") ?? "");
  const [name, setName] = useState("");
  const [company, setCompany] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [channel, setChannel] = useState("WHATSAPP");
  const [consent, setConsent] = useState(true);
  const [message, setMessage] = useState("");
  const [trap, setTrap] = useState("");

  const send = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        kindCode: kind,
        topicCode: kind === "PROBLEM" ? topic : "OTHER",
        isCritical: critical,
        referenceTypeCode: refType,
        referenceText: refText.trim(),
        contactName: name.trim(),
        preferredChannelCode: channel,
        consentToContact: consent,
        message: message.trim(),
      };
      if (rating > 0) body.rating = rating;
      if (company.trim()) body.companyName = company.trim();
      if (jobTitle.trim()) body.jobTitle = jobTitle.trim();
      if (phone.trim()) body.phone = phone.trim();
      if (email.trim()) body.email = email.trim();
      if (trap) body.website = trap;
      const result = await commercialRequest(
        client,
        "POST",
        "/public/feedback",
        { path: {}, body },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });

  const reference = REFERENCES.find((one) => one.code === refType);
  const contactOk = phone.trim().length >= 7 || /\S+@\S+\.\S+/.test(email);
  const ready =
    refText.trim().length >= 2 &&
    name.trim().length >= 2 &&
    contactOk &&
    message.trim().length >= 5;
  const shown = hover || rating;

  if (send.data) {
    const receipt = send.data;
    return (
      <main className="local-auth-page feedback-page">
        <div className="local-auth-lockup">
          <AbpLogo className="local-auth-wordmark" size="lg" />
        </div>
        <section
          className="local-auth-card feedback-card feedback-done"
          aria-live="polite"
        >
          <div className="feedback-check" aria-hidden="true">
            <svg viewBox="0 0 52 52">
              <circle cx="26" cy="26" r="24" />
              <path d="M15 27 l7 7 l15 -16" />
            </svg>
          </div>
          <h1>{txt("Thank you — we have it.", "شكرًا — وصلتنا.")}</h1>
          <p>
            {txt("Your reference is", "رقمك المرجعي")}{" "}
            <strong>
              {typeof receipt.feedbackRef === "string"
                ? receipt.feedbackRef
                : ""}
            </strong>
          </p>
          <p className="feedback-muted">
            {receipt.escalated === true
              ? txt(
                  "We have treated this as urgent. Someone from our team will contact you very soon.",
                  "اعتبرناها عاجلة. حد من فريقنا هيتواصل معاك قريب جدًا.",
                )
              : receipt.followUp === true
                ? txt(
                    "The person who looks after your account has been told and will get back to you.",
                    "المسؤول عن حسابك اتبلّغ وهيرجعلك.",
                  )
                : txt("Thank you for taking the time.", "شكرًا على وقتك.")}
          </p>
        </section>
      </main>
    );
  }

  return (
    <main className="local-auth-page feedback-page">
      <div className="local-auth-lockup">
        <AbpLogo className="local-auth-wordmark" size="lg" />
        <p className="auth-slogan">
          <span className="auth-slogan-lead">
            {txt("Tell us how we did.", "قولّنا عملنا إيه.")}
          </span>{" "}
          <span className="auth-slogan-accent">
            {txt("We listen.", "إحنا سامعينك.")}
          </span>
        </p>
      </div>
      <section
        className="local-auth-card feedback-card"
        aria-labelledby="feedback-title"
      >
        <div className="local-auth-topline">
          <button className="auth-language" type="button" onClick={toggle}>
            {ar ? "English" : "العربية"}
          </button>
        </div>
        <p className="eyebrow" data-abp-caption>
          {txt("Customer feedback", "رأي العميل")}
        </p>
        <h1 id="feedback-title">{txt("Share your feedback", "شاركنا رأيك")}</h1>
        <p className="feedback-muted">
          {txt(
            "No account needed. Tell us who you are and something that ties you to us, and the right person will hear about it.",
            "مش محتاج حساب. قولّنا إنت مين وأي رقم يربطك بينا، والشخص المسؤول هيوصله كلامك.",
          )}
        </p>
        <form
          className="feedback-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) send.mutate();
          }}
        >
          <fieldset className="feedback-kinds">
            <legend>
              {txt("What would you like to tell us?", "عايز تقولنا إيه؟")}
            </legend>
            {KINDS.map((one) => (
              <label
                key={one.code}
                className={kind === one.code ? "is-picked" : ""}
              >
                <input
                  type="radio"
                  name="kind"
                  value={one.code}
                  checked={kind === one.code}
                  onChange={() => {
                    setKind(one.code);
                  }}
                />
                <span className="feedback-kind-icon" aria-hidden="true">
                  {one.icon}
                </span>
                {ar ? one.ar : one.en}
              </label>
            ))}
          </fieldset>

          <fieldset className="feedback-stars">
            <legend>
              {txt("How satisfied are you overall?", "راضي قد إيه بشكل عام؟")}
            </legend>
            <div
              className="feedback-star-row"
              onMouseLeave={() => {
                setHover(0);
              }}
            >
              {[1, 2, 3, 4, 5].map((star) => (
                <button
                  key={star}
                  type="button"
                  className={`feedback-star${star <= shown ? " is-on" : ""}`}
                  aria-label={`${String(star)} / 5`}
                  aria-pressed={rating === star}
                  onMouseEnter={() => {
                    setHover(star);
                  }}
                  onClick={() => {
                    setRating(rating === star ? 0 : star);
                  }}
                >
                  ★
                </button>
              ))}
              <span className="feedback-star-word">
                {shown > 0
                  ? ar
                    ? STAR_WORDS[shown - 1]?.ar
                    : STAR_WORDS[shown - 1]?.en
                  : txt("Optional", "اختياري")}
              </span>
            </div>
          </fieldset>

          {kind === "PROBLEM" && (
            <div className="feedback-grid">
              <label>
                {txt("What is it about?", "المشكلة في إيه؟")}
                <select
                  value={topic}
                  onChange={(event) => {
                    setTopic(event.target.value);
                  }}
                >
                  {TOPICS.map((one) => (
                    <option key={one.code} value={one.code}>
                      {ar ? one.ar : one.en}
                    </option>
                  ))}
                </select>
              </label>
              <label className="feedback-critical">
                <input
                  type="checkbox"
                  checked={critical}
                  onChange={() => {
                    setCritical(!critical);
                  }}
                />
                <span>
                  <strong>{txt("It's critical", "الموضوع حرج")}</strong>
                  <small>
                    {txt(
                      "Work on site is stopped or at risk",
                      "الشغل في الموقع واقف أو في خطر",
                    )}
                  </small>
                </span>
              </label>
            </div>
          )}

          <div className="feedback-grid">
            <label>
              {txt("Your reference", "المرجع")}
              <select
                value={refType}
                onChange={(event) => {
                  setRefType(event.target.value);
                }}
              >
                {REFERENCES.map((one) => (
                  <option key={one.code} value={one.code}>
                    {ar ? one.ar : one.en}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {ar ? reference?.ar : reference?.en}
              <input
                required
                value={refText}
                maxLength={120}
                placeholder={
                  reference?.hint
                    ? `${txt("e.g.", "مثلًا")} ${reference.hint}`
                    : ""
                }
                onChange={(event) => {
                  setRefText(event.target.value);
                }}
              />
            </label>
          </div>

          <div className="feedback-grid">
            <label>
              {txt("Your name", "اسمك")}
              <input
                required
                value={name}
                maxLength={150}
                autoComplete="name"
                onChange={(e) => {
                  setName(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Company", "الشركة")}
              <input
                value={company}
                maxLength={200}
                autoComplete="organization"
                onChange={(e) => {
                  setCompany(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Your role (optional)", "وظيفتك (اختياري)")}
              <input
                value={jobTitle}
                maxLength={120}
                autoComplete="organization-title"
                onChange={(e) => {
                  setJobTitle(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Mobile", "الموبايل")}
              <input
                value={phone}
                maxLength={30}
                inputMode="tel"
                autoComplete="tel"
                placeholder="010 0000 0000"
                onChange={(e) => {
                  setPhone(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Email", "الإيميل")}
              <input
                type="email"
                value={email}
                maxLength={254}
                autoComplete="email"
                onChange={(e) => {
                  setEmail(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Best way to reach you", "أنسب طريقة نكلمك بيها")}
              <select
                value={channel}
                onChange={(event) => {
                  setChannel(event.target.value);
                }}
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="PHONE">{txt("Phone call", "مكالمة")}</option>
                <option value="EMAIL">{txt("Email", "إيميل")}</option>
              </select>
            </label>
          </div>
          {!contactOk && (phone || email) && (
            <p className="feedback-hint">
              {txt(
                "A mobile number or an email, please.",
                "رقم موبايل أو إيميل لو سمحت.",
              )}
            </p>
          )}

          <label>
            {kind === "PROBLEM"
              ? txt("What happened?", "إيه اللي حصل؟")
              : txt("Your message", "رسالتك")}
            <textarea
              required
              rows={5}
              value={message}
              maxLength={4000}
              onChange={(event) => {
                setMessage(event.target.value);
              }}
            />
          </label>
          {/* Hidden from people; bots fill it in. */}
          <label className="feedback-trap" aria-hidden="true">
            Website
            <input
              tabIndex={-1}
              autoComplete="off"
              value={trap}
              onChange={(e) => {
                setTrap(e.target.value);
              }}
            />
          </label>
          <label className="auth-remember">
            <input
              type="checkbox"
              checked={consent}
              onChange={() => {
                setConsent(!consent);
              }}
            />
            {txt(
              "You may contact me about this",
              "ممكن تتواصلوا معايا بخصوص ده",
            )}
          </label>
          <ErrorBanner
            error={send.error}
            retry={() => {
              send.mutate();
            }}
          />
          <button
            className="primary feedback-submit"
            disabled={!ready || send.isPending}
          >
            {send.isPending ? "…" : txt("Send feedback", "ابعت رأيك")}
          </button>
          <p className="feedback-muted feedback-privacy">
            {txt(
              "We use your details only to answer you about this feedback.",
              "بنستخدم بياناتك بس عشان نرد عليك بخصوص الرأي ده.",
            )}
          </p>
        </form>
      </section>
    </main>
  );
}
