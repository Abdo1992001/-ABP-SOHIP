import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import {
  createComplaint,
  getComplaint,
  listComplaints,
  transitionComplaint,
  updateComplaint,
  type ComplaintMoveFields,
} from "../api/complaints-api.ts";
import {
  listResourceDocuments,
  uploadFileAsAttachment,
} from "../api/documents-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject } from "./commercial-api.ts";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";
import { AccountPicker } from "./AccountPicker.tsx";
import { downloadDocument } from "./DownloadTray.tsx";
import { localToday } from "../lib/today.ts";

/**
 * Complaints, routed: Sales logs it, Operations finds out what happened,
 * Quality names the root cause, a named owner fixes it by a date, Sales
 * confirms with the customer and closes it.
 *
 * The moves offered come from the server, per person -- the screen never
 * keeps its own copy of the route, because the copy it used to keep allowed
 * moves the server refused.
 */

const COMPLAINT_TYPES = [
  { value: "PRODUCT_QUALITY", en: "Product quality", ar: "جودة المنتج" },
  { value: "DELIVERY_DELAY", en: "Delivery delay", ar: "تأخير التسليم" },
  { value: "BILLING", en: "Billing / invoice", ar: "الفواتير" },
  { value: "SERVICE", en: "Service / behaviour", ar: "الخدمة والتعامل" },
  { value: "DAMAGED_GOODS", en: "Damaged goods", ar: "بضاعة تالفة" },
  { value: "OTHER", en: "Other", ar: "أخرى" },
];
/** Categories older cases carry, named but no longer offered for new ones. */
const LEGACY_TYPES = [{ value: "DELIVERY", en: "Delivery", ar: "التسليم" }];
const SEVERITIES = [
  { value: "LOW", en: "Low", ar: "منخفضة" },
  { value: "MEDIUM", en: "Medium", ar: "متوسطة" },
  { value: "HIGH", en: "High", ar: "عالية" },
  { value: "CRITICAL", en: "Critical", ar: "حرجة" },
];
const CHANNELS = [
  { value: "PHONE_CALL", en: "Phone call", ar: "مكالمة هاتفية" },
  { value: "MESSAGE", en: "Written message", ar: "رسالة مكتوبة" },
  { value: "VISIT", en: "In-person visit", ar: "زيارة" },
  { value: "EMAIL", en: "Email", ar: "بريد إلكتروني" },
];
/** The route, in order, with who works each stage. */
const STAGES = [
  {
    code: "OPEN",
    en: "Logged",
    ar: "اتسجّلت",
    who: { en: "Sales", ar: "المبيعات" },
  },
  {
    code: "OPERATIONS_REVIEW",
    en: "Operations",
    ar: "العمليات",
    who: { en: "Operations", ar: "العمليات" },
  },
  {
    code: "QUALITY_REVIEW",
    en: "Quality",
    ar: "الجودة",
    who: { en: "Quality (R&D)", ar: "الجودة (R&D)" },
  },
  {
    code: "SOLUTION",
    en: "Solution",
    ar: "الحل",
    who: { en: "Solution owner", ar: "مسؤول الحل" },
  },
  {
    code: "RESOLVED",
    en: "Resolved",
    ar: "اتحلّت",
    who: { en: "Sales", ar: "المبيعات" },
  },
  { code: "CLOSED", en: "Closed", ar: "اتقفلت", who: { en: "—", ar: "—" } },
] as const;
const ROOT_CAUSES = [
  { value: "MATERIAL", en: "Raw material", ar: "خامة" },
  { value: "PRODUCTION", en: "Production / process", ar: "تصنيع" },
  { value: "PACKAGING", en: "Packaging", ar: "تغليف" },
  { value: "LOADING", en: "Loading", ar: "تحميل" },
  { value: "TRANSPORT", en: "Transport", ar: "نقل" },
  { value: "SITE_HANDLING", en: "Handling at site", ar: "تداول في الموقع" },
  {
    value: "SPECIFICATION",
    en: "Specification / order entry",
    ar: "مواصفات / إدخال الطلب",
  },
  { value: "DOCUMENTATION", en: "Documents", ar: "مستندات" },
  { value: "BILLING", en: "Billing", ar: "فواتير" },
  { value: "SERVICE", en: "Service", ar: "خدمة" },
  { value: "NOT_JUSTIFIED", en: "Not justified", ar: "الشكوى مش في محلها" },
  { value: "OTHER", en: "Other", ar: "أخرى" },
];
const QUEUES = [
  { code: "", en: "All", ar: "الكل" },
  { code: "MINE", en: "With me", ar: "عندي" },
  { code: "OVERDUE", en: "Late", ar: "متأخرة" },
  ...STAGES.map((stage) => ({ code: stage.code, en: stage.en, ar: stage.ar })),
];

type Rec = Record<string, unknown>;
type StageCode = (typeof STAGES)[number]["code"];
const isStage = (value: string): value is StageCode =>
  STAGES.some((stage) => stage.code === value);
const text = (value: unknown): string =>
  typeof value === "string" ? value : "";
const pick = (
  list: { value: string; en: string; ar: string }[],
  code: unknown,
  ar: boolean,
) => {
  const found = list.find((one) => one.value === code);
  return found === undefined ? text(code) || "—" : ar ? found.ar : found.en;
};
/** The row version, from the ETag the API sends ("rv-12"). */
const versionOf = (etag: string | null | undefined) =>
  /\d+/.exec(etag ?? "")?.[0] ?? "";

type FieldName =
  | "reason"
  | "operationsFindings"
  | "rootCauseCode"
  | "rootCauseDetail"
  | "correctiveAction"
  | "preventiveAction"
  | "solutionOwnerUserId"
  | "solutionDueDate"
  | "resolution"
  | "assigneeUserId";

export function ComplaintsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const navigate = useNavigate();
  const { complaintId } = useParams();
  const cache = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [queue, setQueue] = useState("");
  const [creating, setCreating] = useState(false);
  const [accountId, setAccountId] = useState("");
  const [complaintTypeCode, setComplaintTypeCode] = useState(
    COMPLAINT_TYPES[0]?.value ?? "OTHER",
  );
  const [severityCode, setSeverityCode] = useState("MEDIUM");
  const [channelCode, setChannelCode] = useState(CHANNELS[0]?.value ?? "");
  const [description, setDescription] = useState("");

  const list = useQuery({
    queryKey: ["complaints", page, search, queue],
    queryFn: () =>
      listComplaints(client, page, search || undefined, {
        ...(queue === "MINE" ? { assignedToMe: "true" as const } : {}),
        ...(queue === "OVERDUE" ? { overdue: "true" as const } : {}),
        ...(isStage(queue) ? { statusCode: queue } : {}),
      }),
  });

  const create = useMutation({
    mutationFn: () =>
      createComplaint(client, {
        accountId,
        complaintTypeCode,
        severityCode,
        channelCode: (channelCode || null) as
          "PHONE_CALL" | "MESSAGE" | "VISIT" | "EMAIL" | null,
        description,
      }),
    onSuccess: async (result) => {
      setCreating(false);
      setDescription("");
      setAccountId("");
      await cache.invalidateQueries({ queryKey: ["complaints"] });
      toast.success(txt("Complaint logged", "اتسجّلت الشكوى"));
      void navigate(`/complaints/${result.data.complaintId}`);
    },
  });

  const canCreate = me.access.permissions.includes("complaints.create");
  const stageName = (code: unknown) => {
    const stage = STAGES.find((one) => one.code === code);
    return stage === undefined
      ? enumLabel(text(code), locale)
      : ar
        ? stage.ar
        : stage.en;
  };

  return (
    <section className="workspace-page complaints-page">
      <PageHeader
        kicker={txt("Customer service", "خدمة العملاء")}
        title={txt("Complaints", "الشكاوى")}
        {...(typeof list.data?.meta.total === "number"
          ? { count: list.data.meta.total }
          : {})}
        actions={
          canCreate && (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setCreating(true);
              }}
            >
              {txt("+ Log complaint", "+ تسجيل شكوى")}
            </button>
          )
        }
      />
      <div
        className="orders-filters"
        role="group"
        aria-label={txt("Show", "اعرض")}
      >
        {QUEUES.map((option) => (
          <button
            key={option.code || "ALL"}
            type="button"
            className={queue === option.code ? "is-active" : ""}
            aria-pressed={queue === option.code}
            onClick={() => {
              setQueue(option.code);
              setPage(1);
            }}
          >
            {ar ? option.ar : option.en}
          </button>
        ))}
      </div>
      <input
        type="search"
        aria-label={txt("Search complaints", "بحث الشكاوى")}
        placeholder={txt(
          "Search by reference, customer or description",
          "ابحث بالرقم أو العميل أو الوصف",
        )}
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />
      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <div className="panel">
        <div className="enterprise-table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>{txt("Reference", "الرقم")}</th>
                <th>{txt("Customer", "العميل")}</th>
                <th>{txt("Category", "التصنيف")}</th>
                <th>{txt("Severity", "الخطورة")}</th>
                <th>{txt("Stage", "المرحلة")}</th>
                <th>{txt("With", "عند")}</th>
                <th>{txt("Stage due", "ميعاد المرحلة")}</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.data.map((c) => {
                const row = c as Rec;
                return (
                  <tr key={c.complaintId}>
                    <td>
                      <Link to={`/complaints/${c.complaintId}`}>
                        {c.complaintRef ?? c.complaintId}
                      </Link>
                    </td>
                    <td>{text(row.accountName) || "—"}</td>
                    <td>
                      {pick(
                        [...COMPLAINT_TYPES, ...LEGACY_TYPES],
                        c.complaintTypeCode,
                        ar,
                      )}
                    </td>
                    <td>
                      <StatusChip code={c.severityCode} />
                    </td>
                    <td>
                      <span
                        className={`complaint-stage-tag stage-${c.statusCode ?? "OPEN"}`}
                      >
                        {stageName(c.statusCode)}
                      </span>
                    </td>
                    <td>{text(row.assigneeName) || "—"}</td>
                    <td>
                      {text(row.stageDueAt) && c.statusCode !== "CLOSED" ? (
                        <span
                          className={
                            row.isOverdue === true ? "complaint-late" : ""
                          }
                        >
                          {new Date(text(row.stageDueAt)).toLocaleDateString(
                            ar ? "ar-EG" : "en-GB",
                          )}
                          {row.isOverdue === true &&
                            ` · ${txt("late", "متأخرة")}`}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })}
              {list.data?.data.length === 0 && (
                <tr>
                  <td colSpan={7} className="table-empty">
                    {txt("No complaints here.", "مفيش شكاوى هنا.")}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {list.isLoading && (
          <div className="skeleton-stack" role="status">
            <span />
            <span />
            <span />
          </div>
        )}
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
      {creating && (
        <SlideOver
          title={txt("Log complaint", "تسجيل شكوى")}
          onClose={() => {
            setCreating(false);
          }}
        >
          <form
            className="orders-amend"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <AccountPicker
              client={client}
              value={accountId}
              onChange={setAccountId}
            />
            <label>
              {txt("Category", "التصنيف")}
              <select
                value={complaintTypeCode}
                onChange={(e) => {
                  setComplaintTypeCode(e.target.value);
                }}
              >
                {COMPLAINT_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {ar ? t.ar : t.en}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {txt("Severity", "الخطورة")}
              <select
                value={severityCode}
                onChange={(e) => {
                  setSeverityCode(e.target.value);
                }}
              >
                {SEVERITIES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {ar ? s.ar : s.en}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {txt("How was it reported?", "طريقة الإبلاغ")}
              <select
                value={channelCode}
                onChange={(e) => {
                  setChannelCode(e.target.value);
                }}
              >
                {CHANNELS.map((c) => (
                  <option key={c.value} value={c.value}>
                    {ar ? c.ar : c.en}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {txt("Description", "الوصف")}
              <textarea
                required
                minLength={3}
                maxLength={5000}
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                }}
              />
            </label>
            <ErrorBanner
              error={create.error}
              retry={() => {
                create.mutate();
              }}
            />
            <button className="primary" disabled={create.isPending}>
              {create.isPending ? "…" : txt("Save complaint", "حفظ الشكوى")}
            </button>
          </form>
        </SlideOver>
      )}
      {complaintId && (
        <ComplaintDetail
          client={client}
          me={me}
          complaintId={complaintId}
          stageName={stageName}
          onClose={() => void navigate("/complaints")}
        />
      )}
    </section>
  );
}

function ComplaintDetail({
  client,
  me,
  complaintId,
  stageName,
  onClose,
}: {
  client: ApiClient;
  me: Me;
  complaintId: string;
  stageName: (code: unknown) => string;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const cache = useQueryClient();
  const toast = useToast();
  const [draft, setDraft] = useState<Partial<Record<FieldName, string>>>({});
  const [moving, setMoving] = useState<Rec | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string>();

  const detail = useQuery({
    queryKey: ["complaint", complaintId],
    queryFn: () => getComplaint(client, complaintId),
  });
  const attachments = useQuery({
    queryKey: ["complaint-attachments", complaintId],
    queryFn: () => listResourceDocuments(client, "COMPLAINT", complaintId),
  });
  const people = usePeople(client, me);
  const data = (detail.data?.data ?? {}) as Rec;
  const status = text(data.statusCode) || "OPEN";
  const version = versionOf(detail.data?.etag);
  const moves = Array.isArray(data.allowedTransitions)
    ? data.allowedTransitions.filter(isObject)
    : [];
  const events = Array.isArray(data.events) ? data.events.filter(isObject) : [];
  const value = (field: FieldName) => draft[field] ?? text(data[field]);

  const refresh = async (message: string) => {
    setDraft({});
    await cache.invalidateQueries({ queryKey: ["complaints"] });
    await cache.invalidateQueries({ queryKey: ["complaint", complaintId] });
    toast.success(message);
  };
  const save = useMutation({
    mutationFn: () =>
      updateComplaint(
        client,
        complaintId,
        detail.data?.etag ?? "",
        draftBody(draft),
      ),
    onSuccess: () => refresh(txt("Saved", "اتحفظ")),
  });

  const stageIndex = STAGES.findIndex((stage) => stage.code === status);
  const fieldsHere: FieldName[] =
    status === "OPERATIONS_REVIEW"
      ? ["operationsFindings", "rootCauseCode"]
      : status === "QUALITY_REVIEW"
        ? [
            "rootCauseCode",
            "rootCauseDetail",
            "correctiveAction",
            "preventiveAction",
          ]
        : status === "SOLUTION"
          ? ["correctiveAction", "preventiveAction", "resolution"]
          : status === "RESOLVED"
            ? ["resolution"]
            : [];
  const dirty = Object.keys(draft).length > 0;

  const upload = async () => {
    const file = fileInput.current?.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(undefined);
    try {
      await uploadFileAsAttachment(
        client,
        file,
        "COMPLAINT_ATTACHMENT",
        "COMPLAINT",
        complaintId,
      );
      if (fileInput.current) fileInput.current.value = "";
      await cache.invalidateQueries({
        queryKey: ["complaint-attachments", complaintId],
      });
      toast.success(txt("Attachment uploaded", "تم رفع المرفق"));
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "UPLOAD_FAILED");
    } finally {
      setUploading(false);
    }
  };

  return (
    <SlideOver
      title={text(data.complaintRef) || txt("Complaint", "شكوى")}
      onClose={onClose}
      width={860}
    >
      <ErrorBanner error={detail.error} retry={() => void detail.refetch()} />
      {detail.data && (
        <div className="complaint-detail">
          <ol
            className="complaint-route"
            aria-label={txt("Complaint route", "مسار الشكوى")}
          >
            {STAGES.map((stage, index) => (
              <li
                key={stage.code}
                className={
                  index < stageIndex
                    ? "is-done"
                    : index === stageIndex
                      ? "is-current"
                      : ""
                }
              >
                <strong>{ar ? stage.ar : stage.en}</strong>
                <span>{ar ? stage.who.ar : stage.who.en}</span>
              </li>
            ))}
          </ol>

          <div
            className={`complaint-now${data.isOverdue === true ? " is-late" : ""}`}
          >
            <span>
              {txt("Now with", "دلوقتي عند")}{" "}
              <strong>
                {text(data.assigneeName) ||
                  txt("the team queue", "طابور الفريق")}
              </strong>
            </span>
            {text(data.stageDueAt) && status !== "CLOSED" && (
              <span>
                {txt("Stage due", "ميعاد المرحلة")}{" "}
                <strong>
                  {new Date(text(data.stageDueAt)).toLocaleString(
                    ar ? "ar-EG" : "en-GB",
                    {
                      dateStyle: "medium",
                      timeStyle: "short",
                    },
                  )}
                </strong>
                {data.isOverdue === true && ` · ${txt("late", "متأخرة")}`}
              </span>
            )}
          </div>

          {moves.length > 0 && (
            <div className="complaint-moves">
              {moves.map((move) => (
                <button
                  key={text(move.targetStatusCode)}
                  type="button"
                  className={move.back === true ? "ghost" : "primary"}
                  onClick={() => {
                    setMoving(move);
                  }}
                >
                  {moveLabel(
                    text(move.targetStatusCode),
                    move.back === true,
                    ar,
                  )}
                </button>
              ))}
            </div>
          )}

          <dl className="quotation-fact-grid">
            <div>
              <dt>{txt("Customer", "العميل")}</dt>
              <dd>
                <Link to={`/customers/${text(data.accountId)}`}>
                  {text(data.accountName) || txt("Open customer", "فتح العميل")}
                </Link>
              </dd>
            </div>
            <div>
              <dt>{txt("Order", "الأوردر")}</dt>
              <dd>
                {text(data.customerOrderId) ? (
                  <Link to={`/customer-orders/${text(data.customerOrderId)}`}>
                    {text(data.orderRef) || "…"}
                  </Link>
                ) : (
                  "—"
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Category", "التصنيف")}</dt>
              <dd>
                {pick(
                  [...COMPLAINT_TYPES, ...LEGACY_TYPES],
                  data.complaintTypeCode,
                  ar,
                )}
              </dd>
            </div>
            <div>
              <dt>{txt("Severity", "الخطورة")}</dt>
              <dd>
                <StatusChip code={text(data.severityCode) || null} />
              </dd>
            </div>
            <div>
              <dt>{txt("Reported via", "طريقة الإبلاغ")}</dt>
              <dd>{pick(CHANNELS, data.channelCode, ar)}</dd>
            </div>
            <div>
              <dt>{txt("Logged by", "سجّلها")}</dt>
              <dd>{text(data.ownerName) || "—"}</dd>
            </div>
          </dl>
          <p className="complaint-description">{text(data.description)}</p>

          <div className="complaint-record">
            <CaseNote
              title={txt("What Operations found", "اللي العمليات لقيته")}
              body={text(data.operationsFindings)}
            />
            <CaseNote
              title={txt("Root cause", "السبب الجذري")}
              body={[
                text(data.rootCauseCode)
                  ? pick(ROOT_CAUSES, data.rootCauseCode, ar)
                  : "",
                text(data.rootCauseDetail),
              ]
                .filter(Boolean)
                .join(" — ")}
            />
            <CaseNote
              title={txt("Corrective action", "الإجراء التصحيحي")}
              body={text(data.correctiveAction)}
              aside={
                text(data.solutionOwnerName)
                  ? `${text(data.solutionOwnerName)} · ${txt("by", "قبل")} ${text(data.solutionDueDate)}`
                  : ""
              }
            />
            <CaseNote
              title={txt("Preventive action", "الإجراء الوقائي")}
              body={text(data.preventiveAction)}
            />
            <CaseNote
              title={txt("Resolution", "الحل")}
              body={text(data.resolution)}
            />
          </div>

          {data.canEditStage === true && fieldsHere.length > 0 && (
            <form
              className="complaint-work orders-amend"
              onSubmit={(event) => {
                event.preventDefault();
                save.mutate();
              }}
            >
              <h3>
                {txt("Work on this stage", "شغل المرحلة دي")}:{" "}
                {stageName(status)}
              </h3>
              {fieldsHere.map((field) => (
                <StageField
                  key={field}
                  field={field}
                  value={value(field)}
                  people={people}
                  onChange={(next) => {
                    setDraft((current) => ({ ...current, [field]: next }));
                  }}
                />
              ))}
              <ErrorBanner
                error={save.error}
                retry={() => {
                  save.mutate();
                }}
              />
              <button disabled={!dirty || save.isPending}>
                {save.isPending ? "…" : txt("Save notes", "حفظ")}
              </button>
            </form>
          )}

          <section className="complaint-history">
            <h3>{txt("History", "السجل")}</h3>
            <ol>
              {events.map((event) => (
                <li key={text(event.eventId)}>
                  <time>
                    {new Date(text(event.createdAt)).toLocaleString(
                      ar ? "ar-EG" : "en-GB",
                    )}
                  </time>
                  <strong>
                    {text(event.eventCode) === "LOGGED"
                      ? txt("Logged", "اتسجّلت")
                      : text(event.eventCode) === "UPDATED"
                        ? txt("Notes updated", "اتحدّثت الملاحظات")
                        : `${stageName(event.fromStatusCode)} → ${stageName(event.toStatusCode)}${
                            text(event.eventCode) === "SENT_BACK"
                              ? ` (${txt("sent back", "اترجعت")})`
                              : ""
                          }`}
                  </strong>
                  <span>{text(event.actorName)}</span>
                  {text(event.note) && <em>{text(event.note)}</em>}
                </li>
              ))}
              {events.length === 0 && (
                <li className="empty-inline">
                  {txt(
                    "No history yet — this complaint predates the routed workflow.",
                    "مفيش سجل — الشكوى دي أقدم من مسار المتابعة الجديد.",
                  )}
                </li>
              )}
            </ol>
          </section>

          <section>
            <h3>{txt("Attachments", "المرفقات")}</h3>
            <p className="empty-inline">
              {txt(
                "Photos or videos, up to 25MB per file.",
                "صور أو فيديو، حتى 25 ميجابايت لكل ملف.",
              )}
            </p>
            <ErrorBanner
              error={attachments.error}
              retry={() => void attachments.refetch()}
            />
            <ul>
              {attachments.data?.map((doc) => (
                <li key={doc.documentId}>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      void downloadDocument(
                        client,
                        doc.documentId,
                        doc.displayName ?? "attachment",
                      );
                    }}
                  >
                    {doc.displayName ?? doc.documentId}
                  </button>
                </li>
              ))}
            </ul>
            {data.canEditStage === true && (
              <>
                <input
                  ref={fileInput}
                  type="file"
                  accept="image/png,image/jpeg,video/mp4,application/pdf"
                  aria-label={txt("Choose file", "اختر ملف")}
                />
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    void upload();
                  }}
                >
                  {uploading
                    ? txt("Uploading…", "جار الرفع…")
                    : txt("Upload attachment", "رفع مرفق")}
                </button>
                {uploadError && <p className="field-warning">{uploadError}</p>}
              </>
            )}
          </section>
        </div>
      )}
      {moving && (
        <MoveDialog
          client={client}
          complaintId={complaintId}
          version={version}
          move={moving}
          current={data}
          draft={draft}
          people={people}
          stageName={stageName}
          onClose={() => {
            setMoving(null);
          }}
          onDone={async () => {
            setMoving(null);
            await refresh(txt("Complaint moved", "الشكوى اتنقلت"));
          }}
        />
      )}
    </SlideOver>
  );
}

function CaseNote({
  title,
  body,
  aside,
}: {
  title: string;
  body: string;
  aside?: string;
}) {
  if (body === "") return null;
  return (
    <div>
      <h4>{title}</h4>
      <p>{body}</p>
      {aside ? <small>{aside}</small> : null}
    </div>
  );
}

type Person = { userId: string; displayName: string };

/** Colleagues to route a complaint to, with the signed-in user first. */
function usePeople(client: ApiClient, me: Me): Person[] {
  const directory = useQuery({
    queryKey: ["people-directory", ""],
    queryFn: () =>
      commercialRequest(client, "GET", "/messages/directory", {
        path: {},
        query: { limit: 100 },
      }),
    staleTime: 5 * 60_000,
  });
  const rows =
    isObject(directory.data?.data) && Array.isArray(directory.data.data.data)
      ? directory.data.data.data.filter(isObject)
      : [];
  return [
    { userId: me.user.userId, displayName: me.user.displayName },
    ...rows
      .map((row) => ({
        userId: text(row.userId),
        displayName: text(row.displayName),
      }))
      .filter(
        (person) => person.userId !== "" && person.userId !== me.user.userId,
      ),
  ];
}

function StageField({
  field,
  value,
  people,
  onChange,
}: {
  field: FieldName;
  value: string;
  people: Person[];
  onChange: (value: string) => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const labels: Record<FieldName, string> = {
    reason: txt("Why is it going back?", "ليه بترجع؟"),
    operationsFindings: txt(
      "What Operations found (order, load, delivery)",
      "اللي العمليات لقيته (الأوردر، التحميل، التسليم)",
    ),
    rootCauseCode: txt("Root cause", "السبب الجذري"),
    rootCauseDetail: txt("Root cause in detail", "تفاصيل السبب"),
    correctiveAction: txt("Corrective action", "الإجراء التصحيحي"),
    preventiveAction: txt(
      "Preventive action (stops it recurring)",
      "الإجراء الوقائي (يمنع التكرار)",
    ),
    solutionOwnerUserId: txt("Who owns the solution", "مسؤول الحل"),
    solutionDueDate: txt("Solution due by", "الحل مطلوب قبل"),
    resolution: txt("What was done for the customer", "اتعمل إيه للعميل"),
    assigneeUserId: txt("Hand it to", "سلّمها لـ"),
  };
  if (field === "rootCauseCode")
    return (
      <label>
        {labels[field]}
        <select
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">{txt("Choose…", "اختار…")}</option>
          {ROOT_CAUSES.map((cause) => (
            <option key={cause.value} value={cause.value}>
              {ar ? cause.ar : cause.en}
            </option>
          ))}
        </select>
      </label>
    );
  if (field === "solutionOwnerUserId" || field === "assigneeUserId")
    return (
      <label>
        {labels[field]}
        <select
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">
            {field === "assigneeUserId"
              ? txt("The team queue", "طابور الفريق")
              : txt("Choose…", "اختار…")}
          </option>
          {people.map((person) => (
            <option key={person.userId} value={person.userId}>
              {person.displayName}
            </option>
          ))}
        </select>
      </label>
    );
  if (field === "solutionDueDate")
    return (
      <label>
        {labels[field]}
        <input
          type="date"
          value={value}
          min={localToday()}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      </label>
    );
  return (
    <label>
      {labels[field]}
      <textarea
        value={value}
        maxLength={field === "reason" ? 1000 : 5000}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </label>
  );
}

function moveLabel(to: string, back: boolean, ar: boolean): string {
  const t = (en: string, arabic: string) => (ar ? arabic : en);
  if (back)
    return to === "OPEN"
      ? t("Return to Sales", "رجّعها للمبيعات")
      : to === "OPERATIONS_REVIEW"
        ? t("Back to Operations", "رجّعها للعمليات")
        : to === "QUALITY_REVIEW"
          ? t("Back to Quality", "رجّعها للجودة")
          : t("Reopen the solution", "افتح الحل تاني");
  return to === "OPERATIONS_REVIEW"
    ? t("Send to Operations", "ابعتها للعمليات")
    : to === "QUALITY_REVIEW"
      ? t("Send to Quality", "ابعتها للجودة")
      : to === "SOLUTION"
        ? t("Set the solution", "حدّد الحل")
        : to === "RESOLVED"
          ? t("Mark resolved", "اتحلّت")
          : t("Close — customer accepted", "اقفلها — العميل وافق");
}

function MoveDialog({
  client,
  complaintId,
  version,
  move,
  current,
  draft,
  people,
  stageName,
  onClose,
  onDone,
}: {
  client: ApiClient;
  complaintId: string;
  version: string;
  move: Rec;
  current: Rec;
  draft: Partial<Record<FieldName, string>>;
  people: Person[];
  stageName: (code: unknown) => string;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const to = text(move.targetStatusCode);
  const required = (Array.isArray(move.requires) ? move.requires : []).filter(
    (field): field is FieldName => typeof field === "string",
  );
  // A review can be handed to a named person; a solution can carry its
  // preventive action. Neither is required.
  const optional: FieldName[] = [
    ...(to === "OPERATIONS_REVIEW" || to === "QUALITY_REVIEW"
      ? (["assigneeUserId"] as const)
      : []),
    ...(to === "SOLUTION" && !required.includes("preventiveAction")
      ? (["preventiveAction"] as const)
      : []),
  ];
  const fields = [...required, ...optional];
  const [values, setValues] = useState<Partial<Record<FieldName, string>>>(() =>
    Object.fromEntries(
      fields.map((field) => [
        field,
        draft[field] ??
          (field === "reason" || field === "assigneeUserId"
            ? ""
            : text(current[field])),
      ]),
    ),
  );
  const missing = required.filter(
    (field) =>
      (values[field] ?? "").trim().length < (field === "reason" ? 3 : 1),
  );
  const send = useMutation({
    mutationFn: () => {
      const body: ComplaintMoveFields = {};
      for (const field of fields) {
        const entry = (values[field] ?? "").trim();
        if (entry !== "") (body as Record<string, string>)[field] = entry;
      }
      return transitionComplaint(client, complaintId, version, to, body);
    },
    onSuccess: () => onDone(),
  });
  return (
    <SlideOver
      title={`${moveLabel(to, move.back === true, ar)} → ${stageName(to)}`}
      onClose={onClose}
    >
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          send.mutate();
        }}
      >
        {fields.length === 0 && (
          <p className="settings-hint">
            {txt(
              "Nothing else is needed for this step.",
              "مش محتاجة أي حاجة تانية.",
            )}
          </p>
        )}
        {fields.map((field) => (
          <StageField
            key={field}
            field={field}
            value={values[field] ?? ""}
            people={people}
            onChange={(next) => {
              setValues((currentValues) => ({
                ...currentValues,
                [field]: next,
              }));
            }}
          />
        ))}
        <ErrorBanner
          error={send.error}
          retry={() => {
            send.mutate();
          }}
        />
        <button
          className={move.back === true ? "danger" : "primary"}
          disabled={send.isPending || missing.length > 0}
        >
          {send.isPending ? "…" : moveLabel(to, move.back === true, ar)}
        </button>
      </form>
    </SlideOver>
  );
}

function draftBody(draft: Partial<Record<FieldName, string>>) {
  const body: Record<string, string | null> = {};
  for (const [field, entry] of Object.entries(draft)) {
    if (field === "reason") continue;
    body[field] = entry.trim() === "" ? null : entry;
  }
  return body;
}
