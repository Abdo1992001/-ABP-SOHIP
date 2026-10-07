/**
 * Where places are, for the customer map: the cities and districts ACROW
 * sells into in Egypt, by their English and Arabic names, and the centre of
 * every country for the world view.
 *
 * A record is placed by the most precise thing known about it: a pin someone
 * dropped on the map, then a district or city named in its city, region or
 * address, then its country. The coordinates are those of the district's
 * centre -- close enough to answer "who do we deal with near the Fifth
 * Settlement", not a delivery address.
 */

export interface Place {
  key: string;
  en: string;
  ar: string;
  lat: number;
  lng: number;
  /** Other spellings people type. */
  aliases?: string[];
  governorate?: string;
}

export const EGYPT_PLACES: readonly Place[] = [
  {
    key: "fifth-settlement",
    en: "Fifth Settlement",
    ar: "التجمع الخامس",
    lat: 30.0075,
    lng: 31.4913,
    governorate: "Cairo",
    aliases: [
      "5th settlement",
      "tagamoa",
      "tagamo3",
      "el tagamoa el khames",
      "التجمع",
      "new cairo 5th",
    ],
  },
  {
    key: "first-settlement",
    en: "First Settlement",
    ar: "التجمع الأول",
    lat: 30.0601,
    lng: 31.4364,
    governorate: "Cairo",
    aliases: ["1st settlement", "التجمع الاول"],
  },
  {
    key: "third-settlement",
    en: "Third Settlement",
    ar: "التجمع الثالث",
    lat: 30.0013,
    lng: 31.4318,
    governorate: "Cairo",
    aliases: ["3rd settlement"],
  },
  {
    key: "new-cairo",
    en: "New Cairo",
    ar: "القاهرة الجديدة",
    lat: 30.0301,
    lng: 31.4701,
    governorate: "Cairo",
    aliases: ["new cairo city"],
  },
  {
    key: "madinaty",
    en: "Madinaty",
    ar: "مدينتي",
    lat: 30.0921,
    lng: 31.6311,
    governorate: "Cairo",
  },
  {
    key: "rehab",
    en: "El Rehab",
    ar: "الرحاب",
    lat: 30.0588,
    lng: 31.4936,
    governorate: "Cairo",
    aliases: ["rehab city", "al rehab"],
  },
  {
    key: "shorouk",
    en: "El Shorouk",
    ar: "الشروق",
    lat: 30.1286,
    lng: 31.6056,
    governorate: "Cairo",
    aliases: ["shorouk city", "al shorouk"],
  },
  {
    key: "new-capital",
    en: "New Administrative Capital",
    ar: "العاصمة الإدارية الجديدة",
    lat: 30.0196,
    lng: 31.7573,
    governorate: "Cairo",
    aliases: [
      "new capital",
      "administrative capital",
      "العاصمة الادارية",
      "العاصمة الإدارية",
    ],
  },
  {
    key: "mostakbal",
    en: "Mostakbal City",
    ar: "مدينة المستقبل",
    lat: 30.145,
    lng: 31.676,
    governorate: "Cairo",
    aliases: ["future city"],
  },
  {
    key: "nasr-city",
    en: "Nasr City",
    ar: "مدينة نصر",
    lat: 30.0566,
    lng: 31.3301,
    governorate: "Cairo",
  },
  {
    key: "heliopolis",
    en: "Heliopolis",
    ar: "مصر الجديدة",
    lat: 30.0911,
    lng: 31.3226,
    governorate: "Cairo",
  },
  {
    key: "maadi",
    en: "Maadi",
    ar: "المعادي",
    lat: 29.9602,
    lng: 31.2569,
    governorate: "Cairo",
  },
  {
    key: "downtown-cairo",
    en: "Downtown Cairo",
    ar: "وسط البلد",
    lat: 30.0478,
    lng: 31.2387,
    governorate: "Cairo",
    aliases: ["wust el balad"],
  },
  {
    key: "zamalek",
    en: "Zamalek",
    ar: "الزمالك",
    lat: 30.0626,
    lng: 31.219,
    governorate: "Cairo",
  },
  {
    key: "helwan",
    en: "Helwan",
    ar: "حلوان",
    lat: 29.8414,
    lng: 31.3008,
    governorate: "Cairo",
  },
  {
    key: "obour",
    en: "El Obour",
    ar: "العبور",
    lat: 30.2283,
    lng: 31.4794,
    governorate: "Qalyubia",
    aliases: ["obour city"],
  },
  {
    key: "badr",
    en: "Badr City",
    ar: "مدينة بدر",
    lat: 30.136,
    lng: 31.7186,
    governorate: "Cairo",
  },
  {
    key: "tenth-of-ramadan",
    en: "10th of Ramadan",
    ar: "العاشر من رمضان",
    lat: 30.2965,
    lng: 31.7472,
    governorate: "Sharqia",
    aliases: ["10th of ramadan city", "tenth of ramadan"],
  },
  {
    key: "cairo",
    en: "Cairo",
    ar: "القاهرة",
    lat: 30.0444,
    lng: 31.2357,
    governorate: "Cairo",
  },
  {
    key: "sixth-of-october",
    en: "6th of October",
    ar: "السادس من أكتوبر",
    lat: 29.972,
    lng: 30.944,
    governorate: "Giza",
    aliases: ["6 october", "october city", "6th october", "اكتوبر", "أكتوبر"],
  },
  {
    key: "sheikh-zayed",
    en: "Sheikh Zayed",
    ar: "الشيخ زايد",
    lat: 30.0444,
    lng: 30.975,
    governorate: "Giza",
    aliases: ["zayed", "el sheikh zayed"],
  },
  {
    key: "new-giza",
    en: "New Giza",
    ar: "نيو جيزة",
    lat: 30.019,
    lng: 31.012,
    governorate: "Giza",
  },
  {
    key: "smart-village",
    en: "Smart Village",
    ar: "القرية الذكية",
    lat: 30.071,
    lng: 31.017,
    governorate: "Giza",
  },
  {
    key: "haram",
    en: "Haram",
    ar: "الهرم",
    lat: 29.993,
    lng: 31.16,
    governorate: "Giza",
    aliases: ["pyramids"],
  },
  {
    key: "dokki",
    en: "Dokki",
    ar: "الدقي",
    lat: 30.0385,
    lng: 31.212,
    governorate: "Giza",
  },
  {
    key: "mohandessin",
    en: "Mohandessin",
    ar: "المهندسين",
    lat: 30.056,
    lng: 31.202,
    governorate: "Giza",
  },
  {
    key: "giza",
    en: "Giza",
    ar: "الجيزة",
    lat: 30.0131,
    lng: 31.2089,
    governorate: "Giza",
  },
  {
    key: "new-alamein",
    en: "New Alamein",
    ar: "العلمين الجديدة",
    lat: 30.8166,
    lng: 28.95,
    governorate: "Matrouh",
    aliases: ["el alamein", "alamein", "العلمين"],
  },
  {
    key: "north-coast",
    en: "North Coast",
    ar: "الساحل الشمالي",
    lat: 30.95,
    lng: 28.45,
    governorate: "Matrouh",
    aliases: ["sahel", "الساحل"],
  },
  {
    key: "marsa-matrouh",
    en: "Marsa Matrouh",
    ar: "مرسى مطروح",
    lat: 31.3543,
    lng: 27.2373,
    governorate: "Matrouh",
    aliases: ["matrouh", "مطروح"],
  },
  {
    key: "borg-el-arab",
    en: "Borg El Arab",
    ar: "برج العرب",
    lat: 30.85,
    lng: 29.6,
    governorate: "Alexandria",
    aliases: ["new borg el arab"],
  },
  {
    key: "alexandria",
    en: "Alexandria",
    ar: "الإسكندرية",
    lat: 31.2001,
    lng: 29.9187,
    governorate: "Alexandria",
    aliases: ["alex", "الاسكندرية", "اسكندرية"],
  },
  {
    key: "damanhour",
    en: "Damanhour",
    ar: "دمنهور",
    lat: 31.0341,
    lng: 30.4682,
    governorate: "Beheira",
  },
  {
    key: "kafr-el-sheikh",
    en: "Kafr El Sheikh",
    ar: "كفر الشيخ",
    lat: 31.1107,
    lng: 30.9388,
    governorate: "Kafr El Sheikh",
  },
  {
    key: "tanta",
    en: "Tanta",
    ar: "طنطا",
    lat: 30.7865,
    lng: 31.0004,
    governorate: "Gharbia",
  },
  {
    key: "mahalla",
    en: "El Mahalla El Kubra",
    ar: "المحلة الكبرى",
    lat: 30.9697,
    lng: 31.1667,
    governorate: "Gharbia",
    aliases: ["mahalla", "المحلة"],
  },
  {
    key: "shibin-el-kom",
    en: "Shibin El Kom",
    ar: "شبين الكوم",
    lat: 30.559,
    lng: 31.01,
    governorate: "Monufia",
  },
  {
    key: "sadat-city",
    en: "Sadat City",
    ar: "مدينة السادات",
    lat: 30.37,
    lng: 30.53,
    governorate: "Monufia",
  },
  {
    key: "benha",
    en: "Benha",
    ar: "بنها",
    lat: 30.466,
    lng: 31.1848,
    governorate: "Qalyubia",
  },
  {
    key: "shubra-el-kheima",
    en: "Shubra El Kheima",
    ar: "شبرا الخيمة",
    lat: 30.1286,
    lng: 31.2422,
    governorate: "Qalyubia",
    aliases: ["shubra"],
  },
  {
    key: "mansoura",
    en: "Mansoura",
    ar: "المنصورة",
    lat: 31.0409,
    lng: 31.3785,
    governorate: "Dakahlia",
  },
  {
    key: "new-mansoura",
    en: "New Mansoura",
    ar: "المنصورة الجديدة",
    lat: 31.48,
    lng: 31.39,
    governorate: "Dakahlia",
  },
  {
    key: "zagazig",
    en: "Zagazig",
    ar: "الزقازيق",
    lat: 30.5877,
    lng: 31.502,
    governorate: "Sharqia",
  },
  {
    key: "damietta",
    en: "Damietta",
    ar: "دمياط",
    lat: 31.4165,
    lng: 31.8133,
    governorate: "Damietta",
    aliases: ["new damietta", "دمياط الجديدة"],
  },
  {
    key: "port-said",
    en: "Port Said",
    ar: "بورسعيد",
    lat: 31.2653,
    lng: 32.3019,
    governorate: "Port Said",
    aliases: ["بور سعيد"],
  },
  {
    key: "ismailia",
    en: "Ismailia",
    ar: "الإسماعيلية",
    lat: 30.5965,
    lng: 32.2715,
    governorate: "Ismailia",
    aliases: ["الاسماعيلية"],
  },
  {
    key: "suez",
    en: "Suez",
    ar: "السويس",
    lat: 29.9668,
    lng: 32.5498,
    governorate: "Suez",
  },
  {
    key: "ain-sokhna",
    en: "Ain Sokhna",
    ar: "العين السخنة",
    lat: 29.6,
    lng: 32.32,
    governorate: "Suez",
    aliases: ["sokhna", "galala", "الجلالة", "السخنة"],
  },
  {
    key: "arish",
    en: "El Arish",
    ar: "العريش",
    lat: 31.1316,
    lng: 33.7984,
    governorate: "North Sinai",
    aliases: ["arish"],
  },
  {
    key: "sharm-el-sheikh",
    en: "Sharm El Sheikh",
    ar: "شرم الشيخ",
    lat: 27.9158,
    lng: 34.33,
    governorate: "South Sinai",
    aliases: ["sharm"],
  },
  {
    key: "dahab",
    en: "Dahab",
    ar: "دهب",
    lat: 28.5,
    lng: 34.5167,
    governorate: "South Sinai",
  },
  {
    key: "hurghada",
    en: "Hurghada",
    ar: "الغردقة",
    lat: 27.2579,
    lng: 33.8116,
    governorate: "Red Sea",
  },
  {
    key: "el-gouna",
    en: "El Gouna",
    ar: "الجونة",
    lat: 27.3942,
    lng: 33.6782,
    governorate: "Red Sea",
    aliases: ["gouna"],
  },
  {
    key: "marsa-alam",
    en: "Marsa Alam",
    ar: "مرسى علم",
    lat: 25.0676,
    lng: 34.879,
    governorate: "Red Sea",
  },
  {
    key: "fayoum",
    en: "Fayoum",
    ar: "الفيوم",
    lat: 29.3084,
    lng: 30.8428,
    governorate: "Fayoum",
    aliases: ["faiyum"],
  },
  {
    key: "beni-suef",
    en: "Beni Suef",
    ar: "بني سويف",
    lat: 29.0661,
    lng: 31.0994,
    governorate: "Beni Suef",
  },
  {
    key: "minya",
    en: "Minya",
    ar: "المنيا",
    lat: 28.1099,
    lng: 30.7503,
    governorate: "Minya",
    aliases: ["el minya"],
  },
  {
    key: "asyut",
    en: "Asyut",
    ar: "أسيوط",
    lat: 27.1809,
    lng: 31.1837,
    governorate: "Asyut",
    aliases: ["assiut", "اسيوط"],
  },
  {
    key: "sohag",
    en: "Sohag",
    ar: "سوهاج",
    lat: 26.5591,
    lng: 31.6957,
    governorate: "Sohag",
  },
  {
    key: "qena",
    en: "Qena",
    ar: "قنا",
    lat: 26.1551,
    lng: 32.716,
    governorate: "Qena",
  },
  {
    key: "luxor",
    en: "Luxor",
    ar: "الأقصر",
    lat: 25.6872,
    lng: 32.6396,
    governorate: "Luxor",
    aliases: ["الاقصر"],
  },
  {
    key: "aswan",
    en: "Aswan",
    ar: "أسوان",
    lat: 24.0889,
    lng: 32.8998,
    governorate: "Aswan",
    aliases: ["اسوان"],
  },
  {
    key: "kharga",
    en: "El Kharga",
    ar: "الخارجة",
    lat: 25.439,
    lng: 30.5586,
    governorate: "New Valley",
    aliases: ["new valley", "الوادي الجديد"],
  },
];

/** Approximate centres of countries, for placing what is known only by country. */
export const COUNTRY_CENTRES: Readonly<Record<string, [number, number]>> = {
  AE: [23.42, 53.85],
  AF: [33.94, 67.71],
  AL: [41.15, 20.17],
  AM: [40.07, 45.04],
  AO: [-11.2, 17.87],
  AR: [-38.42, -63.62],
  AT: [47.52, 14.55],
  AU: [-25.27, 133.78],
  AZ: [40.14, 47.58],
  BA: [43.92, 17.68],
  BD: [23.68, 90.36],
  BE: [50.5, 4.47],
  BF: [12.24, -1.56],
  BG: [42.73, 25.49],
  BH: [26.07, 50.56],
  BI: [-3.37, 29.92],
  BJ: [9.31, 2.32],
  BO: [-16.29, -63.59],
  BR: [-14.24, -51.93],
  BW: [-22.33, 24.68],
  BY: [53.71, 27.95],
  CA: [56.13, -106.35],
  CD: [-4.04, 21.76],
  CF: [6.61, 20.94],
  CG: [-0.23, 15.83],
  CH: [46.82, 8.23],
  CI: [7.54, -5.55],
  CL: [-35.68, -71.54],
  CM: [7.37, 12.35],
  CN: [35.86, 104.2],
  CO: [4.57, -74.3],
  CR: [9.75, -83.75],
  CU: [21.52, -77.78],
  CY: [35.13, 33.43],
  CZ: [49.82, 15.47],
  DE: [51.17, 10.45],
  DJ: [11.83, 42.59],
  DK: [56.26, 9.5],
  DO: [18.74, -70.16],
  DZ: [28.03, 1.66],
  EC: [-1.83, -78.18],
  EE: [58.6, 25.01],
  EG: [26.82, 30.8],
  ER: [15.18, 39.78],
  ES: [40.46, -3.75],
  ET: [9.15, 40.49],
  FI: [61.92, 25.75],
  FR: [46.23, 2.21],
  GA: [-0.8, 11.61],
  GB: [55.38, -3.44],
  GE: [42.32, 43.36],
  GH: [7.95, -1.02],
  GM: [13.44, -15.31],
  GN: [9.95, -9.7],
  GQ: [1.65, 10.27],
  GR: [39.07, 21.82],
  GT: [15.78, -90.23],
  HK: [22.32, 114.17],
  HN: [15.2, -86.24],
  HR: [45.1, 15.2],
  HT: [18.97, -72.29],
  HU: [47.16, 19.5],
  ID: [-0.79, 113.92],
  IE: [53.41, -8.24],
  IL: [31.05, 34.85],
  IN: [20.59, 78.96],
  IQ: [33.22, 43.68],
  IR: [32.43, 53.69],
  IS: [64.96, -19.02],
  IT: [41.87, 12.57],
  JM: [18.11, -77.3],
  JO: [30.59, 36.24],
  JP: [36.2, 138.25],
  KE: [-0.02, 37.91],
  KG: [41.2, 74.77],
  KH: [12.57, 104.99],
  KR: [35.91, 127.77],
  KW: [29.31, 47.48],
  KZ: [48.02, 66.92],
  LA: [19.86, 102.5],
  LB: [33.85, 35.86],
  LK: [7.87, 80.77],
  LR: [6.43, -9.43],
  LS: [-29.61, 28.23],
  LT: [55.17, 23.88],
  LU: [49.82, 6.13],
  LV: [56.88, 24.6],
  LY: [26.34, 17.23],
  MA: [31.79, -7.09],
  MD: [47.41, 28.37],
  ME: [42.71, 19.37],
  MG: [-18.77, 46.87],
  MK: [41.61, 21.75],
  ML: [17.57, -4.0],
  MM: [21.91, 95.96],
  MN: [46.86, 103.85],
  MR: [21.01, -10.94],
  MT: [35.94, 14.38],
  MU: [-20.35, 57.55],
  MW: [-13.25, 34.3],
  MX: [23.63, -102.55],
  MY: [4.21, 101.98],
  MZ: [-18.67, 35.53],
  NA: [-22.96, 18.49],
  NE: [17.61, 8.08],
  NG: [9.08, 8.68],
  NI: [12.87, -85.21],
  NL: [52.13, 5.29],
  NO: [60.47, 8.47],
  NP: [28.39, 84.12],
  NZ: [-40.9, 174.89],
  OM: [21.51, 55.92],
  PA: [8.54, -80.78],
  PE: [-9.19, -75.02],
  PG: [-6.31, 143.96],
  PH: [12.88, 121.77],
  PK: [30.38, 69.35],
  PL: [51.92, 19.15],
  PS: [31.95, 35.23],
  PT: [39.4, -8.22],
  PY: [-23.44, -58.44],
  QA: [25.35, 51.18],
  RO: [45.94, 24.97],
  RS: [44.02, 21.01],
  RU: [61.52, 105.32],
  RW: [-1.94, 29.87],
  SA: [23.89, 45.08],
  SD: [12.86, 30.22],
  SE: [60.13, 18.64],
  SG: [1.35, 103.82],
  SI: [46.15, 14.99],
  SK: [48.67, 19.7],
  SL: [8.46, -11.78],
  SN: [14.5, -14.45],
  SO: [5.15, 46.2],
  SS: [6.88, 31.31],
  SV: [13.79, -88.9],
  SY: [34.8, 38.99],
  TD: [15.45, 18.73],
  TG: [8.62, 0.82],
  TH: [15.87, 100.99],
  TJ: [38.86, 71.28],
  TN: [33.89, 9.54],
  TR: [38.96, 35.24],
  TW: [23.7, 120.96],
  TZ: [-6.37, 34.89],
  UA: [48.38, 31.17],
  UG: [1.37, 32.29],
  US: [37.09, -95.71],
  UY: [-32.52, -55.77],
  UZ: [41.38, 64.59],
  VE: [6.42, -66.59],
  VN: [14.06, 108.28],
  YE: [15.55, 48.52],
  ZA: [-30.56, 22.94],
  ZM: [-13.13, 27.85],
  ZW: [-19.02, 29.15],
};

/** Lower-case, without Arabic diacritics, tatweel, "al-"/"el-" and punctuation. */
export function normalisePlaceText(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[ً-ْـ]/g, "")
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\b(al|el)\s+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

const INDEX: { place: Place; names: string[] }[] = EGYPT_PLACES.map(
  (place) => ({
    place,
    names: [place.en, place.ar, ...(place.aliases ?? [])]
      .map(normalisePlaceText)
      .filter((name) => name.length >= 3)
      // Longest first, so "new cairo" wins over "cairo".
      .sort((a, b) => b.length - a.length),
  }),
);

/**
 * The most specific Egyptian place named anywhere in the given texts: a
 * district beats its city because longer names are tried first.
 */
export function findPlace(
  ...texts: (string | null | undefined)[]
): Place | null {
  const haystack = ` ${texts
    .filter(Boolean)
    .map((text) => normalisePlaceText(text ?? ""))
    .join(" | ")} `;
  if (haystack.trim() === "") return null;
  let best: { place: Place; length: number } | null = null;
  for (const entry of INDEX) {
    for (const name of entry.names) {
      if (
        haystack.includes(` ${name} `) ||
        haystack.includes(` ${name} |`) ||
        haystack.includes(`| ${name} `)
      ) {
        if (best === null || name.length > best.length)
          best = { place: entry.place, length: name.length };
        break;
      }
    }
  }
  return best?.place ?? null;
}

export type Precision = "PINNED" | "DISTRICT" | "COUNTRY" | "UNKNOWN";

/** Where to put a record on the map, and how sure we are. */
export function locate(input: {
  latitude?: number | null;
  longitude?: number | null;
  countryCode?: string | null;
  texts: (string | null | undefined)[];
}): {
  lat: number;
  lng: number;
  precision: Precision;
  placeKey: string | null;
} | null {
  if (
    typeof input.latitude === "number" &&
    typeof input.longitude === "number" &&
    Number.isFinite(input.latitude) &&
    Number.isFinite(input.longitude)
  )
    return {
      lat: input.latitude,
      lng: input.longitude,
      precision: "PINNED",
      placeKey: null,
    };
  const country = input.countryCode?.trim().toUpperCase() ?? null;
  if (country === null || country === "EG") {
    const place = findPlace(...input.texts);
    if (place)
      return {
        lat: place.lat,
        lng: place.lng,
        precision: "DISTRICT",
        placeKey: place.key,
      };
  }
  const centre = country ? COUNTRY_CENTRES[country] : undefined;
  if (centre)
    return {
      lat: centre[0],
      lng: centre[1],
      precision: "COUNTRY",
      placeKey: null,
    };
  return null;
}

/** Great-circle distance in kilometres. */
export function distanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}
