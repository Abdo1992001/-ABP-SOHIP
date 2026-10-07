import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { AccountPicker } from "./AccountPicker.tsx";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import {
  AppIcon,
  ErrorBanner,
  PageHeader,
  SlideOver,
  Sparkline,
  useToast,
} from "./CommercialUI.tsx";

/**
 * Customer feedback: what customers told us on the public page, and whether
 * anyone got back to them.
 *
 * Each piece is matched by the reference the customer gave to their account
 * and salesperson. What matched nobody waits for a manager to place it; what
 * was critical has already become a complaint, linked from here.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";

const KIND: Record<string, { en: string; ar: string }> = {
  SATISFACTION: { en: "Satisfaction", ar: "رضا" },
  PROBLEM: { en: "Problem", ar: "مشكلة" },
  SUGGESTION: { en: "Suggestion", ar: "اقتراح" },
  QUESTION: { en: "Question", ar: "سؤال" },
};
const STATUS: Record<string, { en: string; ar: string }> = {
  NEW: { en: "New", ar: "جديد" },
  ACKNOWLEDGED: { en: "Acknowledged", ar: "اتشاف" },
  CONTACTED: { en: "Contacted", ar: "اتكلّمنا معاه" },
  CLOSED: { en: "Closed", ar: "اتقفل" },
};
const VIEWS = [
  { code: "OPEN", en: "Open", ar: "مفتوح" },
  { code: "MINE", en: "Mine", ar: "بتاعتي" },
  { code: "CRITICAL", en: "Critical", ar: "حرج" },
  { code: "UNMATCHED", en: "Not matched", ar: "مش متربط بعميل" },
  { code: "ALL", en: "All", ar: "الكل" },
];

function Stars({ value }: { value: unknown }) {
  const count = Number(value) || 0;
  if (count === 0) return <span className="fb-stars is-empty">—</span>;
  return (
    <span className="fb-stars" aria-label={`${String(count)} / 5`}>
      {"★".repeat(count)}
      <span>{"★".repeat(5 - count)}</span>
    </span>
  );
}

export function FeedbackPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const { feedbackId } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [view, setView] = useState("OPEN");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);

  const summary = useQuery({
    queryKey: ["customer-feedback", "summary"],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-feedback/summary",
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const list = useQuery({
    queryKey: ["customer-feedback", "list", view, search, page],
    queryFn: async () => {
      const query: Record<string, string | number> = { page, limit: 25 };
      if (view === "MINE") query.mine = "true";
      if (view === "CRITICAL") query.critical = "true";
      if (view === "UNMATCHED") query.unmatched = "true";
      if (search) query.search = search;
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-feedback",
        { path: {}, query },
      );
      const meta =
        isObject(result.data) && isObject(result.data.meta)
          ? result.data.meta
          : {};
      const all = rows(result.data);
      return {
        rows:
          view === "OPEN"
            ? all.filter((row) => row.statusCode !== "CLOSED")
            : all,
        hasNext: meta.hasNext === true,
      };
    },
  });
  const s = summary.data ?? {};
  const weeks = Array.isArray(s.weeks) ? s.weeks.filter(isObject) : [];
  const distribution = Array.isArray(s.distribution)
    ? s.distribution.map((v) => Number(v) || 0)
    : [];
  const most = Math.max(1, ...distribution);
  const publicLink = `${window.location.origin}/feedback`;

  return (
    <section className="workspace-page feedback-inbox">
      <PageHeader
        kicker={txt("Customers", "العملاء")}
        title={txt("Customer feedback", "آراء العملاء")}
        actions={
          <button
            type="button"
            className="button-link"
            onClick={() => {
              void navigator.clipboard.writeText(publicLink).then(() => {
                toast.success(txt("Feedback link copied", "اتنسخ رابط الرأي"));
              });
            }}
          >
            {txt("Copy the customer link", "انسخ رابط العملاء")}
          </button>
        }
      />
      <ErrorBanner error={summary.error} retry={() => void summary.refetch()} />
      <div className="abp2-kpi-grid">
        <div
          className="abp2-kpi-card abp2-tone-ok"
          style={{ animationDelay: "80ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="CUSTOMERS" />
          </span>
          <span className="abp2-kpi-label">
            {txt("Average rating · 90 days", "متوسط التقييم · 90 يوم")}
          </span>
          <strong className="abp2-kpi-value">
            {s.average === null || s.average === undefined
              ? "—"
              : `${formatNum(Number(s.average), locale, { maximumFractionDigits: 2 })} / 5`}
          </strong>
          <span className="abp2-kpi-caption">
            {formatNum(Number(s.responses) || 0, locale)}{" "}
            {txt("rated responses", "تقييم")}
          </span>
        </div>
        <div
          className="abp2-kpi-card abp2-tone-info"
          style={{ animationDelay: "150ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="REPORTS" />
          </span>
          <span className="abp2-kpi-label">
            {txt("Satisfied (4–5 stars)", "راضيين (4–5 نجوم)")}
          </span>
          <strong className="abp2-kpi-value">
            {s.csatPct === null || s.csatPct === undefined
              ? "—"
              : `${formatNum(Number(s.csatPct), locale, { maximumFractionDigits: 1 })}%`}
          </strong>
          {typeof s.csatPct === "number" && (
            <div className="abp2-kpi-progress">
              <div className="abp2-kpi-progress-track">
                <div
                  className="abp2-kpi-progress-fill"
                  style={{ width: `${String(Math.min(100, s.csatPct))}%` }}
                />
              </div>
            </div>
          )}
        </div>
        <div
          className="abp2-kpi-card abp2-tone-warn"
          style={{ animationDelay: "220ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="NOTIFICATIONS" />
          </span>
          <span className="abp2-kpi-label">
            {txt("Waiting for a reply", "مستني رد")}
          </span>
          <strong className="abp2-kpi-value">
            {formatNum(Number(s.open) || 0, locale)}
          </strong>
          <span className="abp2-kpi-caption">
            {formatNum(Number(s.newCount) || 0, locale)}{" "}
            {txt("not yet seen", "لسه محدش شافها")}
          </span>
        </div>
        <div
          className="abp2-kpi-card abp2-tone-danger"
          style={{ animationDelay: "290ms" }}
        >
          <span className="abp2-kpi-icon" aria-hidden="true">
            <AppIcon id="APPROVALS" />
          </span>
          <span className="abp2-kpi-label">
            {txt("Critical, still open", "حرجة ولسه مفتوحة")}
          </span>
          <strong className="abp2-kpi-value">
            {formatNum(Number(s.criticalOpen) || 0, locale)}
          </strong>
          <span className="abp2-kpi-caption">
            {formatNum(Number(s.unmatched) || 0, locale)}{" "}
            {txt("not matched to a customer", "مش متربطة بعميل")}
          </span>
        </div>
      </div>
      <div className="fb-insights">
        <div className="panel fb-distribution">
          <h2>{txt("Ratings", "التقييمات")}</h2>
          {[5, 4, 3, 2, 1].map((star) => {
            const count = distribution[star - 1] ?? 0;
            return (
              <div key={star} className="fb-dist-row">
                <span>{star} ★</span>
                <div className="fb-dist-track">
                  <div
                    className={`fb-dist-fill star-${String(star)}`}
                    style={{ width: `${String((count / most) * 100)}%` }}
                  />
                </div>
                <strong>{formatNum(count, locale)}</strong>
              </div>
            );
          })}
        </div>
        <div className="panel fb-trend">
          <h2>
            {txt("Average rating, week by week", "متوسط التقييم أسبوع بأسبوع")}
          </h2>
          <Sparkline
            data={weeks.map((week) => Number(week.average) || 0)}
            color="#c81d25"
          />
          <p className="settings-hint">
            {txt("Responses in 13 weeks", "الردود في 13 أسبوع")}:{" "}
            {formatNum(
              weeks.reduce(
                (sum, week) => sum + (Number(week.responses) || 0),
                0,
              ),
              locale,
            )}
          </p>
        </div>
      </div>
      <div
        className="orders-filters"
        role="group"
        aria-label={txt("Show", "اعرض")}
      >
        {VIEWS.map((option) => (
          <button
            key={option.code}
            type="button"
            className={view === option.code ? "is-active" : ""}
            aria-pressed={view === option.code}
            onClick={() => {
              setView(option.code);
              setPage(1);
            }}
          >
            {ar ? option.ar : option.en}
          </button>
        ))}
      </div>
      <input
        type="search"
        aria-label={txt("Search feedback", "بحث الآراء")}
        placeholder={txt(
          "Search by name, company, reference or words",
          "ابحث بالاسم أو الشركة أو المرجع أو كلمة",
        )}
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
          setPage(1);
        }}
      />
      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <div className="panel">
        <div className="enterprise-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{txt("Received", "وصلت")}</th>
                <th>{txt("From", "من")}</th>
                <th>{txt("Customer", "العميل")}</th>
                <th>{txt("Kind", "النوع")}</th>
                <th>{txt("Rating", "التقييم")}</th>
                <th>{txt("Salesperson", "المندوب")}</th>
                <th>{txt("Status", "الحالة")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((row) => (
                <tr
                  key={text(row.feedbackId)}
                  className={row.isCritical === true ? "fb-row-critical" : ""}
                >
                  <td>
                    <Link to={`/customer-feedback/${text(row.feedbackId)}`}>
                      {text(row.feedbackRef)}
                    </Link>
                    <small className="fb-date">
                      {new Date(text(row.createdAt)).toLocaleDateString(
                        ar ? "ar-EG" : "en-GB",
                      )}
                    </small>
                  </td>
                  <td>
                    {text(row.contactName)}
                    {text(row.companyName) && (
                      <small className="fb-date">{text(row.companyName)}</small>
                    )}
                  </td>
                  <td>
                    {text(row.accountId) ? (
                      <Link to={`/customers/${text(row.accountId)}`}>
                        {text(row.accountName)}
                      </Link>
                    ) : (
                      <span className="fb-unmatched">
                        {txt("Not matched", "مش متربط")}
                      </span>
                    )}
                  </td>
                  <td>
                    {ar
                      ? KIND[text(row.kindCode)]?.ar
                      : KIND[text(row.kindCode)]?.en}
                    {row.isCritical === true && (
                      <span className="fb-critical">
                        {txt("Critical", "حرج")}
                      </span>
                    )}
                  </td>
                  <td>
                    <Stars value={row.rating} />
                  </td>
                  <td>{text(row.salespersonName) || "—"}</td>
                  <td>
                    <span className={`fb-status fb-${text(row.statusCode)}`}>
                      {ar
                        ? STATUS[text(row.statusCode)]?.ar
                        : STATUS[text(row.statusCode)]?.en}
                    </span>
                  </td>
                </tr>
              ))}
              {list.data?.rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="table-empty">
                    {txt(
                      "Nothing here. Share the customer link to start hearing from customers.",
                      "مفيش حاجة هنا. ابعت رابط العملاء عشان توصلك آراءهم.",
                    )}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
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
            disabled={!list.data?.hasNext}
            onClick={() => {
              setPage(page + 1);
            }}
          >
            {txt("Next", "التالي")}
          </button>
        </footer>
      </div>
      {feedbackId && (
        <FeedbackDetail
          client={client}
          me={me}
          id={feedbackId}
          onClose={() => void navigate("/customer-feedback")}
        />
      )}
    </section>
  );
}

function FeedbackDetail({
  client,
  id,
  onClose,
}: {
  client: ApiClient;
  me: Me;
  id: string;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const cache = useQueryClient();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [accountId, setAccountId] = useState("");
  const [escalate, setEscalate] = useState(false);
  const detail = useQuery({
    queryKey: ["customer-feedback", "one", id],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/customer-feedback/{feedbackId}",
        {
          path: { feedbackId: id },
        },
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const row: Rec = detail.data ?? {};
  const followUps = Array.isArray(row.allowedFollowUps)
    ? row.allowedFollowUps.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const refresh = async (message: string) => {
    setNote("");
    await cache.invalidateQueries({ queryKey: ["customer-feedback"] });
    toast.success(message);
  };
  const follow = useMutation({
    mutationFn: (to: string) =>
      commercialRequest(
        client,
        "POST",
        "/customer-feedback/{feedbackId}/follow-ups",
        {
          path: { feedbackId: id },
          body: {
            expectedRowVersion: text(row.rowVersion),
            targetStatusCode: to,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        },
      ),
    onSuccess: () => refresh(txt("Updated", "اتحدّث")),
  });
  const link = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "POST",
        "/customer-feedback/{feedbackId}/link",
        {
          path: { feedbackId: id },
          body: {
            expectedRowVersion: text(row.rowVersion),
            accountId,
            openComplaint: escalate,
          },
        },
      ),
    onSuccess: () => refresh(txt("Matched to the customer", "اتربطت بالعميل")),
  });
  const openComplaint = useMutation({
    mutationFn: () =>
      commercialRequest(
        client,
        "POST",
        "/customer-feedback/{feedbackId}/link",
        {
          path: { feedbackId: id },
          body: {
            expectedRowVersion: text(row.rowVersion),
            accountId: text(row.accountId),
            openComplaint: true,
          },
        },
      ),
    onSuccess: () => refresh(txt("Complaint opened", "اتفتحت شكوى")),
  });

  return (
    <SlideOver
      title={text(row.feedbackRef) || txt("Feedback", "رأي")}
      onClose={onClose}
      width={760}
    >
      <ErrorBanner error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && (
        <div className="complaint-detail">
          <div
            className={`complaint-now${row.isCritical === true ? " is-late" : ""}`}
          >
            <span>
              <strong>
                {ar
                  ? KIND[text(row.kindCode)]?.ar
                  : KIND[text(row.kindCode)]?.en}
              </strong>
              {row.isCritical === true && ` · ${txt("critical", "حرج")}`}
            </span>
            <Stars value={row.rating} />
            <span>
              {new Date(text(row.createdAt)).toLocaleString(
                ar ? "ar-EG" : "en-GB",
              )}
            </span>
          </div>
          <blockquote className="fb-message">{text(row.message)}</blockquote>
          <div className="fb-contact">
            <div>
              <strong>{text(row.contactName)}</strong>
              <span>
                {[text(row.jobTitle), text(row.companyName)]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
              {row.consentToContact !== true && (
                <em>
                  {txt("Asked not to be contacted", "طلب محدش يتواصل معاه")}
                </em>
              )}
            </div>
            <div className="fb-contact-actions">
              {text(row.phoneDial) && (
                <a className="button-link" href={`tel:${text(row.phoneDial)}`}>
                  {txt("Call", "اتصل")} {text(row.phone)}
                </a>
              )}
              {text(row.whatsappLink) && (
                <a
                  className="button-link"
                  href={text(row.whatsappLink)}
                  target="_blank"
                  rel="noreferrer"
                >
                  WhatsApp
                </a>
              )}
              {text(row.email) && (
                <a
                  className="button-link"
                  href={`mailto:${text(row.email)}?subject=${encodeURIComponent(text(row.feedbackRef))}`}
                >
                  {text(row.email)}
                </a>
              )}
            </div>
          </div>
          <dl className="quotation-fact-grid">
            <div>
              <dt>{txt("They quoted", "المرجع اللي كتبه")}</dt>
              <dd>{text(row.referenceText)}</dd>
            </div>
            <div>
              <dt>{txt("Customer", "العميل")}</dt>
              <dd>
                {text(row.accountId) ? (
                  <Link to={`/customers/${text(row.accountId)}`}>
                    {text(row.accountName)}
                  </Link>
                ) : (
                  <span className="fb-unmatched">
                    {txt("Not matched", "مش متربط")}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Order", "الأوردر")}</dt>
              <dd>
                {text(row.customerOrderId) ? (
                  <Link to={`/customer-orders/${text(row.customerOrderId)}`}>
                    {text(row.orderRef)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Quotation", "عرض السعر")}</dt>
              <dd>
                {text(row.quotationId) ? (
                  <Link to={`/quotations/${text(row.quotationId)}`}>
                    {text(row.quotationRef)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Item", "الصنف")}</dt>
              <dd>{text(row.productName) || "—"}</dd>
            </div>
            <div>
              <dt>{txt("Salesperson", "المندوب")}</dt>
              <dd>{text(row.salespersonName) || "—"}</dd>
            </div>
            <div>
              <dt>{txt("Complaint", "الشكوى")}</dt>
              <dd>
                {text(row.complaintId) ? (
                  <Link to={`/complaints/${text(row.complaintId)}`}>
                    {text(row.complaintRef)}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Status", "الحالة")}</dt>
              <dd>
                {ar
                  ? STATUS[text(row.statusCode)]?.ar
                  : STATUS[text(row.statusCode)]?.en}
                {text(row.followedUpByName) &&
                  ` · ${text(row.followedUpByName)}`}
              </dd>
            </div>
          </dl>
          {text(row.followUpNote) && (
            <p className="complaint-description">{text(row.followUpNote)}</p>
          )}

          {row.canLink === true && (
            <form
              className="complaint-work orders-amend"
              onSubmit={(event) => {
                event.preventDefault();
                link.mutate();
              }}
            >
              <h3>{txt("Match to a customer", "اربطها بعميل")}</h3>
              <AccountPicker
                client={client}
                value={accountId}
                onChange={setAccountId}
              />
              <label className="auth-remember">
                <input
                  type="checkbox"
                  checked={escalate}
                  onChange={() => {
                    setEscalate(!escalate);
                  }}
                />
                {txt("Also open a complaint", "وافتح شكوى كمان")}
              </label>
              <ErrorBanner
                error={link.error}
                retry={() => {
                  link.mutate();
                }}
              />
              <button
                className="primary"
                disabled={accountId === "" || link.isPending}
              >
                {txt("Match", "اربط")}
              </button>
            </form>
          )}
          {row.canOpenComplaint === true && (
            <div className="complaint-moves">
              <button
                type="button"
                className="ghost"
                disabled={openComplaint.isPending}
                onClick={() => {
                  openComplaint.mutate();
                }}
              >
                {txt("Open a complaint from this", "افتح شكوى من ده")}
              </button>
            </div>
          )}
          {followUps.length > 0 && (
            <div className="complaint-work orders-amend">
              <h3>{txt("Follow up", "المتابعة")}</h3>
              <label>
                {txt("What was said or done", "اتقال أو اتعمل إيه")}
                <textarea
                  value={note}
                  maxLength={2000}
                  onChange={(e) => {
                    setNote(e.target.value);
                  }}
                />
              </label>
              <ErrorBanner
                error={follow.error ?? openComplaint.error}
                retry={() => undefined}
              />
              <div className="complaint-moves">
                {followUps.map((to) => (
                  <button
                    key={to}
                    type="button"
                    className={to === "CLOSED" ? "ghost" : "primary"}
                    disabled={
                      follow.isPending ||
                      (to === "CLOSED" &&
                        !note.trim() &&
                        !text(row.followUpNote))
                    }
                    onClick={() => {
                      follow.mutate(to);
                    }}
                  >
                    {to === "ACKNOWLEDGED"
                      ? txt("Mark as seen", "اتشافت")
                      : to === "CONTACTED"
                        ? txt("I contacted them", "اتكلمت معاه")
                        : txt("Close", "اقفل")}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </SlideOver>
  );
}
