import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { formatMoney } from "../lib/numbers.ts";
import { AppIcon, ErrorBanner, PageHeader } from "./CommercialUI.tsx";

type ActionItem = components["schemas"]["ActionQueueItem"];

/**
 * The action queue is the screen a salesperson opens first thing in the morning.
 * It answers one question — "what do I have to do today, in what order" — and
 * every row is a link to the place the work is actually done.
 *
 * Grouping is by urgency, not by record type: an overdue follow-up and a
 * quotation expiring tonight are the same kind of problem, and splitting them
 * into "Activities" and "Quotations" tabs is what makes people miss both.
 */
const groupOrder = ["OVERDUE", "TODAY", "STALE", "UPCOMING", "NORMAL"] as const;

export function ActionQueuePage({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const [showDone, setShowDone] = useState(false);

  const queue = useQuery({
    queryKey: ["action-queue"],
    queryFn: async () => {
      const result = await client.GET("/action-queue", {});
      if (!result.data)
        throw new Error(`ACTION_QUEUE_${String(result.response.status)}`);
      return result.data.data as unknown as ActionItem[];
    },
  });

  const grouped = useMemo(() => {
    const byPriority = new Map<string, ActionItem[]>();
    const known: readonly string[] = groupOrder;
    for (const item of queue.data ?? []) {
      // A priority the screen does not recognise must not make the row
      // vanish. `priorityCode` is a free string in the contract, so the old
      // filter dropped anything outside this list while the header count
      // still included it — the screen said "2 items" and showed none.
      const raw = item.priorityCode ?? "NORMAL";
      const key = known.includes(raw) ? raw : "NORMAL";
      const bucket = byPriority.get(key);
      if (bucket) bucket.push(item);
      else byPriority.set(key, [item]);
    }
    return groupOrder
      .map((key) => ({ key, items: byPriority.get(key) ?? [] }))
      .filter((group) => group.items.length > 0);
  }, [queue.data]);

  const labels = ar ? arLabels : enLabels;
  const total = queue.data?.length ?? 0;
  const countOf = (key: string) =>
    grouped.find((group) => group.key === key)?.items.length ?? 0;
  const overdue = countOf("OVERDUE");
  // The four named buckets plus whatever did not fall into one: shown only
  // when it is not empty, so the tiles always add up to the header count.
  const summaryTiles = [
    { key: "OVERDUE", count: overdue, tone: "is-danger" },
    { key: "TODAY", count: countOf("TODAY"), tone: "is-warning" },
    { key: "STALE", count: countOf("STALE"), tone: "" },
    { key: "UPCOMING", count: countOf("UPCOMING"), tone: "" },
    { key: "NORMAL", count: countOf("NORMAL"), tone: "" },
  ].filter((tile) => tile.key !== "NORMAL" || tile.count > 0);

  return (
    <section className="action-queue-page">
      <PageHeader
        kicker={labels.kicker}
        title={labels.title}
        count={total}
        status={
          overdue > 0
            ? `${String(overdue)} ${labels.overdueSubtitle}`
            : labels.clearSubtitle
        }
        actions={
          <button
            type="button"
            className="abp-btn abp-btn-secondary action-queue-refresh"
            disabled={queue.isFetching}
            onClick={() => {
              void queue.refetch();
            }}
          >
            {queue.isFetching ? labels.refreshing : labels.refresh}
          </button>
        }
      />

      {queue.isError && (
        <ErrorBanner
          error={queue.error}
          retry={() => {
            void queue.refetch();
          }}
        />
      )}

      {queue.isLoading && <p className="table-empty">{labels.loading}</p>}

      {!queue.isLoading && total === 0 && (
        <div className="action-queue-empty">
          <span className="action-queue-empty-mark">
            <AppIcon id="CHECK" />
          </span>
          <div>
            <h2>{labels.allClear}</h2>
            <p>{labels.nothingDue}</p>
          </div>
          <nav
            className="action-queue-empty-links"
            aria-label={labels.nextLinks}
          >
            <Link to="/activities">{labels.openActivities}</Link>
            <Link to="/quotations">{labels.openQuotations}</Link>
            <Link to="/today">{labels.openToday}</Link>
          </nav>
        </div>
      )}

      {!queue.isLoading && total > 0 && (
        <dl className="action-queue-summary">
          {summaryTiles.map((tile) => (
            <div
              key={tile.key}
              className={tile.count > 0 ? tile.tone : ""}
              data-empty={tile.count === 0 ? "true" : undefined}
            >
              <dd>{tile.count}</dd>
              <dt>{labels.groups[tile.key]}</dt>
            </div>
          ))}
        </dl>
      )}

      {grouped.map((group) => (
        <section
          key={group.key}
          className={`action-queue-group is-${group.key.toLowerCase()}`}
          aria-label={labels.groups[group.key]}
        >
          <header className="action-queue-group-head">
            <h3>{labels.groups[group.key]}</h3>
            <span>{group.items.length}</span>
          </header>
          <ul className="action-queue-list">
            {group.items.map((item) => (
              <li key={`${item.sourceTypeCode}:${item.sourceId}`}>
                <Link to={item.href ?? "/"} className="action-queue-row">
                  <span className="action-queue-kind">
                    {/* An action code this screen has no wording for used to
                        print as the raw code — ACTIVITY_FOLLOW_UP in the
                        middle of an Arabic list. enumLabel knows the common
                        ones and humanises the rest. */}
                    {labels.actions[item.actionCode] ??
                      enumLabel(item.actionCode, locale)}
                  </span>
                  <span className="action-queue-title">
                    {item.title}
                    {item.subtitle !== null && item.subtitle !== undefined && (
                      <em>{item.subtitle}</em>
                    )}
                  </span>
                  <span className="action-queue-amount">
                    {formatMoney(
                      item.amount,
                      item.currencyCode,
                      locale,
                      { maximumFractionDigits: 0 },
                      "",
                    )}
                  </span>
                  <span className="action-queue-due">
                    {formatDue(item.dueAt, locale, labels)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Kept as an explicit control rather than a default: the queue is for
          work that is still open, and showing completed items by default is how
          a work list turns into a log nobody reads. */}
      {total > 0 && (
        <button
          type="button"
          className="action-queue-toggle"
          onClick={() => {
            setShowDone((value) => !value);
          }}
        >
          {showDone ? labels.hideHint : labels.showHint}
        </button>
      )}
      {showDone && <p className="action-queue-hint">{labels.doneHint}</p>}
    </section>
  );
}

function formatDue(
  value: string | null | undefined,
  locale: string,
  labels: typeof enLabels,
) {
  if (value === null || value === undefined || value === "") return "—";
  const date = new Date(value);
  const now = new Date();
  const dateDay = new Date(date);
  const today = new Date(now);
  dateDay.setHours(0, 0, 0, 0);
  today.setHours(0, 0, 0, 0);
  const days = Math.round((dateDay.getTime() - today.getTime()) / 86_400_000);
  if (date < now && days === 0) return labels.lateToday;
  if (days < 0) return `${String(Math.abs(days))}${labels.daysOverdue}`;
  if (days === 0) return labels.today;
  if (days === 1) return labels.tomorrow;
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
  }).format(date);
}

const enLabels = {
  kicker: "Today",
  title: "Action queue",
  overdueSubtitle: "items are past due",
  clearSubtitle: "Nothing is overdue",
  loading: "Loading…",
  refresh: "Refresh",
  refreshing: "Refreshing…",
  allClear: "All clear",
  nothingDue: "Nothing is due. Your queue is clear.",
  nextLinks: "Useful next steps",
  openActivities: "Open follow-ups",
  openQuotations: "Review quotations",
  openToday: "Sales overview",
  today: "Today",
  lateToday: "Late today",
  tomorrow: "Tomorrow",
  daysOverdue: "d overdue",
  showHint: "Why is an item here?",
  hideHint: "Hide",
  doneHint:
    "Items leave this list when the follow-up is completed, the quotation is sent, or it is accepted, rejected or cancelled.",
  groups: {
    OVERDUE: "Overdue",
    TODAY: "Due today",
    STALE: "Sitting unsent",
    UPCOMING: "Coming up",
    NORMAL: "Other",
  } as Record<string, string>,
  actions: {
    FOLLOW_UP: "Follow-up",
    MEETING: "Meeting",
    QUOTATION_EXPIRING: "Expiring",
    DRAFT_NOT_SENT: "Draft",
  } as Record<string, string>,
};

const arLabels: typeof enLabels = {
  kicker: "اليوم",
  title: "قائمة الإجراءات",
  overdueSubtitle: "عنصر متأخر",
  clearSubtitle: "لا يوجد متأخر",
  loading: "جارٍ التحميل…",
  refresh: "تحديث",
  refreshing: "جارٍ التحديث…",
  allClear: "القائمة مخلّصة",
  nothingDue: "لا توجد مهام مستحقة. القائمة فارغة.",
  nextLinks: "خطوات مفيدة تالية",
  openActivities: "افتح المتابعات",
  openQuotations: "راجع عروض الأسعار",
  openToday: "نظرة المبيعات",
  today: "اليوم",
  lateToday: "متأخر اليوم",
  tomorrow: "غدًا",
  daysOverdue: " يوم تأخير",
  showHint: "لماذا يظهر هذا العنصر؟",
  hideHint: "إخفاء",
  doneHint:
    "يخرج العنصر من القائمة عند إتمام المتابعة أو إرسال عرض السعر أو قبوله أو رفضه أو إلغائه.",
  groups: {
    OVERDUE: "متأخر",
    TODAY: "مستحق اليوم",
    STALE: "لم يُرسل",
    UPCOMING: "قادم",
    NORMAL: "أخرى",
  },
  actions: {
    FOLLOW_UP: "متابعة",
    MEETING: "اجتماع",
    QUOTATION_EXPIRING: "قارب على الانتهاء",
    DRAFT_NOT_SENT: "مسودة",
  },
};
