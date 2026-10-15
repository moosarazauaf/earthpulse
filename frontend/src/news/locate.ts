/**
 * Where a headline is about, from the place names in it.
 *
 * Names are looked up in the GeoNames gazetteer: towns of 15,000 people or
 * more, first-level regions (provinces, states) and countries. A town is
 * trusted when its country is also named, or when it is large enough that the
 * name is rarely meant as something else. When only a country is named the
 * marker goes to the middle of the country and says so.
 */
import type { NewsPlace } from "./types";

export interface GazPlace {
  name: string;
  /** Country name; empty for a country. */
  country: string;
  cc: string;
  lat: number;
  lon: number;
  pop: number;
  kind: NewsPlace["precision"];
  /** GeoNames first-level region code, "US.CA"; empty for countries. */
  admin1: string;
}

export interface Gazetteer {
  /** Normalised name to every place with that name. */
  byName: Map<string, GazPlace[]>;
  /** ISO code to the country entry. */
  countries: Map<string, GazPlace>;
}

/** Lower case, accents removed, curly apostrophes straightened. */
export function normalise(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[’‘]/g, "'").toLowerCase();
}

/**
 * Place names that are also ordinary words or names in headlines. They are
 * never matched; a story about one of these towns is still found through its
 * region or country.
 */
const BLOCKED = new Set([
  "of", "police", "march", "may", "june", "july", "august", "most", "best", "mobile", "nice", "reading", "bath", "split",
  "man", "bar", "van", "union", "independence", "liberty", "hurricane", "storm", "flood", "fire", "rain", "sale", "deal",
  "hope", "paradise", "temple", "university", "normal", "golden", "orange", "pearl", "eagle", "enterprise", "commerce",
  "why", "ash", "lava", "crater", "delta", "central", "north", "south", "east", "west", "mercedes", "harvey", "florence",
  "milton", "beryl", "helene", "victoria", "georgetown", "kingston", "richmond", "jackson", "lincoln", "washington",
  "franklin", "clinton", "hamilton", "wellington", "marion", "aurora", "concord", "salem", "springfield", "columbia",
  "president", "prime", "minister", "chief", "new", "un", "red", "cross", "crescent", "media", "mass", "rescue",
  "city", "capital", "san", "santa", "santo", "saint", "st", "port", "bay", "lake", "river", "valley", "island",
  "islands", "coast", "gulf", "sea", "ocean", "world", "africa", "asia", "europe", "america", "americas", "pacific",
  "atlantic", "middle", "weather", "met", "office", "agency", "relief", "aid", "early", "warning", "alert", "monsoon",
  "typhoon", "cyclone", "tornado", "quake", "earthquake", "volcano", "wildfire", "bushfire", "heatwave", "drought",
  "date", "phoenix", "mosul", "sur", "bo", "lo", "ma", "la", "le", "da", "de", "el", "al", "as", "is", "it", "at",
]);

/** Abbreviations that are only place names when written in capitals. */
const ACRONYMS: Record<string, string> = {
  US: "US", USA: "US", UK: "GB", UAE: "AE", DRC: "CD", PNG: "PG", NZ: "NZ", KSA: "SA", PRC: "CN", ROK: "KR", DPRK: "KP",
};

/** Other names and adjectives that point to a country. Keys are normalised. */
export const COUNTRY_ALIASES: Record<string, string> = {
  "united states": "US", "u.s.": "US", britain: "GB", "great britain": "GB", british: "GB",
  england: "GB", scotland: "GB", wales: "GB", "northern ireland": "GB", scottish: "GB", welsh: "GB",
  russia: "RU", russian: "RU", "south korea": "KR", "north korea": "KP", korean: "KR", "south korean": "KR",
  "north korean": "KP", iran: "IR", iranian: "IR", syria: "SY", syrian: "SY", vietnam: "VN", vietnamese: "VN",
  laos: "LA", bolivia: "BO", venezuela: "VE", tanzania: "TZ", "czech republic": "CZ", czechia: "CZ", turkey: "TR",
  turkiye: "TR", turkish: "TR", "ivory coast": "CI", "cote d'ivoire": "CI", "congo": "CD", "dr congo": "CD",
  "democratic republic of congo": "CD", "democratic republic of the congo": "CD", "republic of congo": "CG",
  burma: "MM", myanmar: "MM", "east timor": "TL", "timor-leste": "TL", moldova: "MD", taiwan: "TW", taiwanese: "TW",
  palestine: "PS", gaza: "PS", "west bank": "PS", "cape verde": "CV", eswatini: "SZ", swaziland: "SZ", macedonia: "MK",
  "north macedonia": "MK", micronesia: "FM", "hong kong": "HK", macau: "MO", indian: "IN", pakistani: "PK",
  chinese: "CN", japanese: "JP", indonesian: "ID", afghan: "AF", nepali: "NP", nepalese: "NP", bangladeshi: "BD",
  "sri lankan": "LK", filipino: "PH", philippine: "PH", thai: "TH", malaysian: "MY", australian: "AU",
  "new zealand": "NZ", mexican: "MX", brazilian: "BR", argentine: "AR", argentinian: "AR", chilean: "CL",
  peruvian: "PE", colombian: "CO", ecuadorian: "EC", guatemalan: "GT", honduran: "HN", haitian: "HT", cuban: "CU",
  canadian: "CA", french: "FR", german: "DE", italian: "IT", spanish: "ES", portuguese: "PT", greek: "GR",
  icelandic: "IS", nigerian: "NG", kenyan: "KE", ethiopian: "ET", somali: "SO", sudanese: "SD", "south sudanese": "SS",
  mozambican: "MZ", malawian: "MW", zimbabwean: "ZW", "south african": "ZA", moroccan: "MA", algerian: "DZ",
  libyan: "LY", egyptian: "EG", yemeni: "YE", saudi: "SA", omani: "OM", iraqi: "IQ", israeli: "IL", lebanese: "LB",
  jordanian: "JO", kazakh: "KZ", uzbek: "UZ", tajik: "TJ", kyrgyz: "KG", mongolian: "MN", ukrainian: "UA",
  romanian: "RO", polish: "PL", austrian: "AT", swiss: "CH", norwegian: "NO", swedish: "SE", finnish: "FI",
  danish: "DK", dutch: "NL", belgian: "BE", irish: "IE", "the philippines": "PH", "the gambia": "GM", gambia: "GM",
  "the bahamas": "BS", bahamas: "BS", "the netherlands": "NL", holland: "NL", "papua new guinea": "PG",
  "solomon islands": "SB", "marshall islands": "MH", "cook islands": "CK", "puerto rico": "PR", "guam": "GU",
};

/**
 * Volcanoes that make the news, which a town gazetteer does not contain.
 * Summit positions to about 0.05 degrees.
 */
export const VOLCANOES: { names: string[]; cc: string; lat: number; lon: number }[] = [
  { names: ["etna", "mount etna"], cc: "IT", lat: 37.75, lon: 14.99 },
  { names: ["stromboli"], cc: "IT", lat: 38.79, lon: 15.21 },
  { names: ["vesuvius", "mount vesuvius"], cc: "IT", lat: 40.82, lon: 14.43 },
  { names: ["campi flegrei"], cc: "IT", lat: 40.83, lon: 14.14 },
  { names: ["kilauea"], cc: "US", lat: 19.41, lon: -155.29 },
  { names: ["mauna loa"], cc: "US", lat: 19.48, lon: -155.61 },
  { names: ["mount spurr"], cc: "US", lat: 61.3, lon: -152.25 },
  { names: ["merapi", "mount merapi"], cc: "ID", lat: -7.54, lon: 110.45 },
  { names: ["semeru", "mount semeru"], cc: "ID", lat: -8.11, lon: 112.92 },
  { names: ["lewotobi", "lewotobi laki-laki"], cc: "ID", lat: -8.54, lon: 122.78 },
  { names: ["marapi", "mount marapi"], cc: "ID", lat: -0.38, lon: 100.47 },
  { names: ["mount ibu"], cc: "ID", lat: 1.49, lon: 127.63 },
  { names: ["mount ruang", "ruang"], cc: "ID", lat: 2.3, lon: 125.37 },
  { names: ["sinabung", "mount sinabung"], cc: "ID", lat: 3.17, lon: 98.39 },
  { names: ["sakurajima"], cc: "JP", lat: 31.59, lon: 130.66 },
  { names: ["popocatepetl"], cc: "MX", lat: 19.02, lon: -98.62 },
  { names: ["fuego", "volcan de fuego"], cc: "GT", lat: 14.47, lon: -90.88 },
  { names: ["taal", "taal volcano"], cc: "PH", lat: 14.0, lon: 120.99 },
  { names: ["mayon", "mayon volcano"], cc: "PH", lat: 13.26, lon: 123.69 },
  { names: ["kanlaon", "mount kanlaon", "kanlaon volcano"], cc: "PH", lat: 10.41, lon: 123.13 },
  { names: ["shiveluch"], cc: "RU", lat: 56.65, lon: 161.36 },
  { names: ["klyuchevskoy"], cc: "RU", lat: 56.06, lon: 160.64 },
  { names: ["nyiragongo"], cc: "CD", lat: -1.52, lon: 29.25 },
  { names: ["fagradalsfjall", "grindavik", "sundhnukur", "reykjanes"], cc: "IS", lat: 63.88, lon: -22.37 },
  { names: ["cotopaxi"], cc: "EC", lat: -0.68, lon: -78.44 },
  { names: ["villarrica"], cc: "CL", lat: -39.42, lon: -71.93 },
  { names: ["whakaari", "white island"], cc: "NZ", lat: -37.52, lon: 177.18 },
  { names: ["hunga tonga"], cc: "TO", lat: -20.55, lon: -175.39 },
];

// ---- building the gazetteer from GeoNames files ---------------------------------------

function add(map: Map<string, GazPlace[]>, name: string, place: GazPlace) {
  const key = normalise(name);
  if (!key || BLOCKED.has(key)) return;
  const list = map.get(key);
  if (!list) map.set(key, [place]);
  else if (!list.some((p) => p.cc === place.cc && p.kind === place.kind && p.name === place.name)) list.push(place);
}

/** Area-weighted centroid of the largest polygon of a country outline. */
export function outlineCentre(geometry: { type: string; coordinates: unknown }): [number, number] | null {
  const polygons = (geometry.type === "Polygon" ? [geometry.coordinates] : geometry.type === "MultiPolygon" ? geometry.coordinates : []) as number[][][][];
  let best: { area: number; x: number; y: number } | null = null;
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (!ring || ring.length < 4) continue;
    let a = 0, cx = 0, cy = 0;
    for (let i = 0; i < ring.length - 1; i++) {
      const [x0 = 0, y0 = 0] = ring[i]!;
      const [x1 = 0, y1 = 0] = ring[i + 1]!;
      const cross = x0 * y1 - x1 * y0;
      a += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
    if (a === 0) continue;
    const area = Math.abs(a / 2);
    if (!best || area > best.area) best = { area, x: cx / (3 * a), y: cy / (3 * a) };
  }
  return best ? [best.x, best.y] : null;
}

/**
 * Build the gazetteer from the text of GeoNames' cities15000.txt,
 * admin1CodesASCII.txt and countryInfo.txt, and the country outlines in
 * shapes_simplified_low.json.
 */
export function buildGazetteer(cities: string, admin1: string, countryInfo: string, shapes: { features: { properties: { geoNameId: string }; geometry: { type: string; coordinates: unknown } }[] }): Gazetteer {
  const centres = new Map<string, [number, number]>();
  for (const feature of shapes.features) {
    const centre = outlineCentre(feature.geometry);
    if (centre) centres.set(String(feature.properties.geoNameId), centre);
  }

  const byName = new Map<string, GazPlace[]>();
  const countries = new Map<string, GazPlace>();
  const countryName = new Map<string, string>();
  for (const line of countryInfo.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const f = line.split("\t");
    const cc = f[0] ?? "", name = f[4] ?? "", id = f[16] ?? "";
    const centre = centres.get(id);
    if (!cc || !name || !centre) continue;
    const place: GazPlace = { name, country: "", cc, lon: centre[0], lat: centre[1], pop: Number(f[7]) || 0, kind: "country", admin1: "" };
    countries.set(cc, place);
    countryName.set(cc, name);
    add(byName, name, place);
  }
  for (const [alias, cc] of Object.entries(COUNTRY_ALIASES)) {
    const place = countries.get(cc);
    if (place) add(byName, alias, place);
  }

  // Regions get the population-weighted centre of their towns: GeoNames gives them no position.
  const regionSums = new Map<string, { x: number; y: number; w: number; pop: number }>();
  const towns: { f: string[]; lat: number; lon: number; pop: number }[] = [];
  for (const line of cities.split("\n")) {
    const f = line.split("\t");
    const lat = Number(f[4]), lon = Number(f[5]), pop = Number(f[14]) || 0;
    if (!f[1] || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    towns.push({ f, lat, lon, pop });
    const key = `${f[8]}.${f[10]}`;
    const sum = regionSums.get(key) ?? { x: 0, y: 0, w: 0, pop: 0 };
    const w = Math.max(pop, 1);
    sum.x += lon * w; sum.y += lat * w; sum.w += w; sum.pop += pop;
    regionSums.set(key, sum);
  }
  for (const { f, lat, lon, pop } of towns) {
    const cc = f[8] ?? "";
    const place: GazPlace = { name: f[1]!, country: countryName.get(cc) ?? cc, cc, lat, lon, pop, kind: "city", admin1: `${cc}.${f[10]}` };
    add(byName, f[1]!, place);
    if (f[2] && f[2] !== f[1]) add(byName, f[2], place);
  }
  for (const line of admin1.split("\n")) {
    const f = line.split("\t");
    const sum = regionSums.get(f[0] ?? "");
    if (!f[1] || !sum || sum.w === 0) continue;
    const cc = (f[0] ?? "").split(".")[0] ?? "";
    const place: GazPlace = { name: f[1], country: countryName.get(cc) ?? cc, cc, lon: sum.x / sum.w, lat: sum.y / sum.w, pop: sum.pop, kind: "region", admin1: f[0] ?? "" };
    add(byName, f[1], place);
    if (f[2] && f[2] !== f[1]) add(byName, f[2], place);
  }
  for (const v of VOLCANOES) {
    const place: GazPlace = { name: v.names[0]!.replace(/\b\w/g, (c) => c.toUpperCase()), country: countryName.get(v.cc) ?? v.cc, cc: v.cc, lat: v.lat, lon: v.lon, pop: 1_000_000, kind: "city", admin1: "" };
    for (const name of v.names) add(byName, name, place);
  }
  return { byName, countries };
}

// ---- finding a place in a text -----------------------------------------------------------

/** Lower-case words allowed inside a place name: "Rio de Janeiro", "Bosnia and Herzegovina". */
const CONNECTORS = new Set(["de", "del", "do", "da", "dos", "das", "la", "las", "los", "el", "al", "of", "and", "upon", "on", "sur", "du", "di"]);
/** A name straight after these is a storm's name, not a place. */
const STORM_TITLES = new Set(["hurricane", "typhoon", "cyclone", "storm", "depression"]);
/** Towns smaller than this need their country named in the same text. */
const TRUSTED_POPULATION = 250_000;
const MAX_WORDS = 4;
/** Seas, continents and the like that contain a country name or adjective but are not that country. */
const NOT_PLACES = new Set([
  "indian ocean", "south america", "latin america", "central america", "north america", "south china sea",
  "east china sea", "middle east", "gulf of mexico", "arabian sea", "bay of bengal", "south pacific", "north atlantic",
  "south asia", "east asia", "southeast asia", "south east asia", "central asia", "west africa", "east africa",
  "southern africa", "north africa", "horn of africa", "new year", "british museum", "american red cross",
  "indian army", "indian navy", "japan meteorological agency", "philippine sea", "korean peninsula", "persian gulf",
]);

interface Candidate {
  place: GazPlace;
  inTitle: boolean;
}

function words(text: string): string[] {
  return text
    .replace(/[’‘]/g, "'")
    .split(/[\s,;:()"“”!?/|]+/)
    .map((w) => w.replace(/'s$/, "").replace(/^[.'-]+|[.'-]+$/g, ""))
    .filter(Boolean);
}

const capitalised = (w: string) => /^\p{Lu}/u.test(w);

/** Every gazetteer name in a text, longest match first. */
function candidates(text: string, gazetteer: Gazetteer, inTitle: boolean): { found: Candidate[][]; countries: Set<string> } {
  const tokens = words(text);
  const found: Candidate[][] = [];
  const countries = new Set<string>();
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const acronym = ACRONYMS[token];
    if (acronym) {
      const place = gazetteer.countries.get(acronym);
      if (place) { countries.add(acronym); found.push([{ place, inTitle }]); }
      continue;
    }
    if (!capitalised(token) || STORM_TITLES.has(normalise(tokens[i - 1] ?? ""))) continue;
    for (let n = Math.min(MAX_WORDS, tokens.length - i); n >= 1; n--) {
      const span = tokens.slice(i, i + n);
      if (!capitalised(span[n - 1]!) || span.some((w, k) => k > 0 && !capitalised(w) && !CONNECTORS.has(w))) continue;
      const key = normalise(span.join(" "));
      if (NOT_PLACES.has(key)) { i += n - 1; break; }
      const places = gazetteer.byName.get(key);
      if (!places) continue;
      for (const p of places) if (p.kind === "country") countries.add(p.cc);
      found.push(places.map((place) => ({ place, inTitle })));
      i += n - 1;
      break;
    }
  }
  return { found, countries };
}

const SPECIFICITY = { city: 2, region: 1, country: 0 } as const;

/**
 * The most likely place a headline and its summary are about, or null.
 * `home` is the country of a national outlet, used as weak evidence.
 */
export function locate(title: string, summary: string, gazetteer: Gazetteer, home?: string): NewsPlace | null {
  const a = candidates(title, gazetteer, true);
  const b = candidates(summary, gazetteer, false);
  const named = new Set([...a.countries, ...b.countries]);

  function pick(groups: Candidate[][], inside?: GazPlace): GazPlace | null {
    let best: { score: number; place: GazPlace } | null = null;
    for (const group of groups) {
      // Homonyms: prefer the one in a country the text names, then the outlet's country, then the largest.
      const ranked = [...group].sort((x, y) =>
        Number(named.has(y.place.cc)) - Number(named.has(x.place.cc)) ||
        Number(y.place.cc === home) - Number(x.place.cc === home) ||
        y.place.pop - x.place.pop);
      const { place } = ranked[0]!;
      const confirmed = place.kind === "country" || named.has(place.cc) ? 2 : place.cc === home ? 1 : 0;
      // A town whose country is not named is trusted only if it is large.
      if (place.kind !== "country" && confirmed === 0 && place.pop < TRUSTED_POPULATION) continue;
      if (inside && !(inside.kind === "country" ? place.cc === inside.cc : inside.kind === "region" && place.admin1 === inside.admin1)) continue;
      const score = SPECIFICITY[place.kind] * 10 + confirmed * 5 + Math.log10(place.pop + 1) / 2;
      if (!best || score > best.score) best = { score, place };
    }
    return best?.place ?? null;
  }

  // The headline says where the story is; the summary may only make that more exact.
  const fromTitle = pick(a.found);
  const refined = fromTitle && fromTitle.kind !== "city" ? pick(b.found, fromTitle) : null;
  const p = refined && SPECIFICITY[refined.kind] > SPECIFICITY[fromTitle!.kind] ? refined : fromTitle ?? pick(b.found);
  if (!p) return null;
  return {
    name: p.name,
    country: p.country,
    cc: p.cc,
    lat: Math.round(p.lat * 1000) / 1000,
    lon: Math.round(p.lon * 1000) / 1000,
    precision: p.kind,
  };
}
