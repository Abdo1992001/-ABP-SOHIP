import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Link } from "react-router";
import type { ApiClient } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";
import { enumLabel } from "../i18n/enum-labels.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { dueText } from "../lib/receivables.ts";
import { commercialRequest, isObject, rows } from "./commercial-api.ts";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  StatusChip,
  useToast,
} from "./CommercialUI.tsx";
import { localToday } from "../lib/today.ts";

/**
 * Receivables: what customers owe on their orders, and how late it is.
 *
 * Every figure is per currency. The page never adds EGP to USD -- a total
 * across currencies is a number in no currency, and a finance screen that
 * shows one is a finance screen nobody can reconcile.
 */

type Rec = Record<string, unknown>;
const text = (value: unknown): string =>
  typeof value === "string"
    ? value
    : typeof value === "number"
      ? String(value)
      : "";
const num = (value: unknown): number => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const VIEWS = [
  { code: "OPEN", en: "Still owed", ar: "لسه مستحق" },
  { code: "OVERDUE", en: "Overdue", ar: "متأخر" },
  { code: "DUE_SOON", en: "Due in 30 days", ar: "مستحق خلال 30 يوم" },
  { code: "NOT_SCHEDULED", en: "Waiting for delivery", ar: "مستني التسليم" },
  { code: "SETTLED", en: "Settled", ar: "متسوّي" },
  { code: "ALL", en: "All", ar: "الكل" },
] as const;

/** Aging columns, oldest last, with the words a collector uses for them. */
const BUCKETS = [
  { code: "NOT_SCHEDULED", en: "Not yet dated", ar: "لسه من غير تاريخ" },
  { code: "NOT_DUE", en: "Not due yet", ar: "لسه ماجاش ميعاده" },
  { code: "OVERDUE_1_30", en: "1–30 days late", ar: "متأخر 1–30 يوم" },
  { code: "OVERDUE_31_60", en: "31–60 days late", ar: "متأخر 31–60 يوم" },
  { code: "OVERDUE_61_90", en: "61–90 days late", ar: "متأخر 61–90 يوم" },
  {
    code: "OVERDUE_90_PLUS",
    en: "Over 90 days late",
    ar: "متأخر أكتر من 90 يوم",
  },
] as const;

const METHODS = ["TRANSFER", "CHEQUE", "CASH", "CARD", "OTHER"] as const;

function useText() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  return {
    locale,
    ar,
    txt: (en: string, arabic: string) => (ar ? arabic : en),
    money: (value: unknown, currency?: string) =>
      `${formatNum(num(value), locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currency ? ` ${currency}` : ""}`,
    date: (value: unknown) =>
      text(value)
        ? new Date(`${text(value).slice(0, 10)}T00:00:00`).toLocaleDateString(
            ar ? "ar-EG" : "en-GB",
          )
        : "—",
  };
}

export function ReceivablesPage({ client, me }: { client: ApiClient; me: Me }) {
  const { txt, money, date, ar } = useText();
  const cache = useQueryClient();
  const [view, setView] = useState<string>("OPEN");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [collecting, setCollecting] = useState<Rec | null>(null);
  const [writingOff, setWritingOff] = useState<Rec | null>(null);
  const canCollect = me.access.permissions.includes("payments.create");
  const canWriteOff = me.access.permissions.includes("payments.allocate");

  const summary = useQuery({
    queryKey: ["receivables", "summary"],
    queryFn: async () => {
      const result = await commercialRequest(
        client,
        "GET",
        "/receivables/summary",
      );
      return isObject(result.data) && isObject(result.data.data)
        ? result.data.data
        : {};
    },
  });
  const list = useQuery({
    queryKey: ["receivables", "list", view, search, page],
    queryFn: async () => {
      const query: Record<string, string | number> = { view, page, limit: 50 };
      if (search) query.search = search;
      const result = await commercialRequest(client, "GET", "/receivables", {
        path: {},
        query,
      });
      const meta =
        isObject(result.data) && isObject(result.data.meta)
          ? result.data.meta
          : {};
      return { rows: rows(result.data), hasNext: meta.hasNext === true };
    },
  });
  const refresh = async () => {
    await cache.invalidateQueries({ queryKey: ["receivables"] });
    await cache.invalidateQueries({ queryKey: ["customer-order"] });
  };

  const currencies = rows(summary.data?.currencies);
  const late = rows(summary.data?.topOverdueAccounts);

  return (
    <section className="workspace-page receivables-page">
      <PageHeader
        kicker={txt("Finance", "المالية")}
        title={txt("Receivables", "المستحقات")}
        {...(summary.data?.asOf
          ? { status: `${txt("As of", "لحد")} ${date(summary.data.asOf)}` }
          : {})}
      />
      <ErrorBanner error={summary.error} retry={() => void summary.refetch()} />

      {currencies.map((totals) => {
        const currency = text(totals.currencyCode);
        const buckets = isObject(totals.buckets) ? totals.buckets : {};
        const whole = num(totals.outstandingAmount);
        return (
          <div key={currency} className="receivables-currency panel">
            <div className="receivables-figures">
              <div>
                <span>{txt("Outstanding", "المستحق")}</span>
                <strong>{money(totals.outstandingAmount, currency)}</strong>
              </div>
              <div className={num(totals.overdueAmount) > 0 ? "is-late" : ""}>
                <span>
                  {txt("Overdue", "متأخر")} ·{" "}
                  {txt(
                    `${String(num(totals.overdueCount))} installments`,
                    `${String(num(totals.overdueCount))} قسط`,
                  )}
                </span>
                <strong>{money(totals.overdueAmount, currency)}</strong>
              </div>
              <div>
                <span>
                  {txt("Due in the next 30 days", "مستحق خلال 30 يوم")}
                </span>
                <strong>{money(totals.dueIn30DaysAmount, currency)}</strong>
              </div>
              <div>
                <span>{txt("Collected this month", "اتحصّل الشهر ده")}</span>
                <strong>
                  {money(totals.collectedThisMonthAmount, currency)}
                </strong>
              </div>
            </div>
            {whole > 0 && (
              <>
                <div
                  className="receivables-aging-bar"
                  role="img"
                  aria-label={txt("Aging of what is owed", "أعمار المستحقات")}
                >
                  {BUCKETS.map((bucket) => {
                    const share = (num(buckets[bucket.code]) / whole) * 100;
                    return share > 0 ? (
                      <span
                        key={bucket.code}
                        className={`aging-${bucket.code}`}
                        style={{ width: `${String(share)}%` }}
                        title={`${ar ? bucket.ar : bucket.en}: ${money(buckets[bucket.code], currency)}`}
                      />
                    ) : null;
                  })}
                </div>
                <ul className="receivables-aging-legend">
                  {BUCKETS.map((bucket) => (
                    <li key={bucket.code}>
                      <i
                        className={`aging-${bucket.code}`}
                        aria-hidden="true"
                      />
                      <span>{ar ? bucket.ar : bucket.en}</span>
                      <strong>{money(buckets[bucket.code])}</strong>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>
        );
      })}
      {summary.data !== undefined && currencies.length === 0 && (
        <p className="panel receivables-clear">
          {txt(
            "Nothing is owed: every confirmed order is paid up.",
            "مفيش مستحقات: كل الأوردرات المؤكدة متسددة.",
          )}
        </p>
      )}

      {late.length > 0 && (
        <div className="panel receivables-late">
          <h2>{txt("Most overdue customers", "أكتر العملاء تأخيرًا")}</h2>
          <ol>
            {late.map((one) => (
              <li key={`${text(one.accountId)}-${text(one.currencyCode)}`}>
                <Link to={`/customers/${text(one.accountId)}`}>
                  {text(one.accountName)}
                </Link>
                <span>
                  {txt(
                    `${String(num(one.daysOverdue))} days since the oldest due date`,
                    `${String(num(one.daysOverdue))} يوم من أقدم ميعاد`,
                  )}
                </span>
                <strong>
                  {money(one.overdueAmount, text(one.currencyCode))}
                </strong>
              </li>
            ))}
          </ol>
        </div>
      )}

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
        aria-label={txt("Search receivables", "بحث المستحقات")}
        placeholder={txt(
          "Search by customer or order number",
          "ابحث باسم العميل أو رقم الأوردر",
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
                <th>{txt("Due", "الميعاد")}</th>
                <th>{txt("Customer", "العميل")}</th>
                <th>{txt("Order", "الأوردر")}</th>
                <th>{txt("Installment", "القسط")}</th>
                <th className="numeric">{txt("Amount", "المبلغ")}</th>
                <th className="numeric">{txt("Collected", "المحصّل")}</th>
                <th className="numeric">{txt("Outstanding", "المتبقي")}</th>
                <th>{txt("Status", "الحالة")}</th>
                <th aria-label={txt("Actions", "إجراءات")} />
              </tr>
            </thead>
            <tbody>
              {list.data?.rows.map((row) => {
                const currency = text(row.currencyCode);
                const owed =
                  row.statusCode === "OPEN" || row.statusCode === "PARTIAL";
                const daysLate = num(row.daysOverdue);
                return (
                  <tr key={text(row.receivableInstallmentId)}>
                    <td>
                      {dueText(row, txt, date)}
                      {owed && daysLate > 0 && (
                        <small className="receivables-days-late">
                          {txt(
                            `${String(daysLate)} days late`,
                            `متأخر ${String(daysLate)} يوم`,
                          )}
                        </small>
                      )}
                    </td>
                    <td>
                      <Link to={`/customers/${text(row.accountId)}`}>
                        {text(row.accountName)}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/customer-orders/${text(row.customerOrderId)}`}
                      >
                        {text(row.orderRef)}
                      </Link>
                    </td>
                    <td>{text(row.label)}</td>
                    <td className="numeric">{money(row.amount, currency)}</td>
                    <td className="numeric">{money(row.collectedAmount)}</td>
                    <td className="numeric">
                      <strong>{money(row.outstandingAmount)}</strong>
                    </td>
                    <td>
                      <StatusChip
                        code={
                          owed && daysLate > 0
                            ? "OVERDUE"
                            : text(row.statusCode)
                        }
                      />
                    </td>
                    <td>
                      <div className="receivables-actions">
                        {owed && canCollect && (
                          <button
                            type="button"
                            className="primary"
                            onClick={() => {
                              setCollecting(row);
                            }}
                          >
                            {txt("Record payment", "تسجيل تحصيل")}
                          </button>
                        )}
                        {owed && canWriteOff && (
                          <button
                            type="button"
                            className="ghost"
                            onClick={() => {
                              setWritingOff(row);
                            }}
                          >
                            {txt("Write off", "إعدام")}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {list.data?.rows.length === 0 && (
                <tr>
                  <td colSpan={9} className="table-empty">
                    {txt("Nothing in this view.", "مفيش حاجة هنا.")}
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

      {collecting && (
        <CollectDialog
          client={client}
          row={collecting}
          onClose={() => {
            setCollecting(null);
          }}
          onDone={async () => {
            setCollecting(null);
            await refresh();
          }}
        />
      )}
      {writingOff && (
        <WriteOffDialog
          client={client}
          row={writingOff}
          onClose={() => {
            setWritingOff(null);
          }}
          onDone={async () => {
            setWritingOff(null);
            await refresh();
          }}
        />
      )}
    </section>
  );
}

function CollectDialog({
  client,
  row,
  onClose,
  onDone,
}: {
  client: ApiClient;
  row: Rec;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { txt, money, locale } = useText();
  const toast = useToast();
  const currency = text(row.currencyCode);
  const [amount, setAmount] = useState(num(row.outstandingAmount).toFixed(2));
  const [receivedOn, setReceivedOn] = useState(localToday());
  const [method, setMethod] = useState<string>(
    METHODS.includes(text(row.methodCode) as (typeof METHODS)[number])
      ? text(row.methodCode)
      : "TRANSFER",
  );
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      const body: Rec = {
        expectedRowVersion: text(row.rowVersion),
        amount: num(amount).toFixed(2),
        receivedOn,
        methodCode: method,
      };
      if (reference.trim()) body.reference = reference.trim();
      if (note.trim()) body.note = note.trim();
      await commercialRequest(
        client,
        "POST",
        "/receivables/{receivableInstallmentId}/collections",
        {
          path: { receivableInstallmentId: text(row.receivableInstallmentId) },
          body,
        },
      );
    },
    onSuccess: async () => {
      toast.success(txt("Payment recorded", "اتسجّل التحصيل"));
      await onDone();
    },
  });
  const tooMuch = num(amount) > num(row.outstandingAmount) + 0.001;
  return (
    <SlideOver title={txt("Record a payment", "تسجيل تحصيل")} onClose={onClose}>
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="settings-hint">
          {text(row.accountName)} · {text(row.orderRef)} · {text(row.label)}
          <br />
          {txt("Still owed", "المتبقي")}:{" "}
          <strong>{money(row.outstandingAmount, currency)}</strong>
        </p>
        <label>
          {txt(`Amount received (${currency})`, `المبلغ المحصّل (${currency})`)}
          <input
            inputMode="decimal"
            value={amount}
            onChange={(event) => {
              setAmount(event.target.value);
            }}
            aria-invalid={tooMuch}
          />
        </label>
        {tooMuch && (
          <p className="form-error">
            {txt(
              "That is more than is owed on this installment.",
              "ده أكتر من المتبقي على القسط ده.",
            )}
          </p>
        )}
        <label>
          {txt("Received on", "اتحصّل يوم")}
          <input
            type="date"
            value={receivedOn}
            max={localToday()}
            onChange={(event) => {
              setReceivedOn(event.target.value);
            }}
          />
        </label>
        <label>
          {txt("Paid by", "طريقة الدفع")}
          <select
            value={method}
            onChange={(event) => {
              setMethod(event.target.value);
            }}
          >
            {METHODS.map((code) => (
              <option key={code} value={code}>
                {enumLabel(code, locale)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {method === "CHEQUE"
            ? txt("Cheque number", "رقم الشيك")
            : txt("Reference", "المرجع")}
          <input
            value={reference}
            maxLength={200}
            onChange={(event) => {
              setReference(event.target.value);
            }}
          />
        </label>
        {method === "CHEQUE" && (
          <p className="settings-hint">
            {txt(
              "The cheque is also added to the cheques register, where its deposit and clearing are tracked.",
              "الشيك هيتضاف كمان لسجل الشيكات، اللي بيتابع إيداعه وصرفه.",
            )}
          </p>
        )}
        <label>
          {txt("Note", "ملاحظة")}
          <textarea
            value={note}
            maxLength={1000}
            onChange={(event) => {
              setNote(event.target.value);
            }}
          />
        </label>
        <ErrorBanner
          error={save.error}
          retry={() => {
            save.mutate();
          }}
        />
        <button
          className="primary"
          disabled={save.isPending || tooMuch || !(num(amount) > 0)}
        >
          {save.isPending ? "…" : txt("Record payment", "سجّل التحصيل")}
        </button>
      </form>
    </SlideOver>
  );
}

function WriteOffDialog({
  client,
  row,
  onClose,
  onDone,
}: {
  client: ApiClient;
  row: Rec;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const { txt, money } = useText();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const save = useMutation({
    mutationFn: async () => {
      await commercialRequest(
        client,
        "POST",
        "/receivables/{receivableInstallmentId}/write-offs",
        {
          path: { receivableInstallmentId: text(row.receivableInstallmentId) },
          body: {
            expectedRowVersion: text(row.rowVersion),
            reason: reason.trim(),
          },
        },
      );
    },
    onSuccess: async () => {
      toast.success(txt("Written off", "اتعدم"));
      await onDone();
    },
  });
  return (
    <SlideOver
      title={txt("Write off the balance", "إعدام المتبقي")}
      onClose={onClose}
    >
      <form
        className="orders-amend"
        onSubmit={(event) => {
          event.preventDefault();
          save.mutate();
        }}
      >
        <p className="settings-hint">
          {txt(
            `${money(row.outstandingAmount, text(row.currencyCode))} owed by ${text(row.accountName)} on ${text(row.orderRef)} will no longer be chased. This cannot be undone here.`,
            `${money(row.outstandingAmount, text(row.currencyCode))} على ${text(row.accountName)} في ${text(row.orderRef)} مش هيتطالب بيها تاني. ده مش هيترجع من هنا.`,
          )}
        </p>
        <label>
          {txt("Why is it written off?", "سبب الإعدام")}
          <textarea
            required
            minLength={3}
            maxLength={500}
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
            }}
          />
        </label>
        <ErrorBanner
          error={save.error}
          retry={() => {
            save.mutate();
          }}
        />
        <button
          className="danger"
          disabled={save.isPending || reason.trim().length < 3}
        >
          {txt("Write off", "إعدام")}
        </button>
      </form>
    </SlideOver>
  );
}
