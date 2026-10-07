import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { parsePeople, personStanding } from "../lib/person-targets.ts";
import { ErrorBanner } from "./CommercialUI.tsx";

/**
 * Each salesperson's annual target, set by their manager, beside what they
 * have won this year and what they have open.
 *
 * The target is typed in EGP -- the currency the team is paid and measured
 * in -- and saved when the field is left, so setting five people's numbers is
 * five edits, not five forms. Clearing a field removes the target; it does not
 * set it to zero, which would read as a year with nothing expected.
 */
export function PersonTargetsTable({
  client,
  year,
  canManage,
  onlyUserId,
}: {
  client: ApiClient;
  year: number;
  canManage: boolean;
  /** A salesperson sees their own line only. */
  onlyUserId: string | null;
}) {
  const { locale } = useI18n();
  const labels = locale === "ar" ? ar : en;
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const people = useQuery({
    queryKey: ["person-targets", year],
    retry: false,
    queryFn: async () => {
      const result = await client.GET("/targets/{year}/people", {
        params: { path: { year: String(year) } },
      });
      if (!result.data)
        throw new Error(`PERSON_TARGETS_${String(result.response.status)}`);
      return parsePeople(result.data);
    },
  });

  const save = useMutation({
    mutationFn: async ({
      userId,
      amount,
    }: {
      userId: string;
      amount: string | null;
    }) => {
      const result = await client.PUT("/targets/{year}/people/{userId}", {
        params: { path: { year: String(year), userId } },
        body: { amountEgp: amount },
      });
      if (!result.data)
        throw new Error(`PERSON_TARGET_${String(result.response.status)}`);
    },
    onSuccess: async (_data, { userId }) => {
      setDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).filter(([key]) => key !== userId),
        ),
      );
      await queryClient.invalidateQueries({ queryKey: ["person-targets"] });
      await queryClient.invalidateQueries({
        queryKey: ["dashboard", "people-targets"],
      });
      await queryClient.invalidateQueries({ queryKey: ["view-as-people"] });
    },
  });

  const egp = (value: number) => `${formatNum(value, locale)} EGP`;
  const commit = (userId: string, saved: number | null) => {
    const raw = drafts[userId];
    if (raw === undefined) return;
    const clean = raw.replace(/[,\s]/g, "");
    if (clean === "") {
      if (saved !== null) save.mutate({ userId, amount: null });
      return;
    }
    if (!/^\d+(\.\d+)?$/.test(clean) || Number(clean) === saved) return;
    save.mutate({ userId, amount: clean });
  };

  const rows = (people.data ?? []).filter(
    (row) => onlyUserId === null || row.userId === onlyUserId,
  );
  const totalTarget = rows.reduce((sum, row) => sum + (row.targetEgp ?? 0), 0);
  const totalWon = rows.reduce((sum, row) => sum + row.wonEgp, 0);

  return (
    <section className="person-targets" aria-labelledby="person-targets-title">
      <div className="person-targets-head">
        <h2 id="person-targets-title">{labels.title}</h2>
        <p>{canManage ? labels.subManage : labels.subView}</p>
      </div>
      <ErrorBanner
        error={people.error ?? save.error}
        retry={() => {
          void people.refetch();
        }}
      />
      <div className="enterprise-table-scroll">
        <table className="enterprise-table person-targets-table">
          <thead>
            <tr>
              <th>{labels.person}</th>
              <th className="numeric">{labels.target}</th>
              <th className="numeric">{labels.won}</th>
              <th>{labels.achievement}</th>
              <th className="numeric">{labels.remaining}</th>
              <th className="numeric">{labels.pipeline}</th>
              <th className="numeric">{labels.open}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const standing = personStanding(row, 12);
              const draft = drafts[row.userId];
              return (
                <tr key={row.userId}>
                  <td>{row.displayName}</td>
                  <td className="numeric">
                    {canManage ? (
                      <input
                        className="person-target-input"
                        inputMode="decimal"
                        aria-label={`${labels.target} ${row.displayName}`}
                        placeholder={labels.notSet}
                        value={
                          draft ??
                          (row.targetEgp === null
                            ? ""
                            : row.targetEgp.toLocaleString("en"))
                        }
                        onChange={(event) => {
                          setDrafts((current) => ({
                            ...current,
                            [row.userId]: event.target.value,
                          }));
                        }}
                        onBlur={() => {
                          commit(row.userId, row.targetEgp);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") event.currentTarget.blur();
                        }}
                      />
                    ) : row.targetEgp === null ? (
                      labels.notSet
                    ) : (
                      egp(row.targetEgp)
                    )}
                  </td>
                  <td className="numeric">{egp(standing.won)}</td>
                  <td>
                    <div className="abp2-team-bar">
                      <div className="abp2-kpi-progress-track">
                        <div
                          className="abp2-kpi-progress-fill"
                          style={{
                            width: `${Math.min(100, standing.achievedPct).toFixed(2)}%`,
                          }}
                        />
                      </div>
                      <span>{standing.achievedPct.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className="numeric">
                    {standing.remaining === null
                      ? "—"
                      : egp(standing.remaining)}
                  </td>
                  <td className="numeric">{egp(standing.pipeline)}</td>
                  <td className="numeric">{standing.openOpportunities}</td>
                </tr>
              );
            })}
            {rows.length === 0 && !people.isLoading && (
              <tr>
                <td colSpan={7} className="table-empty">
                  {labels.empty}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 1 && (
            <tfoot>
              <tr>
                <th>{labels.team}</th>
                <th className="numeric">{egp(totalTarget)}</th>
                <th className="numeric">{egp(totalWon)}</th>
                <th colSpan={4} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </section>
  );
}

const en = {
  title: "Targets by salesperson",
  subManage:
    "Type each person's annual target in EGP; it saves when you leave the field. Clear it to remove the target.",
  subView:
    "Your annual target, what you have won this year and what you have open.",
  person: "Salesperson",
  target: "Annual target",
  won: "Won this year",
  achievement: "Achievement",
  remaining: "Remaining",
  pipeline: "Weighted pipeline",
  open: "Open deals",
  notSet: "Not set",
  team: "Team",
  empty: "No salespeople yet.",
};

const ar: typeof en = {
  title: "الأهداف حسب المندوب",
  subManage:
    "اكتب الهدف السنوي لكل مندوب بالجنيه؛ بيتحفظ لما تخرج من الخانة. امسحه عشان تلغي الهدف.",
  subView: "هدفك السنوي، واللي كسبته السنة دي، واللي عندك مفتوح.",
  person: "المندوب",
  target: "الهدف السنوي",
  won: "المكسوب السنة دي",
  achievement: "نسبة التحقيق",
  remaining: "المتبقي",
  pipeline: "المسار المرجّح",
  open: "فرص مفتوحة",
  notSet: "غير محدد",
  team: "الفريق",
  empty: "لا يوجد مندوبين بعد.",
};
