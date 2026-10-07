import { Fragment, useEffect, useState, type ReactNode } from "react";
import { Link, useParams, useNavigate } from "react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, rows, str } from "./commercial-api.ts";
import {
  ErrorBanner,
  InfoTooltip,
  ScreenIntro,
  SlideOver,
  StatusChip,
  TabBar,
  useToast,
} from "./CommercialUI.tsx";
import { AcceptancePanel } from "./AcceptancePanel.tsx";
import { DocumentDownload } from "./DocumentDownload.tsx";
import { RecordThread } from "./RecordThread.tsx";
import { listContacts } from "../api/contact-api.ts";
import { canCopyQuotation, copyQuotation } from "../api/quotation-api.ts";
import { OperationAction } from "./ContractScreen.tsx";
import { operationById } from "../api/operation-runtime.ts";
import {
  previewEngineeringUnitPrice,
  computeWeightKg,
  deriveStandardRate,
} from "../lib/engineering-pricing.ts";
import { computePaymentSchedulePreview } from "../lib/payment-schedule.ts";
import { computeCircularColumnSchedule } from "../lib/circular-column.ts";
import {
  computeColumnPanelSchedule,
  MAX_ELEMENT_FACES,
  MAX_IRREGULAR_FACES,
  type ColumnShape,
} from "../lib/column-faces.ts";
import { boardDescriptor } from "../lib/board-descriptor.ts";
import { toNum } from "../lib/numbers.ts";
import { useSizeCatalogue } from "../api/product-catalogue.ts";
import {
  consolidateQuotationLines,
  consolidationIsValueNeutral,
  piecesFromScope,
} from "../lib/quotation-consolidation.ts";
import { ItemCodePicker } from "./ItemCodePicker.tsx";
import { codeOptions } from "../lib/product-lookup.ts";
import { QuotationExportButtons } from "./QuotationExportButtons.tsx";
import type { QuotationExport } from "../lib/quotation-export.ts";
import {
  amountInWords,
  grossWeightKg,
  offerValidityLabel,
  PROFORMA_PACKING_PCT,
  planForTerm,
  paymentTermsSentence,
  splitInstalments,
} from "../lib/quotation-document.ts";
import {
  boardPriceFromPerKg,
  referenceBoardWeightKg,
  WORKBOOK,
} from "../lib/workbook-defaults.ts";
import {
  QuotationBasisPanel,
  sheetNumber,
  sheetPercent,
} from "./QuotationBasisPanel.tsx";
import { tryEvaluateFormula } from "../lib/formula-engine.ts";
import { buildLineFormulaScope } from "../lib/formula-scope.ts";
import {
  checkQuotationLine,
  rollUpQuotationStatus,
  type QuotationLineStatus,
} from "../lib/quotation-validation.ts";
import { portLabel, suggestedPorts } from "../lib/seaports.ts";
import { computeBoardTakeoff } from "../lib/board-takeoff.ts";
import { enumLabel } from "../i18n/enum-labels.ts";
import { LineDimensions } from "./LineDimensions.tsx";
import { restoreLineGeometry } from "../lib/restore-line-geometry.ts";
import { parseBoardDimensions } from "../lib/cargo-bundling.ts";
import { SubjectPicker } from "./SubjectPicker.tsx";
import {
  EMAIL_TYPES,
  TELEPHONE_TYPES,
  pickChannel,
} from "../lib/contact-channels.ts";
import type { ItemRow } from "../lib/items-data-entry.ts";
import { SendQuotationButton } from "./SendQuotationDialog.tsx";
// The lines are no longer a tab: they are step 2 of the page, and the quick
// entry calculator that used to sit beside them was a second way of entering
// the same lines -- which is the "two processes" problem again. What is left
// here is what you do once the lines are right.
const tabs = [
  { id: "documents", en: "Documents", ar: "المستندات" },
  { id: "approval", en: "Approval", ar: "الموافقة" },
  { id: "pricingrules", en: "Price explanation", ar: "شرح التسعير" },
  { id: "discussion", en: "Discussion", ar: "النقاش" },
  { id: "audit", en: "Audit trail", ar: "سجل المراجعة" },
];
type EngineeringPricingMethod = "LINEAR" | "WEIGHT_BASED";
export type Line = {
  quotationLineId?: string;
  productId?: string;
  /** True while the code follows the sizes; false once chosen by hand. */
  codeAuto?: boolean;
  description: string;
  qty: string;
  unitCode: string;
  unitPrice: string | null;
  discountAmount: string;
  sectionLabel: string;
  // Engineering pricing (opt-in): when pricingMethodCode is set, unitPrice is
  // left null and the server computes it from these dimensions on save —
  // same formulas as ABP Engineering Studio. See lib/engineering-pricing.ts.
  pricingMethodCode: EngineeringPricingMethod | "";
  lengthMm: string;
  widthMm: string;
  thicknessMm: string;
  densityKgM3: string;
  pricePerKg: string;
  // Board type label (e.g. "M Board", "M Board Curved") feeding the
  // auto-generated description "Acrow Board {t} mm x {l} mm x {w} mm ({label})",
  // matching the ACROW BOARD quotation sheet naming convention. Free text,
  // editable. descriptionAuto tracks whether description still follows the
  // pattern (true) or the user has typed a custom description (false).
  boardTypeLabel: string;
  descriptionAuto: boolean;
  // ACROW BOARD pricing hierarchy (opt-in, supersedes pricingMethodCode when
  // set — see pricing-hierarchy.ts / circular-column.ts on the server).
  materialClass: MaterialClass | "";
  category: string;
  reference: string;
  cadMark: string;
  diameterMm: string;
  radiusMm: string;
  columnHeightMm: string;
  mouldSegments: string;
  arcModuleMm: string;
  verticalCourseMm: string;
  // Rectangular column geometry. The workbook's rule: a column of A x B is
  // cut as A / B / A+closure / B+closure, because the two closing panels lap
  // the thickness of their neighbours. IRREGULAR names its faces instead.
  // See lib/column-faces.ts.
  columnShape: ColumnShape;
  sideAMm: string;
  sideBMm: string;
  faceWidthsMm: string[];
  maxPanelWidthMm: string;
  maxPanelLengthMm: string;
  // A core or a wall is the same face engine on a bigger drawing: twenty
  // faces, any of which the drawing may mark as curved, and an expected
  // count so a missing face is caught while it is being typed.
  curvedFaceNumbers: number[];
  expectedFaces: string;
  // Take-off geometry. A column is not a sheet: you know its height and the
  // width of each face, and the boards are cut from the standard sheet.
  // See lib/board-takeoff.ts.
  columnSideCount: string;
  sideWidthsMm: string;
  arcLengthMm: string;
  arcAngleDeg: string;
  // The span this item covers; ceil(span / 2.44) boards, Linear rows only.
  extensionLengthM: string;
  // A pricing rule stored as data rather than code (calculation_formulas).
  // ACROW does not only sell by the kilogram -- by m2, by m3, by linear metre,
  // a flat price per piece. The server evaluates the expression on save, so a
  // formula line has no live preview here. See formula-engine.ts.
  customFormulaKey: string;
  formulaRate: string;
  fabricationCost: string;
  fixedCost: string;
};
type Adjustment = {
  typeCode: string;
  modeCode: "PERCENT" | "FIXED_AMOUNT";
  value: string;
  label: string;
};
export type MaterialClass =
  "STANDARD" | "REGULAR" | "CURVED" | "CIRCULAR" | "CORE" | "WALL";
const ENGINEERING_METHOD_OPTIONS: {
  value: EngineeringPricingMethod;
  en: string;
  ar: string;
}[] = [
  { value: "LINEAR", en: "Linear (sheet)", ar: "Linear (شيت)" },
  {
    value: "WEIGHT_BASED",
    en: "Weight-based (Curved/Circular)",
    ar: "بالوزن (Curved/Circular)",
  },
];
export const MATERIAL_CLASS_OPTIONS: {
  value: MaterialClass;
  en: string;
  ar: string;
}[] = [
  { value: "STANDARD", en: "Standard (flat sheet)", ar: "قياسي (لوح مسطح)" },
  {
    value: "REGULAR",
    en: "Regular (rectangular column)",
    ar: "عادي (عمود مستطيل)",
  },
  { value: "CURVED", en: "Curved", ar: "منحني (كيرفد)" },
  { value: "CIRCULAR", en: "Circular column", ar: "عمود دائري" },
  { value: "CORE", en: "Core", ar: "كور" },
  { value: "WALL", en: "Wall", ar: "وول" },
];
const DEFAULT_BOARD_TYPE_LABEL: Record<EngineeringPricingMethod, string> = {
  LINEAR: "M Board",
  WEIGHT_BASED: "M Board Curved",
};
export const DEFAULT_BOARD_TYPE_LABEL_BY_CLASS: Record<MaterialClass, string> =
  {
    STANDARD: "M Board",
    REGULAR: "M Board Regular",
    CURVED: "M Board Curved",
    CIRCULAR: "M Board Circular",
    CORE: "M Board Core",
    WALL: "M Board Wall",
  };
// Standard Acrow board footprint (1220 x 2440 x 18mm), matching Engineering
// Studio's and the ACROW BOARD sheet's default sheet size.
export const DEFAULT_BOARD_DIMENSIONS_MM = {
  widthMm: "1220",
  lengthMm: "2440",
  thicknessMm: "18",
};
// Board type suggestions from the ACROW BOARD quotation sheet's categories
// (COLUMNS / CURVES / CORES / WALLS / SLAB). Free text — these are
// suggestions via <datalist>, not a hard-coded enum.
const BOARD_TYPE_SUGGESTIONS = [
  "M Board",
  "M Board Curved",
  "M Board Core",
  "M Board Wall",
  "M Board Slab",
];
export function createEmptyLine(): Line {
  return {
    description: "",
    qty: "1",
    unitCode: "PIECE",
    unitPrice: "0",
    discountAmount: "0",
    sectionLabel: "",
    pricingMethodCode: "",
    lengthMm: "",
    widthMm: "",
    thicknessMm: "",
    densityKgM3: "",
    pricePerKg: "",
    boardTypeLabel: "",
    descriptionAuto: false,
    materialClass: "",
    category: "",
    reference: "",
    cadMark: "",
    diameterMm: "",
    radiusMm: "",
    columnHeightMm: "",
    mouldSegments: "",
    arcModuleMm: "",
    verticalCourseMm: "",
    columnShape: "RECTANGULAR",
    sideAMm: "",
    sideBMm: "",
    faceWidthsMm: [],
    maxPanelWidthMm: "",
    maxPanelLengthMm: "",
    curvedFaceNumbers: [],
    expectedFaces: "",
    columnSideCount: "4",
    sideWidthsMm: "",
    arcLengthMm: "",
    arcAngleDeg: "",
    extensionLengthM: "",
    customFormulaKey: "",
    formulaRate: "",
    fabricationCost: "",
    fixedCost: "",
  };
}
/**
 * A row from the quick-entry grid, as a real quotation line. The grid prices
 * a flat sheet from its dimensions and the quotation's rate, which is exactly
 * a STANDARD line — so the line keeps the dimensions and leaves the rate to
 * the quotation, and the server prices it the same way on save.
 */
export function lineFromItemRow(row: ItemRow): Line {
  const line: Line = {
    ...createEmptyLine(),
    materialClass: "STANDARD",
    unitPrice: null,
    qty: row.qty,
    thicknessMm: row.thicknessMm,
    widthMm: row.widthMm,
    lengthMm: row.lengthMm,
    densityKgM3: row.densityKgM3,
    ...(row.productId ? { productId: row.productId } : {}),
  };
  const description = row.productLabel || buildLineDescription(line);
  return {
    ...line,
    description,
    descriptionAuto: row.productLabel === "",
  };
}
export function buildAutoDescription(
  thicknessMm: string,
  lengthMm: string,
  widthMm: string,
  boardTypeLabel: string,
): string {
  if (!thicknessMm || !lengthMm || !widthMm) return "";
  return `Acrow Board ${thicknessMm} mm x ${lengthMm} mm x ${widthMm} mm (${boardTypeLabel || "M Board"})`;
}
// CIRCULAR lines are described by diameter + column height, not the
// board's flat length/width — using buildAutoDescription for them (as the
// original materialClass switch did) silently mislabelled every circular
// column with the fixed 1220x2440 reference-board footprint.
export function buildLineDescription(line: Line): string {
  if (!line.materialClass) {
    return buildAutoDescription(
      line.thicknessMm,
      line.lengthMm,
      line.widthMm,
      line.boardTypeLabel,
    );
  }
  const thicknessMm = Number(line.thicknessMm || 0);
  if (
    line.materialClass === "REGULAR" ||
    line.materialClass === "CORE" ||
    line.materialClass === "WALL"
  ) {
    const column = columnScheduleFor(line, WORKBOOK_TAKEOFF_DEFAULTS);
    const primary = column.panels[0];
    if (!primary || !thicknessMm) return "";
    return boardDescriptor({
      materialClass: line.materialClass,
      thicknessMm,
      widthMm: primary.widthMm,
      lengthMm: primary.lengthMm,
      ...(column.panels.length > 1
        ? { extraSizeCount: column.panels.length - 1 }
        : {}),
    });
  }
  if (line.materialClass === "CIRCULAR") {
    const schedule = circularScheduleFor(line);
    const primary = schedule?.pieces[0];
    if (!schedule || !primary || !thicknessMm) return "";
    return boardDescriptor({
      materialClass: "CIRCULAR",
      thicknessMm,
      widthMm: primary.widthMm,
      lengthMm: primary.heightMm,
      diameterMm: schedule.diameterMm,
      ...(schedule.pieces.length > 1
        ? { extraSizeCount: schedule.pieces.length - 1 }
        : {}),
    });
  }
  if (!thicknessMm || !line.widthMm || !line.lengthMm) return "";
  return boardDescriptor({
    materialClass: line.materialClass,
    thicknessMm,
    widthMm: Number(line.widthMm),
    lengthMm: Number(line.lengthMm),
    ...(line.diameterMm ? { diameterMm: Number(line.diameterMm) } : {}),
  });
}
/** The workbook's MASTER SETTINGS takeoff figures, used until the company's
 *  own pricing basis has loaded. */
export interface TakeoffDefaults {
  columnHeightMm: number;
  maxPanelWidthMm: number;
  maxPanelLengthMm: number;
  closureAllowanceMm: number;
}
export const WORKBOOK_TAKEOFF_DEFAULTS: TakeoffDefaults = {
  columnHeightMm: WORKBOOK.columnHeightMm,
  maxPanelWidthMm: WORKBOOK.maxPanelWidthMm,
  maxPanelLengthMm: WORKBOOK.maxPanelLengthMm,
  closureAllowanceMm: WORKBOOK.closureAllowanceMm,
};
export interface MaterialClassPreview {
  unitPrice: number;
  /** Weight of one delivered piece. */
  weightKg: number;
  /** Weight of everything this line delivers. */
  totalWeightKg: number;
  pricedQty: number;
  /**
   * What a multi-size schedule is worth: every piece priced to the piastre
   * on its own weight, times its count, summed. The line total is this, not
   * `unitPrice x pricedQty` -- the unit price is the average, and a rounded
   * average multiplied back is not the sum. Null for a line of one size.
   */
  lineValue: number | null;
  circular: ReturnType<typeof computeCircularColumnSchedule> | null;
  /** The panel schedule, for a rectangular or irregular column. */
  column: ReturnType<typeof computeColumnPanelSchedule> | null;
  /** True when a stored pricing rule was selected but would not evaluate. */
  formulaError: boolean;
}
/** Who names their faces off the drawing rather than deriving them: an
 *  irregular column, and every core and wall. */
export function usesFaceList(line: Line): boolean {
  return (
    line.materialClass === "CORE" ||
    line.materialClass === "WALL" ||
    (line.materialClass === "REGULAR" && line.columnShape === "IRREGULAR")
  );
}
/** How many faces this line's drawing may name. */
export function maxFacesFor(line: Line): number {
  return line.materialClass === "CORE" || line.materialClass === "WALL"
    ? MAX_ELEMENT_FACES
    : MAX_IRREGULAR_FACES;
}
/** One place that turns a line's rectangular-column inputs into a panel
 *  schedule, mirroring the server. A / B / A+closure / B+closure. */
/**
 * A flat or curved board's size, when all three are known.
 *
 * Only these are coded one-to-one by size: a column is several panels of
 * different sizes, and those are coded panel by panel in the summary.
 */
function flatSizeOf(
  line: Line,
): { thicknessMm: number; widthMm: number; lengthMm: number } | null {
  if (line.materialClass !== "STANDARD" && line.materialClass !== "CURVED")
    return null;
  const thicknessMm = toNum(line.thicknessMm, 0);
  const widthMm = toNum(line.widthMm, 0);
  const lengthMm = toNum(line.lengthMm, 0);
  return thicknessMm > 0 && widthMm > 0 && lengthMm > 0
    ? { thicknessMm, widthMm, lengthMm }
    : null;
}
/** The line without a code, for when its size no longer has one. */
function withoutProductId(line: Line): Line {
  const next = { ...line };
  delete next.productId;
  return next;
}
/** Whether a saved snapshot records what the line itself was given. */
function hasOwnBlock(snapshot: Record<string, unknown> | null): boolean {
  return snapshot !== null && isObject(snapshot.own);
}
/** A figure the line itself was given, from a snapshot that records it. */
function ownValue(
  snapshot: Record<string, unknown> | null,
  key: "pricePerKg" | "densityKgM3",
): string | undefined {
  if (snapshot === null || !isObject(snapshot.own)) return undefined;
  const value = snapshot.own[key];
  return value == null || value === "" ? "" : str(value);
}
export function columnScheduleFor(
  line: Line,
  defaults: {
    columnHeightMm: number;
    maxPanelWidthMm: number;
    maxPanelLengthMm: number;
    closureAllowanceMm: number;
  },
): ReturnType<typeof computeColumnPanelSchedule> {
  return computeColumnPanelSchedule({
    shape: usesFaceList(line) ? "IRREGULAR" : line.columnShape,
    maxFaces: maxFacesFor(line),
    curvedFaceNumbers: line.curvedFaceNumbers,
    ...(line.expectedFaces
      ? { expectedFaces: Number(line.expectedFaces) }
      : {}),
    sideAMm: line.sideAMm ? Number(line.sideAMm) : null,
    sideBMm: line.sideBMm ? Number(line.sideBMm) : null,
    faceWidthsMm: line.faceWidthsMm
      .filter((face) => face.trim() !== "")
      .map((face) => Number(face)),
    columnHeightMm: line.columnHeightMm
      ? Number(line.columnHeightMm)
      : defaults.columnHeightMm,
    maxPanelWidthMm: line.maxPanelWidthMm
      ? Number(line.maxPanelWidthMm)
      : defaults.maxPanelWidthMm,
    maxPanelLengthMm: line.maxPanelLengthMm
      ? Number(line.maxPanelLengthMm)
      : defaults.maxPanelLengthMm,
    closureAllowanceMm: defaults.closureAllowanceMm,
    quantity: Number(line.qty || 0),
  });
}
/** One place that turns a line's circular inputs into a schedule, so the name,
 *  the preview and the panel never disagree about what gets delivered. */
export function circularScheduleFor(
  line: Line,
): ReturnType<typeof computeCircularColumnSchedule> | null {
  if (!line.columnHeightMm || (!line.diameterMm && !line.radiusMm)) return null;
  return computeCircularColumnSchedule({
    columnHeightMm: Number(line.columnHeightMm),
    columnQuantity: Number(line.qty || 0),
    ...(line.diameterMm ? { diameterMm: Number(line.diameterMm) } : {}),
    ...(line.radiusMm ? { radiusMm: Number(line.radiusMm) } : {}),
    ...(line.mouldSegments
      ? { mouldSegments: Number(line.mouldSegments) }
      : {}),
    ...(line.arcModuleMm ? { arcModuleMm: Number(line.arcModuleMm) } : {}),
    ...(line.verticalCourseMm
      ? { verticalCourseMm: Number(line.verticalCourseMm) }
      : {}),
  });
}
export type PricingOverrides = Pick<
  HeaderDraft,
  | "standardPricePerKgOverride"
  | "curvedPricePerKgOverride"
  | "circularPricePerKgOverride"
  | "densityOverrideKgM3"
>;

export function resolveLineRate(
  line: Line,
  header: PricingOverrides,
  companyRates: Record<MaterialClass, number>,
): number {
  if (line.pricePerKg) return Number(line.pricePerKg);
  if (!line.materialClass) return 0;
  const isStandardLike =
    line.materialClass === "STANDARD" ||
    line.materialClass === "REGULAR" ||
    line.materialClass === "CORE" ||
    line.materialClass === "WALL";
  // Circular falls back to the curved override only when nothing
  // circular-specific is set, mirroring the server.
  const override = isStandardLike
    ? header.standardPricePerKgOverride
    : line.materialClass === "CIRCULAR"
      ? header.circularPricePerKgOverride || header.curvedPricePerKgOverride
      : header.curvedPricePerKgOverride;
  if (override) return Number(override);
  return companyRates[line.materialClass];
}
// Mirrors the server's per-line resolution (quotation.service.ts) for the
// live preview — the server always recomputes authoritatively on save.
export function computeMaterialClassPreview(
  line: Line,
  header: PricingOverrides,
  companyRates: Record<MaterialClass, number>,
  companyDefaultDensity: number,
  companyDefaultThickness: number,
  formulas: readonly CalculationFormulaOption[] = [],
  takeoff: TakeoffDefaults = WORKBOOK_TAKEOFF_DEFAULTS,
): MaterialClassPreview | null {
  if (!line.materialClass && !line.customFormulaKey) return null;
  const rate = resolveLineRate(line, header, companyRates);
  const densityKgM3 = line.densityKgM3
    ? Number(line.densityKgM3)
    : header.densityOverrideKgM3
      ? Number(header.densityOverrideKgM3)
      : companyDefaultDensity;
  const thicknessMm = line.thicknessMm
    ? Number(line.thicknessMm)
    : companyDefaultThickness;
  // A stored pricing rule replaces the per-kilogram default outright: it was
  // chosen for this line precisely because the kilogram is not how this item
  // is sold. It still reads the line's own dimensions and resolved rate.
  const formula = line.customFormulaKey
    ? formulas.find((entry) => entry.formulaKey === line.customFormulaKey)
    : undefined;
  if (formula) {
    const schedule =
      line.materialClass === "CIRCULAR" ? circularScheduleFor(line) : null;
    const primary = schedule?.pieces[0];
    const formulaWidthMm = primary?.widthMm ?? Number(line.widthMm || 0);
    const formulaLengthMm = primary?.heightMm ?? Number(line.lengthMm || 0);
    const result = tryEvaluateFormula(
      formula.expression,
      buildLineFormulaScope({
        widthMm: formulaWidthMm,
        lengthMm: formulaLengthMm,
        heightMm: Number(line.columnHeightMm || 0),
        thicknessMm,
        diameterMm: line.diameterMm ? Number(line.diameterMm) : null,
        radiusMm: line.radiusMm ? Number(line.radiusMm) : null,
        densityKgM3,
        quantity: Number(line.qty || 0),
        rate: line.formulaRate ? Number(line.formulaRate) : rate,
        fabricationCost: Number(line.fabricationCost || 0),
        fixedCost: Number(line.fixedCost || 0),
      }),
    );
    const formulaWeightKg = computeWeightKg({
      lengthMm: formulaLengthMm,
      widthMm: formulaWidthMm,
      thicknessMm,
      densityKgM3,
    });
    const formulaQty = schedule ? schedule.totalPieces : Number(line.qty || 0);
    return {
      // A rule that will not evaluate prices nothing. It must not quietly
      // price the line at whatever the weight happened to come to.
      unitPrice: result.ok ? Math.round(result.value * 100) / 100 : 0,
      weightKg: formulaWeightKg,
      totalWeightKg: formulaWeightKg * formulaQty,
      pricedQty: formulaQty,
      // A formula prices the piece, and the server multiplies it out.
      lineValue: null,
      circular: schedule,
      column: null,
      formulaError: !result.ok,
    };
  }
  // A column of A x B is cut as A / B / A+closure / B+closure, then split
  // into lifts. A core and a wall skip the A/B rule and name their faces, but
  // are cut the same way. Each panel size is weighed on its own and the unit
  // price is the schedule's value spread over its panels.
  if (
    line.materialClass === "REGULAR" ||
    ((line.materialClass === "CORE" || line.materialClass === "WALL") &&
      line.faceWidthsMm.some((face) => face.trim() !== ""))
  ) {
    const column = columnScheduleFor(line, takeoff);
    if (column.totalPanels === 0)
      return {
        unitPrice: 0,
        weightKg: 0,
        totalWeightKg: 0,
        pricedQty: 0,
        lineValue: null,
        circular: null,
        column,
        formulaError: false,
      };
    let value = 0;
    let weight = 0;
    // A curved face on a core is curved work, and is charged as curved work
    // even though the rest of the element is flat.
    const curvedRate = header.curvedPricePerKgOverride
      ? Number(header.curvedPricePerKgOverride)
      : companyRates.CURVED;
    for (const panel of column.panels) {
      const panelWeight = computeWeightKg({
        lengthMm: panel.lengthMm,
        widthMm: panel.widthMm,
        thicknessMm,
        densityKgM3,
      });
      const panelRate = panel.curved ? curvedRate : rate;
      weight += panelWeight * panel.totalCount;
      value +=
        (Math.round(panelWeight * panelRate * 100) / 100) * panel.totalCount;
    }
    return {
      // The average, to four places as the server stores it; the line is
      // worth `value`, exactly.
      unitPrice: Math.round((value / column.totalPanels) * 10000) / 10000,
      weightKg: weight / column.totalPanels,
      totalWeightKg: weight,
      pricedQty: column.totalPanels,
      lineValue: Math.round(value * 100) / 100,
      circular: null,
      column,
      formulaError: false,
    };
  }
  let lengthMm: number;
  let widthMm: number;
  const circular =
    line.materialClass === "CIRCULAR" ? circularScheduleFor(line) : null;
  if (line.materialClass === "CIRCULAR") {
    // The delivered piece, not the mould module: a 1200mm column's working
    // arc is one 1885mm piece, and pricing the full 2440mm module instead
    // overcharges it by 29%.
    const primary = circular?.pieces[0];
    if (!circular || !primary)
      return {
        unitPrice: 0,
        weightKg: 0,
        totalWeightKg: 0,
        pricedQty: 0,
        lineValue: null,
        circular,
        column: null,
        formulaError: false,
      };
    widthMm = primary.widthMm;
    lengthMm = primary.heightMm;
  } else {
    if (!line.lengthMm || !line.widthMm)
      return {
        unitPrice: 0,
        weightKg: 0,
        totalWeightKg: 0,
        pricedQty: Number(line.qty || 0),
        lineValue: null,
        circular: null,
        column: null,
        formulaError: false,
      };
    lengthMm = Number(line.lengthMm);
    widthMm = Number(line.widthMm);
  }
  let weightKg = computeWeightKg({
    lengthMm,
    widthMm,
    thicknessMm,
    densityKgM3,
  });
  let unitPrice = Math.round(weightKg * rate * 100) / 100;
  let lineValue: number | null = null;
  const pricedQty = circular ? circular.totalPieces : Number(line.qty || 0);
  let totalWeightKg = weightKg * pricedQty;
  // A column whose arc does not divide evenly delivers two cut sizes. Each is
  // weighed on its own and the unit price is the schedule's value spread over
  // its pieces, so qty x unitPrice is still what the customer owes.
  if (circular && circular.pieces.length > 1 && circular.totalPieces > 0) {
    let value = 0;
    let weight = 0;
    for (const piece of circular.pieces) {
      const pieceWeight = computeWeightKg({
        lengthMm: piece.heightMm,
        widthMm: piece.widthMm,
        thicknessMm,
        densityKgM3,
      });
      weight += pieceWeight * piece.totalCount;
      value += (Math.round(pieceWeight * rate * 100) / 100) * piece.totalCount;
    }
    totalWeightKg = weight;
    weightKg = weight / circular.totalPieces;
    unitPrice = Math.round((value / circular.totalPieces) * 10000) / 10000;
    lineValue = Math.round(value * 100) / 100;
  }
  return {
    unitPrice,
    weightKg,
    totalWeightKg,
    pricedQty,
    lineValue,
    circular,
    column: null,
    formulaError: false,
  };
}

/**
 * A line's total, as the server will save it.
 *
 * The one place a line total is worked out on this screen. The row, the
 * subtotal, the side panel and the exported document each used to multiply
 * for themselves, so a fix in one could leave another wrong.
 */
export function previewLineTotal(
  line: Line,
  preview: MaterialClassPreview | null,
  legacyUnitPrice: number | null = null,
): number {
  const discount = Number(line.discountAmount || 0);
  const typed = line.unitPrice != null && line.unitPrice !== "";
  if (!typed && preview?.lineValue != null) return preview.lineValue - discount;
  const qty = preview ? preview.pricedQty : Number(line.qty || 0);
  const unit = typed
    ? Number(line.unitPrice)
    : (preview?.unitPrice ?? legacyUnitPrice ?? 0);
  return qty * unit - discount;
}
/** The live status of a line while it is being typed, mirroring what the
 *  server will decide on save (lib/quotation-validation.ts). */
export function lineStatus(
  line: Line,
  preview: MaterialClassPreview | null,
  header: PricingOverrides,
  companyRates: Record<MaterialClass, number>,
  companyDefaultDensity: number,
  companyDefaultThickness: number,
): QuotationLineStatus {
  const density = line.densityKgM3
    ? Number(line.densityKgM3)
    : header.densityOverrideKgM3
      ? Number(header.densityOverrideKgM3)
      : companyDefaultDensity;
  const status = checkQuotationLine({
    materialClass: line.materialClass || null,
    description: line.description,
    // The quantity someone typed, not the piece count derived from it: a
    // circular column with no diameter yet derives zero pieces, and telling
    // them to check a quantity they entered correctly sends them the wrong way.
    quantity: Number(line.qty || 0),
    thicknessMm: line.thicknessMm
      ? Number(line.thicknessMm)
      : companyDefaultThickness,
    // Regular columns, cores and walls derive their finished panel dimensions
    // from faces + height. Validate that delivered panel, not the intentionally
    // blank flat-sheet width/length inputs.
    widthMm: line.widthMm
      ? Number(line.widthMm)
      : (preview?.column?.panels[0]?.widthMm ?? null),
    lengthMm: line.lengthMm
      ? Number(line.lengthMm)
      : (preview?.column?.panels[0]?.lengthMm ?? null),
    densityKgM3: density,
    appliedPricePerKg: line.materialClass
      ? resolveLineRate(line, header, companyRates)
      : null,
    unitPrice: line.unitPrice === null ? null : Number(line.unitPrice),
    diameterMm: line.diameterMm ? Number(line.diameterMm) : null,
    radiusMm: line.radiusMm ? Number(line.radiusMm) : null,
    columnHeightMm: line.columnHeightMm ? Number(line.columnHeightMm) : null,
    totalPieces: preview?.circular ? preview.circular.totalPieces : null,
    formulaError: preview?.formulaError ?? false,
  }).status;
  if (status !== "READY") return status;
  if (
    preview?.column &&
    line.expectedFaces &&
    Number(line.expectedFaces) !== preview.column.facesPerColumn
  ) {
    return "CHECK_INPUT";
  }
  const previewColumn = preview?.column;
  if (
    previewColumn &&
    line.curvedFaceNumbers.some(
      (faceNumber) =>
        faceNumber < 1 || faceNumber > previewColumn.facesPerColumn,
    )
  ) {
    return "CHECK_INPUT";
  }
  return "READY";
}
/** Weights are quoted to the gram: three decimals, per the sheet. */
/** A pricing rule the company has stored, as the basis endpoint returns it. */
export interface CalculationFormulaOption {
  formulaKey: string;
  displayName: string;
  arabicLabel?: string | null;
  expression: string;
  description?: string | null;
  rateUnitLabel?: string | null;
}
function isCalculationFormula(
  value: unknown,
): value is CalculationFormulaOption {
  return (
    isObject(value) &&
    typeof value.formulaKey === "string" &&
    typeof value.displayName === "string" &&
    typeof value.expression === "string"
  );
}
export function formatWeight(value: number): string {
  const amount = Number.isFinite(value) ? value : 0;
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  });
}
/** What each status means to the person entering the line. The codes come
 *  from lib/quotation-validation.ts; only the wording lives here. */
const STATUS_LABELS: Record<QuotationLineStatus, { en: string; ar: string }> = {
  READY: { en: "Ready", ar: "جاهز" },
  CHECK_INPUT: { en: "Check input", ar: "راجع البيانات" },
  CHECK_DIMENSIONS: { en: "Check dimensions", ar: "راجع الأبعاد" },
  CHECK_QUANTITY: { en: "Check quantity", ar: "راجع الكمية" },
  CHECK_DENSITY: { en: "Check density", ar: "راجع الكثافة" },
  CHECK_PRICE: { en: "Check price", ar: "راجع السعر" },
  CHECK_FORMULA: { en: "Check formula", ar: "راجع المعادلة" },
  ENTER_DIAMETER_OR_RADIUS: {
    en: "Enter diameter or radius",
    ar: "أدخل القطر أو نصف القطر",
  },
  CHECK_DIAMETER_RADIUS_MISMATCH: {
    en: "Diameter / radius disagree",
    ar: "القطر ونصف القطر غير متطابقين",
  },
  CHECK_CALCULATION: { en: "Check calculation", ar: "راجع الحساب" },
};
/**
 * The readiness blockers come back as i18n keys. The two families this module
 * added — a line the engine flagged, and a total that does not follow from its
 * own lines — get read out properly rather than shown as `errors.line_check_price`.
 */
export function blockerMessage(
  code: string,
  fallback: string,
  locale: string,
): string {
  if (code.startsWith("LINE_")) {
    const status = code.slice("LINE_".length) as QuotationLineStatus;
    const label = STATUS_LABELS[status] as
      { en: string; ar: string } | undefined;
    if (label)
      return locale === "ar"
        ? `بند محتاج مراجعة: ${label.ar}`
        : `A line needs checking: ${label.en}`;
  }
  if (code.startsWith("RECONCILIATION_")) {
    const what = code.slice("RECONCILIATION_".length);
    const subject: Record<string, { en: string; ar: string }> = {
      LINE_TOTAL: { en: "a line total", ar: "إجمالي بند" },
      QUOTED_PIECES: { en: "a quoted quantity", ar: "كمية معروضة" },
      SUBTOTAL: { en: "the subtotal", ar: "المجموع الفرعي" },
      GRAND_TOTAL: { en: "the grand total", ar: "الإجمالي النهائي" },
    };
    const label = subject[what];
    if (label)
      return locale === "ar"
        ? `${label.ar} مش متطابق مع البنود — احفظ العرض تاني.`
        : `${label.en} does not follow from the lines — save the quotation again.`;
  }
  return fallback;
}
export function LineStatusChip({
  status,
  locale,
  compact = false,
}: {
  status: QuotationLineStatus;
  locale: string;
  /** A dot beside the row number, the word in its tooltip. */
  compact?: boolean;
}) {
  const label = STATUS_LABELS[status];
  if (compact) {
    const text = locale === "ar" ? label.ar : label.en;
    return (
      <span
        className={`q-status-dot ${status === "READY" ? "is-ready" : "is-check"}`}
        title={text}
        role="img"
        aria-label={text}
      />
    );
  }
  return (
    <span
      className={`quotation-status-chip ${status === "READY" ? "is-ready" : "is-check"}`}
    >
      {locale === "ar" ? label.ar : label.en}
    </span>
  );
}
export function formatMoney(value: number, currency?: string): string {
  const amount = Number.isFinite(value) ? value : 0;
  const formatted = amount.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return currency ? `${currency} ${formatted}` : formatted;
}
type HeaderDraft = {
  documentTypeCode: string;
  incotermCode: string;
  /**
   * What the offer is for, and what this particular shipment is.
   *
   * The subject is the offer's. The other three are the shipment's: the same
   * customer's next order carries a different purchase-order number, a
   * different lead time and a different freight cost, so none of them can live
   * on the customer record.
   */
  subject: string;
  customerPoNumber: string;
  leadTime: string;
  freightAmount: string;
  deliveryAddress: string;
  portOfLoading: string;
  portOfDischarge: string;
  paymentTermsCode: string;
  contactId: string;
  // Payment schedule (opt-in, alternative to paymentTermsCode): advance % +
  // N equal installments. See lib/payment-schedule.ts.
  paymentScheduleCode: "" | "ADVANCE_INSTALLMENTS";
  advancePct: string;
  installments: string;
  frequencyDays: string;
  referenceDate: string;
  paymentMethod: string;
  // Quotation-level pricing overrides (hierarchy: item > these > company
  // default). Empty string = not overridden at this level.
  standardPricePerKgOverride: string;
  curvedPricePerKgOverride: string;
  circularPricePerKgOverride: string;
  densityOverrideKgM3: string;
};
const PAYMENT_METHOD_OPTIONS = [
  { value: "CHEQUE", en: "Post-dated cheques", ar: "شيكات مؤجلة" },
  { value: "BANK_TRANSFER", en: "Bank transfer", ar: "تحويل بنكي" },
  { value: "CASH", en: "Cash", ar: "نقدًا" },
  { value: "LC", en: "Letter of credit", ar: "اعتماد مستندي" },
];
const DOCUMENT_TYPE_OPTIONS = [
  { value: "QUOTATION", en: "Quotation", ar: "عرض سعر" },
  { value: "PROFORMA_INVOICE", en: "Proforma invoice", ar: "فاتورة أولية" },
];
const INCOTERM_OPTIONS = [
  { value: "", en: "Not set", ar: "غير محدد" },
  { value: "DDP", en: "DDP — Delivered Duty Paid", ar: "DDP — التسليم للموقع" },
  {
    value: "CIF",
    en: "CIF — Cost, Insurance & Freight",
    ar: "CIF — تكلفة وتأمين وشحن",
  },
  { value: "FOB", en: "FOB — Free On Board", ar: "FOB — تسليم الميناء" },
];
/**
 * Payment terms come from the pricing module, not from this file.
 *
 * They used to be a list typed out here, and two of its six codes — the two a
 * salesperson reaches for most, `ADVANCE_100` and `ADVANCE_50_50` — did not
 * exist in the payment_terms table. The server checks that the code is a live
 * term before it writes a draft, so choosing either of them and saving failed
 * with PAYMENT_TERM_NOT_FOUND: a quotation that could not be saved because of
 * a list the screen invented. A list read from the same table the server
 * validates against cannot drift from it.
 *
 * `NOT_SET` is the only entry added here, because "no terms yet" is a state of
 * the quotation rather than a term the company offers.
 */
const NOT_SET_TERM = { value: "", en: "Not set", ar: "غير محدد" };
export function QuotationStudio({ client, me }: { client: ApiClient; me: Me }) {
  const navigate = useNavigate();
  const [previewUrl, setPreviewUrl] = useState("");
  const { quotationId = "" } = useParams();
  const { locale } = useI18n();
  const [tab, setTab] = useState("documents");
  const [openLineIndex, setOpenLineIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState<Line[] | null>(null);
  const [adjustmentDraft, setAdjustmentDraft] = useState<Adjustment[] | null>(
    null,
  );
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft | null>(null);
  /**
   * The live payment terms, read from the pricing module.
   *
   * The server refuses to save a draft whose payment term is not a live row in
   * `payment_terms`, so these have to be the rows rather than a copy of them.
   */
  const paymentTerms = useQuery({
    queryKey: ["payment-terms"],
    queryFn: () =>
      commercialRequest(client, "GET", "/payment-terms", {
        path: {},
        query: { page: 1, limit: 100 },
      }),
  });
  const termOptions = [
    NOT_SET_TERM,
    ...rows(paymentTerms.data?.data).map((row) => {
      const value = str(row.termCode);
      const text = str(row.displayText);
      return { value, en: text, ar: text };
    }),
  ];

  /** The consolidated line whose code picker is open, if any. */
  /** What the code picker searches on: a size, and the words when there is none. */
  const [codePickerLine, setCodePickerLine] = useState<{
    description: string;
    thicknessMm: number;
    widthMm: number;
    lengthMm: number;
  } | null>(null);

  const [prepareBlockers, setPrepareBlockers] = useState<
    { code: string; field: string | null; message: string }[]
  >([]);
  const [overrideLineId, setOverrideLineId] = useState<string | null>(null);
  const [overridePrice, setOverridePrice] = useState("");
  const [overrideReason, setOverrideReason] = useState("");
  const toast = useToast();
  const requestOverride = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/pricing/manager-overrides", {
        path: {},
        body: {
          quotationId,
          quotationLineId: overrideLineId,
          expectedRowVersion: str(detail.rowVersion),
          requestedUnitPrice: overridePrice,
          reason: overrideReason,
        },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      setOverrideLineId(null);
      setOverridePrice("");
      setOverrideReason("");
      setPrepareBlockers([]);
      await query.refetch();
      toast.success(
        locale === "ar" ? "تم اعتماد الاستثناء" : "Override approved",
      );
    },
  });
  const query = useQuery({
    queryKey: ["quotation-studio", quotationId],
    queryFn: () =>
      commercialRequest(client, "GET", "/quotations/{quotationId}", {
        path: { quotationId },
      }),
  });
  const detail =
    isObject(query.data?.data) && isObject(query.data.data.data)
      ? query.data.data.data
      : {};

  /**
   * Who wrote this quotation, for the name and the number on the document.
   *
   * A customer with a question about a quotation rings the person whose name
   * is on it, so both come from that person rather than from a company
   * setting. The directory already holds a display name, a job title and a
   * phone — and it hides the phone when the colleague has chosen to hide it,
   * which is the right answer here too.
   */
  const ownerProfile = useQuery({
    queryKey: ["user-profile", str(detail.ownerUserId)],
    enabled: str(detail.ownerUserId) !== "" && str(detail.ownerUserId) !== "—",
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () =>
      commercialRequest(client, "GET", "/users/{userId}/profile", {
        path: { userId: str(detail.ownerUserId) },
      }),
  });
  const owner = (() => {
    const payload = ownerProfile.data?.data;
    const data =
      isObject(payload) && isObject(payload.data) ? payload.data : null;
    if (data === null) return { name: "", phone: "" };
    return { name: str(data.displayName), phone: str(data.phone) };
  })();

  const createFromPrevious = useMutation({
    mutationFn: () =>
      copyQuotation(client, quotationId, str(detail.rowVersion)),
    onSuccess: (created) => {
      setDraft(null);
      setAdjustmentDraft(null);
      setHeaderDraft(null);
      toast.success(
        locale === "ar"
          ? "تم إنشاء عرض جديد كمسودة"
          : "New draft quotation created",
      );
      void navigate(`/quotations/${created.quotationId}`);
    },
  });
  const accountContext = useQuery({
    queryKey: ["quotation-account", detail.accountId],
    enabled:
      typeof detail.accountId === "string" &&
      me.access.permissions.includes("accounts.view"),
    queryFn: () =>
      commercialRequest(client, "GET", "/accounts/{accountId}", {
        path: { accountId: str(detail.accountId) },
      }),
  });
  const projectContext = useQuery({
    queryKey: ["quotation-project", detail.projectId],
    enabled:
      typeof detail.projectId === "string" &&
      me.access.permissions.includes("projects.view"),
    queryFn: () =>
      commercialRequest(client, "GET", "/projects/{projectId}", {
        path: { projectId: str(detail.projectId) },
      }),
  });
  const opportunityContext = useQuery({
    queryKey: ["quotation-opportunity", detail.opportunityId],
    enabled:
      typeof detail.opportunityId === "string" &&
      me.access.permissions.includes("opportunities.view"),
    queryFn: () =>
      commercialRequest(client, "GET", "/opportunities/{opportunityId}", {
        path: { opportunityId: str(detail.opportunityId) },
      }),
  });
  const account = nestedData(accountContext.data?.data);
  const project = nestedData(projectContext.data?.data);
  const opportunity = nestedData(opportunityContext.data?.data);
  const source: Line[] = rows(detail.lines).map((item) => {
    const snapshot = isObject(item.priceSnapshot) ? item.priceSnapshot : null;
    const isEngineering = snapshot?.source === "ENGINEERING_CALC";
    const engInputs =
      isEngineering && isObject(snapshot.inputs) ? snapshot.inputs : null;
    const materialClass = (
      isEngineering && typeof snapshot.materialClass === "string"
        ? snapshot.materialClass
        : ""
    ) as MaterialClass | "";
    const circular =
      isEngineering && isObject(snapshot.circular) ? snapshot.circular : null;
    // A column or a circular column comes back as the panels it produced;
    // its own inputs are rebuilt from the snapshot so the line can be priced
    // and saved again -- see restore-line-geometry.ts.
    const restored = isEngineering ? restoreLineGeometry(snapshot) : {};
    /*
     * A board line saved without its snapshot -- which every re-save used to
     * do, see below -- still says what it is in its description. Recovered
     * as the board it names, with its saved price kept, so it is counted in
     * the summary, weighed and coded again. A multi-size schedule ("(+3
     * sizes)") cannot be rebuilt from one name, and an accessory has no size
     * at all; both stay as priced lines.
     */
    const savedName = str(item.description);
    const recovered =
      !isEngineering && !/\(\+\d+ size/i.test(savedName)
        ? parseBoardDimensions(savedName)
        : null;
    const recoveredClass: MaterialClass | "" =
      recovered === null
        ? ""
        : /curved/i.test(savedName)
          ? "CURVED"
          : "STANDARD";
    /*
     * On a draft, a line the engine priced goes back to the engine. Sending
     * its saved price back instead made the server treat it as typed by hand,
     * which drops the line's snapshot -- its type, sizes and weight -- so each
     * save lost a little more of it and the next reopening left it out of the
     * summary altogether. A sent quotation keeps the price it was sent at.
     */
    const reprice = isEngineering && detail.statusCode === "DRAFT";
    return {
      ...(item.quotationLineId
        ? { quotationLineId: str(item.quotationLineId) }
        : {}),
      ...(item.productId ? { productId: str(item.productId) } : {}),
      description: str(item.description),
      // Columns, not the panels they made: the schedule multiplies columns.
      qty: restored.qty ?? str(item.qty),
      unitCode: str(item.unitCode),
      unitPrice: reprice ? null : str(item.unitPrice),
      discountAmount: str(item.discountAmount ?? "0"),
      sectionLabel: str(item.sectionLabel ?? ""),
      pricingMethodCode: (isEngineering && typeof snapshot.method === "string"
        ? snapshot.method
        : "") as EngineeringPricingMethod | "",
      lengthMm:
        engInputs?.lengthMm != null
          ? str(engInputs.lengthMm)
          : recovered
            ? String(recovered.lengthMm)
            : "",
      widthMm:
        engInputs?.widthMm != null
          ? str(engInputs.widthMm)
          : recovered
            ? String(recovered.widthMm)
            : "",
      thicknessMm:
        engInputs?.thicknessMm != null
          ? str(engInputs.thicknessMm)
          : recovered
            ? String(recovered.thicknessMm)
            : "",
      // The line's own figures only -- an inherited one is left blank so the
      // line keeps following the quotation and the company. Older snapshots
      // have no `own` block: the rate is read back from `priceSource`, and the
      // density as before.
      densityKgM3:
        ownValue(snapshot, "densityKgM3") ??
        (engInputs?.densityKgM3 != null && !hasOwnBlock(snapshot)
          ? str(engInputs.densityKgM3)
          : ""),
      pricePerKg:
        ownValue(snapshot, "pricePerKg") ??
        (!hasOwnBlock(snapshot) &&
        snapshot?.priceSource === "ITEM_OVERRIDE" &&
        snapshot.appliedPricePerKg != null
          ? str(snapshot.appliedPricePerKg)
          : ""),
      boardTypeLabel: materialClass
        ? DEFAULT_BOARD_TYPE_LABEL_BY_CLASS[materialClass]
        : isEngineering && typeof snapshot.method === "string"
          ? DEFAULT_BOARD_TYPE_LABEL[
              snapshot.method as EngineeringPricingMethod
            ]
          : "",
      // Saved descriptions are never re-auto-generated on load, to avoid
      // silently overwriting anything a user already typed.
      descriptionAuto: false,
      materialClass: materialClass || recoveredClass,
      category:
        isEngineering && typeof snapshot.category === "string"
          ? snapshot.category
          : "",
      reference:
        isEngineering && typeof snapshot.reference === "string"
          ? snapshot.reference
          : "",
      cadMark:
        isEngineering && typeof snapshot.cadMark === "string"
          ? snapshot.cadMark
          : "",
      diameterMm:
        restored.diameterMm ??
        (circular?.diameterMm != null ? str(circular.diameterMm) : ""),
      radiusMm:
        restored.radiusMm ??
        (circular?.radiusMm != null ? str(circular.radiusMm) : ""),
      // Rebuilt, not blanked. Blank, a reopened column priced at nothing and
      // could not be saved again.
      columnHeightMm: restored.columnHeightMm ?? "",
      mouldSegments: restored.mouldSegments ?? "",
      arcModuleMm: restored.arcModuleMm ?? "",
      verticalCourseMm: restored.verticalCourseMm ?? "",
      columnShape:
        isObject(snapshot?.column) && snapshot.column.shape === "IRREGULAR"
          ? "IRREGULAR"
          : "RECTANGULAR",
      sideAMm: restored.sideAMm ?? "",
      sideBMm: restored.sideBMm ?? "",
      faceWidthsMm:
        isObject(snapshot?.column) &&
        Array.isArray(snapshot.column.faceWidthsMm)
          ? snapshot.column.faceWidthsMm.map((face) => str(face))
          : [],
      maxPanelWidthMm: "",
      maxPanelLengthMm: "",
      curvedFaceNumbers: restored.curvedFaceNumbers ?? [],
      expectedFaces: "",
      columnSideCount: "4",
      sideWidthsMm: "",
      arcLengthMm: "",
      arcAngleDeg: "",
      // The server records the span it used on the line's price snapshot, so a
      // reopened quotation shows the same figure it was priced with.
      extensionLengthM: isObject(snapshot?.extension)
        ? str(snapshot.extension.extensionLengthM ?? "")
        : "",
      // Same for a stored pricing rule: the snapshot records which one priced
      // the line and at what rate, so reopening it shows what it was sold on.
      customFormulaKey: isObject(snapshot?.formula)
        ? str(snapshot.formula.key ?? "")
        : "",
      formulaRate: isObject(snapshot?.formula)
        ? str(snapshot.formula.rate ?? "")
        : "",
      fabricationCost: "",
      fixedCost: "",
    };
  });
  const lines = draft ?? source;
  const sourceAdjustments: Adjustment[] = rows(detail.adjustments).map(
    (item) => ({
      typeCode: str(item.typeCode || "ADJUSTMENT"),
      modeCode: item.modeCode === "PERCENT" ? "PERCENT" : "FIXED_AMOUNT",
      value: str(item.value || "0"),
      label: str(item.label || ""),
    }),
  );
  const adjustments = adjustmentDraft ?? sourceAdjustments;
  const scheduleSnapshot = isObject(detail.paymentScheduleJson)
    ? detail.paymentScheduleJson
    : null;
  const sourceHeader: HeaderDraft = {
    documentTypeCode: str(detail.documentTypeCode ?? "QUOTATION"),
    incotermCode: str(detail.incotermCode ?? ""),
    subject: str(detail.subject ?? ""),
    customerPoNumber: str(detail.customerPoNumber ?? ""),
    leadTime: str(detail.leadTime ?? ""),
    freightAmount: detail.freightAmount ? str(detail.freightAmount) : "",
    deliveryAddress: str(detail.deliveryAddress ?? ""),
    portOfLoading: str(detail.portOfLoading ?? ""),
    portOfDischarge: str(detail.portOfDischarge ?? ""),
    paymentTermsCode: str(detail.paymentTermsCode ?? ""),
    contactId: detail.contactId ? str(detail.contactId) : "",
    paymentScheduleCode: scheduleSnapshot ? "ADVANCE_INSTALLMENTS" : "",
    advancePct: scheduleSnapshot ? str(scheduleSnapshot.advancePct) : "40",
    installments: scheduleSnapshot ? str(scheduleSnapshot.installments) : "4",
    frequencyDays: scheduleSnapshot
      ? str(scheduleSnapshot.frequencyDays)
      : "30",
    referenceDate:
      scheduleSnapshot && scheduleSnapshot.referenceDate
        ? str(scheduleSnapshot.referenceDate)
        : "",
    paymentMethod: scheduleSnapshot
      ? str(scheduleSnapshot.paymentMethod)
      : "CHEQUE",
    standardPricePerKgOverride: detail.standardPricePerKgOverride
      ? str(detail.standardPricePerKgOverride)
      : "",
    circularPricePerKgOverride: detail.circularPricePerKgOverride
      ? str(detail.circularPricePerKgOverride)
      : "",
    curvedPricePerKgOverride: detail.curvedPricePerKgOverride
      ? str(detail.curvedPricePerKgOverride)
      : "",
    densityOverrideKgM3: detail.densityOverrideKgM3
      ? str(detail.densityOverrideKgM3)
      : "",
  };
  const header = headerDraft ?? sourceHeader;
  /**
   * The subject lines a document can carry, and a way to add one.
   *
   * Company-wide: a subject added from any quotation is offered on every
   * quotation after it, which is the point -- see SubjectPicker.tsx.
   */
  const queryClient = useQueryClient();
  const documentSubjects = useQuery({
    queryKey: ["document-subjects"],
    staleTime: 5 * 60_000,
    queryFn: () =>
      commercialRequest(client, "GET", "/document-subjects", {
        path: {},
        query: { page: 1, limit: 100 },
      }),
  });
  const subjectOptions = rows(documentSubjects.data?.data)
    .map((row) => str(row.subjectText))
    .filter((text) => text !== "" && text !== "—");
  /** The default, used for a quotation that has not chosen one yet. */
  const defaultSubject = str(
    rows(documentSubjects.data?.data).find((row) => row.isDefault === true)
      ?.subjectText ?? "",
  );
  const addSubject = useMutation({
    mutationFn: (subjectText: string) =>
      commercialRequest(client, "POST", "/document-subjects", {
        path: {},
        // Every command endpoint requires one, and the server answers 400
        // without it: adding a subject failed with the popup still open and
        // nothing on screen saying why beyond "try again".
        idempotencyKey: crypto.randomUUID(),
        body: { subjectText },
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["document-subjects"] });
    },
  });
  const accountContacts = useQuery({
    queryKey: ["quotation-account-contacts", detail.accountId],
    enabled: typeof detail.accountId === "string",
    queryFn: () =>
      listContacts(client, str(detail.accountId), { page: 1, limit: 100 }),
  });
  /**
   * The buyer's telephone and e-mail, which needed no new column.
   *
   * They have always been on `contact_channels` and have always been
   * populated; the proforma's buyer block simply never read them. The contact
   * list gives a name and a job title, so the chosen contact is fetched in
   * full for their channels.
   */
  const buyerContactId = header.contactId;
  const buyerContact = useQuery({
    queryKey: ["quotation-buyer-contact", buyerContactId],
    enabled: buyerContactId !== "" && buyerContactId !== "—",
    staleTime: 5 * 60_000,
    retry: false,
    queryFn: () =>
      commercialRequest(client, "GET", "/contacts/{contactId}", {
        path: { contactId: buyerContactId },
      }),
  });
  const buyerChannels = (() => {
    const payload = buyerContact.data?.data;
    const data =
      isObject(payload) && isObject(payload.data) ? payload.data : null;
    return (data === null ? [] : rows(data.channels)).map((channel) => ({
      channelTypeCode: str(channel.channelTypeCode),
      // `str` gives an em dash for nothing, which would be printed into a
      // customs document's telephone box; a blank is the honest answer.
      value: str(channel.value) === "—" ? "" : str(channel.value),
      isPrimary: channel.isPrimary === true,
    }));
  })();
  const editable =
    detail.statusCode === "DRAFT" &&
    me.access.permissions.includes("quotations.edit");
  const mayCopy =
    me.access.permissions.includes("quotations.create") &&
    canCopyQuotation(str(detail.statusCode));
  const pricingBasis = useQuery({
    queryKey: ["pricing-standard-board-basis"],
    queryFn: () =>
      commercialRequest(client, "GET", "/pricing/standard-board-basis", {
        path: {},
      }),
  });
  // The envelope is {data:{...}} and executeOperation wraps it again, so the
  // company defaults sit at .data.data.data. Reading one level short returned
  // the envelope, every field came back undefined, and the whole screen ran on
  // its hardcoded fallbacks -- rates of 90/120 and a density of 720 where the
  // workbook says 77.76 and 600. It looked like working code because every
  // fallback was a plausible number.
  const basis =
    isObject(pricingBasis.data?.data) && isObject(pricingBasis.data.data.data)
      ? pricingBasis.data.data.data
      : {};
  // `Number(x ?? d)` was the shape of every line below, and it is a trap: `??`
  // only fires on null/undefined, so a field the API sends as "" — or as a
  // code where a decimal was expected — becomes NaN and the fallback beside it
  // never applies. The NaN then travels into the board-weight arithmetic and
  // surfaces on screen as «NaN×NaN×NaN مم · NaN كجم/م³». `toNum` applies the
  // fallback whenever the parse would not be finite, which is what was meant.
  // The fallbacks are the workbook's own MASTER SETTINGS, shared with the
  // wizard. They used to be literals here — 90 EGP/kg and 720 kg/m³ — while
  // the wizard had already been corrected to the sheet's 77.76 and 600, so
  // the same board priced differently depending on which screen you opened.
  const companyRates: Record<MaterialClass, number> = {
    STANDARD: toNum(basis.standardPricePerKg, WORKBOOK.standardPricePerKg),
    REGULAR: toNum(basis.standardPricePerKg, WORKBOOK.standardPricePerKg),
    CURVED: toNum(basis.curvedPricePerKg, WORKBOOK.curvedPricePerKg),
    CIRCULAR: toNum(basis.circularPricePerKg, WORKBOOK.curvedPricePerKg),
    CORE: toNum(basis.standardPricePerKg, WORKBOOK.standardPricePerKg),
    WALL: toNum(basis.standardPricePerKg, WORKBOOK.standardPricePerKg),
  };
  const companyDefaultDensity = toNum(
    basis.defaultDensityKgM3,
    WORKBOOK.densityKgM3,
  );
  const companyDefaultThickness = toNum(
    basis.defaultThicknessMm,
    WORKBOOK.thicknessMm,
  );
  // Reference board (1220x2440x18mm by default) — the fixed footprint the
  // board-price <-> price/kg conversion is anchored to, mirroring the ACROW
  // BOARD sheet's SETTINGS!B36 (Reference Board Weight) formula exactly.
  const referenceBoardWidthMm = toNum(
    basis.referenceBoardWidthMm,
    WORKBOOK.maxPanelWidthMm,
  );
  const referenceBoardLengthMm = toNum(
    basis.referenceBoardLengthMm,
    WORKBOOK.standardBoardLengthMm,
  );
  const companyDefaultDiscountPct = toNum(basis.defaultDiscountPct, 0);
  // The workbook's MASTER SETTINGS takeoff figures, as the company has them.
  const takeoffDefaults: TakeoffDefaults = {
    columnHeightMm: toNum(
      basis.defaultColumnHeightMm,
      WORKBOOK_TAKEOFF_DEFAULTS.columnHeightMm,
    ),
    maxPanelWidthMm: toNum(
      basis.maxPanelWidthMm,
      WORKBOOK_TAKEOFF_DEFAULTS.maxPanelWidthMm,
    ),
    maxPanelLengthMm: toNum(
      basis.maxPanelLengthMm,
      WORKBOOK_TAKEOFF_DEFAULTS.maxPanelLengthMm,
    ),
    closureAllowanceMm: toNum(
      basis.columnClosureAllowanceMm,
      WORKBOOK_TAKEOFF_DEFAULTS.closureAllowanceMm,
    ),
  };
  // Pricing rules stored as data. They ride along with the company defaults,
  // so the picker needs no round trip of its own.
  const calculationFormulas: CalculationFormulaOption[] = Array.isArray(
    basis.calculationFormulas,
  )
    ? basis.calculationFormulas.filter(isCalculationFormula)
    : [];
  // This is the same order used by the API: line totals after per-line
  // discounts, then quotation adjustments, then VAT. Keeping it local makes
  // every edit immediately visible, while the API remains authoritative on save.
  const liveSubtotal = lines.reduce((sum, line) => {
    const material = computeMaterialClassPreview(
      line,
      header,
      companyRates,
      companyDefaultDensity,
      companyDefaultThickness,
      calculationFormulas,
      takeoffDefaults,
    );
    return sum + previewLineTotal(line, material);
  }, 0);
  const liveLineDiscount = lines.reduce(
    (sum, line) => sum + Number(line.discountAmount || 0),
    0,
  );
  // Spec SS22: what this quotation actually delivers, alongside what it costs.
  // Pieces and weight are what the factory and the shipper plan against, and
  // the status is the one number that says whether it can be issued at all.
  // The same consolidation the wizard does, because a quotation opened here
  // and one built there are the same document. Without this the studio kept
  // showing one line per scope with "(+3 sizes)" beside it, so the two
  // screens disagreed about what was being sold.
  const generatedPieces = lines.flatMap((line, index) => {
    if (!line.materialClass) return [];
    const preview = computeMaterialClassPreview(
      line,
      header,
      companyRates,
      companyDefaultDensity,
      companyDefaultThickness,
      calculationFormulas,
      takeoffDefaults,
    );
    if (!preview) return [];
    return piecesFromScope({
      sourceLabel:
        line.sectionLabel.trim() ||
        line.description.trim() ||
        `#${String(index + 1)}`,
      materialClass: line.materialClass,
      thicknessMm: toNum(line.thicknessMm, companyDefaultThickness),
      densityKgM3: toNum(line.densityKgM3, companyDefaultDensity),
      unitPrice:
        line.unitPrice != null && line.unitPrice !== ""
          ? Number(line.unitPrice)
          : preview.unitPrice,
      // Each generated piece is priced from its own dimensions. One price
      // across a column's whole schedule charged a 400 mm piece what a
      // 1200 mm piece costs. A line with a saved price keeps that price: the
      // summary is what the customer is charged, not what today's rate says.
      ...(line.unitPrice != null && line.unitPrice !== ""
        ? {}
        : { pricePerKg: resolveLineRate(line, header, companyRates) }),
      currencyCode: str(detail.currencyCode) || "EGP",
      productId: line.productId,
      ...(preview.circular?.diameterMm == null
        ? {}
        : { diameterMm: preview.circular.diameterMm }),
      ...(preview.column
        ? {
            panels: preview.column.panels.map((panel) => ({
              widthMm: panel.widthMm,
              lengthMm: panel.lengthMm,
              totalCount: panel.totalCount,
            })),
          }
        : {}),
      ...(preview.circular
        ? {
            arcPieces: preview.circular.pieces.map((arc) => ({
              widthMm: arc.widthMm,
              heightMm: arc.heightMm,
              totalCount: arc.totalCount,
            })),
          }
        : {}),
      ...(!preview.column && !preview.circular
        ? {
            flat: {
              widthMm: toNum(line.widthMm, 0),
              lengthMm: toNum(line.lengthMm, 0),
              qty: preview.pricedQty,
            },
          }
        : {}),
    });
  });
  // Searched by the sizes this quotation generated rather than by pulling a
  // page of the master: the endpoint caps a page at 200 of 2,927 items, so a
  // blanket fetch missed the match far more often than it found it.
  const wantedSizes = lines
    .filter((line) => line.materialClass !== "")
    .map((line) => ({
      thicknessMm: toNum(line.thicknessMm, companyDefaultThickness),
      widthMm: toNum(line.widthMm, 0),
      lengthMm: toNum(line.lengthMm, 0),
    }))
    .filter((size) => size.widthMm > 0)
    // A column or a circular line has no width of its own: what it delivers
    // is its panels and arcs, and those are the boards that carry codes. They
    // were never looked up, so every panel stayed "Pending" in the summary
    // even where the catalogue holds its code (18 x 620 x 2000 does).
    .concat(
      generatedPieces.map((piece) => ({
        thicknessMm: piece.thicknessMm,
        widthMm: Math.min(piece.widthMm, piece.lengthMm),
        lengthMm: Math.max(piece.widthMm, piece.lengthMm),
      })),
    );
  // Not only on the summary any more: the items step reads it to put a
  // code on each line as its sizes are typed.
  const catalogueQuery = useSizeCatalogue(client, wantedSizes);
  const catalogue = catalogueQuery.products;
  /**
   * The code follows the sizes.
   *
   * A line whose sizes were just typed carries `codeAuto`, and once the
   * catalogue for that size has loaded it takes the first code at that size.
   * A code picked by hand clears the flag, so it survives later edits, and a
   * quotation opened fresh is never touched -- nothing here runs until
   * somebody types.
   */
  useEffect(() => {
    if (!editable || catalogue.length === 0) return;
    const next = lines.map((line) => {
      if (line.codeAuto !== true) return line;
      const size = flatSizeOf(line);
      if (size === null) return line;
      const first = codeOptions(size, catalogue)[0];
      const productId = first?.product.productId;
      if (productId === line.productId) return line;
      return productId === undefined
        ? withoutProductId(line)
        : { ...line, productId };
    });
    if (next.some((line, position) => line !== lines[position])) setDraft(next);
  }, [catalogue, lines, editable]);
  const consolidatedLines = consolidateQuotationLines(generatedPieces, {
    catalogue,
  });
  const consolidationSafe = consolidationIsValueNeutral(
    generatedPieces,
    consolidatedLines,
  );

  const liveEngineering = lines.reduce(
    (acc, line) => {
      const preview = computeMaterialClassPreview(
        line,
        header,
        companyRates,
        companyDefaultDensity,
        companyDefaultThickness,
        calculationFormulas,
        takeoffDefaults,
      );
      const status = lineStatus(
        line,
        preview,
        header,
        companyRates,
        companyDefaultDensity,
        companyDefaultThickness,
      );
      return {
        pieces:
          acc.pieces + (preview ? preview.pricedQty : Number(line.qty || 0)),
        weightKg: acc.weightKg + (preview?.totalWeightKg ?? 0),
        statuses: [...acc.statuses, status],
      };
    },
    {
      pieces: 0,
      weightKg: 0,
      statuses: [] as QuotationLineStatus[],
    },
  );
  const quotationStatus = rollUpQuotationStatus(liveEngineering.statuses);
  const liveAdjustmentAmount = adjustments.reduce((sum, adjustment) => {
    const value = Number(adjustment.value || 0);
    return (
      sum +
      (adjustment.modeCode === "PERCENT" ? (liveSubtotal * value) / 100 : value)
    );
  }, 0);
  const savedTaxableAmount =
    toNum(detail.subtotalAmount, 0) + toNum(detail.adjustmentAmount, 0);
  // A saved quotation carries its own VAT, so divide it back out and the rate
  // is exactly what the API applied. A quotation with nothing saved yet has no
  // tax to divide — and 0% there was showing a grand total the API would never
  // return, so the company rate stands in until the first save.
  const inferredVatRate =
    savedTaxableAmount > 0
      ? (toNum(detail.taxAmount, 0) / savedTaxableAmount) * 100
      : WORKBOOK.vatRate * 100;
  const liveTaxableAmount = liveSubtotal + liveAdjustmentAmount;
  const liveTaxAmount = (liveTaxableAmount * inferredVatRate) / 100;
  const liveGrandTotal = liveTaxableAmount + liveTaxAmount;
  const exportCurrency = str(detail.currencyCode) || "EGP";
  const schedulePreview =
    header.paymentScheduleCode === "ADVANCE_INSTALLMENTS"
      ? computePaymentSchedulePreview({
          grandTotal: liveGrandTotal,
          advancePct: Number(header.advancePct || 0),
          installments: Number(header.installments || 1),
          frequencyDays: Number(header.frequencyDays || 0),
          referenceDate: header.referenceDate || null,
          paymentMethod: header.paymentMethod,
        })
      : null;
  const exportPlan = planForTerm(header.paymentTermsCode);
  // "Not set" is the picker's word for nothing chosen; printed on a
  // customer's copy it read as the payment terms themselves.
  const exportPaymentText =
    header.paymentTermsCode === ""
      ? undefined
      : termOptions.find((option) => option.value === header.paymentTermsCode)
          ?.en;
  /**
   * An advance and instalments are the terms when they are set. The code
   * for a standard term is empty then, so the document printed "Not set"
   * above a schedule the customer had agreed to.
   */
  const scheduleShort =
    schedulePreview === null
      ? null
      : `${String(Number(header.advancePct || 0))}% advance + ${String(
          Number(header.installments || 1),
        )} ${Number(header.installments || 1) === 1 ? "instalment" : "instalments"}`;
  /** An em dash is a screen's way of saying nothing; a document says nothing. */
  const blankIfDash = (value: string) => (value === "—" ? "" : value);

  const exportLines: QuotationExport["lines"] =
    consolidatedLines.length > 0
      ? consolidatedLines.map((line) => ({
          // Blank, not the status: "CODE_PENDING" in a customer's copy is
          // our internal enum leaking into their document.
          code: line.itemCode ?? "",
          description: line.description,
          qty: line.qty,
          unit: "PIECE",
          unitPrice: line.unitPrice,
          lineTotal: line.lineTotal,
        }))
      : lines.map((line) => {
          const preview = computeMaterialClassPreview(
            line,
            header,
            companyRates,
            companyDefaultDensity,
            companyDefaultThickness,
            calculationFormulas,
            takeoffDefaults,
          );
          const qty = preview?.pricedQty ?? toNum(line.qty, 0);
          const unitPrice =
            line.unitPrice == null || line.unitPrice === ""
              ? (preview?.unitPrice ?? 0)
              : toNum(line.unitPrice, 0);
          return {
            // A line with no catalogue item has no item code. "CODED" and
            // "CODE_PENDING" are how this screen talks to itself.
            code: "",
            description: line.description,
            qty,
            unit: line.unitCode,
            unitPrice,
            lineTotal: previewLineTotal(line, preview),
          };
        });
  /**
   * What a proforma carries and a quotation does not.
   *
   * The weights are the ones the consolidation already worked out per line, so
   * the invoice is weighed on the same arithmetic the quotation was priced on.
   * The packing allowance is the 10% the archive's proformas add over net —
   * `A309-2026` reads 4,261.805 net and 4,687.986 gross, which is exactly 10%.
   */
  const proformaExtra = {
    lineWeightsKg: consolidatedLines.map((line) =>
      line.qty > 0 ? line.totalWeightKg / line.qty : 0,
    ),
    customerItems: consolidatedLines.map((line) => line.itemCode ?? ""),
    netWeightKg: consolidatedLines.reduce(
      (sum, line) => sum + line.totalWeightKg,
      0,
    ),
    grossWeightKg: grossWeightKg(
      consolidatedLines.reduce((sum, line) => sum + line.totalWeightKg, 0),
      // 10%, the allowance every proforma in the archive adds over net.
      PROFORMA_PACKING_PCT,
    ),
    // The buyer block, filled from where each part actually lives: the
    // address and the tax number on the customer, because they are the same
    // on every document that customer is sent; the telephone and e-mail on
    // the contact's own channels, which have been populated all along and
    // were simply never read; the purchase-order number on this quotation,
    // because the next order has a different one.
    buyerAddress: blankIfDash(str(account.address)),
    buyerTaxNo: blankIfDash(str(account.taxNumber)),
    buyerTel: pickChannel(buyerChannels, TELEPHONE_TYPES),
    buyerEmail: pickChannel(buyerChannels, EMAIL_TYPES),
    contactEmail: pickChannel(buyerChannels, EMAIL_TYPES),
    customerPo: blankIfDash(header.customerPoNumber),
    leadTime: blankIfDash(header.leadTime),
    // Freight turns EX-WORKS into CIF. Zero is not "no freight stated" -- it
    // is a freight of nothing -- so an empty box leaves the row off.
    ...(header.freightAmount === ""
      ? {}
      : {
          freightCost: toNum(header.freightAmount, 0),
          cifInWords: amountInWords(
            liveGrandTotal + toNum(header.freightAmount, 0),
            exportCurrency === "USD" ? "USD" : "EGP",
          ),
        }),
    // The port the goods are discharged at is the destination a proforma
    // states, and the quotation already carries it.
    finalDestination:
      blankIfDash(str(detail.portOfDischarge)) ||
      blankIfDash(str(detail.deliveryAddress)),
    contactPerson: blankIfDash(str(detail.contactName)),
    contactMobile:
      blankIfDash(owner.phone) || blankIfDash(str(basis.documentMobile)),
    paymentConditions:
      exportPlan === null
        ? []
        : splitInstalments(exportPlan, liveGrandTotal).map((part) =>
            part.daysAfterDelivery === 0
              ? `${String(part.percent)}% in advance (${formatMoney(part.amount)})`
              : `${String(part.percent)}% (${formatMoney(part.amount)}) after ${String(part.daysAfterDelivery)} days from the delivery date`,
          ),
  };

  const exportDocument: QuotationExport = {
    title:
      header.documentTypeCode === "PROFORMA_INVOICE"
        ? "PROFORMA INVOICE"
        : "QUOTATION",
    reference: str(detail.quoteRef ?? detail.quotationRef),
    issuedOn: blankIfDash(str(detail.validFrom ?? detail.createdAt)),
    currency: exportCurrency,
    fields: [
      {
        label: "Customer",
        value: str(account.canonicalName ?? detail.accountName),
      },
      // The template has a Subject box and the PDF prints the same rows, so
      // the subject is a document field rather than something passed only to
      // the spreadsheet writer.
      { label: "Subject", value: header.subject || defaultSubject },
      {
        label: "Project",
        value:
          blankIfDash(str(project.projectName ?? detail.projectName)) ||
          "General Use",
      },
      { label: "Valid until", value: str(detail.expiresOn) },
      // `str` gives an em dash when there is nothing; that is a placeholder for
      // a screen, and a document should simply not carry the row.
    ].filter((field) => field.value !== "" && field.value !== "—"),
    lines: exportLines,
    subtotal: liveSubtotal,
    discount: Math.max(0, -liveAdjustmentAmount),
    vatLabel: `VAT ${inferredVatRate.toFixed(2)}%`,
    vat: liveTaxAmount,
    grandTotal: liveGrandTotal,
    amountInWords: amountInWords(
      liveGrandTotal,
      exportCurrency === "USD" ? "USD" : "EGP",
    ),
    terms:
      schedulePreview !== null
        ? [schedulePreview.prose]
        : exportPlan !== null
          ? [paymentTermsSentence(exportPlan, liveGrandTotal)]
          : exportPaymentText
            ? [`Payment Terms: ${exportPaymentText}`]
            : [],
    footNote: "",
  };

  // What is actually in force, resolved once: the quotation's own override if
  // it has one, otherwise the company setting. The sheet prints both columns
  // side by side and so does the panel, so this is the single place the
  // "applied" column is decided.
  const appliedDensity = toNum(
    header.densityOverrideKgM3,
    companyDefaultDensity,
  );
  const appliedStandardRate = toNum(
    header.standardPricePerKgOverride,
    companyRates.STANDARD,
  );
  const appliedCurvedRate = toNum(
    header.curvedPricePerKgOverride,
    companyRates.CURVED,
  );
  // Circular falls back to curved before it falls back to its own company
  // rate, which is the order the override box's placeholder already promises.
  const appliedCircularRate = toNum(
    header.circularPricePerKgOverride,
    toNum(header.curvedPricePerKgOverride, companyRates.CIRCULAR),
  );
  const appliedReferenceWeightKg = referenceBoardWeightKg(
    referenceBoardWidthMm,
    referenceBoardLengthMm,
    companyDefaultThickness,
    appliedDensity,
  );
  const appliedBoardPrice = boardPriceFromPerKg(
    appliedStandardRate,
    appliedReferenceWeightKg,
  );
  // Percentage adjustments are stored negative for a discount; the sheet shows
  // the discount as a positive percentage, so flip the sign back for display.
  // `-0` compares equal to `0` but formats as "-0.00%", which is how a
  // quotation with no discount at all came to show a negative one in Arabic.
  const discountPctSum = -adjustments
    .filter((adjustment) => adjustment.modeCode === "PERCENT")
    .reduce((sum, adjustment) => sum + toNum(adjustment.value, 0), 0);
  const appliedDiscountPct = discountPctSum === 0 ? 0 : discountPctSum;
  const save = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "PUT",
        "/quotations/{quotationId}/draft-content",
        {
          path: { quotationId },
          ifMatch: query.data?.etag ?? str(detail.rowVersion),
          body: {
            lines: lines.map((line) => ({
              ...(line.quotationLineId
                ? { quotationLineId: line.quotationLineId }
                : {}),
              ...(line.productId ? { productId: line.productId } : {}),
              description: line.description,
              qty: line.qty,
              unitCode: line.unitCode,
              unitPrice: line.unitPrice,
              discountAmount: line.discountAmount,
              sectionLabel: line.sectionLabel,
              // boardTypeLabel/descriptionAuto are UI-only (drive the
              // auto-generated description above) and not part of the API contract.
              pricingMethodCode: line.materialClass
                ? null
                : line.pricingMethodCode || null,
              lengthMm: line.lengthMm || null,
              widthMm: line.widthMm || null,
              thicknessMm: line.thicknessMm || null,
              densityKgM3: line.densityKgM3 || null,
              pricePerKg: line.pricePerKg || null,
              materialClass: line.materialClass || null,
              category: line.category || null,
              reference: line.reference || null,
              cadMark: line.cadMark || null,
              diameterMm: line.diameterMm || null,
              radiusMm: line.radiusMm || null,
              columnHeightMm: line.columnHeightMm || null,
              mouldSegments: line.mouldSegments
                ? Number(line.mouldSegments)
                : null,
              arcModuleMm: line.arcModuleMm || null,
              verticalCourseMm: line.verticalCourseMm || null,
              extensionLengthM: line.extensionLengthM || null,
              // The server owns the client-facing name: it regenerates it
              // from the delivered dimensions so two lines for the same
              // product can never read differently on the same page.
              autoDescribe: line.descriptionAuto && Boolean(line.materialClass),
              columnShape:
                line.materialClass === "REGULAR" ? line.columnShape : null,
              sideAMm: line.sideAMm || null,
              sideBMm: line.sideBMm || null,
              faceWidthsMm: usesFaceList(line)
                ? line.faceWidthsMm.filter((face) => face.trim() !== "")
                : null,
              curvedFaceNumbers:
                usesFaceList(line) && line.curvedFaceNumbers.length > 0
                  ? line.curvedFaceNumbers
                  : null,
              expectedFaces: line.expectedFaces
                ? Number(line.expectedFaces)
                : null,
              maxPanelWidthMm: line.maxPanelWidthMm || null,
              maxPanelLengthMm: line.maxPanelLengthMm || null,
              customFormulaKey: line.customFormulaKey || null,
              formulaRate: line.formulaRate || null,
              fabricationCost: line.fabricationCost || null,
              fixedCost: line.fixedCost || null,
            })),
            adjustments,
            documentTypeCode: header.documentTypeCode,
            incotermCode: header.incotermCode || null,
            // The screen shows the company default when none is chosen, so
            // that is what is saved, rather than a blank the document then
            // prints.
            subject: header.subject || defaultSubject || null,
            customerPoNumber: header.customerPoNumber || null,
            leadTime: header.leadTime || null,
            freightAmount: header.freightAmount || null,
            deliveryAddress: header.deliveryAddress || null,
            portOfLoading: header.portOfLoading || null,
            portOfDischarge: header.portOfDischarge || null,
            paymentTermsCode: header.paymentTermsCode || null,
            contactId: header.contactId || null,
            customPaymentTerms: detail.customPaymentTerms,
            validFrom: detail.validFrom,
            expiresOn: detail.expiresOn,
            paymentScheduleCode: header.paymentScheduleCode || null,
            advancePct: header.paymentScheduleCode ? header.advancePct : null,
            installments: header.paymentScheduleCode
              ? Number(header.installments)
              : null,
            frequencyDays: header.paymentScheduleCode
              ? Number(header.frequencyDays)
              : null,
            referenceDate: header.paymentScheduleCode
              ? header.referenceDate || null
              : null,
            paymentMethod: header.paymentScheduleCode
              ? header.paymentMethod
              : null,
            standardPricePerKgOverride:
              header.standardPricePerKgOverride || null,
            curvedPricePerKgOverride: header.curvedPricePerKgOverride || null,
            circularPricePerKgOverride:
              header.circularPricePerKgOverride || null,
            densityOverrideKgM3: header.densityOverrideKgM3 || null,
          },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: async () => {
      await query.refetch();
      setDraft(null);
      setAdjustmentDraft(null);
      setHeaderDraft(null);
      toast.success(locale === "ar" ? "تم الحفظ" : "Saved");
    },
  });
  const related = useQuery({
    queryKey: ["quotation-studio", quotationId, tab],
    enabled: ["documents", "audit"].includes(tab),
    queryFn: () =>
      commercialRequest(
        client,
        "GET",
        tab === "documents"
          ? "/quotations/{quotationId}/documents"
          : "/quotations/{quotationId}/supersession-chain",
        { path: { quotationId } },
      ),
  });
  const commands =
    tab === "approval"
      ? [
          "post_quotations_by_quotationId_approval_requests",
          "post_quotations_by_quotationId_commercial_state_transitions",
        ]
      : tab === "documents"
        ? [
            "post_quotations_by_quotationId_prepare",
            "post_quotations_by_quotationId_send",
          ]
        : tab === "audit"
          ? ["post_quotations_by_quotationId_cancel"]
          : [];
  const preview = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/quotations/{quotationId}/preview", {
        path: { quotationId },
        body: { expectedRowVersion: str(detail.rowVersion), locale },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: (result) => {
      const envelope = result.data;
      if (
        isObject(envelope) &&
        isObject(envelope.data) &&
        typeof envelope.data.previewUrl === "string"
      )
        setPreviewUrl(envelope.data.previewUrl);
    },
  });
  const approvals = useQuery({
    queryKey: ["quotation-approvals", quotationId],
    enabled:
      me.access.permissions.includes("approvals.view") && !!detail.quoteRef,
    queryFn: () =>
      commercialRequest(client, "GET", "/approval-requests", {
        path: {},
        query: { search: str(detail.quoteRef), page: 1, limit: 25 },
      }),
  });
  const auditEvents = useQuery({
    queryKey: ["quotation-audit", quotationId],
    enabled: tab === "audit" && me.access.permissions.includes("audit.view"),
    queryFn: () =>
      commercialRequest(client, "GET", "/audit", {
        path: {},
        query: { limit: 100 },
      }),
  });
  const quotationApprovals = rows(approvals.data?.data).filter(
    (item) => item.quotationId === quotationId,
  );
  const latestApproval = quotationApprovals[0];
  const approvalDecisionOperation = operationById.get(
    "post_approval_requests_by_requestId_decisions",
  );
  const hasUnsavedChanges =
    draft !== null || headerDraft !== null || adjustmentDraft !== null;
  // What actually has to be there before a price can be approved. Incoterm,
  // contact person and the linked project are all real commercial fields, but
  // none of them changes a number: a domestic pick-up quote has no Incoterm, a
  // first approach to a new company has no named contact yet, and a direct
  // supply order has no project. Blocking approval on them turned the whole
  // studio red for quotations that were perfectly ready to send. Payment terms
  // stay required, because they change what the customer owes and when.
  // FOB names an Egyptian loading port, CIF the customer's discharge port,
  // DDP an address. The customer's own country floats to the top for CIF.
  /* The optional block opens only when something inside it is actually set,
     so an untouched quotation shows the line items straight away and a
     quotation with an override never hides it. */
  const pricingBlockOpen =
    Boolean(header.standardPricePerKgOverride) ||
    Boolean(header.curvedPricePerKgOverride) ||
    Boolean(header.circularPricePerKgOverride) ||
    Boolean(header.densityOverrideKgM3);
  /** A proforma is the customs document and asks for more than a quotation. */
  const isProforma = header.documentTypeCode === "PROFORMA_INVOICE";
  const goToStep = (id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const portSuggestions = suggestedPorts(
    header.incotermCode,
    typeof detail.countryCode === "string" ? detail.countryCode : undefined,
  );

  const missingFields = [
    !header.paymentTermsCode &&
      header.paymentScheduleCode !== "ADVANCE_INSTALLMENTS" &&
      (locale === "ar" ? "شروط الدفع" : "Payment terms"),
  ].filter((value): value is string => Boolean(value));
  // Worth filling in, never worth blocking on. Shown as a quiet note.
  const optionalGaps = [
    !detail.projectId && (locale === "ar" ? "المشروع" : "Project"),
    !header.incotermCode && "Incoterm",
    !header.contactId && (locale === "ar" ? "جهة الاتصال" : "Contact person"),
  ].filter((value): value is string => Boolean(value));
  return (
    <section className="workspace-page quotation-studio">
      <header className="page-heading quotation-studio-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {locale === "ar" ? "استوديو عرض السعر" : "Quotation studio"}
          </span>
          <h1 className="quotation-studio-title">
            {str(
              detail.quoteRef ??
                (locale === "ar" ? "عرض سعر مسودة" : "Draft quotation"),
            )}
            {/* The PI number is what the customer's finance department quotes
                back at you, so it sits beside the quotation number rather than
                buried in a panel. It exists only once the document is sent. */}
            {Boolean(detail.piNumber) && (
              <span className="quotation-pi-number">
                {locale === "ar" ? "فاتورة مبدئية" : "PI"}{" "}
                {str(detail.piNumber)}
              </span>
            )}
          </h1>
          {formatLongDate(detail.validFrom, locale) && (
            <p className="quotation-studio-date">
              {formatLongDate(detail.validFrom, locale)}
            </p>
          )}
          {/* Customer -> Project -> Opportunity -> Quotation. A quotation with
              no visible context is a number nobody can place. */}
          <nav
            className="quotation-context"
            aria-label={locale === "ar" ? "سياق العرض" : "Quotation context"}
          >
            {Boolean(detail.accountId) && (
              <Link to={`/customers/${str(detail.accountId)}`}>
                {str(
                  account.canonicalName ??
                    detail.accountName ??
                    (locale === "ar" ? "العميل" : "Customer"),
                )}
              </Link>
            )}
            {Boolean(detail.projectId) && (
              <Link to={`/projects/${str(detail.projectId)}`}>
                {locale === "ar" ? "المشروع" : "Project"}
              </Link>
            )}
            {Boolean(detail.opportunityId) && (
              <Link to={`/opportunities/${str(detail.opportunityId)}`}>
                {locale === "ar" ? "الفرصة" : "Opportunity"}
              </Link>
            )}
            <span aria-current="page">
              {str(
                detail.quoteRef ??
                  (locale === "ar" ? "عرض السعر" : "Quotation"),
              )}
            </span>
          </nav>
          {/* A superseded document is history. Saying so, with a link to what
              replaced it, is the difference between an archive and a trap. */}
          {detail.statusCode === "SUPERSEDED" && (
            <p className="quotation-superseded-note">
              {locale === "ar"
                ? "هذا العرض تم استبداله بعرض أحدث ولم يعد سارياً."
                : "This quotation was replaced by a newer one and is no longer live."}
            </p>
          )}
          {detail.statusCode === "CANCELLED" && (
            <p className="quotation-cancelled-note">
              {locale === "ar" ? "ملغي" : "Cancelled"}
              {Boolean(detail.cancellationReason) &&
                ` — ${str(detail.cancellationReason)}`}
            </p>
          )}
          <span
            style={{ display: "inline-flex", gap: 6, alignItems: "center" }}
          >
            <StatusChip
              code={
                detail.statusCode === "READY" &&
                detail.commercialState === "NOT_SUBMITTED"
                  ? "READY_NOT_SUBMITTED"
                  : str(detail.statusCode)
              }
            />
            {Boolean(detail.commercialState) &&
              detail.commercialState !== "NOT_SUBMITTED" && (
                <StatusChip code={str(detail.commercialState)} />
              )}
            {hasUnsavedChanges && (
              <span className="quotation-unsaved-badge">
                {locale === "ar" ? "تغييرات غير محفوظة" : "Unsaved changes"}
              </span>
            )}
          </span>
        </div>
        <div className="quotation-heading-actions">
          {mayCopy && (
            <button
              type="button"
              className="secondary quotation-copy-primary"
              disabled={createFromPrevious.isPending}
              onClick={() => {
                createFromPrevious.mutate();
              }}
            >
              <span aria-hidden="true">⧉</span>
              {createFromPrevious.isPending
                ? locale === "ar"
                  ? "جارٍ الإنشاء…"
                  : "Creating…"
                : detail.statusCode === "SENT"
                  ? locale === "ar"
                    ? "إنشاء نسخة مُحدّثة"
                    : "Create revised quotation"
                  : locale === "ar"
                    ? "إنشاء عرض جديد من هذا العرض"
                    : "Create new from this quotation"}
            </button>
          )}
          {editable && (
            <button
              className="primary"
              disabled={save.isPending || !hasUnsavedChanges}
              onClick={() => {
                save.mutate();
              }}
            >
              {save.isPending
                ? "…"
                : locale === "ar"
                  ? "حفظ المسودة"
                  : "Save draft"}
            </button>
          )}
        </div>
      </header>
      <ScreenIntro />
      {/* Where you are in the quotation, and a way to jump. The same four
          steps are the four sections below, in the order the work is done. */}
      <nav
        className="q-stepnav"
        aria-label={locale === "ar" ? "خطوات عرض السعر" : "Quotation steps"}
      >
        {[
          {
            id: "q-step-document",
            n: 1,
            en: "Document",
            ar: "المستند",
            done: header.documentTypeCode !== "",
          },
          {
            id: "q-step-items",
            n: 2,
            en: "Items",
            ar: "البنود",
            done: lines.some((line) => line.materialClass !== ""),
          },
          {
            id: "q-step-summary",
            n: 3,
            en: "Summary",
            ar: "الملخص",
            done: consolidatedLines.length > 0,
          },
          {
            id: "q-step-payment",
            n: 4,
            en: "Payment",
            ar: "الدفع",
            done:
              header.paymentTermsCode !== "" ||
              header.paymentScheduleCode === "ADVANCE_INSTALLMENTS",
          },
          { id: "q-step-send", n: 5, en: "Send", ar: "الإرسال", done: false },
        ].map((step) => (
          <button
            key={step.id}
            type="button"
            className={step.done ? "is-done" : ""}
            onClick={() => {
              goToStep(step.id);
            }}
          >
            <span className="q-stepnav-n" aria-hidden="true">
              {step.done ? "✓" : step.n}
            </span>
            {locale === "ar" ? step.ar : step.en}
          </button>
        ))}
        <Link
          className="q-stepnav-cargo"
          to={`/logistics/cargo-loader?quotationId=${quotationId}`}
        >
          {locale === "ar" ? "تخطيط التحميل ←" : "Cargo planning →"}
        </Link>
      </nav>
      {missingFields.length > 0 && (
        <div className="quotation-missing-warning" role="alert">
          {locale === "ar"
            ? `بيانات ناقصة قبل الإرسال للموافقة: ${missingFields.join("، ")}.`
            : `Missing before requesting approval: ${missingFields.join(", ")}.`}
        </div>
      )}
      {missingFields.length === 0 && optionalGaps.length > 0 && (
        <p className="quotation-optional-note">
          {locale === "ar"
            ? `اختياري ولسه فاضي: ${optionalGaps.join("، ")}.`
            : `Optional and still blank: ${optionalGaps.join(", ")}.`}
        </p>
      )}
      <section id="q-step-document" className="q-step">
        <header className="q-step-head">
          <span className="q-step-n">1</span>
          <div>
            <h2>{locale === "ar" ? "المستند" : "Document"}</h2>
            <p>
              {locale === "ar"
                ? "عرض سعر ولا فاتورة مبدئية — الصفحة بتسأل على حسب اختيارك."
                : "A quotation or a proforma invoice — the page asks for what the one you choose needs."}
            </p>
          </div>
        </header>
        {/* The first decision, so the first thing on the page. A proforma is
            the customs document: it adds the buyer's PO, the lead time and
            the freight, and the fields for those only appear when they are
            wanted. */}
        <div
          className="q-doctype"
          role="radiogroup"
          aria-label={locale === "ar" ? "نوع المستند" : "Document type"}
        >
          {DOCUMENT_TYPE_OPTIONS.map((option) => {
            const chosen = header.documentTypeCode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={chosen}
                className={chosen ? "is-chosen" : ""}
                disabled={!editable && !chosen}
                onClick={() => {
                  if (editable)
                    setHeaderDraft({
                      ...header,
                      documentTypeCode: option.value,
                    });
                }}
              >
                <strong>{locale === "ar" ? option.ar : option.en}</strong>
                <small>
                  {option.value === "PROFORMA_INVOICE"
                    ? locale === "ar"
                      ? "مستند الجمارك: المشتري، أمر الشراء، الأوزان، الشحن و CIF."
                      : "The customs document: buyer, PO, weights, freight and CIF."
                    : locale === "ar"
                      ? "عرض مسعّر يوافق عليه العميل."
                      : "A priced offer for the customer to accept."}
                </small>
              </button>
            );
          })}
        </div>
        <dl
          className="quotation-fact-grid"
          aria-label={locale === "ar" ? "ملخص عرض السعر" : "Quotation summary"}
        >
          <QuotationFact
            label={locale === "ar" ? "العميل" : "Customer"}
            value={
              detail.accountId ? (
                <Link to={`/customers/${str(detail.accountId)}`}>
                  {str(
                    account.canonicalName ??
                      detail.accountName ??
                      (locale === "ar" ? "سجل العميل" : "Customer record"),
                  )}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <QuotationFact
            label={locale === "ar" ? "المشروع" : "Project"}
            value={
              detail.projectId ? (
                <Link to={`/projects/${str(detail.projectId)}`}>
                  {str(
                    project.name ??
                      detail.projectName ??
                      (locale === "ar" ? "سجل المشروع" : "Project record"),
                  )}
                </Link>
              ) : locale === "ar" ? (
                "غير مرتبط"
              ) : (
                "Not linked"
              )
            }
          />
          <QuotationFact
            label={locale === "ar" ? "الفرصة" : "Opportunity"}
            value={
              detail.opportunityId ? (
                <Link to={`/opportunities/${str(detail.opportunityId)}`}>
                  {str(
                    opportunity.opportunityRef ??
                      detail.opportunityRef ??
                      (locale === "ar" ? "سجل الفرصة" : "Opportunity record"),
                  )}
                </Link>
              ) : (
                "—"
              )
            }
          />
          <QuotationFact
            label={locale === "ar" ? "المالك" : "Owner"}
            value={str(
              detail.ownerDisplayName ??
                (detail.ownerUserId === me.user.userId
                  ? me.user.displayName
                  : locale === "ar"
                    ? "مستخدم معيّن"
                    : "Assigned user"),
            )}
          />
          <QuotationFact
            label={locale === "ar" ? "الإجمالي" : "Total"}
            value={formatMoney(
              Number(detail.grandTotalAmount ?? 0),
              str(detail.currencyCode),
            )}
            strong
          />
          <QuotationFact
            label={locale === "ar" ? "الصلاحية" : "Validity"}
            value={formatValidity(detail.validFrom, detail.expiresOn, locale)}
          />
          <QuotationFact
            label={locale === "ar" ? "دورة العرض" : "Lifecycle"}
            value={
              <span style={{ display: "inline-flex", gap: 6 }}>
                <StatusChip code={str(detail.statusCode)} />
                {detail.commercialState !== "NOT_SUBMITTED" && (
                  <StatusChip code={str(detail.commercialState)} />
                )}
              </span>
            }
          />
          <QuotationFact
            label={locale === "ar" ? "الموافقة" : "Approval"}
            value={
              approvals.isLoading ? (
                locale === "ar" ? (
                  "جار التحقق…"
                ) : (
                  "Checking…"
                )
              ) : latestApproval ? (
                <StatusChip code={str(latestApproval.statusCode)} />
              ) : locale === "ar" ? (
                "لا يوجد طلب"
              ) : (
                "Not requested"
              )
            }
          />
          <QuotationFact
            label={locale === "ar" ? "موضوع العرض" : "Subject"}
            info={
              locale === "ar"
                ? "الموضوع اللي يُطبع تحت ترويسة المستند. الاختيار من ليستة الشركة، ولو محتاج موضوع جديد اضغط + وهيتضاف لكل العروض بعد كده."
                : "Printed under the document header. Chosen from the company's list; the plus adds a new one, and it is then offered on every quotation after this."
            }
            value={
              <SubjectPicker
                value={header.subject || (editable ? defaultSubject : "")}
                options={subjectOptions}
                editable={editable}
                labels={{
                  field: locale === "ar" ? "موضوع العرض" : "Subject",
                  notSet: locale === "ar" ? "غير محدد" : "Not set",
                  add: locale === "ar" ? "إضافة موضوع" : "Add a subject",
                  addTitle:
                    locale === "ar" ? "إضافة موضوع جديد" : "Add a subject",
                  addHint:
                    locale === "ar"
                      ? "هيتضاف لليستة الشركة، ويظهر لكل حد في كل العروض بعد كده."
                      : "It joins the company's list and is offered to everyone on every quotation from now on.",
                  subject: locale === "ar" ? "الموضوع" : "Subject",
                  save: locale === "ar" ? "إضافة" : "Add",
                  cancel: locale === "ar" ? "إلغاء" : "Cancel",
                  saving: locale === "ar" ? "بيضيف…" : "Adding…",
                  failed:
                    locale === "ar"
                      ? "الموضوع ماتضافش. جرّب تاني."
                      : "The subject could not be added. Try again.",
                }}
                onChange={(value) => {
                  setHeaderDraft({ ...header, subject: value });
                }}
                onAdd={async (text) => {
                  await addSubject.mutateAsync(text);
                  return text;
                }}
              />
            }
          />
          <QuotationFact
            label={locale === "ar" ? "شرط التسليم (إنكوترمز)" : "Incoterm"}
            info={
              locale === "ar"
                ? "يحدد مكان التسليم ومن يتحمل تكلفة الشحن: DDP = تسليم لموقع المشروع، CIF = تسليم لميناء الوجهة، FOB = تسليم من مخزن أكرو."
                : "Determines the delivery location and who bears shipping cost: DDP = delivered to project site, CIF = delivered to destination port, FOB = collected from ABP's storeyard."
            }
            value={
              editable ? (
                <select
                  aria-label={locale === "ar" ? "شرط التسليم" : "Incoterm"}
                  value={header.incotermCode}
                  onChange={(event) => {
                    setHeaderDraft({
                      ...header,
                      incotermCode: event.target.value,
                    });
                  }}
                >
                  {INCOTERM_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {locale === "ar" ? option.ar : option.en}
                    </option>
                  ))}
                </select>
              ) : (
                (INCOTERM_OPTIONS.find(
                  (option) => option.value === header.incotermCode,
                )?.[locale === "ar" ? "ar" : "en"] ?? "—")
              )
            }
          />
          {header.incotermCode !== "" && (
            <QuotationFact
              label={shippingLabel(header.incotermCode, locale)}
              info={shippingHint(header.incotermCode, locale)}
              value={
                editable ? (
                  <>
                    {/* A suggestion list, not a closed dropdown: the common
                      ports are one keystroke away and anything else — an
                      inland terminal, a port we have never shipped to, the
                      customer's own wording — can still be typed. */}
                    <input
                      aria-label={shippingLabel(header.incotermCode, locale)}
                      list={
                        portSuggestions.length > 0 ? "abp-port-list" : undefined
                      }
                      value={shippingValue(header)}
                      placeholder={shippingPlaceholder(
                        header.incotermCode,
                        locale,
                      )}
                      onChange={(event) => {
                        setHeaderDraft({
                          ...header,
                          ...shippingPatch(
                            header.incotermCode,
                            event.target.value,
                          ),
                        });
                      }}
                    />
                    {portSuggestions.length > 0 && (
                      <datalist id="abp-port-list">
                        {portSuggestions.map((port) => (
                          <option key={port.code} value={port.name}>
                            {portLabel(port)}
                          </option>
                        ))}
                      </datalist>
                    )}
                  </>
                ) : (
                  shippingValue(header) || "—"
                )
              }
            />
          )}
          {isProforma && (
            <>
              {/* The three the shipment carries and the customer does not: this
            order's purchase-order number, how soon it ships, and the freight.
            All three are printed on a proforma invoice and all three came out
            blank until now. */}
              <QuotationFact
                label={locale === "ar" ? "رقم أمر الشراء" : "Customer PO no."}
                info={
                  locale === "ar"
                    ? "رقم أمر الشراء بتاع العميل نفسه. حساباتهم بيطابقوا الفاتورة عليه، فبدونه الفاتورة بتستنى."
                    : "The customer's own purchase-order number. Their accounts department matches the invoice against it, so an invoice without it waits."
                }
                value={
                  editable ? (
                    <input
                      aria-label={
                        locale === "ar" ? "رقم أمر الشراء" : "Customer PO no."
                      }
                      dir="ltr"
                      value={header.customerPoNumber}
                      maxLength={100}
                      onChange={(event) => {
                        setHeaderDraft({
                          ...header,
                          customerPoNumber: event.target.value,
                        });
                      }}
                    />
                  ) : (
                    header.customerPoNumber || "—"
                  )
                }
              />
              <QuotationFact
                label={locale === "ar" ? "مدة التوريد" : "Lead time"}
                info={
                  locale === "ar"
                    ? "المدة بين أمر الشراء والشحن، بنفس الصيغة اللي تُطبع على المستند — مثلاً «4 أسابيع من تاريخ الدفعة المقدمة»."
                    : 'The time between the order and the shipment, in the wording the document prints — e.g. "4 weeks from the advance payment".'
                }
                value={
                  editable ? (
                    <input
                      aria-label={locale === "ar" ? "مدة التوريد" : "Lead time"}
                      value={header.leadTime}
                      maxLength={200}
                      placeholder={
                        locale === "ar"
                          ? "٤ أسابيع من تاريخ الدفعة المقدمة"
                          : "4 weeks from the advance payment"
                      }
                      onChange={(event) => {
                        setHeaderDraft({
                          ...header,
                          leadTime: event.target.value,
                        });
                      }}
                    />
                  ) : (
                    header.leadTime || "—"
                  )
                }
              />
              <QuotationFact
                label={
                  locale === "ar" ? "الشحن والتأمين" : "Freight & insurance"
                }
                info={
                  locale === "ar"
                    ? "تكلفة الشحن والتأمين بعملة العرض. قيمة التسليم من المخزن زائد الرقم ده = إجمالي CIF اللي تُطبع على الفاتورة الأولية."
                    : "Freight and insurance in the quotation currency. The ex-works total plus this is the CIF total a proforma invoice states."
                }
                value={
                  editable ? (
                    <input
                      aria-label={
                        locale === "ar"
                          ? "الشحن والتأمين"
                          : "Freight & insurance"
                      }
                      dir="ltr"
                      inputMode="decimal"
                      value={header.freightAmount}
                      onChange={(event) => {
                        setHeaderDraft({
                          ...header,
                          freightAmount: event.target.value,
                        });
                      }}
                    />
                  ) : header.freightAmount === "" ? (
                    "—"
                  ) : (
                    formatMoney(toNum(header.freightAmount, 0), exportCurrency)
                  )
                }
              />
            </>
          )}
          <QuotationFact
            label={locale === "ar" ? "جهة الاتصال" : "Contact person"}
            info={
              locale === "ar"
                ? "الشخص عند العميل اللي تم التفاوض معه على العرض ده."
                : "The person at the customer this quotation was negotiated with."
            }
            value={
              editable ? (
                <select
                  aria-label={
                    locale === "ar" ? "جهة الاتصال" : "Contact person"
                  }
                  value={header.contactId}
                  onChange={(event) => {
                    setHeaderDraft({
                      ...header,
                      contactId: event.target.value,
                    });
                  }}
                >
                  <option value="">
                    {locale === "ar" ? "غير محدد" : "Not set"}
                  </option>
                  {accountContacts.data?.data.map((c) => (
                    <option key={c.contactId} value={c.contactId}>
                      {c.displayName}
                    </option>
                  ))}
                </select>
              ) : (
                (accountContacts.data?.data.find(
                  (c) => c.contactId === header.contactId,
                )?.displayName ?? "—")
              )
            }
          />
        </dl>
        {isProforma && (
          <p
            className={`q-buyer-note ${
              blankIfDash(str(account.address)) === "" ||
              blankIfDash(str(account.taxNumber)) === ""
                ? "is-missing"
                : ""
            }`}
          >
            <strong>
              {locale === "ar"
                ? "المشتري على الفاتورة:"
                : "Buyer on the proforma:"}
            </strong>{" "}
            <bdi dir="auto">
              {blankIfDash(str(account.address)) ||
                (locale === "ar" ? "العنوان ناقص" : "address missing")}
            </bdi>
            {" · "}
            {locale === "ar" ? "الرقم الضريبي" : "Tax no."}{" "}
            {blankIfDash(str(account.taxNumber)) ||
              (locale === "ar" ? "ناقص" : "missing")}
            {(blankIfDash(str(account.address)) === "" ||
              blankIfDash(str(account.taxNumber)) === "") &&
              Boolean(detail.accountId) && (
                <>
                  {" — "}
                  <Link to={`/customers/${str(detail.accountId)}`}>
                    {locale === "ar"
                      ? "كمّلهم من صفحة العميل"
                      : "complete them on the customer"}
                  </Link>
                </>
              )}
          </p>
        )}
      </section>
      <section id="q-step-items" className="q-step">
        <header className="q-step-head">
          <span className="q-step-n">2</span>
          <div>
            <h2>{locale === "ar" ? "البنود" : "Items"}</h2>
            <p>
              {locale === "ar"
                ? "اختار النوع واكتب المقاسات في نفس السطر — الوزن والسعر بيتحسبوا وانت بتكتب."
                : "Choose the type and type the sizes in the row — the weight and the price work themselves out as you go."}
            </p>
          </div>
        </header>
        {/* The company's rates, and this quotation's overrides of them. Folded
            away unless something in it is set, so it never hides a change. */}
        {/* What every line below is priced on, in sight and editable for
            this quotation. The standard rate is shown as the board it prices,
            because that is how the company sets it. */}
        <div
          className="q-ratebar"
          role="group"
          aria-label={locale === "ar" ? "أسعار التسعير" : "Pricing rates"}
        >
          <RateBox
            id="q-rate-standard"
            label={locale === "ar" ? "ستاندرد / لينير" : "Standard / linear"}
            unit={locale === "ar" ? "ج.م/كجم" : "EGP/kg"}
            value={header.standardPricePerKgOverride}
            placeholder={rateText(companyRates.STANDARD)}
            editable={editable}
            locale={locale}
            onChange={(value) => {
              setHeaderDraft({ ...header, standardPricePerKgOverride: value });
            }}
            detail={
              <>
                {locale === "ar" ? "لوح " : "Board "}
                {sheetNumber(companyDefaultThickness, locale)} ×{" "}
                {sheetNumber(referenceBoardWidthMm, locale)} ×{" "}
                {sheetNumber(referenceBoardLengthMm, locale)}:{" "}
                {sheetNumber(appliedReferenceWeightKg, locale, 3)}{" "}
                {locale === "ar" ? "كجم" : "kg"} ×{" "}
                {rateText(appliedStandardRate)} ={" "}
                <strong>{formatMoney(appliedBoardPrice)}</strong>{" "}
                {locale === "ar" ? "ج.م" : "EGP"}
              </>
            }
          />
          <RateBox
            id="q-rate-curved"
            label={locale === "ar" ? "كيرفد" : "Curved"}
            unit={locale === "ar" ? "ج.م/كجم" : "EGP/kg"}
            value={header.curvedPricePerKgOverride}
            placeholder={rateText(companyRates.CURVED)}
            editable={editable}
            locale={locale}
            onChange={(value) => {
              setHeaderDraft({ ...header, curvedPricePerKgOverride: value });
            }}
          />
          <RateBox
            id="q-rate-circular"
            label={locale === "ar" ? "دائري" : "Circular"}
            unit={locale === "ar" ? "ج.م/كجم" : "EGP/kg"}
            value={header.circularPricePerKgOverride}
            placeholder={rateText(
              toNum(header.curvedPricePerKgOverride, companyRates.CIRCULAR),
            )}
            editable={editable}
            locale={locale}
            onChange={(value) => {
              setHeaderDraft({ ...header, circularPricePerKgOverride: value });
            }}
          />
          <RateBox
            id="q-rate-density"
            label={locale === "ar" ? "الكثافة" : "Density"}
            unit={locale === "ar" ? "كجم/م³" : "kg/m³"}
            value={header.densityOverrideKgM3}
            placeholder={rateText(companyDefaultDensity)}
            editable={editable}
            locale={locale}
            onChange={(value) => {
              setHeaderDraft({ ...header, densityOverrideKgM3: value });
            }}
          />
          <div className="q-rate q-rate-vat">
            <span className="q-rate-label">
              {locale === "ar" ? "ض.ق.م" : "VAT"}
            </span>
            <strong>{sheetPercent(inferredVatRate, locale)}</strong>
            <small className="q-rate-source">
              {locale === "ar" ? "بعد الخصومات" : "After adjustments"}
            </small>
          </div>
        </div>
        <details className="q-rates" open={pricingBlockOpen}>
          <summary>
            {locale === "ar"
              ? "تفاصيل التسعير: سعر اللوح، الخصم"
              : "Pricing detail: price per board, discount"}
            {pricingBlockOpen && (
              <em>{locale === "ar" ? "فيه تعديل" : "overridden"}</em>
            )}
          </summary>
          <section className="pricing-overrides-section">
            <h3 className="pricing-overrides-title">
              {locale === "ar"
                ? "أساس التسعير (ذي شيت ACROW BOARD)"
                : "Pricing basis (as the ACROW BOARD sheet)"}
            </h3>
            <p className="pricing-overrides-hint">
              {locale === "ar"
                ? "كل سطر: إعداد الشركة، التجاوز الخاص بعرض السعر ده، والقيمة المطبّقة فعلاً. سيب التجاوز فاضي علشان تمشي ع إعداد الشركة — وأي بند بسعره الخاص بيتجاوز السطر ده."
                : "Every row reads setting, this quotation's override, and the value actually applied. Leave an override blank to stay on the company setting — and any item with its own price overrides the row."}
            </p>
            <QuotationBasisPanel
              locale={locale}
              editable={editable}
              blocks={[
                {
                  key: "commercial",
                  title: {
                    en: "Commercial controls",
                    ar: "الضوابط التجارية",
                  },
                  rows: [
                    {
                      key: "vat",
                      label: { en: "VAT %", ar: "ض.ق.م %" },
                      setting: sheetPercent(WORKBOOK.vatRate * 100, locale),
                      override: null,
                      applied: sheetPercent(inferredVatRate, locale),
                      tone: "auto",
                    },
                    {
                      key: "discount",
                      label: { en: "Discount %", ar: "الخصم %" },
                      setting: sheetPercent(companyDefaultDiscountPct, locale),
                      override: null,
                      applied: sheetPercent(appliedDiscountPct, locale),
                      tone: appliedDiscountPct > 0 ? "special" : "auto",
                    },
                    {
                      key: "column-height",
                      label: {
                        en: "Column height (mm)",
                        ar: "ارتفاع العمود (مم)",
                      },
                      setting: sheetNumber(
                        takeoffDefaults.columnHeightMm,
                        locale,
                        0,
                      ),
                      override: null,
                      applied: sheetNumber(
                        takeoffDefaults.columnHeightMm,
                        locale,
                        0,
                      ),
                      tone: "auto",
                    },
                    {
                      key: "density",
                      label: { en: "Density (kg/m³)", ar: "الكثافة (كجم/م³)" },
                      setting: sheetNumber(companyDefaultDensity, locale),
                      override: {
                        value: header.densityOverrideKgM3,
                        onChange: (value) => {
                          setHeaderDraft({
                            ...header,
                            densityOverrideKgM3: value,
                          });
                        },
                      },
                      applied: sheetNumber(appliedDensity, locale),
                    },
                  ],
                  footer:
                    companyDefaultDiscountPct > 0 ? (
                      <button
                        type="button"
                        className="pricing-overrides-discount-btn"
                        disabled={!editable}
                        onClick={() => {
                          setAdjustmentDraft([
                            ...adjustments,
                            {
                              typeCode: "SPECIAL_DISCOUNT",
                              modeCode: "PERCENT",
                              value: String(-companyDefaultDiscountPct),
                              label:
                                locale === "ar"
                                  ? "خصم الشركة الافتراضي"
                                  : "Company default discount",
                            },
                          ]);
                        }}
                      >
                        {locale === "ar"
                          ? `تطبيق خصم الشركة الافتراضي (${companyDefaultDiscountPct.toString()}%)`
                          : `Apply company default discount (${companyDefaultDiscountPct.toString()}%)`}
                      </button>
                    ) : undefined,
                },
                {
                  key: "material",
                  title: { en: "Material basis", ar: "أساس الخامة" },
                  rows: [
                    {
                      key: "thickness",
                      label: { en: "Thickness (mm)", ar: "السُمك (مم)" },
                      setting: sheetNumber(companyDefaultThickness, locale, 0),
                      override: null,
                      applied: sheetNumber(companyDefaultThickness, locale, 0),
                      tone: "auto",
                    },
                    {
                      key: "ref-width",
                      label: {
                        en: "Reference width (mm)",
                        ar: "العرض المرجعي (مم)",
                      },
                      setting: sheetNumber(referenceBoardWidthMm, locale, 0),
                      override: null,
                      applied: sheetNumber(referenceBoardWidthMm, locale, 0),
                      tone: "auto",
                    },
                    {
                      key: "ref-length",
                      label: {
                        en: "Reference length (mm)",
                        ar: "الطول المرجعي (مم)",
                      },
                      setting: sheetNumber(referenceBoardLengthMm, locale, 0),
                      override: null,
                      applied: sheetNumber(referenceBoardLengthMm, locale, 0),
                      tone: "auto",
                    },
                    {
                      key: "ref-weight",
                      label: {
                        en: "Reference board weight (kg)",
                        ar: "وزن اللوح المرجعي (كجم)",
                      },
                      // Derived, never typed — width × length × thickness ×
                      // density, the sheet's own AUTO cell.
                      setting: sheetNumber(
                        referenceBoardWeightKg(
                          referenceBoardWidthMm,
                          referenceBoardLengthMm,
                          companyDefaultThickness,
                          companyDefaultDensity,
                        ),
                        locale,
                        3,
                      ),
                      override: null,
                      applied: sheetNumber(appliedReferenceWeightKg, locale, 3),
                      tone: "auto",
                    },
                  ],
                },
                {
                  key: "engine",
                  title: { en: "Pricing engine", ar: "محرك التسعير" },
                  rows: [
                    {
                      key: "standard-rate",
                      label: {
                        en: "Standard / Regular (EGP/kg)",
                        ar: "Standard / Regular (ج.م/كجم)",
                      },
                      setting: sheetNumber(companyRates.STANDARD, locale),
                      override: {
                        value: header.standardPricePerKgOverride,
                        onChange: (value) => {
                          setHeaderDraft({
                            ...header,
                            standardPricePerKgOverride: value,
                          });
                        },
                      },
                      applied: sheetNumber(appliedStandardRate, locale),
                      // The board price and the rate per kg are one another's
                      // reciprocal, and the sheet lets a person enter either.
                      wideControl: (
                        <ReciprocalPriceInputs
                          locale={locale}
                          editable={editable}
                          pricePerKg={header.standardPricePerKgOverride}
                          onChangePricePerKg={(value) => {
                            setHeaderDraft({
                              ...header,
                              standardPricePerKgOverride: value,
                            });
                          }}
                          referenceBoard={{
                            referenceBoardWidthMm,
                            referenceBoardLengthMm,
                            thicknessMm: companyDefaultThickness,
                            densityKgM3: appliedDensity,
                          }}
                          idPrefix="header-standard"
                        />
                      ),
                    },
                    {
                      key: "curved-rate",
                      label: {
                        en: "Curved (EGP/kg)",
                        ar: "Curved (ج.م/كجم)",
                      },
                      setting: sheetNumber(companyRates.CURVED, locale),
                      override: {
                        value: header.curvedPricePerKgOverride,
                        onChange: (value) => {
                          setHeaderDraft({
                            ...header,
                            curvedPricePerKgOverride: value,
                          });
                        },
                      },
                      applied: sheetNumber(appliedCurvedRate, locale),
                    },
                    {
                      key: "circular-rate",
                      label: {
                        en: "Circular (EGP/kg)",
                        ar: "Circular (ج.م/كجم)",
                      },
                      setting: sheetNumber(companyRates.CIRCULAR, locale),
                      override: {
                        value: header.circularPricePerKgOverride,
                        onChange: (value) => {
                          setHeaderDraft({
                            ...header,
                            circularPricePerKgOverride: value,
                          });
                        },
                      },
                      applied: sheetNumber(appliedCircularRate, locale),
                    },
                  ],
                },
              ]}
              activeBasis={
                locale === "ar"
                  ? `Standard ${sheetNumber(appliedStandardRate, locale)} ج.م/كجم · Curved ${sheetNumber(appliedCurvedRate, locale)} · Circular ${sheetNumber(appliedCircularRate, locale)} · كثافة ${sheetNumber(appliedDensity, locale)} كجم/م³ · ض.ق.م ${sheetPercent(inferredVatRate, locale)}`
                  : `Standard ${sheetNumber(appliedStandardRate, locale)} EGP/kg · Curved ${sheetNumber(appliedCurvedRate, locale)} · Circular ${sheetNumber(appliedCircularRate, locale)} · density ${sheetNumber(appliedDensity, locale)} kg/m³ · VAT ${sheetPercent(inferredVatRate, locale)}`
              }
              equation={
                locale === "ar"
                  ? `${sheetNumber(appliedStandardRate, locale)} ج.م/كجم × ${sheetNumber(appliedReferenceWeightKg, locale, 3)} كجم = ${sheetNumber(appliedBoardPrice, locale)} ج.م للوح المرجعي`
                  : `${sheetNumber(appliedStandardRate, locale)} EGP/kg × ${sheetNumber(appliedReferenceWeightKg, locale, 3)} kg = ${sheetNumber(appliedBoardPrice, locale)} EGP per reference board`
              }
            />
          </section>
        </details>
        <datalist id="board-type-suggestions">
          {BOARD_TYPE_SUGGESTIONS.map((label) => (
            <option key={label} value={label} />
          ))}
        </datalist>
        <div className="enterprise-table-scroll quotation-engineering-scroll">
          <table className="data-table quotation-engineering-table">
            <thead>
              <tr>
                {[
                  "#",
                  locale === "ar" ? "النوع" : "Type",
                  locale === "ar" ? "الكود" : "Code",
                  locale === "ar" ? "المقاسات (مم)" : "Sizes (mm)",
                  locale === "ar" ? "الكثافة" : "Density",
                  locale === "ar" ? "الكمية" : "Quantity",
                  locale === "ar" ? "ج.م / كجم" : "EGP / kg",
                  locale === "ar" ? "كجم / قطعة" : "kg / pc",
                  locale === "ar" ? "سعر الوحدة" : "Unit price",
                  locale === "ar" ? "الإجمالي" : "Total",
                  locale === "ar" ? "إجراءات" : "Actions",
                ].map((label, index) => (
                  <th key={index}>{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line, index) => {
                const updateLine = (patch: Partial<Line>) => {
                  setDraft(
                    lines.map((value, position) =>
                      position === index ? { ...value, ...patch } : value,
                    ),
                  );
                };
                // Merges patch, then regenerates description from the
                // resulting dimensions/label as long as the user hasn't
                // typed a custom description (descriptionAuto stays true).
                const updateEngineeringField = (patch: Partial<Line>) => {
                  const next = {
                    ...line,
                    ...patch,
                    unitPrice: null as string | null,
                  };
                  if (next.descriptionAuto) {
                    // The canonical ACROW name, the same one the server
                    // will regenerate on save.
                    next.description = buildLineDescription(next);
                  }
                  updateLine(next);
                };
                const materialPreview = computeMaterialClassPreview(
                  line,
                  header,
                  companyRates,
                  companyDefaultDensity,
                  companyDefaultThickness,
                  calculationFormulas,
                  takeoffDefaults,
                );
                const legacyPreviewPrice =
                  !line.materialClass &&
                  line.pricingMethodCode &&
                  line.lengthMm &&
                  line.widthMm
                    ? previewEngineeringUnitPrice(
                        line.pricingMethodCode,
                        {
                          lengthMm: Number(line.lengthMm),
                          widthMm: Number(line.widthMm),
                          thicknessMm: Number(line.thicknessMm || 0),
                          densityKgM3: Number(line.densityKgM3 || 0),
                          pricePerKg: Number(line.pricePerKg || 0),
                        },
                        3300,
                      )
                    : null;
                const previewPrice = materialPreview
                  ? materialPreview.unitPrice
                  : legacyPreviewPrice;
                const effectiveUnitPrice =
                  line.unitPrice != null && line.unitPrice !== ""
                    ? Number(line.unitPrice)
                    : (previewPrice ?? 0);
                const lineTotal = previewLineTotal(
                  line,
                  materialPreview,
                  legacyPreviewPrice,
                );
                const status = lineStatus(
                  line,
                  materialPreview,
                  header,
                  companyRates,
                  companyDefaultDensity,
                  companyDefaultThickness,
                );
                return (
                  <Fragment key={line.quotationLineId ?? index}>
                    <tr className="eng-base-row">
                      <td>
                        <span className="quotation-row-number">
                          <span aria-hidden="true">⠿</span> #{index + 1}
                          <LineStatusChip
                            compact
                            locale={locale}
                            status={status}
                          />
                        </span>
                      </td>
                      <td className="q-item-cell">
                        <select
                          aria-label={`product ${String(index + 1)}`}
                          disabled={!editable}
                          value={line.materialClass}
                          onChange={(event) => {
                            const materialClass = event.target.value as
                              MaterialClass | "";
                            const boardTypeLabel = materialClass
                              ? DEFAULT_BOARD_TYPE_LABEL_BY_CLASS[materialClass]
                              : "";
                            const flat =
                              materialClass === "STANDARD" ||
                              materialClass === "CURVED";
                            const dimensions = flat
                              ? DEFAULT_BOARD_DIMENSIONS_MM
                              : {
                                  lengthMm: "",
                                  widthMm: "",
                                  thicknessMm: materialClass
                                    ? line.thicknessMm ||
                                      DEFAULT_BOARD_DIMENSIONS_MM.thicknessMm
                                    : "",
                                };
                            const nextLine: Line = {
                              ...line,
                              materialClass,
                              pricingMethodCode: "",
                              unitPrice: materialClass ? null : "0",
                              boardTypeLabel,
                              ...dimensions,
                              descriptionAuto: Boolean(materialClass),
                            };
                            updateLine({
                              ...withoutProductId(nextLine),
                              codeAuto: flat,
                              description: materialClass
                                ? buildLineDescription(nextLine)
                                : line.description,
                            });
                          }}
                        >
                          <option value="">
                            {locale === "ar" ? "اختر…" : "Select…"}
                          </option>
                          {MATERIAL_CLASS_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {locale === "ar" ? option.ar : option.en}
                            </option>
                          ))}
                        </select>
                      </td>
                      {/* One line per row. The code for a board, the
                              description for a curved or circular line --
                              the only ones where it says something the
                              type and sizes do not -- and a pointer to the
                              summary for a column's panels. */}
                      <td className="q-code-cell">
                        <div className="q-item-name">
                          {(() => {
                            const size = flatSizeOf(line);
                            // Curved and circular show their description
                            // below instead, on the same line.
                            if (
                              size !== null &&
                              line.materialClass === "STANDARD"
                            ) {
                              const options = codeOptions(size, catalogue);
                              const chosen = options.find(
                                (option) =>
                                  option.product.productId === line.productId,
                              );
                              const others =
                                options.length - (chosen === undefined ? 0 : 1);
                              return (
                                <button
                                  type="button"
                                  className={`q-code-chip ${
                                    chosen === undefined ? "is-open" : ""
                                  }`}
                                  title={
                                    locale === "ar"
                                      ? "كل الأكواد بالمقاس ده"
                                      : "Every code at this size"
                                  }
                                  onClick={() => {
                                    setCodePickerLine({
                                      description: line.description,
                                      ...size,
                                    });
                                  }}
                                >
                                  <code>
                                    {chosen?.code ??
                                      (catalogueQuery.loading
                                        ? "…"
                                        : options.length === 0
                                          ? locale === "ar"
                                            ? "مفيش كود بالمقاس ده"
                                            : "No code at this size"
                                          : locale === "ar"
                                            ? "اختار كود"
                                            : "Choose a code")}
                                  </code>
                                  {others > 0 && <em>+{others}</em>}
                                </button>
                              );
                            }
                            if (
                              line.materialClass === "" ||
                              line.materialClass === "CURVED" ||
                              line.materialClass === "CIRCULAR"
                            )
                              return null;
                            // A column is several panels, each its own
                            // code; those are chosen on the summary.
                            return (
                              <button
                                type="button"
                                className="q-code-chip is-panels"
                                onClick={() => {
                                  goToStep("q-step-summary");
                                }}
                              >
                                {locale === "ar"
                                  ? "أكواد الألواح في الملخص ↓"
                                  : "Panel codes in the summary ↓"}
                              </button>
                            );
                          })()}
                          {/* Only where it says something the sizes do
                                  not: the diameter, the pieces per column. */}
                          {(line.materialClass === "CURVED" ||
                            line.materialClass === "CIRCULAR") && (
                            <button
                              type="button"
                              className="eng-description-btn q-desc-inline"
                              title={line.description}
                              onClick={() => {
                                setOpenLineIndex(index);
                              }}
                            >
                              <span className="eng-description-text">
                                {line.description}
                              </span>
                              {line.materialClass === "CIRCULAR" &&
                                materialPreview?.circular && (
                                  <span className="eng-description-sub">
                                    {locale === "ar"
                                      ? `${String(materialPreview.circular.totalPieces)} قطعة`
                                      : `${String(materialPreview.circular.totalPieces)} pieces`}
                                  </span>
                                )}
                            </button>
                          )}
                        </div>
                      </td>
                      <td className="line-dims-cell">
                        <LineDimensions
                          line={line}
                          index={index}
                          editable={editable}
                          locale={locale === "ar" ? "ar" : "en"}
                          placeholders={{
                            columnHeightMm: String(
                              takeoffDefaults.columnHeightMm,
                            ),
                          }}
                          onChange={(field, value) => {
                            updateEngineeringField({
                              [field]: value,
                              codeAuto: true,
                            });
                          }}
                          onFaces={() => {
                            setOpenLineIndex(index);
                          }}
                        />
                      </td>
                      {/* This line's density, the quotation's or the
                              company's standing in as the placeholder. */}
                      <td className="q-num-input-cell">
                        {line.materialClass === "" ? (
                          "—"
                        ) : (
                          <input
                            aria-label={`density ${String(index + 1)}`}
                            inputMode="decimal"
                            dir="ltr"
                            readOnly={!editable}
                            value={line.densityKgM3}
                            placeholder={rateText(appliedDensity)}
                            onChange={(event) => {
                              updateEngineeringField({
                                densityKgM3: event.target.value,
                              });
                            }}
                          />
                        )}
                      </td>
                      <td>
                        <input
                          aria-label={`qty ${String(index + 1)}`}
                          readOnly={!editable}
                          value={line.qty}
                          type="number"
                          min="0"
                          step="any"
                          onChange={(event) => {
                            updateLine({ qty: event.target.value });
                          }}
                        />
                      </td>
                      {/* The rate this line is priced at: its own when
                              typed, otherwise its type's rate from the bar
                              above. */}
                      <td className="q-num-input-cell">
                        {line.materialClass === "" ? (
                          "—"
                        ) : (
                          <input
                            aria-label={`rate ${String(index + 1)}`}
                            inputMode="decimal"
                            dir="ltr"
                            readOnly={!editable}
                            value={line.pricePerKg}
                            placeholder={rateText(
                              resolveLineRate(
                                { ...line, pricePerKg: "" },
                                header,
                                companyRates,
                              ),
                            )}
                            onChange={(event) => {
                              updateEngineeringField({
                                pricePerKg: event.target.value,
                              });
                            }}
                          />
                        )}
                      </td>
                      <td className="eng-computed-cell">
                        {materialPreview
                          ? formatWeight(materialPreview.weightKg)
                          : "—"}
                      </td>
                      <td className="eng-computed-cell">
                        {formatMoney(effectiveUnitPrice)}
                      </td>
                      <td className="eng-computed-cell eng-computed-strong">
                        {formatMoney(lineTotal)}
                      </td>
                      <td className="eng-actions-cell">
                        <button
                          type="button"
                          className="eng-edit-btn"
                          aria-label={
                            locale === "ar"
                              ? "تفاصيل الحساب الهندسي"
                              : "Engineering details"
                          }
                          title={
                            locale === "ar"
                              ? "تفاصيل الحساب الهندسي"
                              : "Engineering details"
                          }
                          onClick={() => {
                            setOpenLineIndex(index);
                          }}
                        >
                          ⚙
                        </button>
                        {editable && (
                          <>
                            <button
                              type="button"
                              className="eng-copy-btn"
                              aria-label={
                                locale === "ar" ? "نسخ البند" : "Copy line"
                              }
                              title={
                                locale === "ar" ? "نسخ البند" : "Copy line"
                              }
                              onClick={() => {
                                setDraft([
                                  ...lines.slice(0, index + 1),
                                  { ...line },
                                  ...lines.slice(index + 1),
                                ]);
                              }}
                            >
                              ⧉
                            </button>
                            <button
                              type="button"
                              className="eng-delete-btn"
                              aria-label={
                                locale === "ar" ? "حذف البند" : "Delete line"
                              }
                              title={
                                locale === "ar" ? "حذف البند" : "Delete line"
                              }
                              onClick={() => {
                                setDraft(
                                  lines.filter(
                                    (_, position) => position !== index,
                                  ),
                                );
                              }}
                            >
                              ×
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        {openLineIndex !== null && lines[openLineIndex] && (
          <QuotationLinePanel
            locale={locale}
            editable={editable}
            index={openLineIndex}
            line={lines[openLineIndex]}
            onClose={() => {
              setOpenLineIndex(null);
            }}
            onChange={(next) => {
              setDraft(
                lines.map((value, position) =>
                  position === openLineIndex ? next : value,
                ),
              );
            }}
            header={header}
            companyRates={companyRates}
            companyDefaultDensity={companyDefaultDensity}
            companyDefaultThickness={companyDefaultThickness}
            referenceBoardWidthMm={referenceBoardWidthMm}
            referenceBoardLengthMm={referenceBoardLengthMm}
            calculationFormulas={calculationFormulas}
            takeoffDefaults={takeoffDefaults}
          />
        )}
        {editable && (
          <button
            type="button"
            className="secondary q-add-line"
            onClick={() => {
              setDraft([...lines, createEmptyLine()]);
            }}
          >
            {locale === "ar" ? "+ إضافة بند" : "+ Add line item"}
          </button>
        )}
      </section>
      <section id="q-step-summary" className="q-step">
        <header className="q-step-head">
          <span className="q-step-n">3</span>
          <div>
            <h2>{locale === "ar" ? "الملخص" : "Summary"}</h2>
            <p>
              {locale === "ar"
                ? "اللي العميل هيقراه: بند لكل صنف بأكواده وأوزانه، والإجمالي."
                : "What the customer reads: one line per product with its code and weights, and the total."}
            </p>
          </div>
        </header>
        <div className="quotation-summary-panel">
          {/* What the customer reads: one line per distinct product, with
                the scopes behind it kept for engineering. The items tab above
                is the engineering view and stays as it is. */}
          {consolidatedLines.length > 0 && (
            <section className="wizard-lines-summary">
              <div className="wizard-lines-summary-head">
                <h3>
                  {locale === "ar" ? "بنود عرض السعر" : "Quotation lines"}
                </h3>
                <span>
                  {locale === "ar"
                    ? `${String(consolidatedLines.length)} بند من ${String(generatedPieces.length)} قطعة`
                    : `${String(consolidatedLines.length)} product ${consolidatedLines.length === 1 ? "line" : "lines"} from ${String(generatedPieces.length)} generated pieces`}
                </span>
              </div>
              {!consolidationSafe && (
                <p className="wizard-consolidation-warning" role="alert">
                  {locale === "ar"
                    ? "البنود المجمّعة مش بتساوي القطع المولّدة. راجع قبل الإرسال."
                    : "The consolidated lines do not add up to the generated pieces. Review before sending."}
                </p>
              )}
              <div className="enterprise-table-scroll">
                <table className="data-table wizard-summary-table">
                  <thead>
                    <tr>
                      <th>{locale === "ar" ? "كود الصنف" : "Item code"}</th>
                      <th>{locale === "ar" ? "الوصف" : "Description"}</th>
                      <th className="wizard-summary-num">
                        {locale === "ar" ? "العدد" : "Qty"}
                      </th>
                      <th className="wizard-summary-num">
                        {locale === "ar" ? "كجم / قطعة" : "kg / pc"}
                      </th>
                      <th className="wizard-summary-num">
                        {locale === "ar" ? "إجمالي كجم" : "Total kg"}
                      </th>
                      <th className="wizard-summary-num">
                        {locale === "ar" ? "سعر الوحدة" : "Unit price"}
                      </th>
                      <th className="wizard-summary-num">
                        {locale === "ar" ? "إجمالي البند" : "Line total"}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {consolidatedLines.map((line) => (
                      <tr key={line.identity}>
                        <td className="wizard-summary-code">
                          {line.codeStatus === "CODED" ? (
                            <code>{line.itemCode}</code>
                          ) : (
                            // The badge is the way in: a line whose code is
                            // pending is exactly the line somebody needs to
                            // pick a code for, so clicking it lists the
                            // catalogue's codes at that board's size.
                            <button
                              type="button"
                              className={`wizard-code-badge is-${line.codeStatus === "UNCODED" ? "uncoded" : "pending"}`}
                              title={
                                line.codeStatus === "UNCODED"
                                  ? locale === "ar"
                                    ? "خارج كتالوج الأصناف المكوّدة — اضغط لعرض الأكواد بنفس المقاس."
                                    : "Outside the coded catalogue — click for the codes at this size."
                                  : locale === "ar"
                                    ? "لسه متخصصش كود — اضغط لعرض الأكواد بنفس المقاس."
                                    : "No code yet — click for the codes at this size."
                              }
                              onClick={() => {
                                setCodePickerLine(line);
                              }}
                            >
                              {line.codeStatus === "UNCODED"
                                ? locale === "ar"
                                  ? "بدون كود"
                                  : "Uncoded"
                                : locale === "ar"
                                  ? "قيد الترميز"
                                  : "Pending"}
                            </button>
                          )}
                        </td>
                        <td className="wizard-summary-desc">
                          {line.description}
                          {line.sources.length > 1 && (
                            <details className="wizard-summary-sources">
                              <summary>
                                {locale === "ar"
                                  ? `من ${String(line.sources.length)} عناصر`
                                  : `From ${String(line.sources.length)} scopes`}
                              </summary>
                              <ul>
                                {line.sources.map((source) => (
                                  <li key={source.label}>
                                    {source.label} — {source.qty}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </td>
                        <td className="wizard-summary-num">{line.qty}</td>
                        <td className="wizard-summary-num">
                          {line.qty > 0
                            ? formatWeight(line.totalWeightKg / line.qty)
                            : "—"}
                        </td>
                        <td className="wizard-summary-num">
                          {formatWeight(line.totalWeightKg)}
                        </td>
                        <td className="wizard-summary-num">
                          {formatMoney(line.unitPrice)}
                        </td>
                        <td className="wizard-summary-num wizard-summary-total">
                          {formatMoney(line.lineTotal)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <dl className="quotation-summary-financials quotation-summary-engineering">
            <div>
              <dt>{locale === "ar" ? "عدد البنود" : "Quotation items"}</dt>
              <dd>{lines.length}</dd>
            </div>
            <div>
              <dt>
                {locale === "ar" ? "إجمالي القطع" : "Total finished pieces"}
              </dt>
              <dd>{liveEngineering.pieces.toLocaleString("en-US")}</dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "الوزن الكلي" : "Total weight"}</dt>
              <dd>{formatWeight(liveEngineering.weightKg)} kg</dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "حالة التحقق" : "Validation status"}</dt>
              <dd>
                <LineStatusChip locale={locale} status={quotationStatus} />
              </dd>
            </div>
          </dl>
          <dl className="quotation-summary-financials">
            <div>
              <dt>{locale === "ar" ? "المجموع الفرعي" : "Subtotal"}</dt>
              <dd>{formatMoney(liveSubtotal, str(detail.currencyCode))}</dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "خصومات البنود" : "Line discounts"}</dt>
              <dd>
                − {formatMoney(liveLineDiscount, str(detail.currencyCode))}
              </dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "تعديلات العرض" : "Quote adjustments"}</dt>
              <dd>
                {liveAdjustmentAmount < 0 ? "− " : "+ "}
                {formatMoney(
                  Math.abs(liveAdjustmentAmount),
                  str(detail.currencyCode),
                )}
              </dd>
            </div>
            <div>
              <dt>
                {locale === "ar"
                  ? `ضريبة القيمة المضافة (${inferredVatRate.toFixed(2)}%)`
                  : `VAT (${inferredVatRate.toFixed(2)}%)`}
              </dt>
              <dd>{formatMoney(liveTaxAmount, str(detail.currencyCode))}</dd>
            </div>
            <div className="quotation-summary-grand-total">
              <dt>{locale === "ar" ? "الإجمالي النهائي" : "Grand total"}</dt>
              <dd>{formatMoney(liveGrandTotal, str(detail.currencyCode))}</dd>
            </div>
          </dl>
          {/* With no active VAT policy the server computes zero tax and the
                quotation silently totals to its own subtotal. On a document
                that goes to a customer, a missing tax rate has to be said out
                loud rather than shown as 0.00%. */}
          {inferredVatRate === 0 && (
            <p className="quotation-tax-warning" role="status">
              {locale === "ar"
                ? "لا توجد سياسة ضريبة مفعّلة، فالإجمالي بدون ضريبة قيمة مضافة. اضبطها من الإدارة قبل إرسال العرض."
                : "No active VAT policy, so this total carries no tax. Set one in administration before sending."}
            </p>
          )}
          <section
            className="quotation-adjustments"
            aria-label={
              locale === "ar" ? "تعديلات عرض السعر" : "Quotation adjustments"
            }
          >
            <div className="quotation-adjustments-heading">
              <div>
                <h2>
                  {locale === "ar"
                    ? "الشحن والخصومات والتعديلات"
                    : "Freight, discounts & adjustments"}
                </h2>
                <p>
                  {locale === "ar"
                    ? "أضف قيمة موجبة للرسوم أو سالبة للخصم. تُحسب الضريبة بعد التعديلات."
                    : "Use a positive value for a charge or a negative one for a discount. VAT is calculated after adjustments."}
                </p>
              </div>
              {editable && (
                <button
                  type="button"
                  onClick={() => {
                    setAdjustmentDraft([
                      ...adjustments,
                      {
                        typeCode: "FREIGHT",
                        modeCode: "FIXED_AMOUNT",
                        value: "0",
                        label: "Freight",
                      },
                    ]);
                  }}
                >
                  {locale === "ar" ? "+ إضافة تعديل" : "+ Add adjustment"}
                </button>
              )}
            </div>
            {adjustments.length === 0 ? (
              <p className="muted">
                {locale === "ar"
                  ? "لا توجد تعديلات إضافية."
                  : "No quotation-level adjustments."}
              </p>
            ) : (
              <div className="enterprise-table-scroll">
                <table className="data-table quotation-adjustment-table">
                  <thead>
                    <tr>
                      <th>{locale === "ar" ? "البيان" : "Label"}</th>
                      <th>{locale === "ar" ? "الطريقة" : "Method"}</th>
                      <th>{locale === "ar" ? "القيمة" : "Value"}</th>
                      <th>{locale === "ar" ? "الأثر" : "Impact"}</th>
                      {editable && (
                        <th>{locale === "ar" ? "إجراء" : "Action"}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {adjustments.map((adjustment, index) => {
                      const updateAdjustment = (patch: Partial<Adjustment>) => {
                        setAdjustmentDraft(
                          adjustments.map((row, position) =>
                            position === index ? { ...row, ...patch } : row,
                          ),
                        );
                      };
                      const impact =
                        adjustment.modeCode === "PERCENT"
                          ? (liveSubtotal * Number(adjustment.value || 0)) / 100
                          : Number(adjustment.value || 0);
                      return (
                        <tr key={`${adjustment.typeCode}-${String(index)}`}>
                          <td>
                            <input
                              readOnly={!editable}
                              value={adjustment.label}
                              placeholder={
                                locale === "ar" ? "مثال: شحن" : "e.g. Freight"
                              }
                              onChange={(event) => {
                                updateAdjustment({
                                  label: event.target.value,
                                  typeCode:
                                    event.target.value
                                      .trim()
                                      .toUpperCase()
                                      .replace(/[^A-Z0-9]+/g, "_") ||
                                    "ADJUSTMENT",
                                });
                              }}
                            />
                          </td>
                          <td>
                            <select
                              disabled={!editable}
                              value={adjustment.modeCode}
                              onChange={(event) => {
                                updateAdjustment({
                                  modeCode: event.target
                                    .value as Adjustment["modeCode"],
                                });
                              }}
                            >
                              <option value="FIXED_AMOUNT">
                                {locale === "ar" ? "مبلغ ثابت" : "Fixed amount"}
                              </option>
                              <option value="PERCENT">
                                {locale === "ar"
                                  ? "نسبة من المجموع"
                                  : "% of subtotal"}
                              </option>
                            </select>
                          </td>
                          <td>
                            <input
                              readOnly={!editable}
                              type="number"
                              step="any"
                              value={adjustment.value}
                              onChange={(event) => {
                                updateAdjustment({
                                  value: event.target.value,
                                });
                              }}
                            />
                          </td>
                          <td>
                            {formatMoney(impact, str(detail.currencyCode))}
                            {adjustment.modeCode === "PERCENT"
                              ? ` (${String(adjustment.value || 0)}%)`
                              : ""}
                          </td>
                          {editable && (
                            <td>
                              <button
                                type="button"
                                className="eng-delete-btn"
                                aria-label={
                                  locale === "ar"
                                    ? "حذف التعديل"
                                    : "Delete adjustment"
                                }
                                onClick={() => {
                                  setAdjustmentDraft(
                                    adjustments.filter(
                                      (_, position) => position !== index,
                                    ),
                                  );
                                }}
                              >
                                ×
                              </button>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
          <dl className="quotation-summary-facts">
            <div>
              <dt>{locale === "ar" ? "شروط الدفع" : "Payment terms"}</dt>
              <dd>
                {schedulePreview
                  ? locale === "ar"
                    ? "مقدم + أقساط (انظر أعلى)"
                    : "Advance + installments (see above)"
                  : (termOptions.find(
                      (o) => o.value === header.paymentTermsCode,
                    )?.[locale === "ar" ? "ar" : "en"] ?? "—")}
              </dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "شرط التسليم" : "Incoterm"}</dt>
              <dd>
                {INCOTERM_OPTIONS.find(
                  (o) => o.value === header.incotermCode,
                )?.[locale === "ar" ? "ar" : "en"] ?? "—"}
              </dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "الصلاحية" : "Validity"}</dt>
              <dd>
                {formatValidity(detail.validFrom, detail.expiresOn, locale)}
              </dd>
            </div>
            <div>
              <dt>{locale === "ar" ? "جهة الاتصال" : "Customer contact"}</dt>
              <dd>
                {accountContacts.data?.data.find(
                  (c) => c.contactId === header.contactId,
                )?.displayName ?? "—"}
              </dd>
            </div>
          </dl>
          <div className="quotation-summary-links">
            {Boolean(detail.accountId) && (
              <Link to={`/customers/${str(detail.accountId)}`}>
                {locale === "ar" ? "ملف العميل" : "Customer 360"}
              </Link>
            )}
            {Boolean(detail.opportunityId) && (
              <Link to={`/opportunities/${str(detail.opportunityId)}`}>
                {locale === "ar" ? "الفرصة" : "Opportunity"}
              </Link>
            )}
            {me.access.permissions.includes("activities.create") && (
              <Link
                to={`/activities?create=1&quotationId=${encodeURIComponent(quotationId)}`}
              >
                {locale === "ar"
                  ? "+ متابعة أو اجتماع"
                  : "+ Follow-up or meeting"}
              </Link>
            )}
          </div>
        </div>
      </section>
      <section id="q-step-payment" className="q-step">
        <header className="q-step-head">
          <span className="q-step-n">4</span>
          <div>
            <h2>{locale === "ar" ? "الدفع" : "Payment"}</h2>
            <p>
              {locale === "ar"
                ? "شرط دفع جاهز، أو مقدم وأقساط بنسبها وتواريخها."
                : "A standard term, or an advance and instalments with their percentages and dates."}
            </p>
          </div>
        </header>
        <dl className="quotation-fact-grid q-payment-grid">
          <QuotationFact
            label={locale === "ar" ? "شروط الدفع" : "Payment terms"}
            info={
              locale === "ar"
                ? "يظهر هذا النص في مستند العرض النهائي كما هو، مثل نسبة الدفعة المقدمة أو مدة الأجل."
                : "This appears verbatim on the final document, e.g. the advance percentage or credit period."
            }
            value={
              editable ? (
                <select
                  aria-label={locale === "ar" ? "شروط الدفع" : "Payment terms"}
                  value={header.paymentTermsCode}
                  onChange={(event) => {
                    setHeaderDraft({
                      ...header,
                      paymentTermsCode: event.target.value,
                    });
                  }}
                >
                  {termOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {locale === "ar" ? option.ar : option.en}
                    </option>
                  ))}
                </select>
              ) : (
                (termOptions.find(
                  (option) => option.value === header.paymentTermsCode,
                )?.[locale === "ar" ? "ar" : "en"] ?? "—")
              )
            }
          />
        </dl>
        <section className="payment-schedule-section">
          <label className="payment-schedule-toggle">
            <input
              type="checkbox"
              disabled={!editable}
              checked={header.paymentScheduleCode === "ADVANCE_INSTALLMENTS"}
              onChange={(event) => {
                setHeaderDraft({
                  ...header,
                  paymentScheduleCode: event.target.checked
                    ? "ADVANCE_INSTALLMENTS"
                    : "",
                });
              }}
            />
            {locale === "ar"
              ? "استخدام جدول دفعات (مقدم + أقساط) بدل شروط الدفع البسيطة"
              : "Use a payment schedule (advance + installments) instead of simple payment terms"}
          </label>
          {header.paymentScheduleCode === "ADVANCE_INSTALLMENTS" && (
            <div className="payment-schedule-builder">
              <div className="payment-schedule-inputs">
                <label className="payment-schedule-field">
                  <span>{locale === "ar" ? "نسبة المقدم %" : "Advance %"}</span>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    step="any"
                    readOnly={!editable}
                    value={header.advancePct}
                    onChange={(event) => {
                      setHeaderDraft({
                        ...header,
                        advancePct: event.target.value,
                      });
                    }}
                  />
                </label>
                <label className="payment-schedule-field">
                  <span>
                    {locale === "ar" ? "عدد الأقساط" : "Number of installments"}
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    step="1"
                    readOnly={!editable}
                    value={header.installments}
                    onChange={(event) => {
                      setHeaderDraft({
                        ...header,
                        installments: event.target.value,
                      });
                    }}
                  />
                </label>
                <label className="payment-schedule-field">
                  <span>
                    {locale === "ar"
                      ? "تكرار الدفعات (يوم)"
                      : "Installment frequency (days)"}
                  </span>
                  <input
                    type="number"
                    min="1"
                    max="365"
                    step="1"
                    readOnly={!editable}
                    value={header.frequencyDays}
                    onChange={(event) => {
                      setHeaderDraft({
                        ...header,
                        frequencyDays: event.target.value,
                      });
                    }}
                  />
                </label>
                <label className="payment-schedule-field">
                  <span>
                    {locale === "ar"
                      ? "تاريخ مرجعي (التسليم)"
                      : "Reference date (delivery)"}
                  </span>
                  <input
                    type="date"
                    readOnly={!editable}
                    value={header.referenceDate}
                    onChange={(event) => {
                      setHeaderDraft({
                        ...header,
                        referenceDate: event.target.value,
                      });
                    }}
                  />
                </label>
                <label className="payment-schedule-field">
                  <span>
                    {locale === "ar" ? "طريقة الدفع" : "Payment method"}
                  </span>
                  <select
                    disabled={!editable}
                    value={header.paymentMethod}
                    onChange={(event) => {
                      setHeaderDraft({
                        ...header,
                        paymentMethod: event.target.value,
                      });
                    }}
                  >
                    {PAYMENT_METHOD_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {locale === "ar" ? option.ar : option.en}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              {schedulePreview && (
                <div className="payment-schedule-preview">
                  <h3 className="payment-schedule-preview-title">
                    {locale === "ar"
                      ? "معاينة جدول الدفعات"
                      : "Payment schedule preview"}
                  </h3>
                  <div className="enterprise-table-scroll">
                    <table className="data-table payment-schedule-table">
                      <thead>
                        <tr>
                          {[
                            locale === "ar" ? "مرحلة الدفع" : "Payment stage",
                            locale === "ar" ? "النسبة" : "Percentage",
                            locale === "ar" ? "المبلغ المستحق" : "Amount due",
                            locale === "ar"
                              ? "التوقيت / التاريخ"
                              : "Due timing / date",
                            locale === "ar" ? "طريقة الدفع" : "Payment method",
                          ].map((label) => (
                            <th key={label}>{label}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {schedulePreview.rows.map((row) => (
                          <tr key={`${row.stage}-${String(row.index)}`}>
                            <td>
                              {row.stage === "ADVANCE"
                                ? locale === "ar"
                                  ? "الدفعة المقدمة"
                                  : "Advance Payment"
                                : `${locale === "ar" ? "قسط" : "Installment"} ${String(row.index)}`}
                            </td>
                            <td>{row.pct.toFixed(2)}%</td>
                            <td>{formatMoney(row.amount)}</td>
                            <td>
                              {row.stage === "ADVANCE"
                                ? locale === "ar"
                                  ? "قبل التسليم / عند تأكيد الطلب"
                                  : "Before delivery / on order confirmation"
                                : (row.dueDate ??
                                  (locale === "ar"
                                    ? `بعد ${String(row.daysAfter)} يوم من التاريخ المرجعي`
                                    : `${String(row.daysAfter)} days after reference date`))}
                            </td>
                            <td>
                              {PAYMENT_METHOD_OPTIONS.find(
                                (option) => option.value === row.method,
                              )?.[locale === "ar" ? "ar" : "en"] ?? row.method}
                            </td>
                          </tr>
                        ))}
                        <tr className="payment-schedule-total-row">
                          <td colSpan={2}>
                            {locale === "ar" ? "الإجمالي" : "Total"}
                          </td>
                          <td>
                            {formatMoney(
                              schedulePreview.rows.reduce(
                                (sum, row) => sum + row.amount,
                                0,
                              ),
                            )}
                          </td>
                          <td colSpan={2} />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="payment-schedule-prose">
                    {schedulePreview.prose}
                  </p>
                </div>
              )}
            </div>
          )}
        </section>
      </section>
      <header id="q-step-send" className="q-step-head q-step-head-send">
        <span className="q-step-n">5</span>
        <div>
          <h2>{locale === "ar" ? "الإرسال" : "Send"}</h2>
          <p>
            {locale === "ar"
              ? "المستندات والموافقة — وتحت منهم التفاصيل."
              : "Documents and approval — with the detail underneath."}
          </p>
        </div>
      </header>
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      <ErrorBanner
        error={save.error}
        retry={() => {
          save.mutate();
        }}
      />
      <ErrorBanner
        error={createFromPrevious.error}
        retry={() => {
          createFromPrevious.mutate();
        }}
      />
      <ErrorBanner
        error={preview.error}
        retry={() => {
          preview.mutate();
        }}
      />
      <div
        id="quotation-workspace"
        className="panel data-surface"
        role="tabpanel"
      >
        {tab === "pricingrules" && (
          <div className="pricing-explanation-list">
            <p className="pricing-explanation-note">
              {locale === "ar"
                ? "الصفحة دي بتشرح إزاي اتحسب سعر كل بند — مش لتعديل الأسعار. "
                : "This shows how each line's price was derived — it isn't for editing rates. "}
              {me.access.permissions.includes("pricing.policy.view") && (
                <Link to="/admin/pricing">
                  {locale === "ar"
                    ? "لتعديل أسعار الشركة الافتراضية اضغط هنا."
                    : "To change company default rates, go here."}
                </Link>
              )}
            </p>
            {rows(detail.lines).map((item, index) => {
              const snapshot = isObject(item.priceSnapshot)
                ? item.priceSnapshot
                : null;
              const isEngineering = snapshot?.source === "ENGINEERING_CALC";
              const method =
                isEngineering && typeof snapshot.method === "string"
                  ? snapshot.method
                  : null;
              const summary = isEngineering
                ? method === "WEIGHT_BASED"
                  ? locale === "ar"
                    ? "تم حساب السعر بالوزن باستخدام الأبعاد والكثافة وسعر الكيلو."
                    : "Price was calculated by weight, using dimensions, density, and price per kg."
                  : locale === "ar"
                    ? "تم حساب السعر بالمساحة باستخدام الأبعاد وسعر اللوح القياسي."
                    : "Price was calculated by area, using dimensions and the standard board price."
                : item.priceRuleId
                  ? locale === "ar"
                    ? "تم استخدام قاعدة تسعير معتمدة من كتالوج المنتجات."
                    : "A governed pricing rule from the product catalog was used."
                  : locale === "ar"
                    ? "تم إدخال السعر يدويًا بواسطة المستخدم."
                    : "The price was entered manually by the user.";
              return (
                <div
                  key={item.quotationLineId ? str(item.quotationLineId) : index}
                  className="pricing-explanation-row"
                >
                  <div className="pricing-explanation-desc">
                    {str(item.description)}
                  </div>
                  <div className="pricing-explanation-summary">{summary}</div>
                  {snapshot && (
                    <dl className="pricing-explanation-facts">
                      {pricingFacts(snapshot, locale).map((fact) => (
                        <div key={fact.label}>
                          <dt>{fact.label}</dt>
                          <dd>{fact.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </div>
              );
            })}
          </div>
        )}
        {tab === "documents" && (
          <>
            {/* The document has gone out; the next thing that happens to this
                quotation is the customer accepting it. That is the revenue
                event, and it had no control anywhere in the application. */}
            <AcceptancePanel
              client={client}
              me={me}
              quotationId={quotationId}
              quotationRef={str(detail.quotationRef)}
              statusCode={str(detail.statusCode)}
              onAccepted={() => {
                void query.refetch();
              }}
            />
            {/* The same quotation, as a file. Three formats because three
                different people ask for three, all written from one
                description of the document so they cannot disagree. */}
            <QuotationExportButtons
              document={exportDocument}
              proforma={proformaExtra}
              extra={{
                contactPerson: blankIfDash(str(detail.contactName)),
                offerValidity:
                  offerValidityLabel(
                    blankIfDash(str(detail.validFrom)),
                    blankIfDash(str(detail.expiresOn)),
                  ) || blankIfDash(str(basis.documentOfferValidity)),
                customerRef: blankIfDash(str(detail.customerReference)),
                // The name and the number are the writer's: a customer
                // rings the person whose name is on the quotation, not the
                // switchboard. The company setting is a fallback for a
                // colleague who has no number on file or has hidden it.
                salesEngineer:
                  blankIfDash(owner.name) ||
                  blankIfDash(str(basis.documentSalesEngineer)),
                mobile:
                  blankIfDash(owner.phone) ||
                  blankIfDash(str(basis.documentMobile)),
                delivery: blankIfDash(str(basis.documentDeliveryTerms)),
                deliveryPoint: blankIfDash(str(basis.documentDeliveryPoint)),
                // The plan's own label, which is what the template's Payment
                // cell was drawn for: "100% in advance." not four figures.
                paymentShort:
                  scheduleShort ?? exportPlan?.label ?? exportPaymentText ?? "",
              }}
              labels={{
                pdf: locale === "ar" ? "طباعة / PDF" : "Print / PDF",
                excel: locale === "ar" ? "تنزيل Excel" : "Download Excel",
                word: locale === "ar" ? "تنزيل Word" : "Download Word",
                working: locale === "ar" ? "بيجهّز…" : "Preparing…",
                failed:
                  locale === "ar"
                    ? "الملف ماتعملش. جرّب تاني."
                    : "The file could not be written. Try again.",
                overflow: (count) =>
                  locale === "ar"
                    ? `${String(count)} بند محتاج مراجعة في ملف التصدير.`
                    : `${String(count)} line${count === 1 ? "" : "s"} needs review in the exported file.`,
              }}
              onPrint={() => {
                window.print();
              }}
            />
            <ErrorBanner
              error={related.error}
              retry={() => void related.refetch()}
            />
            {rows(related.data?.data).length === 0 && !related.isLoading && (
              <p className="quotation-no-document">
                {locale === "ar"
                  ? "لم يتم إنشاء مستند لهذا العرض بعد."
                  : "No document has been created for this quotation yet."}
              </p>
            )}
            {rows(related.data?.data).map((doc) => (
              <div
                key={str(doc.documentId)}
                className="quotation-document-card"
              >
                <div className="quotation-document-card-row">
                  <StatusChip code={str(doc.statusCode)} />
                  <span>
                    {locale === "ar" ? "الإصدار" : "Version"} {str(doc.version)}
                  </span>
                  <span>
                    {new Date(str(doc.createdAt)).toLocaleDateString(
                      locale === "ar" ? "ar-EG" : "en-US",
                    )}
                  </span>
                </div>
              </div>
            ))}
            <button
              disabled={preview.isPending || !query.data}
              onClick={() => {
                preview.mutate();
              }}
            >
              {locale === "ar"
                ? "معاينة العرض (PDF)"
                : "Preview quotation (PDF)"}
            </button>
            {rows(related.data?.data).map((doc) =>
              doc.documentId ? (
                <DocumentDownload
                  key={str(doc.documentId)}
                  client={client}
                  documentId={str(doc.documentId)}
                />
              ) : null,
            )}
          </>
        )}
        {tab === "discussion" && (
          <RecordThread
            client={client}
            contextType="QUOTATION"
            contextId={quotationId}
            currentUserId={me.user.userId}
          />
        )}
        {tab === "audit" && (
          <QuotationAuditTimeline
            locale={locale}
            quotationId={quotationId}
            currentUserId={me.user.userId}
            chain={
              rows(related.data?.data).length > 0
                ? rows(related.data?.data)
                : [
                    {
                      quotationId,
                      quoteRef: detail.quoteRef,
                      statusCode: detail.statusCode,
                      sentAt: detail.sentAt,
                    },
                  ]
            }
            events={rows(auditEvents.data?.data).filter(
              (event) =>
                str(event.resourceId) === quotationId &&
                str(event.resourceTypeCode).toUpperCase() === "QUOTATION",
            )}
            loading={related.isLoading || auditEvents.isLoading}
            chainError={related.error}
            auditError={auditEvents.error}
            retry={() => {
              void related.refetch();
              if (me.access.permissions.includes("audit.view"))
                void auditEvents.refetch();
            }}
          />
        )}
        {tab === "approval" && (
          <>
            <ErrorBanner
              error={approvals.error}
              retry={() => void approvals.refetch()}
            />
            {quotationApprovals.map((a) => (
              <div key={str(a.approvalRequestId)}>
                <p>{str(a.statusCode)}</p>
                {a.statusCode === "PENDING" &&
                  a.requestedByUserId !== me.user.userId &&
                  (!a.currentAssigneeUserId ||
                    a.currentAssigneeUserId === me.user.userId) &&
                  me.access.permissions.includes("approvals.decide") &&
                  approvalDecisionOperation && (
                    <OperationAction
                      client={client}
                      operation={approvalDecisionOperation}
                      routeParams={{ requestId: str(a.approvalRequestId) }}
                      onComplete={() => {
                        void approvals.refetch();
                        void query.refetch();
                      }}
                    />
                  )}
              </div>
            ))}
          </>
        )}
        <div className="action-grid">
          {commands
            .filter((id) =>
              id.endsWith("_commercial_state_transitions")
                ? detail.statusCode === "SENT" &&
                  detail.commercialState === "SUBMITTED"
                : id.endsWith("_cancel")
                  ? // Cancelling is for a live document. One already cancelled
                    // or replaced has nothing left to cancel.
                    detail.statusCode !== "CANCELLED" &&
                    detail.statusCode !== "SUPERSEDED"
                  : id.endsWith("_supersede")
                    ? detail.statusCode === "SENT"
                    : id.endsWith("_send")
                      ? detail.statusCode === "READY"
                      : id.endsWith("_prepare") ||
                          id.endsWith("_approval_requests")
                        ? detail.statusCode === "DRAFT"
                        : true,
            )
            .map((id) => {
              const operation = operationById.get(id);
              // Sending has its own screen: who receives it, by email from
              // the system or recorded as sent by hand.
              if (
                id.endsWith("_send") &&
                operation &&
                me.access.permissions.includes(operation.permission)
              )
                return (
                  <SendQuotationButton
                    key={id}
                    client={client}
                    quotationId={quotationId}
                    quoteRef={str(detail.quoteRef ?? detail.quotationRef)}
                    accountId={str(detail.accountId)}
                    accountName={str(
                      account.canonicalName ?? detail.accountName,
                    )}
                    rowVersion={str(detail.rowVersion)}
                    onSent={() => void query.refetch()}
                  />
                );
              return operation &&
                (operation.permission === "authenticated" ||
                  me.access.permissions.includes(operation.permission)) ? (
                <OperationAction
                  key={id}
                  client={client}
                  operation={operation}
                  currentVersion={str(detail.rowVersion)}
                  routeParams={{ quotationId }}
                  onResult={(result) => {
                    if (
                      id.endsWith("_supersede") &&
                      isObject(result) &&
                      isObject(result.data) &&
                      typeof result.data.quotationId === "string"
                    ) {
                      setDraft(null);
                      void navigate(`/quotations/${result.data.quotationId}`);
                    }
                    if (
                      id.endsWith("_prepare") &&
                      isObject(result) &&
                      isObject(result.data) &&
                      Array.isArray(result.data.blockers)
                    ) {
                      setPrepareBlockers(
                        result.data.blockers.filter(isObject).map((b) => ({
                          code: str(b.code),
                          field: typeof b.field === "string" ? b.field : null,
                          message: str(b.message),
                        })),
                      );
                    }
                  }}
                  onComplete={() => void query.refetch()}
                />
              ) : null;
            })}
        </div>
        {prepareBlockers.length > 0 && (
          <div className="panel">
            <h3>
              {locale === "ar"
                ? "لا يمكن تجهيز العرض بعد"
                : "Quotation not ready yet"}
            </h3>
            <ul>
              {prepareBlockers.map((b, index) => {
                const lineMatch = /^lines\.([^.]+)\.unitPrice$/.exec(
                  b.field ?? "",
                );
                const lineId = lineMatch?.[1] ?? null;
                return (
                  <li key={`${b.code}-${String(index)}`}>
                    <span className="field-warning">
                      {blockerMessage(b.code, b.message, locale)}
                    </span>
                    {b.code === "PRICE_BELOW_MINIMUM" &&
                      lineId &&
                      me.access.permissions.includes(
                        "pricing.override_min",
                      ) && (
                        <button
                          type="button"
                          onClick={() => {
                            setOverrideLineId(lineId);
                          }}
                        >
                          {locale === "ar"
                            ? "طلب استثناء سعر"
                            : "Request price override"}
                        </button>
                      )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}
        {overrideLineId && (
          <form
            className="panel"
            onSubmit={(e) => {
              e.preventDefault();
              requestOverride.mutate();
            }}
          >
            <h3>
              {locale === "ar"
                ? "اعتماد سعر أقل من الحد الأدنى"
                : "Approve price below minimum"}
            </h3>
            <label>
              {locale === "ar" ? "السعر المطلوب" : "Requested unit price"}
              <input
                required
                type="number"
                min="0"
                step="any"
                value={overridePrice}
                onChange={(e) => {
                  setOverridePrice(e.target.value);
                }}
              />
            </label>
            <label>
              {locale === "ar" ? "سبب الاستثناء" : "Override reason"}
              <textarea
                required
                minLength={3}
                maxLength={2000}
                value={overrideReason}
                onChange={(e) => {
                  setOverrideReason(e.target.value);
                }}
              />
            </label>
            <ErrorBanner
              error={requestOverride.error}
              retry={() => {
                requestOverride.mutate();
              }}
            />
            <button className="primary" disabled={requestOverride.isPending}>
              {requestOverride.isPending
                ? "…"
                : locale === "ar"
                  ? "اعتماد الاستثناء"
                  : "Approve override"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOverrideLineId(null);
              }}
            >
              {locale === "ar" ? "إلغاء" : "Cancel"}
            </button>
          </form>
        )}
      </div>
      {previewUrl && (
        <SlideOver
          title={locale === "ar" ? "معاينة عرض السعر" : "Quotation preview"}
          onClose={() => {
            setPreviewUrl("");
          }}
        >
          <iframe
            title={
              locale === "ar" ? "معاينة العرض" : "Quotation preview document"
            }
            src={previewUrl}
            sandbox=""
            style={{ width: "100%", height: "80vh", border: 0 }}
          />
        </SlideOver>
      )}

      {/* Opened from a Pending or Uncoded badge on the summary. The size is
          what the catalogue is searched on, because that is what many codes
          share; picking one writes it onto every scope line that delivers
          this board. */}
      {codePickerLine !== null && (
        <ItemCodePicker
          query={{
            description: codePickerLine.description,
            thicknessMm: codePickerLine.thicknessMm,
            widthMm: codePickerLine.widthMm,
            lengthMm: codePickerLine.lengthMm,
          }}
          products={catalogue}
          labels={{
            title: locale === "ar" ? "أكواد اللوح ده" : "Codes for this board",
            search:
              locale === "ar"
                ? "فلتر بالكود أو الوصف"
                : "Filter by code or description",
            empty:
              locale === "ar"
                ? "الكتالوج مفيهوش صنف بكود بالمقاس ده."
                : "The catalogue has no coded item at this size.",
            noSize:
              locale === "ar"
                ? "البند ده مالوش أبعاد يتدوّر بيها."
                : "This line has no dimensions to search on.",
            close: locale === "ar" ? "اقفل" : "Close",
            use: locale === "ar" ? "استخدم" : "Use",
            counted: (shown) =>
              locale === "ar"
                ? `${String(shown)} كود بالمقاس ده`
                : `${String(shown)} code${shown === 1 ? "" : "s"} at this size`,
          }}
          onPick={(product) => {
            // Every scope line that delivers this board takes the code: the
            // consolidated row is several lines added together, and coding
            // only one of them would leave the row pending anyway.
            const size = codePickerLine;
            setDraft(
              lines.map((line) =>
                toNum(line.thicknessMm, 0) === size.thicknessMm &&
                toNum(line.widthMm, 0) === size.widthMm &&
                toNum(line.lengthMm, 0) === size.lengthMm
                  ? { ...line, productId: product.productId, codeAuto: false }
                  : line,
              ),
            );
            setCodePickerLine(null);
          }}
          onClose={() => {
            setCodePickerLine(null);
          }}
        />
      )}
    </section>
  );
}

/** A rate as people read it: up to four places, no trailing zeros. */
function rateText(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("en-US", { maximumFractionDigits: 4 })
    : "—";
}

/**
 * One of the rates the quotation is priced on.
 *
 * Empty means "the company's", with the company's figure as the placeholder;
 * typing a figure makes it this quotation's own. The caption says which,
 * because a greyed placeholder and a typed value look alike at a glance.
 */
function RateBox({
  id,
  label,
  unit,
  value,
  placeholder,
  editable,
  locale,
  onChange,
  detail,
}: {
  id: string;
  label: string;
  unit: string;
  value: string;
  placeholder: string;
  editable: boolean;
  locale: string;
  onChange: (value: string) => void;
  detail?: ReactNode;
}) {
  const own = value.trim() !== "";
  return (
    <div className={`q-rate ${own ? "is-own" : ""}`}>
      <label className="q-rate-label" htmlFor={id}>
        {label}
      </label>
      <span className="q-rate-field">
        <input
          id={id}
          inputMode="decimal"
          dir="ltr"
          readOnly={!editable}
          value={value}
          placeholder={placeholder}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
        <em>{unit}</em>
      </span>
      <small className="q-rate-source">
        {own
          ? locale === "ar"
            ? "خاص بالعرض ده"
            : "This quotation"
          : locale === "ar"
            ? "سعر الشركة"
            : "Company rate"}
      </small>
      {detail !== undefined && (
        <small className="q-rate-detail">{detail}</small>
      )}
    </div>
  );
}

function QuotationFact({
  label,
  value,
  strong = false,
  info,
}: {
  label: string;
  value: ReactNode;
  strong?: boolean;
  info?: string;
}) {
  return (
    <div>
      <dt>
        {label}
        {info && <InfoTooltip text={info} />}
      </dt>
      <dd className={strong ? "quotation-fact-strong" : undefined}>{value}</dd>
    </div>
  );
}

// The full engineering detail for one line item, in a SlideOver instead of
// an inline <tr colSpan> — the inline panel used to force the whole item
// table to stretch to its widest row, breaking the table layout at normal
// screen widths. Also the only place CIRCULAR's diameter/radius/column
// height/category/reference/CAD mark inputs are exposed at all — they were
// wired into the save payload and hydration but had no UI before this.
/**
 * Face-by-face entry, the workbook's F01:F20 engine. An irregular column gets
 * six boxes, a core or a wall twenty, and any face may be marked curved —
 * those panels are charged at the curved rate while the rest of the element
 * stays flat. "Expected faces" is the workbook's own guard against a drawing
 * entered one face short.
 */
function FaceWidthInputs({
  locale,
  editable,
  line,
  onChange,
}: {
  locale: "en" | "ar";
  editable: boolean;
  line: Line;
  onChange: (patch: Partial<Line>) => void;
}) {
  const maxFaces = maxFacesFor(line);
  const isElement =
    line.materialClass === "CORE" || line.materialClass === "WALL";
  return (
    <>
      <div className="eng-panel-field eng-panel-field-wide">
        <span>
          {locale === "ar"
            ? `أوجه الرسمة (مم) — حتى ${String(maxFaces)}`
            : `Faces from the drawing (mm) — up to ${String(maxFaces)}`}
        </span>
        <div className="column-face-inputs">
          {Array.from({ length: maxFaces }, (_unused, face) => {
            const faceNumber = face + 1;
            const curved = line.curvedFaceNumbers.includes(faceNumber);
            return (
              <div className="column-face-input" key={face}>
                <input
                  readOnly={!editable}
                  type="number"
                  min="0"
                  step="any"
                  aria-label={`face ${String(faceNumber)}`}
                  placeholder={`F${String(faceNumber).padStart(2, "0")}`}
                  value={line.faceWidthsMm[face] ?? ""}
                  onChange={(event) => {
                    const next = Array.from(
                      { length: maxFaces },
                      (_ignored, position) =>
                        position === face
                          ? event.target.value
                          : (line.faceWidthsMm[position] ?? ""),
                    );
                    onChange({ faceWidthsMm: next });
                  }}
                />
                {isElement && (
                  <label className="column-face-curved">
                    <input
                      type="checkbox"
                      disabled={!editable}
                      checked={curved}
                      aria-label={`face ${String(faceNumber)} curved`}
                      onChange={(event) => {
                        onChange({
                          curvedFaceNumbers: event.target.checked
                            ? [...line.curvedFaceNumbers, faceNumber].sort(
                                (a, b) => a - b,
                              )
                            : line.curvedFaceNumbers.filter(
                                (value) => value !== faceNumber,
                              ),
                        });
                      }}
                    />
                    {locale === "ar" ? "منحني" : "Curved"}
                  </label>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {isElement && (
        <label className="eng-panel-field">
          <span>
            {locale === "ar" ? "عدد الأوجه المتوقع" : "Expected faces"}
          </span>
          <input
            readOnly={!editable}
            type="number"
            min="1"
            max={maxFaces}
            step="1"
            value={line.expectedFaces}
            onChange={(event) => {
              onChange({ expectedFaces: event.target.value });
            }}
          />
        </label>
      )}
    </>
  );
}

function QuotationLinePanel({
  locale,
  editable,
  index,
  line,
  onClose,
  onChange,
  header,
  companyRates,
  companyDefaultDensity,
  companyDefaultThickness,
  referenceBoardWidthMm,
  referenceBoardLengthMm,
  calculationFormulas,
  takeoffDefaults,
}: {
  locale: "en" | "ar";
  editable: boolean;
  index: number;
  line: Line;
  onClose: () => void;
  onChange: (next: Line) => void;
  header: PricingOverrides;
  companyRates: Record<MaterialClass, number>;
  companyDefaultDensity: number;
  companyDefaultThickness: number;
  referenceBoardWidthMm: number;
  referenceBoardLengthMm: number;
  calculationFormulas: readonly CalculationFormulaOption[];
  takeoffDefaults: TakeoffDefaults;
}) {
  const patchField = (patch: Partial<Line>) => {
    onChange({ ...line, ...patch });
  };
  const updateField = (patch: Partial<Line>) => {
    const next = { ...line, ...patch, unitPrice: null as string | null };
    if (next.descriptionAuto) {
      next.description = buildLineDescription(next);
    }
    onChange(next);
  };
  const isCircular = line.materialClass === "CIRCULAR";
  /* How many standard boards this item actually consumes. A flat sheet needs
     no take-off; a column, core, wall or curve does, and doing it on a
     calculator is where quotation errors come from. The inputs differ per
     class exactly as the ACROW sheet does. */
  // A rectangular column's faces are derived, not typed: A / B / A+closure /
  // B+closure (lib/column-faces.ts). The take-off readout reads them from the
  // same schedule the price came from, so the two can never disagree.
  const derivedFaces =
    line.materialClass === "REGULAR"
      ? columnScheduleFor(line, takeoffDefaults).faceWidthsMm
      : null;
  const sideWidths =
    derivedFaces && derivedFaces.length > 0
      ? derivedFaces
      : line.sideWidthsMm
          .split(/[,\s]+/)
          .map((part) => Number(part))
          .filter((value) => Number.isFinite(value) && value > 0);
  const takeoff = line.materialClass
    ? computeBoardTakeoff({
        materialClass: line.materialClass,
        quantity: Number(line.qty || 0),
        referenceBoard: {
          widthMm: referenceBoardWidthMm,
          lengthMm: referenceBoardLengthMm,
        },
        heightMm: Number(line.columnHeightMm || 0),
        widthMm: Number(line.widthMm || 0),
        lengthMm: Number(line.lengthMm || 0),
        sideWidthsMm: sideWidths,
        arcLengthMm: Number(line.arcLengthMm || 0),
        diameterMm: Number(
          line.diameterMm || (line.radiusMm ? Number(line.radiusMm) * 2 : 0),
        ),
        ...(line.arcAngleDeg ? { arcAngleDeg: Number(line.arcAngleDeg) } : {}),
      })
    : null;
  const needsTakeoff =
    line.materialClass === "REGULAR" ||
    line.materialClass === "CORE" ||
    line.materialClass === "WALL" ||
    line.materialClass === "CURVED";
  const isArc =
    line.materialClass === "CURVED" || line.materialClass === "CIRCULAR";

  const isLegacy = !line.materialClass && Boolean(line.pricingMethodCode);
  const selectedFormula = line.customFormulaKey
    ? calculationFormulas.find(
        (formula) => formula.formulaKey === line.customFormulaKey,
      )
    : undefined;
  const materialPreview = computeMaterialClassPreview(
    line,
    header,
    companyRates,
    companyDefaultDensity,
    companyDefaultThickness,
    calculationFormulas,
    takeoffDefaults,
  );
  const legacyWeightKg =
    !line.materialClass &&
    line.pricingMethodCode === "WEIGHT_BASED" &&
    line.lengthMm &&
    line.widthMm
      ? computeWeightKg({
          lengthMm: Number(line.lengthMm),
          widthMm: Number(line.widthMm),
          thicknessMm: Number(line.thicknessMm || 0),
          densityKgM3: Number(line.densityKgM3 || 0),
        })
      : null;
  const legacyPreviewPrice =
    !line.materialClass &&
    line.pricingMethodCode &&
    line.lengthMm &&
    line.widthMm
      ? previewEngineeringUnitPrice(
          line.pricingMethodCode,
          {
            lengthMm: Number(line.lengthMm),
            widthMm: Number(line.widthMm),
            thicknessMm: Number(line.thicknessMm || 0),
            densityKgM3: Number(line.densityKgM3 || 0),
            pricePerKg: Number(line.pricePerKg || 0),
          },
          3300,
        )
      : null;
  const weightKg = materialPreview?.weightKg ?? legacyWeightKg;
  const unitPrice = materialPreview?.unitPrice ?? legacyPreviewPrice ?? 0;
  const lineTotal = previewLineTotal(line, materialPreview, legacyPreviewPrice);
  return (
    <SlideOver
      title={
        locale === "ar"
          ? `تفاصيل البند #${String(index + 1)}`
          : `Line #${String(index + 1)} details`
      }
      onClose={onClose}
    >
      <div className="eng-panel-grid">
        <label className="eng-panel-field">
          <span>{locale === "ar" ? "فئة المادة" : "Material class"}</span>
          <select
            disabled={!editable}
            value={line.materialClass}
            onChange={(event) => {
              const materialClass = event.target.value as MaterialClass | "";
              const boardTypeLabel = materialClass
                ? DEFAULT_BOARD_TYPE_LABEL_BY_CLASS[materialClass]
                : "";
              const dimensions =
                materialClass && materialClass !== "CIRCULAR"
                  ? DEFAULT_BOARD_DIMENSIONS_MM
                  : { lengthMm: "", widthMm: "", thicknessMm: "" };
              updateField({
                materialClass,
                pricingMethodCode: "",
                boardTypeLabel,
                ...dimensions,
                descriptionAuto: Boolean(materialClass),
              });
            }}
          >
            <option value="">
              {locale === "ar" ? "بدون (سعر يدوي)" : "None (manual price)"}
            </option>
            {MATERIAL_CLASS_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {locale === "ar" ? option.ar : option.en}
              </option>
            ))}
          </select>
        </label>
        {/* The family is decided by the material class for ACROW BOARD lines
            -- a circular column is sold as "M Board Curved", and letting
            someone retype that is how two lines for the same product end up
            reading differently. The free-text field stays for legacy lines,
            which have no class to derive it from. */}
        {isLegacy && (
          <label className="eng-panel-field">
            <span>{locale === "ar" ? "نوع اللوح" : "Board type"}</span>
            <input
              readOnly={!editable}
              type="text"
              list="board-type-suggestions"
              placeholder={
                locale === "ar" ? "مثال: M Board Curved" : "e.g. M Board Curved"
              }
              value={line.boardTypeLabel}
              onChange={(event) => {
                updateField({ boardTypeLabel: event.target.value });
              }}
            />
          </label>
        )}
        {/* A pricing rule stored as data, not code (spec SS11). ACROW does not
            only sell by the kilogram: by m2, by m3, by linear metre, a flat
            price per piece. Picking one replaces the per-kilogram default for
            this line only. */}
        {calculationFormulas.length > 0 && (
          <label className="eng-panel-field eng-panel-field-wide">
            <span>{locale === "ar" ? "قاعدة التسعير" : "Pricing rule"}</span>
            <select
              disabled={!editable}
              value={line.customFormulaKey}
              onChange={(event) => {
                updateField({ customFormulaKey: event.target.value });
              }}
            >
              <option value="">
                {locale === "ar"
                  ? "بالكيلو (الافتراضي)"
                  : "By weight (default)"}
              </option>
              {calculationFormulas.map((formula) => (
                <option key={formula.formulaKey} value={formula.formulaKey}>
                  {locale === "ar" && formula.arabicLabel
                    ? formula.arabicLabel
                    : formula.displayName}
                </option>
              ))}
            </select>
          </label>
        )}
        {selectedFormula && (
          <>
            <label className="eng-panel-field">
              <span>
                {locale === "ar" ? "السعر" : "Rate"}
                {selectedFormula.rateUnitLabel
                  ? ` (${selectedFormula.rateUnitLabel})`
                  : ""}
              </span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.formulaRate}
                onChange={(event) => {
                  updateField({ formulaRate: event.target.value });
                }}
              />
            </label>
            {selectedFormula.expression.includes("fabricationCost") && (
              <label className="eng-panel-field">
                <span>
                  {locale === "ar" ? "تكلفة التصنيع" : "Fabrication cost"}
                </span>
                <input
                  readOnly={!editable}
                  type="number"
                  min="0"
                  step="any"
                  value={line.fabricationCost}
                  onChange={(event) => {
                    updateField({ fabricationCost: event.target.value });
                  }}
                />
              </label>
            )}
            <p className="eng-panel-note eng-panel-field-wide">
              <code>{selectedFormula.expression}</code>
              {materialPreview?.formulaError === true && (
                <em className="eng-panel-note-error">
                  {locale === "ar"
                    ? " — القاعدة دي مش بتحسب على البيانات الحالية."
                    : " — this rule does not evaluate on the values entered."}
                </em>
              )}
            </p>
          </>
        )}
        <label className="eng-panel-field eng-panel-field-wide">
          <span>{locale === "ar" ? "الوصف" : "Description"}</span>
          <input
            readOnly={!editable}
            type="text"
            value={line.description}
            onChange={(event) => {
              patchField({
                description: event.target.value,
                descriptionAuto: false,
              });
            }}
          />
        </label>
        {isLegacy && (
          <label className="eng-panel-field">
            <span>{locale === "ar" ? "طريقة التسعير" : "Method"}</span>
            <select
              disabled={!editable}
              value={line.pricingMethodCode}
              onChange={(event) => {
                const method = event.target.value as EngineeringPricingMethod;
                updateField({
                  pricingMethodCode: method,
                  boardTypeLabel: line.descriptionAuto
                    ? DEFAULT_BOARD_TYPE_LABEL[method]
                    : line.boardTypeLabel,
                });
              }}
            >
              {ENGINEERING_METHOD_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {locale === "ar" ? option.ar : option.en}
                </option>
              ))}
            </select>
          </label>
        )}
        {(line.materialClass === "STANDARD" ||
          line.pricingMethodCode === "LINEAR") && (
          <label className="eng-panel-field">
            <span>
              {locale === "ar"
                ? "طول الامتداد (م) — اختياري"
                : "Extension span (m) — optional"}
            </span>
            <input
              readOnly={!editable}
              type="number"
              min="0"
              step="any"
              placeholder={locale === "ar" ? "مثال: 38" : "e.g. 38"}
              value={line.extensionLengthM}
              onChange={(event) => {
                updateField({ extensionLengthM: event.target.value });
              }}
            />
            {Number(line.extensionLengthM) > 0 && (
              <small className="eng-field-hint">
                {locale === "ar"
                  ? `${String(Math.ceil(Number(line.extensionLengthM) / 2.44))} لوح للوحدة — الكمية ×${String(Math.ceil(Number(line.extensionLengthM) / 2.44))}`
                  : `${String(Math.ceil(Number(line.extensionLengthM) / 2.44))} boards per unit — quantity ×${String(Math.ceil(Number(line.extensionLengthM) / 2.44))}`}
              </small>
            )}
          </label>
        )}
        {needsTakeoff && (
          <>
            {line.materialClass === "REGULAR" && (
              <>
                <label className="eng-panel-field">
                  <span>{locale === "ar" ? "الشكل" : "Shape"}</span>
                  <select
                    disabled={!editable}
                    value={line.columnShape}
                    onChange={(event) => {
                      updateField({
                        columnShape: event.target.value as ColumnShape,
                      });
                    }}
                  >
                    <option value="RECTANGULAR">
                      {locale === "ar" ? "مستطيل" : "Rectangular"}
                    </option>
                    <option value="IRREGULAR">
                      {locale === "ar" ? "غير منتظم" : "Irregular"}
                    </option>
                  </select>
                </label>
                {line.columnShape === "RECTANGULAR" ? (
                  <>
                    <label className="eng-panel-field">
                      <span>
                        {locale === "ar" ? "الضلع A (مم)" : "Side A (mm)"}
                      </span>
                      <input
                        readOnly={!editable}
                        type="number"
                        min="0"
                        step="any"
                        value={line.sideAMm}
                        onChange={(event) => {
                          updateField({ sideAMm: event.target.value });
                        }}
                      />
                    </label>
                    <label className="eng-panel-field">
                      <span>
                        {locale === "ar" ? "الضلع B (مم)" : "Side B (mm)"}
                      </span>
                      <input
                        readOnly={!editable}
                        type="number"
                        min="0"
                        step="any"
                        value={line.sideBMm}
                        onChange={(event) => {
                          updateField({ sideBMm: event.target.value });
                        }}
                      />
                    </label>
                  </>
                ) : (
                  <FaceWidthInputs
                    locale={locale}
                    editable={editable}
                    line={line}
                    onChange={updateField}
                  />
                )}
                {/* The rule, spelled out. Someone entering 300 x 300 needs
                    to see that it is cut as 300 | 300 | 320 | 320 -- the
                    two closing panels lap their neighbours -- and not
                    wonder why the quotation shows a width they never
                    typed. */}
                {materialPreview?.column &&
                  materialPreview.column.faceWidthsMm.length > 0 && (
                    <p className="eng-panel-note eng-panel-field-wide">
                      <code>
                        {materialPreview.column.faceWidthsMm.join(" | ")} mm
                      </code>
                      {" · "}
                      {locale === "ar"
                        ? `${String(materialPreview.column.verticalCourses)} شدة × ${materialPreview.column.courseLengthsMm.join(" / ")} مم`
                        : `${String(materialPreview.column.verticalCourses)} lift(s) of ${materialPreview.column.courseLengthsMm.join(" / ")} mm`}
                      {" · "}
                      {locale === "ar"
                        ? `${String(materialPreview.column.totalPanels)} لوح`
                        : `${String(materialPreview.column.totalPanels)} panels`}
                      {materialPreview.column.notes.map((note) => (
                        <em key={note}> — {note}</em>
                      ))}
                    </p>
                  )}
              </>
            )}
            {(line.materialClass === "CORE" ||
              line.materialClass === "WALL") && (
              <>
                <FaceWidthInputs
                  locale={locale}
                  editable={editable}
                  line={line}
                  onChange={updateField}
                />
                {materialPreview?.column &&
                  materialPreview.column.faceWidthsMm.length > 0 && (
                    <p className="eng-panel-note eng-panel-field-wide">
                      <code>
                        {materialPreview.column.faceWidthsMm.join(" | ")} mm
                      </code>
                      {" · "}
                      {locale === "ar"
                        ? `${String(materialPreview.column.verticalCourses)} شدة × ${materialPreview.column.courseLengthsMm.join(" / ")} مم`
                        : `${String(materialPreview.column.verticalCourses)} lift(s) of ${materialPreview.column.courseLengthsMm.join(" / ")} mm`}
                      {" · "}
                      {locale === "ar"
                        ? `${String(materialPreview.column.totalPanels)} لوح`
                        : `${String(materialPreview.column.totalPanels)} panels`}
                      {materialPreview.column.notes.map((note) => (
                        <em key={note} className="eng-panel-note-error">
                          {" "}
                          — {note}
                        </em>
                      ))}
                    </p>
                  )}
              </>
            )}
            {line.materialClass === "CURVED" && (
              <>
                <label className="eng-panel-field">
                  <span>
                    {locale === "ar"
                      ? "طول القوس المفرود (مم)"
                      : "Developed arc length (mm)"}
                  </span>
                  <input
                    readOnly={!editable}
                    type="number"
                    min="0"
                    step="any"
                    placeholder={
                      locale === "ar"
                        ? "أو سيبها واملا القطر والزاوية"
                        : "or leave blank and give diameter + angle"
                    }
                    value={line.arcLengthMm}
                    onChange={(event) => {
                      updateField({ arcLengthMm: event.target.value });
                    }}
                  />
                </label>
                <label className="eng-panel-field">
                  <span>
                    {locale === "ar" ? "القطر (مم)" : "Diameter (mm)"}
                  </span>
                  <input
                    readOnly={!editable}
                    type="number"
                    min="0"
                    step="any"
                    value={line.diameterMm}
                    onChange={(event) => {
                      updateField({ diameterMm: event.target.value });
                    }}
                  />
                </label>
              </>
            )}
            {isArc && (
              <label className="eng-panel-field">
                <span>
                  {locale === "ar" ? "زاوية القوس (°)" : "Arc angle (°)"}
                </span>
                <input
                  readOnly={!editable}
                  type="number"
                  min="0"
                  max="360"
                  step="any"
                  placeholder="360"
                  value={line.arcAngleDeg}
                  onChange={(event) => {
                    updateField({ arcAngleDeg: event.target.value });
                  }}
                />
              </label>
            )}
            <label className="eng-panel-field">
              <span>
                {locale === "ar"
                  ? line.materialClass === "WALL"
                    ? "ارتفاع الحائط (مم)"
                    : "الارتفاع (مم)"
                  : line.materialClass === "WALL"
                    ? "Wall height (mm)"
                    : "Height (mm)"}
              </span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.columnHeightMm}
                onChange={(event) => {
                  updateField({ columnHeightMm: event.target.value });
                }}
              />
            </label>
          </>
        )}
        {isCircular ? (
          <>
            <label className="eng-panel-field">
              <span>{locale === "ar" ? "القطر (مم)" : "Diameter (mm)"}</span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.diameterMm}
                onChange={(event) => {
                  updateField({
                    diameterMm: event.target.value,
                    radiusMm: "",
                  });
                }}
              />
            </label>
            <label className="eng-panel-field">
              <span>{locale === "ar" ? "نصف القطر (مم)" : "Radius (mm)"}</span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.radiusMm}
                onChange={(event) => {
                  updateField({ radiusMm: event.target.value, diameterMm: "" });
                }}
              />
            </label>
            <label className="eng-panel-field">
              <span>
                {locale === "ar" ? "ارتفاع العمود (مم)" : "Column height (mm)"}
              </span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.columnHeightMm}
                onChange={(event) => {
                  updateField({ columnHeightMm: event.target.value });
                }}
              />
            </label>
            <details className="eng-panel-advanced">
              <summary>
                {locale === "ar" ? "إعدادات متقدمة" : "Advanced settings"}
              </summary>
              <div className="eng-panel-grid">
                <label className="eng-panel-field">
                  <span>
                    {locale === "ar" ? "عدد قطاعات القالب" : "Mould segments"}
                  </span>
                  <input
                    readOnly={!editable}
                    type="number"
                    min="1"
                    step="1"
                    placeholder="2"
                    value={line.mouldSegments}
                    onChange={(event) => {
                      updateField({ mouldSegments: event.target.value });
                    }}
                  />
                </label>
                <label className="eng-panel-field">
                  <span>
                    {locale === "ar"
                      ? "طول وحدة القوس (مم)"
                      : "Arc module (mm)"}
                  </span>
                  <input
                    readOnly={!editable}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="2440"
                    value={line.arcModuleMm}
                    onChange={(event) => {
                      updateField({ arcModuleMm: event.target.value });
                    }}
                  />
                </label>
                <label className="eng-panel-field">
                  <span>
                    {locale === "ar"
                      ? "ارتفاع الكورس الرأسي (مم)"
                      : "Vertical course (mm)"}
                  </span>
                  <input
                    readOnly={!editable}
                    type="number"
                    min="0"
                    step="any"
                    placeholder="1200"
                    value={line.verticalCourseMm}
                    onChange={(event) => {
                      updateField({ verticalCourseMm: event.target.value });
                    }}
                  />
                </label>
              </div>
            </details>
          </>
        ) : (
          <>
            <label className="eng-panel-field">
              <span>{locale === "ar" ? "الطول (مم)" : "Length (mm)"}</span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.lengthMm}
                onChange={(event) => {
                  updateField({ lengthMm: event.target.value });
                }}
              />
            </label>
            <label className="eng-panel-field">
              <span>{locale === "ar" ? "العرض (مم)" : "Width (mm)"}</span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.widthMm}
                onChange={(event) => {
                  updateField({ widthMm: event.target.value });
                }}
              />
            </label>
            <label className="eng-panel-field">
              <span>{locale === "ar" ? "السمك (مم)" : "Thickness (mm)"}</span>
              <input
                readOnly={!editable}
                type="number"
                min="0"
                step="any"
                value={line.thicknessMm}
                onChange={(event) => {
                  updateField({ thicknessMm: event.target.value });
                }}
              />
            </label>
          </>
        )}
        <label className="eng-panel-field">
          <span>
            {locale === "ar" ? "الكثافة (كجم/م3)" : "Density (kg/m3)"}
          </span>
          <input
            readOnly={!editable}
            type="number"
            min="0"
            step="any"
            placeholder={String(companyDefaultDensity)}
            value={line.densityKgM3}
            onChange={(event) => {
              updateField({ densityKgM3: event.target.value });
            }}
          />
        </label>
        <label className="eng-panel-field">
          <span>{locale === "ar" ? "سعر الكيلو" : "Price / kg"}</span>
          <ReciprocalPriceInputs
            locale={locale}
            editable={editable}
            pricePerKg={line.pricePerKg}
            onChangePricePerKg={(value) => {
              updateField({ pricePerKg: value });
            }}
            referenceBoard={{
              referenceBoardWidthMm,
              referenceBoardLengthMm,
              thicknessMm: line.thicknessMm
                ? Number(line.thicknessMm)
                : companyDefaultThickness,
              densityKgM3: line.densityKgM3
                ? Number(line.densityKgM3)
                : header.densityOverrideKgM3
                  ? Number(header.densityOverrideKgM3)
                  : companyDefaultDensity,
            }}
            idPrefix={`panel-line-${String(index)}`}
          />
        </label>
        <label className="eng-panel-field">
          <span>{locale === "ar" ? "الفئة" : "Category"}</span>
          <input
            readOnly={!editable}
            type="text"
            value={line.category}
            onChange={(event) => {
              patchField({ category: event.target.value });
            }}
          />
        </label>
        <label className="eng-panel-field">
          <span>{locale === "ar" ? "المرجع" : "Reference"}</span>
          <input
            readOnly={!editable}
            type="text"
            value={line.reference}
            onChange={(event) => {
              patchField({ reference: event.target.value });
            }}
          />
        </label>
        <label className="eng-panel-field">
          <span>{locale === "ar" ? "رمز CAD" : "CAD mark"}</span>
          <input
            readOnly={!editable}
            type="text"
            value={line.cadMark}
            onChange={(event) => {
              patchField({ cadMark: event.target.value });
            }}
          />
        </label>
      </div>
      <div className="eng-calc-outputs">
        {weightKg != null && (
          <div className="eng-output">
            <span>{locale === "ar" ? "الوزن المحسوب" : "Computed weight"}</span>
            <strong>{weightKg.toFixed(3)} kg</strong>
          </div>
        )}
        {takeoff?.derived && (
          <section className="eng-takeoff">
            <h4>{locale === "ar" ? "حساب الألواح" : "Board take-off"}</h4>
            <p className="eng-takeoff-note">
              {locale === "ar"
                ? `اللوح القياسي ${String(referenceBoardWidthMm)} × ${String(referenceBoardLengthMm)} مم، ${
                    takeoff.orientation === "LONG_SIDE_HORIZONTAL"
                      ? "على سيفه والطول ٢٤٤٠ مع القوس"
                      : "واقف والطول ٢٤٤٠ مع الارتفاع"
                  }.`
                : `Standard board ${String(referenceBoardWidthMm)} × ${String(referenceBoardLengthMm)} mm, ${
                    takeoff.orientation === "LONG_SIDE_HORIZONTAL"
                      ? "on edge with the 2440 along the arc"
                      : "standing with the 2440 up the height"
                  }.`}
            </p>
            <table className="eng-takeoff-table">
              <thead>
                <tr>
                  <th>{locale === "ar" ? "الوجه" : "Face"}</th>
                  <th>{locale === "ar" ? "المقاس (مم)" : "Size (mm)"}</th>
                  <th>{locale === "ar" ? "عرضًا" : "Across"}</th>
                  <th>{locale === "ar" ? "ارتفاعًا" : "Up"}</th>
                  <th>{locale === "ar" ? "قطع" : "Pieces"}</th>
                </tr>
              </thead>
              <tbody>
                {takeoff.faces.map((face, faceIndex) => (
                  <tr key={faceIndex}>
                    <td>
                      {face.label}
                      {face.count > 1 ? ` × ${String(face.count)}` : ""}
                    </td>
                    <td>
                      {Math.round(face.widthMm)} × {Math.round(face.heightMm)}
                    </td>
                    <td>{face.boardsAcross}</td>
                    <td>{face.boardsUp}</td>
                    <td>{face.boards}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="eng-takeoff-totals">
              <span>
                {locale === "ar" ? "قطع للوحدة" : "Pieces per unit"}
                <strong>{takeoff.boardsPerUnit}</strong>
              </span>
              <span>
                {locale === "ar" ? "إجمالي القطع" : "Total pieces"}
                <strong>{takeoff.totalBoards}</strong>
              </span>
              <span>
                {locale === "ar" ? "المساحة" : "Area covered"}
                <strong>{(takeoff.coveredAreaMm2 / 1e6).toFixed(2)} m²</strong>
              </span>
            </div>
            {takeoff.cutList.length > 0 && (
              <>
                <h5 className="eng-takeoff-subhead">
                  {locale === "ar" ? "مقاسات القص" : "Cut sizes"}
                </h5>
                <ul className="eng-takeoff-cuts">
                  {takeoff.cutList.map((piece, pieceIndex) => (
                    <li key={pieceIndex}>
                      <span>
                        {Math.round(piece.widthMm)} ×{" "}
                        {Math.round(piece.heightMm)} mm
                      </span>
                      <em>
                        {piece.fullBoard
                          ? locale === "ar"
                            ? "لوح كامل"
                            : "full board"
                          : locale === "ar"
                            ? "مقصوص على المقاس"
                            : "cut to size"}
                      </em>
                      <strong>× {piece.count}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {takeoff.notes.map((note, noteIndex) => (
              <p key={noteIndex} className="eng-takeoff-note">
                {note}
              </p>
            ))}
          </section>
        )}
        {isCircular && materialPreview?.circular && (
          <>
            <div className="eng-output">
              <span>{locale === "ar" ? "عدد قطع القوس" : "Arc pieces"}</span>
              <strong>{materialPreview.circular.arcPieceCount}</strong>
            </div>
            <div className="eng-output">
              <span>
                {locale === "ar" ? "عدد الكورسات الرأسية" : "Vertical courses"}
              </span>
              <strong>{materialPreview.circular.verticalCourseCount}</strong>
            </div>
            <div className="eng-output">
              <span>
                {locale === "ar" ? "قطع لكل عمود" : "Pieces per column"}
              </span>
              <strong>{materialPreview.circular.piecesPerColumn}</strong>
            </div>
            <div className="eng-output">
              <span>{locale === "ar" ? "إجمالي القطع" : "Total pieces"}</span>
              <strong>{materialPreview.circular.totalPieces}</strong>
            </div>
          </>
        )}
        <div className="eng-output">
          <span>
            {locale === "ar" ? "سعر الوحدة المحسوب" : "Computed unit price"}
          </span>
          <strong>{formatMoney(unitPrice)}</strong>
        </div>
        <div className="eng-output">
          <span>{locale === "ar" ? "إجمالي البند" : "Line total"}</span>
          <strong>{formatMoney(lineTotal)}</strong>
        </div>
      </div>
      {editable && line.materialClass && (
        <button
          type="button"
          className="secondary eng-manual-toggle"
          onClick={() => {
            patchField({
              materialClass: "",
              pricingMethodCode: "",
              unitPrice: String(unitPrice),
              descriptionAuto: false,
            });
          }}
        >
          {locale === "ar" ? "التحويل إلى سعر يدوي" : "Switch to manual price"}
        </button>
      )}
    </SlideOver>
  );
}

/**
 * The workbook's STANDARD RATE CALCULATOR, as the sheet actually enters it.
 *
 * MASTER SETTINGS does not pair two editable price boxes. It asks for one
 * thing -- "Standard Rate Input Type" (BOARD PRICE or PRICE/KG) -- then one
 * "Standard Rate Input Value", and everything else on that block is
 * calculated and read-only: the reference board weight, and whichever of the
 * two prices you did not type. Two live fields with a swap arrow between them
 * was an invention, and it left the person wondering which of the two the
 * system believed.
 *
 * Only pricePerKg is ever persisted. The basis is a data-entry choice, so it
 * lives in component state, exactly as the sheet's own dropdown does.
 */
export function ReciprocalPriceInputs({
  locale,
  editable,
  pricePerKg,
  onChangePricePerKg,
  referenceBoard,
  idPrefix,
}: {
  locale: "en" | "ar";
  editable: boolean;
  pricePerKg: string;
  onChangePricePerKg: (value: string) => void;
  referenceBoard: {
    referenceBoardWidthMm: number;
    referenceBoardLengthMm: number;
    thicknessMm: number;
    densityKgM3: number;
  };
  idPrefix: string;
}) {
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  // The sheet ships with BOARD PRICE selected, so that is the basis a person
  // lands on here too.
  const [basis, setBasis] = useState<"BOARD_PRICE" | "PRICE_PER_KG">(
    "BOARD_PRICE",
  );
  const [draft, setDraft] = useState<string | null>(null);

  const derived = deriveStandardRate(
    pricePerKg
      ? { mode: "PRICE_PER_KG", pricePerKg: Number(pricePerKg), referenceBoard }
      : { mode: "BOARD_PRICE", boardPrice: 0, referenceBoard },
  );
  const boardText = pricePerKg ? derived.boardPrice.toFixed(2) : "";
  const entered = draft ?? (basis === "PRICE_PER_KG" ? pricePerKg : boardText);

  const commit = (raw: string) => {
    setDraft(raw);
    if (raw.trim() === "") {
      onChangePricePerKg("");
      return;
    }
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    if (basis === "PRICE_PER_KG") {
      onChangePricePerKg(raw);
      return;
    }
    onChangePricePerKg(
      deriveStandardRate({
        mode: "BOARD_PRICE",
        boardPrice: value,
        referenceBoard,
      }).pricePerKg.toFixed(4),
    );
  };

  const unit = txt("EGP", "ج.م");
  return (
    <div className="standard-rate-calc">
      <label className="standard-rate-field">
        <span>{txt("Rate input type", "نوع السعر المُدخل")}</span>
        <select
          id={`${idPrefix}-basis`}
          aria-label={`${idPrefix} rate input type`}
          disabled={!editable}
          value={basis}
          onChange={(event) => {
            // Re-derive the box from what is stored, so switching basis never
            // carries the other unit's number across.
            setDraft(null);
            setBasis(
              event.target.value === "PRICE_PER_KG"
                ? "PRICE_PER_KG"
                : "BOARD_PRICE",
            );
          }}
        >
          <option value="BOARD_PRICE">{txt("Board price", "سعر اللوح")}</option>
          <option value="PRICE_PER_KG">
            {txt("Price / kg", "سعر الكيلو")}
          </option>
        </select>
      </label>

      <label className="standard-rate-field">
        <span>
          {basis === "BOARD_PRICE"
            ? txt(`Board price (${unit})`, `سعر اللوح (${unit})`)
            : txt(`Price / kg (${unit})`, `سعر الكيلو (${unit})`)}
        </span>
        <input
          id={`${idPrefix}-value`}
          aria-label={`${idPrefix} rate input value`}
          readOnly={!editable}
          type="number"
          min="0"
          step="any"
          value={entered}
          onChange={(event) => {
            commit(event.target.value);
          }}
        />
      </label>

      {/* Calculated, and shown as such -- the sheet's blue/grey cells. */}
      <dl className="standard-rate-derived">
        <dt>
          {basis === "BOARD_PRICE"
            ? txt("Calculated price / kg", "سعر الكيلو المحسوب")
            : txt("Calculated board price", "سعر اللوح المحسوب")}
        </dt>
        <dd>
          {pricePerKg
            ? `${(basis === "BOARD_PRICE"
                ? derived.pricePerKg
                : derived.boardPrice
              ).toFixed(2)} ${unit}`
            : "—"}
        </dd>
        <dt>{txt("Reference board weight", "وزن اللوح المرجعي")}</dt>
        <dd>
          {derived.boardWeightKg.toFixed(3)} {txt("kg", "كجم")}
        </dd>
      </dl>
      <p className="standard-rate-note">
        {`${referenceBoard.referenceBoardWidthMm.toString()}×${referenceBoard.referenceBoardLengthMm.toString()}×${referenceBoard.thicknessMm.toString()} ${txt("mm", "مم")} · ${referenceBoard.densityKgM3.toString()} ${txt("kg/m³", "كجم/م³")}`}
      </p>
    </div>
  );
}

function QuotationAuditTimeline({
  locale,
  quotationId,
  chain,
  events,
  loading,
  chainError,
  auditError,
  retry,
  currentUserId,
}: {
  locale: "en" | "ar";
  quotationId: string;
  chain: Record<string, unknown>[];
  events: Record<string, unknown>[];
  loading: boolean;
  chainError: unknown;
  auditError: unknown;
  retry: () => void;
  currentUserId: string;
}) {
  const orderedEvents = [...events].sort(
    (a, b) => dateValue(a.createdAt) - dateValue(b.createdAt),
  );
  const orderedChain = [...chain].sort(
    (a, b) => dateValue(a.sentAt) - dateValue(b.sentAt),
  );
  return (
    <section className="quotation-audit">
      <ErrorBanner error={chainError ?? auditError} retry={retry} />
      {loading && (
        <div
          className="skeleton-stack"
          aria-label={
            locale === "ar" ? "جار تحميل سجل المراجعة" : "Loading audit trail"
          }
        >
          <span />
          <span />
          <span />
        </div>
      )}
      {!loading && (
        <>
          <div className="section-heading">
            <div>
              <h3>
                {locale === "ar" ? "الأحداث التجارية" : "Business events"}
              </h3>
              <p>
                {locale === "ar"
                  ? "سجل زمني آمن للتغييرات المسجلة على عرض السعر."
                  : "A safe chronological view of recorded quotation changes."}
              </p>
            </div>
          </div>
          {orderedEvents.length > 0 ? (
            <ol className="audit-timeline">
              {orderedEvents.map((event, index) => (
                <li key={str(event.auditEventId ?? index)}>
                  <span className="audit-dot" aria-hidden="true" />
                  <div>
                    <strong>
                      {readableCode(str(event.actionCode), locale)}
                    </strong>
                    <span>
                      {formatMoment(event.createdAt, locale)}
                      {event.actorUserId === currentUserId &&
                        ` · ${locale === "ar" ? "أنت" : "You"}`}
                    </span>
                    {event.reason ? <small>{str(event.reason)}</small> : null}
                    <AuditChangeList event={event} locale={locale} />
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p className="empty-inline">
              {locale === "ar"
                ? "لم تُرجع الخدمة أحداث مراجعة مسجلة لهذا العرض."
                : "No recorded audit events were returned for this quotation."}
            </p>
          )}
          <div className="section-heading quotation-version-heading">
            <div>
              <h3>{locale === "ar" ? "سلسلة الإصدارات" : "Version chain"}</h3>
              <p>
                {locale === "ar"
                  ? "كل إصدار مستقل، مع إبراز الإصدار المفتوح حالياً."
                  : "Each quotation version is independent; the current version is highlighted."}
              </p>
            </div>
          </div>
          <ol className="audit-timeline version-chain">
            {orderedChain.map((version, index) => {
              const current = str(version.quotationId) === quotationId;
              return (
                <li
                  key={str(version.quotationId ?? index)}
                  className={current ? "current" : undefined}
                >
                  <span className="audit-dot" aria-hidden="true" />
                  <div>
                    <strong>{str(version.quoteRef)}</strong>
                    <span>
                      {enumLabel(str(version.statusCode), locale)} ·{" "}
                      {formatMoment(version.sentAt, locale)}
                    </span>
                    {current && (
                      <small>
                        {locale === "ar" ? "الإصدار الحالي" : "Current version"}
                      </small>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}

// Turns a stored priceSnapshot into the handful of lines a salesperson would
// read out to a customer. Anything absent is dropped rather than shown as a
// null — this tab used to print the raw JSON, nulls included.
function pricingFacts(
  snapshot: Record<string, unknown>,
  locale: "en" | "ar",
): { label: string; value: string }[] {
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const facts: { label: string; value: string }[] = [];
  const text = (value: unknown) =>
    typeof value === "string" && value ? value : null;
  const inputs = isObject(snapshot.inputs) ? snapshot.inputs : {};
  const circular = isObject(snapshot.circular) ? snapshot.circular : null;

  const materialClass = text(snapshot.materialClass);
  if (materialClass) {
    const option = MATERIAL_CLASS_OPTIONS.find(
      (entry) => entry.value === materialClass,
    );
    facts.push({
      label: txt("Item type", "نوع البند"),
      value: option ? (locale === "ar" ? option.ar : option.en) : materialClass,
    });
  }
  if (circular) {
    const diameter = text(circular.diameterMm);
    if (diameter)
      facts.push({ label: txt("Diameter", "القطر"), value: `${diameter} mm` });
    const pieces = circular.totalPieces;
    if (typeof pieces === "number")
      facts.push({
        label: txt("Total pieces", "إجمالي القطع"),
        value: String(pieces),
      });
  } else {
    const thickness = text(inputs.thicknessMm);
    const width = text(inputs.widthMm);
    const length = text(inputs.lengthMm);
    if (thickness && width && length)
      facts.push({
        label: txt("Size", "المقاس"),
        value: `${thickness} × ${width} × ${length} mm`,
      });
  }
  const density = text(inputs.densityKgM3);
  if (density)
    facts.push({
      label: txt("Density", "الكثافة"),
      value: `${density} kg/m³`,
    });
  const weight = text(snapshot.calculatedWeightKg);
  if (weight)
    facts.push({
      label: txt("Weight per piece", "وزن القطعة"),
      value: `${weight} kg`,
    });
  const rate = text(snapshot.appliedPricePerKg);
  if (rate) {
    const sourceLabels: Readonly<Record<string, string>> = {
      COMPANY_DEFAULT: txt("company price list", "قائمة أسعار الشركة"),
      QUOTATION_OVERRIDE: txt(
        "a rate set on this quotation",
        "سعر محدد على عرض السعر ده",
      ),
      ITEM_OVERRIDE: txt("a rate set on this item", "سعر محدد على البند ده"),
    };
    const source = sourceLabels[text(snapshot.priceSource) ?? ""];
    facts.push({
      label: txt("Rate applied", "السعر المطبق"),
      value: source ? `${rate} / kg — ${source}` : `${rate} / kg`,
    });
  }
  const reference = text(snapshot.reference);
  if (reference)
    facts.push({ label: txt("Reference", "المرجع"), value: reference });
  const cadMark = text(snapshot.cadMark);
  if (cadMark)
    facts.push({ label: txt("CAD mark", "رمز CAD"), value: cadMark });
  return facts;
}

function formatValidity(from: unknown, to: unknown, locale: "en" | "ar") {
  const separator = locale === "ar" ? " إلى " : " to ";
  const start = formatDate(from, locale);
  const end = formatDate(to, locale);
  if (start === "—" && end === "—") return "—";
  return `${start}${separator}${end}`;
}

function formatDate(value: unknown, locale: "en" | "ar") {
  if (typeof value !== "string" || !value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
  }).format(date);
}

// "Monday, August 31, 2026" — the long form used on the ACROW quotation
// template's date line, so the on-screen quote reads like the document the
// customer receives.
function formatLongDate(value: unknown, locale: "en" | "ar") {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(date);
}

function formatMoment(value: unknown, locale: "en" | "ar") {
  if (typeof value !== "string" || !value)
    return locale === "ar" ? "لم يُرسل بعد" : "Not sent yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function dateValue(value: unknown) {
  if (typeof value !== "string") return Number.MAX_SAFE_INTEGER;
  const date = new Date(value).getTime();
  return Number.isNaN(date) ? Number.MAX_SAFE_INTEGER : date;
}

/**
 * What actually changed, not a dump of the snapshot.
 *
 * The trail used to print the after-state's raw field names -- statusCode,
 * rowVersion, totalAmount -- and only the new value, so a reader saw
 * "totalAmount: 1400000.00" with nothing to compare it against. Now that the
 * before-state is recorded, each field is shown as a movement, and rowVersion
 * is dropped: it is plumbing, and it changes on every single event.
 */
const AUDIT_FIELD_LABELS: Record<string, { en: string; ar: string }> = {
  statusCode: { en: "Status", ar: "الحالة" },
  totalAmount: { en: "Total", ar: "الإجمالي" },
};

/** A money snapshot is stored at full precision; nobody reads 15832.9584. */
function auditValue(field: string, value: unknown, locale: "en" | "ar") {
  if (field === "totalAmount" && value !== null && value !== undefined) {
    const amount = Number(value);
    if (Number.isFinite(amount))
      return amount.toLocaleString(locale === "ar" ? "ar-EG" : "en-GB", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
  }
  // A snapshot value is a scalar by construction; str() keeps that honest
  // rather than letting an object stringify to [object Object].
  return str(value);
}

function AuditChangeList({
  event,
  locale,
}: {
  event: Record<string, unknown>;
  locale: "en" | "ar";
}) {
  const diff = isObject(event.diffJsonb) ? event.diffJsonb : null;
  const after =
    diff && isObject(diff.afterSnapshot) ? diff.afterSnapshot : null;
  if (!after) return null;
  const before =
    diff && isObject(diff.beforeSnapshot) ? diff.beforeSnapshot : null;
  const rows = Object.entries(after)
    .filter(([field]) => field !== "rowVersion")
    .map(([field, value]) => ({
      field,
      label: AUDIT_FIELD_LABELS[field]?.[locale] ?? field,
      from: before?.[field],
      to: value,
    }))
    .filter((row) => row.from === undefined || str(row.from) !== str(row.to));
  if (rows.length === 0) return null;
  return (
    <ul className="audit-diff-list">
      {rows.map((row) => (
        <li key={row.field}>
          <span>{row.label}</span>:{" "}
          {row.from === undefined ? (
            <strong>{auditValue(row.field, row.to, locale)}</strong>
          ) : (
            <>
              <s>{auditValue(row.field, row.from, locale)}</s>{" "}
              <span aria-hidden="true">→</span>{" "}
              <strong>{auditValue(row.field, row.to, locale)}</strong>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

const AUDIT_ACTION_LABELS: Record<string, { en: string; ar: string }> = {
  QUOTATION_CREATED: { en: "Quotation created", ar: "تم إنشاء عرض السعر" },
  QUOTATION_DRAFT_SAVED: { en: "Draft saved", ar: "تم حفظ المسودة" },
  QUOTATION_SUPERSEDED: {
    en: "Superseded by a new version",
    ar: "تم استبداله بإصدار جديد",
  },
  QUOTATION_SENT: { en: "Sent to customer", ar: "تم الإرسال للعميل" },
  QUOTATION_PREPARED: { en: "Document prepared", ar: "تم تجهيز المستند" },
  QUOTATION_APPROVAL_REQUESTED: {
    en: "Approval requested",
    ar: "تم طلب الموافقة",
  },
  QUOTATION_APPROVED: { en: "Approved", ar: "تمت الموافقة" },
  QUOTATION_REJECTED: { en: "Rejected", ar: "تم الرفض" },
};
function readableCode(value: string, locale: "en" | "ar") {
  const known = AUDIT_ACTION_LABELS[value];
  if (known) return locale === "ar" ? known.ar : known.en;
  return value
    .replaceAll("_", " ")
    .toLowerCase()
    .replace(/^./, (letter) => letter.toUpperCase());
}

function nestedData(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  return isObject(value.data) ? value.data : value;
}

/**
 * Incoterm-driven shipping.
 *
 * DDP means we deliver to the customer's site, so the site address is what the
 * document must carry. CIF means we ship to the customer's port, so the port of
 * discharge is. FOB means the customer takes over at ours, so the port of
 * loading is. Only the field the term actually calls for is asked for; the
 * other two stay stored, so switching the term back does not lose typing.
 */
function shippingLabel(incoterm: string, locale: "en" | "ar") {
  if (incoterm === "DDP") {
    return locale === "ar" ? "عنوان التسليم" : "Delivery address";
  }
  if (incoterm === "CIF") {
    return locale === "ar" ? "ميناء الوصول" : "Port of discharge";
  }
  return locale === "ar" ? "ميناء الشحن" : "Port of loading";
}

function shippingHint(incoterm: string, locale: "en" | "ar") {
  if (incoterm === "DDP") {
    return locale === "ar"
      ? "التسليم على مسؤوليتنا حتى موقع العميل، فالعنوان الكامل هو ما يظهر في المستند."
      : "We deliver to the customer's site, so the full site address is what appears on the document.";
  }
  if (incoterm === "CIF") {
    return locale === "ar"
      ? "الشحن والتأمين على مسؤوليتنا حتى ميناء العميل."
      : "We carry freight and insurance to the customer's port.";
  }
  return locale === "ar"
    ? "العميل يتسلم من ميناء الشحن في مصر."
    : "The customer takes over at the Egyptian port of loading.";
}

function shippingPlaceholder(incoterm: string, locale: "en" | "ar") {
  if (incoterm === "DDP") {
    return locale === "ar" ? "اسم الموقع والعنوان" : "Site name and address";
  }
  if (incoterm === "CIF") {
    return locale === "ar" ? "مثال: Jebel Ali" : "e.g. Jebel Ali";
  }
  return locale === "ar" ? "مثال: الإسكندرية" : "e.g. Alexandria";
}

function shippingValue(header: {
  incotermCode: string;
  deliveryAddress: string;
  portOfLoading: string;
  portOfDischarge: string;
}) {
  if (header.incotermCode === "DDP") return header.deliveryAddress;
  if (header.incotermCode === "CIF") return header.portOfDischarge;
  return header.portOfLoading;
}

function shippingPatch(incoterm: string, value: string) {
  if (incoterm === "DDP") return { deliveryAddress: value };
  if (incoterm === "CIF") return { portOfDischarge: value };
  return { portOfLoading: value };
}
