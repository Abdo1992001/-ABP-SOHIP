import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "react-router";
import type { ApiClient } from "@abp/api-client";
import {
  executeOperation,
  FrontendApiError,
  operationById,
  requiredPathParameters,
  type OperationContract,
  type FormSchema,
} from "../api/operation-runtime.ts";
import { useI18n } from "../i18n/i18n.tsx";
import type { Me } from "../api/customer-api.ts";
import { screens, type ScreenDefinition } from "./screen-registry.ts";
import { DocumentDownload, ExportDelivery } from "./DocumentDownload.tsx";

export function ContractScreen({
  screen,
  client,
  me,
}: {
  screen: ScreenDefinition;
  client: ApiClient;
  me: Me;
}) {
  const { locale, t } = useI18n();
  const routeParams = useParams<Record<string, string>>();
  const permissions = useMemo(
    () => new Set(me.access.permissions),
    [me.access.permissions],
  );
  const operations = screen.operations
    .map((id) => operationById.get(id))
    .filter((value): value is OperationContract => Boolean(value));
  const readable = operations.filter(
    (operation) =>
      operation.method === "GET" &&
      can(operation.permission, permissions) &&
      hasPathParameters(operation.path, routeParams),
  );
  const executable = operations.filter(
    (operation) =>
      operation.method !== "GET" && can(operation.permission, permissions),
  );
  const initialRead =
    [...readable].sort(
      (a, b) =>
        requiredPathParameters(b.path).length -
          requiredPathParameters(a.path).length ||
        a.path.length - b.path.length,
    )[0]?.operationId ?? "";
  const [chosenRead, setSelectedRead] = useState<{
    route: string;
    id: string;
  } | null>(null);
  const routeKey = JSON.stringify(routeParams);
  const selectedRead =
    chosenRead?.route === routeKey ? chosenRead.id : initialRead;
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const selectedOperation = operationById.get(selectedRead);
  const listRead =
    selectedOperation?.method === "GET" &&
    requiredPathParameters(selectedOperation.path).length === 0;
  const query = useQuery({
    queryKey: [
      "contract-screen",
      screen.id,
      selectedRead,
      routeParams,
      search,
      page,
    ],
    enabled:
      Boolean(selectedOperation) &&
      !(selectedRead === "get_search" && search.trim().length < 2),
    queryFn: async () => {
      if (!selectedOperation) throw new Error("READ_OPERATION_REQUIRED");
      return executeOperation(client, selectedOperation, {
        path: pathValues(selectedOperation.path, routeParams),
        ...(listRead
          ? {
              query: {
                ...([
                  "get_documents",
                  "get_notifications",
                  "get_activities",
                  "get_actions_queue",
                  "get_customer_segments",
                  "get_shipments",
                ].includes(selectedRead)
                  ? { offset: (page - 1) * 25 }
                  : { page }),
                limit: 25,
                ...(search.trim() ? { search: search.trim() } : {}),
              },
            }
          : {}),
      });
    },
    retry: false,
  });

  return (
    <section className="workspace-page" data-screen-id={screen.id}>
      <header className="page-heading compact-heading">
        <div>
          <span className="eyebrow" data-abp-caption>
            {moduleLabel(screen.module, locale)}
          </span>
          <h1>{screen.title[locale]}</h1>
          <p>{screenSubtitle(screen, t, locale)}</p>
        </div>
        <button
          className="secondary"
          type="button"
          onClick={() => void query.refetch()}
        >
          {t("refresh")}
        </button>
      </header>

      {readable.length > 1 && (
        <div
          className="segmented tab-bar"
          role="tablist"
          aria-label={locale === "ar" ? "عرض البيانات" : "Data view"}
        >
          {readable.map((operation) => (
            <button
              type="button"
              key={operation.operationId}
              role="tab"
              aria-selected={operation.operationId === selectedRead}
              className={
                operation.operationId === selectedRead ? "selected" : ""
              }
              onClick={() => {
                setSelectedRead({ route: routeKey, id: operation.operationId });
                setPage(1);
              }}
            >
              {readViewLabel(operation, locale)}
            </button>
          ))}
        </div>
      )}

      {listRead && (
        <div className="contract-list-toolbar">
          <label>
            <span className="sr-only">
              {locale === "ar" ? "بحث في" : "Search"} {screen.title[locale]}
            </span>
            <input
              type="search"
              value={search}
              placeholder={
                locale === "ar"
                  ? `بحث في ${screen.title[locale]}`
                  : `Search ${screen.title[locale].toLowerCase()}`
              }
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <span className="scope-note">
            {locale === "ar"
              ? "نطاق الدول يُطبّق أولاً · المنع له الأولوية"
              : "Country Scope first · DENY wins"}
          </span>
        </div>
      )}

      <section className="panel data-surface" aria-live="polite">
        {query.isLoading && <LoadingState />}
        {query.error && (
          <ErrorState error={query.error} retry={() => void query.refetch()} />
        )}
        {query.data && <DataView value={query.data.data} screen={screen} />}
        {!query.isLoading && !query.error && !query.data && (
          <div className="empty-state">
            <h2>{t("empty")}</h2>
          </div>
        )}
      </section>

      {listRead && query.data && (
        <ContractPagination
          value={query.data.data}
          page={page}
          onPage={setPage}
        />
      )}

      {executable.length > 0 && (
        <section className="panel action-surface">
          <div className="section-heading">
            <h2>{t("actions")}</h2>
          </div>
          <div className="action-grid">
            {executable.map((operation) => (
              <OperationAction
                key={operation.operationId}
                client={client}
                operation={operation}
                routeParams={routeParams}
                availableRecords={listRecords(query.data?.data)}
                onComplete={() => void query.refetch()}
              />
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

export function OperationAction({
  client,
  operation,
  routeParams,
  onComplete,
  currentVersion,
  onResult,
  availableRecords = [],
}: {
  currentVersion?: string | undefined;
  onResult?: (value: unknown) => void;
  client: ApiClient;
  operation: OperationContract;
  routeParams: Readonly<Record<string, string | undefined>>;
  availableRecords?: readonly Record<string, unknown>[];
  onComplete: () => void;
}) {
  const { locale, t } = useI18n();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState<unknown>(() =>
    initialValue(operation.requestSchema),
  );
  const [ifMatch, setIfMatch] = useState("");
  const [path, setPath] = useState<Record<string, string>>(() =>
    pathValues(operation.path, routeParams),
  );
  const [idempotencyKey, setIdempotencyKey] = useState(() =>
    crypto.randomUUID(),
  );
  const dialogRef = useRef<HTMLFormElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);
  const mutation = useMutation({
    mutationFn: async () => {
      return executeOperation(client, operation, {
        path,
        body: cleanValue(
          isRecord(body) &&
            currentVersion &&
            operation.requestSchema?.properties?.expectedRowVersion
            ? { ...body, expectedRowVersion: currentVersion }
            : body,
          operation.requestSchema,
        ),
        ...(ifMatch || currentVersion
          ? { ifMatch: ifMatch || currentVersion || "" }
          : {}),
        idempotencyKey,
      });
    },
    onSuccess: async (result) => {
      onResult?.(result.data);
      onComplete();
      await queryClient.invalidateQueries();
      setIdempotencyKey(crypto.randomUUID());
    },
  });
  const pathParameters = requiredPathParameters(operation.path).filter(
    (name) => !routeParams[name],
  );
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !mutation.isPending) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    const focusTimer = window.setTimeout(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>("input, select, textarea, button")
        ?.focus();
    });
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.clearTimeout(focusTimer);
    };
  }, [mutation.isPending, open]);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      const focusTimer = window.setTimeout(() => {
        triggerRef.current?.focus({ preventScroll: true });
      });
      wasOpenRef.current = open;
      return () => {
        window.clearTimeout(focusTimer);
      };
    }
    wasOpenRef.current = open;
  }, [open]);
  return (
    <article className="action-card" data-operation-id={operation.operationId}>
      <div>
        <strong>{actionLabel(operation, locale)}</strong>
        <small>{actionDescription(operation, locale)}</small>
      </div>
      <button
        ref={triggerRef}
        type="button"
        className="secondary"
        onClick={() => {
          mutation.reset();
          setOpen(true);
        }}
      >
        {actionButtonLabel(operation, locale)}
      </button>
      {open && (
        <div
          className="dialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mutation.isPending)
              setOpen(false);
          }}
        >
          <form
            ref={dialogRef}
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={`${operation.operationId}-title`}
            onInvalidCapture={(event) => {
              const form = event.currentTarget;
              const firstInvalid = form.querySelector(":invalid");
              if (firstInvalid === event.target) {
                requestAnimationFrame(() => {
                  (firstInvalid as HTMLElement).scrollIntoView({
                    block: "center",
                  });
                  (firstInvalid as HTMLElement).focus({ preventScroll: true });
                });
              }
            }}
            onSubmit={(event) => {
              event.preventDefault();
              mutation.mutate();
            }}
          >
            <header>
              <div>
                <span className="eyebrow" data-abp-caption>
                  {locale === "ar" ? "نظام ABP التجاري" : "ABP Commercial"}
                </span>
                <h2 id={`${operation.operationId}-title`}>
                  {actionLabel(operation, locale)}
                </h2>
              </div>
              <button
                type="button"
                className="icon-button"
                aria-label={t("close")}
                onClick={() => {
                  setOpen(false);
                }}
              >
                ×
              </button>
            </header>
            {pathParameters.length > 0 && (
              <fieldset>
                <legend>{t("pathParameters")}</legend>
                {pathParameters.map((name) => {
                  const options = resourceOptions(name, availableRecords);
                  return (
                    <label key={name}>
                      {labelFor(name, locale)}
                      {options.length > 0 ? (
                        <select
                          value={path[name] ?? ""}
                          required
                          onChange={(event) => {
                            setPath((current) => ({
                              ...current,
                              [name]: event.target.value,
                            }));
                          }}
                        >
                          <option value="">
                            {locale === "ar"
                              ? "اختر من القائمة"
                              : "Select from list"}
                          </option>
                          {options.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={path[name] ?? ""}
                          required
                          onChange={(event) => {
                            setPath((current) => ({
                              ...current,
                              [name]: event.target.value,
                            }));
                          }}
                        />
                      )}
                    </label>
                  );
                })}
              </fieldset>
            )}
            {operation.requestSchema && (
              <fieldset className="contract-form">
                <legend>{t("requestBody")}</legend>
                <SchemaField
                  schema={
                    currentVersion &&
                    operation.requestSchema.properties?.expectedRowVersion
                      ? {
                          ...operation.requestSchema,
                          properties: Object.fromEntries(
                            Object.entries(
                              operation.requestSchema.properties,
                            ).filter(([key]) => key !== "expectedRowVersion"),
                          ),
                          required:
                            operation.requestSchema.required?.filter(
                              (key) => key !== "expectedRowVersion",
                            ) ?? [],
                        }
                      : operation.requestSchema
                  }
                  value={body}
                  onChange={setBody}
                  path="request"
                  availableRecords={availableRecords}
                />
              </fieldset>
            )}
            {operation.concurrency.includes("If-Match") && !currentVersion && (
              <label>
                {t("ifMatch")}
                <input
                  value={ifMatch}
                  onChange={(event) => {
                    setIfMatch(event.target.value);
                  }}
                  required
                />
              </label>
            )}
            {mutation.error && (
              <ErrorState
                error={mutation.error}
                retry={() => {
                  mutation.mutate();
                }}
              />
            )}
            {mutation.data && (
              <div className="status success">
                <strong>
                  {operation.job || mutation.data.status === 202
                    ? t("queued")
                    : actionSuccessLabel(operation, locale)}
                </strong>
                <DataView value={mutation.data.data} compact />
                <JobStatusPanel client={client} value={mutation.data.data} />
              </div>
            )}
            <footer>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  setOpen(false);
                }}
              >
                {t("cancel")}
              </button>
              <button
                type="submit"
                className="primary"
                disabled={mutation.isPending}
              >
                {mutation.isPending
                  ? t("loading")
                  : actionButtonLabel(operation, locale)}
              </button>
            </footer>
          </form>
        </div>
      )}
    </article>
  );
}

function SchemaField({
  schema,
  value,
  onChange,
  path,
  required = false,
  availableRecords = [],
}: {
  schema: FormSchema;
  value: unknown;
  onChange: (value: unknown) => void;
  path: string;
  required?: boolean;
  availableRecords?: readonly Record<string, unknown>[];
}) {
  const { locale } = useI18n();
  if (schema.type === "object") {
    const record = asRecord(value);
    return (
      <div className="schema-object">
        {Object.entries(schema.properties ?? {}).map(([name, child]) =>
          child ? (
            <SchemaField
              key={name}
              schema={child}
              value={record[name]}
              path={`${path}.${name}`}
              availableRecords={availableRecords}
              required={schema.required?.includes(name) ?? false}
              onChange={(next) => {
                onChange({ ...record, [name]: next });
              }}
            />
          ) : null,
        )}
      </div>
    );
  }
  if (schema.type === "array") {
    const values: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
    const itemSchema = schema.items ?? { type: "string" };
    return (
      <fieldset className="schema-array">
        <legend>
          {labelFor(path.split(".").at(-1) ?? path, locale)}{" "}
          {required ? "*" : ""}
        </legend>
        {values.map((item, index) => (
          <div className="array-item" key={`${path}-${index.toString()}`}>
            <SchemaField
              schema={itemSchema}
              value={item}
              path={`${path}.${index.toString()}`}
              availableRecords={availableRecords}
              required
              onChange={(next) => {
                onChange(
                  values.map((current, at) => (at === index ? next : current)),
                );
              }}
            />
            <button
              type="button"
              className="secondary danger-text"
              onClick={() => {
                onChange(values.filter((_, at) => at !== index));
              }}
            >
              {locale === "ar" ? "إزالة" : "Remove"}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            onChange([...values, initialValue(itemSchema)]);
          }}
        >
          {locale === "ar" ? "إضافة" : "Add"}{" "}
          {labelFor(path.split(".").at(-1) ?? "item", locale)}
        </button>
      </fieldset>
    );
  }
  const name = path.split(".").at(-1) ?? path;
  const lookupOptions = [
    "accountId",
    "targetAccountId",
    "requestId",
    "watchlistEntryId",
  ].includes(name)
    ? resourceOptions(name, availableRecords)
    : [];
  if (lookupOptions.length > 0) {
    return (
      <label>
        {labelFor(name, locale)} {required ? "*" : ""}
        <select
          required={required}
          value={primitiveText(value)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          <option value="">
            {locale === "ar" ? "اختر من القائمة" : "Select from list"}
          </option>
          {lookupOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  if (schema.type === "boolean") {
    return (
      <label className="checkbox-field">
        <input
          type="checkbox"
          checked={value === true}
          onChange={(event) => {
            onChange(event.target.checked);
          }}
        />
        {labelFor(name, locale)} {required ? "*" : ""}
      </label>
    );
  }
  if (schema.enum && schema.enum.length > 0) {
    return (
      <label>
        {labelFor(name, locale)} {required ? "*" : ""}
        <select
          required={required}
          value={primitiveText(value)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        >
          {!required && <option value="">—</option>}
          {schema.enum.map((option) => (
            <option key={String(option)} value={String(option)}>
              {localizedCode(String(option), locale)}
            </option>
          ))}
        </select>
        {schema.description && <small>{schema.description}</small>}
      </label>
    );
  }
  const multilineFields = new Set([
    "content",
    "description",
    "summary",
    "evidence",
    "rationale",
    "strengths",
    "weaknesses",
    "notes",
    "salesresponse",
  ]);
  const multiline = multilineFields.has(name.toLowerCase());
  return (
    <label>
      {labelFor(name, locale)} {required ? "*" : ""}
      {multiline ? (
        <textarea
          rows={8}
          required={required}
          maxLength={schema.maxLength}
          value={primitiveText(value)}
          onChange={(event) => {
            onChange(event.target.value);
          }}
        />
      ) : (
        <input
          type={inputType(schema)}
          required={required}
          min={schema.minimum}
          max={schema.maximum}
          minLength={schema.minLength}
          maxLength={schema.maxLength}
          pattern={schema.pattern}
          value={primitiveText(value)}
          onChange={(event) => {
            onChange(
              schema.type === "integer" || schema.type === "number"
                ? event.target.value === ""
                  ? ""
                  : Number(event.target.value)
                : event.target.value,
            );
          }}
        />
      )}
      {schema.description && <small>{schema.description}</small>}
    </label>
  );
}

function JobStatusPanel({
  client,
  value,
}: {
  client: ApiClient;
  value: unknown;
}) {
  const { locale } = useI18n();
  const jobId = findJobId(value);
  const operation = operationById.get("get_jobs_by_jobId");
  const query = useQuery({
    queryKey: ["job-status", jobId],
    enabled: Boolean(jobId && operation),
    queryFn: async () => {
      if (!jobId || !operation) throw new Error("JOB_STATUS_CONTRACT_MISSING");
      return executeOperation(client, operation, { path: { jobId } });
    },
    refetchInterval: (state) => {
      const status = findText(state.state.data?.data, "statusCode");
      return status === "COMPLETED" || status === "FAILED" ? false : 1500;
    },
    retry: false,
  });
  if (!jobId) return null;
  return (
    <div className="job-status" aria-live="polite">
      <strong>{locale === "ar" ? "مهمة سير العمل" : "Workflow job"}</strong>
      {query.isLoading && <LoadingState />}
      {query.error && (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      )}
      {query.data && <DataView value={query.data.data} compact />}
      {query.data && <JobDownload client={client} value={query.data.data} />}
    </div>
  );
}

function JobDownload({ client, value }: { client: ApiClient; value: unknown }) {
  const reference = findText(value, "resultReference") ?? "";
  const [kind, id] = reference.split(":");
  if (!id) return null;
  if (kind === "document" || kind === "quotation-document")
    return <DocumentDownload client={client} documentId={id} />;
  if (kind === "export" || kind === "analytics-export")
    return (
      <ExportDelivery
        client={client}
        exportId={id}
        analytics={kind === "analytics-export"}
      />
    );
  return null;
}

function initialValue(schema: FormSchema | null | undefined): unknown {
  if (!schema) return {};
  if (schema.default !== undefined) return schema.default;
  if (schema.type === "object")
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).map(([name, child]) => [
        name,
        initialValue(child),
      ]),
    );
  if (schema.type === "array") return [];
  if (schema.type === "boolean") return false;
  return schema.enum?.[0] ?? "";
}

function cleanValue(
  value: unknown,
  schema: FormSchema | null | undefined,
): unknown {
  if (!schema) return value;
  if (schema.type === "object") {
    const source = asRecord(value);
    return Object.fromEntries(
      Object.entries(schema.properties ?? {}).flatMap(([name, child]) => {
        if (!child) return [];
        const cleaned = cleanValue(source[name], child);
        const required = schema.required?.includes(name) ?? false;
        return !required && isEmpty(cleaned) ? [] : [[name, cleaned]];
      }),
    );
  }
  if (schema.type === "array")
    return (Array.isArray(value) ? (value as unknown[]) : []).map((item) =>
      cleanValue(item, schema.items),
    );
  return value;
}

function inputType(schema: FormSchema) {
  if (schema.format === "date") return "date";
  if (schema.format === "date-time") return "datetime-local";
  if (schema.format === "email") return "email";
  if (schema.format === "uri" || schema.format === "url") return "url";
  if (schema.type === "integer" || schema.type === "number") return "number";
  return "text";
}
function primitiveText(value: unknown) {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : "";
}
function primitiveDisplay(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : typeof value === "boolean"
      ? value
        ? "true"
        : "false"
      : typeof value === "bigint"
        ? value.toString()
        : "";
}
function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function isEmpty(value: unknown) {
  return (
    value === "" ||
    value === null ||
    value === undefined ||
    (Array.isArray(value) && value.length === 0)
  );
}
function findJobId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobId(item);
      if (found) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (typeof record.jobId === "string") return record.jobId;
  if (typeof record.statusUrl === "string")
    return /\/jobs\/([0-9a-f-]{36})/i.exec(record.statusUrl)?.[1] ?? null;
  for (const item of Object.values(record)) {
    const found = findJobId(item);
    if (found) return found;
  }
  return null;
}
function findText(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record[key] === "string") return record[key];
  for (const item of Object.values(record)) {
    const found = findText(item, key);
    if (found) return found;
  }
  return null;
}

export function DataView({
  value,
  compact = false,
  screen,
}: {
  value: unknown;
  compact?: boolean;
  screen?: ScreenDefinition;
}) {
  const { t } = useI18n();
  const data = envelopeData(value);
  if (Array.isArray(data)) {
    const items: unknown[] = data as unknown[];
    if (items.length === 0)
      return (
        <div className="empty-state">
          <h2>{t("empty")}</h2>
        </div>
      );
    if (!compact && screen && items.every(isRecord)) {
      return <ContractRecordTable items={items} screen={screen} />;
    }
    return (
      <div className={compact ? "record-stack compact" : "record-stack"}>
        {items.map((item, index) => (
          <RecordCard key={recordKey(item, index)} value={item} />
        ))}
      </div>
    );
  }
  if (data && typeof data === "object") return <RecordCard value={data} />;
  return <p>{display(data ?? t("empty"))}</p>;
}

function ContractRecordTable({
  items,
  screen,
}: {
  items: unknown[];
  screen: ScreenDefinition;
}) {
  const { locale } = useI18n();
  const records = items.filter(isRecord);
  const columns = tableColumns(records);
  return (
    <div className="enterprise-table-scroll">
      <table className="enterprise-table contract-record-table">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{labelFor(column, locale)}</th>
            ))}
            <th>
              <span className="sr-only">
                {locale === "ar" ? "فتح" : "Open"}
              </span>
            </th>
          </tr>
        </thead>
        <tbody>
          {records.map((record, index) => {
            const href = recordDetailRoute(screen, record);
            return (
              <tr key={recordKey(record, index)}>
                {columns.map((column, at) => (
                  <td key={column} data-column={column}>
                    {at === 0 ? (
                      <strong>
                        <ContractCell
                          value={record[column]}
                          column={column}
                          locale={locale}
                        />
                      </strong>
                    ) : (
                      <ContractCell
                        value={record[column]}
                        column={column}
                        locale={locale}
                      />
                    )}
                  </td>
                ))}
                <td>
                  {href ? (
                    <Link
                      className="row-open"
                      to={href}
                      aria-label={
                        locale === "ar" ? "فتح التفاصيل" : "Open details"
                      }
                    >
                      →
                    </Link>
                  ) : (
                    <span aria-hidden="true">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ContractCell({
  value,
  column,
  locale,
}: {
  value: unknown;
  column: string;
  locale: "en" | "ar";
}) {
  if (value === null || value === undefined || value === "") return <>—</>;
  const textValue = primitiveDisplay(value);
  if (column === "countryCode") {
    return <span className="country-code-cell">{textValue}</span>;
  }
  if (
    column.endsWith("Code") &&
    !column.toLowerCase().includes("country") &&
    !column.toLowerCase().includes("currency") &&
    !column.toLowerCase().includes("tax") &&
    !column.toLowerCase().includes("unit") &&
    /^[A-Z][A-Z0-9_]{2,}$/.test(textValue)
  ) {
    return (
      <span className={`status-chip status-${textValue.toLowerCase()}`}>
        {localizedCode(textValue, locale)}
      </span>
    );
  }
  if (column.toLowerCase().includes("date") || column.endsWith("At")) {
    const date = new Date(textValue);
    if (!Number.isNaN(date.getTime())) {
      const includeTime = column.endsWith("At");
      return (
        <time dateTime={date.toISOString()}>
          {new Intl.DateTimeFormat(locale === "ar" ? "ar-EG" : "en-GB", {
            dateStyle: "medium",
            ...(includeTime ? { timeStyle: "short" as const } : {}),
          }).format(date)}
        </time>
      );
    }
  }
  if (
    typeof value === "string" &&
    (column === "sourceUrl" || column === "website") &&
    /^https?:\/\//i.test(value)
  ) {
    return (
      <a
        className="source-link"
        href={value}
        target="_blank"
        rel="noreferrer"
        title={value}
      >
        {locale === "ar" ? "عرض المصدر" : "View source"}
      </a>
    );
  }
  if (
    column.endsWith("Code") ||
    column === "resourceType" ||
    column === "action"
  )
    return <>{localizedCode(textValue, locale)}</>;
  return <>{display(value)}</>;
}

function ContractPagination({
  value,
  page,
  onPage,
}: {
  value: unknown;
  page: number;
  onPage: (page: number) => void;
}) {
  const { locale } = useI18n();
  const meta = envelopeMeta(value);
  if (!meta) return null;
  return (
    <footer className="grid-pagination contract-pagination">
      <span>
        {locale === "ar"
          ? `صفحة ${String(meta.page)} · ${String(meta.total)} سجل`
          : `Page ${String(meta.page)} · ${String(meta.total)} records`}
      </span>
      <div>
        <button
          type="button"
          className="secondary"
          disabled={page <= 1}
          onClick={() => {
            onPage(Math.max(1, page - 1));
          }}
        >
          {locale === "ar" ? "السابق" : "Previous"}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={!meta.hasNext}
          onClick={() => {
            onPage(page + 1);
          }}
        >
          {locale === "ar" ? "التالي" : "Next"}
        </button>
      </div>
    </footer>
  );
}

function RecordCard({ value }: { value: unknown }) {
  const { locale } = useI18n();
  if (!value || typeof value !== "object" || Array.isArray(value))
    return <p>{String(value)}</p>;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, item]) => item !== undefined,
  );
  return (
    <article className="record-card">
      {entries.map(([key, item]) => (
        <div key={key}>
          <dt>{labelFor(key, locale)}</dt>
          <dd>
            <RecordValue value={item} name={key} locale={locale} />
          </dd>
        </div>
      ))}
    </article>
  );
}

function RecordValue({
  value,
  name,
  locale,
}: {
  value: unknown;
  name: string;
  locale: "en" | "ar";
}) {
  if (Array.isArray(value)) {
    return value.length > 0 ? (
      <ul className="record-value-list">
        {(value as unknown[]).map((item, index) => (
          <li key={`${name}-${index.toString()}`}>
            <RecordValue value={item} name={name} locale={locale} />
          </li>
        ))}
      </ul>
    ) : (
      <>—</>
    );
  }
  if (isRecord(value)) return <RecordCard value={value} />;
  if (typeof value === "boolean")
    return (
      <>
        {value
          ? locale === "ar"
            ? "نعم"
            : "Yes"
          : locale === "ar"
            ? "لا"
            : "No"}
      </>
    );
  if (name === "action" || name === "resourceType")
    return <>{localizedCode(String(value), locale)}</>;
  return <ContractCell value={value} column={name} locale={locale} />;
}

function LoadingState() {
  const { t } = useI18n();
  return (
    <div className="skeleton-stack" aria-label={t("loading")}>
      <span />
      <span />
      <span />
    </div>
  );
}

function ErrorState({ error, retry }: { error: unknown; retry?: () => void }) {
  const { t } = useI18n();
  const apiError = error instanceof FrontendApiError ? error : null;
  const conflict = apiError?.status === 409 || apiError?.status === 412;
  const notFound = apiError?.status === 404;
  const correlation = apiError?.envelope?.error.correlationId;
  return (
    <div className={notFound ? "status empty" : "status error"} role="alert">
      <strong>
        {conflict
          ? t("conflict")
          : notFound
            ? t("notFound")
            : error instanceof Error && error.message === "INVALID_JSON"
              ? t("invalidJson")
              : t("unavailable")}
      </strong>
      {correlation && (
        <small>
          {t("correlation")}: {correlation}
        </small>
      )}
      {retry && (
        <button type="button" className="secondary" onClick={retry}>
          {t("retry")}
        </button>
      )}
    </div>
  );
}

function pathValues(
  path: string,
  routeParams: Readonly<Record<string, string | undefined>>,
) {
  return Object.fromEntries(
    requiredPathParameters(path).map((name) => [
      name,
      routeParams[name] ??
        (name === "year" ? new Date().getFullYear().toString() : ""),
    ]),
  );
}
function hasPathParameters(
  path: string,
  params: Readonly<Record<string, string | undefined>>,
) {
  return requiredPathParameters(path).every(
    (name) => Boolean(params[name]) || name === "year",
  );
}
function can(requirement: string, permissions: ReadonlySet<string>) {
  if (requirement === "authenticated" || requirement.includes("internal"))
    return true;
  const alternatives = requirement.split(/\s+or\s+/i);
  return alternatives.some((alternative) =>
    alternative
      .split("+")
      .map((item) => item.trim())
      .every(
        (permission) =>
          permissions.has(permission) ||
          (permission.startsWith("import.") &&
            permissions.has("imports.manage")),
      ),
  );
}
function envelopeData(value: unknown): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  return "data" in record ? record.data : value;
}

function listRecords(value: unknown): readonly Record<string, unknown>[] {
  const data = envelopeData(value);
  return Array.isArray(data) ? data.filter(isRecord) : [];
}

function resourceOptions(
  parameter: string,
  records: readonly Record<string, unknown>[],
): readonly { value: string; label: string }[] {
  const aliases: Readonly<Record<string, readonly string[]>> = {
    targetAccountId: ["targetAccountId", "id"],
    requestId: ["requestId", "id"],
    watchlistEntryId: ["watchlistEntryId", "id"],
  };
  const idKeys = aliases[parameter] ?? [parameter, "id"];
  return records.flatMap((record) => {
    const value = idKeys
      .map((key) => record[key])
      .find((candidate): candidate is string => typeof candidate === "string");
    if (!value) return [];
    const nestedAccount = isRecord(record.account)
      ? [record.account.canonicalName, record.account.displayName].find(
          (candidate): candidate is string => typeof candidate === "string",
        )
      : undefined;
    const label = [
      ...(parameter === "accountId" && nestedAccount ? [nestedAccount] : []),
      record.companyName,
      record.title,
      record.name,
      record.subject,
      record.reference,
    ].find((candidate): candidate is string => typeof candidate === "string");
    return [
      {
        value,
        label: label ?? `#${value.slice(0, 8).toUpperCase()}`,
      },
    ];
  });
}

function envelopeMeta(
  value: unknown,
): { page: number; total: number; hasNext: boolean } | null {
  if (!isRecord(value) || !isRecord(value.meta)) return null;
  const page = Number(value.meta.page ?? 1);
  const total = Number(value.meta.total ?? 0);
  return {
    page: Number.isFinite(page) ? page : 1,
    total: Number.isFinite(total) ? total : 0,
    hasNext: value.meta.hasNext === true,
  };
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
function tableColumns(records: readonly Record<string, unknown>[]): string[] {
  const preferred = [
    "quoteRef",
    "salesOrderRef",
    "documentNumber",
    "reference",
    "title",
    "name",
    "displayName",
    "companyName",
    "subject",
    "label",
    "statusCode",
    "countryCode",
    "resourceType",
    "segmentCode",
    "priorityScore",
    "classificationCode",
    "verificationCode",
    "website",
    "rationale",
    "strengths",
    "weaknesses",
    "notes",
    "salesResponse",
    "currencyCode",
    "grandTotalAmount",
    "amount",
    "effectiveAt",
    "publishedDate",
    "eventDate",
    "createdAt",
  ];
  const keys = [...new Set(records.flatMap((record) => Object.keys(record)))];
  const scalar = keys.filter((key) => {
    if (key === "rowVersion" || key.toLowerCase().includes("hash"))
      return false;
    if (key.toLowerCase().startsWith("normalized")) return false;
    if (key === "updatedAt" && keys.includes("createdAt")) return false;
    if (key.toLowerCase().endsWith("id") && !preferred.includes(key))
      return false;
    return records.some((record) => {
      const value = record[key];
      return (
        value === null || ["string", "number", "boolean"].includes(typeof value)
      );
    });
  });
  const ordered = [
    ...preferred.filter((key) => scalar.includes(key)),
    ...scalar.filter((key) => !preferred.includes(key)),
  ];
  return (ordered.length > 0 ? ordered : keys).slice(0, 7);
}
function recordDetailRoute(
  screen: ScreenDefinition,
  record: Record<string, unknown>,
): string | null {
  const detailRoute = screens
    .flatMap((candidate) => [candidate.route, ...(candidate.aliases ?? [])])
    .find((route) => route.startsWith(`${screen.route}/:`));
  if (!detailRoute) return null;
  const match = /:([^/]+)/.exec(detailRoute);
  const parameter = match?.[1];
  const aliases: Record<string, string> = {
    planId: "logisticsPlanId",
    requestId: "approvalRequestId",
  };
  const value = parameter
    ? (record[parameter] ?? record[aliases[parameter] ?? ""])
    : undefined;
  if (!parameter || typeof value !== "string") return null;
  return detailRoute.replace(`:${parameter}`, encodeURIComponent(value));
}
function screenSubtitle(
  screen: ScreenDefinition,
  translate: (key: "noFakeKpi" | "countryScope") => string,
  locale: "en" | "ar",
): string {
  if (screen.step10Data) return translate("noFakeKpi");
  if (screen.id.startsWith("QUOTATION"))
    return locale === "ar"
      ? "تُعدّل المسودات مباشرة. بعد الإرسال، ينشئ أي تغيير عرض سعر جديداً مرتبطاً بالإصدار السابق."
      : "Drafts edit in place. A sent or historical quotation can start a new linked draft.";
  if (screen.id.startsWith("ERP_ORDER"))
    return locale === "ar"
      ? "حقائق ERP المستوردة للقراءة فقط، ولا توجد دورة طلبات داخلية في الإصدار الأول."
      : "Imported ERP facts are read-only. No internal order lifecycle exists in V1.";
  if (screen.id.startsWith("CAPACITY"))
    return locale === "ar"
      ? "تقدير فقط · قياسي 900/يوم · عادي 700/يوم · منحني 600/يوم · 24 ساعة/يوم."
      : "Estimate only · Standard 900/day · Ordinary 700/day · Curved 600/day · 24 hours/day.";
  if (screen.id.startsWith("LOGISTICS"))
    return locale === "ar"
      ? "للتخطيط والتحسين فقط · تحميل Flat-on-Face · لا يمثل شحناً أو إرسالاً أو إثبات تسليم."
      : "Planning and optimization only · Flat-on-Face · no Shipment, Dispatch or POD.";
  if (screen.id.startsWith("FINANCE"))
    return locale === "ar"
      ? "عرض مساحة المالية. تُحجب الحقول المقيّدة ما لم يوجد تصريح صريح."
      : "Finance workspace projection. Restricted fields are omitted unless explicitly authorized.";
  if (screen.id.includes("DQ") || screen.id.includes("RECONCILIATION"))
    return locale === "ar"
      ? "يبقى المصدر الخام ومسار البيانات وقرارات المراجعة قابلاً للتدقيق، بلا تصحيح صامت."
      : "Raw source, lineage and review decisions remain auditable. No silent correction.";
  if (screen.id.includes("DOCUMENT") || screen.id.includes("TEMPLATE"))
    return locale === "ar"
      ? "بيانات المستند المصرح بها وسجل الإصدارات الرسمية غير القابل للتغيير."
      : "Authorized document metadata and immutable official version history.";
  return translate("countryScope");
}
function actionLabel(
  operation: OperationContract,
  locale: "en" | "ar",
): string {
  const exact: Readonly<Record<string, string>> = {
    post_quotations: "New quotation draft",
    post_quotations_by_quotationId_prepare: "Prepare quotation document",
    post_quotations_by_quotationId_commercial_state_transitions:
      "Start negotiation",
    post_capacity_estimates: "New capacity estimate",
    post_logistics_plans: "New logistics plan",
    post_logistics_plan_versions_by_versionId_optimize: "Optimize placement",
    post_logistics_plan_versions_by_versionId_validate: "Validate placement",
    post_finance_fx_rates: "Add effective FX rate",
    post_finance_payments: "Add payment",
    post_finance_cheques: "Record cheque",
    post_company_targets: "Create company target version",
    post_documents_uploads: "Upload document",
    post_exports: "Create export job",
    post_import_jobs: "Create import job",
    post_market_signals: "Add market signal",
    post_target_markets: "Add target market",
    post_target_accounts: "Add target account",
    post_competitors: "Add competitor",
    post_watchlist: "Add to watchlist",
    post_repeat_business_requests: "Create repeat business request",
    patch_repeat_business_requests_by_requestId:
      "Update repeat business request",
    post_target_accounts_by_targetAccountId_prepare_customer:
      "Prepare customer draft",
    post_target_accounts_by_targetAccountId_prepare_opportunity:
      "Prepare opportunity draft",
    delete_watchlist_by_watchlistEntryId: "Remove from watchlist",
  };
  const mapped = exact[operation.operationId];
  if (mapped) return locale === "ar" ? translateAction(mapped) : mapped;
  if (operation.operationId.endsWith("_archive"))
    return locale === "ar" ? "أرشفة" : "Archive";
  if (operation.operationId.endsWith("_approval_requests"))
    return locale === "ar" ? "طلب موافقة" : "Request approval";
  if (operation.operationId.endsWith("_decisions"))
    return locale === "ar" ? "تسجيل قرار الموافقة" : "Record approval decision";
  if (operation.operationId.endsWith("_status_transitions"))
    return locale === "ar" ? "تغيير الحالة" : "Change status";
  if (operation.operationId.endsWith("_send"))
    return locale === "ar" ? "إرسال عرض السعر" : "Send quotation";
  if (operation.operationId.endsWith("_supersede"))
    return locale === "ar"
      ? "إنشاء عرض سعر بديل"
      : "Create superseding quotation";
  if (operation.operationId.endsWith("_exports"))
    return locale === "ar" ? "تصدير التقرير" : "Export report";
  if (operation.operationId.endsWith("_resolve"))
    return locale === "ar"
      ? "حلّ مع دليل المراجعة"
      : "Resolve with review evidence";
  return actionButtonLabel(operation, locale);
}

function readViewLabel(
  operation: OperationContract,
  locale: "en" | "ar",
): string {
  const parts = operation.path.split("/").filter(Boolean);
  const last = parts.at(-1) ?? "";
  const labels: Readonly<Record<string, readonly [string, string]>> = {
    "commercial-history": ["Commercial history", "السجل التجاري"],
    contacts: ["Contacts", "جهات الاتصال"],
    "segment-assignments": ["Segments", "القطاعات"],
    shares: ["Sharing", "المشاركة"],
    versions: ["Versions", "الإصدارات"],
    content: ["Content", "المحتوى"],
    download: ["Download", "التنزيل"],
    drilldown: ["Details", "التفاصيل"],
    issues: ["Issues", "المشكلات"],
    rows: ["Imported rows", "الصفوف المستوردة"],
    visualization: ["Visualization", "العرض المرئي"],
    documents: ["Documents", "المستندات"],
    "supersession-chain": ["Quotation history", "تاريخ العرض"],
    messages: ["Messages", "الرسائل"],
    lines: ["Line items", "البنود"],
    attachments: ["Attachments", "المرفقات"],
    performance: ["Performance", "الأداء"],
  };
  const mapped = labels[last];
  if (mapped) return locale === "ar" ? mapped[1] : mapped[0];
  if (last.startsWith("{")) return locale === "ar" ? "نظرة عامة" : "Overview";
  return locale === "ar" ? "كل السجلات" : "All records";
}
function actionButtonLabel(
  operation: OperationContract,
  locale: "en" | "ar",
): string {
  if (operation.operationId.includes("prepare_customer"))
    return locale === "ar" ? "تجهيز مسودة عميل" : "Prepare customer draft";
  if (operation.operationId.includes("prepare_opportunity"))
    return locale === "ar" ? "تجهيز مسودة فرصة" : "Prepare opportunity draft";
  if (operation.operationId.endsWith("_prepare"))
    return locale === "ar" ? "تجهيز المستند" : "Prepare document";
  if (operation.operationId.endsWith("_commercial_state_transitions"))
    return locale === "ar" ? "بدء التفاوض" : "Start negotiation";
  if (operation.operationId.includes("archive"))
    return locale === "ar" ? "أرشفة" : "Archive";
  if (operation.operationId.includes("approval_requests"))
    return locale === "ar" ? "طلب موافقة" : "Request approval";
  if (operation.operationId.includes("decisions"))
    return locale === "ar" ? "إرسال القرار" : "Submit decision";
  if (operation.operationId.includes("send"))
    return locale === "ar" ? "إرسال" : "Send";
  if (operation.operationId.includes("supersede"))
    return locale === "ar" ? "إنشاء مسودة جديدة" : "Create new draft";
  if (operation.operationId.endsWith("_optimize"))
    return locale === "ar" ? "تحسين" : "Optimize";
  if (operation.operationId.endsWith("_validate"))
    return locale === "ar" ? "تحقق" : "Validate";
  if (operation.method === "POST") return locale === "ar" ? "إنشاء" : "Create";
  if (operation.method === "PATCH" || operation.method === "PUT")
    return locale === "ar" ? "حفظ التغييرات" : "Save changes";
  if (operation.method === "DELETE")
    return locale === "ar" ? "إزالة" : "Remove";
  return locale === "ar" ? "فتح" : "Open";
}
function actionDescription(
  operation: OperationContract,
  locale: "en" | "ar",
): string {
  const mode = operation.job
    ? locale === "ar"
      ? "تابع التقدم بعد التأكيد"
      : "View progress after confirmation"
    : locale === "ar"
      ? "راجع التفاصيل قبل التأكيد"
      : "Review details before confirming";
  return `${moduleLabel(operation.module, locale)} · ${mode}`;
}

function actionSuccessLabel(
  operation: OperationContract,
  locale: "en" | "ar",
): string {
  if (operation.operationId.includes("prepare_"))
    return locale === "ar"
      ? "تم تجهيز المسودة للمراجعة دون إنشاء سجل"
      : "Draft prepared for review without creating a record";
  return locale === "ar" ? "تم التنفيذ بنجاح" : "Completed successfully";
}

function recordKey(value: unknown, index: number): string {
  if (value && typeof value === "object") {
    const record: Record<string, unknown> = value as Record<string, unknown>;
    for (const key of Object.keys(record)) {
      const candidate: unknown = record[key];
      if (key.toLowerCase().endsWith("id") && typeof candidate === "string") {
        return candidate;
      }
    }
  }
  return String(index);
}
function display(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  if (typeof value === "symbol") return value.description ?? "symbol";
  if (typeof value === "function") return "function";
  return JSON.stringify(value);
}

function localizedCode(value: string, locale: "en" | "ar"): string {
  const normalized = value.trim().toUpperCase();
  if (locale === "en") return humanize(normalized.toLowerCase());
  const labels: Readonly<Record<string, string>> = {
    ACTIVE: "نشط",
    INACTIVE: "غير نشط",
    OPEN: "مفتوح",
    SUBMITTED: "مُرسل",
    IN_REVIEW: "قيد المراجعة",
    ACCEPTED: "مقبول",
    DECLINED: "مرفوض",
    CLOSED: "مغلق",
    VERIFIED: "موثّق",
    UNVERIFIED: "غير موثّق",
    REJECTED: "مستبعد",
    FACT: "حقيقة موثّقة",
    FORECAST: "توقّع",
    OPINION: "رأي",
    CONSTRUCTION: "مقاولات وإنشاءات",
    INFRASTRUCTURE: "بنية تحتية",
    REAL_ESTATE: "تطوير عقاري",
    MARKET_SIGNAL: "إشارة سوق",
    TARGET_MARKET: "سوق مستهدف",
    TARGET_ACCOUNT: "حساب مستهدف",
    COMPETITOR: "منافس",
    PROSPECT: "عميل محتمل",
    STRATEGIC: "استراتيجي",
    ENTERPRISE: "شركات كبرى",
    MID_MARKET: "شركات متوسطة",
    MEGA_PROJECTS: "مشروعات كبرى",
    CONTRACTORS: "مقاولون",
    PREPARE_CUSTOMER_CREATION: "تجهيز إنشاء عميل",
    PREPARE_OPPORTUNITY_CREATION: "تجهيز إنشاء فرصة",
  };
  return labels[normalized] ?? humanize(value);
}

function humanize(value: string) {
  const label = value
    .replace(/^(get|post|put|patch|delete)_/, "")
    .replaceAll("_by_", " / ")
    .replaceAll("_", " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\bId\b/g, "ID")
    .trim();
  return label ? `${label[0]?.toUpperCase() ?? ""}${label.slice(1)}` : label;
}

const arabicLabels: Readonly<Record<string, string>> = {
  quoteRef: "مرجع عرض السعر",
  salesOrderRef: "مرجع أمر البيع",
  documentNumber: "رقم المستند",
  reference: "المرجع",
  title: "العنوان",
  name: "الاسم",
  displayName: "الاسم الظاهر",
  companyName: "اسم الشركة",
  normalizedName: "الاسم الموحّد",
  subject: "الموضوع",
  sourceName: "اسم المصدر",
  sourceUrl: "رابط المصدر",
  publishedDate: "تاريخ النشر",
  retrievedDate: "تاريخ الاسترجاع",
  eventDate: "تاريخ الحدث",
  evidence: "الدليل",
  verificationCode: "حالة التحقق",
  classificationCode: "التصنيف",
  summary: "الملخص",
  segmentCode: "القطاع",
  rationale: "مبرر الاستهداف",
  priorityScore: "درجة الأولوية",
  rankingSource: "مصدر الترتيب",
  website: "الموقع الإلكتروني",
  sourceSignalId: "إشارة السوق المصدرية",
  ownerUserId: "المسؤول التجاري",
  strengths: "نقاط القوة",
  weaknesses: "نقاط الضعف",
  notes: "ملاحظات",
  resourceTypeCode: "نوع العنصر",
  resourceType: "نوع العنصر",
  resourceId: "معرّف العنصر",
  label: "العنوان المختصر",
  targetAccountId: "الحساب المستهدف",
  requestId: "طلب الأعمال المتكررة",
  watchlistEntryId: "عنصر قائمة المتابعة",
  accountId: "العميل",
  requestedByUserId: "مقدّم الطلب",
  assignedOwnerUserId: "المسؤول المعيّن",
  salesResponse: "رد فريق المبيعات",
  action: "الإجراء",
  requiresConfirmation: "يتطلب تأكيدًا",
  createsBusinessRecord: "ينشئ سجل أعمال",
  duplicate: "نتيجة فحص التكرار",
  draft: "المسودة",
  canonicalName: "الاسم الرسمي المقترح",
  accountCategoryCode: "تصنيف العميل",
  statusCode: "الحالة",
  countryCode: "الدولة",
  currencyCode: "العملة",
  grandTotalAmount: "الإجمالي",
  amount: "القيمة",
  effectiveAt: "تاريخ السريان",
  createdAt: "تاريخ الإنشاء",
  updatedAt: "آخر تحديث",
  expectedRowVersion: "نسخة السجل المتوقعة",
  comment: "التعليق",
  reason: "السبب",
  description: "الوصف",
  item: "عنصر",
};

const englishLabels: Readonly<Record<string, string>> = {
  accountId: "Customer",
  contactId: "Contact person",
  opportunityId: "Opportunity",
  projectId: "Project",
  ownerUserId: "Owner",
  assignedOwnerUserId: "Assigned owner",
  requestedByUserId: "Requested by",
  countryCode: "Country",
  currencyCode: "Currency",
  statusCode: "Status",
  accountCategoryCode: "Customer category",
  documentTypeCode: "Document type",
  resourceTypeCode: "Record type",
  expectedRowVersion: "Record version",
  grandTotalAmount: "Total",
  effectiveAt: "Effective date",
  createdAt: "Created",
  updatedAt: "Last updated",
};

function labelFor(value: string, locale: "en" | "ar"): string {
  if (locale === "en") return englishLabels[value] ?? humanize(value);
  const normalized = value
    .replace(/^(get|post|put|patch|delete)_/, "")
    .replaceAll("_by_", "_");
  return arabicLabels[value] ?? arabicLabels[normalized] ?? humanize(value);
}

function translateAction(label: string): string {
  const labels: Readonly<Record<string, string>> = {
    "New quotation draft": "مسودة عرض سعر جديدة",
    "Prepare quotation document": "تجهيز مستند عرض السعر",
    "Start negotiation": "بدء التفاوض",
    "New capacity estimate": "تقدير سعة جديد",
    "New logistics plan": "خطة لوجستية جديدة",
    "Add effective FX rate": "إضافة سعر صرف فعّال",
    "Add payment": "إضافة دفعة",
    "Record cheque": "تسجيل شيك",
    "Create company target version": "إنشاء إصدار لهدف الشركة",
    "Upload document": "رفع مستند",
    "Create export job": "إنشاء مهمة تصدير",
    "Create import job": "إنشاء مهمة استيراد",
    "Add market signal": "إضافة إشارة سوق",
    "Add target market": "إضافة سوق مستهدف",
    "Add target account": "إضافة حساب مستهدف",
    "Add competitor": "إضافة منافس",
    "Add to watchlist": "إضافة إلى قائمة المتابعة",
    "Create repeat business request": "إنشاء طلب أعمال متكررة",
    "Update repeat business request": "تحديث طلب الأعمال المتكررة",
    "Prepare customer draft": "تجهيز مسودة عميل",
    "Prepare opportunity draft": "تجهيز مسودة فرصة",
    "Remove from watchlist": "إزالة من قائمة المتابعة",
  };
  return labels[label] ?? label;
}

function moduleLabel(module: string, locale: "en" | "ar"): string {
  if (locale === "en") return module;
  const labels: Readonly<Record<string, string>> = {
    Dashboard: "لوحة المعلومات",
    Search: "البحث",
    CRM: "إدارة العملاء",
    Opportunities: "الفرص",
    Quotations: "عروض الأسعار",
    Activities: "الأنشطة",
    Logistics: "اللوجستيات",
    Capacity: "السعة التشغيلية",
    Finance: "المالية",
    Analytics: "التحليلات",
    Documents: "المستندات",
    Imports: "الاستيراد",
    "Data Quality": "جودة البيانات",
    Identity: "الهوية والصلاحيات",
    Administration: "الإدارة",
    "Commercial Intelligence": "الاستخبارات التجارية",
    "Repeat Business": "الأعمال المتكررة",
    "Customer Growth": "نمو العملاء",
    "CUSTOMER GROWTH": "نمو العملاء",
  };
  return labels[module] ?? module;
}
