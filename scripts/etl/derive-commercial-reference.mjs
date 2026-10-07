// Post-import step: the reference data a quotation cannot be sent without.
//
// Preparing a quotation for approval blocks on two things that the demo purge
// removed and the ERP import does not carry:
//
//   PAYMENT_TERMS_REQUIRED  - no payment terms are configured
//   PRICING_RULE_REQUIRED   - the product on the line has no price band
//
// Payment terms are a business decision, so only the standard set is seeded and
// it is meant to be edited.
//
// Pricing bands are NOT invented. They are derived from what ACROW actually
// charged: the unit selling prices on 2,336 historical order lines. The
// reference price is the median (robust against a handful of odd deals), and
// the band is the 10th to 90th percentile, so a salesperson quoting inside it
// is quoting what the company has really sold at.
//
// Products that were never sold get no rule. That is deliberate: a made-up
// price band is worse than an explicit "this has never been priced".

import { connect, stableUuid } from "./lib/pipeline.mjs";

const PAYMENT_TERMS = [
  ["CASH_IN_ADVANCE", "100% in advance before production."],
  ["ADVANCE_50_BALANCE_ON_DELIVERY", "50% advance, 50% on delivery."],
  ["NET_30", "Net 30 days from invoice date."],
  ["NET_60", "Net 60 days from invoice date."],
  ["NET_90", "Net 90 days from invoice date."],
  ["LC_AT_SIGHT", "Irrevocable letter of credit at sight."],
  // The terms on ABP's issued quotations (see migration
  // 20260927120000_payment_terms_abp_issues), so a fresh install has them too.
  [
    "ADVANCE_30_35_35",
    "30% in advance, 35% after 30 days from the delivery date, and the remaining 35% after 60 days from the delivery date.",
  ],
  ["ADVANCE_50_BALANCE_BEFORE_DELIVERY", "50% advance, 50% before delivery."],
  ["ADVANCE_25_BALANCE_ON_DELIVERY", "25% advance, 75% on delivery."],
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const db = await connect();
  try {
    const { rows: users } = await db.query(
      `SELECT id FROM app_users ORDER BY (email_normalized = 'admin@abp.local') DESC, created_at LIMIT 1`,
    );
    const actor = users[0]?.id;
    if (!actor) throw new Error("no app_users row to own the seeded rows");

    // ------------------------------------------------------ payment terms --
    let termsAdded = 0;
    for (const [code, text] of PAYMENT_TERMS) {
      const result = await db.query(
        `INSERT INTO payment_terms
           (payment_term_id, term_code, display_text, effective_from, is_active, created_by_user_id)
         VALUES ($1, $2, $3, timestamptz '2020-01-01', true, $4)
         ON CONFLICT (term_code, effective_from) DO NOTHING`,
        [stableUuid("payment-term", code), code, text, actor],
      );
      termsAdded += result.rowCount ?? 0;
    }

    // ------------------------------------------------------ pricing bands --
    // One band per product and currency, from that product's own sales history.
    const { rows: bands } = await db.query(`
      SELECT l.product_id,
             upper(btrim(l.currency_code)) AS currency_code,
             count(*)::int AS samples,
             percentile_cont(0.10) WITHIN GROUP (ORDER BY l.unit_selling_price) AS p10,
             percentile_cont(0.50) WITHIN GROUP (ORDER BY l.unit_selling_price) AS median,
             percentile_cont(0.90) WITHIN GROUP (ORDER BY l.unit_selling_price) AS p90
        FROM erp_order_lines l
       WHERE l.product_id IS NOT NULL
         AND l.unit_selling_price > 0
         AND l.currency_code IS NOT NULL
         AND l.item_classification_code = 'SELLABLE_PRODUCT'
       GROUP BY l.product_id, upper(btrim(l.currency_code))`);

    process.stdout.write(
      `  payment terms added      ${String(termsAdded)}\n` +
        `  price bands derivable    ${String(bands.length)}\n`,
    );
    if (dryRun) {
      process.stdout.write("  --dry-run: nothing written.\n");
      return;
    }

    let written = 0;
    for (const band of bands) {
      // A single historical sale gives a median but no spread. Widening it by
      // +/-15% is stated as an assumption rather than pretending to precision
      // the data does not have.
      const median = Number(band.median);
      const low = band.samples > 2 ? Number(band.p10) : median * 0.85;
      const high = band.samples > 2 ? Number(band.p90) : median * 1.15;
      await db.query(
        `INSERT INTO pricing_rules
           (pricing_rule_id, product_id, country_code, currency_code,
            min_price, reference_price, max_price,
            effective_from, source_code, status_code, version)
         VALUES ($1, $2, NULL, $3, $4, $5, $6, timestamptz '2020-01-01',
                 'DERIVED_FROM_SALES_HISTORY', 'ACTIVE', 1)
         ON CONFLICT (pricing_rule_id) DO UPDATE SET
           min_price       = EXCLUDED.min_price,
           reference_price = EXCLUDED.reference_price,
           max_price       = EXCLUDED.max_price,
           status_code     = 'ACTIVE'`,
        [
          stableUuid(
            "pricing-rule",
            `${band.product_id}::${band.currency_code}`,
          ),
          band.product_id,
          band.currency_code,
          low.toFixed(4),
          median.toFixed(4),
          high.toFixed(4),
        ],
      );
      written += 1;
    }
    process.stdout.write(`  price bands written      ${String(written)}\n`);

    const { rows: priced } = await db.query(
      `SELECT count(DISTINCT product_id)::int AS n FROM pricing_rules WHERE status_code = 'ACTIVE'`,
    );
    const { rows: total } = await db.query(
      `SELECT count(*)::int AS n FROM products WHERE record_status_code = 'ACTIVE'`,
    );
    process.stdout.write(
      `  products with a price    ${String(priced[0].n)} of ${String(total[0].n)}\n` +
        `  (the rest have never been sold, so they have no historical price)\n`,
    );
  } finally {
    await db.end();
  }
}

main().catch((error) => {
  process.stderr.write(`${String(error?.stack ?? error)}\n`);
  process.exitCode = 1;
});
