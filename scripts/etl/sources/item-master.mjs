// Source: ACROW item master ("pvc codes.xlsx" / sheet "Supply Demand Details ACW").
//
// This file is the product dictionary. Its Barcode column is what the sales-order
// export puts in "Ordered Item", so barcode is the join key — an exact code match
// beats fuzzy description matching, and it is the reason "AB-1220-2440-18" can be
// resolved to "ACROW Board 1220 x 2440 x 18 mm" with certainty rather than a guess.

import {
  cleanDate,
  cleanNumber,
  cleanText,
  normalizeKey,
  normalizeName,
} from "../lib/normalize.mjs";
import { classifyItem, classifyProductStatus } from "../lib/classify.mjs";
import { SOURCE_SYSTEM_ID, stableUuid } from "../lib/pipeline.mjs";

export const sheet = "Supply Demand Details ACW";
export const importTypeCode = "ITEM_MASTER";
export const entityCode = "ITEM";

export const columns = {
  subCategory: "Sub Category",
  minorCategory: "Minor Category",
  itemPrefix: "Item Prefix",
  barcode: "Barcode",
  description: "Description",
  onHandQty: "On Hand FG A",
  lastUpdateDate: "Last Update Date",
  creationDate: "Creation Date",
};

/** CLEANING + NORMALIZATION for one staged row. */
export function normalizeRow(record) {
  const barcode = normalizeKey(record.barcode);
  const description = cleanText(record.description);
  const subCategory = cleanText(record.subCategory);
  const minorCategory = cleanText(record.minorCategory);
  const itemPrefix = cleanText(record.itemPrefix);
  const onHandQty = cleanNumber(record.onHandQty);
  const lastUpdateDate = cleanDate(record.lastUpdateDate);
  const creationDate = cleanDate(record.creationDate);

  const classification = classifyItem({
    itemClassRaw: subCategory,
    description,
    orderedItem: barcode,
  });
  const status = classifyProductStatus({
    description,
    subCategory,
    minorCategory,
    onHandQty,
    lastUpdateDate,
  });

  return {
    barcode,
    description,
    normalizedDescription: normalizeName(description),
    subCategory,
    minorCategory,
    itemPrefix,
    onHandQty,
    lastUpdateDate: lastUpdateDate ? lastUpdateDate.toISOString() : null,
    creationDate: creationDate ? creationDate.toISOString() : null,
    itemClassificationCode: classification.code,
    classificationReason: classification.reason,
    productStatusCode: status.code,
    productStatusReason: status.reason,
  };
}

async function familyId(db, ctx, subCategory) {
  const code =
    (subCategory ?? "UNCLASSIFIED")
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "_")
      .slice(0, 40) || "UNCLASSIFIED";
  const cached = ctx.familyCache.get(code);
  if (cached) return cached;
  const id = stableUuid("product-family", code);
  await db.query(
    `INSERT INTO product_families (product_family_id, family_code, name, active)
     VALUES ($1,$2,$3,true)
     ON CONFLICT (family_code) DO UPDATE SET active = true
     RETURNING product_family_id`,
    [id, code, subCategory ?? "Unclassified"],
  );
  const { rows } = await db.query(
    `SELECT product_family_id FROM product_families WHERE family_code = $1`,
    [code],
  );
  ctx.familyCache.set(code, rows[0].product_family_id);
  return rows[0].product_family_id;
}

/**
 * DEDUPLICATION + LOAD. Barcode is the identity, so a barcode repeated across
 * rows produces one product, not two.
 */
export async function load(db, ctx, staged) {
  ctx.familyCache = new Map();
  const seen = new Map();

  for (const { rowNo, normalized } of staged) {
    if (!normalized.barcode) {
      ctx.report.issue({
        entity: entityCode,
        recordKey: `row:${rowNo}`,
        rule: "ITEM_BARCODE_MISSING",
        severity: "WARNING",
        message: `Row ${rowNo} has no barcode and cannot be used as a product key.`,
      });
      ctx.report.count("rows.skipped");
      continue;
    }
    if (!normalized.description) {
      ctx.report.issue({
        entity: entityCode,
        recordKey: normalized.barcode,
        rule: "ITEM_DESCRIPTION_MISSING",
        severity: "WARNING",
        message: `Item ${normalized.barcode} has no description; the barcode is shown instead.`,
      });
    }
    const existing = seen.get(normalized.barcode);
    if (existing) {
      // Keep the row with stock on hand / the later update — same item, two rows.
      ctx.report.count("items.duplicateRows");
      if ((normalized.onHandQty ?? 0) <= (existing.normalized.onHandQty ?? 0))
        continue;
    }
    seen.set(normalized.barcode, { rowNo, normalized });
  }

  ctx.report.set("Items Detected", seen.size);

  for (const [barcode, { rowNo, normalized }] of seen) {
    const productFamilyId = await familyId(db, ctx, normalized.subCategory);
    const id = stableUuid("product", barcode);
    const description = normalized.description ?? barcode;
    await db.query(
      `INSERT INTO products
         (product_id, sku_code, barcode, product_family_id, product_type_code,
          canonical_description, normalized_description,
          item_classification_code, product_status_code, item_class_raw,
          sub_category, minor_category, item_prefix, on_hand_qty,
          source_system_id, source_record_key, source_import_batch_id, source_row_no,
          record_status_code, created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'ACTIVE',$19,$19, now(), now())
       ON CONFLICT (product_id) DO UPDATE SET
         canonical_description     = EXCLUDED.canonical_description,
         normalized_description    = EXCLUDED.normalized_description,
         item_classification_code  = EXCLUDED.item_classification_code,
         product_status_code       = EXCLUDED.product_status_code,
         sub_category              = EXCLUDED.sub_category,
         minor_category            = EXCLUDED.minor_category,
         item_prefix               = EXCLUDED.item_prefix,
         on_hand_qty               = EXCLUDED.on_hand_qty,
         source_import_batch_id    = EXCLUDED.source_import_batch_id,
         source_row_no             = EXCLUDED.source_row_no,
         updated_at                = now()`,
      [
        id,
        barcode,
        barcode,
        productFamilyId,
        "STANDARD_SKU",
        description,
        normalized.normalizedDescription ?? description.toLowerCase(),
        normalized.itemClassificationCode,
        normalized.productStatusCode,
        normalized.subCategory,
        normalized.subCategory,
        normalized.minorCategory,
        normalized.itemPrefix,
        normalized.onHandQty,
        SOURCE_SYSTEM_ID,
        barcode,
        ctx.batchId,
        rowNo,
        ctx.actorUserId,
      ],
    );
    ctx.report.count(`items.${normalized.itemClassificationCode}`);
    ctx.report.count(`items.status.${normalized.productStatusCode}`);
    ctx.report.count("Products Loaded");
  }
}
