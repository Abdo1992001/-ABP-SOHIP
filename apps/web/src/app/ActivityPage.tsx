import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import {
  cancelActivity,
  completeActivity,
  createActivity,
  getActivity,
  listActivities,
  rescheduleActivity,
  updateActivity,
} from "../api/activity-api.ts";
import { listQuotations } from "../api/quotation-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import {
  ErrorBanner,
  ScreenIntro,
  SlideOver,
  StatusChip,
  TabBar,
  useToast,
} from "./CommercialUI.tsx";
import { AccountPicker } from "./AccountPicker.tsx";
export function ActivityPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { activityId } = useParams();
  const cache = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1),
    [creating, setCreating] = useState(
      () => searchParams.get("create") === "1",
    ),
    [accountId, setAccountId] = useState(""),
    [typeCode, setTypeCode] = useState("FOLLOW_UP"),
    [quotationId, setQuotationId] = useState(
      () => searchParams.get("quotationId") ?? "",
    ),
    [subject, setSubject] = useState(""),
    [dueAt, setDueAt] = useState(""),
    [editSubject, setEditSubject] = useState<string | null>(null),
    [newDueAt, setNewDueAt] = useState(""),
    [tab, setTab] = useState("overview"),
    [confirmCancel, setConfirmCancel] = useState(false);
  const activities = useQuery({
    queryKey: ["activities", page],
    queryFn: () => listActivities(client, page),
  });
  const detail = useQuery({
    queryKey: ["activity", activityId],
    enabled: !!activityId,
    queryFn: () => getActivity(client, activityId ?? ""),
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["activities"] });
    await cache.invalidateQueries({ queryKey: ["activity", activityId] });
    toast.success(txt("Saved", "تم الحفظ"));
  };
  const version = detail.data?.etag ?? "";
  const create = useMutation({
    mutationFn: () =>
      createActivity(client, {
        typeCode,
        subject,
        // MEETING is a scheduled event, everything else is a task with a due
        // date — sending the wrong one leaves it out of the calendar.
        ...(dueAt
          ? typeCode === "MEETING"
            ? { scheduledAt: new Date(dueAt).toISOString() }
            : { dueAt: new Date(dueAt).toISOString() }
          : {}),
        // The server requires the primary link to be the ACCOUNT
        // (PRIMARY_ACCOUNT_LINK_REQUIRED); the quotation rides along as a
        // secondary link and is what the topbar reminder opens.
        links: [
          {
            resourceTypeCode: "ACCOUNT",
            resourceId: accountId,
            isPrimary: true,
          },
          ...(quotationId
            ? [
                {
                  resourceTypeCode: "QUOTATION",
                  resourceId: quotationId,
                  isPrimary: false,
                },
              ]
            : []),
        ],
      }),
    onSuccess: async () => {
      setCreating(false);
      setSubject("");
      setDueAt("");
      await refresh();
    },
  });
  const update = useMutation({
    mutationFn: () =>
      updateActivity(client, activityId ?? "", version, {
        subject: editSubject ?? detail.data?.data.subject ?? "",
      }),
    onSuccess: refresh,
  });
  const reschedule = useMutation({
    mutationFn: () =>
      rescheduleActivity(
        client,
        activityId ?? "",
        version,
        new Date(newDueAt).toISOString(),
      ),
    onSuccess: refresh,
  });
  const complete = useMutation({
    mutationFn: () => completeActivity(client, activityId ?? "", version),
    onSuccess: refresh,
  });
  const cancel = useMutation({
    mutationFn: () =>
      cancelActivity(
        client,
        activityId ?? "",
        version,
        "User requested cancellation",
      ),
    onSuccess: async () => {
      setConfirmCancel(false);
      await refresh();
    },
  });
  const canEdit = me.access.permissions.includes("activities.edit");
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <h1>{txt("Activities & follow-ups", "الأنشطة والمتابعات")}</h1>
        {me.access.permissions.includes("activities.create") && (
          <button
            className="primary"
            onClick={() => {
              setCreating(true);
            }}
          >
            {txt("+ Log activity", "+ تسجيل نشاط")}
          </button>
        )}
      </header>
      <ScreenIntro />
      <ErrorBanner
        error={activities.error}
        retry={() => void activities.refetch()}
      />
      <div className="panel">
        <table className="data-table">
          <thead>
            <tr>
              <th>{txt("Activity", "النشاط")}</th>
              <th>{txt("Status", "الحالة")}</th>
              <th>{txt("Due date", "الموعد")}</th>
            </tr>
          </thead>
          <tbody>
            {activities.data?.data.map((a) => (
              <tr key={a.activityId}>
                <td>
                  <Link
                    to={`/activities/${a.activityId}`}
                    onClick={() => {
                      setEditSubject(null);
                      setTab("overview");
                    }}
                  >
                    {a.subject ?? a.typeCode}
                  </Link>
                </td>
                <td>
                  {a.taskStatusCode ? (
                    <StatusChip code={a.taskStatusCode} />
                  ) : (
                    txt("Logged", "مسجل")
                  )}
                </td>
                <td>
                  {a.dueAt
                    ? new Date(a.dueAt).toLocaleString(
                        locale === "ar" ? "ar-EG" : "en-GB",
                      )
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {activities.isLoading && (
          <div
            className="skeleton-stack"
            aria-label={txt("Loading activities", "جار تحميل الأنشطة")}
            role="status"
          >
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
            disabled={!activities.data?.meta.hasNext}
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
          title={txt("Log activity", "تسجيل نشاط")}
          onClose={() => {
            setCreating(false);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate();
            }}
          >
            <label>
              {txt("Type", "النوع")}
              <select
                value={typeCode}
                onChange={(e) => {
                  setTypeCode(e.target.value);
                }}
              >
                <option value="FOLLOW_UP">{txt("Follow-up", "متابعة")}</option>
                <option value="MEETING">{txt("Meeting", "اجتماع")}</option>
                <option value="CALL">{txt("Call", "مكالمة")}</option>
                <option value="SITE_VISIT">
                  {txt("Site visit", "زيارة موقع")}
                </option>
                <option value="WHATSAPP">{txt("WhatsApp", "واتساب")}</option>
                <option value="EMAIL">{txt("Email", "إيميل")}</option>
              </select>
            </label>
            <AccountPicker
              client={client}
              value={accountId}
              onChange={setAccountId}
            />
            <QuotationLinkPicker
              client={client}
              accountId={accountId}
              value={quotationId}
              onChange={setQuotationId}
            />
            <label>
              {txt("Subject", "الموضوع")}
              <input
                required
                value={subject}
                onChange={(e) => {
                  setSubject(e.target.value);
                }}
              />
            </label>
            <label>
              {typeCode === "MEETING"
                ? txt("Meeting time", "موعد الاجتماع")
                : txt("Due date", "الموعد")}
              <input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => {
                  setDueAt(e.target.value);
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
              {create.isPending ? "…" : txt("Save activity", "حفظ النشاط")}
            </button>
          </form>
        </SlideOver>
      )}
      {activityId && (
        <SlideOver
          title={
            detail.data?.data.subject ?? txt("Activity detail", "تفاصيل النشاط")
          }
          onClose={() => void navigate("/activities")}
        >
          <TabBar
            tabs={[
              { id: "overview", en: "Overview", ar: "نظرة عامة" },
              ...(canEdit
                ? [{ id: "actions", en: "Actions", ar: "الإجراءات" }]
                : []),
            ]}
            active={tab}
            onChange={setTab}
          />
          <ErrorBanner
            error={detail.error}
            retry={() => void detail.refetch()}
          />
          {detail.data && (
            <>
              {tab === "overview" && (
                <>
                  <p>
                    {txt("Status", "الحالة")}:{" "}
                    {detail.data.data.taskStatusCode ? (
                      <StatusChip code={detail.data.data.taskStatusCode} />
                    ) : (
                      "—"
                    )}
                  </p>
                  <p>
                    {txt("Due date", "الموعد")}: {detail.data.data.dueAt ?? "—"}
                  </p>
                </>
              )}
              {tab === "actions" &&
                canEdit &&
                detail.data.data.taskStatusCode === "OPEN" && (
                  <>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        update.mutate();
                      }}
                    >
                      <label>
                        {txt("Subject", "الموضوع")}
                        <input
                          required
                          value={editSubject ?? detail.data.data.subject ?? ""}
                          onChange={(e) => {
                            setEditSubject(e.target.value);
                          }}
                        />
                      </label>
                      <ErrorBanner
                        error={update.error}
                        retry={() => {
                          update.mutate();
                        }}
                      />
                      <button disabled={update.isPending}>
                        {txt("Save changes", "حفظ التغييرات")}
                      </button>
                    </form>
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        reschedule.mutate();
                      }}
                    >
                      <label>
                        {txt("New due date", "الموعد الجديد")}
                        <input
                          required
                          type="datetime-local"
                          value={newDueAt}
                          onChange={(e) => {
                            setNewDueAt(e.target.value);
                          }}
                        />
                      </label>
                      <ErrorBanner
                        error={reschedule.error}
                        retry={() => {
                          reschedule.mutate();
                        }}
                      />
                      <button disabled={reschedule.isPending}>
                        {txt("Reschedule", "إعادة الجدولة")}
                      </button>
                    </form>
                    <ErrorBanner
                      error={complete.error}
                      retry={() => {
                        complete.mutate();
                      }}
                    />
                    <button
                      disabled={complete.isPending}
                      onClick={() => {
                        complete.mutate();
                      }}
                    >
                      {txt("Complete activity", "إكمال النشاط")}
                    </button>
                    {me.access.permissions.includes("activities.cancel") && (
                      <button
                        className="danger"
                        onClick={() => {
                          setConfirmCancel(true);
                        }}
                      >
                        {txt("Cancel activity", "إلغاء النشاط")}
                      </button>
                    )}
                  </>
                )}
            </>
          )}
        </SlideOver>
      )}
      {confirmCancel && (
        <SlideOver
          title={txt("Confirm cancellation", "تأكيد الإلغاء")}
          onClose={() => {
            setConfirmCancel(false);
          }}
        >
          <p>{txt("Cancel this activity?", "هل تريد إلغاء هذا النشاط؟")}</p>
          <ErrorBanner
            error={cancel.error}
            retry={() => {
              cancel.mutate();
            }}
          />
          <button
            className="danger"
            disabled={cancel.isPending}
            onClick={() => {
              cancel.mutate();
            }}
          >
            {txt("Confirm", "تأكيد")}
          </button>
        </SlideOver>
      )}
    </section>
  );
}

// Ties a follow-up or meeting to the quotation it is actually about, so the
// topbar reminder can open that quote instead of a generic activity list.
function QuotationLinkPicker({
  client,
  accountId,
  value,
  onChange,
}: {
  client: ApiClient;
  accountId: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const quotations = useQuery({
    queryKey: ["activity-quotation-picker", accountId],
    queryFn: () => listQuotations(client, { page: 1, limit: 50 }),
    enabled: Boolean(accountId),
  });
  const forAccount = (quotations.data?.data ?? []).filter(
    (quotation) => quotation.accountId === accountId,
  );
  if (!accountId) return null;
  return (
    <label>
      {txt("About which quotation? (optional)", "بخصوص أي عرض سعر؟ (اختياري)")}
      <select
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      >
        <option value="">
          {txt("Not about a specific quotation", "مش بخصوص عرض سعر معيّن")}
        </option>
        {forAccount.map((quotation) => (
          <option key={quotation.quotationId} value={quotation.quotationId}>
            {quotation.quoteRef} · {enumLabel(quotation.statusCode, locale)}
          </option>
        ))}
      </select>
    </label>
  );
}
