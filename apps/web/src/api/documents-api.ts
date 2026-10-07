import type { ApiClient, components } from "@abp/api-client";
import { CustomerApiError, type ErrorEnvelope } from "./customer-api.ts";

function unwrap<T>(result: {
  data?: T;
  error?: unknown;
  response: Response;
}): T {
  if (result.data !== undefined) return result.data;
  throw new CustomerApiError(
    result.response.status,
    result.error as ErrorEnvelope | undefined,
  );
}

export async function uploadFileAsAttachment(
  client: ApiClient,
  file: File,
  documentTypeCode: string,
  targetResourceType: string,
  targetResourceId: string,
) {
  const created = await client.POST("/documents/uploads", {
    params: { header: { "Idempotency-Key": crypto.randomUUID() } },
    body: {
      documentTypeCode,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      targetResourceType,
      targetResourceId,
    },
  });
  const session =
    unwrap<components["schemas"]["UploadSessionEnvelope"]>(created).data;
  const uploadSessionId = (session.statusUrl ?? "").split("/").pop() ?? "";
  if (!uploadSessionId) throw new Error("UPLOAD_SESSION_ID_MISSING");
  await client.POST("/documents/uploads/{uploadSessionId}/content", {
    params: {
      path: { uploadSessionId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    headers: { "Content-Type": "application/octet-stream" },
    body: file as unknown as string,
    bodySerializer: (body) => body as unknown as BodyInit,
  });
  await client.POST("/documents/uploads/{uploadSessionId}/complete", {
    params: {
      path: { uploadSessionId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: {},
  });
  let documentId: string | null = null;
  for (let attempt = 0; attempt < 10 && !documentId; attempt += 1) {
    await new Promise((r) => setTimeout(r, 800));
    const status = await client.GET("/documents/uploads/{uploadSessionId}", {
      params: { path: { uploadSessionId } },
    });
    const row = status.data?.data;
    if (row?.documentVersionId) documentId = row.documentVersionId;
    if (row?.failureCode) throw new Error(row.failureCode);
  }
  if (!documentId) throw new Error("UPLOAD_SCAN_TIMEOUT");
  const linked = await client.POST("/documents/{documentId}/links", {
    params: {
      path: { documentId },
      header: { "Idempotency-Key": crypto.randomUUID() },
    },
    body: {
      resourceTypeCode: targetResourceType,
      resourceId: targetResourceId,
      relationshipTypeCode: "ATTACHMENT",
    },
  });
  const envelope = unwrap(linked);
  return (envelope as unknown as components["schemas"]["DocumentEnvelope"])
    .data;
}

export async function listResourceDocuments(
  client: ApiClient,
  resourceTypeCode: string,
  resourceId: string,
): Promise<readonly components["schemas"]["DocumentListItem"][]> {
  const result = await client.GET("/documents", {
    params: { query: { resourceTypeCode, resourceId, limit: 50 } },
  });
  if (!result.data)
    throw new CustomerApiError(
      result.response.status,
      result.error as ErrorEnvelope | undefined,
    );
  return (
    result.data as unknown as components["schemas"]["DocumentListEnvelope"]
  ).data;
}
