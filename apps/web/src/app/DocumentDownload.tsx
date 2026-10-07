import { useMutation, useQuery } from "@tanstack/react-query";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import { ErrorBanner } from "./CommercialUI.tsx";
import { downloadDocument } from "./DownloadTray.tsx";
import { commercialRequest, isObject, str } from "./commercial-api.ts";

export function DocumentDownload({
  client,
  documentId,
}: {
  client: ApiClient;
  documentId: string;
}) {
  const { locale } = useI18n();
  // Through the downloads tray, so a large file shows its progress and can
  // carry on in the background.
  const download = useMutation({
    mutationFn: () => downloadDocument(client, documentId),
  });
  return (
    <>
      <button
        disabled={download.isPending}
        onClick={() => {
          download.mutate();
        }}
      >
        {download.isPending
          ? "…"
          : locale === "ar"
            ? "تنزيل الملف"
            : "Download file"}
      </button>
      <ErrorBanner
        error={download.error}
        retry={() => {
          download.mutate();
        }}
      />
    </>
  );
}

export function ExportDelivery({
  client,
  exportId,
  analytics = false,
}: {
  client: ApiClient;
  exportId: string;
  analytics?: boolean;
}) {
  const { locale } = useI18n();
  const query = useQuery({
    queryKey: ["export-delivery", exportId, analytics],
    queryFn: () =>
      commercialRequest(
        client,
        "GET",
        analytics ? "/analytics/exports/{exportId}" : "/exports/{exportId}",
        { path: { exportId } },
      ),
    refetchInterval: (q) => {
      const payload = q.state.data?.data;
      const detail =
        isObject(payload) && isObject(payload.data) ? payload.data : {};
      return ["COMPLETED", "FAILED"].includes(
        str(detail.status ?? detail.statusCode),
      )
        ? false
        : 1500;
    },
  });
  const payload = query.data?.data;
  const detail =
    isObject(payload) && isObject(payload.data) ? payload.data : {};
  return (
    <div role="status">
      <ErrorBanner error={query.error} retry={() => void query.refetch()} />
      {detail.documentId ? (
        <DocumentDownload client={client} documentId={str(detail.documentId)} />
      ) : (
        <p>
          {str(detail.status ?? detail.statusCode) === "FAILED"
            ? locale === "ar"
              ? "فشل إنشاء الملف"
              : "File generation failed"
            : locale === "ar"
              ? "جار تجهيز الملف…"
              : "Preparing file…"}
          {detail.failureCode ? ` · ${str(detail.failureCode)}` : ""}
        </p>
      )}
    </div>
  );
}
