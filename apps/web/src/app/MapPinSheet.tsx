import { useRef, useState } from "react";
import type { ApiClient } from "@abp/api-client";
import { useI18n } from "../i18n/i18n.tsx";
import {
  failDownload,
  finishDownload,
  reportStage,
  saveBlob,
  startDownload,
} from "../lib/downloads.ts";
import {
  PIN_SHEET_HEADERS,
  pinSheetRows,
  readPinSheet,
  type PinChange,
  type PinProblem,
  type PinnablePoint,
} from "../lib/map-pins.ts";
import { localToday } from "../lib/today.ts";
import { commercialRequest } from "./commercial-api.ts";

/**
 * Pins for many places at once: download the sheet of every customer and
 * project, type or paste the coordinates, upload it, check, save.
 */
export function MapPinSheet({
  client,
  points,
  onSaved,
}: {
  client: ApiClient;
  points: PinnablePoint[];
  onSaved: (count: number) => Promise<void>;
}) {
  const { locale } = useI18n();
  const ar = locale === "ar";
  const txt = (en: string, arabic: string) => (ar ? arabic : en);
  const input = useRef<HTMLInputElement | null>(null);
  const [reading, setReading] = useState(false);
  const [unreadable, setUnreadable] = useState(false);
  const [result, setResult] = useState<{
    changes: PinChange[];
    unchanged: number;
    problems: PinProblem[];
  } | null>(null);
  const [saved, setSaved] = useState(0);
  const [saving, setSaving] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  const download = async () => {
    const fileName = `abp-map-pins-${localToday()}.xlsx`;
    const trayId = startDownload(fileName);
    try {
      const ExcelJS = await import("exceljs");
      reportStage(trayId, 0.3);
      const book = new ExcelJS.Workbook();
      const sheet = book.addWorksheet("Pins", {
        views: [{ state: "frozen", ySplit: 1 }],
      });
      sheet.addRow([...PIN_SHEET_HEADERS]);
      for (const row of pinSheetRows(points)) sheet.addRow(row);
      sheet.getRow(1).font = { bold: true };
      sheet.columns.forEach((column, index) => {
        column.width = [11, 16, 38, 9, 34, 13, 13][index] ?? 14;
      });
      // The two columns to fill stand out from the ones to leave alone.
      for (const letter of ["F", "G"])
        sheet.getColumn(letter).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFFF7D6" },
        };
      const help = book.addWorksheet("How to fill");
      for (const line of [
        "Fill Latitude and Longitude for the places you know; leave the rest empty.",
        "In Google Maps, right-click the place and click the numbers at the top to copy them -- e.g. 30.0296, 31.4913.",
        "You can paste both numbers into the Latitude cell; the sheet splits them.",
        "Do not change Type or Reference: that is how each row finds its customer or project.",
        "Upload the file on the Customer map, check the summary, then save.",
      ])
        help.addRow([line]);
      help.getColumn(1).width = 110;
      reportStage(trayId, 0.7);
      const buffer = await book.xlsx.writeBuffer();
      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      saveBlob(blob, fileName);
      finishDownload(trayId, blob.size);
    } catch (error) {
      failDownload(trayId, String(error), () => void download());
    }
  };

  const read = async (file: File) => {
    setReading(true);
    setUnreadable(false);
    setResult(null);
    setSaved(0);
    setFailures([]);
    try {
      const ExcelJS = await import("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const sheet = book.worksheets[0];
      if (sheet === undefined) throw new Error("the file has no sheet");
      const grid: unknown[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row, number) => {
        const values = row.values;
        grid[number - 1] = Array.isArray(values)
          ? Array.from(
              { length: Math.max(0, values.length - 1) },
              (_, index) => values[index + 1] ?? "",
            )
          : [];
      });
      for (let index = 0; index < grid.length; index += 1) grid[index] ??= [];
      setResult(readPinSheet(grid, points));
    } catch (error) {
      console.error("pin sheet could not be read", error);
      setUnreadable(true);
    } finally {
      setReading(false);
      if (input.current !== null) input.current.value = "";
    }
  };

  const save = async () => {
    if (!result) return;
    setSaving(true);
    setSaved(0);
    const failed: string[] = [];
    let done = 0;
    // One at a time: each pin is its own audited change, and a hundred at
    // once would only trip the rate limit.
    for (const change of result.changes) {
      try {
        await commercialRequest(client, "PUT", "/map/locations", {
          path: {},
          body: {
            resourceTypeCode: change.point.kind,
            resourceId: change.point.id,
            latitude: change.lat,
            longitude: change.lng,
          },
        });
        done += 1;
      } catch {
        failed.push(
          typeof change.point.name === "string"
            ? change.point.name
            : change.point.id,
        );
      }
      setSaved(done + failed.length);
    }
    setFailures(failed);
    setSaving(false);
    setResult(null);
    await onSaved(done);
  };

  const total = result?.changes.length ?? 0;
  const swapped =
    result?.changes.filter((change) => change.swapped).length ?? 0;
  return (
    <div className="map-pin-sheet">
      <h3>{txt("Pins from a sheet", "أماكن من شيت")}</h3>
      <p className="settings-hint">
        {txt(
          "Download every customer and project, add their coordinates, upload it back.",
          "نزّل كل العملاء والمشاريع، اكتب الإحداثيات، وارفع الشيت تاني.",
        )}
      </p>
      <div className="map-pin-sheet-actions">
        <button
          type="button"
          className="secondary"
          onClick={() => void download()}
        >
          {txt("Download sheet", "نزّل الشيت")}
        </button>
        <button
          type="button"
          className="secondary"
          disabled={reading || saving}
          onClick={() => input.current?.click()}
        >
          {reading ? "…" : txt("Upload filled sheet", "ارفع الشيت")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".xlsx"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void read(file);
          }}
        />
      </div>
      {unreadable && (
        <p className="form-error">
          {txt(
            "That file could not be read. Upload the .xlsx downloaded from here.",
            "الملف ده مش مقروء. ارفع ملف الـxlsx اللي نزل من هنا.",
          )}
        </p>
      )}
      {result && (
        <div className="map-pin-sheet-summary" role="status">
          <p>
            <strong>{total}</strong>{" "}
            {total === 1
              ? txt("place to pin", "مكان هيتثبت")
              : txt("places to pin", "أماكن هتتثبت")}
            {result.unchanged > 0 &&
              ` · ${String(result.unchanged)} ${txt("already there", "متثبتين أصلاً")}`}
            {result.problems.length > 0 &&
              ` · ${String(result.problems.length)} ${result.problems.length === 1 ? txt("row to fix", "صف محتاج يتصلح") : txt("rows to fix", "صفوف محتاجة تتصلح")}`}
          </p>
          {swapped > 0 && (
            <p className="settings-hint">
              {txt(
                `${String(swapped)} had latitude and longitude the wrong way round and were put right.`,
                `${String(swapped)} كانوا مكتوبين بالعكس واتظبطوا.`,
              )}
            </p>
          )}
          {result.problems.length > 0 && (
            <ul className="map-pin-sheet-problems">
              {result.problems.slice(0, 6).map((problem) => (
                <li key={problem.row}>
                  {txt("Row", "صف")} {problem.row}: {problem.reason}
                </li>
              ))}
              {result.problems.length > 6 && (
                <li>
                  {txt("and", "و")} {result.problems.length - 6}{" "}
                  {txt("more", "كمان")}
                </li>
              )}
            </ul>
          )}
          {total > 0 && (
            <button
              type="button"
              className="primary"
              disabled={saving}
              onClick={() => void save()}
            >
              {total === 1
                ? txt("Save 1 pin", "احفظ المكان")
                : txt(
                    `Save ${String(total)} pins`,
                    `احفظ ${String(total)} أماكن`,
                  )}
            </button>
          )}
        </div>
      )}
      {saving && (
        <div
          className="map-pin-sheet-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={saved}
        >
          <span
            style={{ width: `${String(total ? (saved / total) * 100 : 0)}%` }}
          />
          <small>
            {saved} / {total}
          </small>
        </div>
      )}
      {failures.length > 0 && (
        <p className="form-error">
          {txt("Not saved:", "متحفظوش:")} {failures.slice(0, 5).join(" · ")}
        </p>
      )}
    </div>
  );
}
