import { createHash } from "node:crypto";
import { mkdir, readFile, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { chromium } from "playwright";
import type { DurableJobHandler } from "@abp/database";
import { ABP_LOGO_PNG_BASE64 } from "./assets/logo.js";
import { readMailConfig } from "./mail/mail-config.js";
import { escapeHtml, type Lang } from "./mail/mail-templates.js";

/**
 * The order confirmation: what the customer ordered, at what price, on what
 * terms, delivered when -- the document a buyer files against their PO. Built
 * from the booked order, never from the quotation, so an amendment shows.
 */

export interface ConfirmationData {
  orderRef: string;
  amendmentNo: number;
  confirmedAt: Date | null;
  customerName: string;
  customerPoNumber: string | null;
  quotationRef: string | null;
  requestedDeliveryDate: Date | null;
  deliveryTerms: string | null;
  deliveryPoint: string | null;
  currencyCode: string;
  subtotal: number;
  adjustment: number;
  vatRate: number;
  tax: number;
  total: number;
  paymentTermsText: string | null;
  notes: string | null;
  salesName: string;
  salesEmail: string | null;
  lines: {
    lineNo: number;
    itemCode: string | null;
    description: string;
    quantity: number;
    unitCode: string;
    unitPrice: number;
    lineTotal: number;
  }[];
  installments: { label: string; dueDate: Date | null; amount: number }[];
}

const t = (lang: Lang, en: string, ar: string) => (lang === "ar" ? ar : en);

function money(value: number, currency: string, lang: Lang) {
  return `${value.toLocaleString(lang === "ar" ? "ar-EG" : "en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} ${currency.trim()}`;
}

function date(value: Date | null, lang: Lang) {
  return value
    ? value.toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
        timeZone: "Africa/Cairo",
      })
    : "—";
}

export function orderConfirmationHtml(d: ConfirmationData, lang: Lang): string {
  const e = escapeHtml;
  const rtl = lang === "ar";
  const cur = d.currencyCode;
  const fact = (label: string, value: string | null) =>
    value ? `<tr><th>${e(label)}</th><td>${e(value)}</td></tr>` : "";
  const lines = d.lines
    .map(
      (line) => `<tr>
        <td class="n">${String(line.lineNo)}</td>
        <td>${line.itemCode ? `<b>${e(line.itemCode)}</b><br>` : ""}${e(line.description)}</td>
        <td class="n">${e(line.quantity.toLocaleString("en-US"))} ${e(line.unitCode)}</td>
        <td class="n">${e(money(line.unitPrice, cur, lang))}</td>
        <td class="n">${e(money(line.lineTotal, cur, lang))}</td>
      </tr>`,
    )
    .join("");
  const schedule = d.installments.length
    ? `<h2>${e(t(lang, "Payment schedule", "جدول الدفع"))}</h2>
       <table class="grid"><thead><tr>
         <th>${e(t(lang, "Installment", "الدفعة"))}</th>
         <th>${e(t(lang, "Due", "الاستحقاق"))}</th>
         <th class="n">${e(t(lang, "Amount", "المبلغ"))}</th></tr></thead><tbody>
         ${d.installments
           .map(
             (row) =>
               `<tr><td>${e(row.label)}</td><td>${e(row.dueDate ? date(row.dueDate, lang) : t(lang, "On the agreed event", "عند الحدث المتفق عليه"))}</td><td class="n">${e(money(row.amount, cur, lang))}</td></tr>`,
           )
           .join("")}</tbody></table>`
    : "";
  return `<!doctype html><html lang="${lang}" dir="${rtl ? "rtl" : "ltr"}"><head><meta charset="utf-8">
<style>
  @page { size: A4; margin: 14mm; }
  body { font-family: ${rtl ? "Tahoma, 'Segoe UI'" : "'Segoe UI', Arial"}, sans-serif; color: #14213D; font-size: 11px; }
  header { display: flex; justify-content: space-between; align-items: center; border-bottom: 3px solid #C8102E; padding-bottom: 10px; }
  header img { height: 42px; }
  h1 { font-size: 20px; margin: 14px 0 2px; }
  h2 { font-size: 13px; margin: 18px 0 6px; }
  .sub { color: #5B6475; margin: 0 0 12px; }
  .facts th { text-align: ${rtl ? "right" : "left"}; color: #5B6475; font-weight: 600; padding: 3px 12px 3px 0; white-space: nowrap; }
  .facts td { padding: 3px 0; }
  table.grid { width: 100%; border-collapse: collapse; }
  table.grid th { background: #14213D; color: #fff; padding: 6px; text-align: ${rtl ? "right" : "left"}; font-weight: 600; }
  table.grid td { border-bottom: 1px solid #E3E7EE; padding: 6px; vertical-align: top; }
  .n, table.grid th.n, table.grid td.n { text-align: ${rtl ? "left" : "right"}; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .totals { margin-${rtl ? "right" : "left"}: auto; margin-top: 10px; }
  .totals td { padding: 3px 0 3px 24px; }
  .totals .grand td { font-weight: 700; font-size: 13px; border-top: 2px solid #14213D; padding-top: 6px; }
  footer { margin-top: 26px; color: #5B6475; border-top: 1px solid #E3E7EE; padding-top: 8px; }
</style></head><body>
<header><img src="data:image/png;base64,${ABP_LOGO_PNG_BASE64}" alt="ACROW"><div>${e(t(lang, "ACROW Building Products", "أكرو لمنتجات البناء"))}</div></header>
<h1>${e(t(lang, "Order confirmation", "تأكيد أمر التوريد"))} ${e(d.orderRef)}${d.amendmentNo > 0 ? ` <small>(${e(t(lang, "amendment", "تعديل"))} ${String(d.amendmentNo)})</small>` : ""}</h1>
<p class="sub">${e(t(lang, "We confirm your order as follows.", "نؤكد طلبكم كالتالي."))}</p>
<table class="facts">
  ${fact(t(lang, "Customer", "العميل"), d.customerName)}
  ${fact(t(lang, "Your PO", "أمر الشراء"), d.customerPoNumber)}
  ${fact(t(lang, "Our quotation", "عرض السعر"), d.quotationRef)}
  ${fact(t(lang, "Confirmed on", "تاريخ التأكيد"), d.confirmedAt ? date(d.confirmedAt, lang) : null)}
  ${fact(t(lang, "Requested delivery", "التسليم المطلوب"), d.requestedDeliveryDate ? date(d.requestedDeliveryDate, lang) : null)}
  ${fact(t(lang, "Delivery terms", "شروط التسليم"), d.deliveryTerms)}
  ${fact(t(lang, "Delivery point", "مكان التسليم"), d.deliveryPoint)}
</table>
<h2>${e(t(lang, "Items", "البنود"))}</h2>
<table class="grid"><thead><tr><th>#</th><th>${e(t(lang, "Item", "الصنف"))}</th><th class="n">${e(t(lang, "Quantity", "الكمية"))}</th><th class="n">${e(t(lang, "Unit price", "سعر الوحدة"))}</th><th class="n">${e(t(lang, "Total", "الإجمالي"))}</th></tr></thead><tbody>${lines}</tbody></table>
<table class="totals">
  <tr><td>${e(t(lang, "Subtotal", "الإجمالي قبل الضريبة"))}</td><td class="n">${e(money(d.subtotal, cur, lang))}</td></tr>
  ${Math.abs(d.adjustment) >= 0.005 ? `<tr><td>${e(t(lang, "Adjustment", "تسوية"))}</td><td class="n">${e(money(d.adjustment, cur, lang))}</td></tr>` : ""}
  <tr><td>${e(t(lang, "VAT", "ضريبة القيمة المضافة"))} ${e((d.vatRate * 100).toFixed(0))}%</td><td class="n">${e(money(d.tax, cur, lang))}</td></tr>
  <tr class="grand"><td>${e(t(lang, "Total", "الإجمالي"))}</td><td class="n">${e(money(d.total, cur, lang))}</td></tr>
</table>
${d.paymentTermsText ? `<h2>${e(t(lang, "Payment terms", "شروط الدفع"))}</h2><p>${e(d.paymentTermsText)}</p>` : ""}
${schedule}
${d.notes ? `<h2>${e(t(lang, "Notes", "ملاحظات"))}</h2><p>${e(d.notes)}</p>` : ""}
<footer>${e(t(lang, "Your sales engineer", "مهندس المبيعات"))}: ${e(d.salesName)}${d.salesEmail ? ` · ${e(d.salesEmail)}` : ""}</footer>
</body></html>`;
}

function objectPath(key: string): string {
  return resolve(
    process.env.ABP_LOCAL_OBJECT_ROOT ?? ".tmp/object-storage",
    key,
  );
}

/**
 * Render the confirmation, keep the PDF with the order's documents, and queue
 * the email that carries it.
 */
export function orderConfirmationHandler(): DurableJobHandler {
  return async (job, dependencies) => {
    const payload = (job.payload ?? {}) as Record<string, unknown>;
    const str = (value: unknown) => (typeof value === "string" ? value : "");
    const orderId = str(payload.customerOrderId);
    const actorUserId = str(payload.createdByUserId);
    const lang: Lang = payload.languageCode === "ar" ? "ar" : "en";
    const recipients = (
      Array.isArray(payload.recipients) ? payload.recipients : []
    )
      .map((r) => str((r as Record<string, unknown>).email).trim())
      .filter((email) => email.includes("@"));
    if (!orderId || !actorUserId || recipients.length === 0)
      throw Object.assign(new Error("ORDER_CONFIRMATION_INVALID"), {
        code: "ORDER_CONFIRMATION_INVALID",
      });
    if (readMailConfig().provider === "NONE")
      throw Object.assign(new Error("EMAIL_NOT_CONFIGURED"), {
        code: "EMAIL_NOT_CONFIGURED",
      });

    const db = dependencies.database;
    const order = await db.customerOrder.findUnique({
      where: { id: orderId },
      include: {
        account: { select: { canonicalName: true } },
        lines: { orderBy: { lineNo: "asc" } },
        installments: { orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }] },
      },
    });
    if (!order)
      throw Object.assign(new Error("ORDER_NOT_FOUND"), {
        code: "ORDER_NOT_FOUND",
      });
    const [quotation, actor] = await Promise.all([
      db.quotation.findUnique({
        where: { id: order.quotationId },
        select: { quotationRef: true },
      }),
      db.appUser.findUnique({
        where: { id: actorUserId },
        select: { displayName: true, emailNormalized: true },
      }),
    ]);
    const actorEmail = actor?.emailNormalized.includes("@")
      ? actor.emailNormalized
      : null;
    const html = orderConfirmationHtml(
      {
        orderRef: order.orderRef,
        amendmentNo: order.amendmentNo,
        confirmedAt: order.confirmedAt,
        customerName: order.account.canonicalName,
        customerPoNumber: order.customerPoNumber,
        quotationRef: quotation?.quotationRef ?? null,
        requestedDeliveryDate: order.requestedDeliveryDate,
        deliveryTerms: order.deliveryTerms,
        deliveryPoint: order.deliveryPoint,
        currencyCode: order.currencyCode,
        subtotal: Number(order.subtotalAmount),
        adjustment: Number(order.adjustmentAmount),
        vatRate: Number(order.vatRate),
        tax: Number(order.taxAmount),
        total: Number(order.totalAmount),
        paymentTermsText: order.paymentTermsText,
        notes: order.notes,
        salesName: actor?.displayName ?? "ACROW",
        salesEmail: actorEmail,
        lines: order.lines.map((line) => ({
          lineNo: line.lineNo,
          itemCode: line.itemCode,
          description: line.description,
          quantity: Number(line.quantity),
          unitCode: line.unitCode,
          unitPrice: Number(line.unitPrice),
          lineTotal: Number(line.lineTotal),
        })),
        installments: order.installments
          .filter((row) => row.statusCode !== "CANCELLED")
          .map((row) => ({
            label: row.label,
            dueDate: row.dueDate,
            amount: Number(row.amount),
          })),
      },
      lang,
    );

    const fileName = `${order.orderRef}-confirmation${order.amendmentNo > 0 ? `-A${String(order.amendmentNo)}` : ""}.pdf`;
    const key = `order-confirmations/${order.id}/${job.jobId}.pdf`;
    const file = objectPath(key);
    await mkdir(dirname(file), { recursive: true });
    try {
      await stat(file);
    } catch {
      const browser = await chromium.launch({
        headless: true,
        ...(process.env.ABP_CHROMIUM_EXECUTABLE_PATH
          ? { executablePath: process.env.ABP_CHROMIUM_EXECUTABLE_PATH }
          : {}),
      });
      try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: "load" });
        await page.pdf({ path: file, format: "A4", printBackground: true });
      } finally {
        await browser.close();
      }
    }
    const bytes = await readFile(file);

    const greeting =
      typeof payload.message === "string" && payload.message.trim()
        ? payload.message.trim()
        : t(
            lang,
            `Dear ${order.account.canonicalName} team,\n\nThank you for your order. Please find attached our confirmation of ${order.orderRef}.\n\nBest regards,`,
            `السادة ${order.account.canonicalName}،\n\nشكراً لطلبكم. مرفق تأكيد أمر التوريد ${order.orderRef}.\n\nمع خالص التحية،`,
          );
    const signature = [
      actor?.displayName ?? "",
      actorEmail ?? "",
      "ACROW Building Products",
    ]
      .filter(Boolean)
      .join("\n");
    const paragraphs = (text: string) =>
      text
        .split(/\n\s*\n/)
        .map(
          (p) =>
            `<p style="margin:0 0 12px;line-height:1.6">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`,
        )
        .join("");

    await dependencies.transactionManager.run(
      { traceId: job.traceId, correlationId: job.correlationId },
      async (tx) => {
        const document = await tx.documentMetadata.create({
          data: {
            resourceTypeCode: "CUSTOMER_ORDER",
            resourceId: order.id,
            storageKey: key,
            mimeType: "application/pdf",
            sizeBytes: BigInt(bytes.length),
            fileHash: createHash("sha256").update(bytes).digest("hex"),
            classificationCode: "COMMERCIAL_CONFIDENTIAL",
            documentTypeCode: "ORDER_CONFIRMATION",
            title: fileName,
            statusCode: "AVAILABLE",
            isFinal: true,
            createdByUserId: actorUserId,
          },
        });
        await tx.emailMessage.create({
          data: {
            purposeCode: "ORDER_CONFIRMATION",
            toAddresses: recipients,
            ccAddresses:
              payload.ccSelf === true && actorEmail ? [actorEmail] : [],
            replyTo: actorEmail,
            subject: t(
              lang,
              `Order confirmation ${order.orderRef} — ACROW Building Products`,
              `تأكيد أمر التوريد ${order.orderRef} — أكرو لمنتجات البناء`,
            ),
            bodyHtml: `<div dir="${lang === "ar" ? "rtl" : "ltr"}" style="font-family:${lang === "ar" ? "Tahoma," : ""}'Segoe UI',Arial,sans-serif;color:#14213D;max-width:600px"><p style="font-size:18px;font-weight:700;border-bottom:3px solid #C8102E;padding-bottom:8px">ACROW</p>${paragraphs(greeting)}${paragraphs(signature)}</div>`,
            bodyText: `${greeting}\n\n${signature}`,
            attachments: [
              { storageKey: key, fileName, mimeType: "application/pdf" },
            ],
            resourceTypeCode: "CUSTOMER_ORDER",
            resourceId: order.id,
            createdByUserId: actorUserId || null,
          },
        });
        await tx.auditEvent.create({
          data: {
            actorUserId: actorUserId || null,
            actionCode: "ORDER_CONFIRMATION_QUEUED",
            resourceType: "CustomerOrder",
            resourceId: order.id,
            workspace: "SALES",
            countryCode: order.countryCode,
            metadata: { documentId: document.id, recipients },
            traceId: job.traceId,
            correlationId: job.correlationId,
            source: "worker",
          },
        });
      },
    );
    return { resultReference: `order-confirmation:${order.id}` };
  };
}
