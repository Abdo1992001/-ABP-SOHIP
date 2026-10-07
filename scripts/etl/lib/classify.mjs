// Stage: CLASSIFICATION.
//
// Two decisions that the raw export does not make for us:
//
//  1. Is this ordered item actually a product? Transportation, freight, service
//     and adjustment lines sit in the same column as real boards. If they are
//     loaded as products, "top products sold" becomes nonsense.
//  2. Is this customer an external customer or an ACROW group company? WORCA
//     Formwork Solutions (Australia) is an affiliate. Its transactions are real
//     and must be kept, but they are intercompany revenue, not external sales.
//
// Both return a code plus the reason that produced it, so a reviewer can see
// why the pipeline decided what it decided instead of having to guess.

export const ITEM_CLASSIFICATIONS = [
  "SELLABLE_PRODUCT",
  "SERVICE",
  "LOGISTICS_CHARGE",
  "MISCELLANEOUS",
  "UNKNOWN",
];

const LOGISTICS_PATTERNS = [
  /transport/i,
  /freight/i,
  /shipping/i,
  /delivery/i,
  /haulage/i,
  /courier/i,
  /customs/i,
  /clearance/i,
  /demurrage/i,
  /loading/i,
  /offload/i,
  /trucking/i,
  /logistic/i,
];
const SERVICE_PATTERNS = [
  /\bservice\b/i,
  /\brepair\b/i,
  /maintenance/i,
  /installation/i,
  /assembly/i,
  /consult/i,
  /design fee/i,
  /engineering fee/i,
  /labou?r\b/i,
  /rental/i,
  /hire\b/i,
];
const MISC_PATTERNS = [
  /adjust/i,
  /rounding/i,
  /discount/i,
  /credit note/i,
  /debit note/i,
  /penalt/i,
  /marketing/i,
  /sample/i,
  /promo/i,
  /gift/i,
  /donation/i,
  /scrap/i,
  /write.?off/i,
];

// Item Class values as they appear in the ERP export, mapped to the decision they
// force regardless of how the description is worded.
const CLASS_OVERRIDES = new Map([
  ["transportations", "LOGISTICS_CHARGE"],
  ["transportation", "LOGISTICS_CHARGE"],
  ["freight", "LOGISTICS_CHARGE"],
  ["service", "SERVICE"],
  ["services", "SERVICE"],
  ["marketing", "MISCELLANEOUS"],
  ["m board", "SELLABLE_PRODUCT"],
  ["a board", "SELLABLE_PRODUCT"],
  ["e board", "SELLABLE_PRODUCT"],
  ["x board", "SELLABLE_PRODUCT"],
  ["x-beam", "SELLABLE_PRODUCT"],
  ["flexa", "SELLABLE_PRODUCT"],
  ["kit", "SELLABLE_PRODUCT"],
  ["furni", "SELLABLE_PRODUCT"],
  ["chemicals", "SELLABLE_PRODUCT"],
  ["accessories", "SELLABLE_PRODUCT"],
]);

/**
 * @param {{ itemClassRaw?: string|null, description?: string|null, orderedItem?: string|null }} input
 * @returns {{ code: string, reason: string }}
 */
export function classifyItem(input) {
  const itemClass = (input.itemClassRaw ?? "").trim().toLowerCase();
  if (itemClass !== "") {
    const override = CLASS_OVERRIDES.get(itemClass);
    if (override)
      return { code: override, reason: `item class "${input.itemClassRaw}"` };
  }

  const haystack = [input.description, input.orderedItem]
    .filter(Boolean)
    .join(" ");
  if (haystack !== "") {
    for (const pattern of LOGISTICS_PATTERNS) {
      if (pattern.test(haystack))
        return {
          code: "LOGISTICS_CHARGE",
          reason: `description matched ${String(pattern)}`,
        };
    }
    for (const pattern of SERVICE_PATTERNS) {
      if (pattern.test(haystack))
        return {
          code: "SERVICE",
          reason: `description matched ${String(pattern)}`,
        };
    }
    for (const pattern of MISC_PATTERNS) {
      if (pattern.test(haystack))
        return {
          code: "MISCELLANEOUS",
          reason: `description matched ${String(pattern)}`,
        };
    }
  }

  if (itemClass !== "")
    return {
      code: "SELLABLE_PRODUCT",
      reason: `item class "${input.itemClassRaw}" is a product family`,
    };
  // No class, no telling description: say so rather than guessing it is a board.
  return {
    code: "UNKNOWN",
    reason: "no item class and no recognisable description",
  };
}

export const PRODUCT_STATUSES = [
  "ACTIVE",
  "INACTIVE",
  "OBSOLETE",
  "IN_COSTING",
];

/**
 * A product that stopped being made is still needed to read history; it just
 * must not appear in a new quotation's picker. That is the ACTIVE/OBSOLETE line.
 *
 * @param {{ description?: string|null, subCategory?: string|null, minorCategory?: string|null, onHandQty?: number|null, lastUpdateDate?: Date|null }} input
 */
export function classifyProductStatus(input) {
  const haystack = [input.description, input.subCategory, input.minorCategory]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (
    /\bobsolete\b|\bdiscontinued\b|\bcancell?ed\b|\bdo not use\b/.test(haystack)
  ) {
    return {
      code: "OBSOLETE",
      reason: "description flagged obsolete/discontinued",
    };
  }
  if (
    /\bin costing\b|\bcosting\b|\bunder costing\b|\bpending cost\b/.test(
      haystack,
    )
  ) {
    return { code: "IN_COSTING", reason: "description flagged in costing" };
  }
  if (/\binactive\b|\bon hold\b|\bhold\b/.test(haystack)) {
    return { code: "INACTIVE", reason: "description flagged inactive/on hold" };
  }
  return { code: "ACTIVE", reason: "no status marker found" };
}

export const RELATIONSHIP_TYPES = ["EXTERNAL_CUSTOMER", "GROUP_AFFILIATE"];

// Known ACROW group companies, keyed by the stable customer number. Customer
// number is used rather than the name because the name is exactly the thing
// that is spelled five different ways.
const GROUP_CUSTOMER_NUMBERS = new Map([
  ["285014", "ACROW Group"], // ACROW DZ — Algeria
  ["300010", "ACROW Group"], // Acrow LLC — Oman
  ["285017", "ACROW Group"], // Acrow Morocco
  ["773309", "ACROW Group"], // WORCA Formwork Solutions Pty Ltd — Australia
  ["472027", "ACROW Group"], // ACROW Formwork Nigeria Limited
  // Recorded in Arabic in this ERP, which is why they are listed by number:
  ["282009", "ACROW Group"], // اكرو مصر للشدات والسقالات المعدنية — Acrow Egypt
  ["282010", "ACROW Group"], // اكرو لخدمات التشييد المتكاملة — Acrow Integrated Construction Services
  ["283011", "ACROW Group"], // اكرو جلف — Acrow Gulf (UAE)
  ["296012", "ACROW Group"], // اكرو السعوديه — Acrow Saudi Arabia
  ["300009", "ACROW Group"], // اكرو مصر ... الاردن — Acrow Egypt / Jordan
  ["302009", "ACROW Group"], // اكرو لمنتجات البناء — Acrow Building Products (ABP)
]);

// Safety net for a group company that appears under a number not listed above.
// Arabic spellings are included because most of this ERP's group companies are
// recorded in Arabic; a Latin-only pattern files every one of them as external.
// "كروز" (Cruise) deliberately does not match — the alef prefix is required.
const GROUP_NAME_PATTERNS = [/\bacrow\b/i, /\bworca\b/i, /[اأآ]كرو/, /ووركا/];

/**
 * @param {{ customerNumber?: string|null, name?: string|null }} input
 * @returns {{ code: string, groupParentName: string|null, reason: string }}
 */
export function classifyRelationship(input) {
  const number = (input.customerNumber ?? "").trim();
  if (number !== "" && GROUP_CUSTOMER_NUMBERS.has(number)) {
    return {
      code: "GROUP_AFFILIATE",
      groupParentName: GROUP_CUSTOMER_NUMBERS.get(number),
      reason: `customer number ${number} is a registered group company`,
    };
  }
  const name = input.name ?? "";
  for (const pattern of GROUP_NAME_PATTERNS) {
    if (pattern.test(name)) {
      return {
        code: "GROUP_AFFILIATE",
        groupParentName: "ACROW Group",
        reason: `name matched group pattern ${String(pattern)}`,
      };
    }
  }
  return {
    code: "EXTERNAL_CUSTOMER",
    groupParentName: null,
    reason: "no group marker",
  };
}
