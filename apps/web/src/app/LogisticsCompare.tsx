import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import { ErrorBanner, useToast } from "./CommercialUI.tsx";

/**
 * Two ways to load the same cargo, side by side.
 *
 * `POST /logistics/compare` has always been able to answer "which of these
 * plans uses fewer vehicles, carries more, and has fewer problems" — and
 * nothing called it. It could not have been demonstrated either: comparison
 * needs two versions and there was no way to make a second one, because
 * `POST /logistics/plans/{planId}/versions` was equally unwired.
 *
 * The two go together, and the endpoint says how: a version is created by
 * cloning an existing one (`cloneFromVersionId`). So the workflow is take what
 * you have, try it another way, and let the server tell you which is better —
 * rather than rearranging the only copy and losing the comparison.
 */

interface VersionResult {
  planVersionId: string;
  vehicleCount: number;
  loadedQty: string;
  remainingQty: string;
  totalWeightKg: string;
  hardErrorCount: number;
  warningCount: number;
}

function toResult(row: Record<string, unknown>): VersionResult {
  const int = (value: unknown) => (typeof value === "number" ? value : 0);
  return {
    planVersionId: str(row.planVersionId),
    vehicleCount: int(row.vehicleCount),
    loadedQty: str(row.loadedQty),
    remainingQty: str(row.remainingQty),
    totalWeightKg: str(row.totalWeightKg),
    hardErrorCount: int(row.hardErrorCount),
    warningCount: int(row.warningCount),
  };
}

/** Latin digits, lined up, because these are read as a comparison. */
const num = (value: string | number, digits = 0) => {
  const parsed = Number(value);
  return Number.isNaN(parsed)
    ? "—"
    : parsed.toLocaleString("en", { maximumFractionDigits: digits });
};

export function LogisticsCompare({
  client,
  me,
  planId,
  versions,
  currentVersionId,
  onChanged,
}: {
  client: ApiClient;
  me: Me;
  planId: string;
  versions: { planVersionId: string; versionNo: string; statusCode: string }[];
  currentVersionId: string;
  onChanged: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();
  const canEdit = me.access.permissions.includes("logistics.edit");

  const [selected, setSelected] = useState<string[]>([]);

  const clone = useMutation({
    mutationFn: (notes: string) =>
      commercialRequest(client, "POST", "/logistics/plans/{planId}/versions", {
        path: { planId },
        body: { cloneFromVersionId: currentVersionId, notes },
        idempotencyKey: crypto.randomUUID(),
      }),
    onSuccess: async () => {
      await cache.invalidateQueries({
        queryKey: ["logistics-planner", planId],
      });
      onChanged();
      toast.success(
        txt(
          "A copy was made. Rearrange it, then compare.",
          "اتعملت نسخة. رتّبها، وبعدين قارن.",
        ),
      );
    },
  });

  const compare = useMutation({
    mutationFn: async () => {
      const result = await commercialRequest(
        client,
        "POST",
        "/logistics/compare",
        {
          path: {},
          body: { planVersionIds: selected },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      const body =
        isObject(result.data) && isObject(result.data.data)
          ? result.data.data
          : {};
      return Array.isArray(body.versions)
        ? body.versions.filter(isObject).map(toResult)
        : [];
    },
  });

  const results = compare.data ?? [];
  const versionNo = (id: string) =>
    versions.find((v) => v.planVersionId === id)?.versionNo ?? id.slice(0, 8);

  // The recommendation, stated rather than left to the reader: fewest hard
  // errors first, then fewest vehicles. A plan with a blocking error is not
  // cheaper, whatever the truck count says.
  const best =
    results.length < 2
      ? null
      : ([...results].sort(
          (a, b) =>
            a.hardErrorCount - b.hardErrorCount ||
            a.vehicleCount - b.vehicleCount ||
            Number(b.loadedQty) - Number(a.loadedQty),
        )[0] ?? null);

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  return (
    <div className="logistics-compare">
      <p className="settings-hint">
        {txt(
          "Compare two ways of loading the same cargo — vehicles used, how much fits, and what each one breaks.",
          "قارن طريقتين لتحميل نفس البضاعة — عربيات كام، وداخل قد إيه، وكل واحدة بتكسر إيه.",
        )}
      </p>

      <ErrorBanner
        error={clone.error ?? compare.error}
        retry={() => {
          clone.reset();
          compare.reset();
        }}
      />

      {versions.length < 2 ? (
        <>
          <p className="today-empty">
            {txt(
              "There is only one version of this plan, so there is nothing to compare it with yet.",
              "فيه نسخة واحدة بس من الخطة دي، فمفيش حاجة تتقارن بيها لسه.",
            )}
          </p>
          {canEdit && currentVersionId !== "" && (
            <button
              type="button"
              className="secondary"
              disabled={clone.isPending}
              onClick={() => {
                clone.mutate(txt("Alternative arrangement", "ترتيب بديل"));
              }}
            >
              {clone.isPending
                ? txt("Copying…", "بينسخ…")
                : txt("Try it another way", "جرّب طريقة تانية")}
            </button>
          )}
        </>
      ) : (
        <>
          <fieldset className="compare-picker">
            <legend>{txt("Pick two or more", "اختار اتنين أو أكتر")}</legend>
            {versions.map((version) => (
              <label key={version.planVersionId} className="access-option">
                <input
                  type="checkbox"
                  checked={selected.includes(version.planVersionId)}
                  onChange={() => {
                    toggle(version.planVersionId);
                  }}
                />
                <span>
                  {txt("Version", "نسخة")} {version.versionNo}
                  {version.planVersionId === currentVersionId
                    ? ` · ${txt("open now", "المفتوحة دلوقتي")}`
                    : ""}
                </span>
              </label>
            ))}
          </fieldset>

          <div className="approval-actions">
            <button
              type="button"
              className="primary"
              disabled={compare.isPending || selected.length < 2}
              onClick={() => {
                compare.mutate();
              }}
            >
              {compare.isPending
                ? txt("Comparing…", "بيقارن…")
                : txt("Compare", "قارن")}
            </button>
            {canEdit && (
              <button
                type="button"
                className="ghost-button"
                disabled={clone.isPending}
                onClick={() => {
                  clone.mutate(txt("Alternative arrangement", "ترتيب بديل"));
                }}
              >
                {txt("Add another way", "ضيف طريقة تانية")}
              </button>
            )}
          </div>

          {selected.length < 2 && (
            <p className="settings-hint">
              {txt(
                "Two is the minimum — a comparison of one is just the plan.",
                "اتنين هو الحد الأدنى — مقارنة واحد دي مجرد الخطة نفسها.",
              )}
            </p>
          )}
        </>
      )}

      {results.length > 0 && (
        <>
          {best !== null && (
            <p className="compare-verdict">
              {txt(
                `Version ${versionNo(best.planVersionId)} is the one to take: ${
                  best.hardErrorCount === 0
                    ? "no blocking problems"
                    : `${String(best.hardErrorCount)} blocking problems, fewest of any`
                }, ${String(best.vehicleCount)} vehicles.`,
                `نسخة ${versionNo(best.planVersionId)} هي اللي تاخدها: ${
                  best.hardErrorCount === 0
                    ? "مفيش مشاكل مانعة"
                    : `${String(best.hardErrorCount)} مشكلة مانعة، أقل واحدة`
                }، و${String(best.vehicleCount)} عربية.`,
              )}
            </p>
          )}
          <div className="enterprise-table-scroll">
            <table className="enterprise-table compare-table">
              <thead>
                <tr>
                  <th>{txt("Version", "النسخة")}</th>
                  <th className="numeric">{txt("Vehicles", "عربيات")}</th>
                  <th className="numeric">{txt("Loaded", "محمّل")}</th>
                  <th className="numeric">{txt("Left over", "فاضل")}</th>
                  <th className="numeric">
                    {txt("Weight (kg)", "الوزن (كجم)")}
                  </th>
                  <th className="numeric">{txt("Blocking", "مانع")}</th>
                  <th className="numeric">{txt("Warnings", "تحذيرات")}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((row) => (
                  <tr
                    key={row.planVersionId}
                    className={
                      best !== null && row.planVersionId === best.planVersionId
                        ? "compare-best"
                        : undefined
                    }
                  >
                    <td>
                      {txt("Version", "نسخة")} {versionNo(row.planVersionId)}
                    </td>
                    <td className="numeric" data-abp-num>
                      {num(row.vehicleCount)}
                    </td>
                    <td className="numeric" data-abp-num>
                      {num(row.loadedQty)}
                    </td>
                    {/* Anything left over is cargo that did not fit — the
                        number that decides whether a second trip is needed. */}
                    <td
                      className={`numeric ${Number(row.remainingQty) > 0 ? "compare-bad" : ""}`}
                      data-abp-num
                    >
                      {num(row.remainingQty)}
                    </td>
                    <td className="numeric" data-abp-num>
                      {num(row.totalWeightKg)}
                    </td>
                    <td
                      className={`numeric ${row.hardErrorCount > 0 ? "compare-bad" : ""}`}
                      data-abp-num
                    >
                      {num(row.hardErrorCount)}
                    </td>
                    <td className="numeric" data-abp-num>
                      {num(row.warningCount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
