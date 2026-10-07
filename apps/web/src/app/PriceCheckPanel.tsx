import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner } from "./CommercialUI.tsx";

/**
 * "Is the price I am about to quote allowed?"
 *
 * `POST /pricing/resolve` has answered this since the beginning and nothing
 * has ever called it. It reads the pricing rule and the guardrail in force on
 * a given date and returns the floor, the reference and the ceiling, together
 * with any warning the server itself raises — which means the floor a
 * salesperson sees here is the same number the server will judge the
 * quotation against, not a second copy of the rule maintained in the client.
 *
 * That difference is the whole reason to use the endpoint instead of dividing
 * in the browser: a client-side floor and a server-side floor drift, and the
 * day they disagree is the day a quotation is rejected for a reason the
 * salesperson was never shown.
 */

interface Resolved {
  unitPrice: string;
  minPrice: string | null;
  referencePrice: string | null;
  maxPrice: string | null;
  currencyCode: string;
  calculationVersion: string;
  warnings: { code: string; severity: string; message: string }[];
}

function toResolved(payload: unknown): Resolved | null {
  if (!isObject(payload)) return null;
  const body = isObject(payload.data) ? payload.data : payload;
  if (typeof body.unitPrice !== "string") return null;
  return {
    unitPrice: body.unitPrice,
    minPrice: typeof body.minPrice === "string" ? body.minPrice : null,
    referencePrice:
      typeof body.referencePrice === "string" ? body.referencePrice : null,
    maxPrice: typeof body.maxPrice === "string" ? body.maxPrice : null,
    currencyCode: str(body.currencyCode),
    calculationVersion: str(body.calculationVersion),
    warnings: Array.isArray(body.warnings)
      ? body.warnings.filter(isObject).map((w) => ({
          code: str(w.code),
          severity: str(w.severity),
          message: str(w.message),
        }))
      : [],
  };
}

const CURRENCIES = ["EGP", "USD", "EUR", "SAR", "AED"] as const;

/** Latin digits always, so a figure can be read back over a phone unambiguously. */
function money(value: string | null, currency: string): string {
  if (value === null) return "—";
  const amount = Number(value);
  if (Number.isNaN(amount)) return "—";
  return `${amount.toLocaleString("en", { maximumFractionDigits: 2 })} ${currency}`;
}

export function PriceCheckPanel({
  client,
  productId,
}: {
  client: ApiClient;
  productId: string;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);

  const [qty, setQty] = useState("1");
  const [currency, setCurrency] = useState<string>("EGP");
  // Optional: what the salesperson intends to charge. Left blank, the panel
  // reports the band; filled in, it also says whether that number sits in it.
  const [intended, setIntended] = useState("");

  const check = useMutation({
    mutationFn: async () => {
      const result = await commercialRequest(
        client,
        "POST",
        "/pricing/resolve",
        {
          path: {},
          body: { productId, qty: qty.trim(), currencyCode: currency },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return toResolved(result.data);
    },
  });

  const resolved = check.data ?? null;
  const intendedAmount = intended.trim() === "" ? null : Number(intended);
  const floor = resolved?.minPrice === null ? null : Number(resolved?.minPrice);
  const ceiling =
    resolved?.maxPrice === null ? null : Number(resolved?.maxPrice);

  // Three outcomes, and each one names the number it was judged against — a
  // verdict without the threshold is an argument nobody can settle.
  const verdict = (() => {
    if (resolved === null || intendedAmount === null) return null;
    if (Number.isNaN(intendedAmount)) return null;
    if (floor !== null && !Number.isNaN(floor) && intendedAmount < floor) {
      return {
        tone: "danger" as const,
        text: txt(
          `Below the floor of ${money(resolved.minPrice, resolved.currencyCode)}. This needs an approval.`,
          `تحت الحد الأدنى ${money(resolved.minPrice, resolved.currencyCode)}. ده محتاج موافقة.`,
        ),
      };
    }
    if (
      ceiling !== null &&
      !Number.isNaN(ceiling) &&
      intendedAmount > ceiling
    ) {
      return {
        tone: "warn" as const,
        text: txt(
          `Above the ceiling of ${money(resolved.maxPrice, resolved.currencyCode)}.`,
          `فوق الحد الأقصى ${money(resolved.maxPrice, resolved.currencyCode)}.`,
        ),
      };
    }
    return {
      tone: "ok" as const,
      text: txt("Inside the allowed band.", "جوه النطاق المسموح."),
    };
  })();

  return (
    <div className="price-check">
      <p className="settings-hint">
        {txt(
          "Checks a price against the rule and guardrail the server itself applies — the same numbers a quotation will be judged by.",
          "بيشيّك على السعر ضد القاعدة والحد اللي السيرفر نفسه بيطبّقه — نفس الأرقام اللي عرض السعر هيتحكم عليه بيها.",
        )}
      </p>

      <form
        className="price-check-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!check.isPending) check.mutate();
        }}
      >
        <label className="settings-field">
          {txt("Quantity", "الكمية")}
          <input
            value={qty}
            inputMode="decimal"
            onChange={(event) => {
              setQty(event.target.value);
            }}
          />
        </label>
        <label className="settings-field">
          {txt("Currency", "العملة")}
          <select
            value={currency}
            onChange={(event) => {
              setCurrency(event.target.value);
            }}
          >
            {CURRENCIES.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
        </label>
        <label className="settings-field">
          {txt(
            "Price you intend to quote (optional)",
            "السعر اللي ناوي تعرضه (اختياري)",
          )}
          <input
            value={intended}
            inputMode="decimal"
            onChange={(event) => {
              setIntended(event.target.value);
            }}
          />
        </label>
        <button type="submit" className="primary" disabled={check.isPending}>
          {check.isPending
            ? txt("Checking…", "بيشيّك…")
            : txt("Check price", "شيّك السعر")}
        </button>
      </form>

      <ErrorBanner
        error={check.error}
        retry={() => {
          check.reset();
        }}
      />

      {check.isSuccess && resolved === null && (
        <p className="today-empty">
          {txt(
            "No price is configured for this product in that currency, so there is nothing to check it against.",
            "مفيش سعر متظبّط للمنتج ده بالعملة دي، فمفيش حاجة نقارن بيها.",
          )}
        </p>
      )}

      {resolved !== null && (
        <>
          {verdict !== null && (
            <p className={`price-check-verdict abp2-tone-${verdict.tone}`}>
              {verdict.text}
            </p>
          )}
          <dl className="price-check-band">
            <div>
              <dt>{txt("Floor", "الحد الأدنى")}</dt>
              <dd data-abp-num>
                {money(resolved.minPrice, resolved.currencyCode)}
              </dd>
            </div>
            <div>
              <dt>{txt("Reference", "السعر المرجعي")}</dt>
              <dd data-abp-num>
                {money(resolved.referencePrice, resolved.currencyCode)}
              </dd>
            </div>
            <div>
              <dt>{txt("Ceiling", "الحد الأقصى")}</dt>
              <dd data-abp-num>
                {money(resolved.maxPrice, resolved.currencyCode)}
              </dd>
            </div>
          </dl>

          {resolved.warnings.length > 0 && (
            <ul className="price-check-warnings">
              {resolved.warnings.map((warning) => (
                <li key={warning.code}>{warning.message}</li>
              ))}
            </ul>
          )}

          {/* Which version of the calculation produced this, because a price
              argued about next month is argued about against a rule that may
              have changed since. */}
          <p className="settings-hint" data-abp-num>
            {txt("Calculation", "الحساب")}: {resolved.calculationVersion}
          </p>
        </>
      )}
    </div>
  );
}
