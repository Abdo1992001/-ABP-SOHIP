// Stage: CLEANING + NORMALIZATION.
//
// Everything here is a pure function on a raw cell value. No database, no I/O.
// That is deliberate: normalization rules are the part of an import that gets
// argued about and changed, so they have to be readable and testable on their
// own, and reusable by the next source file (pricing, payments, shipments).

/** Trim, collapse inner whitespace, drop the Excel placeholders that mean "empty". */
export function cleanText(value) {
  if (value === null || value === undefined) return null;
  let text =
    typeof value === "object" && value !== null && "text" in value
      ? String(value.text)
      : String(value);
  text = text
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (text === "") return null;
  if (/^(n\/?a|null|none|-{1,3}|#n\/a)$/i.test(text)) return null;
  return text;
}

export function cleanNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "object" && value !== null && "result" in value) {
    return cleanNumber(value.result);
  }
  const text = cleanText(value);
  if (text === null) return null;
  // "1,234.50", "(120)" (accounting negative), "EGP 1 200"
  const negative = /^\(.*\)$/.test(text);
  const digits = text.replace(/[()]/g, "").replace(/[^0-9.+-]/g, "");
  if (digits === "" || digits === "-" || digits === "+") return null;
  const parsed = Number(digits);
  if (!Number.isFinite(parsed)) return null;
  return negative ? -parsed : parsed;
}

export function cleanDate(value) {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") {
    // Excel serial date (1900 system, with the historical leap-year bug offset).
    const ms = Math.round((value - 25569) * 86400 * 1000);
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const text = cleanText(value);
  if (text === null) return null;
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/.exec(text);
  if (dmy) {
    return new Date(
      Date.UTC(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1])),
    );
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Stage: NAME NORMALIZATION.
 *
 * Produces the comparison key used for entity resolution. It strips legal
 * suffixes and punctuation so "A.B.C. Construction Co." and
 * "ABC CONSTRUCTION" collapse to the same key. The raw name is never
 * overwritten — it is kept on the record for audit.
 */
const LEGAL_SUFFIXES = [
  "co",
  "company",
  "corp",
  "corporation",
  "inc",
  "incorporated",
  "llc",
  "l l c",
  "ltd",
  "limited",
  "plc",
  "pty",
  "pty ltd",
  "gmbh",
  "sarl",
  "sa",
  "sas",
  "srl",
  "spa",
  "bv",
  "nv",
  "ag",
  "as",
  "ab",
  "oy",
  "kft",
  "sp z o o",
  "sp zoo",
  "zoo",
  "wll",
  "w l l",
  "fze",
  "fzc",
  "fzco",
  "dmcc",
  "jsc",
  "ooo",
  "pjsc",
  "psc",
  "est",
  "establishment",
  "trading",
  "group",
  "holding",
  "holdings",
  "and sons",
  "for",
  "the",
];
const SUFFIX_SET = new Set(LEGAL_SUFFIXES);

export function normalizeName(value) {
  const raw = cleanText(value);
  if (raw === null) return null;
  // Unicode-aware: a large share of this ERP's customer names are Arabic, and a
  // [a-z]-only filter would normalize every one of them to the empty string and
  // then merge unrelated customers together.
  let text = raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[._'"`ـ]/g, "") // A.B.C. -> abc; strip Arabic tatweel
    .replace(/[ً-ٰٟ]/g, "") // Arabic diacritics
    .replace(/[آأإٱ]/g, "ا") // أ إ آ -> ا
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const words = text.split(" ").filter(Boolean);
  while (words.length > 1 && SUFFIX_SET.has(words[words.length - 1]))
    words.pop();
  return words.join(" ") || text || null;
}

/**
 * Canonical display name: title-cased, punctuation-tidied, but NOT suffix-stripped
 * (a salesperson still wants to read "ACROW Formwork Nigeria Limited").
 */
const ALWAYS_UPPER = new Set([
  "acrow",
  "abp",
  "worca",
  "uae",
  "ksa",
  "usa",
  "uk",
  "llc",
  "fze",
  "dmcc",
  "wll",
  "pvc",
  "mdf",
  "gm",
]);

export function canonicalizeName(value) {
  const raw = cleanText(value);
  if (raw === null) return null;
  const tidied = raw
    .replace(/\s*([,.])\s*/g, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
  // Leave mixed-case names alone; only re-case the SHOUTING ones, which is how
  // most ERP exports arrive.
  const isShouting = tidied === tidied.toUpperCase();
  if (!isShouting) return tidied;
  return tidied
    .split(" ")
    .map((word) => {
      const bare = word.replace(/[^A-Za-z]/g, "").toLowerCase();
      if (ALWAYS_UPPER.has(bare)) return word.toUpperCase();
      if (bare.length <= 1) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

/**
 * Stage: COUNTRY NORMALIZATION.
 *
 * "UAE" / "U.A.E" / "United Arab Emirates" / "Emirates" must become ONE country
 * or every per-country analytic splits into three.
 */
const COUNTRIES = [
  ["EG", "Egypt", "AFRICA", ["egypt", "egy", "arab republic of egypt", "eg"]],
  [
    "AE",
    "United Arab Emirates",
    "ASIA",
    [
      "uae",
      "u a e",
      "united arab emirates",
      "emirates",
      "dubai",
      "abu dhabi",
      "ae",
    ],
  ],
  [
    "SA",
    "Saudi Arabia",
    "ASIA",
    ["saudi arabia", "ksa", "saudi", "kingdom of saudi arabia", "sa"],
  ],
  ["PL", "Poland", "EUROPE", ["poland", "polska", "pl"]],
  [
    "GB",
    "United Kingdom",
    "EUROPE",
    [
      "uk",
      "u k",
      "united kingdom",
      "great britain",
      "britain",
      "england",
      "gb",
    ],
  ],
  ["NG", "Nigeria", "AFRICA", ["nigeria", "ng"]],
  ["IN", "India", "ASIA", ["india", "in"]],
  ["ZA", "South Africa", "AFRICA", ["south africa", "rsa", "za"]],
  ["OM", "Oman", "ASIA", ["oman", "sultanate of oman", "om"]],
  ["DZ", "Algeria", "AFRICA", ["algeria", "algerie", "dz"]],
  ["LY", "Libya", "AFRICA", ["libya", "ly"]],
  ["AU", "Australia", "OCEANIA", ["australia", "au"]],
  ["MA", "Morocco", "AFRICA", ["morocco", "maroc", "ma"]],
  ["MX", "Mexico", "NORTH_AMERICA", ["mexico", "mexico city", "mx"]],
  ["JO", "Jordan", "ASIA", ["jordan", "jo"]],
  ["BR", "Brazil", "SOUTH_AMERICA", ["brazil", "brasil", "br"]],
  ["CH", "Switzerland", "EUROPE", ["switzerland", "suisse", "ch"]],
  ["PH", "Philippines", "ASIA", ["philippines", "the philippines", "ph"]],
  ["QA", "Qatar", "ASIA", ["qatar", "qa"]],
  ["KW", "Kuwait", "ASIA", ["kuwait", "kw"]],
  ["BH", "Bahrain", "ASIA", ["bahrain", "bh"]],
  ["IQ", "Iraq", "ASIA", ["iraq", "iq"]],
  ["LB", "Lebanon", "ASIA", ["lebanon", "lb"]],
  ["SD", "Sudan", "AFRICA", ["sudan", "sd"]],
  ["TN", "Tunisia", "AFRICA", ["tunisia", "tunisie", "tn"]],
  ["KE", "Kenya", "AFRICA", ["kenya", "ke"]],
  ["GH", "Ghana", "AFRICA", ["ghana", "gh"]],
  ["TZ", "Tanzania", "AFRICA", ["tanzania", "tz"]],
  ["ET", "Ethiopia", "AFRICA", ["ethiopia", "et"]],
  ["UG", "Uganda", "AFRICA", ["uganda", "ug"]],
  [
    "CI",
    "Ivory Coast",
    "AFRICA",
    ["ivory coast", "cote divoire", "côte divoire", "ci"],
  ],
  ["SN", "Senegal", "AFRICA", ["senegal", "sn"]],
  ["CM", "Cameroon", "AFRICA", ["cameroon", "cm"]],
  ["TR", "Turkey", "ASIA", ["turkey", "turkiye", "türkiye", "tr"]],
  ["DE", "Germany", "EUROPE", ["germany", "deutschland", "de"]],
  ["FR", "France", "EUROPE", ["france", "fr"]],
  ["IT", "Italy", "EUROPE", ["italy", "italia", "it"]],
  ["ES", "Spain", "EUROPE", ["spain", "espana", "españa", "es"]],
  ["NL", "Netherlands", "EUROPE", ["netherlands", "holland", "nl"]],
  ["BE", "Belgium", "EUROPE", ["belgium", "be"]],
  ["PT", "Portugal", "EUROPE", ["portugal", "pt"]],
  ["RO", "Romania", "EUROPE", ["romania", "ro"]],
  ["CZ", "Czechia", "EUROPE", ["czechia", "czech republic", "cz"]],
  ["SK", "Slovakia", "EUROPE", ["slovakia", "sk"]],
  ["HU", "Hungary", "EUROPE", ["hungary", "hu"]],
  ["SE", "Sweden", "EUROPE", ["sweden", "se"]],
  ["NO", "Norway", "EUROPE", ["norway", "no"]],
  ["DK", "Denmark", "EUROPE", ["denmark", "dk"]],
  ["FI", "Finland", "EUROPE", ["finland", "fi"]],
  ["IE", "Ireland", "EUROPE", ["ireland", "ie"]],
  ["AT", "Austria", "EUROPE", ["austria", "at"]],
  ["GR", "Greece", "EUROPE", ["greece", "gr"]],
  [
    "US",
    "United States",
    "NORTH_AMERICA",
    [
      "usa",
      "u s a",
      "united states",
      "united states of america",
      "america",
      "us",
    ],
  ],
  ["CA", "Canada", "NORTH_AMERICA", ["canada", "ca"]],
  ["CL", "Chile", "SOUTH_AMERICA", ["chile", "cl"]],
  ["AR", "Argentina", "SOUTH_AMERICA", ["argentina", "ar"]],
  ["PE", "Peru", "SOUTH_AMERICA", ["peru", "pe"]],
  ["CO", "Colombia", "SOUTH_AMERICA", ["colombia", "co"]],
  ["PA", "Panama", "NORTH_AMERICA", ["panama", "pa"]],
  ["SG", "Singapore", "ASIA", ["singapore", "sg"]],
  ["MY", "Malaysia", "ASIA", ["malaysia", "my"]],
  ["ID", "Indonesia", "ASIA", ["indonesia", "id"]],
  ["TH", "Thailand", "ASIA", ["thailand", "th"]],
  ["VN", "Vietnam", "ASIA", ["vietnam", "viet nam", "vn"]],
  ["CN", "China", "ASIA", ["china", "prc", "cn"]],
  ["JP", "Japan", "ASIA", ["japan", "jp"]],
  [
    "KR",
    "South Korea",
    "ASIA",
    ["south korea", "korea", "republic of korea", "kr"],
  ],
  ["PK", "Pakistan", "ASIA", ["pakistan", "pk"]],
  ["BD", "Bangladesh", "ASIA", ["bangladesh", "bd"]],
  ["LK", "Sri Lanka", "ASIA", ["sri lanka", "lk"]],
  ["NZ", "New Zealand", "OCEANIA", ["new zealand", "nz"]],
  ["RU", "Russia", "EUROPE", ["russia", "russian federation", "ru"]],
  ["UA", "Ukraine", "EUROPE", ["ukraine", "ua"]],
  ["IL", "Israel", "ASIA", ["israel", "il"]],
  ["CY", "Cyprus", "EUROPE", ["cyprus", "cy"]],
  ["MT", "Malta", "EUROPE", ["malta", "mt"]],
  ["YE", "Yemen", "ASIA", ["yemen", "ye"]],
  ["SY", "Syria", "ASIA", ["syria", "sy"]],
  ["MR", "Mauritania", "AFRICA", ["mauritania", "mr"]],
  ["AO", "Angola", "AFRICA", ["angola", "ao"]],
  ["MZ", "Mozambique", "AFRICA", ["mozambique", "mz"]],
  ["ZM", "Zambia", "AFRICA", ["zambia", "zm"]],
  ["ZW", "Zimbabwe", "AFRICA", ["zimbabwe", "zw"]],
  ["RW", "Rwanda", "AFRICA", ["rwanda", "rw"]],
  ["BW", "Botswana", "AFRICA", ["botswana", "bw"]],
  ["NA", "Namibia", "AFRICA", ["namibia"]],
  ["SI", "Slovenia", "EUROPE", ["slovenia", "slovenija", "si"]],
  ["UY", "Uruguay", "SOUTH_AMERICA", ["uruguay", "uy"]],
  ["HR", "Croatia", "EUROPE", ["croatia", "hrvatska", "hr"]],
  ["RS", "Serbia", "EUROPE", ["serbia", "rs"]],
  ["BG", "Bulgaria", "EUROPE", ["bulgaria", "bg"]],
  ["EC", "Ecuador", "SOUTH_AMERICA", ["ecuador", "ec"]],
  ["BO", "Bolivia", "SOUTH_AMERICA", ["bolivia", "bo"]],
  ["PY", "Paraguay", "SOUTH_AMERICA", ["paraguay", "py"]],
  // Explicit "not resolved" bucket. A row whose country cannot be normalized is
  // parked here AND flagged for review, rather than being quietly filed under
  // Egypt because that is the most common value in the file.
  ["ZZ", "Unknown country", "UNKNOWN", ["unknown", "unspecified", "zz"]],
];

const COUNTRY_BY_ALIAS = new Map();
export const COUNTRY_CATALOG = new Map();
for (const [code, name, continentCode, aliases] of COUNTRIES) {
  COUNTRY_CATALOG.set(code, { code, name, continentCode });
  COUNTRY_BY_ALIAS.set(code.toLowerCase(), code);
  for (const alias of aliases) COUNTRY_BY_ALIAS.set(alias, code);
}

function countryKey(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** @returns {{ code: string, name: string, continentCode: string } | null} */
export function normalizeCountry(value) {
  const raw = cleanText(value);
  if (raw === null) return null;
  const hit = COUNTRY_BY_ALIAS.get(countryKey(raw));
  return hit ? COUNTRY_CATALOG.get(hit) : null;
}

/** Currency codes arrive clean in this export, but never trust that. */
export function normalizeCurrency(value) {
  const raw = cleanText(value);
  if (raw === null) return null;
  const code = raw.toUpperCase().replace(/[^A-Z]/g, "");
  return /^[A-Z]{3}$/.test(code) ? code : null;
}

/** Customer / order / item numbers: the stable reference keys. Digits kept verbatim. */
export function normalizeKey(value) {
  const raw = cleanText(value);
  if (raw === null) return null;
  return raw.toUpperCase().replace(/\s+/g, "");
}
