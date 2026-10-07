/**
 * Downloads, tracked: every file the app saves reports here, and the tray in
 * the corner shows each one -- its name, how far along it is, and when it is
 * done -- while the person carries on working.
 *
 * Two kinds of download feed it. A file fetched from the server streams, so
 * its percentage is real. A file built in the browser (an Excel or Word
 * quotation, a report) is caught at the moment it is saved, whichever screen
 * made it, so no screen has to remember to report itself.
 */

export type DownloadState = "PREPARING" | "DOWNLOADING" | "DONE" | "FAILED";

export interface DownloadItem {
  id: string;
  fileName: string;
  state: DownloadState;
  /** 0..1, or null while the size is unknown. */
  progress: number | null;
  bytes: number;
  totalBytes: number | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  retry?: () => void;
}

type Listener = (items: readonly DownloadItem[]) => void;

let items: DownloadItem[] = [];
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...items];
  for (const listener of listeners) listener(snapshot);
}

export function subscribeDownloads(listener: Listener): () => void {
  listeners.add(listener);
  listener([...items]);
  return () => {
    listeners.delete(listener);
  };
}

function update(id: string, patch: Partial<DownloadItem>) {
  items = items.map((item) => (item.id === id ? { ...item, ...patch } : item));
  emit();
}

export function dismissDownload(id: string) {
  items = items.filter((item) => item.id !== id);
  emit();
}

export function clearFinishedDownloads() {
  items = items.filter(
    (item) => item.state === "PREPARING" || item.state === "DOWNLOADING",
  );
  emit();
}

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${String(Date.now())}-${String(Math.random()).slice(2)}`;
}

export function startDownload(fileName: string): string {
  const id = newId();
  items = [
    {
      id,
      fileName,
      state: "PREPARING" as const,
      progress: null,
      bytes: 0,
      totalBytes: null,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
    },
    ...items,
  ].slice(0, 8);
  emit();
  return id;
}

export function reportProgress(
  id: string,
  bytes: number,
  totalBytes: number | null,
) {
  update(id, {
    state: "DOWNLOADING",
    bytes,
    totalBytes,
    progress:
      totalBytes && totalBytes > 0 ? Math.min(1, bytes / totalBytes) : null,
  });
}

/**
 * Progress for a file built in the browser, by stage: there are no bytes to
 * count while a workbook is being filled, but there are steps.
 */
export function reportStage(id: string, fraction: number) {
  update(id, {
    state: "DOWNLOADING",
    progress: Math.max(0, Math.min(0.99, fraction)),
  });
}

export function finishDownload(id: string, bytes?: number) {
  update(id, {
    state: "DONE",
    progress: 1,
    ...(bytes === undefined ? {} : { bytes, totalBytes: bytes }),
    finishedAt: Date.now(),
  });
}

export function failDownload(id: string, error: string, retry?: () => void) {
  update(id, {
    state: "FAILED",
    error,
    finishedAt: Date.now(),
    ...(retry ? { retry } : {}),
  });
}

/** Hand a blob to the browser as a saved file. */
export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  link.dataset.tracked = "true";
  link.click();
  window.setTimeout(() => {
    URL.revokeObjectURL(url);
  }, 2000);
}

/**
 * Fetch a file with its progress reported, then save it. The size comes from
 * Content-Length; without one the tray shows the bytes so far instead.
 */
export async function downloadWithProgress(
  url: string,
  fileName: string,
): Promise<void> {
  const id = startDownload(fileName);
  const run = async () => {
    try {
      const response = await fetch(url, { credentials: "include" });
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const total = Number(response.headers.get("content-length")) || null;
      const disposition = response.headers.get("content-disposition") ?? "";
      const named = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(
        disposition,
      )?.[1];
      const finalName = named ? decodeURIComponent(named) : fileName;
      if (finalName !== fileName) update(id, { fileName: finalName });
      if (!response.body) {
        const blob = await response.blob();
        saveBlob(blob, finalName);
        finishDownload(id, blob.size);
        return;
      }
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        received += value.length;
        reportProgress(id, received, total);
      }
      const blob = new Blob(chunks as BlobPart[], {
        type:
          response.headers.get("content-type") ?? "application/octet-stream",
      });
      saveBlob(blob, finalName);
      finishDownload(id, blob.size);
    } catch (error) {
      failDownload(
        id,
        error instanceof Error ? error.message : "DOWNLOAD_FAILED",
        () => {
          dismissDownload(id);
          void downloadWithProgress(url, fileName);
        },
      );
    }
  };
  await run();
}

/**
 * Catch files built in the browser at the moment they are saved, from any
 * screen: an <a download> clicked with a blob: address. Installed once by the
 * tray. Files saved through `saveBlob` are already tracked and are skipped.
 */
let installed = false;
const blobSizes = new Map<string, number>();
export function installDownloadCapture() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const createObjectURL = URL.createObjectURL.bind(URL);
  URL.createObjectURL = (object: Blob | MediaSource) => {
    const url = createObjectURL(object);
    if (object instanceof Blob) blobSizes.set(url, object.size);
    return url;
  };
  // eslint-disable-next-line @typescript-eslint/unbound-method -- re-bound with .call below
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function trackedClick(
    this: HTMLAnchorElement,
  ) {
    if (
      this.download &&
      this.href.startsWith("blob:") &&
      this.dataset.tracked !== "true"
    ) {
      const id = startDownload(this.download);
      finishDownload(id, blobSizes.get(this.href) ?? 0);
    }
    click.call(this);
  };
}

/** "1.4 MB", "820 KB". */
export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "";
  if (bytes < 1024 * 1024)
    return `${String(Math.max(1, Math.round(bytes / 1024)))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
