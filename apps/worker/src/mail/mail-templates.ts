/**
 * What the emails look like: one ACROW layout, Arabic or English, built from
 * tables and inline styles because that is what Outlook renders faithfully.
 * Everything a person typed is escaped before it goes in.
 */

export type Lang = "en" | "ar";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

const RED = "#C8102E";
const NAVY = "#14213D";
const MUTED = "#5B6475";
const LINE = "#E3E7EE";

export function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );
}

/** Typed text as paragraphs: blank lines split them, single breaks stay. */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .filter((block) => block.trim() !== "")
    .map(
      (block) =>
        `<p style="margin:0 0 14px;line-height:1.6">${escapeHtml(block.trim()).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");
}

function layout(input: {
  lang: Lang;
  heading: string;
  bodyHtml: string;
  button?: { label: string; url: string };
  footer: string;
}): string {
  const rtl = input.lang === "ar";
  const align = rtl ? "right" : "left";
  const font = rtl
    ? "Tahoma, 'Segoe UI', Arial, sans-serif"
    : "'Segoe UI', Arial, sans-serif";
  const button = input.button
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="background:${RED};border-radius:6px"><a href="${escapeHtml(input.button.url)}" style="display:inline-block;padding:11px 22px;color:#ffffff;text-decoration:none;font-weight:600;font-family:${font}">${escapeHtml(input.button.label)}</a></td></tr></table>`
    : "";
  return `<!doctype html><html lang="${input.lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#F3F5F9">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F9;padding:24px 12px"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border:1px solid ${LINE};border-radius:8px;font-family:${font};color:${NAVY};text-align:${align}" dir="${rtl ? "rtl" : "ltr"}">
<tr><td style="padding:20px 28px;border-bottom:3px solid ${RED}"><span style="font-size:20px;font-weight:700;letter-spacing:0.5px;color:${NAVY}">ACROW</span> <span style="font-size:12px;color:${MUTED}">Building Products</span></td></tr>
<tr><td style="padding:26px 28px 8px"><h1 style="margin:0 0 16px;font-size:20px;line-height:1.35;color:${NAVY}">${escapeHtml(input.heading)}</h1>${input.bodyHtml}${button}</td></tr>
<tr><td style="padding:18px 28px 24px;font-size:12px;line-height:1.5;color:${MUTED};border-top:1px solid ${LINE}">${escapeHtml(input.footer)}</td></tr>
</table></td></tr></table></body></html>`;
}

const t = (lang: Lang, en: string, ar: string) => (lang === "ar" ? ar : en);

/** The quotation, to the customer, from the salesperson. */
export function quotationEmail(input: {
  lang: Lang;
  subject: string | null;
  message: string | null;
  quotationRef: string;
  customerName: string;
  salesName: string;
  salesEmail: string | null;
}): RenderedEmail {
  const { lang } = input;
  const subject =
    input.subject?.trim() ||
    t(
      lang,
      `Quotation ${input.quotationRef} — ACROW Building Products`,
      `عرض سعر ${input.quotationRef} — أكرو لمنتجات البناء`,
    );
  const message =
    input.message?.trim() ||
    t(
      lang,
      `Dear ${input.customerName} team,\n\nPlease find attached our quotation ${input.quotationRef}. We will be glad to answer any question.\n\nBest regards,`,
      `السادة ${input.customerName}،\n\nمرفق عرض السعر ${input.quotationRef}. يسعدنا الرد على أي استفسار.\n\nمع خالص التحية،`,
    );
  const signature = [
    input.salesName,
    input.salesEmail ?? "",
    "ACROW Building Products",
  ]
    .filter((line) => line !== "")
    .join("\n");
  const html = layout({
    lang,
    heading: t(
      lang,
      `Quotation ${input.quotationRef}`,
      `عرض سعر ${input.quotationRef}`,
    ),
    bodyHtml: `${paragraphs(message)}${paragraphs(signature)}<p style="margin:8px 0 0;font-size:13px;color:${MUTED}">${escapeHtml(t(lang, `The quotation is attached as ${input.quotationRef}.pdf.`, `عرض السعر مرفق في الملف ${input.quotationRef}.pdf.`))}</p>`,
    footer: t(
      lang,
      "Replies to this email reach your ACROW sales engineer directly.",
      "الرد على الإيميل ده بيوصل لمهندس المبيعات بتاعك في أكرو مباشرة.",
    ),
  });
  return {
    subject,
    html,
    text: `${message}\n\n${signature}\n\n${t(lang, `Attached: ${input.quotationRef}.pdf`, `مرفق: ${input.quotationRef}.pdf`)}`,
  };
}

/** New notifications for one person, gathered into one email. */
export function notificationDigest(input: {
  lang: Lang;
  name: string;
  appUrl: string;
  items: { title: string; body: string | null; path: string }[];
}): RenderedEmail {
  const { lang, items } = input;
  const first = items[0];
  const subject =
    items.length === 1 && first
      ? first.title
      : t(
          lang,
          `${String(items.length)} updates in ABP Commercial`,
          `${String(items.length)} تحديثات في نظام ABP التجاري`,
        );
  const rows = items
    .map(
      (item) =>
        `<tr><td style="padding:12px 0;border-bottom:1px solid ${LINE}"><a href="${escapeHtml(input.appUrl + item.path)}" style="color:${NAVY};font-weight:600;text-decoration:none">${escapeHtml(item.title)}</a>${item.body ? `<div style="margin-top:4px;font-size:13px;line-height:1.5;color:${MUTED}">${escapeHtml(item.body)}</div>` : ""}</td></tr>`,
    )
    .join("");
  const html = layout({
    lang,
    heading: t(lang, `Hello ${input.name},`, `أهلاً ${input.name}،`),
    bodyHtml: `<p style="margin:0 0 6px;line-height:1.6">${escapeHtml(t(lang, "Here is what needs your attention:", "دي الحاجات اللي محتاجة منك نظرة:"))}</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>`,
    button: {
      label: t(lang, "Open ABP Commercial", "افتح النظام"),
      url: `${input.appUrl}/notifications`,
    },
    footer: t(
      lang,
      "You get these emails because email notifications are on in your Settings. Turn them off there at any time.",
      "الإيميلات دي بتوصلك علشان إشعارات الإيميل شغالة في الإعدادات. تقدر تقفلها من هناك في أي وقت.",
    ),
  });
  const text = items
    .map(
      (item) =>
        `- ${item.title}${item.body ? `\n  ${item.body}` : ""}\n  ${input.appUrl}${item.path}`,
    )
    .join("\n\n");
  return { subject, html, text };
}

/** Proof that the mail settings work, sent from Administration. */
export function testEmail(input: {
  lang: Lang;
  name: string;
  provider: string;
}): RenderedEmail {
  const { lang } = input;
  const html = layout({
    lang,
    heading: t(lang, "Email is working", "الإيميل شغال"),
    bodyHtml: paragraphs(
      t(
        lang,
        `Hello ${input.name},\n\nThis test message left ABP Commercial through ${input.provider}. Quotations and notifications will be sent the same way.`,
        `أهلاً ${input.name}،\n\nالرسالة التجريبية دي خرجت من النظام عن طريق ${input.provider}. عروض الأسعار والإشعارات هتتبعت بنفس الطريقة.`,
      ),
    ),
    footer: "ABP Commercial",
  });
  return {
    subject: t(lang, "ABP Commercial — test email", "نظام ABP — إيميل تجريبي"),
    html,
    text: t(
      lang,
      "Email from ABP Commercial is working.",
      "الإيميل من النظام شغال.",
    ),
  };
}

/** A message the system could not deliver, told to whoever sent it. */
export function undeliveredNotice(lang: Lang, subject: string, reason: string) {
  return {
    title: t(
      lang,
      `Email not delivered: ${subject}`,
      `الإيميل موصلش: ${subject}`,
    ).slice(0, 200),
    body: reason.slice(0, 480),
  };
}
