/**
 * Seaports offered as suggestions on a quotation's shipping line.
 *
 * The Incoterm decides which end of the voyage the document names:
 *   FOB  the Egyptian port the customer takes over at  -> loading ports
 *   CIF  the customer's own port, which we deliver to  -> discharge ports
 *   DDP  a site address, not a port at all             -> no suggestions
 *
 * This is a convenience list, never a constraint: the field stays free text so
 * a port that is not here, an inland terminal, or a customer's own wording can
 * always be typed. A closed dropdown would have made the rarer destinations
 * impossible to quote.
 *
 * Codes are UN/LOCODE. Coverage follows the countries ACROW actually ships to
 * plus the transhipment hubs those routes use; it is deliberately not a
 * complete world list, because a thousand irrelevant entries would make the
 * suggestion box useless.
 */

export interface Seaport {
  /** UN/LOCODE, e.g. EGALY. */
  code: string;
  name: string;
  countryCode: string;
}

export const EGYPT_PORTS: readonly Seaport[] = [
  { code: "EGALY", name: "Alexandria", countryCode: "EG" },
  { code: "EGEDK", name: "El Dekheila", countryCode: "EG" },
  { code: "EGPSD", name: "Port Said", countryCode: "EG" },
  { code: "EGDAM", name: "Damietta", countryCode: "EG" },
  { code: "EGSOK", name: "Ain Sokhna", countryCode: "EG" },
  { code: "EGSUZ", name: "Suez", countryCode: "EG" },
  { code: "EGADA", name: "Adabiya", countryCode: "EG" },
  { code: "EGSGA", name: "Safaga", countryCode: "EG" },
];

export const DESTINATION_PORTS: readonly Seaport[] = [
  // Gulf
  { code: "SAJED", name: "Jeddah", countryCode: "SA" },
  { code: "SADMM", name: "Dammam", countryCode: "SA" },
  { code: "SAKAC", name: "King Abdullah Port", countryCode: "SA" },
  { code: "SAJUB", name: "Jubail", countryCode: "SA" },
  { code: "SAYNB", name: "Yanbu", countryCode: "SA" },
  { code: "AEJEA", name: "Jebel Ali", countryCode: "AE" },
  { code: "AEKHL", name: "Khalifa Port", countryCode: "AE" },
  { code: "AEPRA", name: "Port Rashid", countryCode: "AE" },
  { code: "AEKLF", name: "Khor Fakkan", countryCode: "AE" },
  { code: "AEAUH", name: "Abu Dhabi (Zayed Port)", countryCode: "AE" },
  { code: "OMSOH", name: "Sohar", countryCode: "OM" },
  { code: "OMSLL", name: "Salalah", countryCode: "OM" },
  { code: "OMDQM", name: "Duqm", countryCode: "OM" },
  { code: "OMMCT", name: "Muscat (Sultan Qaboos)", countryCode: "OM" },
  { code: "JOAQJ", name: "Aqaba", countryCode: "JO" },
  // North Africa
  { code: "DZALG", name: "Algiers", countryCode: "DZ" },
  { code: "DZORN", name: "Oran", countryCode: "DZ" },
  { code: "DZAAE", name: "Annaba", countryCode: "DZ" },
  { code: "DZSKI", name: "Skikda", countryCode: "DZ" },
  { code: "DZBJA", name: "Bejaia", countryCode: "DZ" },
  { code: "MAPTM", name: "Tanger Med", countryCode: "MA" },
  { code: "MACAS", name: "Casablanca", countryCode: "MA" },
  { code: "MAAGA", name: "Agadir", countryCode: "MA" },
  { code: "MAJFL", name: "Jorf Lasfar", countryCode: "MA" },
  { code: "LYTIP", name: "Tripoli", countryCode: "LY" },
  { code: "LYBEN", name: "Benghazi", countryCode: "LY" },
  { code: "LYMRA", name: "Misurata", countryCode: "LY" },
  { code: "LYKHO", name: "Al Khoms", countryCode: "LY" },
  // Sub-Saharan Africa
  { code: "NGAPP", name: "Lagos (Apapa)", countryCode: "NG" },
  { code: "NGTIN", name: "Tin Can Island", countryCode: "NG" },
  { code: "NGONN", name: "Onne", countryCode: "NG" },
  { code: "NGPHC", name: "Port Harcourt", countryCode: "NG" },
  { code: "NGCBQ", name: "Calabar", countryCode: "NG" },
  { code: "ZADUR", name: "Durban", countryCode: "ZA" },
  { code: "ZACPT", name: "Cape Town", countryCode: "ZA" },
  { code: "ZAPLZ", name: "Port Elizabeth", countryCode: "ZA" },
  { code: "ZAZBA", name: "Ngqura", countryCode: "ZA" },
  { code: "ZARCB", name: "Richards Bay", countryCode: "ZA" },
  // Europe
  { code: "PLGDN", name: "Gdansk", countryCode: "PL" },
  { code: "PLGDY", name: "Gdynia", countryCode: "PL" },
  { code: "PLSZZ", name: "Szczecin", countryCode: "PL" },
  { code: "PLSWI", name: "Swinoujscie", countryCode: "PL" },
  { code: "ITGOA", name: "Genoa", countryCode: "IT" },
  { code: "ITSPE", name: "La Spezia", countryCode: "IT" },
  { code: "ITGIT", name: "Gioia Tauro", countryCode: "IT" },
  { code: "ITLIV", name: "Livorno", countryCode: "IT" },
  { code: "ITNAP", name: "Naples", countryCode: "IT" },
  { code: "ITTRS", name: "Trieste", countryCode: "IT" },
  { code: "ITVCE", name: "Venice", countryCode: "IT" },
  { code: "ITSAL", name: "Salerno", countryCode: "IT" },
  { code: "ESVLC", name: "Valencia", countryCode: "ES" },
  { code: "ESALG", name: "Algeciras", countryCode: "ES" },
  { code: "ESBCN", name: "Barcelona", countryCode: "ES" },
  { code: "ESBIO", name: "Bilbao", countryCode: "ES" },
  { code: "ESLPA", name: "Las Palmas", countryCode: "ES" },
  { code: "GBFXT", name: "Felixstowe", countryCode: "GB" },
  { code: "GBSOU", name: "Southampton", countryCode: "GB" },
  { code: "GBLGP", name: "London Gateway", countryCode: "GB" },
  { code: "GBLIV", name: "Liverpool", countryCode: "GB" },
  { code: "GBTIL", name: "Tilbury", countryCode: "GB" },
  { code: "GBIMM", name: "Immingham", countryCode: "GB" },
  { code: "SIKOP", name: "Koper", countryCode: "SI" },
  // Switzerland is landlocked; Basel is its Rhine barge terminal and is the
  // place a Swiss CIF quotation actually names.
  { code: "CHBSL", name: "Basel (Rhine terminal)", countryCode: "CH" },
  { code: "TRAMB", name: "Ambarli", countryCode: "TR" },
  { code: "TRIST", name: "Istanbul (Haydarpasa)", countryCode: "TR" },
  { code: "TRMER", name: "Mersin", countryCode: "TR" },
  { code: "TRIZM", name: "Izmir", countryCode: "TR" },
  { code: "TRISK", name: "Iskenderun", countryCode: "TR" },
  { code: "TRGEM", name: "Gemlik", countryCode: "TR" },
  // South and South-East Asia
  { code: "INNSA", name: "Nhava Sheva (JNPT)", countryCode: "IN" },
  { code: "INMUN", name: "Mundra", countryCode: "IN" },
  { code: "INMAA", name: "Chennai", countryCode: "IN" },
  { code: "INCCU", name: "Kolkata", countryCode: "IN" },
  { code: "INCOK", name: "Cochin", countryCode: "IN" },
  { code: "INIXY", name: "Kandla", countryCode: "IN" },
  { code: "INVTZ", name: "Visakhapatnam", countryCode: "IN" },
  { code: "THLCH", name: "Laem Chabang", countryCode: "TH" },
  { code: "THBKK", name: "Bangkok", countryCode: "TH" },
  { code: "THSGZ", name: "Songkhla", countryCode: "TH" },
  { code: "PHMNL", name: "Manila", countryCode: "PH" },
  { code: "PHCEB", name: "Cebu", countryCode: "PH" },
  { code: "PHSFS", name: "Subic Bay", countryCode: "PH" },
  { code: "PHBTG", name: "Batangas", countryCode: "PH" },
  { code: "PHDVO", name: "Davao", countryCode: "PH" },
  // Americas and Oceania
  { code: "MXZLO", name: "Manzanillo", countryCode: "MX" },
  { code: "MXVER", name: "Veracruz", countryCode: "MX" },
  { code: "MXLZC", name: "Lazaro Cardenas", countryCode: "MX" },
  { code: "MXATM", name: "Altamira", countryCode: "MX" },
  { code: "MXESE", name: "Ensenada", countryCode: "MX" },
  { code: "BRSSZ", name: "Santos", countryCode: "BR" },
  { code: "BRPNG", name: "Paranagua", countryCode: "BR" },
  { code: "BRITJ", name: "Itajai", countryCode: "BR" },
  { code: "BRRIO", name: "Rio de Janeiro", countryCode: "BR" },
  { code: "BRSUA", name: "Suape", countryCode: "BR" },
  { code: "COCTG", name: "Cartagena", countryCode: "CO" },
  { code: "COBUN", name: "Buenaventura", countryCode: "CO" },
  { code: "COBAQ", name: "Barranquilla", countryCode: "CO" },
  { code: "COSMR", name: "Santa Marta", countryCode: "CO" },
  { code: "UYMVD", name: "Montevideo", countryCode: "UY" },
  { code: "AUSYD", name: "Sydney (Port Botany)", countryCode: "AU" },
  { code: "AUMEL", name: "Melbourne", countryCode: "AU" },
  { code: "AUBNE", name: "Brisbane", countryCode: "AU" },
  { code: "AUFRE", name: "Fremantle", countryCode: "AU" },
  { code: "AUADL", name: "Adelaide", countryCode: "AU" },
];

export const ALL_PORTS: readonly Seaport[] = [
  ...EGYPT_PORTS,
  ...DESTINATION_PORTS,
];

/**
 * The ports worth suggesting for a given Incoterm.
 *
 * `customerCountryCode` floats the customer's own ports to the top for CIF —
 * the port being named is nearly always in their country, and scrolling past
 * ninety others to reach it is the kind of small friction that makes people
 * stop using the field.
 */
export function suggestedPorts(
  incotermCode: string,
  customerCountryCode?: string,
): readonly Seaport[] {
  if (incotermCode === "DDP") return [];
  if (incotermCode === "FOB" || incotermCode === "EXW") return EGYPT_PORTS;
  if (!customerCountryCode) return DESTINATION_PORTS;
  const home = DESTINATION_PORTS.filter(
    (port) => port.countryCode === customerCountryCode,
  );
  if (home.length === 0) return DESTINATION_PORTS;
  return [
    ...home,
    ...DESTINATION_PORTS.filter(
      (port) => port.countryCode !== customerCountryCode,
    ),
  ];
}

/** "Jeddah (SAJED)" — the label shown in the suggestion list. */
export function portLabel(port: Seaport): string {
  return `${port.name} (${port.code})`;
}
