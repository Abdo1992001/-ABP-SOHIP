import type { components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { StatusChip } from "./CommercialUI.tsx";

/**
 * The list exactly as the contract declares it, rather than an array rebuilt
 * from its element type. Reconstructing `readonly Row[]` from `Row` produces a
 * type that is structurally the same but not identical, and assigning the real
 * response to it fails on `toString` — an unreadable error for a rebuild that
 * gained nothing.
 */
export type CustomerPriceHistoryRows =
  components["schemas"]["AccountCommercialHistory"]["priceHistory"];
export type CustomerPriceHistoryRow = CustomerPriceHistoryRows[number];

export function CustomerPriceHistory({
  rows,
  compact = false,
  onUse,
}: {
  rows?: CustomerPriceHistoryRows;
  compact?: boolean;
  onUse?: (row: CustomerPriceHistoryRow) => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arText: string) => (ar ? arText : en);
  const safeRows = rows ?? [];
  const latest = latestByFamily(safeRows);

  if (safeRows.length === 0) {
    return (
      <div className={`customer-price-history ${compact ? "is-compact" : ""}`}>
        <div className="customer-price-history-head">
          <div>
            <span>{txt("Customer pricing memory", "ذاكرة أسعار العميل")}</span>
            <strong>
              {txt("No previous quotation prices", "لا توجد أسعار سابقة")}
            </strong>
          </div>
          <small>
            {txt(
              "The company price will be used until this customer has a quotation history.",
              "هيتطبق سعر الشركة لحد ما يبقى للعميل تاريخ عروض أسعار.",
            )}
          </small>
        </div>
      </div>
    );
  }

  return (
    <section
      className={`customer-price-history ${compact ? "is-compact" : ""}`}
    >
      <header className="customer-price-history-head">
        <div>
          <span>{txt("Customer pricing memory", "ذاكرة أسعار العميل")}</span>
          <strong>
            {txt(
              "What this customer was quoted before",
              "العميل اتسعّر له بكام قبل كده",
            )}
          </strong>
        </div>
        <small>
          {txt(
            "Reference only — applying a previous rate is always an explicit choice.",
            "للمراجعة فقط — استخدام سعر قديم لازم يكون باختيارك.",
          )}
        </small>
      </header>

      <div className="customer-price-latest">
        {latest.map(({ family, row }) => (
          <article
            key={family}
            className={`price-memory-card is-${family.toLowerCase()}`}
          >
            <span>{familyLabel(family, ar)}</span>
            <strong>{primaryPrice(row, ar)}</strong>
            <small>{secondaryPrice(row, ar)}</small>
            <footer>
              <span>
                {row.quotationRef} · {row.quotedOn}
              </span>
              {onUse && (
                <button
                  type="button"
                  onClick={() => {
                    onUse(row);
                  }}
                >
                  {txt("Use rate", "استخدم السعر")}
                </button>
              )}
            </footer>
          </article>
        ))}
      </div>

      {!compact && (
        <div className="enterprise-table-scroll customer-price-table-wrap">
          <table className="enterprise-table customer-price-table">
            <thead>
              <tr>
                <th>{txt("Quotation", "عرض السعر")}</th>
                <th>{txt("Date", "التاريخ")}</th>
                <th>{txt("Type", "النوع")}</th>
                <th>{txt("Board / piece", "اللوح / القطعة")}</th>
                <th>{txt("Per kg", "للكيلو")}</th>
                <th>{txt("Status", "الحالة")}</th>
              </tr>
            </thead>
            <tbody>
              {safeRows.slice(0, 25).map((row) => (
                <tr key={`${row.quotationId}:${String(row.lineNo)}`}>
                  <td>
                    <strong>{row.quotationRef}</strong>
                    <small>{row.description}</small>
                  </td>
                  <td>{row.quotedOn}</td>
                  <td>{materialLabel(row.materialClass, ar)}</td>
                  <td>{money(row.unitPrice, row.currencyCode, ar)}</td>
                  <td>
                    {row.pricePerKg
                      ? `${money(row.pricePerKg, row.currencyCode, ar)} / kg`
                      : "—"}
                  </td>
                  <td>
                    <StatusChip code={row.quotationStatusCode} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

type PriceFamily = "STANDARD" | "CURVED" | "CIRCULAR";

function latestByFamily(rows: readonly CustomerPriceHistoryRow[]) {
  const found = new Map<PriceFamily, CustomerPriceHistoryRow>();
  for (const row of rows) {
    const family = priceFamily(row.materialClass);
    if (family && !found.has(family)) found.set(family, row);
  }
  return (["STANDARD", "CURVED", "CIRCULAR"] as const).flatMap((family) => {
    const row = found.get(family);
    return row === undefined ? [] : [{ family, row }];
  });
}

function priceFamily(value: string | null): PriceFamily | null {
  if (value === "CIRCULAR") return "CIRCULAR";
  if (value === "CURVED") return "CURVED";
  if (["STANDARD", "REGULAR", "CORE", "WALL"].includes(value ?? ""))
    return "STANDARD";
  return null;
}

function familyLabel(family: PriceFamily, ar: boolean) {
  if (family === "CIRCULAR") return ar ? "ألواح دائرية" : "Circular boards";
  if (family === "CURVED") return ar ? "ألواح منحنية" : "Curved boards";
  return ar ? "اللوح القياسي" : "Standard board";
}

function materialLabel(value: string | null, ar: boolean) {
  const labels: Record<string, [string, string]> = {
    STANDARD: ["Standard board", "لوح قياسي"],
    REGULAR: ["Regular column", "عمود عادي"],
    CURVED: ["Curved board", "لوح منحني"],
    CIRCULAR: ["Circular column", "عمود دائري"],
    CORE: ["Core", "كور"],
    WALL: ["Wall", "وول"],
  };
  const pair = value ? labels[value] : undefined;
  return pair ? pair[ar ? 1 : 0] : (value ?? "—");
}

function primaryPrice(row: CustomerPriceHistoryRow, ar: boolean) {
  if (row.materialClass === "CIRCULAR" && row.pricePerKg)
    return `${money(row.pricePerKg, row.currencyCode, ar)} / kg`;
  return `${money(row.unitPrice, row.currencyCode, ar)} ${ar ? "للوح/القطعة" : "/ board or piece"}`;
}

function secondaryPrice(row: CustomerPriceHistoryRow, ar: boolean) {
  if (!row.pricePerKg)
    return ar ? "سعر الكيلو غير مسجل" : "No stored kilogram rate";
  if (row.materialClass === "CIRCULAR")
    return `${money(row.unitPrice, row.currencyCode, ar)} ${ar ? "للقطعة" : "/ piece"}`;
  return `${money(row.pricePerKg, row.currencyCode, ar)} / kg`;
}

function money(value: string, currency: string, ar: boolean) {
  return `${Number(value).toLocaleString(ar ? "ar-EG" : "en", {
    maximumFractionDigits: 2,
  })} ${currency}`;
}
