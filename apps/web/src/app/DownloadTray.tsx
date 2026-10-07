import { useEffect, useState } from "react";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import {
  clearFinishedDownloads,
  dismissDownload,
  downloadWithProgress,
  formatBytes,
  installDownloadCapture,
  subscribeDownloads,
  type DownloadItem,
} from "../lib/downloads.ts";

/**
 * The downloads tray: every file being saved, with how far along it is.
 *
 * It opens by itself when a download starts and can be folded down to a small
 * ring with the "–" button -- the download carries on in the background, and
 * the ring keeps counting while the person moves to another screen. It sits
 * bottom-right above the toasts' column on narrow screens and beside them on
 * wide ones, and it leaves by itself a few seconds after everything is done.
 */
export function DownloadTray() {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const [items, setItems] = useState<readonly DownloadItem[]>([]);
  const [minimised, setMinimised] = useState(false);

  useEffect(() => {
    installDownloadCapture();
    return subscribeDownloads(setItems);
  }, []);

  const active = items.filter(
    (item) => item.state === "PREPARING" || item.state === "DOWNLOADING",
  );
  const failed = items.some((item) => item.state === "FAILED");

  // Everything done and nothing failed: step aside after a moment.
  useEffect(() => {
    if (items.length === 0 || active.length > 0 || failed) return;
    const timer = window.setTimeout(() => {
      clearFinishedDownloads();
    }, 6000);
    return () => {
      window.clearTimeout(timer);
    };
  }, [items, active.length, failed]);

  if (items.length === 0) return null;
  const known = active.filter((item) => item.progress !== null);
  const overall =
    active.length === 0
      ? 1
      : known.length === 0
        ? null
        : known.reduce((sum, item) => sum + (item.progress ?? 0), 0) /
          known.length;

  if (minimised)
    return (
      <button
        type="button"
        className={`download-pill${active.length > 0 ? " is-busy" : " is-done"}`}
        onClick={() => {
          setMinimised(false);
        }}
        aria-label={txt("Show downloads", "اعرض التحميلات")}
      >
        <Ring value={overall} />
        <span>
          {active.length > 0
            ? txt(
                `${String(active.length)} downloading`,
                `${String(active.length)} بيتحمّل`,
              )
            : txt("Downloads done", "التحميلات خلصت")}
        </span>
        {overall !== null && active.length > 0 && (
          <strong>{Math.round(overall * 100)}%</strong>
        )}
      </button>
    );

  return (
    <section
      className="download-tray"
      aria-live="polite"
      aria-label={txt("Downloads", "التحميلات")}
    >
      <header>
        <strong>
          {active.length > 0
            ? txt(
                `Downloading ${String(active.length)}…`,
                `بيتحمّل ${String(active.length)}…`,
              )
            : txt("Downloads", "التحميلات")}
        </strong>
        <div>
          <button
            type="button"
            className="download-icon-button"
            onClick={() => {
              setMinimised(true);
            }}
            aria-label={txt(
              "Minimise — keep downloading in the background",
              "صغّر — كمّل التحميل في الخلفية",
            )}
            title={txt(
              "Keep downloading in the background",
              "كمّل التحميل في الخلفية",
            )}
          >
            –
          </button>
          <button
            type="button"
            className="download-icon-button"
            onClick={() => {
              clearFinishedDownloads();
              if (active.length > 0) setMinimised(true);
            }}
            aria-label={txt("Close", "إغلاق")}
          >
            ×
          </button>
        </div>
      </header>
      <ul>
        {items.map((item) => (
          <li
            key={item.id}
            className={`download-item is-${item.state.toLowerCase()}`}
          >
            <span
              className={`download-type type-${extensionOf(item.fileName)}`}
              aria-hidden="true"
            >
              {extensionOf(item.fileName).toUpperCase().slice(0, 4) || "FILE"}
            </span>
            <div className="download-body">
              <span className="download-name" title={item.fileName}>
                {item.fileName}
              </span>
              <div
                className="download-bar"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                {...(item.progress === null
                  ? {}
                  : { "aria-valuenow": Math.round(item.progress * 100) })}
              >
                <div
                  className={
                    item.progress === null && item.state !== "FAILED"
                      ? "is-indeterminate"
                      : ""
                  }
                  style={
                    item.progress === null
                      ? undefined
                      : { width: `${String(item.progress * 100)}%` }
                  }
                />
              </div>
              <span className="download-meta">
                {item.state === "PREPARING" && txt("Preparing…", "بيتجهّز…")}
                {item.state === "DOWNLOADING" &&
                  (item.progress === null
                    ? formatBytes(item.bytes)
                    : `${String(Math.round(item.progress * 100))}% · ${formatBytes(item.bytes)}${item.totalBytes ? ` / ${formatBytes(item.totalBytes)}` : ""}`)}
                {item.state === "DONE" && (
                  <>
                    <span className="download-tick" aria-hidden="true">
                      ✓
                    </span>{" "}
                    {txt("Saved", "اتحفظ")}
                    {item.bytes > 0 ? ` · ${formatBytes(item.bytes)}` : ""}
                  </>
                )}
                {item.state === "FAILED" && (
                  <>
                    {txt("Failed", "فشل")} · {item.error}
                    {item.retry && (
                      <button
                        type="button"
                        className="download-retry"
                        onClick={item.retry}
                      >
                        {txt("Try again", "جرّب تاني")}
                      </button>
                    )}
                  </>
                )}
              </span>
            </div>
            {(item.state === "DONE" || item.state === "FAILED") && (
              <button
                type="button"
                className="download-icon-button"
                aria-label={txt("Remove", "شيل")}
                onClick={() => {
                  dismissDownload(item.id);
                }}
              >
                ×
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A ring that fills with the overall progress; spins when it is unknown. */
function Ring({ value }: { value: number | null }) {
  const circumference = 2 * Math.PI * 9;
  return (
    <svg
      className={`download-ring${value === null ? " is-spinning" : ""}`}
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" className="track" />
      <circle
        cx="12"
        cy="12"
        r="9"
        className="fill"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - (value ?? 0.25))}
      />
    </svg>
  );
}

function extensionOf(fileName: string): string {
  const match = /\.([a-z0-9]{1,5})$/i.exec(fileName);
  return match?.[1]?.toLowerCase() ?? "";
}

/** Download a stored document with its progress shown in the tray. */
export async function downloadDocument(
  client: ApiClient,
  documentId: string,
  fallbackName = "document",
) {
  let fileName = fallbackName;
  try {
    const descriptor = await client.GET("/documents/{documentId}/download", {
      params: { path: { documentId } },
    });
    fileName = descriptor.data?.data.fileName ?? fallbackName;
  } catch {
    // The content route still serves the file; only its name is unknown.
  }
  await downloadWithProgress(
    `/api/v1/documents/${encodeURIComponent(documentId)}/content`,
    fileName,
  );
}
