import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner, ScreenIntro } from "./CommercialUI.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ReciprocalPriceInputs } from "./QuotationStudio.tsx";

// Company-wide pricing defaults (SETTINGS tab of the ACROW BOARD sheet):
// Standard rate (board price <-> price/kg, reciprocal via the reference
// board), Curved/Circular rate, reference board footprint, and the default
// discount %. The backend (/pricing/standard-board-basis) has supported all
// of this since the pricing-hierarchy work; this page is the first admin UI
// for it — previously only editable by hand in the database.
export function PricingSettingsPage({
  client,
  me,
}: {
  client: ApiClient;
  me: Me;
}) {
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const canManage =
    me.access.permissions.includes("pricing.policy.manage") ||
    me.access.permissions.includes("pricing.manage");

  const basis = useQuery({
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
  const data =
    isObject(basis.data?.data) && isObject(basis.data.data.data)
      ? basis.data.data.data
      : {};

  const [standardPricePerKg, setStandardPricePerKg] = useState("");
  const [curvedPricePerKg, setCurvedPricePerKg] = useState("");
  const [circularPricePerKg, setCircularPricePerKg] = useState("");
  const [defaultDensityKgM3, setDefaultDensityKgM3] = useState("");
  const [defaultThicknessMm, setDefaultThicknessMm] = useState("");
  const [referenceBoardWidthMm, setReferenceBoardWidthMm] = useState("");
  const [referenceBoardLengthMm, setReferenceBoardLengthMm] = useState("");
  const [defaultDiscountPct, setDefaultDiscountPct] = useState("");
  const [maxPanelWidthMm, setMaxPanelWidthMm] = useState("");
  const [maxPanelLengthMm, setMaxPanelLengthMm] = useState("");
  const [defaultColumnHeightMm, setDefaultColumnHeightMm] = useState("");
  const [columnClosureAllowanceMm, setColumnClosureAllowanceMm] = useState("");
  // The three boxes on every issued document that are the company's and not
  // the writer's: a policy, a yard address and a wording.
  const [documentDeliveryTerms, setDocumentDeliveryTerms] = useState("");
  const [documentDeliveryPoint, setDocumentDeliveryPoint] = useState("");
  const [documentOfferValidity, setDocumentOfferValidity] = useState("");
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    if (hydrated || !basis.data) return;
    setStandardPricePerKg(str(data.standardPricePerKg ?? ""));
    setCurvedPricePerKg(str(data.curvedPricePerKg ?? ""));
    setCircularPricePerKg(str(data.circularPricePerKg ?? ""));
    setDefaultDensityKgM3(str(data.defaultDensityKgM3 ?? ""));
    setDefaultThicknessMm(str(data.defaultThicknessMm ?? ""));
    setReferenceBoardWidthMm(str(data.referenceBoardWidthMm ?? ""));
    setReferenceBoardLengthMm(str(data.referenceBoardLengthMm ?? ""));
    setDefaultDiscountPct(str(data.defaultDiscountPct ?? ""));
    setMaxPanelWidthMm(str(data.maxPanelWidthMm ?? ""));
    setMaxPanelLengthMm(str(data.maxPanelLengthMm ?? ""));
    setDefaultColumnHeightMm(str(data.defaultColumnHeightMm ?? ""));
    setColumnClosureAllowanceMm(str(data.columnClosureAllowanceMm ?? ""));
    setDocumentDeliveryTerms(str(data.documentDeliveryTerms ?? ""));
    setDocumentDeliveryPoint(str(data.documentDeliveryPoint ?? ""));
    setDocumentOfferValidity(str(data.documentOfferValidity ?? ""));
    setHydrated(true);
  }, [basis.data]);

  const save = useMutation({
    mutationFn: () =>
      commercialRequest(client, "POST", "/pricing/standard-board-basis", {
        path: {},
        idempotencyKey: crypto.randomUUID(),
        body: {
          standardPricePerKg: standardPricePerKg || null,
          curvedPricePerKg: curvedPricePerKg || null,
          circularPricePerKg: circularPricePerKg || null,
          defaultDensityKgM3: defaultDensityKgM3 || null,
          defaultThicknessMm: defaultThicknessMm || null,
          referenceBoardWidthMm: referenceBoardWidthMm || null,
          referenceBoardLengthMm: referenceBoardLengthMm || null,
          defaultDiscountPct: defaultDiscountPct || null,
          maxPanelWidthMm: maxPanelWidthMm || null,
          maxPanelLengthMm: maxPanelLengthMm || null,
          defaultColumnHeightMm: defaultColumnHeightMm || null,
          columnClosureAllowanceMm: columnClosureAllowanceMm || null,
          documentDeliveryTerms: documentDeliveryTerms || null,
          documentDeliveryPoint: documentDeliveryPoint || null,
          documentOfferValidity: documentOfferValidity || null,
        },
      }),
    onSuccess: async () => {
      setHydrated(false);
      await queryClient.invalidateQueries({
        queryKey: ["pricing-standard-board-basis"],
      });
    },
  });

  const referenceBoard = {
    referenceBoardWidthMm: Number(referenceBoardWidthMm || 1220),
    referenceBoardLengthMm: Number(referenceBoardLengthMm || 2440),
    thicknessMm: Number(defaultThicknessMm || 18),
    densityKgM3: Number(defaultDensityKgM3 || 720),
  };

  return (
    <section className="workspace-page pricing-settings-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {locale === "ar"
              ? "الإدارة · إعدادات التسعير"
              : "Administration · Pricing settings"}
          </span>
          <h1>
            {locale === "ar"
              ? "إعدادات تسعير الشركة"
              : "Company pricing settings"}
          </h1>
          <p>
            {locale === "ar"
              ? "الأسعار الافتراضية اللي كل عرض سعر جديد بيبدأ بيها، إلا لو اتعمله تجاوز على مستوى عرض السعر أو البند."
              : "The defaults every new quotation starts from, unless overridden at the quotation or item level."}
          </p>
        </div>
      </header>
      <ScreenIntro />

      <ErrorBanner error={basis.error} retry={() => void basis.refetch()} />
      {!canManage && (
        <div className="panel data-surface">
          <p>
            {locale === "ar"
              ? "بتقدر تشوف الإعدادات دي بس، مش تعدلها — محتاج صلاحية pricing.manage."
              : "You can view these settings but not edit them — pricing.manage permission required."}
          </p>
        </div>
      )}

      {basis.data && (
        <div className="panel data-surface pricing-settings-form">
          <section className="pricing-overrides-section">
            <h3 className="pricing-overrides-title">
              {locale === "ar"
                ? "سعر Standard / Regular"
                : "Standard / Regular rate"}
            </h3>
            <p className="pricing-overrides-hint">
              {locale === "ar"
                ? "دخّل سعر الكيلو أو سعر اللوح الكامل — التاني بيتحسب تلقائي."
                : "Enter either price/kg or the full board price — the other is derived automatically."}
            </p>
            <ReciprocalPriceInputs
              locale={locale}
              editable={canManage}
              pricePerKg={standardPricePerKg}
              onChangePricePerKg={setStandardPricePerKg}
              referenceBoard={referenceBoard}
              idPrefix="settings-standard"
            />
          </section>

          {/* Curved and circular are quoted the same two ways standard is:
              by the kilogram or by the full board. Which one someone types is
              a habit, not a different price -- the board price is converted
              against the same reference board and only the rate is stored. */}
          <section
            className="pricing-overrides-section"
            style={{ marginTop: 20 }}
          >
            <h3 className="pricing-overrides-title">
              {locale === "ar" ? "سعر Curved" : "Curved rate"}
            </h3>
            <ReciprocalPriceInputs
              locale={locale}
              editable={canManage}
              pricePerKg={curvedPricePerKg}
              onChangePricePerKg={setCurvedPricePerKg}
              referenceBoard={referenceBoard}
              idPrefix="settings-curved"
            />
          </section>

          <section
            className="pricing-overrides-section"
            style={{ marginTop: 20 }}
          >
            <h3 className="pricing-overrides-title">
              {locale === "ar" ? "سعر Circular" : "Circular rate"}
            </h3>
            <p className="pricing-overrides-hint">
              {locale === "ar"
                ? "الدائري بينتمي تجاريًا لعيلة Curved، بس ليه سعره المستقل."
                : "Circular belongs to the curved family commercially, but carries its own rate."}
            </p>
            <ReciprocalPriceInputs
              locale={locale}
              editable={canManage}
              pricePerKg={circularPricePerKg}
              onChangePricePerKg={setCircularPricePerKg}
              referenceBoard={referenceBoard}
              idPrefix="settings-circular"
            />
          </section>

          <div className="pricing-overrides-grid" style={{ marginTop: 20 }}>
            <label className="pricing-overrides-field">
              <span className="pricing-overrides-label">
                {locale === "ar"
                  ? "الكثافة الافتراضية (كجم/م³)"
                  : "Default density (kg/m³)"}
              </span>
              <input
                readOnly={!canManage}
                type="number"
                min="0"
                step="any"
                value={defaultDensityKgM3}
                onChange={(event) => {
                  setDefaultDensityKgM3(event.target.value);
                }}
              />
            </label>
            <label className="pricing-overrides-field">
              <span className="pricing-overrides-label">
                {locale === "ar"
                  ? "السمك الافتراضي (مم)"
                  : "Default thickness (mm)"}
              </span>
              <input
                readOnly={!canManage}
                type="number"
                min="0"
                step="any"
                value={defaultThicknessMm}
                onChange={(event) => {
                  setDefaultThicknessMm(event.target.value);
                }}
              />
            </label>
            <label className="pricing-overrides-field">
              <span className="pricing-overrides-label">
                {locale === "ar"
                  ? "عرض اللوح المرجعي (مم)"
                  : "Reference board width (mm)"}
              </span>
              <input
                readOnly={!canManage}
                type="number"
                min="0"
                step="any"
                value={referenceBoardWidthMm}
                onChange={(event) => {
                  setReferenceBoardWidthMm(event.target.value);
                }}
              />
            </label>
            <label className="pricing-overrides-field">
              <span className="pricing-overrides-label">
                {locale === "ar"
                  ? "طول اللوح المرجعي (مم)"
                  : "Reference board length (mm)"}
              </span>
              <input
                readOnly={!canManage}
                type="number"
                min="0"
                step="any"
                value={referenceBoardLengthMm}
                onChange={(event) => {
                  setReferenceBoardLengthMm(event.target.value);
                }}
              />
            </label>
            <label className="pricing-overrides-field">
              <span className="pricing-overrides-label">
                {locale === "ar"
                  ? "نسبة الخصم الافتراضية (%)"
                  : "Default discount (%)"}
              </span>
              <input
                readOnly={!canManage}
                type="number"
                min="0"
                max="100"
                step="any"
                value={defaultDiscountPct}
                onChange={(event) => {
                  setDefaultDiscountPct(event.target.value);
                }}
              />
            </label>
          </div>

          {/* The takeoff rules. The closure allowance is the one that moves
              money: it makes a rectangular column's faces
              A / B / A+allowance / B+allowance, because the two closing panels
              lap the thickness of their neighbours. */}
          <section
            className="pricing-overrides-section"
            style={{ marginTop: 20 }}
          >
            <h3 className="pricing-overrides-title">
              {locale === "ar" ? "قواعد الحصر" : "Takeoff rules"}
            </h3>
            <p className="pricing-overrides-hint">
              {locale === "ar"
                ? "العمود المستطيل A × B بيتقطع A / B / A+السماح / B+السماح، لأن اللوحين اللي بيقفلوا بيركبوا على سُمك جيرانهم."
                : "A rectangular column of A × B is cut as A / B / A+allowance / B+allowance — the two closing panels lap the thickness of their neighbours."}
            </p>
            <div className="pricing-overrides-grid">
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar"
                    ? "أقصى عرض للوح (مم)"
                    : "Max panel width (mm)"}
                </span>
                <input
                  readOnly={!canManage}
                  type="number"
                  min="0"
                  step="any"
                  value={maxPanelWidthMm}
                  onChange={(event) => {
                    setMaxPanelWidthMm(event.target.value);
                  }}
                />
              </label>
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar"
                    ? "أقصى طول للوح (مم)"
                    : "Max panel length (mm)"}
                </span>
                <input
                  readOnly={!canManage}
                  type="number"
                  min="0"
                  step="any"
                  value={maxPanelLengthMm}
                  onChange={(event) => {
                    setMaxPanelLengthMm(event.target.value);
                  }}
                />
              </label>
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar"
                    ? "ارتفاع العمود / الكور / الحائط (مم)"
                    : "Column / core / wall height (mm)"}
                </span>
                <input
                  readOnly={!canManage}
                  type="number"
                  min="0"
                  step="any"
                  value={defaultColumnHeightMm}
                  onChange={(event) => {
                    setDefaultColumnHeightMm(event.target.value);
                  }}
                />
              </label>
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar"
                    ? "سماح غلق العمود المستطيل (مم)"
                    : "Regular column closure allowance (mm)"}
                </span>
                <input
                  readOnly={!canManage}
                  type="number"
                  min="0"
                  step="any"
                  value={columnClosureAllowanceMm}
                  onChange={(event) => {
                    setColumnClosureAllowanceMm(event.target.value);
                  }}
                />
              </label>
            </div>
          </section>

          {/* What every issued document says in these three boxes. They
              were seeded once and had no screen, so changing a delivery point
              meant an UPDATE against the live database. The sales engineer and
              the mobile are not here on purpose: a customer with a question
              rings the person whose name is on the quotation, so both come
              from that person's own profile. */}
          <section
            className="pricing-overrides-section"
            style={{ marginTop: 20 }}
          >
            <h3 className="pricing-overrides-title">
              {locale === "ar" ? "نصوص المستندات" : "Document wording"}
            </h3>
            <p className="pricing-overrides-hint">
              {locale === "ar"
                ? "بتُطبع على كل عرض سعر وكل فاتورة أولية بتخرج من الشركة. اسم مهندس المبيعات ورقمه مش هنا — بيتقروا من بروفايل صاحب العرض نفسه."
                : "Printed on every quotation and proforma the company issues. The sales engineer's name and number are not here — they are read from the profile of whoever wrote the quotation."}
            </p>
            <div className="pricing-overrides-grid">
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar" ? "شروط التسليم" : "Delivery"}
                </span>
                <input
                  readOnly={!canManage}
                  maxLength={500}
                  value={documentDeliveryTerms}
                  onChange={(event) => {
                    setDocumentDeliveryTerms(event.target.value);
                  }}
                />
              </label>
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar" ? "مكان التسليم" : "Delivery point"}
                </span>
                <input
                  readOnly={!canManage}
                  maxLength={500}
                  value={documentDeliveryPoint}
                  onChange={(event) => {
                    setDocumentDeliveryPoint(event.target.value);
                  }}
                />
              </label>
              <label className="pricing-overrides-field">
                <span className="pricing-overrides-label">
                  {locale === "ar" ? "مدة سريان العرض" : "Offer validity"}
                </span>
                <input
                  readOnly={!canManage}
                  maxLength={200}
                  value={documentOfferValidity}
                  onChange={(event) => {
                    setDocumentOfferValidity(event.target.value);
                  }}
                />
              </label>
            </div>
          </section>

          <ErrorBanner
            error={save.error}
            retry={() => {
              save.mutate();
            }}
          />
          {canManage && (
            <div className="wizard-actions">
              <button
                type="button"
                className="primary"
                disabled={save.isPending}
                onClick={() => {
                  save.mutate();
                }}
              >
                {save.isPending
                  ? "…"
                  : locale === "ar"
                    ? "حفظ الإعدادات"
                    : "Save settings"}
              </button>
              {save.isSuccess && (
                <span className="pricing-settings-saved">
                  {locale === "ar" ? "تم الحفظ ✓" : "Saved ✓"}
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
