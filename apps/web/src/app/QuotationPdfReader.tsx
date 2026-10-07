import { useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router";
import type { ApiClient } from "@abp/api-client";
import {
  createQuotationFromReading,
  readQuotationPdf,
  type QuotationPdfReading,
} from "../api/quotation-api.ts";
import { listAccounts } from "../api/customer-api.ts";
import { listOpportunities } from "../api/opportunity-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { formatNum } from "../lib/numbers.ts";
import { matchName, soleExactMatch } from "../lib/name-match.ts";

/**
 * Reading a past quotation out of its own PDF, in front of a person.
 *
 * The company has years of quotations that exist only as PDFs, and re-typing
 * one to quote a repeat customer is where a quantity gets transposed. The
 * reading is deliberately *shown* rather than imported: across the 167 real
 * documents this was measured against, a handful of rows carry a discount or
 * transport column that no arithmetic resolves, and the only safe thing to do
 * with those is put them beside the rows that did resolve and let somebody
 * look.
 *
 * The first thing on screen is therefore the check, not the lines: do the
 * lines read add up to the total the document itself printed. A reading that
 * silently disagreed with the paper is the outcome worth preventing.
 */

const MAX_BYTES = 25 * 1024 * 1024;

/**
 * The totals a quotation prints, named in the reader's language. The parser
 * keeps the word the document used, which is an English key; passing it
 * straight through left `Printed: total` sitting in an Arabic table.
 */
const PRINTED_LABELS: Record<string, { en: string; ar: string }> = {
  total: { en: "total", ar: "الإجمالي" },
  "sub total": { en: "subtotal", ar: "المجموع الفرعي" },
  "grand total": { en: "grand total", ar: "الإجمالي النهائي" },
};

export function QuotationPdfReader({
  client,
  onClose,
}: {
  client: ApiClient;
  onClose: () => void;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const navigate = useNavigate();
  const input = useRef<HTMLInputElement>(null);
  const [tooBig, setTooBig] = useState(false);

  const [accountId, setAccountId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");

  const read = useMutation({
    mutationFn: (file: File) => readQuotationPdf(client, file),
    onSuccess: () => {
      setAccountId("");
      setOpportunityId("");
    },
  });
  const reading: QuotationPdfReading | undefined = read.data;

  // The customers this actor can see, so the name on the document can be
  // matched against them. The list is not searchable server-side, so the
  // matching happens here, on the page the person is already looking at.
  const accounts = useQuery({
    queryKey: ["accounts", "pdf-reader"],
    queryFn: () => listAccounts(client, { page: 1, limit: 200 }),
    enabled: reading !== undefined,
    retry: false,
  });
  const candidates =
    reading?.clientName != null && accounts.data !== undefined
      ? matchName(
          reading.clientName,
          accounts.data.data,
          (account) => account.canonicalName,
        )
      : [];
  const suggested = soleExactMatch(candidates);
  const chosenAccountId = accountId || suggested?.accountId || "";

  const opportunities = useQuery({
    queryKey: ["opportunities", "pdf-reader", chosenAccountId],
    queryFn: () =>
      listOpportunities(client, {
        page: 1,
        limit: 100,
        accountId: chosenAccountId,
      }),
    enabled: chosenAccountId !== "",
    retry: false,
  });

  const accept = useMutation({
    mutationFn: () =>
      createQuotationFromReading(client, {
        opportunityId,
        lines: (reading?.lines ?? []).map((line) => ({
          description: line.description,
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
      }),
    onSuccess: (created) => {
      void navigate(`/quotations/${created.quotationId}`);
    },
  });

  const printedLabel = (label: string) => {
    const known = PRINTED_LABELS[label];
    return known === undefined ? label : ar ? known.ar : known.en;
  };
  const money = (value: number) =>
    formatNum(value, locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  return (
    <section
      className="pdf-reader"
      aria-label={txt("Read a past quotation", "قراءة عرض سعر سابق")}
    >
      <header className="pdf-reader-head">
        <div>
          <h3>{txt("Read a past quotation", "قراءة عرض سعر سابق")}</h3>
          <p>
            {txt(
              "Pick a quotation PDF. Nothing is saved — you see what it was read to contain first.",
              "اختار ملف PDF لعرض سعر. مفيش حاجة بتتحفظ — بتشوف الأول هو اتقرا إيه.",
            )}
          </p>
        </div>
        <button type="button" onClick={onClose}>
          {txt("Close", "إغلاق")}
        </button>
      </header>

      <div className="pdf-reader-pick">
        <input
          ref={input}
          id="quotation-pdf-file"
          type="file"
          accept="application/pdf,.pdf"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file === undefined) return;
            setTooBig(file.size > MAX_BYTES);
            if (file.size > MAX_BYTES) return;
            read.mutate(file);
          }}
        />
      </div>

      {tooBig && (
        <p className="pdf-reader-problem" role="alert">
          {txt(
            "That file is larger than 25 MB. A quotation is a few pages — check it is the right file.",
            "الملف أكبر من ٢٥ ميجا. عرض السعر بيبقى كام صفحة — اتأكد إنه الملف الصح.",
          )}
        </p>
      )}

      {read.isPending && (
        <p className="pdf-reader-status">{txt("Reading…", "بيقرا…")}</p>
      )}

      {read.isError && (
        <p className="pdf-reader-problem" role="alert">
          {txt(
            "That file could not be read as a quotation.",
            "مقدرناش نقرا الملف ده كعرض سعر.",
          )}
        </p>
      )}

      {reading !== undefined && (
        <div className="pdf-reader-result">
          {/* The verdict first: a reading that disagrees with the paper is
              the thing worth seeing before anything else. */}
          <p
            className={`pdf-reader-verdict is-${
              reading.reconciled === null
                ? "unknown"
                : reading.reconciled
                  ? "ok"
                  : "off"
            }`}
          >
            {reading.reconciled === null
              ? txt(
                  "This document printed no total to check against.",
                  "الملف ده مطبعش إجمالي نقارن بيه.",
                )
              : reading.reconciled
                ? txt(
                    "The lines read add up to the total the document printed.",
                    "البنود اللي اتقرت بتجمع على الإجمالي المطبوع في الملف.",
                  )
                : txt(
                    "The lines read do NOT add up to the total the document printed — check the rows below.",
                    "البنود اللي اتقرت مش بتجمع على الإجمالي المطبوع — راجع السطور تحت.",
                  )}
          </p>

          <dl className="pdf-reader-header">
            <div>
              <dt>{txt("Quotation ref", "رقم العرض")}</dt>
              <dd>{reading.quoteRef ?? "—"}</dd>
            </div>
            <div>
              <dt>{txt("Date", "التاريخ")}</dt>
              <dd>{reading.quoteDate ?? "—"}</dd>
            </div>
            <div>
              <dt>{txt("Client", "العميل")}</dt>
              <dd>{reading.clientName ?? "—"}</dd>
            </div>
            <div>
              <dt>{txt("Project", "المشروع")}</dt>
              <dd>{reading.projectName ?? "—"}</dd>
            </div>
            <div>
              <dt>{txt("Attention", "لعناية")}</dt>
              <dd>{reading.attention ?? "—"}</dd>
            </div>
            <div>
              <dt>{txt("Sales engineer", "مهندس المبيعات")}</dt>
              <dd>{reading.salesEngineer ?? "—"}</dd>
            </div>
          </dl>

          <div className="enterprise-table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>{txt("Item description", "وصف البند")}</th>
                  <th>{txt("Qty", "الكمية")}</th>
                  <th>{txt("Unit price", "سعر الوحدة")}</th>
                  <th>{txt("Total excl. VAT", "الإجمالي قبل الضريبة")}</th>
                </tr>
              </thead>
              <tbody>
                {reading.lines.map((line, index) => (
                  <tr key={`${line.description}-${String(index)}`}>
                    <td>{index + 1}</td>
                    <td>{line.description}</td>
                    <td>{formatNum(line.qty, locale)}</td>
                    <td>{money(line.unitPrice)}</td>
                    <td>{money(line.lineTotal)}</td>
                  </tr>
                ))}
                {reading.lines.length === 0 && (
                  <tr>
                    <td colSpan={5}>
                      {txt(
                        "No priced rows were found in this document.",
                        "مفيش سطور أسعار في الملف ده.",
                      )}
                    </td>
                  </tr>
                )}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>{txt("Read subtotal", "مجموع المقروء")}</td>
                  <td>{money(reading.subtotal)}</td>
                </tr>
                {reading.printedTotals.map((total, index) => (
                  <tr key={`${total.label}-${String(index)}`}>
                    <td colSpan={4}>
                      {txt("Printed", "مطبوع في الملف")}:{" "}
                      {printedLabel(total.label)}
                    </td>
                    <td>{money(total.value)}</td>
                  </tr>
                ))}
              </tfoot>
            </table>
          </div>

          {reading.unreconciledRows.length > 0 && (
            <div className="pdf-reader-flagged">
              <h4>{txt("Rows that need a person", "سطور محتاجة مراجعة")}</h4>
              <p>
                {txt(
                  "No quantity in these rows makes quantity × unit price equal the total, so none was assumed. They are shown exactly as printed.",
                  "مفيش رقم في السطور دي يخلي الكمية × سعر الوحدة = الإجمالي، فمحدش افترض حاجة. دي معروضة زي ما هي مطبوعة بالظبط.",
                )}
              </p>
              <ul>
                {reading.unreconciledRows.map((row, index) => (
                  <li key={`${row}-${String(index)}`}>
                    <code>{row}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {reading.lines.length > 0 && (
            <div className="pdf-reader-accept">
              <h4>
                {txt("Create a draft from this", "اعمل مسودة من القراية دي")}
              </h4>
              <p>
                {txt(
                  "A quotation belongs to an opportunity, so pick the customer and the deal this one is for. The lines above are copied into a new draft you can edit — nothing is sent.",
                  "عرض السعر بيبقى على فرصة بيع، فاختار العميل والصفقة. البنود اللي فوق بتتنسخ في مسودة جديدة تقدر تعدلها — مفيش حاجة بتتبعت.",
                )}
              </p>

              {reading.clientName !== null && (
                <p className="pdf-reader-match">
                  {txt("The document names", "الملف مكتوب فيه")}:{" "}
                  <strong>{reading.clientName}</strong>
                  {" — "}
                  {candidates.length === 0
                    ? txt(
                        "no customer on the system matches that name.",
                        "مفيش عميل على النظام بالاسم ده.",
                      )
                    : suggested !== null
                      ? txt(
                          "one customer matches it exactly, selected below.",
                          "فيه عميل واحد مطابق بالظبط، متحدد تحت.",
                        )
                      : txt(
                          "these customers are close; none is an exact match, so none was chosen for you.",
                          "العملاء دول قريبين؛ مفيش واحد مطابق بالظبط، فمحدش اتحدد.",
                        )}
                </p>
              )}

              <div className="pdf-reader-accept-fields">
                <label>
                  <span>{txt("Customer", "العميل")}</span>
                  <select
                    value={chosenAccountId}
                    onChange={(event) => {
                      setAccountId(event.target.value);
                      setOpportunityId("");
                    }}
                  >
                    <option value="">{txt("Select…", "اختار…")}</option>
                    {/* Suggestions first, then everything, so a near match is
                        offered without hiding the rest of the book. */}
                    {candidates.map((candidate) => (
                      <option
                        key={candidate.item.accountId}
                        value={candidate.item.accountId}
                      >
                        {candidate.item.canonicalName}
                        {candidate.exact
                          ? txt(" — exact match", " — مطابق تماماً")
                          : txt(" — close match", " — قريب")}
                      </option>
                    ))}
                    {(accounts.data?.data ?? [])
                      .filter(
                        (account) =>
                          !candidates.some(
                            (candidate) =>
                              candidate.item.accountId === account.accountId,
                          ),
                      )
                      .map((account) => (
                        <option
                          key={account.accountId}
                          value={account.accountId}
                        >
                          {account.canonicalName}
                        </option>
                      ))}
                  </select>
                </label>

                <label>
                  <span>{txt("Opportunity", "فرصة البيع")}</span>
                  <select
                    disabled={chosenAccountId === ""}
                    value={opportunityId}
                    onChange={(event) => {
                      setOpportunityId(event.target.value);
                    }}
                  >
                    <option value="">{txt("Select…", "اختار…")}</option>
                    {(opportunities.data?.data ?? []).map((opportunity) => (
                      <option
                        key={opportunity.opportunityId}
                        value={opportunity.opportunityId}
                      >
                        {opportunity.opportunityRef}
                        {opportunity.title === null
                          ? ""
                          : ` — ${opportunity.title}`}
                      </option>
                    ))}
                  </select>
                </label>

                <button
                  type="button"
                  className="primary"
                  disabled={opportunityId === "" || accept.isPending}
                  onClick={() => {
                    accept.mutate();
                  }}
                >
                  {accept.isPending
                    ? txt("Creating…", "بيعمل…")
                    : txt("Create draft quotation", "اعمل مسودة عرض سعر")}
                </button>
              </div>

              {chosenAccountId !== "" &&
                opportunities.isSuccess &&
                opportunities.data.data.length === 0 && (
                  <p className="pdf-reader-status">
                    {txt(
                      "That customer has no open opportunity. Create one first, then come back.",
                      "العميل ده مفيش عنده فرصة بيع. اعملها الأول وارجع.",
                    )}
                  </p>
                )}

              {reading.unreconciledRows.length > 0 && (
                <p className="pdf-reader-status">
                  {txt(
                    "The rows above that need a person are NOT copied into the draft — add them by hand.",
                    "السطور اللي محتاجة مراجعة فوق مش بتتنسخ في المسودة — ضيفها بإيدك.",
                  )}
                </p>
              )}

              {accept.isError && (
                <p className="pdf-reader-problem" role="alert">
                  {txt(
                    "The draft could not be created.",
                    "مقدرناش نعمل المسودة.",
                  )}
                </p>
              )}
            </div>
          )}

          {reading.terms.length > 0 && (
            <dl className="pdf-reader-terms">
              {reading.terms.map((term, index) => (
                <div key={`${term.label}-${String(index)}`}>
                  <dt>{term.label}</dt>
                  <dd>{term.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>
      )}
    </section>
  );
}
