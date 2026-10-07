import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";

/**
 * What happened to the optimisation you just started.
 *
 * `POST .../optimize` answers **202**: the run is queued, not done. The
 * planner treated that as a finished action — it refetched the plan straight
 * away, which showed the state from *before* the optimiser had run, and then
 * nothing ever looked again. So the button worked, the run completed on the
 * server, and the screen never said so.
 *
 * `GET /logistics/optimizer-runs/{runId}` is the other half, and nothing
 * called it. This polls it while the run is queued or running, stops as soon
 * as it settles, and tells the planner to reload only then.
 */

const FINISHED = ["SUCCEEDED", "FAILED", "CANCELLED"];

export function OptimizerRunStatus({
  client,
  runId,
  onFinished,
  onDismiss,
}: {
  client: ApiClient;
  runId: string;
  onFinished: () => void;
  onDismiss: () => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);

  const run = useQuery({
    queryKey: ["optimizer-run", runId],
    queryFn: () =>
      commercialRequest(client, "GET", "/logistics/optimizer-runs/{runId}", {
        path: { runId },
      }),
    // Stop the moment it settles; an optimiser that has failed will not
    // un-fail, and polling a finished run forever is how a screen quietly
    // burns a request every two seconds for the rest of the day.
    refetchInterval: (query) => {
      const payload = query.state.data;
      const data =
        isObject(payload?.data) && isObject(payload.data.data)
          ? payload.data.data
          : null;
      const status = data === null ? "" : str(data.statusCode);
      return FINISHED.includes(status) ? false : 2000;
    },
  });

  const payload = run.data?.data;
  const data =
    isObject(payload) && isObject(payload.data) ? payload.data : null;
  const status = data === null ? "" : str(data.statusCode);
  const settled = FINISHED.includes(status);
  const succeeded = status === "SUCCEEDED";

  useEffect(() => {
    if (succeeded) onFinished();
    // Only when it actually succeeds, and only once per run.
  }, [succeeded, onFinished]);

  const summary =
    data !== null && isObject(data.resultSummaryJsonb)
      ? Object.entries(data.resultSummaryJsonb)
          .filter(([, value]) => typeof value !== "object")
          .slice(0, 4)
      : [];

  return (
    <div
      className={`optimizer-run is-${(settled ? status : "running").toLowerCase()}`}
      role="status"
    >
      <div className="optimizer-run-head">
        <strong>
          {settled
            ? succeeded
              ? txt("Optimisation finished", "التحسين خلص")
              : txt("Optimisation did not finish", "التحسين مكملش")
            : txt("Optimising…", "بيحسّن…")}
        </strong>
        <span>{enumLabel(status, locale)}</span>
      </div>

      <p className="optimizer-run-note">
        {settled
          ? succeeded
            ? txt(
                "The plan below has been reloaded with the optimised placement.",
                "الخطة تحت اتحمّلت من تاني بالتوزيع المحسّن.",
              )
            : (data === null ? "" : str(data.errorCode)) === "—"
              ? txt(
                  "The run stopped without producing a placement.",
                  "التشغيل وقف من غير ما يطلع توزيع.",
                )
              : `${txt("Reason", "السبب")}: ${enumLabel(
                  data === null ? "" : str(data.errorCode),
                  locale,
                )}`
          : txt(
              "This runs on the server and can take a moment. You can keep working; this will update itself.",
              "ده بيشتغل على السيرفر وممكن ياخد لحظة. اشتغل عادي، ده هيحدّث نفسه.",
            )}
      </p>

      {summary.length > 0 && (
        <dl className="optimizer-run-summary">
          {summary.map(([key, value]) => (
            <div key={key}>
              <dt>{humanize(key)}</dt>
              <dd>{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {settled && (
        <button type="button" className="ghost-button" onClick={onDismiss}>
          {txt("Dismiss", "إخفاء")}
        </button>
      )}
    </div>
  );
}

function humanize(key: string) {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .replace(/^./, (character) => character.toUpperCase());
}
