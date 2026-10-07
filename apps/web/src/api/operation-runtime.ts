import type { ApiClient, components } from "@abp/api-client";
import catalogJson from "../generated/operation-catalog.json";

export interface OperationContract {
  operationId: string;
  module: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  path: string;
  permission: string;
  queryParameters?: readonly string[];
  requestType: string;
  successResponse: string;
  executionMode: string;
  concurrency: string;
  /** "Required" when the server refuses the command without a key. */
  idempotency?: string;
  countryScope: string;
  job: boolean;
  requestSchema: FormSchema | null;
}

export interface FormSchema {
  type: string;
  nullable?: boolean;
  format?: string;
  description?: string;
  enum?: readonly (string | number | boolean)[];
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  required?: readonly string[];
  properties?: Readonly<Record<string, FormSchema | null>>;
  items?: FormSchema | null;
}

export const operationCatalog = catalogJson.operations as OperationContract[];
export const operationById = new Map(
  operationCatalog.map((operation) => [operation.operationId, operation]),
);

type ErrorEnvelope = components["schemas"]["ErrorEnvelope"];

export class FrontendApiError extends Error {
  constructor(
    readonly status: number,
    readonly envelope: ErrorEnvelope | undefined,
  ) {
    super(envelope?.error.messageKey ?? `HTTP_${status.toString()}`);
  }
}

interface RuntimeResult {
  data?: unknown;
  error?: unknown;
  response: Response;
}

type RuntimeMethod = (
  path: string,
  options?: Record<string, unknown>,
) => Promise<RuntimeResult>;

export interface ExecuteOperationInput {
  path: Record<string, string>;
  query?: Record<string, string | number | boolean>;
  body?: unknown;
  ifMatch?: string;
  idempotencyKey?: string;
}

/**
 * Undo the `W/` a compressing proxy adds.
 *
 * The API sends a strong validator, `"rv-7"`, because that is what If-Match
 * has to be compared with. nginx gzips any JSON response over 1 KB and
 * rewrites the header to `W/"rv-7"` on the way out -- correct of it, since the
 * bytes are no longer identical, but the validator here is a row-version
 * counter, not a hash of the body, so the two forms name the same version.
 * Sent back as-is the server rejects it with 428 IF_MATCH_REQUIRED, which made
 * every optimistic-concurrency write fail as soon as the response grew past a
 * kilobyte -- saving a quotation with lines in it, editing an activity -- while
 * the same action on a smaller record worked. Stripping it here fixes every
 * caller at once, including the screens that read the header with no fallback
 * to the body's own rowVersion.
 */
function strongEtag(value: string | null): string | null {
  if (value === null) return null;
  return value.startsWith("W/") ? value.slice(2) : value;
}

export async function executeOperation(
  client: ApiClient,
  operation: OperationContract,
  input: ExecuteOperationInput,
): Promise<{ data: unknown; etag: string | null; status: number }> {
  const method = (client as unknown as Record<string, RuntimeMethod>)[
    operation.method
  ];
  if (!method)
    throw new Error(`GENERATED_CLIENT_METHOD_MISSING_${operation.method}`);
  const requestedQuery: Record<string, string | number | boolean> | undefined =
    input.query ??
    (operation.method === "GET"
      ? defaultQuery(operation.operationId)
      : undefined);
  const paginatedQuery =
    requestedQuery &&
    operation.queryParameters?.includes("offset") &&
    requestedQuery.page !== undefined &&
    requestedQuery.offset === undefined
      ? {
          ...requestedQuery,
          offset:
            (Number(requestedQuery.page) - 1) *
            Number(requestedQuery.limit ?? 25),
        }
      : requestedQuery;
  const query =
    paginatedQuery && operation.queryParameters
      ? Object.fromEntries(
          Object.entries(paginatedQuery).filter(([name]) =>
            operation.queryParameters?.includes(name),
          ),
        )
      : paginatedQuery;
  const headers: Record<string, string> = {};
  if (input.ifMatch) headers["If-Match"] = input.ifMatch;
  /**
   * The key a command needs, supplied here rather than remembered there.
   *
   * Ninety-eight operations refuse to run without an `Idempotency-Key`, and
   * the contract has always said which -- but the requirement was dropped on
   * the way into the frontend catalogue, so every call site had to know. Two
   * did not, and each failed with a 400 the moment somebody pressed the
   * button: adding a document subject, and requesting a manager override.
   *
   * A caller that passes its own key still wins, because a key it can repeat
   * is what makes a retry safe; one generated here is single-use, which is the
   * right default for a button a person presses once.
   */
  const key =
    input.idempotencyKey ??
    (/^(required|idempotency-key)$/i.test(operation.idempotency ?? "")
      ? crypto.randomUUID()
      : undefined);
  if (key !== undefined) headers["Idempotency-Key"] = key;
  const params = {
    ...(Object.keys(input.path).length > 0 ? { path: input.path } : {}),
    ...(query && Object.keys(query).length > 0 ? { query } : {}),
    ...(Object.keys(headers).length > 0 ? { header: headers } : {}),
  };
  const result = await method(operation.path, {
    ...(Object.keys(params).length > 0 ? { params } : {}),
    ...(operation.method === "GET" || operation.method === "DELETE"
      ? {}
      : { body: input.body ?? {} }),
  });
  if (result.data !== undefined)
    return {
      data: result.data,
      etag: strongEtag(result.response.headers.get("etag")),
      status: result.response.status,
    };
  throw new FrontendApiError(
    result.response.status,
    result.error as ErrorEnvelope | undefined,
  );
}

export function requiredPathParameters(path: string): string[] {
  return [...path.matchAll(/\{([^}]+)\}/g)].map((match) => match[1] ?? "");
}

function defaultQuery(
  operationId: string,
): Record<string, string | number | boolean> {
  if (operationId === "get_search") return { search: "", page: 1, limit: 25 };
  if (operationId.includes("_by_year_")) return {};
  return { page: 1, limit: 25 };
}
