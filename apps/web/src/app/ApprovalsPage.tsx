import { useState } from "react";
import { Link } from "react-router";
import {
  useMutation,
  useQueries,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { commercialRequest, isObject, str } from "./commercial-api.ts";
import {
  ErrorBanner,
  LoadingSkeleton,
  PageHeader,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";

/**
 * Approvals — the decisions other people are waiting on.
 *
 * The API has carried this the whole time: list, context, and a decision
 * endpoint that takes APPROVE / REJECT / REQUEST_CHANGES with a comment. There
 * was no screen for any of it, so an approval could only be granted from inside
 * the quotation it belonged to — which means you had to already know it was
 * waiting. This is the other direction: start from the queue.
 *
 * The list rows carry ids, not names, so each pending row fetches its own
 * context for the reference, customer and total. That is one request per
 * pending row and it is only done for pending ones — a decided approval needs
 * no context because nobody is going to act on it.
 */

interface ApprovalRow {
  approvalRequestId: string;
  quotationId: string;
  statusCode: string;
  requestedByUserId: string;
  currentAssigneeUserId: string | null;
  requiredAuthorityTier: number | null;
  requestedAt: string;
  resolvedAt: string | null;
  invalidatedAt: string | null;
  invalidationReasonCode: string | null;
}

function toRow(row: Record<string, unknown>): ApprovalRow {
  return {
    approvalRequestId: str(row.approvalRequestId),
    quotationId: str(row.quotationId),
    statusCode: str(row.statusCode),
    requestedByUserId: str(row.requestedByUserId),
    currentAssigneeUserId:
      typeof row.currentAssigneeUserId === "string"
        ? row.currentAssigneeUserId
        : null,
    requiredAuthorityTier:
      typeof row.requiredAuthorityTier === "number"
        ? row.requiredAuthorityTier
        : null,
    requestedAt: str(row.requestedAt),
    resolvedAt: typeof row.resolvedAt === "string" ? row.resolvedAt : null,
    invalidatedAt:
      typeof row.invalidatedAt === "string" ? row.invalidatedAt : null,
    invalidationReasonCode:
      typeof row.invalidationReasonCode === "string"
        ? row.invalidationReasonCode
        : null,
  };
}

/** Still waiting on somebody. Anything else has been decided or overtaken. */
function isPending(row: ApprovalRow) {
  return row.statusCode === "PENDING" && row.invalidatedAt === null;
}

const DECISIONS = [
  { code: "APPROVE", en: "Approve", ar: "موافقة", tone: "primary" },
  {
    code: "REQUEST_CHANGES",
    en: "Request changes",
    ar: "طلب تعديل",
    tone: "secondary",
  },
  { code: "REJECT", en: "Reject", ar: "رفض", tone: "danger" },
] as const;

export function ApprovalsPage({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const toast = useToast();
  const cache = useQueryClient();
  const canDecide = me.access.permissions.includes("approvals.decide");

  const [openId, setOpenId] = useState<string | null>(null);
  const [comment, setComment] = useState("");

  const list = useQuery({
    queryKey: ["approvals"],
    queryFn: () =>
      commercialRequest(client, "GET", "/approval-requests", {
        path: {},
        query: { page: 1, limit: 50 },
      }),
  });

  const rows =
    isObject(list.data?.data) && Array.isArray(list.data.data.data)
      ? list.data.data.data.filter(isObject).map(toRow)
      : [];
  const pending = rows.filter(isPending);
  const settled = rows.filter((row) => !isPending(row));

  // Context only for what somebody can still act on.
  const contexts = useQueries({
    queries: pending.map((row) => ({
      queryKey: ["approval-context", row.approvalRequestId],
      queryFn: () =>
        commercialRequest(client, "GET", "/approval-requests/{requestId}", {
          path: { requestId: row.approvalRequestId },
        }),
    })),
  });
  const contextFor = (index: number) => {
    const result = contexts[index]?.data;
    const payload =
      isObject(result?.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    const quotation = isObject(payload.quotation) ? payload.quotation : payload;
    return {
      quotationRef:
        typeof quotation.quotationRef === "string"
          ? quotation.quotationRef
          : null,
      customer:
        typeof quotation.accountName === "string"
          ? quotation.accountName
          : isObject(quotation.account) &&
              typeof quotation.account.canonicalName === "string"
            ? quotation.account.canonicalName
            : null,
      total:
        typeof quotation.totalAmount === "string"
          ? quotation.totalAmount
          : null,
      currency:
        typeof quotation.currencyCode === "string"
          ? quotation.currencyCode
          : "",
    };
  };

  const decide = useMutation({
    mutationFn: (input: { id: string; decision: string }) =>
      commercialRequest(
        client,
        "POST",
        "/approval-requests/{requestId}/decisions",
        {
          path: { requestId: input.id },
          body: {
            decision: input.decision,
            ...(comment.trim() ? { comment: comment.trim() } : {}),
          },
          idempotencyKey: crypto.randomUUID(),
        },
      ),
    onSuccess: async () => {
      setOpenId(null);
      setComment("");
      await cache.invalidateQueries({ queryKey: ["approvals"] });
      await cache.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(txt("Decision recorded", "تم تسجيل القرار"));
    },
  });

  const when = (iso: string) => {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return "—";
    return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(date);
  };

  if (list.isLoading) return <LoadingSkeleton rows={4} variant="cards" />;

  return (
    <section className="workspace-page approvals-page">
      <PageHeader
        kicker={txt("Approvals", "الموافقات")}
        title={txt("Decisions waiting on you", "قرارات مستنياك")}
        count={pending.length}
        sub={txt(
          "Quotations that need an authority decision before they can be sent.",
          "عروض أسعار محتاجة قرار قبل ما تتبعت.",
        )}
      />

      <ErrorBanner error={list.error} retry={() => void list.refetch()} />
      <ErrorBanner
        error={decide.error}
        retry={() => {
          decide.reset();
        }}
      />

      {!canDecide && (
        <p className="settings-hint">
          {txt(
            "You can see these because you raised them. Deciding needs the approvals permission.",
            "بتشوفهم لأنك اللي طلبتهم. القرار محتاج صلاحية الموافقات.",
          )}
        </p>
      )}

      {pending.length === 0 ? (
        <p className="today-empty">
          {txt("Nothing is waiting for a decision.", "مفيش حاجة مستنية قرار.")}
        </p>
      ) : (
        <ul className="approvals-list">
          {pending.map((row, index) => {
            const context = contextFor(index);
            const open = openId === row.approvalRequestId;
            return (
              <li key={row.approvalRequestId} className="approval-card">
                <div className="approval-head">
                  <div className="approval-identity">
                    <Link to={`/quotations/${row.quotationId}`}>
                      <strong data-abp-num>
                        {context.quotationRef ?? txt("Quotation", "عرض سعر")}
                      </strong>
                    </Link>
                    {context.customer !== null && (
                      <span>{context.customer}</span>
                    )}
                  </div>
                  <div className="approval-facts">
                    {context.total !== null && (
                      <span className="approval-total" data-abp-num>
                        {Number(context.total).toLocaleString("en", {
                          maximumFractionDigits: 0,
                        })}{" "}
                        {context.currency}
                      </span>
                    )}
                    {row.requiredAuthorityTier !== null && (
                      <span className="approval-tier">
                        {txt(
                          `Tier ${String(row.requiredAuthorityTier)}`,
                          `مستوى ${String(row.requiredAuthorityTier)}`,
                        )}
                      </span>
                    )}
                    <span className="approval-when">
                      {when(row.requestedAt)}
                    </span>
                  </div>
                </div>

                {canDecide && !open && (
                  <button
                    type="button"
                    className="primary"
                    onClick={() => {
                      setOpenId(row.approvalRequestId);
                      setComment("");
                    }}
                  >
                    {txt("Decide", "اتخذ قرار")}
                  </button>
                )}

                {canDecide && open && (
                  <div className="approval-decision">
                    <label className="settings-field">
                      {txt("Comment (optional)", "تعليق (اختياري)")}
                      <textarea
                        rows={2}
                        maxLength={2000}
                        value={comment}
                        onChange={(event) => {
                          setComment(event.target.value);
                        }}
                      />
                      <small>
                        {txt(
                          "A rejection without a reason is a decision nobody can act on.",
                          "رفض من غير سبب قرار محدش يقدر يتصرف بناءً عليه.",
                        )}
                      </small>
                    </label>
                    <div className="approval-actions">
                      {DECISIONS.map((option) => (
                        <button
                          key={option.code}
                          type="button"
                          className={option.tone}
                          disabled={decide.isPending}
                          onClick={() => {
                            decide.mutate({
                              id: row.approvalRequestId,
                              decision: option.code,
                            });
                          }}
                        >
                          {locale === "ar" ? option.ar : option.en}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="ghost-button"
                        onClick={() => {
                          setOpenId(null);
                          setComment("");
                        }}
                      >
                        {txt("Cancel", "إلغاء")}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {settled.length > 0 && (
        <>
          <h2 className="settings-section-title">
            {txt("Already decided", "اتقرر قبل كده")}
          </h2>
          <ul className="approvals-settled">
            {settled.map((row) => (
              <li key={row.approvalRequestId}>
                <Link to={`/quotations/${row.quotationId}`}>
                  {txt("Quotation", "عرض سعر")}
                </Link>
                <StatusChip code={row.statusCode} />
                {/* An invalidated request is one the quotation outran: it was
                    edited after the approval was asked for, so the decision no
                    longer applies to what is on the page. */}
                {row.invalidatedAt !== null && (
                  <span className="approval-invalid">
                    {txt("Superseded by an edit", "اتلغت بعد تعديل")}
                    {row.invalidationReasonCode !== null && (
                      <> · {enumLabel(row.invalidationReasonCode, locale)}</>
                    )}
                  </span>
                )}
                <span className="approval-when">
                  {when(row.resolvedAt ?? row.requestedAt)}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
