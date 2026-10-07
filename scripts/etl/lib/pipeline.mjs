// The reusable spine of the import pipeline.
//
//   Excel file
//     -> INGESTION      read sheet, map header row to logical field names
//     -> STAGING        every row lands in import_rows, raw + normalized payload
//     -> CLEANING       per-field cleanup (lib/normalize.mjs)
//     -> NORMALIZATION  names, countries, currencies, keys
//     -> MATCHING       ordered item <-> item master, by barcode first
//     -> ENTITY RES.    customer number -> one canonical account
//     -> DEDUPLICATION  3459 rows -> 121 customers / 789 orders / 3459 lines
//     -> VALIDATION     missing keys, unknown country, unmatched item
//     -> WARNINGS       dq_issues rows, nothing is silently guessed
//     -> CANONICAL      accounts / products / erp_orders / erp_order_lines
//
// A new source file (pricing, payments, shipments) implements a module with
// `{ code, importTypeCode, sheet, columns, run(ctx) }` and reuses everything here.

import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..", "..", "..");
const requireFromApi = createRequire(
  path.join(repoRoot, "apps", "api", "package.json"),
);
const requireFromDb = createRequire(
  path.join(repoRoot, "packages", "database", "package.json"),
);

const ExcelJS = requireFromApi("exceljs");
const { Client } = requireFromDb("pg");

export const SOURCE_SYSTEM_ID = "11111111-2222-3333-4444-555555555555";
export const SOURCE_SYSTEM_CODE = "ACROW_ERP_EXCEL";

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

/** Deterministic UUID from a natural key, so re-running the import is idempotent. */
export function stableUuid(namespace, key) {
  const hex = sha256(`${namespace}::${key}`);
  const bytes = hex.slice(0, 32).split("");
  bytes[12] = "5"; // version 5-ish; we only need stability + uniqueness, not RFC purity
  const v = parseInt(hex.slice(16, 17), 16);
  bytes[16] = "89ab"[v % 4];
  const s = bytes.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}

export async function connect() {
  const url =
    process.env.DATABASE_URL ?? "postgresql://abp:abp@localhost:5432/abp";
  const client = new Client({ connectionString: url });
  await client.connect();
  return client;
}

// ------------------------------------------------------------------ INGESTION

/**
 * Read a worksheet into plain objects keyed by logical field name.
 *
 * `columns` maps a logical name to the header text as it appears in the sheet.
 * Headers are matched case-insensitively and whitespace-insensitively because
 * ERP exports are inconsistent about both ("Denisty" included — the typo is in
 * the source file and mapping around it is cheaper than asking for a re-export).
 */
export async function readSheet(filePath, sheetName, columns) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const sheet = workbook.getWorksheet(sheetName) ?? workbook.worksheets[0];
  if (!sheet) throw new Error(`no worksheet "${sheetName}" in ${filePath}`);

  const headerRow = sheet.getRow(1);
  const indexByHeader = new Map();
  headerRow.eachCell({ includeEmpty: false }, (cell, colNumber) => {
    const text = String(cell.value ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (text !== "" && !indexByHeader.has(text))
      indexByHeader.set(text, colNumber);
  });

  const indexByField = new Map();
  const missing = [];
  for (const [field, header] of Object.entries(columns)) {
    const key = header.replace(/\s+/g, " ").trim().toLowerCase();
    const index = indexByHeader.get(key);
    if (index === undefined) missing.push(header);
    else indexByField.set(field, index);
  }

  const rows = [];
  for (let rowNo = 2; rowNo <= sheet.rowCount; rowNo += 1) {
    const row = sheet.getRow(rowNo);
    const record = {};
    let empty = true;
    for (const [field, index] of indexByField) {
      const value = row.getCell(index).value;
      record[field] = value ?? null;
      if (value !== null && value !== undefined && value !== "") empty = false;
    }
    if (empty) continue;
    rows.push({ rowNo, record });
  }

  const schemaFingerprint = sha256([...indexByHeader.keys()].sort().join("|"));
  return {
    rows,
    missing,
    schemaFingerprint,
    headers: [...indexByHeader.keys()],
  };
}

// -------------------------------------------------------------------- REPORT

/**
 * Collects counters and warnings for the staging report. Warnings are written to
 * dq_issues so the review screen can act on them (map to existing item, create
 * new product, classify as service, ignore) rather than being lost to a log.
 */
export class ImportReport {
  constructor(label) {
    this.label = label;
    this.counters = new Map();
    this.issues = [];
    this.startedAt = Date.now();
  }

  count(name, by = 1) {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  set(name, value) {
    this.counters.set(name, value);
  }

  /** severityCode: WARNING | REVIEW_REQUIRED | ERROR */
  issue({ entity, recordKey, rule, severity, message }) {
    this.issues.push({
      entity,
      recordKey: String(recordKey ?? ""),
      rule,
      severity,
      message,
    });
    this.count(`issues.${severity}`);
  }

  toJSON() {
    return {
      label: this.label,
      durationMs: Date.now() - this.startedAt,
      counters: Object.fromEntries(
        [...this.counters.entries()].sort(([a], [b]) => a.localeCompare(b)),
      ),
      issueCount: this.issues.length,
    };
  }

  render(jobRef) {
    const c = this.counters;
    const line = (name, value) => `  ${name.padEnd(28)} ${String(value)}`;
    const out = [
      "",
      `  Import Job #${jobRef}  —  ${this.label}`,
      "  " + "-".repeat(46),
    ];
    for (const [name, value] of [...c.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      out.push(line(name, value));
    }
    out.push(line("Warnings", this.issues.length));
    out.push("");
    return out.join("\n");
  }
}

// ------------------------------------------------------------------- STAGING

export async function openBatch(
  db,
  { importTypeCode, filePath, label, actorUserId },
) {
  const buffer = readFileSync(filePath);
  const fileSha256 = sha256(buffer);
  const fingerprint = sha256(`${importTypeCode}::${fileSha256}`);
  const id = stableUuid("import-batch", fingerprint);

  await db.query(
    `INSERT INTO import_batches
       (import_batch_id, source_system_code, source_system_id, import_type_code,
        file_name, expected_size_bytes, mime_type, file_sha256, source_fingerprint,
        status_code, actor_user_id, label, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'RECEIVED',
             $11, $10, now())
     ON CONFLICT (import_batch_id) DO UPDATE
       SET status_code = 'RECEIVED', label = EXCLUDED.label, created_at = now()`,
    [
      id,
      SOURCE_SYSTEM_CODE,
      SOURCE_SYSTEM_ID,
      importTypeCode,
      path.basename(filePath),
      buffer.byteLength,
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      fileSha256,
      fingerprint,
      label,
      actorUserId,
    ],
  );

  const { rows } = await db.query(
    `SELECT job_ref FROM import_batches WHERE import_batch_id = $1`,
    [id],
  );
  return { id, jobRef: rows[0]?.job_ref ?? id.slice(0, 8), fileSha256 };
}

export async function stageRows(db, batchId, entityCode, rows, normalizer) {
  await db.query(
    `DELETE FROM import_rows WHERE import_batch_id = $1 AND source_entity_code = $2`,
    [batchId, entityCode],
  );
  const chunk = 400;
  for (let start = 0; start < rows.length; start += chunk) {
    const slice = rows.slice(start, start + chunk);
    const values = [];
    const params = [];
    slice.forEach(({ rowNo, record }, i) => {
      const normalized = normalizer(record);
      const raw = JSON.stringify(record, jsonSafe);
      const base = i * 8;
      values.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7},$${base + 8})`,
      );
      params.push(
        randomUUID(),
        batchId,
        String(rowNo),
        entityCode,
        String(rowNo),
        raw,
        JSON.stringify(normalized, jsonSafe),
        sha256(raw),
      );
    });
    await db.query(
      `INSERT INTO import_rows
         (import_row_id, import_batch_id, source_row_key, source_entity_code, row_no,
          raw_payload, normalized_payload, payload_hash)
       VALUES ${values.join(",")}
       ON CONFLICT (import_batch_id, source_entity_code, source_row_key) DO NOTHING`,
      params,
    );
  }
}

function jsonSafe(_key, value) {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  return value;
}

// ---------------------------------------------------------------- VALIDATION

export async function writeIssues(db, batchId, report) {
  await db.query(`DELETE FROM dq_issues WHERE import_batch_id = $1`, [batchId]);
  if (report.issues.length === 0) return;
  const chunk = 300;
  for (let start = 0; start < report.issues.length; start += chunk) {
    const slice = report.issues.slice(start, start + chunk);
    const values = [];
    const params = [];
    slice.forEach((issue, i) => {
      const base = i * 7;
      values.push(
        `($${base + 1},$${base + 2},$${base + 3},$${base + 4},$${base + 5},$${base + 6},$${base + 7})`,
      );
      params.push(
        randomUUID(),
        batchId,
        issue.entity,
        issue.recordKey,
        issue.rule,
        issue.severity,
        issue.message,
      );
    });
    await db.query(
      `INSERT INTO dq_issues
         (dq_issue_id, import_batch_id, source_entity_code, source_record_key,
          rule_code, severity_code, message)
       VALUES ${values.join(",")}`,
      params,
    );
  }
}

export async function closeBatch(
  db,
  batchId,
  report,
  statusCode = "COMMITTED",
) {
  await db.query(
    `UPDATE import_batches
        SET status_code = $2, summary = $3::jsonb, committed_at = now(), completed_at = now()
      WHERE import_batch_id = $1`,
    [batchId, statusCode, JSON.stringify(report.toJSON())],
  );
}

// ------------------------------------------------------------- SHARED UPSERTS

/** Countries detected in the file become reference rows; nothing is invented. */
export async function upsertCountries(db, countries) {
  for (const country of countries) {
    await db.query(
      `INSERT INTO countries (code, name, continent_code, active)
       VALUES ($1,$2,$3,true)
       ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, active = true`,
      [country.code, country.name, country.continentCode],
    );
  }
}

export async function systemUserId(db) {
  const { rows } = await db.query(
    `SELECT id FROM app_users
      ORDER BY (email_normalized = 'admin@abp.local') DESC, created_at
      LIMIT 1`,
  );
  if (!rows[0]) throw new Error("no app_users row to own imported records");
  return rows[0].id;
}
