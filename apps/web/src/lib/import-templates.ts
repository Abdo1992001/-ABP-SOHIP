/**
 * The import templates: one per kind of import, with exactly the columns the
 * importer reads, so a file filled from a template validates first time.
 *
 * The importer accepts a single-sheet .xlsx or a .csv whose first row is the
 * column names, spelled as below. Every other row is data -- which is why the
 * guidance sits in each header cell's note and on the import screen, not in
 * an example row that would be imported as a record.
 *
 * To add a column: add it here, then read it in the worker's commit for that
 * import type (apps/worker/src/workflow-handlers.ts), and in the import rules
 * if it is required (apps/api/src/imports/import-rules.ts).
 */

export interface TemplateColumn {
  key: string;
  required: boolean;
  en: string;
  ar: string;
  example: string;
}

export interface ImportTemplate {
  typeCode: "CUSTOMERS" | "SALES_ORDERS" | "ITEM_MASTER";
  en: string;
  ar: string;
  fileName: string;
  columns: readonly TemplateColumn[];
}

export const IMPORT_TEMPLATES: readonly ImportTemplate[] = [
  {
    typeCode: "CUSTOMERS",
    en: "Customers",
    ar: "العملاء",
    fileName: "abp-import-customers.xlsx",
    columns: [
      {
        key: "customerNumber",
        required: true,
        en: "Your customer number — the same on every import, so a second upload updates instead of duplicating",
        ar: "رقم العميل — نفسه في كل مرة، عشان الرفع التاني يحدّث بدل ما يكرر",
        example: "C-10045",
      },
      {
        key: "canonicalName",
        required: true,
        en: "Company name as it should appear",
        ar: "اسم الشركة زي ما لازم يظهر",
        example: "Hassan Allam Holding",
      },
      {
        key: "countryCode",
        required: true,
        en: "Two-letter country code",
        ar: "كود الدولة حرفين",
        example: "EG",
      },
      {
        key: "sourceCustomerKey",
        required: false,
        en: "The customer's key in the system it came from (ERP), if any",
        ar: "كود العميل في النظام اللي جه منه (ERP) لو موجود",
        example: "ERP-77812",
      },
    ],
  },
  {
    typeCode: "SALES_ORDERS",
    en: "Sales orders (ERP)",
    ar: "أوامر البيع (ERP)",
    fileName: "abp-import-sales-orders.xlsx",
    columns: [
      {
        key: "orderNumber",
        required: true,
        en: "Order number from the ERP",
        ar: "رقم الأوردر من الـERP",
        example: "SO-2026-01188",
      },
      {
        key: "countryCode",
        required: true,
        en: "Two-letter country code",
        ar: "كود الدولة حرفين",
        example: "EG",
      },
      {
        key: "sourceSalesOrderId",
        required: false,
        en: "The order's id in the ERP, if different from its number",
        ar: "رقم الأوردر الداخلي في الـERP لو مختلف",
        example: "778120",
      },
      {
        key: "statusCode",
        required: false,
        en: "Order status as the ERP calls it",
        ar: "حالة الأوردر زي ما الـERP بيسميها",
        example: "OPEN",
      },
    ],
  },
  {
    typeCode: "ITEM_MASTER",
    en: "Item master (products)",
    ar: "الأصناف",
    fileName: "abp-import-items.xlsx",
    columns: [
      {
        key: "sku",
        required: true,
        en: "Item code — unique",
        ar: "كود الصنف — مايتكررش",
        example: "ACROW-PLY-18",
      },
      {
        key: "description",
        required: true,
        en: "Item description",
        ar: "وصف الصنف",
        example: "ACROW Formwork Plywood 18mm 1220×2440",
      },
      {
        key: "familyCode",
        required: true,
        en: "Product family code (must exist)",
        ar: "كود عائلة المنتج (لازم يكون موجود)",
        example: "BOARDS",
      },
      {
        key: "productTypeCode",
        required: false,
        en: "Product type",
        ar: "نوع المنتج",
        example: "BOARD",
      },
      {
        key: "lengthMm",
        required: false,
        en: "Length in millimetres",
        ar: "الطول بالمليمتر",
        example: "2440",
      },
      {
        key: "widthMm",
        required: false,
        en: "Width in millimetres",
        ar: "العرض بالمليمتر",
        example: "1220",
      },
      {
        key: "thicknessMm",
        required: false,
        en: "Thickness in millimetres",
        ar: "السُمك بالمليمتر",
        example: "18",
      },
      {
        key: "weightKg",
        required: false,
        en: "Weight of one piece in kg",
        ar: "وزن القطعة بالكيلو",
        example: "32.5",
      },
      {
        key: "densityKgM",
        required: false,
        en: "Density in kg/m³",
        ar: "الكثافة كجم/م³",
        example: "600",
      },
      {
        key: "sourceItemKey",
        required: false,
        en: "The item's key in the ERP, if any",
        ar: "كود الصنف في الـERP لو موجود",
        example: "ITM-55120",
      },
    ],
  },
];

export function templateFor(typeCode: string): ImportTemplate | undefined {
  return IMPORT_TEMPLATES.find((template) => template.typeCode === typeCode);
}

/**
 * Build the template workbook: one sheet, the header row only, required
 * columns shaded, a note on every header with what goes there and an
 * example. Loaded on demand -- the spreadsheet library is large.
 */
export async function buildTemplate(
  template: ImportTemplate,
  ar: boolean,
): Promise<Blob> {
  const ExcelJS = (await import("exceljs")).default;
  const book = new ExcelJS.Workbook();
  book.creator = "ABP Commercial System";
  const sheet = book.addWorksheet(template.typeCode, {
    views: [{ state: "frozen", ySplit: 1, rightToLeft: false }],
  });
  sheet.columns = template.columns.map((column) => ({
    header: column.key,
    key: column.key,
    width: Math.max(16, column.key.length + 6),
  }));
  const header = sheet.getRow(1);
  header.height = 22;
  template.columns.forEach((column, index) => {
    const cell = header.getCell(index + 1);
    cell.font = {
      bold: true,
      color: { argb: column.required ? "FFFFFFFF" : "FF0E0B53" },
    };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: column.required ? "FFC81D25" : "FFE8EAF6" },
    };
    cell.alignment = { vertical: "middle" };
    cell.note = {
      texts: [
        {
          text: column.required
            ? ar
              ? "مطلوب. "
              : "Required. "
            : ar
              ? "اختياري. "
              : "Optional. ",
        },
        { text: ar ? column.ar : column.en },
        { text: `\n${ar ? "مثال" : "Example"}: ${column.example}` },
      ],
    };
  });
  const buffer = await book.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}

/** The same columns as a CSV header, for people who prefer plain files. */
export function buildCsvTemplate(template: ImportTemplate): Blob {
  return new Blob(
    [`${template.columns.map((column) => column.key).join(",")}\r\n`],
    {
      type: "text/csv",
    },
  );
}
