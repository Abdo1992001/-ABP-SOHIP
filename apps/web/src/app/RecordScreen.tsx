import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import {
  executeOperation,
  operationById,
  type OperationContract,
} from "../api/operation-runtime.ts";
import { useI18n } from "../i18n/i18n.tsx";
import { enumLabel } from "../i18n/enum-labels.ts";
import type { Me } from "../api/customer-api.ts";
import {
  ErrorBanner,
  PageHeader,
  SlideOver,
  StatusChip,
  useScreenId,
} from "./CommercialUI.tsx";
import { recordActions } from "./record-actions.tsx";

/**
 * A real list-and-detail screen driven by a small per-screen description.
 *
 * The generic ContractScreen this replaces for most routes is an operation
 * browser: it shows the API surface (pick an operation, see the fields it
 * returned) rather than the records. That is a developer tool. A salesperson
 * needs named columns, a status they can read, a search box, and a row they can
 * open — which is all the same shape from screen to screen, so it is described
 * per screen rather than rewritten per screen.
 *
 * Anything genuinely different — the quotation studio, the dashboard, the order
 * history — stays a bespoke screen. This is for the long tail.
 */
export interface RecordColumn {
  /** Field on the record. Dotted paths are supported: "account.canonicalName". */
  field: string;
  en: string;
  ar: string;
  /** How to render the value. Default: plain text. */
  kind?:
    | "text"
    | "status"
    | "money"
    | "number"
    | "date"
    | "datetime"
    | "boolean"
    | "code";
  /** Currency field name for kind "money"; falls back to the row currencyCode. */
  currencyField?: string;
  /** Turns the cell into a link. Receives the row. */
  href?: (row: Record<string, unknown>) => string | null;
  /** Hidden on narrow screens when true — secondary detail, not identity. */
  secondary?: boolean;
}

export interface RecordFilter {
  param: string;
  en: string;
  ar: string;
  options: { value: string; en: string; ar: string }[];
}

export interface RecordScreenSpec {
  listOperationId: string;
  detailOperationId?: string;
  /** Route param that carries the record id, e.g. "shipmentId". */
  idParam?: string;
  idField: string;
  kicker: { en: string; ar: string };
  title: { en: string; ar: string };
  sub?: { en: string; ar: string };
  empty: { en: string; ar: string };
  columns: RecordColumn[];
  filters?: RecordFilter[];
  searchable?: boolean;
  /** Extra fields to show in the detail panel, beyond the columns. */
  detailFields?: RecordColumn[];
}

const pageSize = 25;

export function RecordScreen({
  client,
  me,
  spec,
}: {
  client: ApiClient;
  me: Me;
  spec: RecordScreenSpec;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const routeParams = useParams<Record<string, string>>();
  const granted = useMemo(
    () => new Set(me.access.permissions),
    [me.access.permissions],
  );

  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<Record<string, unknown> | null>(null);
  // What can be *done* to one of these records, if anything. Looked up by the
  // route's own screen id rather than passed in, so adding an action to a
  // generic list screen is one entry in one table.
  const screenId = useScreenId();
  const Actions = screenId === null ? undefined : recordActions[screenId];

  const listOperation = operationById.get(spec.listOperationId);
  const routeId = spec.idParam ? routeParams[spec.idParam] : undefined;

  const list = useQuery({
    queryKey: ["record-screen", spec.listOperationId, page, search, filters],
    enabled:
      listOperation !== undefined &&
      canUse(listOperation, granted) &&
      routeId === undefined,
    queryFn: async () => {
      if (listOperation === undefined) throw new Error("OPERATION_MISSING");
      const result = await executeOperation(client, listOperation, {
        path: {},
        query: {
          page,
          limit: pageSize,
          ...(spec.searchable === true && search.trim().length >= 2
            ? { search: search.trim() }
            : {}),
          ...Object.fromEntries(
            Object.entries(filters).filter(([, value]) => value !== ""),
          ),
        },
      });
      return result.data as {
        data?: unknown;
        meta?: { total?: number; hasNext?: boolean };
      };
    },
  });

  const detailOperation = spec.detailOperationId
    ? operationById.get(spec.detailOperationId)
    : undefined;
  const detail = useQuery({
    queryKey: ["record-screen-detail", spec.detailOperationId, routeId],
    enabled: detailOperation !== undefined && routeId !== undefined,
    queryFn: async () => {
      if (detailOperation === undefined || routeId === undefined)
        throw new Error("OPERATION_MISSING");
      const result = await executeOperation(client, detailOperation, {
        path: { [spec.idParam ?? "id"]: routeId },
      });
      const payload = result.data as { data?: unknown };
      return (payload.data ?? payload) as Record<string, unknown>;
    },
  });

  if (listOperation === undefined) {
    return (
      <section className="record-screen">
        <p className="table-empty">
          {ar
            ? "هذه الشاشة غير متاحة في هذه النسخة."
            : "This screen is not available in this build."}
        </p>
      </section>
    );
  }
  if (!canUse(listOperation, granted)) {
    return (
      <section className="record-screen">
        <p className="table-empty">
          {ar
            ? "ليس لديك صلاحية لعرض هذه الشاشة."
            : "You do not have permission to view this screen."}
        </p>
      </section>
    );
  }

  // Detail route: one record, read from its own endpoint.
  if (routeId !== undefined) {
    return (
      <section className="record-screen">
        <PageHeader
          kicker={ar ? spec.kicker.ar : spec.kicker.en}
          title={
            (detail.data
              ? text(pick(detail.data, spec.columns[0]?.field ?? spec.idField))
              : "") || (ar ? spec.title.ar : spec.title.en)
          }
          actions={
            <Link className="ghost-button" to={listRoute(spec)}>
              {ar ? "رجوع" : "Back"}
            </Link>
          }
        />
        <ErrorBanner
          error={detail.error}
          retry={() => {
            void detail.refetch();
          }}
        />
        {detail.data && (
          <RecordFacts
            row={detail.data}
            columns={[...spec.columns, ...(spec.detailFields ?? [])]}
            locale={locale}
          />
        )}
      </section>
    );
  }

  const rows = asRows(list.data?.data);
  const total = list.data?.meta?.total ?? rows.length;
  const visible = spec.columns;

  return (
    <section className="record-screen">
      <PageHeader
        kicker={ar ? spec.kicker.ar : spec.kicker.en}
        title={ar ? spec.title.ar : spec.title.en}
        count={total}
        {...(spec.sub ? { sub: ar ? spec.sub.ar : spec.sub.en } : {})}
      />

      {(spec.searchable === true || (spec.filters?.length ?? 0) > 0) && (
        <div className="record-filters">
          {spec.searchable === true && (
            <input
              type="search"
              value={search}
              placeholder={ar ? "بحث…" : "Search…"}
              aria-label={ar ? "بحث" : "Search"}
              onChange={(event) => {
                setPage(1);
                setSearch(event.target.value);
              }}
            />
          )}
          {(spec.filters ?? []).map((filter) => (
            <select
              key={filter.param}
              value={filters[filter.param] ?? ""}
              aria-label={ar ? filter.ar : filter.en}
              onChange={(event) => {
                setPage(1);
                setFilters((current) => ({
                  ...current,
                  [filter.param]: event.target.value,
                }));
              }}
            >
              <option value="">{ar ? filter.ar : filter.en}</option>
              {filter.options.map((option) => (
                <option key={option.value} value={option.value}>
                  {ar ? option.ar : option.en}
                </option>
              ))}
            </select>
          ))}
        </div>
      )}

      <ErrorBanner
        error={list.error}
        retry={() => {
          void list.refetch();
        }}
      />

      <div className="enterprise-table-scroll">
        <table className="enterprise-table">
          <thead>
            <tr>
              {visible.map((column) => (
                <th key={column.field} className={cellClass(column)}>
                  {ar ? column.ar : column.en}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              /* Openable by keyboard as well as by mouse. A clickable <tr>
                 with only an onClick is unreachable without a pointer, which
                 on these screens means every record on them is unreachable —
                 the row *is* the only way in. */
              <tr
                key={text(pick(row, spec.idField)) || String(index)}
                className="record-row"
                tabIndex={0}
                role="button"
                aria-label={`${ar ? "افتح" : "Open"} ${
                  text(pick(row, spec.columns[0]?.field ?? spec.idField)) ||
                  (ar ? "السجل" : "record")
                }`}
                onClick={() => {
                  setOpen(row);
                }}
                onKeyDown={(event) => {
                  if (event.key !== "Enter" && event.key !== " ") return;
                  // Space scrolls the page by default, which on a long table
                  // moves the row out from under the person who just chose it.
                  event.preventDefault();
                  setOpen(row);
                }}
              >
                {visible.map((column) => (
                  <td key={column.field} className={cellClass(column)}>
                    <Cell row={row} column={column} locale={locale} />
                  </td>
                ))}
              </tr>
            ))}
            {!list.isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={visible.length} className="table-empty">
                  {ar ? spec.empty.ar : spec.empty.en}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <footer className="pagination">
        <button
          type="button"
          disabled={page <= 1}
          onClick={() => {
            setPage(page - 1);
          }}
        >
          {ar ? "السابق" : "Previous"}
        </button>
        {/* "1 · 383" says neither what 1 is nor what 383 is. Both numbers are
            worth having, so both are named. */}
        <span data-abp-num>
          {ar
            ? `صفحة ${String(page)} من ${String(Math.max(1, Math.ceil(total / pageSize)))}`
            : `Page ${String(page)} of ${String(Math.max(1, Math.ceil(total / pageSize)))}`}
          {" · "}
          {ar
            ? `${String(total)} سجل`
            : `${String(total)} ${total === 1 ? "record" : "records"}`}
        </span>
        <button
          type="button"
          disabled={list.data?.meta?.hasNext !== true}
          onClick={() => {
            setPage(page + 1);
          }}
        >
          {ar ? "التالي" : "Next"}
        </button>
      </footer>

      {/* Opening a row shows everything on it. A table that truncates to six
          columns is readable; a table that hides the other twenty forever is
          not, and scrolling sideways through forty is nobody's idea of a CRM. */}
      {open !== null && (
        <SlideOver
          title={
            text(pick(open, spec.columns[0]?.field ?? spec.idField)) ||
            (ar ? "السجل" : "Record")
          }
          onClose={() => {
            setOpen(null);
          }}
        >
          <RecordFacts
            row={open}
            columns={[...spec.columns, ...(spec.detailFields ?? [])]}
            locale={locale}
          />
          {Actions !== undefined && (
            <Actions
              client={client}
              me={me}
              row={open}
              onDone={async () => {
                setOpen(null);
                await list.refetch();
                await detail.refetch();
              }}
            />
          )}
        </SlideOver>
      )}
    </section>
  );
}

function RecordFacts({
  row,
  columns,
  locale,
}: {
  row: Record<string, unknown>;
  columns: RecordColumn[];
  locale: string;
}) {
  const ar = locale === "ar";
  const named = new Set(columns.map((column) => column.field));
  // Anything the spec did not name is still shown, just last and un-prettified:
  // a field nobody described is better visible than silently dropped.
  const extras = Object.keys(row).filter(
    (key) =>
      !named.has(key) && !key.endsWith("Id") && typeof row[key] !== "object",
  );
  return (
    <dl className="record-facts">
      {columns.map((column) => (
        <div key={column.field}>
          <dt>{ar ? column.ar : column.en}</dt>
          <dd>
            <Cell row={row} column={column} locale={locale} />
          </dd>
        </div>
      ))}
      {extras.map((key) => (
        <div key={key}>
          <dt>{humanize(key)}</dt>
          <dd>{formatPlain(row[key], locale)}</dd>
        </div>
      ))}
    </dl>
  );
}

function Cell({
  row,
  column,
  locale,
}: {
  row: Record<string, unknown>;
  column: RecordColumn;
  locale: string;
}) {
  const value = pick(row, column.field);
  if (value === null || value === undefined || value === "") return <>—</>;

  if (column.kind === "status") {
    return <StatusChip code={text(value)} />;
  }
  if (column.kind === "code") {
    return <>{enumLabel(text(value), locale === "ar" ? "ar" : "en")}</>;
  }
  const rendered = formatValue(value, column, row, locale);
  const href = column.href?.(row) ?? null;
  return href !== null ? <Link to={href}>{rendered}</Link> : <>{rendered}</>;
}

function formatValue(
  value: unknown,
  column: RecordColumn,
  row: Record<string, unknown>,
  locale: string,
) {
  const intl = locale === "ar" ? "ar-EG" : "en";
  switch (column.kind) {
    case "money": {
      const amount = Number(value);
      if (!Number.isFinite(amount)) return text(value);
      const currency = text(
        column.currencyField
          ? pick(row, column.currencyField)
          : row.currencyCode,
      );
      return `${amount.toLocaleString(intl, { maximumFractionDigits: 0 })} ${currency}`.trim();
    }
    case "number": {
      const amount = Number(value);
      return Number.isFinite(amount)
        ? amount.toLocaleString(intl, { maximumFractionDigits: 2 })
        : text(value);
    }
    case "date":
      return formatDate(value, locale);
    // An audit trail of twelve logins on one day is unreadable without the time.
    case "datetime":
      return formatDateTime(value, locale);
    case "boolean":
      return value === true
        ? locale === "ar"
          ? "نعم"
          : "Yes"
        : locale === "ar"
          ? "لا"
          : "No";
    default:
      return text(value);
  }
}

function formatPlain(value: unknown, locale: string) {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") {
    return value
      ? locale === "ar"
        ? "نعم"
        : "Yes"
      : locale === "ar"
        ? "لا"
        : "No";
  }
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    return formatDate(value, locale);
  }
  return text(value);
}

function formatDateTime(value: unknown, locale: string) {
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatDate(value: unknown, locale: string) {
  const date = new Date(text(value));
  if (Number.isNaN(date.getTime())) return text(value);
  return new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/**
 * Values come out of `pick` as unknown. Rendering an object with String() puts
 * "[object Object]" on the screen, so objects and arrays are summarised instead.
 */
function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return value.toString();
  }
  if (Array.isArray(value)) return value.map((item) => text(item)).join(", ");
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "";
    }
  }
  return "";
}

/** "account.canonicalName" -> row.account.canonicalName */
function pick(row: Record<string, unknown>, path: string): unknown {
  let current: unknown = row;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function humanize(key: string) {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

function cellClass(column: RecordColumn) {
  const classes: string[] = [];
  if (column.kind === "money" || column.kind === "number")
    classes.push("numeric");
  if (column.secondary === true) classes.push("record-secondary");
  return classes.join(" ");
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value as Record<string, unknown>[];
  return [];
}

function canUse(operation: OperationContract, granted: Set<string>) {
  return (
    operation.permission === "authenticated" ||
    granted.has(operation.permission)
  );
}

function listRoute(spec: RecordScreenSpec) {
  // The detail route is the list route plus "/:id"; dropping the last segment
  // is enough and avoids threading a second route through every spec.
  return `/${spec.listOperationId.replace(/^get_/, "").replace(/_/g, "/")}`;
}
