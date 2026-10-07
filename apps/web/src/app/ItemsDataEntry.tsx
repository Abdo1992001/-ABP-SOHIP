import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { listProducts } from "../api/product-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import {
  applyCatalogueItem,
  blankItemRow,
  gridTotals,
  impliedPricePerKg,
  rowFigures,
  type ItemRow,
} from "../lib/items-data-entry.ts";

/**
 * Items data entry: a row per board size, the way the engineering studio has
 * always been filled in.
 *
 * Two things make it different from a plain table. Every new row arrives
 * already holding 18 mm, 2440 wide, 600 kg/m³ — the figures somebody would
 * otherwise type on every row and eventually mistype. And the row fills
 * itself in whichever direction the person happens to work in:
 *
 *   pick the item   → its thickness, width and length land in the row
 *   type the sizes  → weight, then unit price, follow from density and rate
 *   type a price    → the rate per kg it implies is shown back
 *
 * The item column reads the catalogue **description**, not its dimension
 * columns: `products.thickness_mm`, `width_mm`, `length_mm`, `weight_kg` and
 * `density_kg_m3` are null on all 2,927 products, while 2,735 descriptions
 * state the sizes in full. Reading the columns would have filled nothing.
 */

let counter = 0;
const nextKey = () => {
  counter += 1;
  return `row-${String(counter)}`;
};

export function ItemsDataEntry({
  client,
  pricePerKg,
  currencyCode,
  editable,
  onUseRate,
  onAddToQuotation,
}: {
  client: ApiClient;
  /** The applied rate from the pricing basis, in EGP per kg. */
  pricePerKg: number;
  currencyCode: string;
  editable: boolean;
  /** Offered when a typed piece price implies a different rate. */
  onUseRate?: ((pricePerKg: number) => void) | undefined;
  /**
   * Hands the priced rows to the quotation's own line items. Without it this
   * grid would be a second, unsaved list beside the real one — the rows here
   * only become part of the quotation once they are added.
   */
  onAddToQuotation?: ((rows: ItemRow[]) => void) | undefined;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);

  const [rows, setRows] = useState<ItemRow[]>(() => [blankItemRow(nextKey())]);
  const [priceDraft, setPriceDraft] = useState<Record<string, string>>({});

  const products = useQuery({
    queryKey: ["products", "items-data-entry"],
    queryFn: () => listProducts(client, { page: 1, limit: 200 }),
    retry: false,
  });
  const catalogue = useMemo(
    () =>
      (products.data?.data ?? []).map((product) => ({
        productId: product.productId,
        // Code first, so the list reads the way the ERP and the BOQ do.
        label:
          product.skuCode !== null && product.skuCode !== undefined
            ? `${product.skuCode} · ${product.canonicalDescription}`
            : product.canonicalDescription,
        description: product.canonicalDescription,
      })),
    [products.data],
  );

  const totals = gridTotals(rows, pricePerKg);
  const pricedRows = rows.filter((row) => rowFigures(row, pricePerKg).complete);
  const patch = (key: string, next: Partial<ItemRow>) => {
    setRows((current) =>
      current.map((row) => (row.key === key ? { ...row, ...next } : row)),
    );
  };
  const money = (value: number) =>
    formatNum(value, locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <section
      className="items-entry"
      aria-label={txt("Items data entry", "إدخال بيانات البنود")}
    >
      <header className="items-entry-head">
        <h3>{txt("Items data entry", "إدخال بيانات البنود")}</h3>
        <div className="items-entry-actions">
          {onAddToQuotation !== undefined && (
            <button
              type="button"
              className="primary"
              disabled={!editable || pricedRows.length === 0}
              onClick={() => {
                onAddToQuotation(pricedRows);
                setRows([blankItemRow(nextKey())]);
                setPriceDraft({});
              }}
            >
              {txt(
                `Add ${String(pricedRows.length)} to line items`,
                `إضافة ${String(pricedRows.length)} للبنود`,
              )}
            </button>
          )}
          <button
            type="button"
            disabled={!editable}
            onClick={() => {
              setRows((current) => [...current, blankItemRow(nextKey())]);
            }}
          >
            ＋ {txt("Add row", "إضافة صف")}
          </button>
          <button
            type="button"
            disabled={!editable}
            onClick={() => {
              setRows([blankItemRow(nextKey())]);
              setPriceDraft({});
            }}
          >
            {txt("Reset", "إعادة تعيين")}
          </button>
        </div>
      </header>

      <div className="items-entry-totals">
        <div>
          <dt>{txt("Rows priced", "صفوف مسعّرة")}</dt>
          <dd>
            {formatNum(totals.priced, locale)} /{" "}
            {formatNum(rows.length, locale)}
          </dd>
        </div>
        <div>
          <dt>{txt("Pieces", "عدد القطع")}</dt>
          <dd>{formatNum(totals.pieces, locale)}</dd>
        </div>
        <div>
          <dt>{txt("Total weight (kg)", "الوزن الكلي (كجم)")}</dt>
          <dd>{money(totals.weightKg)}</dd>
        </div>
        <div className="is-strong">
          <dt>{txt("Total", "الإجمالي")}</dt>
          <dd>
            {money(totals.amount)} {currencyCode}
          </dd>
        </div>
      </div>

      <div className="enterprise-table-scroll">
        <table className="data-table items-entry-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{txt("Type", "النوع")}</th>
              <th>{txt("Item list", "قائمة الأصناف")}</th>
              <th>{txt("Thick.", "السُمك")}</th>
              <th>{txt("Width", "العرض")}</th>
              <th>{txt("L (mm)", "الطول (مم)")}</th>
              <th>{txt("Density", "الكثافة")}</th>
              <th>{txt("No.", "العدد")}</th>
              <th>{txt("Weight / pc", "وزن القطعة")}</th>
              <th>{txt("Unit price", "سعر الوحدة")}</th>
              <th>{txt("Total", "الإجمالي")}</th>
              <th>{txt("Actions", "إجراءات")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => {
              const figures = rowFigures(row, pricePerKg);
              const typed = priceDraft[row.key] ?? "";
              const implied =
                typed.trim() === ""
                  ? null
                  : impliedPricePerKg(row, Number(typed));
              return (
                <tr key={row.key}>
                  <td>
                    <span className="quotation-row-number">
                      <span aria-hidden="true">⠿</span> #{index + 1}
                    </span>
                  </td>
                  <td>
                    <select
                      aria-label={`type ${String(index + 1)}`}
                      disabled={!editable}
                      value={row.type}
                      onChange={(event) => {
                        patch(row.key, {
                          type: event.target.value as ItemRow["type"],
                        });
                      }}
                    >
                      <option value="">{txt("Select…", "اختار…")}</option>
                      <option value="LINEAR">{txt("Linear", "مستقيم")}</option>
                      <option value="CIRCULAR">
                        {txt("Circular", "دائري")}
                      </option>
                    </select>
                  </td>
                  <td className="items-entry-item">
                    <select
                      aria-label={`item ${String(index + 1)}`}
                      disabled={!editable}
                      value={row.productId}
                      onChange={(event) => {
                        const item = catalogue.find(
                          (candidate) =>
                            candidate.productId === event.target.value,
                        );
                        if (item === undefined) {
                          patch(row.key, { productId: "", productLabel: "" });
                          return;
                        }
                        setRows((current) =>
                          current.map((candidate) =>
                            candidate.key === row.key
                              ? applyCatalogueItem(candidate, item)
                              : candidate,
                          ),
                        );
                      }}
                    >
                      <option value="">
                        {products.isPending
                          ? txt("Loading…", "بيحمّل…")
                          : txt("Free entry", "إدخال حر")}
                      </option>
                      {catalogue.map((item) => (
                        <option key={item.productId} value={item.productId}>
                          {item.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  {(
                    [
                      ["thicknessMm", "thickness"],
                      ["widthMm", "width"],
                      ["lengthMm", "length"],
                      ["densityKgM3", "density"],
                      ["qty", "quantity"],
                    ] as const
                  ).map(([field, label]) => (
                    <td key={field}>
                      <input
                        aria-label={`${label} ${String(index + 1)}`}
                        type="number"
                        min="0"
                        step="any"
                        readOnly={!editable}
                        value={row[field]}
                        onChange={(event) => {
                          patch(row.key, { [field]: event.target.value });
                        }}
                      />
                    </td>
                  ))}
                  <td className="items-entry-derived">
                    {figures.weightKgPerPiece > 0
                      ? formatNum(figures.weightKgPerPiece, locale, {
                          minimumFractionDigits: 3,
                          maximumFractionDigits: 3,
                        })
                      : "—"}
                  </td>
                  <td className="items-entry-price">
                    <input
                      aria-label={`unit price ${String(index + 1)}`}
                      type="number"
                      min="0"
                      step="any"
                      readOnly={!editable}
                      placeholder={
                        figures.weightKgPerPiece > 0
                          ? money(figures.unitPrice)
                          : "—"
                      }
                      value={typed}
                      onChange={(event) => {
                        setPriceDraft((current) => ({
                          ...current,
                          [row.key]: event.target.value,
                        }));
                      }}
                    />
                    {/* Typing a price is the other direction: it says what
                        rate per kg that price actually is. */}
                    {implied !== null && (
                      <button
                        type="button"
                        className="items-entry-implied"
                        disabled={!editable || onUseRate === undefined}
                        onClick={() => {
                          onUseRate?.(implied);
                        }}
                      >
                        = {money(implied)} {txt("per kg", "للكيلو")}
                      </button>
                    )}
                  </td>
                  <td className="items-entry-derived">
                    {figures.lineTotal > 0 ? money(figures.lineTotal) : "—"}
                  </td>
                  <td className="items-entry-row-actions">
                    <button
                      type="button"
                      disabled={!editable}
                      aria-label={`duplicate ${String(index + 1)}`}
                      onClick={() => {
                        setRows((current) => [
                          ...current.slice(0, index + 1),
                          { ...row, key: nextKey() },
                          ...current.slice(index + 1),
                        ]);
                      }}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      disabled={!editable || rows.length <= 1}
                      aria-label={`remove ${String(index + 1)}`}
                      onClick={() => {
                        setRows((current) =>
                          current.filter(
                            (candidate) => candidate.key !== row.key,
                          ),
                        );
                      }}
                    >
                      ✕
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="items-entry-note">
        {txt(
          "This is a quick calculator. Nothing here is saved until you add the rows to the line items.",
          "ده حاسبة سريعة. مفيش حاجة هنا بتتحفظ غير لما تضيف الصفوف للبنود.",
        )}{" "}
        {txt(
          `Weight is width × length × thickness × density. Unit price is that weight × ${money(pricePerKg)} per kg, the rate in force on this quotation.`,
          `الوزن = العرض × الطول × السُمك × الكثافة. وسعر الوحدة = الوزن × ${money(pricePerKg)} للكيلو، وهو السعر المطبّق على عرض السعر ده.`,
        )}
      </p>
    </section>
  );
}
