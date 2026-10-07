/**
 * What each kind of import needs, in one place.
 *
 * These rules used to be two `? :` chains buried in the service, and the gap
 * they hid was expensive: the import screen offered four kinds of file, three
 * of them fell through to a generic branch with no natural key and no required
 * fields, and the commit wrote records for exactly one. A file of customers
 * could be uploaded, validated, previewed and committed, and the batch would
 * report COMMITTED with not one account created.
 *
 * So the rules are a table now. A type that is not in it is not offered, and
 * `writesRecords` is the honest statement of whether committing it produces
 * anything — a type that validates but writes nothing is a screen lying about
 * its own work.
 */

export interface ImportTypeRule {
  /** Columns that identify a row again on a later import, best first. */
  readonly naturalKeys: readonly string[];
  /** Columns without which the row cannot be committed. */
  readonly requiredFields: readonly string[];
  /** Whether committing this type actually writes records. */
  readonly writesRecords: boolean;
  /** Whether a row's country is checked against the importer's scope. */
  readonly countryScoped: boolean;
}

export const IMPORT_TYPE_RULES: Readonly<Record<string, ImportTypeRule>> = {
  SALES_ORDERS: {
    naturalKeys: ["orderNumber", "sourceSalesOrderId"],
    requiredFields: ["orderNumber", "countryCode"],
    writesRecords: true,
    countryScoped: true,
  },
  CUSTOMERS: {
    naturalKeys: ["customerNumber", "sourceCustomerKey"],
    requiredFields: ["customerNumber", "canonicalName", "countryCode"],
    writesRecords: true,
    countryScoped: true,
  },
  ITEM_MASTER: {
    // A product must belong to a family. Filing it under a guessed one is
    // worse than refusing the row and naming the column that is missing.
    naturalKeys: ["sku", "sourceItemKey"],
    requiredFields: ["sku", "description", "familyCode"],
    writesRecords: true,
    countryScoped: false,
  },
};

export const SUPPORTED_IMPORT_TYPES = Object.keys(IMPORT_TYPE_RULES);

export function importTypeRule(type: string): ImportTypeRule | undefined {
  return IMPORT_TYPE_RULES[type];
}

/** The value this row is recognised by, or null when it carries none. */
export function naturalKeyFor(
  type: string,
  row: Record<string, string | number | boolean | null>,
): string | null {
  const rule = importTypeRule(type);
  for (const key of rule?.naturalKeys ?? ["id", "key"]) {
    const value = row[key];
    if (value !== null && value !== undefined && String(value).trim() !== "")
      return String(value).trim();
  }
  return null;
}

export interface RowIssue {
  readonly code: string;
  readonly severity: string;
  readonly message: string;
}

/** Every required column this row is missing. */
export function validateRow(
  type: string,
  row: Record<string, string | number | boolean | null>,
): RowIssue[] {
  const rule = importTypeRule(type);
  return (rule?.requiredFields ?? [])
    .filter((key) => {
      const value = row[key];
      return (
        value === null || value === undefined || String(value).trim() === ""
      );
    })
    .map((key) => ({
      code: "REQUIRED_FIELD_MISSING",
      severity: "ERROR",
      message: `Required field ${key} is missing.`,
    }));
}
