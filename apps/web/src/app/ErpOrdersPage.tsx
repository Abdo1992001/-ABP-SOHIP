import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router";
import type { ApiClient, components } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { listCountries } from "../api/customer-api.ts";
import { ErrorBanner, PageHeader, StatusChip } from "./CommercialUI.tsx";

type SalesOrder = components["schemas"]["SalesOrderFact"];
type SalesOrderLine = components["schemas"]["SalesOrderLine"];

/**
 * Sales order history.
 *
 * Two things make this screen different from a plain table of rows:
 *
 *  - External and group orders are separable. More than half of ACROW's order
 *    history is to its own companies, so a single undifferentiated list
 *    overstates external demand by roughly a factor of two.
 *  - Amounts are compared in EGP. The source orders are a mix of EGP and USD,
 *    and a column that adds those together is a number in no currency at all.
 */
export function ErpOrdersPage({ client }: { client: ApiClient }) {
  const { salesOrderId } = useParams<{ salesOrderId?: string }>();
  if (salesOrderId !== undefined && salesOrderId !== "") {
    return <OrderDetail client={client} salesOrderId={salesOrderId} />;
  }
  return <OrderList client={client} />;
}

const pageSize = 25;

function OrderList({ client }: { client: ApiClient }) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;
  const [params, setParams] = useSearchParams();

  const search = params.get("search") ?? "";
  const statusCode = params.get("statusCode") ?? "";
  const countryCode = params.get("countryCode") ?? "";
  const relationship = params.get("relationship") ?? "";
  const dateFrom = params.get("dateFrom") ?? "";
  const dateTo = params.get("dateTo") ?? "";
  const sort = params.get("sort") ?? "orderDate:desc";
  const page = Number(params.get("page") ?? "1") || 1;

  // Filters live in the URL, not in component state, so a filtered view can be
  // sent to a colleague or kept in a browser tab.
  const setParam = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value === "") next.delete(key);
    else next.set(key, value);
    if (key !== "page") next.delete("page");
    setParams(next, { replace: true });
  };

  const countries = useQuery({
    queryKey: ["countries"],
    queryFn: () => listCountries(client),
  });

  const orders = useQuery({
    queryKey: [
      "erp-orders",
      {
        search,
        statusCode,
        countryCode,
        relationship,
        dateFrom,
        dateTo,
        sort,
        page,
      },
    ],
    queryFn: async () => {
      const result = await client.GET("/sales-orders", {
        params: {
          query: {
            page,
            limit: pageSize,
            sort,
            ...(search.trim() ? { search: search.trim() } : {}),
            ...(statusCode ? { statusCode } : {}),
            ...(countryCode ? { countryCode } : {}),
            ...(relationship === "EXTERNAL" || relationship === "GROUP"
              ? { relationship }
              : {}),
            ...(dateFrom ? { dateFrom } : {}),
            ...(dateTo ? { dateTo } : {}),
          },
        },
      });
      if (!result.data)
        throw new Error(`SALES_ORDERS_${String(result.response.status)}`);
      return result.data as unknown as {
        data: SalesOrder[];
        meta: { total: number; hasNext: boolean };
      };
    },
  });

  const rows = orders.data?.data ?? [];
  const total = orders.data?.meta.total ?? 0;
  // Page total only — labelled as such, because a total that silently covers
  // one page of 789 orders is worse than no total.
  const pageValue = rows.reduce(
    (sum, row) => sum + Number(row.totalAmountEgp ?? 0),
    0,
  );

  const countryOptions = useMemo(() => countries.data ?? [], [countries.data]);

  return (
    <section className="erp-orders-page">
      <PageHeader
        kicker={labels.kicker}
        title={labels.title}
        count={total}
        sub={labels.subtitle}
      />

      <div className="erp-filters">
        <input
          className="erp-filter-search"
          type="search"
          value={search}
          placeholder={labels.searchPlaceholder}
          aria-label={labels.searchPlaceholder}
          onChange={(event) => {
            setParam("search", event.target.value);
          }}
        />
        <select
          value={relationship}
          aria-label={labels.relationship}
          onChange={(event) => {
            setParam("relationship", event.target.value);
          }}
        >
          <option value="">{labels.allCustomers}</option>
          <option value="EXTERNAL">{labels.externalOnly}</option>
          <option value="GROUP">{labels.groupOnly}</option>
        </select>
        <select
          value={statusCode}
          aria-label={labels.status}
          onChange={(event) => {
            setParam("statusCode", event.target.value);
          }}
        >
          <option value="">{labels.allStatuses}</option>
          <option value="BOOKED">{labels.booked}</option>
          <option value="CLOSED">{labels.closed}</option>
          <option value="CANCELLED">{labels.cancelled}</option>
        </select>
        <select
          value={countryCode}
          aria-label={labels.country}
          onChange={(event) => {
            setParam("countryCode", event.target.value);
          }}
        >
          <option value="">{labels.allCountries}</option>
          {countryOptions.map((country) => (
            <option key={country.countryCode} value={country.countryCode}>
              {country.displayName}
            </option>
          ))}
        </select>
        <label className="erp-filter-date">
          {labels.from}
          <input
            type="date"
            value={dateFrom}
            onChange={(event) => {
              setParam("dateFrom", event.target.value);
            }}
          />
        </label>
        <label className="erp-filter-date">
          {labels.to}
          <input
            type="date"
            value={dateTo}
            onChange={(event) => {
              setParam("dateTo", event.target.value);
            }}
          />
        </label>
        <select
          value={sort}
          aria-label={labels.sort}
          onChange={(event) => {
            setParam("sort", event.target.value);
          }}
        >
          <option value="orderDate:desc">{labels.newestFirst}</option>
          <option value="orderDate:asc">{labels.oldestFirst}</option>
          <option value="totalAmount:desc">{labels.largestFirst}</option>
          <option value="orderNumber:asc">{labels.byOrderNumber}</option>
        </select>
      </div>

      <ErrorBanner
        error={orders.error}
        retry={() => {
          void orders.refetch();
        }}
      />

      <div className="enterprise-table-scroll">
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>{labels.order}</th>
              <th>{labels.customer}</th>
              <th>{labels.country}</th>
              <th>{labels.orderDate}</th>
              <th>{labels.status}</th>
              <th>{labels.items}</th>
              <th>{labels.value}</th>
              <th>{labels.valueEgp}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.salesOrderId}>
                <td>
                  <Link to={`/orders/${row.salesOrderId}`}>
                    {row.orderNumber}
                  </Link>
                  {row.customerPoNumber !== null &&
                    row.customerPoNumber !== undefined &&
                    row.customerPoNumber !== "" && (
                      <small className="erp-po">{row.customerPoNumber}</small>
                    )}
                </td>
                <td>
                  {row.accountId ? (
                    <Link to={`/customers/${row.accountId}`}>
                      {row.accountName ?? "—"}
                    </Link>
                  ) : (
                    (row.accountName ?? "—")
                  )}
                  {row.isIntercompany === true && (
                    <em className="abp2-history-chip">{labels.group}</em>
                  )}
                </td>
                <td>{row.countryCode ?? "—"}</td>
                <td>{row.orderDate ?? "—"}</td>
                <td>
                  <StatusChip code={row.statusCode} />
                </td>
                <td>{row.lineCount ?? 0}</td>
                <td className="numeric">
                  {money(row.totalAmount, row.currencyCode, locale)}
                </td>
                <td className="numeric">
                  {money(row.totalAmountEgp, "EGP", locale)}
                </td>
              </tr>
            ))}
            {!orders.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={8} className="table-empty">
                  {labels.noOrders}
                </td>
              </tr>
            )}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan={7}>{labels.pageTotal}</td>
                <td className="numeric">
                  {money(String(pageValue), "EGP", locale)}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <footer className="pagination">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => {
            setParam("page", String(page - 1));
          }}
        >
          {labels.previous}
        </button>
        <span>
          {page} · {total}
        </span>
        <button
          type="button"
          disabled={orders.data?.meta.hasNext !== true}
          onClick={() => {
            setParam("page", String(page + 1));
          }}
        >
          {labels.next}
        </button>
      </footer>
    </section>
  );
}

function OrderDetail({
  client,
  salesOrderId,
}: {
  client: ApiClient;
  salesOrderId: string;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const labels = ar ? arLabels : enLabels;

  const order = useQuery({
    queryKey: ["erp-order", salesOrderId],
    queryFn: async () => {
      const result = await client.GET("/sales-orders/{salesOrderId}", {
        params: { path: { salesOrderId } },
      });
      if (!result.data)
        throw new Error(`SALES_ORDER_${String(result.response.status)}`);
      return result.data.data;
    },
  });
  const lines = useQuery({
    queryKey: ["erp-order-lines", salesOrderId],
    queryFn: async () => {
      const result = await client.GET("/sales-orders/{salesOrderId}/lines", {
        params: { path: { salesOrderId } },
      });
      if (!result.data)
        throw new Error(`SALES_ORDER_LINES_${String(result.response.status)}`);
      return result.data.data as SalesOrderLine[];
    },
  });

  const header = order.data;
  const items = lines.data ?? [];
  const unmatched = items.filter(
    (line) =>
      line.matchStatusCode === "UNMATCHED" &&
      line.itemClassificationCode === "SELLABLE_PRODUCT",
  ).length;

  return (
    <section className="erp-order-detail">
      <PageHeader
        kicker={labels.kicker}
        title={header?.orderNumber ?? labels.title}
        status={header?.accountName ?? ""}
        actions={
          <Link className="ghost-button" to="/orders">
            {labels.backToOrders}
          </Link>
        }
      />
      <ErrorBanner
        error={order.error}
        retry={() => {
          void order.refetch();
        }}
      />

      {header && (
        <dl className="erp-order-facts">
          <div>
            <dt>{labels.customer}</dt>
            <dd>
              {header.accountId ? (
                <Link to={`/customers/${header.accountId}`}>
                  {header.accountName ?? "—"}
                </Link>
              ) : (
                (header.accountName ?? "—")
              )}
              {header.isIntercompany === true && (
                <em className="abp2-history-chip">{labels.group}</em>
              )}
            </dd>
          </div>
          <div>
            <dt>{labels.orderDate}</dt>
            <dd>{header.orderDate ?? "—"}</dd>
          </div>
          <div>
            <dt>{labels.status}</dt>
            <dd>
              <StatusChip code={header.statusCode} />
            </dd>
          </div>
          <div>
            <dt>{labels.value}</dt>
            <dd>{money(header.totalAmount, header.currencyCode, locale)}</dd>
          </div>
          <div>
            <dt>{labels.valueEgp}</dt>
            <dd>{money(header.totalAmountEgp, "EGP", locale)}</dd>
          </div>
          <div>
            <dt>{labels.salesRep}</dt>
            <dd>{header.salesRep ?? "—"}</dd>
          </div>
          <div>
            <dt>{labels.customerPo}</dt>
            <dd>{header.customerPoNumber ?? "—"}</dd>
          </div>
          <div>
            <dt>{labels.country}</dt>
            <dd>{header.countryCode ?? "—"}</dd>
          </div>
        </dl>
      )}

      {unmatched > 0 && (
        // Stated plainly rather than hidden: an unmatched sellable item means
        // this order's product analytics are incomplete, and someone has to
        // decide what the item is before that changes.
        <p className="erp-unmatched-note">
          {unmatched} {labels.unmatchedNote}{" "}
          <Link to="/data/quality">{labels.openReview}</Link>
        </p>
      )}

      <div className="enterprise-table-scroll">
        <table className="enterprise-table">
          <thead>
            <tr>
              <th>#</th>
              <th>{labels.item}</th>
              <th>{labels.kind}</th>
              <th>{labels.qtyOrdered}</th>
              <th>{labels.qtyShipped}</th>
              <th>{labels.unitPrice}</th>
              <th>{labels.value}</th>
              <th>{labels.lineStatus}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((line) => (
              <tr key={line.salesOrderLineId}>
                <td>{line.lineNo ?? "—"}</td>
                <td>
                  <span className="erp-line-desc">
                    {line.productDescription ??
                      line.description ??
                      line.orderedItem}
                  </span>
                  <small className="erp-line-code">{line.orderedItem}</small>
                </td>
                <td>
                  <span
                    className={`erp-kind is-${line.itemClassificationCode.toLowerCase()}`}
                  >
                    {labels.classifications[line.itemClassificationCode] ??
                      line.itemClassificationCode}
                  </span>
                  {line.matchStatusCode === "UNMATCHED" && (
                    <small className="erp-line-unmatched">
                      {labels.notInCatalogue}
                    </small>
                  )}
                </td>
                <td className="numeric">{num(line.qtyOrdered, locale)}</td>
                <td className="numeric">{num(line.qtyShipped, locale)}</td>
                <td className="numeric">
                  {money(line.unitSellingPrice, line.currencyCode, locale)}
                </td>
                <td className="numeric">
                  {money(line.lineAmount, line.currencyCode, locale)}
                </td>
                <td>{line.lineStatusRaw ?? "—"}</td>
              </tr>
            ))}
            {!lines.isLoading && items.length === 0 && (
              <tr>
                <td colSpan={8} className="table-empty">
                  {labels.noItems}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function money(
  value: string | null | undefined,
  currency: string | null | undefined,
  locale: string,
) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `${amount.toLocaleString(locale === "ar" ? "ar-EG" : "en", {
    maximumFractionDigits: 0,
  })} ${currency ?? ""}`.trim();
}

function num(value: string | null | undefined, locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return amount.toLocaleString(locale === "ar" ? "ar-EG" : "en", {
    maximumFractionDigits: 2,
  });
}

const enLabels = {
  kicker: "History",
  title: "Sales orders",
  subtitle: "Imported from the ERP. External and group orders are separable.",
  searchPlaceholder: "Order number, customer, PO or rep",
  relationship: "Customer type",
  allCustomers: "All customers",
  externalOnly: "External customers only",
  groupOnly: "ACROW group only",
  status: "Status",
  allStatuses: "All statuses",
  booked: "Booked",
  closed: "Closed",
  cancelled: "Cancelled",
  country: "Country",
  allCountries: "All countries",
  from: "From",
  to: "To",
  sort: "Sort",
  newestFirst: "Newest first",
  oldestFirst: "Oldest first",
  largestFirst: "Largest value first",
  byOrderNumber: "By order number",
  order: "Order",
  customer: "Customer",
  orderDate: "Date",
  items: "Items",
  value: "Value",
  valueEgp: "Value (EGP)",
  pageTotal: "This page",
  group: "Group",
  noOrders: "No orders match these filters.",
  previous: "Previous",
  next: "Next",
  backToOrders: "All orders",
  salesRep: "Sales rep",
  customerPo: "Customer PO",
  item: "Item",
  kind: "Type",
  qtyOrdered: "Ordered",
  qtyShipped: "Shipped",
  unitPrice: "Unit price",
  lineStatus: "Line status",
  noItems: "This order has no items.",
  notInCatalogue: "not in the item master",
  unmatchedNote:
    "item(s) on this order are not in the item master, so they are missing from product analytics.",
  openReview: "Open the review queue",
  classifications: {
    SELLABLE_PRODUCT: "Product",
    SERVICE: "Service",
    LOGISTICS_CHARGE: "Logistics",
    MISCELLANEOUS: "Other",
    UNKNOWN: "Unclassified",
  } as Record<string, string>,
};

const arLabels: typeof enLabels = {
  kicker: "السجل",
  title: "أوامر البيع",
  subtitle: "مستوردة من الـ ERP. يمكن فصل الأوامر الخارجية عن أوامر المجموعة.",
  searchPlaceholder: "رقم الأمر أو العميل أو أمر الشراء أو المندوب",
  relationship: "نوع العميل",
  allCustomers: "كل العملاء",
  externalOnly: "العملاء الخارجيون فقط",
  groupOnly: "مجموعة أكرو فقط",
  status: "الحالة",
  allStatuses: "كل الحالات",
  booked: "محجوز",
  closed: "مغلق",
  cancelled: "ملغي",
  country: "الدولة",
  allCountries: "كل الدول",
  from: "من",
  to: "إلى",
  sort: "الترتيب",
  newestFirst: "الأحدث أولاً",
  oldestFirst: "الأقدم أولاً",
  largestFirst: "الأعلى قيمة أولاً",
  byOrderNumber: "حسب رقم الأمر",
  order: "الأمر",
  customer: "العميل",
  orderDate: "التاريخ",
  items: "البنود",
  value: "القيمة",
  valueEgp: "القيمة (جنيه)",
  pageTotal: "إجمالي هذه الصفحة",
  group: "مجموعة",
  noOrders: "لا توجد أوامر مطابقة.",
  previous: "السابق",
  next: "التالي",
  backToOrders: "كل الأوامر",
  salesRep: "المندوب",
  customerPo: "أمر شراء العميل",
  item: "الصنف",
  kind: "النوع",
  qtyOrdered: "المطلوب",
  qtyShipped: "المشحون",
  unitPrice: "سعر الوحدة",
  lineStatus: "حالة البند",
  noItems: "لا توجد بنود في هذا الأمر.",
  notInCatalogue: "غير موجود في دليل الأصناف",
  unmatchedNote:
    "بند في هذا الأمر غير موجود في دليل الأصناف، فلن يظهر في تحليلات المنتجات.",
  openReview: "افتح قائمة المراجعة",
  classifications: {
    SELLABLE_PRODUCT: "منتج",
    SERVICE: "خدمة",
    LOGISTICS_CHARGE: "نقل",
    MISCELLANEOUS: "أخرى",
    UNKNOWN: "غير مصنف",
  },
};
