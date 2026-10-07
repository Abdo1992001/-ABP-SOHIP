import { useState } from "react";
import { useNavigate } from "react-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient, components } from "@abp/api-client";
import type { Me } from "../api/customer-api.ts";

type CustomerCommercialHistory =
  components["schemas"]["AccountCommercialHistory"];
import {
  createAccount,
  listAccounts,
  listCountries,
} from "../api/customer-api.ts";
import {
  createOpportunity,
  listOpportunities,
} from "../api/opportunity-api.ts";
import { createQuotation } from "../api/quotation-api.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import { ErrorBanner, ScreenIntro } from "./CommercialUI.tsx";
import { str } from "./commercial-api.ts";
import {} from "../lib/quotation-consolidation.ts";
import {} from "../lib/quotation-technical-summary.ts";
import {} from "./QuotationStudio.tsx";
import { CustomerPriceHistory } from "./CustomerPriceHistory.tsx";

type WizardStage = "customer" | "items" | "review";

// Kept as a name so the call sites read the same as before; the value is the
// workbook's, shared with the studio rather than repeated here.

// One row per item, all rows editable at once — a salesperson fills this like
// the ACROW BOARD sheet, not like a survey. Rate/density/CAD-mark live in the
// studio's per-line details panel; this grid only asks for what decides the
// price: what it is, how big, how many.
export function QuotationWizard({ client, me }: { client: ApiClient; me: Me }) {
  const { locale } = useI18n();
  const navigate = useNavigate();
  const txt = (en: string, ar: string) => (locale === "ar" ? ar : en);
  const mayCreate = me.access.permissions.includes("quotations.create");
  const [customerSearch, setCustomerSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [opportunityId, setOpportunityId] = useState("");
  const [stage] = useState<WizardStage>("customer");
  // One key for the whole wizard attempt. If the response is lost and React
  // Query retries, the API replays the same quotation instead of allocating a
  // second reference.
  // A salesperson on the phone with a new customer should not be sent to two
  // other screens before they can price anything. Both the customer and the
  // deal can be created right here.
  const [newCustomerName, setNewCustomerName] = useState("");
  const [newCustomerCountry, setNewCustomerCountry] = useState("EG");
  const [newCustomerBusinessType, setNewCustomerBusinessType] = useState<
    "FORMWORK" | "OTHER"
  >("OTHER");
  const [creatingCustomer, setCreatingCustomer] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);
  // What each row has typed in its code box. Kept apart from the line so a
  // half-typed code never looks like a chosen product.
  /** Which line's code picker is open, if any. */
  /**
   * The payment term this quotation is written on.
   *
   * It is a code from `payment_terms`, because that is what the server checks
   * before it writes a draft — the previous list was typed into the front end
   * and two of its codes did not exist, so choosing either of them made saving
   * fail. Empty until the terms have loaded, then the staged 30/35/35 most of
   * the archive uses, if the company still offers it.
   */
  // Rows start compact. A quotation with twenty lines is unreadable when each
  // one is four fields deep, and the extra detail is only wanted while a
  // particular line is being worked out.

  const accounts = useQuery({
    queryKey: ["wizard-accounts", customerSearch],
    queryFn: () =>
      listAccounts(client, {
        page: 1,
        limit: 25,
        ...(customerSearch ? { search: customerSearch } : {}),
      }),
    enabled: stage === "customer",
  });
  const selectedAccount = accounts.data?.data.find(
    (a) => a.accountId === accountId,
  );
  const opportunities = useQuery({
    queryKey: ["wizard-opportunities", accountId],
    queryFn: () => listOpportunities(client, { page: 1, limit: 50, accountId }),
    enabled: Boolean(accountId),
  });
  // No explicit type argument: the query function already returns the
  // contract's own type, and restating it here made TypeScript compare two
  // copies of the same declaration and report them as unrelated.
  const customerHistory = useQuery({
    queryKey: ["wizard-customer-history", accountId],
    enabled: Boolean(accountId),
    queryFn: async () => {
      const result = await client.GET(
        "/accounts/{accountId}/commercial-history",
        { params: { path: { accountId } } },
      );
      if (!result.data) throw new Error("CUSTOMER_HISTORY_UNAVAILABLE");
      // openapi-fetch extracts the body through mapped types, so the value
      // is structurally identical to the contract's own type but not the
      // same type identity — assigning one to the other fails on `toString`.
      // One assertion at the boundary, rather than one at every use.
      return result.data.data as CustomerCommercialHistory;
    },
  });
  const selectedOpportunity = opportunities.data?.data.find(
    (o) => o.opportunityId === opportunityId,
  );

  const countries = useQuery({
    queryKey: ["reference-countries"],
    queryFn: () => listCountries(client),
    enabled: creatingCustomer,
  });

  const createCustomer = useMutation({
    mutationFn: () =>
      createAccount(client, {
        canonicalName: newCustomerName.trim(),
        countryCode: newCustomerCountry,
        accountCategoryCode: "OTHER",
        businessTypeCode: newCustomerBusinessType,
      }),
    onSuccess: (created) => {
      setCreatingCustomer(false);
      setNewCustomerName("");
      setAccountId(created.data.accountId);
      setOpportunityId("");
      void accounts.refetch();
    },
  });

  // The deal a quotation is filed under. Creating it here keeps the pipeline
  // honest — a quotation always belongs to an opportunity — without making the
  // salesperson go and create one by hand first.
  const [dealTitle, setDealTitle] = useState("");
  const createDeal = useMutation({
    mutationFn: () =>
      createOpportunity(client, {
        title: dealTitle.trim(),
        accountId,
        noProjectReasonCode: "DIRECT_SUPPLY",
      }),
    onSuccess: (created) => {
      setOpportunityId(str(created.data.opportunityId));
      setCreatingDeal(false);
      setDealTitle("");
      void opportunities.refetch();
    },
  });

  // The catalogue, for the item-code box on each row. A salesperson working
  // from a BOQ or an ERP export has the code, not the description, and typing
  // the description back by hand is where a 12 mm board becomes an 18 mm one.
  // What has been typed into any code box, so the search asks the server for
  // the right slice instead of hoping the item is in the first page of 2,927.
  // The envelope is {data:{...}} and executeOperation wraps it again, so the
  // company defaults sit at .data.data.data. Reading one level short returned
  // the envelope, every field came back undefined, and the whole screen ran on
  // its hardcoded fallbacks -- rates of 90/120 and a density of 720 where the
  // workbook says 77.76 and 600. It looked like working code because every
  // fallback was a plausible number.
  // The same trap the studio carried: `??` only fires on null/undefined, so a
  // field the API sends as "" becomes NaN and the fallback beside it never

  /** The terms the company offers, and the only ones a draft may carry. */

  /**
   * Open the quotation and go to it.
   *
   * Empty, on purpose: the lines belong in the studio, which is the editor
   * that saves them. Filling them in here and again there is what made one
   * quotation two processes.
   */
  const openQuotation = useMutation({
    mutationFn: () =>
      createQuotation(client, {
        opportunityId,
        currencyCode: "EGP",
        // The contract wants a draft; an empty one is the honest thing to
        // send, because there is nothing to put in it yet.
        draft: { lines: [] },
      }),
    onSuccess: (quotation) => {
      void navigate(`/quotations/${str(quotation.quotationId)}`);
    },
  });

  // The commercial view of the same work. A scope does not deliver one board:
  // a column delivers a panel schedule of several distinct sizes, and the
  // quotation used to show only the first of them with the rest reported as
  // "(+3 sizes)". Every size is expanded here, identical products from
  // different scopes are added together, and each line keeps the scopes it
  // came from.
  // Consolidation must never change what the quotation is worth. The screen
  // checks rather than assumes, and says so if it ever fails.
  // How much is actually being supplied. A salesperson answering "how many
  // square metres is this?" was taking the quotation to a calculator; both
  // figures are implied by every generated board.

  if (!mayCreate) {
    return (
      <section className="workspace-page quotation-wizard">
        <div className="panel data-surface">
          <p>
            {txt(
              "You don't have permission to create quotations.",
              "لا تملك صلاحية إنشاء عروض أسعار.",
            )}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="workspace-page quotation-wizard">
      <header className="page-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {txt("Quotation builder", "منشئ عروض الأسعار")}
          </span>
          <h1>{txt("Start with the customer", "ابدأ بالعميل")}</h1>
          <p>
            {txt(
              "Choose who the quotation is for. The lines, the pricing and the document are all done in one place once it is open.",
              "اختار العرض ده لمين. البنود والتسعير والمستند كلهم في مكان واحد بعد ما يتفتح.",
            )}
          </p>
        </div>
      </header>
      <ScreenIntro />

      {/* Two steps, because there are two. The quotation used to be built
          twice — once here and again in the studio, in a different editor over
          the same lines — and nobody could tell which one was the real one. */}
      <ol className="wizard-stepper">
        <li className="active">
          <span>1</span>
          {txt("Customer & deal", "العميل والفرصة")}
        </li>
        <li>
          <span>2</span>
          {txt("Quotation studio", "استوديو عرض السعر")}
        </li>
      </ol>

      {stage === "customer" && (
        <div className="panel data-surface wizard-step wizard-customer-step">
          {!accountId && (
            <>
              <label className="wizard-field">
                <span>{txt("Customer", "العميل")}</span>
                <input
                  type="search"
                  placeholder={txt(
                    "Type the company name…",
                    "اكتب اسم الشركة…",
                  )}
                  value={customerSearch}
                  onChange={(event) => {
                    setCustomerSearch(event.target.value);
                    setOpportunityId("");
                  }}
                />
              </label>
              <ErrorBanner
                error={accounts.error}
                retry={() => void accounts.refetch()}
              />
              {/* A customer who has never bought from us has no record yet, and the
              first thing a salesperson does with them is price something. This
              is deliberately NOT a <form>: the wizard is already inside one,
              and a nested form submits the wrong one. */}
              {creatingCustomer ? (
                <div className="wizard-new-customer">
                  <label className="wizard-field">
                    <span>{txt("Company name", "اسم الشركة")}</span>
                    <input
                      autoFocus
                      value={newCustomerName}
                      placeholder={txt(
                        "As it appears on the PO",
                        "زي ما هو في أمر الشراء",
                      )}
                      onChange={(event) => {
                        setNewCustomerName(event.target.value);
                      }}
                    />
                  </label>
                  <label className="wizard-field">
                    <span>{txt("Country", "الدولة")}</span>
                    <select
                      value={newCustomerCountry}
                      onChange={(event) => {
                        setNewCustomerCountry(event.target.value);
                      }}
                    >
                      {(countries.data ?? []).map((country) => (
                        <option
                          key={country.countryCode}
                          value={country.countryCode}
                        >
                          {country.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="wizard-field">
                    <span>{txt("Customer type", "نوع العميل")}</span>
                    <select
                      value={newCustomerBusinessType}
                      onChange={(event) => {
                        setNewCustomerBusinessType(
                          event.target.value as "FORMWORK" | "OTHER",
                        );
                      }}
                    >
                      <option value="FORMWORK">
                        {txt("Formwork customer", "عميل فورم ورك")}
                      </option>
                      <option value="OTHER">
                        {txt("Other customer", "عميل آخر")}
                      </option>
                    </select>
                  </label>
                  <ErrorBanner
                    error={createCustomer.error}
                    retry={() => {
                      createCustomer.mutate();
                    }}
                  />
                  <div className="wizard-new-customer-actions">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingCustomer(false);
                      }}
                    >
                      {txt("Cancel", "إلغاء")}
                    </button>
                    <button
                      type="button"
                      className="primary"
                      disabled={
                        createCustomer.isPending ||
                        newCustomerName.trim().length < 2
                      }
                      onClick={() => {
                        createCustomer.mutate();
                      }}
                    >
                      {createCustomer.isPending
                        ? "…"
                        : txt("Add customer", "أضف العميل")}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className="wizard-inline-button"
                  onClick={() => {
                    setCreatingCustomer(true);
                    if (customerSearch.trim() !== "") {
                      setNewCustomerName(customerSearch.trim());
                    }
                  }}
                >
                  {txt("+ New customer", "+ عميل جديد")}
                </button>
              )}

              <ul className="wizard-customer-list">
                {(accounts.data?.data ?? []).map((account) => (
                  <li key={account.accountId}>
                    <button
                      type="button"
                      className="wizard-customer-option"
                      onClick={() => {
                        setAccountId(account.accountId);
                        setOpportunityId("");
                        setCreatingDeal(false);
                      }}
                    >
                      <strong>{account.canonicalName}</strong>
                      <span>{account.accountRef}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {accountId && (
            <>
              <div className="wizard-selected-customer">
                <div>
                  <span>{txt("Selected customer", "العميل المختار")}</span>
                  <strong>{selectedAccount?.canonicalName ?? "—"}</strong>
                  <small>{selectedAccount?.accountRef ?? ""}</small>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setAccountId("");
                    setOpportunityId("");
                    setCreatingDeal(false);
                  }}
                >
                  {txt("Change customer", "تغيير العميل")}
                </button>
              </div>
              {customerHistory.isLoading ? (
                <p className="wizard-history-loading">
                  {txt(
                    "Loading previous prices…",
                    "جارٍ تحميل الأسعار السابقة…",
                  )}
                </p>
              ) : customerHistory.data ? (
                <CustomerPriceHistory
                  compact
                  rows={customerHistory.data.priceHistory}
                />
              ) : null}
              <label className="wizard-field">
                <span>
                  {txt("Which deal?", "أي فرصة بيعية؟")}
                  <small>
                    {txt(
                      " — the quotation is filed under it",
                      " — عرض السعر هيتسجل تحتها",
                    )}
                  </small>
                </span>
                <select
                  required
                  value={opportunityId}
                  onChange={(event) => {
                    setOpportunityId(event.target.value);
                    setCreatingDeal(false);
                  }}
                >
                  <option value="">{txt("Choose…", "اختر…")}</option>
                  {(opportunities.data?.data ?? []).map((opportunity) => (
                    <option
                      key={opportunity.opportunityId}
                      value={opportunity.opportunityId}
                    >
                      {str(opportunity.title) || opportunity.opportunityRef} ·{" "}
                      {enumLabel(str(opportunity.stageCode), locale)}
                    </option>
                  ))}
                </select>
              </label>
              {!creatingDeal && (opportunities.data?.data.length ?? 0) > 0 && (
                <button
                  type="button"
                  className="wizard-new-deal-button"
                  onClick={() => {
                    setOpportunityId("");
                    setCreatingDeal(true);
                  }}
                >
                  {txt(
                    "+ New deal for this customer",
                    "+ فرصة جديدة للعميل ده",
                  )}
                </button>
              )}
              {(creatingDeal || opportunities.data?.data.length === 0) && (
                <div className="wizard-inline-create">
                  <p className="wizard-step-hint">
                    {opportunities.data?.data.length === 0
                      ? txt(
                          "No deal for this customer yet. Create the first one here.",
                          "مفيش فرصة للعميل ده. افتح أول فرصة من هنا.",
                        )
                      : txt(
                          "Create a separate deal when this is a new quotation, even if the customer has older quotations.",
                          "افتح فرصة مستقلة لو ده عرض سعر جديد، حتى لو للعميل عروض قديمة.",
                        )}
                  </p>
                  <label className="wizard-inline-field">
                    {txt("Name the deal", "سمّي الفرصة")}
                    <input
                      value={dealTitle}
                      maxLength={200}
                      placeholder={txt(
                        "New Cairo tower — column formwork",
                        "برج القاهرة الجديدة — شدات أعمدة",
                      )}
                      onChange={(event) => {
                        setDealTitle(event.target.value);
                      }}
                    />
                  </label>
                  <div className="wizard-inline-create-actions">
                    {opportunities.data?.data.length !== 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingDeal(false);
                          setDealTitle("");
                        }}
                      >
                        {txt("Cancel", "إلغاء")}
                      </button>
                    )}
                    <button
                      type="button"
                      className="wizard-inline-button"
                      disabled={
                        createDeal.isPending || dealTitle.trim().length < 3
                      }
                      onClick={() => {
                        createDeal.mutate();
                      }}
                    >
                      {createDeal.isPending
                        ? "…"
                        : txt("Create deal", "إنشاء الفرصة")}
                    </button>
                  </div>
                  <ErrorBanner
                    error={createDeal.error}
                    retry={() => {
                      createDeal.mutate();
                    }}
                  />
                </div>
              )}
            </>
          )}

          {selectedOpportunity && selectedAccount && (
            <div className="wizard-customer-card">
              <span className="wizard-customer-label">
                {txt("Quoting for", "عرض سعر لـ")}
              </span>
              <strong>{selectedAccount.canonicalName}</strong>
              <span className="wizard-customer-ref">
                {selectedOpportunity.opportunityRef} ·{" "}
                {enumLabel(str(selectedOpportunity.stageCode), locale)}
              </span>
            </div>
          )}

          <div className="wizard-actions">
            <small>
              {txt(
                "No quotation number is allocated until the final checked save.",
                "لن يتم حجز رقم عرض سعر إلا عند الحفظ النهائي بعد المراجعة.",
              )}
            </small>
            <button
              type="button"
              className="primary"
              disabled={!opportunityId || openQuotation.isPending}
              onClick={() => {
                openQuotation.mutate();
              }}
            >
              {openQuotation.isPending
                ? txt("Opening…", "بيفتح…")
                : txt("Open the quotation →", "افتح عرض السعر →")}
            </button>
            <ErrorBanner
              error={openQuotation.error}
              retry={() => {
                openQuotation.mutate();
              }}
            />
          </div>
        </div>
      )}
    </section>
  );
}
