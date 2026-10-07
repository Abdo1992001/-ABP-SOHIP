import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, LoadingSkeleton, PageHeader } from "./CommercialUI.tsx";

/**
 * Can the factory make this, and by when.
 *
 * The screen this replaces was a list of saved estimates with no way to make
 * one — and there were none, so it read "No estimates yet" permanently. Its
 * own registry entry has always declared `post_capacity_estimates`, which
 * nothing called. A list of results from a calculator nobody can run is not a
 * screen, it is a table waiting for a screen.
 *
 * The estimate itself is computed server-side against the production rates an
 * administrator maintains, and saved with the rate it used. That snapshot is
 * the point: a delivery date promised in March has to stay defensible in June,
 * after somebody has changed the rate.
 */

const CATEGORIES = [
  { code: "STANDARD", en: "Standard", ar: "ستاندرد" },
  { code: "ORDINARY", en: "Ordinary", ar: "عادي" },
  { code: "CURVED", en: "Curved", ar: "منحني" },
] as const;

interface EstimateItem {
  categoryCode: string;
  quantityBoards: string;
  rateBoardsPerDaySnapshot: string;
  requiredDaysDecimal: string;
  durationHours: string;
  estimatedFinishAt: string | null;
}

interface Estimate {
  capacityEstimateId: string;
  startAt: string | null;
  estimatedFinishAt: string | null;
  items: EstimateItem[];
  createdAt: string;
}

function toEstimate(payload: unknown): Estimate | null {
  if (!isObject(payload)) return null;
  const body = isObject(payload.data) ? payload.data : payload;
  if (!Array.isArray(body.items)) return null;
  return {
    capacityEstimateId: str(body.capacityEstimateId),
    startAt: typeof body.startAt === "string" ? body.startAt : null,
    estimatedFinishAt:
      typeof body.estimatedFinishAt === "string"
        ? body.estimatedFinishAt
        : null,
    createdAt: str(body.createdAt),
    items: body.items.filter(isObject).map((item) => ({
      categoryCode: str(item.categoryCode),
      quantityBoards: str(item.quantityBoards),
      rateBoardsPerDaySnapshot: str(item.rateBoardsPerDaySnapshot),
      requiredDaysDecimal: str(item.requiredDaysDecimal),
      durationHours: str(item.durationHours),
      estimatedFinishAt:
        typeof item.estimatedFinishAt === "string"
          ? item.estimatedFinishAt
          : null,
    })),
  };
}

/** Latin digits, so a promised date can be read out over a phone. */
const num = (value: string, digits = 1) => {
  const parsed = Number(value);
  return Number.isNaN(parsed)
    ? "—"
    : parsed.toLocaleString("en", { maximumFractionDigits: digits });
};

export function CapacityPlannerPage({
  client,
  me,
}: {
  client: ApiClient;
  me: Me;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const cache = useQueryClient();
  const canEstimate = me.access.permissions.includes("capacity.estimate");

  const [quantities, setQuantities] = useState<Record<string, string>>({
    STANDARD: "",
    ORDINARY: "",
    CURVED: "",
  });
  const [startAt, setStartAt] = useState("");

  const rates = useQuery({
    queryKey: ["capacity-rates"],
    queryFn: () =>
      commercialRequest(client, "GET", "/capacity/rates", {
        path: {},
        query: { page: 1, limit: 50 },
      }),
  });

  const saved = useQuery({
    queryKey: ["capacity-estimates"],
    queryFn: () =>
      commercialRequest(client, "GET", "/capacity/estimates", {
        path: {},
        query: { page: 1, limit: 10 },
      }),
  });

  const entered = CATEGORIES.filter(
    (category) => Number(quantities[category.code] ?? "") > 0,
  );

  const estimate = useMutation({
    mutationFn: async () => {
      const result = await commercialRequest(
        client,
        "POST",
        "/capacity/estimates",
        {
          path: {},
          body: {
            sourceTypeCode: "MANUAL",
            ...(startAt === "" ? {} : { startAt: `${startAt}T08:00:00.000Z` }),
            items: entered.map((category) => ({
              categoryCode: category.code,
              quantityBoards: String(Number(quantities[category.code])),
            })),
          },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return toEstimate(result.data);
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: ["capacity-estimates"] });
    },
  });

  const result = estimate.data ?? null;

  const rateRows = Array.isArray(rates.data?.data)
    ? rates.data.data.filter(isObject)
    : isObject(rates.data?.data) && Array.isArray(rates.data.data.data)
      ? rates.data.data.data.filter(isObject)
      : [];

  const savedRows =
    isObject(saved.data?.data) && Array.isArray(saved.data.data.data)
      ? saved.data.data.data.filter(isObject)
      : [];

  const when = (iso: string | null) => {
    if (iso === null) return "—";
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
    }).format(date);
  };

  if (rates.isLoading) return <LoadingSkeleton rows={3} variant="cards" />;

  return (
    <section className="workspace-page capacity-page">
      <PageHeader
        kicker={txt("Operations", "التشغيل")}
        title={txt("Capacity", "الطاقة الإنتاجية")}
      />

      <ErrorBanner error={rates.error} retry={() => void rates.refetch()} />
      <ErrorBanner
        error={estimate.error}
        retry={() => {
          estimate.reset();
        }}
      />

      {/* The rates first, because they are what the answer will be computed
          from. An estimate whose inputs are off-screen is a number to argue
          with rather than a number to rely on. */}
      <h2 className="settings-section-title">
        {txt("Production rates in force", "معدلات الإنتاج السارية")}
      </h2>
      {rateRows.length === 0 ? (
        <p className="today-empty">
          {txt(
            "No production rates are configured, so nothing can be estimated. An administrator sets these under Capacity administration.",
            "مفيش معدلات إنتاج متظبّطة، فمفيش حاجة تتقدّر. المسؤول بيحطها من إدارة الطاقة.",
          )}
        </p>
      ) : (
        <dl className="capacity-rates">
          {rateRows.map((rate) => (
            <div key={str(rate.capacityRateId)}>
              <dt>{enumLabel(str(rate.categoryCode), locale)}</dt>
              <dd data-abp-num>
                {num(str(rate.boardsPerDay), 0)}{" "}
                <small>{txt("boards / day", "لوح / يوم")}</small>
              </dd>
            </div>
          ))}
        </dl>
      )}

      {canEstimate && rateRows.length > 0 && (
        <>
          <h2 className="settings-section-title">
            {txt("Estimate a job", "قدّر شغلانة")}
          </h2>
          <form
            className="capacity-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!estimate.isPending && entered.length > 0) estimate.mutate();
            }}
          >
            {CATEGORIES.map((category) => (
              <label className="settings-field" key={category.code}>
                {txt(`${category.en} boards`, `ألواح ${category.ar}`)}
                <input
                  inputMode="numeric"
                  value={quantities[category.code] ?? ""}
                  onChange={(event) => {
                    setQuantities((current) => ({
                      ...current,
                      [category.code]: event.target.value,
                    }));
                  }}
                />
              </label>
            ))}
            <label className="settings-field">
              {txt("Starting on (optional)", "يبدأ يوم (اختياري)")}
              <input
                type="date"
                value={startAt}
                onChange={(event) => {
                  setStartAt(event.target.value);
                }}
              />
              <small>
                {txt(
                  "Give a start date to get a finish date rather than only a duration.",
                  "حط تاريخ بداية عشان تاخد تاريخ انتهاء مش بس مدة.",
                )}
              </small>
            </label>
            <button
              type="submit"
              className="primary"
              disabled={estimate.isPending || entered.length === 0}
            >
              {estimate.isPending
                ? txt("Estimating…", "بيحسب…")
                : txt("Estimate", "احسب")}
            </button>
          </form>
        </>
      )}

      {result !== null && (
        <>
          <h2 className="settings-section-title">{txt("Result", "النتيجة")}</h2>
          <div className="capacity-result">
            {result.items.map((item) => (
              <div className="capacity-result-row" key={item.categoryCode}>
                <strong>{enumLabel(item.categoryCode, locale)}</strong>
                <span data-abp-num>
                  {num(item.quantityBoards, 0)} {txt("boards", "لوح")}
                </span>
                <span data-abp-num>
                  {num(item.requiredDaysDecimal)} {txt("days", "يوم")}
                </span>
                <span data-abp-num>
                  {num(item.durationHours)} {txt("hours", "ساعة")}
                </span>
                {/* The rate this line was computed with, saved alongside it —
                    so the estimate stays readable after the rate changes. */}
                <span className="capacity-rate-used" data-abp-num>
                  {txt("at", "بمعدل")} {num(item.rateBoardsPerDaySnapshot, 0)}/
                  {txt("day", "يوم")}
                </span>
                {item.estimatedFinishAt !== null && (
                  <span className="capacity-finish">
                    {txt("finishes", "بتخلص")} {when(item.estimatedFinishAt)}
                  </span>
                )}
              </div>
            ))}
            {result.estimatedFinishAt !== null && (
              <p className="capacity-headline">
                {txt("Ready by", "جاهزة يوم")}{" "}
                <strong>{when(result.estimatedFinishAt)}</strong>
              </p>
            )}
            {result.startAt === null && (
              <p className="settings-hint">
                {txt(
                  "No start date was given, so this is a duration, not a promise of a date.",
                  "مفيش تاريخ بداية، فدي مدة مش وعد بتاريخ.",
                )}
              </p>
            )}
          </div>
        </>
      )}

      {savedRows.length > 0 && (
        <>
          <h2 className="settings-section-title">
            {txt("Earlier estimates", "تقديرات سابقة")}
          </h2>
          <ul className="capacity-saved">
            {savedRows.map((row) => {
              // A saved row is a run, and its figures are inside `items` —
              // reading `categoryCode` or `requestedBoards` off the run
              // itself returns nothing, which is how this list would have
              // rendered a column of dashes.
              const items = Array.isArray(row.items)
                ? row.items.filter(isObject)
                : [];
              const boards = items.reduce(
                (sum, item) => sum + Number(str(item.quantityBoards) || 0),
                0,
              );
              const days = items.reduce(
                (longest, item) =>
                  Math.max(longest, Number(str(item.requiredDaysDecimal) || 0)),
                0,
              );
              return (
                <li key={str(row.capacityEstimateId)}>
                  <span>
                    {items
                      .map((item) => enumLabel(str(item.categoryCode), locale))
                      .join(" · ") || "—"}
                  </span>
                  <span data-abp-num>
                    {num(String(boards), 0)} {txt("boards", "لوح")}
                  </span>
                  {/* The longest line, not the sum: the categories are made
                      in parallel, so adding their days would overstate it. */}
                  <span data-abp-num>
                    {num(String(days))} {txt("days", "يوم")}
                  </span>
                  <span className="capacity-when">
                    {when(str(row.createdAt))}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
