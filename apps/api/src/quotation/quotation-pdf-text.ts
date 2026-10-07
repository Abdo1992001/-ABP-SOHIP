/* eslint-disable @typescript-eslint/consistent-type-imports */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * Turning a quotation PDF into the text `quotation-pdf.ts` reads.
 *
 * Kept apart from the parsing rules for one reason: the rules are worth
 * testing against the exact strings real documents produce, and a test that
 * has to carry a PDF binary to do it is a test nobody updates. Text in, text
 * out, and the parser never learns what a PDF is.
 *
 * pdf.js reports each page as positioned text items, not as lines. Joining
 * them needs the geometry: items on the same baseline belong on one line, and
 * a visible gap between two items on that baseline is a column boundary that
 * has to survive as whitespace. Losing it is what glues a quantity onto the
 * end of a description — `WITHOUT TIE ROD HOLES40` — which the parser then has
 * to recover by arithmetic.
 */

export class QuotationPdfProblem extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

/** A page's worth of items, before they are assembled into lines. */
interface TextItem {
  str: string;
  transform: number[];
  width: number;
}

/** Same vertical position within this much is the same line. */
const LINE_TOLERANCE = 2;
/** A horizontal gap wider than this is a column boundary, not a word space. */
const COLUMN_GAP = 1.5;

export async function extractQuotationPdfText(buffer: Buffer): Promise<string> {
  if (buffer.length < 5) throw new QuotationPdfProblem("PDF_EMPTY");
  // "%PDF-" — refuse anything else before handing it to a parser.
  if (buffer.subarray(0, 5).toString("latin1") !== "%PDF-")
    throw new QuotationPdfProblem("PDF_SIGNATURE_INVALID");

  // `require.resolve` hands back a filesystem path, and on Windows `import()`
  // rejects `C:\...` as an unsupported URL scheme — it has to be a file:// URL.
  const require = createRequire(import.meta.url);
  const pdfjs = (await import(
    pathToFileURL(require.resolve("pdfjs-dist/legacy/build/pdf.mjs")).href
  )) as typeof import("pdfjs-dist/legacy/build/pdf.mjs");

  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    // These documents are read for their numbers, never rendered, and they
    // arrive from outside. Nothing in them should be able to fetch, evaluate
    // or reach the host's fonts.
    isEvalSupported: false,
    useSystemFonts: false,
    useWorkerFetch: false,
    disableFontFace: true,
  });

  let document;
  try {
    document = await task.promise;
  } catch {
    throw new QuotationPdfProblem("PDF_UNREADABLE");
  }

  try {
    const pages: string[] = [];
    for (let number = 1; number <= document.numPages; number += 1) {
      const page = await document.getPage(number);
      const content = await page.getTextContent();
      pages.push(assembleLines(content.items as unknown as TextItem[]));
      page.cleanup();
    }
    return pages.join("\n");
  } finally {
    await document.destroy();
  }
}

function assembleLines(items: TextItem[]): string {
  const rows = new Map<number, TextItem[]>();
  for (const item of items) {
    if (typeof item.str !== "string" || item.str === "") continue;
    const y = item.transform[5] ?? 0;
    // Bucket by baseline, allowing for the sub-pixel drift that makes two
    // items on the same printed line report different y values.
    let key: number | null = null;
    for (const existing of rows.keys())
      if (Math.abs(existing - y) <= LINE_TOLERANCE) {
        key = existing;
        break;
      }
    const bucket = rows.get(key ?? y);
    if (bucket === undefined) rows.set(y, [item]);
    else bucket.push(item);
  }

  return (
    [...rows.entries()]
      // Top of the page first: PDF y grows upward.
      .sort((left, right) => right[0] - left[0])
      .map(([, row]) => {
        const ordered = [...row].sort(
          (left, right) => (left.transform[4] ?? 0) - (right.transform[4] ?? 0),
        );
        let line = "";
        let cursor: number | null = null;
        for (const item of ordered) {
          const x = item.transform[4] ?? 0;
          if (cursor !== null && x - cursor > COLUMN_GAP && !line.endsWith(" "))
            line += " ";
          line += item.str;
          cursor = x + item.width;
        }
        return line.trim();
      })
      .filter((line) => line !== "")
      .join("\n")
  );
}
