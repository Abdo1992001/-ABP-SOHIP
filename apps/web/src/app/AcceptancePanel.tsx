import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, useToast } from "./CommercialUI.tsx";
import { localToday } from "../lib/today.ts";

/**
 * The customer said yes.
 *
 * This is the revenue event of the whole system and nothing could trigger it.
 * `POST /quotations/{id}/acceptances` requires the quotation to have been
 * sent, requires evidence, and then **moves the opportunity to WON** — writing
 * a stage transition and a won-at date. With no screen for it, a deal could
 * only be marked won some other way, which means the pipeline, the forecast
 * and the targets were all measuring something other than what closed.
 *
 * The evidence rule is the server's (`ACCEPTANCE_EVIDENCE_REQUIRED`: a
 * document or an external reference, not neither) and it is a good commercial
 * rule, so the screen states it rather than just enforcing it. A deal is won
 * when you have the evidence, not when you have the promise.
 */

/**
 * How a customer says yes, in the order it actually happens in this business.
 * A purchase order is the strongest and the one finance will ask for; a
 * WhatsApp message is real but weakest, so it is last rather than absent.
 */
const EVIDENCE = [
  {
    code: "PO",
    en: "Purchase order",
    ar: "أمر شراء",
    placeholderEn: "PO number",
    placeholderAr: "رقم أمر الشراء",
  },
  {
    code: "SIGNED",
    en: "Signed quotation",
    ar: "عرض موقّع",
    placeholderEn: "Where the signed copy is filed",
    placeholderAr: "النسخة الموقّعة محفوظة فين",
  },
  {
    code: "EMAIL",
    en: "Email confirmation",
    ar: "تأكيد بالإيميل",
    placeholderEn: "Subject or sender",
    placeholderAr: "الموضوع أو المرسل",
  },
  {
    code: "WHATSAPP",
    en: "WhatsApp message",
    ar: "رسالة واتساب",
    placeholderEn: "Who sent it, and when",
    placeholderAr: "مين بعتها وإمتى",
  },
] as const;

export function AcceptancePanel({
  client,
  me,
  quotationId,
  quotationRef,
  statusCode,
  onAccepted,
}: {
  client: ApiClient;
  me: Me;
  quotationId: string;
  quotationRef: string;
  statusCode: string;
  onAccepted: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();

  const [evidenceType, setEvidenceType] = useState<string>("PO");
  const [reference, setReference] = useState("");
  const [acceptedOn, setAcceptedOn] = useState(() => localToday());
  const [confirming, setConfirming] = useState(false);

  const canAccept = me.access.permissions.includes("quotations.accept");

  const accept = useMutation({
    mutationFn: async () => {
      const result = await commercialRequest(
        client,
        "POST",
        "/quotations/{quotationId}/acceptances",
        {
          path: { quotationId },
          body: {
            evidenceTypeCode: evidenceType,
            externalReference: reference.trim(),
            // Midday, so a date typed in any timezone lands on the day meant.
            acceptedAt: `${acceptedOn}T12:00:00.000Z`,
          },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return result.data;
    },
    onSuccess: async (payload) => {
      setConfirming(false);
      await cache.invalidateQueries({ queryKey: ["quotation", quotationId] });
      await cache.invalidateQueries({ queryKey: ["opportunities"] });
      onAccepted();
      // Say what actually happened to the deal, not just "saved".
      const body =
        isObject(payload) && isObject(payload.data) ? payload.data : {};
      const opportunity = isObject(body.opportunity) ? body.opportunity : null;
      const stage = opportunity === null ? "" : str(opportunity.stageCode);
      toast.success(
        stage === "WON"
          ? txt(
              "Recorded — the opportunity is now won.",
              "اتسجّل — الفرصة بقت مكسوبة.",
            )
          : txt("Acceptance recorded.", "تم تسجيل القبول."),
      );
    },
  });

  // Acceptance is for a document the customer has actually received. The
  // server refuses anything else, so the panel does not offer it.
  if (statusCode !== "SENT") return null;
  if (!canAccept) return null;

  const chosen = EVIDENCE.find((option) => option.code === evidenceType);
  const hasEvidence = reference.trim().length > 0;

  return (
    <section className="acceptance-panel">
      <h3>{txt("Record the customer's acceptance", "سجّل قبول العميل")}</h3>
      <p className="settings-hint">
        {txt(
          `Recording this closes ${quotationRef} and moves its opportunity to won, dated as below. It is what the pipeline and the targets count.`,
          `تسجيل ده بيقفل ${quotationRef} وبيحوّل الفرصة لمكسوبة بالتاريخ اللي تحت. وده اللي خط الفرص والأهداف بيعدّوه.`,
        )}
      </p>

      <ErrorBanner
        error={accept.error}
        retry={() => {
          accept.reset();
        }}
      />

      <div className="acceptance-fields">
        <label className="settings-field">
          {txt("How did they accept?", "قبلوا إزاي؟")}
          <select
            value={evidenceType}
            onChange={(event) => {
              setEvidenceType(event.target.value);
              setConfirming(false);
            }}
          >
            {EVIDENCE.map((option) => (
              <option key={option.code} value={option.code}>
                {locale === "ar" ? option.ar : option.en}
              </option>
            ))}
          </select>
        </label>

        <label className="settings-field">
          {txt("Evidence", "الدليل")}
          <input
            value={reference}
            placeholder={
              chosen === undefined
                ? ""
                : locale === "ar"
                  ? chosen.placeholderAr
                  : chosen.placeholderEn
            }
            onChange={(event) => {
              setReference(event.target.value);
              setConfirming(false);
            }}
          />
          <small>
            {txt(
              "Required. A deal is won when you have the evidence, not when you have the promise.",
              "مطلوب. الصفقة بتتكسب لما يبقى معاك الدليل، مش لما يبقى معاك الوعد.",
            )}
          </small>
        </label>

        <label className="settings-field">
          {txt("Accepted on", "تاريخ القبول")}
          <input
            type="date"
            value={acceptedOn}
            max={localToday()}
            onChange={(event) => {
              setAcceptedOn(event.target.value);
              setConfirming(false);
            }}
          />
          <small>
            {txt(
              "The day they said yes — this is the date the deal is counted in.",
              "اليوم اللي قالوا فيه أيوه — ده التاريخ اللي الصفقة هتتحسب فيه.",
            )}
          </small>
        </label>
      </div>

      {/* Winning a deal is not a one-click action: it writes a stage
          transition that the forecast is built on. */}
      {confirming ? (
        <div className="approval-actions">
          <button
            type="button"
            className="primary"
            disabled={accept.isPending}
            onClick={() => {
              accept.mutate();
            }}
          >
            {accept.isPending
              ? txt("Recording…", "بيتسجّل…")
              : txt("Yes — mark this deal won", "أيوه — سجّلها مكسوبة")}
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setConfirming(false);
            }}
          >
            {txt("Cancel", "إلغاء")}
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={!hasEvidence}
          onClick={() => {
            setConfirming(true);
          }}
        >
          {txt("Record acceptance", "سجّل القبول")}
        </button>
      )}

      {!hasEvidence && (
        <p className="settings-hint">
          {txt(
            "Enter the evidence first — the server will not record an acceptance without it.",
            "دخّل الدليل الأول — السيرفر مش هيسجّل قبول من غيره.",
          )}
        </p>
      )}
    </section>
  );
}
