// Pipeline runner.
//
//   node scripts/etl/run-import.mjs --items "<path>/pvc codes.xlsx" \
//                                   --orders "<path>/customer list.xlsx"
//
// Item master first: the sales-order stage matches against it, and matching
// against a half-loaded dictionary would report false "unmatched" items.
// Add `--preview` to run everything up to (but not including) the canonical
// load — the staging report is produced, production tables are untouched.

import { COUNTRY_CATALOG } from "./lib/normalize.mjs";
import {
  ImportReport,
  closeBatch,
  connect,
  openBatch,
  readSheet,
  stageRows,
  systemUserId,
  upsertCountries,
  writeIssues,
} from "./lib/pipeline.mjs";
import * as itemMaster from "./sources/item-master.mjs";
import * as salesOrders from "./sources/sales-orders.mjs";

function arg(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : (process.argv[index + 1] ?? null);
}

async function runSource(
  db,
  source,
  filePath,
  { preview, actorUserId, shared },
) {
  const report = new ImportReport(
    `${source.importTypeCode} — ${filePath.split(/[\\/]/).pop()}`,
  );

  // INGESTION
  const { rows, missing } = await readSheet(
    filePath,
    source.sheet,
    source.columns,
  );
  report.set("Rows Read", rows.length);
  for (const header of missing) {
    report.issue({
      entity: source.entityCode,
      recordKey: "(schema)",
      rule: "COLUMN_MISSING",
      severity: "WARNING",
      message: `Expected column "${header}" is not in the sheet; the fields that depend on it are empty.`,
    });
  }

  const batch = await openBatch(db, {
    importTypeCode: source.importTypeCode,
    filePath,
    label: report.label,
    actorUserId,
  });

  // STAGING — every row persisted before anything touches production.
  await stageRows(db, batch.id, source.entityCode, rows, source.normalizeRow);
  const staged = rows.map(({ rowNo, record }) => ({
    rowNo,
    normalized: source.normalizeRow(record),
  }));

  const ctx = {
    batchId: batch.id,
    actorUserId,
    preview,
    report,
    countryCatalog: COUNTRY_CATALOG,
    upsertCountries: (countries) => upsertCountries(db, countries),
    ...shared,
  };

  // In preview the pipeline still cleans, normalizes, resolves, matches and
  // validates — it just does not write to the canonical tables. That is what
  // makes the staging report worth reading before committing.
  await db.query("BEGIN");
  try {
    await source.load(db, ctx, staged);
    await db.query(preview ? "ROLLBACK" : "COMMIT");
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }

  await writeIssues(db, batch.id, report);
  await closeBatch(db, batch.id, report, preview ? "PREVIEWED" : "COMMITTED");
  process.stdout.write(report.render(batch.jobRef));
  return { batch, report };
}

async function main() {
  const preview = process.argv.includes("--preview");
  const itemsPath = arg("items");
  const ordersPath = arg("orders");
  if (!itemsPath && !ordersPath) {
    throw new Error(
      "nothing to do: pass --items and/or --orders with a file path",
    );
  }

  const db = await connect();
  try {
    const actorUserId = await systemUserId(db);

    if (itemsPath) {
      await runSource(db, itemMaster, itemsPath, {
        preview,
        actorUserId,
        shared: {},
      });
    }

    if (ordersPath) {
      // MATCHING indexes, built once from whatever the item master now holds.
      const { rows: products } = await db.query(
        `SELECT product_id, barcode, normalized_description FROM products`,
      );
      const productIdByBarcode = new Map();
      const productIdByDescription = new Map();
      for (const product of products) {
        if (product.barcode)
          productIdByBarcode.set(product.barcode, product.product_id);
        if (
          product.normalized_description &&
          !productIdByDescription.has(product.normalized_description)
        ) {
          productIdByDescription.set(
            product.normalized_description,
            product.product_id,
          );
        }
      }
      process.stdout.write(
        `\n  Item master index: ${productIdByBarcode.size} barcodes, ${productIdByDescription.size} descriptions\n`,
      );

      await runSource(db, salesOrders, ordersPath, {
        preview,
        actorUserId,
        shared: {
          productIdByBarcode,
          productIdByDescription,
          unmatchedReported: new Set(),
          groupAccountIds: new Set(),
        },
      });
    }
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
