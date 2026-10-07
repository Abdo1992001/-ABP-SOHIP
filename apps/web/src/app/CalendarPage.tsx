import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { listAccounts } from "../api/customer-api.ts";
import {
  createActivity,
  rescheduleActivity,
  completeActivity,
  getActivity,
} from "../api/activity-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { commercialRequest, rows, str } from "./commercial-api.ts";
import { ErrorBanner, ScreenIntro, SlideOver } from "./CommercialUI.tsx";
export function CalendarPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const [month, setMonth] = useState(
    () => new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  );
  const [page, setPage] = useState(1);
  const [date, setDate] = useState("");
  const [subject, setSubject] = useState("");
  const [activityType, setActivityType] = useState("FOLLOW_UP");
  const [accountId, setAccountId] = useState("");
  const [selected, setSelected] = useState<Record<string, unknown> | null>(
    null,
  );
  const [accountPage, setAccountPage] = useState(1);
  const query = useQuery({
    queryKey: ["activities", "calendar", month.toISOString(), page],
    queryFn: () =>
      commercialRequest(client, "GET", "/activities", {
        path: {},
        query: {
          offset: (page - 1) * 100,
          limit: 100,
          dueFrom: month.toISOString(),
          dueTo: new Date(
            month.getFullYear(),
            month.getMonth() + 1,
            1,
          ).toISOString(),
        },
      }),
  });
  const accounts = useQuery({
    queryKey: ["calendar-accounts", accountPage],
    enabled: Boolean(date),
    queryFn: () => listAccounts(client, { page: accountPage, limit: 25 }),
  });
  const items = rows(query.data?.data);
  const save = useMutation({
    mutationFn: async () => {
      if (selected) {
        const current = await getActivity(client, str(selected.activityId));
        return rescheduleActivity(
          client,
          str(selected.activityId),
          current.etag ?? "",
          new Date(date).toISOString(),
        );
      }
      return createActivity(client, {
        typeCode: activityType,
        subject,
        dueAt: new Date(date).toISOString(),
        links: [
          {
            resourceTypeCode: "ACCOUNT",
            resourceId: accountId,
            isPrimary: true,
          },
        ],
      });
    },
    onSuccess: () => {
      setDate("");
      setSelected(null);
      void query.refetch();
    },
  });
  const complete = useMutation({
    mutationFn: async () => {
      const current = await getActivity(client, str(selected?.activityId));
      return completeActivity(
        client,
        str(selected?.activityId),
        current.etag ?? "",
      );
    },
    onSuccess: () => {
      setSelected(null);
      setDate("");
      void query.refetch();
    },
  });
  const move = useMutation({
    mutationFn: async ({ id, due }: { id: string; due: string }) => {
      const current = await getActivity(client, id);
      return rescheduleActivity(
        client,
        id,
        current.etag ?? "",
        new Date(due).toISOString(),
      );
    },
    onSuccess: () => void query.refetch(),
  });
  const first = new Date(
    month.getFullYear(),
    month.getMonth(),
    1 - month.getDay(),
  );
  const days = Array.from(
    { length: 42 },
    (_, index) =>
      new Date(
        first.getFullYear(),
        first.getMonth(),
        first.getDate() + index,
        9,
      ),
  );
  const iso = (day: Date) =>
    `${String(day.getFullYear())}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}T09:00`;
  const mayEdit = me.access.permissions.includes("activities.edit");
  return (
    <section className="workspace-page">
      <header className="page-heading">
        <h1>{locale === "ar" ? "التقويم التجاري" : "Commercial calendar"}</h1>
        <div className="heading-actions">
          <button
            onClick={() => {
              setPage(1);
              setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1));
            }}
          >
            ‹
          </button>
          <strong>
            {month.toLocaleDateString(locale === "ar" ? "ar-EG" : "en-GB", {
              month: "long",
              year: "numeric",
            })}
          </strong>
          <button
            onClick={() => {
              setPage(1);
              setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1));
            }}
          >
            ›
          </button>
        </div>
      </header>
      <ScreenIntro />
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      <ErrorBanner
        error={move.error}
        retry={() => {
          if (move.variables) move.mutate(move.variables);
        }}
      />
      <div className="calendar-grid">
        {days.map((day) => (
          <div
            className="calendar-day"
            key={iso(day)}
            onDragOver={(event) => {
              if (mayEdit) event.preventDefault();
            }}
            onDrop={(event) => {
              event.preventDefault();
              const id = event.dataTransfer.getData("text/plain");
              if (mayEdit && items.some((item) => item.activityId === id))
                move.mutate({ id, due: iso(day) });
            }}
          >
            <button
              disabled={!me.access.permissions.includes("activities.create")}
              onClick={() => {
                setSelected(null);
                setSubject("");
                setActivityType("FOLLOW_UP");
                setDate(iso(day));
              }}
            >
              {day.getDate()}
            </button>
            {items
              .filter((item) => {
                // A meeting is scheduled, a task is due. Both belong on a
                // calendar, and looking only at dueAt hid every meeting.
                const at = item.scheduledAt ?? item.dueAt;
                return (
                  Boolean(at) &&
                  new Date(str(at)).toDateString() === day.toDateString()
                );
              })
              .map((item) => {
                const at = str(item.scheduledAt ?? item.dueAt);
                const quotationId = quotationLinkId(item);
                return (
                  <button
                    className={`calendar-event is-${(str(item.typeCode) || "FOLLOW_UP").toLowerCase()}`}
                    key={str(item.activityId)}
                    draggable={mayEdit}
                    title={
                      quotationId
                        ? `${str(item.subject)} — ${locale === "ar" ? "مرتبط بعرض سعر" : "linked to a quotation"}`
                        : str(item.subject)
                    }
                    onDragStart={(event) => {
                      event.dataTransfer.setData(
                        "text/plain",
                        str(item.activityId),
                      );
                    }}
                    onClick={() => {
                      setSelected(item);
                      setDate(iso(new Date(at)));
                    }}
                  >
                    <span className="calendar-event-time">
                      {new Date(at).toLocaleTimeString(
                        locale === "ar" ? "ar-EG" : "en-GB",
                        { hour: "2-digit", minute: "2-digit" },
                      )}
                    </span>
                    {str(item.subject)}
                    {quotationId !== null && (
                      <span className="calendar-event-quote" aria-hidden="true">
                        #
                      </span>
                    )}
                  </button>
                );
              })}
          </div>
        ))}
      </div>
      <footer className="pagination">
        <button
          disabled={page === 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          {locale === "ar" ? "السابق" : "Previous"}
        </button>
        <span>
          {page} ·{" "}
          {locale === "ar" ? "١٠٠ نشاط لكل صفحة" : "100 activities per page"}
        </span>
        <button
          disabled={items.length < 100}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {locale === "ar" ? "التالي" : "Next"}
        </button>
      </footer>
      {date && (
        <SlideOver
          title={
            selected
              ? str(selected.subject)
              : locale === "ar"
                ? "تسجيل نشاط"
                : "Log activity"
          }
          onClose={() => {
            setDate("");
            setSelected(null);
          }}
        >
          <ErrorBanner
            error={accounts.error}
            retry={() => void accounts.refetch()}
          />
          <ErrorBanner
            error={save.error}
            retry={() => {
              save.mutate();
            }}
          />
          <ErrorBanner
            error={complete.error}
            retry={() => {
              complete.mutate();
            }}
          />
          {selected !== null && quotationLinkId(selected) !== null && (
            <p className="calendar-quote-link">
              <Link to={`/quotations/${quotationLinkId(selected) ?? ""}`}>
                {locale === "ar"
                  ? "فتح عرض السعر المرتبط بهذا الموعد"
                  : "Open the quotation this meeting is about"}
              </Link>
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              save.mutate();
            }}
          >
            {!selected && (
              <>
                <label>
                  {locale === "ar" ? "العميل" : "Customer"}
                  <select
                    required
                    value={accountId}
                    onChange={(event) => {
                      setAccountId(event.target.value);
                    }}
                  >
                    <option value="">—</option>
                    {accounts.data?.data.map((item) => (
                      <option key={item.accountId} value={item.accountId}>
                        {item.canonicalName}
                      </option>
                    ))}
                  </select>
                </label>
                <div>
                  <button
                    type="button"
                    disabled={accountPage === 1}
                    onClick={() => {
                      setAccountPage(accountPage - 1);
                    }}
                  >
                    ‹
                  </button>
                  <button
                    type="button"
                    disabled={(accounts.data?.data.length ?? 0) < 25}
                    onClick={() => {
                      setAccountPage(accountPage + 1);
                    }}
                  >
                    ›
                  </button>
                </div>
                <label>
                  {locale === "ar" ? "نوع النشاط" : "Activity type"}
                  <select
                    value={activityType}
                    onChange={(event) => {
                      setActivityType(event.target.value);
                    }}
                  >
                    {[
                      ["MEETING", "Meeting", "اجتماع"],
                      ["CALL", "Call", "مكالمة"],
                      ["FOLLOW_UP", "Follow-up", "متابعة"],
                      ["TASK", "Task", "مهمة"],
                      ["SITE_VISIT", "Site visit", "زيارة موقع"],
                      [
                        "QUOTATION_DISCUSSION",
                        "Quotation discussion",
                        "مناقشة عرض سعر",
                      ],
                      ["TECHNICAL_REVIEW", "Technical review", "مراجعة فنية"],
                      ["INTERNAL_REVIEW", "Internal review", "مراجعة داخلية"],
                    ].map(([value, en, ar]) => (
                      <option key={value} value={value}>
                        {locale === "ar" ? ar : en}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  {locale === "ar" ? "الموضوع" : "Subject"}
                  <input
                    required
                    value={subject}
                    onChange={(event) => {
                      setSubject(event.target.value);
                    }}
                  />
                </label>
              </>
            )}
            <label>
              {locale === "ar" ? "الموعد" : "Due date"}
              <input
                type="datetime-local"
                value={date}
                required
                onChange={(event) => {
                  setDate(event.target.value);
                }}
              />
            </label>
            {(!selected || mayEdit) && (
              <button className="primary" disabled={save.isPending}>
                {locale === "ar" ? "حفظ" : "Save"}
              </button>
            )}
          </form>
          {selected && mayEdit && (
            <button
              disabled={complete.isPending}
              onClick={() => {
                complete.mutate();
              }}
            >
              {locale === "ar" ? "إكمال النشاط" : "Complete activity"}
            </button>
          )}
        </SlideOver>
      )}
    </section>
  );
}

/**
 * A meeting is filed with the ACCOUNT as its primary link (the server requires
 * that) and the QUOTATION as a secondary one. The quotation is what the meeting
 * is actually about, so that is what the calendar offers to open.
 */
function quotationLinkId(activity: Record<string, unknown>): string | null {
  const links = activity.links;
  if (!Array.isArray(links)) return null;
  for (const link of links as Record<string, unknown>[]) {
    if (
      link.resourceTypeCode === "QUOTATION" &&
      typeof link.resourceId === "string"
    ) {
      return link.resourceId;
    }
  }
  return null;
}
