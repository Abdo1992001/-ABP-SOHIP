import { lazy, Suspense, useState } from "react";
import { useParams, Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { ErrorBanner, ScreenIntro, TabBar } from "./CommercialUI.tsx";
import { LogisticsCompare } from "./LogisticsCompare.tsx";
import { DataView, OperationAction } from "./ContractScreen.tsx";
import { OptimizerRunStatus } from "./OptimizerRunStatus.tsx";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, isObject, rows, str } from "./commercial-api.ts";
import { operationById } from "../api/operation-runtime.ts";
import type { ScreenDefinition } from "./screen-registry.ts";
import type { components } from "@abp/api-client";
import { TransportOptimizationView } from "./TransportOptimizationView.tsx";
import { TransportEstimatePanel } from "./TransportEstimatePanel.tsx";
const View3D = lazy(() => import("./Logistics3DView.tsx"));
const tabs = [
  { id: "3d", en: "3D view", ar: "عرض ثلاثي الأبعاد" },
  { id: "routes", en: "Route list", ar: "المسارات" },
  { id: "manifest", en: "Load manifest", ar: "بيان الحمولة" },
  { id: "optimization", en: "Optimization", ar: "التحسين" },
  // Comparing two arrangements needed two endpoints, both unwired: one to
  // make a second version, one to compare them.
  { id: "compare", en: "Compare", ar: "المقارنة" },
  { id: "export", en: "Export", ar: "التصدير" },
];
export function LogisticsPlanner({
  client,
  me,
  screen,
}: {
  client: ApiClient;
  me: Me;
  screen: ScreenDefinition;
}) {
  const [tab, setTab] = useState("routes");
  const { locale } = useI18n();
  const [chosenVersion, setChosenVersion] = useState("");
  const [optimizerRunId, setOptimizerRunId] = useState<string | null>(null);
  const { planId = "" } = useParams();
  const query = useQuery({
    queryKey: ["logistics-planner", planId],
    queryFn: () =>
      commercialRequest(client, "GET", "/logistics/plans/{planId}", {
        path: { planId },
      }),
  });
  const payload = query.data?.data;
  const plan = isObject(payload) && isObject(payload.data) ? payload.data : {};
  const versions = rows(plan.versions);
  const version =
    versions.find((v) => v.planVersionId === chosenVersion) ?? versions[0];
  const versionId = str(version?.planVersionId ?? "");
  const visualization = useQuery({
    queryKey: ["logistics-visualization", versionId],
    enabled: !!versionId && ["optimization", "3d", "routes"].includes(tab),
    queryFn: () =>
      commercialRequest(
        client,
        "GET",
        "/logistics/plan-versions/{versionId}/visualization",
        { path: { versionId } },
      ),
  });
  const tokens: Record<string, string[]> = {
    routes: [],
    manifest: ["versions", "draft_content"],
    optimization: ["optimize", "validate"],
    export: ["exports"],
  };
  const visualizationData = (
    visualization.data?.data as
      components["schemas"]["LogisticsVisualizationEnvelope"] | undefined
  )?.data;
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {locale === "ar" ? "مخطط اللوجستيات" : "Logistics planner"}
          </span>
          <h1>{str(plan.planRef ?? planId)}</h1>
        </div>
        {versions.length > 0 && (
          <label>
            {locale === "ar" ? "نسخة الخطة" : "Plan version"}
            <select
              value={versionId}
              onChange={(e) => {
                setChosenVersion(e.target.value);
              }}
            >
              {versions.map((v) => (
                <option key={str(v.planVersionId)} value={str(v.planVersionId)}>
                  {str(v.versionNo)} · {str(v.statusCode)}
                </option>
              ))}
            </select>
          </label>
        )}
      </header>
      <ScreenIntro />
      <TabBar tabs={tabs} active={tab} onChange={setTab} />
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      <div className="panel data-surface" role="tabpanel">
        {tab === "compare" ? (
          <LogisticsCompare
            client={client}
            me={me}
            planId={planId}
            versions={versions.map((v) => ({
              planVersionId: str(v.planVersionId),
              versionNo: str(v.versionNo),
              statusCode: str(v.statusCode),
            }))}
            currentVersionId={versionId}
            onChanged={() => {
              void query.refetch();
            }}
          />
        ) : tab === "3d" ? (
          <Suspense fallback={<p>…</p>}>
            {visualizationData ? (
              <View3D data={visualizationData} />
            ) : (
              <p>
                {locale === "ar" ? "جار تحميل التوزيع…" : "Loading placement…"}
              </p>
            )}
          </Suspense>
        ) : (
          <>
            {tab === "routes" && (
              <>
                <p>
                  {locale === "ar" ? "الدولة" : "Country"}:{" "}
                  {str(plan.countryCode)} · {str(plan.statusCode)}
                </p>
                {plan.sourceResourceId && (
                  <Link
                    to={`${plan.sourceTypeCode === "QUOTATION" ? "/quotations" : "/orders"}/${str(plan.sourceResourceId)}`}
                  >
                    {locale === "ar" ? "فتح مصدر الخطة" : "Open plan source"}
                  </Link>
                )}
                <h2 className="section-heading">
                  {locale === "ar"
                    ? "تقدير النقل السريع"
                    : "Quick transport estimate"}
                </h2>
                <TransportEstimatePanel
                  initialTruckCapacityKg={str(
                    visualizationData?.transportUnits[0]?.maxWeightKgSnapshot ??
                      "",
                  )}
                />
              </>
            )}
            {tab === "manifest" && <DataView value={version ?? []} />}
            {tab === "optimization" && (
              <>
                <ErrorBanner
                  error={visualization.error}
                  retry={() => void visualization.refetch()}
                />
                {visualizationData && (
                  <TransportOptimizationView data={visualizationData} />
                )}
              </>
            )}
            {optimizerRunId !== null && (
              <OptimizerRunStatus
                client={client}
                runId={optimizerRunId}
                onFinished={() => {
                  void query.refetch();
                  void visualization.refetch();
                }}
                onDismiss={() => {
                  setOptimizerRunId(null);
                }}
              />
            )}
            <div className="action-grid">
              {screen.operations
                .filter((id) =>
                  tokens[tab]?.some((token) => id.includes(token)),
                )
                .map((id) => {
                  const operation = operationById.get(id);
                  return operation &&
                    operation.method !== "GET" &&
                    me.access.permissions.includes(operation.permission) &&
                    (versionId || !operation.path.includes("{versionId}")) ? (
                    <OperationAction
                      key={`${id}-${versionId}`}
                      client={client}
                      operation={operation}
                      routeParams={{ planId, versionId }}
                      currentVersion={str(version?.rowVersion ?? "")}
                      {...(id.includes("optimize")
                        ? {
                            // Optimising answers 202: the run is queued, not
                            // done. Keep its id so the screen can watch it
                            // instead of reloading a plan that has not
                            // changed yet.
                            onResult: (value: unknown) => {
                              const body =
                                isObject(value) && isObject(value.data)
                                  ? value.data
                                  : null;
                              const id_ =
                                body === null ? "" : str(body.optimizerRunId);
                              if (id_ !== "" && id_ !== "—")
                                setOptimizerRunId(id_);
                            },
                          }
                        : {})}
                      onComplete={() => {
                        if (id.includes("optimize")) return;
                        void query.refetch();
                        void visualization.refetch();
                      }}
                    />
                  ) : null;
                })}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
