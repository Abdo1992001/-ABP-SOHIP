# Legacy quotation commercial-data staging

Status: `DISCOVERY INPUT — IMPORT MAPPING READY; NOT YET LOADED`  
Captured: 2026-08-21  
Source application: `<workspace>\Apps\Final ABP Quotation`

## Authoritative source spreadsheets supplied for the implementation

| File                             | Role in the system      | Treatment                                                                                                                                        |
| -------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<workspace>\pvc codes.xlsx`     | Product Master          | Import to the canonical Product Catalog after DQ validation. It contains 2,914 distinct Barcodes/SKUs in the supplied extract.                   |
| `<workspace>\customer list.xlsx` | ERP Sales-Order history | Import as read-only ERP facts. Its customer identity fields can reconcile customer master records, but it must not create internal Sales Orders. |

### Product import mapping

| Spreadsheet column                  | Canonical target                   | Rule                                                                                        |
| ----------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------- |
| `Barcode`                           | `products.sku` / source record key | Required, trimmed, unique within the import run.                                            |
| `Description`                       | `products.name`                    | Required, preserve raw source value and derive normalized search value server-side.         |
| `Minor Category`                    | `products.product_type_code`       | Source-controlled value; no client-created type.                                            |
| `Sub Category`                      | `products.category_code`           | Source-controlled value.                                                                    |
| `Item Prefix`                       | import source metadata             | Preserve in source lineage; it is not a substitute for SKU.                                 |
| `On Hand FG A`                      | inventory source fact              | Not product-master truth and not quotation availability until an inventory contract exists. |
| `Last Update Date`, `Creation Date` | source timestamps                  | Preserve as source evidence after date-format validation.                                   |

### Product-source DQ snapshot

The supplied workbook contains 2,915 non-empty rows. One repeated header row
(`Barcode` / `Description` / category labels) must be rejected by the import
parser. The remaining 2,914 records have a non-empty unique Barcode and a
non-empty Description. This is a source DQ observation, not a completed import
run.

### ERP history mapping boundary

`Customer Number`, `Customer Name`, `Country`, `Ordered Item`, `Order Number`,
line numbers, quantities, currencies, exchange rates, prices and invoice/ship
fields are ERP-source facts. They will be imported idempotently with source
lineage and DQ/reconciliation; they do not authorize internal order creation,
shipment/POD workflows, or a current quotation price.

## Scope boundary

This file extracts only commercial vocabulary and candidate calculation inputs from
the legacy quotation application. It does **not** import or approve its UI,
local-storage model, quotation revision behavior, transport/shipment behavior,
PDF/Excel/Word outputs, document templates, or hard-coded defaults.

The current SSOT remains authoritative: a draft quotation is edited in place;
after `SENT`, a changed quotation is a new quotation linked by
`supersedes_quotation_id`. Document formats will be designed later as templates.

## Product vocabulary found

| Legacy key | Commercial label        | Candidate pricing basis   | Candidate item inputs                                                                  | Evidence                                                                  |
| ---------- | ----------------------- | ------------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `linear`   | M Board / Linear        | Sheet / area-derived      | thickness, length, width, quantity                                                     | `src/services/admin-manager.js`, `src/core/pricing/pricing-calculator.js` |
| `curved`   | M Board Curved / Curved | Weight                    | thickness, length, width, density, price per kg, quantity                              | same                                                                      |
| `circular` | Circular                | Weight, with arc geometry | thickness, diameter, angle, derived arc length, width, density, price per kg, quantity | same                                                                      |

`Transport` appears only as a legacy utility row. It is **not** a product type and
is not imported into the catalog.

## Candidate canonical commercial inputs

| Candidate field                       | Unit                          | Notes                                                                                         |
| ------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------- |
| Product family/type                   | controlled reference          | Initial discovery values are Linear, Curved, Circular; no SKU catalog was found.              |
| Thickness                             | mm                            | Item-level physical dimension.                                                                |
| Length and width                      | mm                            | Item-level physical dimensions.                                                               |
| Quantity                              | count                         | Must be a submitted quantity, never a browser-only calculated truth.                          |
| Diameter / angle                      | mm / degree                   | Circular-only geometry; arc length may be derived server-side.                                |
| Density                               | approved unit to be confirmed | For Curved/Circular only; Linear must not depend on density for its standard-board reference. |
| Price basis                           | sheet, weight, fixed          | A controlled server-side rule, never arbitrary client logic.                                  |
| Reference price, min price, max price | currency                      | Required by the SSOT pricing model; no values were found or approved here.                    |
| Effective period and source           | timestamps + provenance       | Required before any price/configuration is usable.                                            |

## Calculation candidates requiring formal approval

1. Linear reference rate may be derived from an approved standard-board price and
   an approved standard-board dimension. The SSOT already locks a standard-board
   default weight of 33 kg as effective-dated; this legacy extraction does not
   change that rule.
2. Curved and Circular rows may use physical weight derived from dimensions and
   an approved density, then apply an approved per-kg price.
3. Circular arc length may be derived from diameter and angle. The server must
   own the formula, rounding, validation and provenance.
4. Discounts, taxes, fixed prices and any manual override are discovery items;
   they are not authorized as pricing behavior by this extraction.

## Quarantined legacy defaults — never seed automatically

| Legacy default          |       Legacy value | Treatment                                                                                            |
| ----------------------- | -----------------: | ---------------------------------------------------------------------------------------------------- |
| Linear sheet price      |           3300 EGP | Historical local default only; requires an approved effective-dated price record.                    |
| Linear sheet weight     |              33 kg | SSOT reference exists, but still store as effective-dated configuration rather than a code constant. |
| Curved/Circular density | 0.72 legacy factor | Unit/meaning conflict exists across legacy files; require engineering confirmation.                  |
| Curved/Circular price   |         120 EGP/kg | Historical local default only; requires approved price record.                                       |
| Linear extension        |               38 m | Legacy-only behavior; not adopted.                                                                   |
| VAT                     |                14% | No tax authority/effective-date evidence in the legacy app; not adopted.                             |
| Offer validity          |             7 days | Must be a governed effective-dated commercial configuration if adopted.                              |

## Explicit exclusions

- No PDF, Excel, Word, HTML, or other document template is copied from the
  legacy application.
- No shipment, POD, reservation, ERP order mutation, or formal quotation
  revision behavior is imported.
- No localStorage records, hard-coded markets, payment terms, delivery terms,
  barter presets, sales-engineer records, vehicle capacities, or document
  template names become production data.

## Result for the next implementation unit

The supplied product spreadsheet is the actual Product Master source. The
legacy application only supplements its vocabulary and candidate physical
attributes. Neither spreadsheet is an effective-dated approval-backed quotation
price list, so real quotation pricing remains disabled until the governed price
source is loaded and approved.
