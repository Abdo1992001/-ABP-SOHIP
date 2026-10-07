import type { ReactNode } from "react";
import { formatNum } from "../lib/numbers.ts";

/**
 * The pricing basis, laid out the way the workbook lays it out.
 *
 * The ACROW BOARD sheet is what the company actually prices from, and it shows
 * its working in a shape this screen did not: three blocks of controls, each
 * row reading **SETTING → OVERRIDE → APPLIED**, then one line naming every
 * applied value, then the equation itself spelled out —
 * `73.67 EGP/kg × 32.149 kg = 2,368.42 EGP per reference board`.
 *
 * That shape is not decoration. It answers the question a salesperson asks
 * about every figure on a quotation — *where did this come from* — without
 * anyone opening the sheet beside the screen to check. A price the system
 * applies silently is a price somebody re-derives by hand.
 *
 * The workbook's own status vocabulary comes with it: AUTO for what is
 * derived, SPECIAL for curved and circular, CHECK for a warning, READY when
 * the basis is complete.
 */

export type BasisTone = "auto" | "special" | "check" | "ready";

export interface BasisRow {
  readonly key: string;
  readonly label: { readonly en: string; readonly ar: string };
  /** The company default, already formatted. */
  readonly setting: string;
  /**
   * The quotation-level override. `null` means the row is derived and has no
   * override — the workbook flags those AUTO rather than leaving them blank,
   * because a blank cell reads as "nobody filled this in".
   */
  readonly override: {
    readonly value: string;
    readonly onChange: (value: string) => void;
  } | null;
  /** The value actually in force, already formatted. */
  readonly applied: string;
  readonly tone?: BasisTone;
  /**
   * A control that replaces the plain override box and drops to its own line
   * below the row — for an override that is more than one number, such as the
   * board-price ⇄ price-per-kg pair.
   */
  readonly wideControl?: ReactNode;
}

export interface BasisBlock {
  readonly key: string;
  readonly title: { readonly en: string; readonly ar: string };
  readonly rows: readonly BasisRow[];
  readonly footer?: ReactNode;
}

const TONE_LABEL: Record<BasisTone, { en: string; ar: string }> = {
  auto: { en: "AUTO", ar: "محسوب" },
  special: { en: "SPECIAL", ar: "خاص" },
  check: { en: "CHECK", ar: "راجع" },
  ready: { en: "READY", ar: "جاهز" },
};

export function QuotationBasisPanel({
  locale,
  blocks,
  activeBasis,
  equation,
  editable,
}: {
  locale: "en" | "ar";
  blocks: readonly BasisBlock[];
  /** One line naming every applied value, as the sheet's ACTIVE BASIS row. */
  activeBasis: string;
  /** The pricing equation, written out. */
  equation: string;
  editable: boolean;
}) {
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const pick = (pair: { en: string; ar: string }) => (ar ? pair.ar : pair.en);

  return (
    <section className="basis-panel">
      <p className="basis-legend">
        <span className="basis-legend-key is-setting" />
        {txt("Company setting", "إعداد الشركة")}
        <span className="basis-legend-key is-override" />
        {txt("Editable override", "تجاوز قابل للتعديل")}
        <span className="basis-legend-key is-applied" />
        {txt("Applied", "المطبّق")}
      </p>

      <div className="basis-blocks">
        {blocks.map((block) => (
          <div key={block.key} className="basis-block">
            <div className="basis-block-head">
              <h4>{pick(block.title)}</h4>
              <span>{txt("Setting", "الإعداد")}</span>
              <span>{txt("Override", "تجاوز")}</span>
              <span>{txt("Applied", "المطبّق")}</span>
            </div>
            {block.rows.map((row) => {
              const overridden =
                row.override !== null && row.override.value.trim() !== "";
              return (
                <div key={row.key} className="basis-row">
                  <label htmlFor={`basis-${row.key}`}>{pick(row.label)}</label>
                  <span className="basis-setting">{row.setting}</span>
                  {row.wideControl !== undefined ? (
                    /* The editor for this row is the control below it. A
                       second box here would be a second way to set the same
                       number, which is how two inputs disagree. */
                    <span className="basis-override-elsewhere" />
                  ) : row.override === null ? (
                    <span className={`basis-flag is-${row.tone ?? "auto"}`}>
                      {pick(TONE_LABEL[row.tone ?? "auto"])}
                    </span>
                  ) : (
                    <input
                      id={`basis-${row.key}`}
                      className="basis-override"
                      aria-label={`${pick(row.label)} ${txt("override", "تجاوز")}`}
                      type="number"
                      min="0"
                      step="any"
                      readOnly={!editable}
                      placeholder="—"
                      value={row.override.value}
                      onChange={(event) => {
                        row.override?.onChange(event.target.value);
                      }}
                    />
                  )}
                  <span
                    className={`basis-applied${overridden ? " is-overridden" : ""}`}
                  >
                    {row.applied}
                  </span>
                  {row.wideControl !== undefined && (
                    <div className="basis-row-control">{row.wideControl}</div>
                  )}
                </div>
              );
            })}
            {block.footer !== undefined && (
              <div className="basis-block-footer">{block.footer}</div>
            )}
          </div>
        ))}
      </div>

      {/* The sheet prints this line under the controls and above the items,
          so a reader never has to assemble the basis out of four boxes. */}
      <p className="basis-active">
        <strong>{txt("Active basis", "الأساس المطبّق")}</strong>
        <span>{activeBasis}</span>
      </p>

      <p className="basis-equation">
        <strong>{txt("Live equation", "المعادلة")}</strong>
        <code>{equation}</code>
      </p>
    </section>
  );
}

/** A number the way the sheet writes it: grouped, fixed decimals. */
export function sheetNumber(
  value: number,
  locale: "en" | "ar",
  digits = 2,
): string {
  return formatNum(value, locale, {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** A percentage the way the sheet writes it. */
export function sheetPercent(value: number, locale: "en" | "ar"): string {
  return `${sheetNumber(value, locale, 2)}%`;
}
