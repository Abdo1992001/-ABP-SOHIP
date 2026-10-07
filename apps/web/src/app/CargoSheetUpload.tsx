import { useRef, useState } from "react";
import {
  importCargoSheet,
  type ImportProblem,
  type ImportedBoard,
} from "../lib/cargo-sheet-import.ts";

/**
 * Loading a shipment from a spreadsheet.
 *
 * Typing forty board sizes into a screen is the step where a 12 mm board
 * becomes an 18 mm one, and the sizes already exist in a sheet somebody has —
 * ABP's own loading sheet, a customer's list, a supplier's datasheet. So the
 * sheet is read rather than re-typed.
 *
 * What it will not do is import silently. Rows it could not use are named by
 * their row number, and rows it filled a default into say so, because an
 * import that quietly drops four of forty boards produces a cargo plan that is
 * confidently short by four boards.
 *
 * ExcelJS is loaded only when a file is chosen: it is a megabyte, and most
 * visits to this screen type the figures in.
 */

export function CargoSheetUpload({
  onImported,
  labels,
}: {
  onImported: (boards: ImportedBoard[]) => void;
  labels: {
    choose: string;
    reading: string;
    template: string;
    hint: string;
    imported: (count: number) => string;
    problems: (count: number) => string;
    failed: string;
    dismiss: string;
  };
}) {
  const input = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [problems, setProblems] = useState<ImportProblem[]>([]);
  const [done, setDone] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);

  const read = async (file: File) => {
    setBusy(true);
    setFailed(false);
    setProblems([]);
    setDone(null);
    try {
      const ExcelJS = await import("exceljs");
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await file.arrayBuffer());
      const sheet = book.worksheets[0];
      if (sheet === undefined) throw new Error("the file has no sheet");

      // ExcelJS gives a one-based sparse array per row; the importer wants a
      // plain grid, so the leading hole is dropped and gaps become blanks.
      const rows: unknown[][] = [];
      sheet.eachRow({ includeEmpty: true }, (row, number) => {
        const values = row.values;
        // `Array.from`, not `.map`: an ExcelJS row is a sparse array — a row
        // whose first cell is empty has a hole at index 1 — and `.map` copies
        // holes through without visiting them. A hole then reaches the column
        // matcher as `undefined` and the whole import fails on one blank cell.
        rows[number - 1] = Array.isArray(values)
          ? Array.from(
              { length: Math.max(0, values.length - 1) },
              (_, index) => values[index + 1] ?? "",
            )
          : [];
      });
      for (let index = 0; index < rows.length; index += 1) rows[index] ??= [];

      const result = importCargoSheet(rows);
      setProblems(result.problems);
      setDone(result.boards.length);
      if (result.boards.length > 0) onImported(result.boards);
    } catch (error) {
      // Say why, in the console at least: "could not be read" with no reason
      // is the kind of failure a person reports and nobody can act on.
      console.error("cargo sheet import failed", error);
      setFailed(true);
    } finally {
      setBusy(false);
      if (input.current !== null) input.current.value = "";
    }
  };

  return (
    <div className="cargo-upload">
      <div className="cargo-upload-row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={() => {
            input.current?.click();
          }}
        >
          {busy ? labels.reading : labels.choose}
        </button>
        <a
          className="cargo-upload-template"
          href="/templates/abp-cargo-boards.xlsx"
          download
        >
          {labels.template}
        </a>
        <input
          ref={input}
          type="file"
          accept=".xlsx,.xlsm"
          hidden
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void read(file);
          }}
        />
      </div>
      <p className="settings-hint">{labels.hint}</p>

      {failed && <p className="cargo-upload-failed">{labels.failed}</p>}

      {done !== null && !failed && (
        <div className="cargo-upload-result">
          <strong>{labels.imported(done)}</strong>
          {problems.length > 0 && (
            <>
              {/* Two counts, because they are two things: a row that was
                  left out, and a row that came in with something worth
                  looking at. One heading over both made a warning read as a
                  loss. */}
              <span>{labels.problems(problems.length)}</span>
              <ul>
                {problems.map((problem) => (
                  <li
                    key={`${String(problem.row)}-${problem.message}`}
                    className={
                      problem.severity === "SKIPPED" ? "is-skipped" : ""
                    }
                  >
                    <code>{problem.row}</code> {problem.message}
                  </li>
                ))}
              </ul>
            </>
          )}
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              setDone(null);
              setProblems([]);
            }}
          >
            {labels.dismiss}
          </button>
        </div>
      )}
    </div>
  );
}
