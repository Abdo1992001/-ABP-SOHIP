import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import { listAccounts, type Me } from "../api/customer-api.ts";
import { listQuotations } from "../api/quotation-api.ts";
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  listOpportunityLostReasons,
  listOpportunityStagePolicies,
  overrideOpportunityProbability,
  transitionOpportunity,
} from "../api/opportunity-api.ts";
import { createActivity } from "../api/activity-api.ts";
import {
  ErrorBanner,
  ScreenIntro,
  SlideOver,
  StatusChip,
  TabBar,
  useToast,
} from "./CommercialUI.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { AccountPicker } from "./AccountPicker.tsx";
import { RecordThread } from "./RecordThread.tsx";
import { useI18n } from "../i18n/i18n.tsx";
export function OpportunityPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n(),
    navigate = useNavigate(),
    cache = useQueryClient(),
    toast = useToast();
  const [searchParams] = useSearchParams();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const { opportunityId } = useParams();
  const [page, setPage] = useState(1),
    [tab, setTab] = useState("overview"),
    [dialog, setDialog] = useState<string | null>(() =>
      searchParams.get("create") === "1" ? "create" : null,
    ),
    [accountId, setAccountId] = useState(""),
    [title, setTitle] = useState(""),
    [reason, setReason] = useState(""),
    [value, setValue] = useState(""),
    [currency, setCurrency] = useState("EGP"),
    [target, setTarget] = useState(""),
    [lostReason, setLostReason] = useState(""),
    [probability, setProbability] = useState(""),
    [activitySubject, setActivitySubject] = useState("");
  const list = useQuery({
    queryKey: ["opportunities", page],
    enabled: !opportunityId,
    queryFn: () =>
      listOpportunities(client, { page, limit: 25, sort: "updatedAt:desc" }),
  });
  /* A pipeline row that says only "OPP-00000084 · New lead · —" tells a
     salesperson nothing they can act on. The company, the age of the deal and
     what has actually been quoted against it are the three things they look
     for, and all three are one join away. The joins are done here rather than
     in a new endpoint because both lists are already small and already
     fetched elsewhere on the same screen. */
  const accountsForList = useQuery({
    queryKey: ["opportunity-list-accounts"],
    enabled: !opportunityId,
    queryFn: () => listAccounts(client, { page: 1, limit: 200 }),
  });
  const quotationsForList = useQuery({
    queryKey: ["opportunity-list-quotations"],
    enabled: !opportunityId,
    queryFn: () => listQuotations(client, { page: 1, limit: 200 }),
  });
  const accountNames = new Map(
    (accountsForList.data?.data ?? []).map((a) => [
      a.accountId,
      a.canonicalName,
    ]),
  );
  const quotationSummary = new Map<
    string,
    { count: number; value: number; currency: string }
  >();
  for (const q of quotationsForList.data?.data ?? []) {
    const key = q.opportunityId;
    if (typeof key !== "string") continue;
    const current = quotationSummary.get(key) ?? {
      count: 0,
      value: 0,
      currency: q.currencyCode,
    };
    current.count += 1;
    current.value += Number(q.grandTotalAmount ?? q.subtotalAmount ?? 0);
    quotationSummary.set(key, current);
  }

  const detail = useQuery({
    queryKey: ["opportunity", opportunityId],
    enabled: !!opportunityId,
    queryFn: () => getOpportunity(client, opportunityId ?? ""),
  });
  const stages = useQuery({
    queryKey: ["opportunity-stage-policies"],
    enabled: !!opportunityId,
    queryFn: () => listOpportunityStagePolicies(client),
  });
  const reasons = useQuery({
    queryKey: ["opportunity-lost-reasons"],
    enabled: dialog === "transition" && target === "LOST",
    queryFn: () => listOpportunityLostReasons(client),
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["opportunities"] });
    await cache.invalidateQueries({ queryKey: ["opportunity", opportunityId] });
    toast.success(txt("Saved", "تم الحفظ"));
  };
  const create = useMutation({
    mutationFn: () =>
      createOpportunity(client, {
        title: title.trim(),
        accountId,
        noProjectReasonCode: reason,
        ...(value ? { estimatedValue: value, currencyCode: currency } : {}),
      }),
    onSuccess: async (r) => {
      setDialog(null);
      await refresh();
      await navigate(`/opportunities/${r.data.opportunityId}`);
    },
  });
  const version = detail.data?.etag ?? detail.data?.data.rowVersion ?? "";
  const [cancelReason, setCancelReason] = useState("");
  const cancel = useMutation({
    mutationFn: async () => {
      const result = await client.POST(
        "/opportunities/{opportunityId}/cancel",
        {
          params: {
            path: { opportunityId: opportunityId ?? "" },
            header: { "Idempotency-Key": crypto.randomUUID() },
          },
          body: {
            expectedRowVersion: version,
            reason: cancelReason.trim(),
          },
        },
      );
      if (!result.data)
        throw new Error(`CANCEL_${String(result.response.status)}`);
      return result.data;
    },
    onSuccess: () => {
      setDialog(null);
      setCancelReason("");
      void detail.refetch();
    },
  });
  const transition = useMutation({
    mutationFn: (stage: string) =>
      transitionOpportunity(client, opportunityId ?? "", version, {
        targetStageCode: stage,
        ...(stage === "LOST" ? { lostReasonCode: lostReason } : {}),
      }),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });
  const override = useMutation({
    mutationFn: () =>
      overrideOpportunityProbability(client, opportunityId ?? "", version, {
        probabilityPct: probability,
        reason: reason || "Sales assessment",
        sourceMetadata: { sourceCode: "SALES_WORKSPACE" },
      }),
    onSuccess: async () => {
      setDialog(null);
      await refresh();
    },
  });
  const activity = useMutation({
    mutationFn: () =>
      createActivity(client, {
        typeCode: "FOLLOW_UP",
        subject: activitySubject,
        links: [
          {
            resourceTypeCode: "OPPORTUNITY",
            resourceId: opportunityId ?? "",
            isPrimary: true,
          },
        ],
      }),
    onSuccess: async () => {
      setDialog(null);
      toast.success(txt("Activity added", "تم تسجيل النشاط"));
      await cache.invalidateQueries({ queryKey: ["activities"] });
    },
  });
  const opportunity = detail.data?.data;
  const canEdit = me.access.permissions.includes("opportunities.edit");
  // The commercial lifecycle. A deal can be moved back to negotiation after
  // a quotation has already gone out, so this is an order, not a ratchet.
  const ordered = ["NEW_LEAD", "HOT_LEAD", "UNDER_NEGOTIATION", "WON"];
  const next = ordered[ordered.indexOf(opportunity?.stageCode ?? "") + 1];
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {txt("Sales pipeline", "مسار المبيعات")}
          </span>
          <h1>
            {opportunity?.title ??
              opportunity?.opportunityRef ??
              txt("Opportunities", "الفرص")}
          </h1>
        </div>
        {!opportunityId &&
          me.access.permissions.includes("opportunities.create") && (
            <button
              className="primary"
              onClick={() => {
                setDialog("create");
              }}
            >
              {txt("+ New opportunity", "+ فرصة جديدة")}
            </button>
          )}
      </header>
      <ScreenIntro />
      {opportunityId ? (
        <>
          <TabBar
            tabs={[
              { id: "overview", en: "Overview", ar: "نظرة عامة" },
              { id: "actions", en: "Deal actions", ar: "إجراءات الفرصة" },
              { id: "discussion", en: "Discussion", ar: "النقاش" },
              { id: "history", en: "History", ar: "السجل" },
            ]}
            active={tab}
            onChange={setTab}
          />
          <ErrorBanner
            error={detail.error}
            retry={() => void detail.refetch()}
          />
          {opportunity && (
            <div className="panel" role="tabpanel">
              {tab === "overview" && (
                <>
                  <p>
                    {txt("Stage", "المرحلة")}:{" "}
                    <StatusChip code={opportunity.stageCode} />
                  </p>
                  <p>
                    {txt("Estimated value", "القيمة المتوقعة")}:{" "}
                    {opportunity.estimatedValue ?? "—"}{" "}
                    {opportunity.currencyCode}
                  </p>
                  <p>
                    {txt("Probability", "احتمال الفوز")}:{" "}
                    {opportunity.probabilityPct ?? "—"}%
                  </p>
                  <Link to={`/customers/${opportunity.accountId}`}>
                    {txt("Customer 360", "ملف العميل")}
                  </Link>
                  {opportunity.projectId && (
                    <p>
                      <Link to={`/projects/${opportunity.projectId}`}>
                        {txt("Project 360", "ملف المشروع")}
                      </Link>
                    </p>
                  )}
                </>
              )}
              {tab === "actions" && (
                <div className="action-grid">
                  <ErrorBanner
                    error={transition.error}
                    retry={() => {
                      if (transition.variables) {
                        transition.mutate(transition.variables);
                      }
                    }}
                  />
                  <ErrorBanner
                    error={stages.error}
                    retry={() => void stages.refetch()}
                  />
                  {canEdit && (
                    <>
                      {next &&
                        next !== "WON" &&
                        opportunity.stageCode !== "LOST" && (
                          <button
                            disabled={transition.isPending}
                            onClick={() => {
                              transition.mutate(next);
                            }}
                          >
                            {txt(
                              "Advance to next stage",
                              "الانتقال للمرحلة التالية",
                            )}
                          </button>
                        )}
                      {opportunity.stageCode !== "WON" && (
                        <button
                          onClick={() => {
                            setTarget("WON");
                            setDialog("transition");
                          }}
                        >
                          {txt("Mark won", "تسجيل فوز")}
                        </button>
                      )}
                      {opportunity.stageCode !== "LOST" && (
                        <button
                          className="danger"
                          onClick={() => {
                            setTarget("LOST");
                            setDialog("transition");
                          }}
                        >
                          {txt("Mark lost", "تسجيل خسارة")}
                        </button>
                      )}
                      {opportunity.stageCode !== "WON" &&
                        opportunity.stageCode !== "LOST" &&
                        !opportunity.cancelledAt && (
                          <button
                            className="danger"
                            onClick={() => {
                              setDialog("cancel");
                            }}
                          >
                            {txt("Cancel deal", "إلغاء الفرصة")}
                          </button>
                        )}
                      <button
                        onClick={() => {
                          setTarget("");
                          setDialog("transition");
                        }}
                      >
                        {txt("Change stage", "تغيير المرحلة")}
                      </button>
                    </>
                  )}
                  {me.access.permissions.includes(
                    "opportunities.probability.override",
                  ) && (
                    <button
                      onClick={() => {
                        setDialog("probability");
                      }}
                    >
                      {txt("Update probability", "تحديث الاحتمال")}
                    </button>
                  )}
                  {me.access.permissions.includes("activities.create") && (
                    <button
                      onClick={() => {
                        setDialog("activity");
                      }}
                    >
                      {txt("Add activity", "إضافة نشاط")}
                    </button>
                  )}
                </div>
              )}
              {tab === "discussion" && (
                <RecordThread
                  client={client}
                  contextType="OPPORTUNITY"
                  contextId={opportunityId}
                  currentUserId={me.user.userId}
                />
              )}
              {tab === "history" && (
                <ul>
                  {opportunity.stageHistory.map((h) => (
                    <li key={h.transitionId}>
                      {h.fromStageCode ?? "—"} → {h.toStageCode}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <ErrorBanner error={list.error} retry={() => void list.refetch()} />
          <div className="panel">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{txt("Opportunity", "الفرصة")}</th>
                  <th>{txt("Customer", "العميل")}</th>
                  <th>{txt("Created", "تاريخ الإنشاء")}</th>
                  <th>{txt("Stage", "المرحلة")}</th>
                  <th>{txt("Quotations", "عروض الأسعار")}</th>
                  <th>{txt("Quoted value", "قيمة العروض")}</th>
                  <th>{txt("Deal value", "قيمة الفرصة")}</th>
                </tr>
              </thead>
              <tbody>
                {list.data?.data.map((o) => {
                  const quoted = quotationSummary.get(o.opportunityId);
                  return (
                    <tr key={o.opportunityId}>
                      <td>
                        <Link
                          to={`/opportunities/${o.opportunityId}`}
                          onClick={() => {
                            setTab("overview");
                          }}
                        >
                          {o.title ?? o.opportunityRef}
                        </Link>
                      </td>
                      <td>
                        {o.accountId ? (
                          <Link to={`/customers/${o.accountId}`}>
                            {accountNames.get(o.accountId) ?? o.accountId}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        {o.createdAt
                          ? new Date(o.createdAt).toLocaleDateString(
                              locale === "ar" ? "ar-EG" : "en-GB",
                              {
                                day: "2-digit",
                                month: "short",
                                year: "numeric",
                              },
                            )
                          : "—"}
                      </td>
                      <td>
                        <StatusChip code={o.stageCode} />
                      </td>
                      <td>{quoted ? quoted.count : 0}</td>
                      <td>
                        {quoted && quoted.value > 0
                          ? `${quoted.value.toLocaleString(
                              locale === "ar" ? "ar-EG" : "en",
                              { maximumFractionDigits: 0 },
                            )} ${quoted.currency}`
                          : "—"}
                      </td>
                      <td>
                        {o.estimatedValue
                          ? `${Number(o.estimatedValue).toLocaleString(
                              locale === "ar" ? "ar-EG" : "en",
                              { maximumFractionDigits: 0 },
                            )} ${o.currencyCode ?? ""}`
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <footer className="pagination">
              <button
                disabled={page === 1}
                onClick={() => {
                  setPage(page - 1);
                }}
              >
                {txt("Previous", "السابق")}
              </button>
              <span>{page}</span>
              <button
                disabled={!list.data?.meta.hasNext}
                onClick={() => {
                  setPage(page + 1);
                }}
              >
                {txt("Next", "التالي")}
              </button>
            </footer>
          </div>
        </>
      )}
      {dialog === "create" && (
        <SlideOver
          title={txt("New opportunity", "فرصة جديدة")}
          onClose={() => {
            setDialog(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label>
              {txt("What is this deal?", "الفرصة دي إيه؟")}
              <input
                required
                minLength={3}
                maxLength={200}
                value={title}
                placeholder={txt(
                  "Orascom — New Cairo tower, column formwork",
                  "أوراسكوم — برج القاهرة الجديدة، شدات أعمدة",
                )}
                onChange={(e) => {
                  setTitle(e.target.value);
                }}
              />
            </label>
            <AccountPicker
              client={client}
              value={accountId}
              onChange={setAccountId}
            />
            <label>
              {txt("Reason for no linked project", "سبب عدم ربط مشروع")}
              <input
                required
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Estimated value", "القيمة المتوقعة")}
              <input
                type="number"
                min="0"
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Currency", "العملة")}
              <select
                value={currency}
                onChange={(e) => {
                  setCurrency(e.target.value);
                }}
              >
                <option>EGP</option>
                <option>USD</option>
              </select>
            </label>
            <ErrorBanner
              error={create.error}
              retry={() => {
                create.mutate();
              }}
            />
            <button className="primary" disabled={create.isPending}>
              {txt("Create opportunity", "إنشاء الفرصة")}
            </button>
          </form>
        </SlideOver>
      )}
      {dialog === "cancel" && (
        <SlideOver
          title={txt("Cancel this deal", "إلغاء هذه الفرصة")}
          onClose={() => {
            setDialog(null);
          }}
        >
          {/* Cancelled is not lost. A lost deal went to a competitor and its
              reason feeds win/loss analysis; a cancelled one means the customer
              dropped the requirement, and counting it as a loss would make the
              team look worse than it performed. */}
          <p className="muted-copy">
            {txt(
              "Use this when the customer dropped the requirement. If a competitor won it, mark the deal lost instead so the loss reason is recorded.",
              "استخدم هذا عندما يتراجع العميل عن الطلب نفسه. لو فاز بها منافس، سجّلها خسارة بدلاً من ذلك حتى يُسجَّل سبب الخسارة.",
            )}
          </p>
          <ErrorBanner
            error={cancel.error}
            retry={() => {
              cancel.mutate();
            }}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault();
              cancel.mutate();
            }}
          >
            <label>
              {txt("Reason", "السبب")}
              <textarea
                required
                minLength={3}
                maxLength={500}
                value={cancelReason}
                onChange={(event) => {
                  setCancelReason(event.target.value);
                }}
              />
            </label>
            <button
              className="danger"
              type="submit"
              disabled={cancel.isPending || cancelReason.trim().length < 3}
            >
              {cancel.isPending ? "…" : txt("Cancel deal", "إلغاء الفرصة")}
            </button>
          </form>
        </SlideOver>
      )}
      {dialog === "transition" && (
        <SlideOver
          title={
            target === "WON"
              ? txt("Confirm won deal", "تأكيد الفوز بالفرصة")
              : target === "LOST"
                ? txt("Loss details", "تفاصيل الخسارة")
                : txt("Change stage", "تغيير المرحلة")
          }
          onClose={() => {
            setDialog(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              transition.mutate(target);
            }}
          >
            <label>
              {txt("Stage", "المرحلة")}
              <select
                required
                value={target}
                onChange={(e) => {
                  setTarget(e.target.value);
                }}
              >
                <option value="">—</option>
                {stages.data?.data.map((s) => (
                  <option key={s.stageCode} value={s.stageCode}>
                    {enumLabel(s.stageCode, locale)}
                  </option>
                ))}
              </select>
            </label>
            {target === "LOST" && (
              <label>
                {txt("Loss reason", "سبب الخسارة")}
                <select
                  required
                  value={lostReason}
                  onChange={(e) => {
                    setLostReason(e.target.value);
                  }}
                >
                  <option value="">—</option>
                  {reasons.data?.data.map((r) => (
                    <option key={r.lostReasonCode} value={r.lostReasonCode}>
                      {r.displayName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <ErrorBanner
              error={reasons.error}
              retry={() => void reasons.refetch()}
            />
            <ErrorBanner
              error={transition.error}
              retry={() => {
                transition.mutate(target);
              }}
            />
            <button className="primary" disabled={transition.isPending}>
              {txt("Confirm", "تأكيد")}
            </button>
          </form>
        </SlideOver>
      )}
      {dialog === "probability" && (
        <SlideOver
          title={txt("Update probability", "تحديث الاحتمال")}
          onClose={() => {
            setDialog(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              override.mutate();
            }}
          >
            <label>
              {txt("Probability %", "الاحتمال %")}
              <input
                required
                type="number"
                min="0"
                max="100"
                value={probability}
                onChange={(e) => {
                  setProbability(e.target.value);
                }}
              />
            </label>
            <label>
              {txt("Reason", "السبب")}
              <input
                required
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                }}
              />
            </label>
            <ErrorBanner
              error={override.error}
              retry={() => {
                override.mutate();
              }}
            />
            <button disabled={override.isPending}>{txt("Save", "حفظ")}</button>
          </form>
        </SlideOver>
      )}
      {dialog === "activity" && (
        <SlideOver
          title={txt("Add activity", "إضافة نشاط")}
          onClose={() => {
            setDialog(null);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              activity.mutate();
            }}
          >
            <label>
              {txt("Subject", "الموضوع")}
              <input
                required
                value={activitySubject}
                onChange={(e) => {
                  setActivitySubject(e.target.value);
                }}
              />
            </label>
            <ErrorBanner
              error={activity.error}
              retry={() => {
                activity.mutate();
              }}
            />
            <button disabled={activity.isPending}>
              {txt("Save activity", "حفظ النشاط")}
            </button>
          </form>
        </SlideOver>
      )}
    </section>
  );
}
