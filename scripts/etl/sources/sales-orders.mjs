// Source: ACROW sales-order line export ("customer list.xlsx" / "Sales Orders Details").
//
// Despite the file name this is NOT a customer list. It is one row per sales-order
// LINE, so the same customer and the same order repeat across many rows. Loading
// it row-for-row would produce 3,459 "customers" and 3,459 "orders". The job of
// this module is to turn that flat sheet into the relational shape the CRM needs:
//
//     Customer  ->  Sales Order  ->  Order Items
//
// Identity rules:
//   * Customer Number is the customer's identity. Two spellings of one name under
//     one number are ONE customer; the raw spellings are kept for audit.
//   * Order Number is the order's identity. One order with ten lines is one order.
//   * Ordered Item is matched to the item master by barcode. No match means the
//     line goes to review, never to an invented product.

import {
  canonicalizeName,
  cleanDate,
  cleanNumber,
  cleanText,
  normalizeCountry,
  normalizeCurrency,
  normalizeKey,
  normalizeName,
} from "../lib/normalize.mjs";
import { classifyItem, classifyRelationship } from "../lib/classify.mjs";
import {
  SOURCE_SYSTEM_CODE,
  SOURCE_SYSTEM_ID,
  stableUuid,
} from "../lib/pipeline.mjs";

export const sheet = "Sales Orders Details";
export const importTypeCode = "SALES_ORDER_HISTORY";
export const entityCode = "SALES_ORDER_LINE";

export const columns = {
  period: "Period",
  country: "Country",
  customerNumber: "Customer Number",
  customerName: "Customer Name",
  shipTo: "Ship To",
  orderSystem: "Order System",
  customerPoNumber: "Cust PO Number",
  salesChannel: "Sales Channel",
  salesRep: "Sales Rep",
  orderNumber: "Order Number",
  lineNo: "Line No",
  orderType: "Order Type",
  orderStatus: "Order Status",
  itemClass: "Item Class",
  orderedItem: "Ordered Item",
  description: "Description",
  uom: "UOM",
  itemCosting: "Item Costing",
  bookedDate: "Booked Date",
  requestDate: "Request Date",
  scheduleShipDate: "Schedule Ship Date",
  actualShipmentDate: "Actual Shipment Date",
  lineStatus: "Line Status",
  remainingQty: "SO Remaining Qty",
  shippedQty: "Shipped Qty",
  cancelledQty: "Cancelled Qty",
  lineAmount: "So Line Amount",
  lineAmountEgp: "SO Line Amount EGP",
  unitSellingPrice: "Unit Selling Price",
  unitListPrice: "Unit List Price",
  currency: "Currency",
  fxRate: "Rate",
  unitWeightKg: "Unit Weight (Kg)",
  calculatedWeightKg: "Calculated Weight (Kg)",
  shipStatus: "Ship Status",
  salesType: "Sales Type",
  abpOrderType: "Abp Order Type",
  invoiced: "Invoiced",
};

const ORDER_STATUSES = new Set([
  "BOOKED",
  "CLOSED",
  "CANCELLED",
  "ENTERED",
  "AWAITING_SHIPPING",
]);

function toIso(date) {
  return date ? date.toISOString().slice(0, 10) : null;
}

/** CLEANING + NORMALIZATION for one staged row. */
export function normalizeRow(record) {
  const customerNumber = normalizeKey(record.customerNumber);
  const rawName = cleanText(record.customerName);
  const country = normalizeCountry(record.country);
  const orderNumber = normalizeKey(record.orderNumber);
  const lineNoRaw = cleanText(record.lineNo);
  const orderedItem = normalizeKey(record.orderedItem);
  const description = cleanText(record.description);
  const itemClass = cleanText(record.itemClass);

  // The export has no "ordered quantity" column. It splits the ordered quantity
  // across what shipped, what is still open, and what was cancelled — so the
  // ordered quantity is their sum, and each part is kept separately as well.
  const shippedQty = Math.max(0, cleanNumber(record.shippedQty) ?? 0);
  const remainingQty = Math.max(0, cleanNumber(record.remainingQty) ?? 0);
  const cancelledQty = Math.max(0, cleanNumber(record.cancelledQty) ?? 0);
  const orderedQty = shippedQty + remainingQty + cancelledQty;

  const classification = classifyItem({
    itemClassRaw: itemClass,
    description,
    orderedItem,
  });
  const statusRaw = (cleanText(record.orderStatus) ?? "")
    .toUpperCase()
    .replace(/\s+/g, "_");

  return {
    customerNumber,
    rawName,
    canonicalName: canonicalizeName(rawName),
    normalizedName: normalizeName(rawName),
    countryCode: country?.code ?? null,
    countryName: country?.name ?? null,
    countryRaw: cleanText(record.country),
    orderNumber,
    lineNoRaw,
    lineNo: Math.trunc(cleanNumber(lineNoRaw) ?? 0) || null,
    orderStatusCode: ORDER_STATUSES.has(statusRaw) ? statusRaw : "UNKNOWN",
    orderStatusRaw: cleanText(record.orderStatus),
    orderTypeRaw: cleanText(record.orderType),
    orderSystem: cleanText(record.orderSystem),
    period: cleanText(record.period),
    shipTo: cleanText(record.shipTo),
    salesRep: cleanText(record.salesRep),
    salesChannel: cleanText(record.salesChannel),
    customerPoNumber: cleanText(record.customerPoNumber),
    orderedItem,
    description,
    itemClass,
    itemCosting: cleanText(record.itemCosting),
    itemClassificationCode: classification.code,
    classificationReason: classification.reason,
    uom: cleanText(record.uom),
    lineStatusRaw: cleanText(record.lineStatus),
    orderedQty,
    shippedQty,
    remainingQty,
    cancelledQty,
    lineAmount: cleanNumber(record.lineAmount),
    lineAmountEgp: cleanNumber(record.lineAmountEgp),
    unitSellingPrice: cleanNumber(record.unitSellingPrice),
    unitListPrice: cleanNumber(record.unitListPrice),
    currencyCode: normalizeCurrency(record.currency),
    fxRate: cleanNumber(record.fxRate),
    unitWeightKg: cleanNumber(record.unitWeightKg),
    calculatedWeightKg: cleanNumber(record.calculatedWeightKg),
    bookedDate: toIso(cleanDate(record.bookedDate)),
    requestDate: toIso(cleanDate(record.requestDate)),
    scheduleShipDate: toIso(cleanDate(record.scheduleShipDate)),
    actualShipmentDate: toIso(cleanDate(record.actualShipmentDate)),
    // The column does not hold yes/no. Its values are "Invoiced", "No" and
    // "Interfaced" - and "Interfaced" means handed to the ERP interface, not
    // billed, so it is not counted as invoiced.
    invoiced: /^invoiced$/i.test(cleanText(record.invoiced) ?? ""),
  };
}

// --------------------------------------------------------------------- LOAD

export async function load(db, ctx, staged) {
  const { customers, orders, lines, countries } = resolve(ctx, staged);

  ctx.report.set("Rows Read", staged.length);
  ctx.report.set("Customers Detected", customers.size);
  ctx.report.set("Countries Detected", countries.size);
  ctx.report.set("Sales Orders Detected", orders.size);
  ctx.report.set("Order Items Detected", lines.length);

  await ctx.upsertCountries([...countries.values()]);
  const accountIdByCustomer = await loadCustomers(db, ctx, customers);
  await loadOrders(db, ctx, orders, accountIdByCustomer);
  await loadLines(db, ctx, lines);
  await rollUpOrderAmounts(db, ctx);
  ctx.report.set("Unmatched Distinct Items", ctx.unmatchedReported.size);
}

// -------------------------------------- ENTITY RESOLUTION + DEDUPLICATION --

function resolve(ctx, staged) {
  const customers = new Map(); // customerNumber -> customer aggregate
  const orders = new Map(); // orderNumber    -> order aggregate
  const countries = new Map(); // code           -> country
  const lines = [];

  for (const { rowNo, normalized: row } of staged) {
    // VALIDATION — a row without its two identity keys cannot be placed.
    if (!row.customerNumber) {
      ctx.report.issue({
        entity: entityCode,
        recordKey: `row:${rowNo}`,
        rule: "CUSTOMER_NUMBER_MISSING",
        severity: "REVIEW_REQUIRED",
        message: `Row ${rowNo} has no customer number, so it cannot be attached to a customer.`,
      });
      ctx.report.count("rows.rejected");
      continue;
    }
    if (!row.orderNumber) {
      ctx.report.issue({
        entity: entityCode,
        recordKey: `row:${rowNo}`,
        rule: "ORDER_NUMBER_MISSING",
        severity: "REVIEW_REQUIRED",
        message: `Row ${rowNo} (customer ${row.customerNumber}) has no order number.`,
      });
      ctx.report.count("rows.rejected");
      continue;
    }

    let countryCode = row.countryCode;
    if (!countryCode) {
      countryCode = "ZZ";
      ctx.report.issue({
        entity: "ACCOUNT",
        recordKey: row.customerNumber,
        rule: "COUNTRY_UNRESOLVED",
        severity: "WARNING",
        message: `Country "${row.countryRaw ?? "(empty)"}" on row ${rowNo} is not a known country; parked as Unknown.`,
      });
      ctx.report.count("rows.unknownCountry");
    }
    const country = ctx.countryCatalog.get(countryCode);
    if (country) countries.set(countryCode, country);

    // --- customer aggregate -------------------------------------------------
    let customer = customers.get(row.customerNumber);
    if (!customer) {
      customer = {
        customerNumber: row.customerNumber,
        nameVotes: new Map(),
        countryVotes: new Map(),
        currencyVotes: new Map(),
        firstRowNo: rowNo,
      };
      customers.set(row.customerNumber, customer);
    }
    if (row.rawName)
      customer.nameVotes.set(
        row.rawName,
        (customer.nameVotes.get(row.rawName) ?? 0) + 1,
      );
    customer.countryVotes.set(
      countryCode,
      (customer.countryVotes.get(countryCode) ?? 0) + 1,
    );
    if (row.currencyCode) {
      customer.currencyVotes.set(
        row.currencyCode,
        (customer.currencyVotes.get(row.currencyCode) ?? 0) + 1,
      );
    }

    // --- order aggregate ----------------------------------------------------
    let order = orders.get(row.orderNumber);
    if (!order) {
      order = {
        orderNumber: row.orderNumber,
        customerNumber: row.customerNumber,
        countryCode,
        orderDate: row.bookedDate,
        statusRaw: row.orderStatusRaw,
        statusCode: row.orderStatusCode,
        currencyCode: row.currencyCode,
        orderTypeRaw: row.orderTypeRaw,
        orderSystem: row.orderSystem,
        period: row.period,
        shipTo: row.shipTo,
        salesRep: row.salesRep,
        salesChannel: row.salesChannel,
        customerPoNumber: row.customerPoNumber,
        customerNameRaw: row.rawName,
        rowNo,
        lineCount: 0,
        totalAmount: 0,
        totalAmountEgp: 0,
        lineKeys: new Set(),
      };
      orders.set(row.orderNumber, order);
    } else if (order.customerNumber !== row.customerNumber) {
      ctx.report.issue({
        entity: "ERP_ORDER",
        recordKey: row.orderNumber,
        rule: "ORDER_CUSTOMER_CONFLICT",
        severity: "REVIEW_REQUIRED",
        message: `Order ${row.orderNumber} appears under customer ${order.customerNumber} and ${row.customerNumber}; the first was kept.`,
      });
    }
    // Earliest booked date wins as the order date.
    if (
      row.bookedDate &&
      (!order.orderDate || row.bookedDate < order.orderDate)
    )
      order.orderDate = row.bookedDate;
    if (!order.salesRep && row.salesRep) order.salesRep = row.salesRep;
    if (!order.customerPoNumber && row.customerPoNumber)
      order.customerPoNumber = row.customerPoNumber;

    // --- order line ---------------------------------------------------------
    const lineKey = row.lineNoRaw ?? `r${rowNo}`;
    let sourceLineKey = lineKey;
    if (order.lineKeys.has(sourceLineKey)) {
      // Same line number twice in one order: keep both, disambiguated by row,
      // and say so rather than dropping revenue on the floor.
      sourceLineKey = `${lineKey}#${rowNo}`;
      ctx.report.issue({
        entity: entityCode,
        recordKey: `${row.orderNumber}/${lineKey}`,
        rule: "DUPLICATE_LINE_NUMBER",
        severity: "WARNING",
        message: `Order ${row.orderNumber} has line ${lineKey} more than once; row ${rowNo} kept as ${sourceLineKey}.`,
      });
      ctx.report.count("lines.duplicateLineNo");
    }
    order.lineKeys.add(sourceLineKey);
    order.lineCount += 1;
    order.totalAmount += row.lineAmount ?? 0;
    order.totalAmountEgp += row.lineAmountEgp ?? 0;

    lines.push({ rowNo, sourceLineKey, row });
  }

  // Entity-resolution report: how many customers arrived under more than one
  // spelling. That number is the whole reason this stage exists.
  let multiSpelling = 0;
  for (const customer of customers.values()) {
    const distinct = new Set(
      [...customer.nameVotes.keys()].map((name) => normalizeName(name)),
    );
    if (distinct.size > 1) {
      multiSpelling += 1;
      ctx.report.issue({
        entity: "ACCOUNT",
        recordKey: customer.customerNumber,
        rule: "NAME_VARIANTS_MERGED",
        severity: "WARNING",
        message: `Customer ${customer.customerNumber} appears as: ${[...customer.nameVotes.keys()].join(" | ")}. Merged into one customer.`,
      });
    }
  }
  ctx.report.set("Customers With Name Variants", multiSpelling);

  return { customers, orders, lines, countries };
}

function topVote(votes, fallback = null) {
  let best = fallback;
  let bestCount = -1;
  for (const [value, count] of votes) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return best;
}

async function loadCustomers(db, ctx, customers) {
  const accountIdByCustomer = new Map();
  for (const customer of customers.values()) {
    const rawName = topVote(customer.nameVotes, null);
    const displayName =
      canonicalizeName(rawName) ?? `Customer ${customer.customerNumber}`;
    const normalized =
      normalizeName(rawName) ?? `customer ${customer.customerNumber}`;
    const countryCode = topVote(customer.countryVotes, "ZZ");
    const currencyCode = topVote(customer.currencyVotes, null);
    const relationship = classifyRelationship({
      customerNumber: customer.customerNumber,
      name: rawName,
    });
    const id = stableUuid("account", customer.customerNumber);

    if (relationship.code === "GROUP_AFFILIATE") {
      ctx.groupAccountIds.add(id);
      ctx.report.count("Group Companies");
      ctx.report.issue({
        entity: "ACCOUNT",
        recordKey: customer.customerNumber,
        rule: "GROUP_AFFILIATE_DETECTED",
        severity: "WARNING",
        message: `${displayName} classified as an ACROW group company (${relationship.reason}). Its orders count as intercompany, not external sales.`,
      });
    }

    await db.query(
      `INSERT INTO accounts
         (account_id, customer_number, raw_name, canonical_name, normalized_name,
          country_code, hq_country_code, account_category_code, relationship_type_code,
          group_parent_name, owner_user_id, default_currency_code,
          source_system_id, source_record_key, source_import_batch_id, source_row_no,
          record_status_code, created_by_user_id, updated_by_user_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$6,$7,$8,$9,$10,$11,$12,$2,$13,$14,'ACTIVE',$10,$10, now(), now())
       ON CONFLICT (account_id) DO UPDATE SET
         raw_name               = EXCLUDED.raw_name,
         canonical_name         = EXCLUDED.canonical_name,
         normalized_name        = EXCLUDED.normalized_name,
         country_code           = EXCLUDED.country_code,
         hq_country_code        = EXCLUDED.hq_country_code,
         relationship_type_code = EXCLUDED.relationship_type_code,
         group_parent_name      = EXCLUDED.group_parent_name,
         default_currency_code  = EXCLUDED.default_currency_code,
         source_import_batch_id = EXCLUDED.source_import_batch_id,
         source_row_no          = EXCLUDED.source_row_no,
         updated_at             = now()`,
      [
        id,
        customer.customerNumber,
        rawName,
        displayName,
        normalized,
        countryCode,
        relationship.code === "GROUP_AFFILIATE" ? "ACROW" : "OTHER",
        relationship.code,
        relationship.groupParentName,
        ctx.actorUserId,
        currencyCode,
        SOURCE_SYSTEM_ID,
        ctx.batchId,
        customer.firstRowNo,
      ],
    );
    accountIdByCustomer.set(customer.customerNumber, id);
    ctx.report.count("Customers Loaded");
  }
  return accountIdByCustomer;
}

async function loadOrders(db, ctx, orders, accountIdByCustomer) {
  for (const order of orders.values()) {
    const accountId = accountIdByCustomer.get(order.customerNumber) ?? null;
    const id = stableUuid("erp-order", order.orderNumber);
    const isIntercompany = ctx.groupAccountIds.has(accountId);
    await db.query(
      `INSERT INTO erp_orders
         (erp_order_id, source_system_code, source_order_key, source_system_id,
          source_sales_order_id, country_code, order_date, status_raw, status_code,
          total_amount, total_amount_egp, currency_code, account_id, import_batch_id,
          order_number_raw, customer_number_raw, customer_name_raw, ship_to_raw,
          sales_rep, sales_channel, customer_po_number, order_type_raw, order_system,
          period_raw, line_count, is_intercompany, source_row_no, dq_status_code, imported_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
               $21,$22,$23,$24,$25,$26,$27,'VALID', now())
       ON CONFLICT (erp_order_id) DO UPDATE SET
         country_code       = EXCLUDED.country_code,
         order_date         = EXCLUDED.order_date,
         status_raw         = EXCLUDED.status_raw,
         status_code        = EXCLUDED.status_code,
         total_amount       = EXCLUDED.total_amount,
         total_amount_egp   = EXCLUDED.total_amount_egp,
         currency_code      = EXCLUDED.currency_code,
         account_id         = EXCLUDED.account_id,
         import_batch_id    = EXCLUDED.import_batch_id,
         line_count         = EXCLUDED.line_count,
         is_intercompany    = EXCLUDED.is_intercompany,
         sales_rep          = EXCLUDED.sales_rep,
         customer_po_number = EXCLUDED.customer_po_number`,
      [
        id,
        SOURCE_SYSTEM_CODE,
        order.orderNumber,
        SOURCE_SYSTEM_ID,
        stableUuid("erp-sales-order", order.orderNumber),
        order.countryCode,
        order.orderDate,
        order.statusRaw,
        order.statusCode,
        order.totalAmount,
        order.totalAmountEgp,
        order.currencyCode,
        accountId,
        ctx.batchId,
        order.orderNumber,
        order.customerNumber,
        order.customerNameRaw,
        order.shipTo,
        order.salesRep,
        order.salesChannel,
        order.customerPoNumber,
        order.orderTypeRaw,
        order.orderSystem,
        order.period,
        order.lineCount,
        isIntercompany,
        order.rowNo,
      ],
    );
    ctx.report.count("Sales Orders Loaded");
    if (isIntercompany) ctx.report.count("Intercompany Orders");
    if (!order.orderDate) {
      ctx.report.issue({
        entity: "ERP_ORDER",
        recordKey: order.orderNumber,
        rule: "ORDER_DATE_MISSING",
        severity: "WARNING",
        message: `Order ${order.orderNumber} has no booked date; it will not appear on any period report.`,
      });
    }
  }
}

// ------------------------------------------------------------------ MATCHING

async function loadLines(db, ctx, lines) {
  const chunk = 200;
  for (let start = 0; start < lines.length; start += chunk) {
    await Promise.all(
      lines.slice(start, start + chunk).map((line) => loadLine(db, ctx, line)),
    );
  }
}

async function loadLine(db, ctx, { rowNo, sourceLineKey, row }) {
  const erpOrderId = stableUuid("erp-order", row.orderNumber);

  // Barcode first: an exact code match is certain. Only if the code is absent
  // from the item master do we fall back to the normalized description, and a
  // description match is recorded as a weaker match so a reviewer can see it.
  let productId = null;
  let matchStatusCode = "UNMATCHED";
  if (row.orderedItem && ctx.productIdByBarcode.has(row.orderedItem)) {
    productId = ctx.productIdByBarcode.get(row.orderedItem);
    matchStatusCode = "MATCHED_BARCODE";
  } else if (row.description) {
    const key = normalizeName(row.description);
    if (key && ctx.productIdByDescription.has(key)) {
      productId = ctx.productIdByDescription.get(key);
      matchStatusCode = "MATCHED_DESCRIPTION";
    }
  }

  if (matchStatusCode === "UNMATCHED") {
    ctx.report.count("Unmatched Items");
    if (!ctx.unmatchedReported.has(row.orderedItem ?? `row:${rowNo}`)) {
      ctx.unmatchedReported.add(row.orderedItem ?? `row:${rowNo}`);
      // Non-products are expected to be unmatched — a transportation charge is
      // not in the item master and should not be created as one.
      const expected = row.itemClassificationCode !== "SELLABLE_PRODUCT";
      ctx.report.issue({
        entity: "PRODUCT",
        recordKey: row.orderedItem ?? `row:${rowNo}`,
        rule: expected ? "NON_PRODUCT_ITEM" : "ITEM_NOT_IN_MASTER",
        severity: expected ? "WARNING" : "REVIEW_REQUIRED",
        message: expected
          ? `"${row.description ?? row.orderedItem}" is classified ${row.itemClassificationCode}, so it is not expected in the item master.`
          : `Ordered item ${row.orderedItem} ("${row.description ?? ""}") is not in the item master. Choose: map to an existing item, create a new product, classify as a service, or ignore.`,
      });
    }
  } else {
    ctx.report.count(
      `Matched ${matchStatusCode === "MATCHED_BARCODE" ? "By Barcode" : "By Description"}`,
    );
  }

  await db.query(
    `INSERT INTO erp_order_lines
       (erp_order_line_id, erp_order_id, source_line_key, product_id, line_no,
        ordered_item_raw, item_description_raw, uom_code,
        qty_booked, qty_shipped, qty_invoiced, qty_remaining,
        unit_selling_price, unit_list_price, line_amount, line_amount_egp,
        currency_code, fx_rate, line_status_raw, item_class_raw,
        item_classification_code, match_status_code,
        booked_date, request_date, schedule_ship_date, actual_shipment_date,
        unit_weight_kg, calculated_weight_kg,
        source_import_batch_id, source_row_no, dq_status_code)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
             $21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31)
     ON CONFLICT (erp_order_id, source_line_key) DO UPDATE SET
       product_id               = EXCLUDED.product_id,
       qty_booked               = EXCLUDED.qty_booked,
       qty_shipped              = EXCLUDED.qty_shipped,
       qty_invoiced             = EXCLUDED.qty_invoiced,
       qty_remaining            = EXCLUDED.qty_remaining,
       unit_selling_price       = EXCLUDED.unit_selling_price,
       currency_code            = EXCLUDED.currency_code,
       line_status_raw          = EXCLUDED.line_status_raw,
       line_amount              = EXCLUDED.line_amount,
       line_amount_egp          = EXCLUDED.line_amount_egp,
       item_classification_code = EXCLUDED.item_classification_code,
       match_status_code        = EXCLUDED.match_status_code,
       source_import_batch_id   = EXCLUDED.source_import_batch_id`,
    [
      stableUuid("erp-order-line", `${row.orderNumber}::${sourceLineKey}`),
      erpOrderId,
      sourceLineKey,
      productId,
      row.lineNo,
      row.orderedItem,
      row.description,
      row.uom,
      row.orderedQty,
      row.shippedQty,
      row.invoiced ? row.shippedQty : 0,
      row.remainingQty,
      row.unitSellingPrice,
      row.unitListPrice,
      row.lineAmount,
      row.lineAmountEgp,
      row.currencyCode,
      row.fxRate,
      row.lineStatusRaw,
      row.itemClass,
      row.itemClassificationCode,
      matchStatusCode,
      row.bookedDate,
      row.requestDate,
      row.scheduleShipDate,
      row.actualShipmentDate,
      row.unitWeightKg,
      row.calculatedWeightKg,
      ctx.batchId,
      rowNo,
      matchStatusCode === "UNMATCHED" &&
      row.itemClassificationCode === "SELLABLE_PRODUCT"
        ? "REVIEW"
        : "VALID",
    ],
  );
  ctx.report.count("Order Items Loaded");
  ctx.report.count(`items.${row.itemClassificationCode}`);
}

/**
 * Booked / shipped / invoiced totals on the order header.
 *
 * The export has no such totals; it has line amounts and per-line quantities.
 * Booked is the sum of the line amounts. Shipped and invoiced are the same
 * amounts apportioned by quantity, which is an estimate and is stated as one —
 * the source does not record what was actually billed per line. All three are
 * in EGP, the one currency every order in this file shares.
 */
async function rollUpOrderAmounts(db, ctx) {
  const { rowCount } = await db.query(
    `
    UPDATE erp_orders o
       SET booked_amount   = t.booked,
           shipped_amount  = t.shipped,
           invoiced_amount = t.invoiced
      FROM (
        SELECT l.erp_order_id,
               COALESCE(SUM(l.line_amount_egp), 0) AS booked,
               COALESCE(SUM(l.line_amount_egp
                 * CASE WHEN l.qty_booked > 0
                        THEN LEAST(l.qty_shipped / l.qty_booked, 1) ELSE 0 END), 0) AS shipped,
               COALESCE(SUM(l.line_amount_egp
                 * CASE WHEN l.qty_booked > 0
                        THEN LEAST(l.qty_invoiced / l.qty_booked, 1) ELSE 0 END), 0) AS invoiced
          FROM erp_order_lines l
         WHERE l.source_import_batch_id = $1
         GROUP BY l.erp_order_id
      ) t
     WHERE o.erp_order_id = t.erp_order_id`,
    [ctx.batchId],
  );
  ctx.report.set("Order Totals Rolled Up", rowCount ?? 0);
}
