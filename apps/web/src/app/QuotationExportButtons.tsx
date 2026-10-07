import { useState } from "react";
import {
  dismissDownload,
  failDownload,
  finishDownload,
  reportStage,
  saveBlob,
  startDownload,
} from "../lib/downloads.ts";
import { QuotationPrintSheet } from "./QuotationPrintSheet.tsx";
import { insertRowsKeepingMerges } from "../lib/xlsx-rows.ts";
import {
  documentRows,
  exportFileName,
  money,
  type QuotationExport,
} from "../lib/quotation-export.ts";
import {
  fillQuotationTemplate,
  hasSpecialLineDiscount,
  LINES_FIRST_ROW,
  LINES_ROWS,
  quotationTemplateLayout,
} from "../lib/quotation-template.ts";
import {
  fillProformaTemplate,
  type ProformaExtra,
} from "../lib/proforma-template.ts";

/**
 * Saving the quotation as a file: PDF, Excel or Word.
 *
 * Three, because three people ask for three: a customer wants the PDF, their
 * procurement wants the lines in a spreadsheet they can work in, and a
 * contracts office wants Word so the terms can be pasted into an agreement.
 * All three are written from the one `QuotationExport` the screen assembles,
 * so they cannot disagree about a total.
 *
 * The writers are loaded only when a button is pressed. ExcelJS and docx are
 * both large, and a person reading a quotation on screen should not download
 * them to do it.
 *
 * PDF goes through the browser's own print, which is deliberate: the PDF is
 * then exactly the document on screen rather than a second rendering of it that
 * can drift. It prints the preview that is already open.
 */

export function QuotationExportButtons({
  document: quotation,
  extra,
  proforma,
  labels,
  onPrint,
}: {
  document: QuotationExport;
  /** The proforma's own fields: the buyer, the weights, the freight. */
  proforma?: ProformaExtra;
  /** The header fields the template has boxes for and the document does not. */
  extra?: {
    contactPerson?: string;
    salesEngineer?: string;
    mobile?: string;
    customerRef?: string;
    /** A short form of the terms for the Payment cell, which is one row tall. */
    paymentShort?: string;
    offerValidity?: string;
    delivery?: string;
    deliveryPoint?: string;
    notes?: string;
  };
  labels: {
    pdf: string;
    excel: string;
    word: string;
    working: string;
    failed: string;
    /** Defensive warning if an export ever leaves a line out. */
    overflow: (count: number) => string;
  };
  /** Prints whatever the screen is showing; the browser turns it into a PDF. */
  onPrint: () => void;
}) {
  const [busy, setBusy] = useState<"excel" | "word" | null>(null);
  // The print sheet exists only while it is being printed.
  const [printing, setPrinting] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Dynamic Excel layout normally keeps this at zero. */
  const [overflow, setOverflow] = useState(0);

  /** Save through the downloads tray, which has been counting the stages. */
  const save = (blob: Blob, extension: string, trayId: string) => {
    saveBlob(blob, exportFileName(quotation, extension));
    finishDownload(trayId, blob.size);
  };

  const toExcel = async () => {
    setBusy("excel");
    setFailed(false);
    const trayId = startDownload(exportFileName(quotation, "xlsx"));
    try {
      const ExcelJS = await import("exceljs");
      reportStage(trayId, 0.2);
      // ABP's own workbook, not one drawn here. Everything about how the
      // document looks belongs to that file; this only writes the figures.
      //
      // Two files, because they are two documents: a proforma carries a buyer
      // block, a weight on every line, freight as its own total, a country of
      // origin and the bank details, and a quotation carries none of them.
      const isProforma = /proforma/i.test(quotation.title);
      const response = await fetch(
        isProforma
          ? "/templates/abp-proforma.xlsx"
          : "/templates/abp-quotation.xlsx",
      );
      if (!response.ok) throw new Error(`template ${String(response.status)}`);
      const book = new ExcelJS.Workbook();
      await book.xlsx.load(await response.arrayBuffer());
      reportStage(trayId, 0.45);
      const sheet = book.worksheets[0];
      if (sheet === undefined) throw new Error("template has no sheet");

      const layout = quotationTemplateLayout(quotation.lines.length);
      const hideSpecialDiscount =
        !isProforma && !hasSpecialLineDiscount(quotation);
      if (!isProforma) {
        if (layout.insertedRows > 0) {
          insertRowsKeepingMerges(
            sheet,
            LINES_FIRST_ROW + LINES_ROWS - 1,
            layout.insertedRows,
          );
          for (let index = 0; index < layout.insertedRows; index += 1) {
            const rowNumber = LINES_FIRST_ROW + LINES_ROWS + index;
            sheet.getRow(rowNumber).height = 22;
            sheet.getCell(`A${String(rowNumber)}`).value =
              LINES_ROWS + index + 1;
            for (const column of ["B", "H", "I", "J", "K", "L"])
              sheet.getCell(`${column}${String(rowNumber)}`).value = null;
            if (!sheet.getCell(`B${String(rowNumber)}`).isMerged)
              sheet.mergeCells(`B${String(rowNumber)}:G${String(rowNumber)}`);
          }
        }
        const visibleRows = Math.max(1, quotation.lines.length);
        for (let index = visibleRows; index < LINES_ROWS; index += 1)
          sheet.getRow(LINES_FIRST_ROW + index).hidden = true;
        sheet.pageSetup.printArea = `A1:L${String(layout.printLastRow)}`;
      }

      const fill = isProforma
        ? fillProformaTemplate(quotation, proforma)
        : fillQuotationTemplate(quotation, extra, layout);
      for (const write of fill.writes) {
        const cell = sheet.getCell(write.cell);
        cell.value = write.value;
        if (write.numberFormat !== undefined) cell.numFmt = write.numberFormat;
      }
      // Merge only after values are written. In ExcelJS a merged K cell is an
      // alias of J, so writing the empty discount into K after a merge would
      // also erase the unit price in J.
      if (hideSpecialDiscount) {
        sheet.getCell("J14").value = "Unit Price";
        sheet.getCell("K14").value = null;
        if (!sheet.getCell("J14").isMerged) sheet.mergeCells("J14:K14");
        for (let index = 0; index < layout.capacity; index += 1) {
          const rowNumber = LINES_FIRST_ROW + index;
          if (!sheet.getCell(`J${String(rowNumber)}`).isMerged)
            sheet.mergeCells(`J${String(rowNumber)}:K${String(rowNumber)}`);
        }
      }
      setOverflow(fill.overflow);
      reportStage(trayId, 0.7);
      // Eight figures and a bold, larger face do not fit the grand total's
      // box: Excel printed "###########" where the total should be.
      if (!isProforma) {
        const total = sheet.getCell(layout.totals.grandTotal);
        // Wrapping wins over shrinking in Excel, and the template wraps this
        // cell -- so the total broke across two lines instead.
        total.alignment = {
          ...total.alignment,
          wrapText: false,
          shrinkToFit: true,
        };
      }

      const buffer = await book.xlsx.writeBuffer();
      reportStage(trayId, 0.92);
      save(
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
        "xlsx",
        trayId,
      );
    } catch (error) {
      setFailed(true);
      failDownload(
        trayId,
        error instanceof Error ? error.message : "EXPORT_FAILED",
        () => {
          dismissDownload(trayId);
          void toExcel();
        },
      );
    } finally {
      setBusy(null);
    }
  };

  const toWord = async () => {
    setBusy("word");
    setFailed(false);
    const trayId = startDownload(exportFileName(quotation, "docx"));
    try {
      const {
        Document,
        Packer,
        Paragraph,
        Table,
        TableCell,
        TableRow,
        TextRun,
        WidthType,
        HeadingLevel,
        ImageRun,
      } = await import("docx");
      reportStage(trayId, 0.25);

      const body: (
        InstanceType<typeof Paragraph> | InstanceType<typeof Table>
      )[] = [];
      const lineRows: InstanceType<typeof TableRow>[] = [];

      for (const row of documentRows(quotation)) {
        if (row.kind === "TITLE") {
          body.push(
            new Paragraph({
              text: String(row.cells[0] ?? ""),
              heading: HeadingLevel.HEADING_1,
            }),
          );
          continue;
        }
        if (row.kind === "FIELD") {
          body.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${String(row.cells[0] ?? "")}: `,
                  bold: true,
                }),
                new TextRun(String(row.cells[1] ?? "")),
              ],
            }),
          );
          continue;
        }
        if (row.kind === "HEAD" || row.kind === "LINE") {
          lineRows.push(
            new TableRow({
              children: row.cells.map(
                (cell, index) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [
                          new TextRun({
                            text:
                              typeof cell === "number"
                                ? index >= 4
                                  ? money(cell)
                                  : String(cell)
                                : cell,
                            bold: row.kind === "HEAD",
                          }),
                        ],
                      }),
                    ],
                  }),
              ),
            }),
          );
          continue;
        }
        // The table is finished by the time the money rows arrive.
        if (lineRows.length > 0) {
          body.push(
            new Table({
              rows: lineRows.splice(0, lineRows.length),
              width: { size: 100, type: WidthType.PERCENTAGE },
            }),
          );
          body.push(new Paragraph(""));
        }
        if (row.kind === "MONEY") {
          const amount = row.cells[1];
          body.push(
            new Paragraph({
              children: [
                new TextRun({
                  text: `${String(row.cells[0] ?? "")}: `,
                  bold: true,
                }),
                new TextRun(typeof amount === "number" ? money(amount) : ""),
              ],
            }),
          );
          continue;
        }
        body.push(new Paragraph(String(row.cells[0] ?? "")));
      }
      if (lineRows.length > 0)
        body.push(
          new Table({
            rows: lineRows,
            width: { size: 100, type: WidthType.PERCENTAGE },
          }),
        );

      // ACROW's mark heads the Word file as it heads the other two. A logo
      // that cannot be fetched leaves the document without it rather than
      // without a document.
      reportStage(trayId, 0.6);
      const logo = await fetch("/acrow-logo.png")
        .then((response) => (response.ok ? response.arrayBuffer() : null))
        .catch(() => null);
      if (logo !== null)
        body.unshift(
          new Paragraph({
            children: [
              new ImageRun({
                type: "png",
                data: logo,
                // 522 x 125 px, at the width the workbook prints it.
                transformation: { width: 230, height: 55 },
              }),
            ],
          }),
        );
      const file = new Document({ sections: [{ children: body }] });
      reportStage(trayId, 0.85);
      save(await Packer.toBlob(file), "docx", trayId);
    } catch (error) {
      setFailed(true);
      failDownload(
        trayId,
        error instanceof Error ? error.message : "EXPORT_FAILED",
        () => {
          dismissDownload(trayId);
          void toWord();
        },
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="quotation-export">
      <button
        type="button"
        className="secondary"
        disabled={printing}
        onClick={() => {
          setPrinting(true);
        }}
      >
        {labels.pdf}
      </button>
      {printing && (
        <QuotationPrintSheet
          document={quotation}
          extra={extra}
          onReady={() => {
            // One frame for the sheet to lay out, then the printer. The
            // browser's print blocks until the dialog is closed.
            window.requestAnimationFrame(() => {
              onPrint();
              setPrinting(false);
            });
          }}
        />
      )}
      <button
        type="button"
        className="secondary"
        disabled={busy !== null}
        onClick={() => {
          void toExcel();
        }}
      >
        {busy === "excel" ? labels.working : labels.excel}
      </button>
      <button
        type="button"
        className="secondary"
        disabled={busy !== null}
        onClick={() => {
          void toWord();
        }}
      >
        {busy === "word" ? labels.working : labels.word}
      </button>
      {failed && (
        <span className="quotation-export-failed">{labels.failed}</span>
      )}
      {overflow > 0 && (
        <span className="quotation-export-failed">
          {labels.overflow(overflow)}
        </span>
      )}
    </div>
  );
}
