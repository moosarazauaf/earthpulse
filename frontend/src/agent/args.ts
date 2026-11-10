/** The model's tool arguments, checked before use: anything out of range is dropped, not trusted. */
import type { Ask, AskKind } from "../ask/interpret";
import type { Message } from "./agent";

export const KINDS: AskKind[] = ["flood", "burn", "vegetation", "water", "urban", "trees", "heat", "series"];
export const ISO = /^\d{4}-\d{2}-\d{2}$/;

export const int = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null);
export const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
export const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);

export function askFromArgs(a: Record<string, unknown>, now = new Date()): Ask | string {
  const kind = KINDS.find((k) => k === a.kind);
  if (!kind) return "Unknown analysis kind.";
  const lat = num(a.lat, -90, 90), lon = num(a.lon, -180, 180);
  const years = Array.isArray(a.years) ? a.years.map((y) => int(y, 1984, now.getUTCFullYear())).filter((y): y is number => y !== null).sort() : [];
  const m = Array.isArray(a.months) ? a.months.map((x) => int(x, 1, 12)).filter((x): x is number => x !== null) : [];
  return {
    kind,
    place: str(a.place, 120),
    point: lat !== null && lon !== null ? { lat, lon } : null,
    years: [...new Set(years)],
    since: false,
    months: m.length ? [m[0]!, m[m.length - 1]!] : null,
    sizeKm: num(a.size_km, 1, 50),
    index: (["ndvi", "ndwi", "mndwi", "ndbi"] as const).find((i) => i === a.index) ?? null,
  };
}


/** An exact flood window from the model, if both dates are real, in order and within the Sentinel-1 era. */
export function floodDates(a: Record<string, unknown>, now = new Date()): { start: string; end: string } | null {
  const start = str(a.flood_start, 10), end = str(a.flood_end, 10);
  if (!start || !end || !ISO.test(start) || !ISO.test(end) || Number.isNaN(Date.parse(start)) || Number.isNaN(Date.parse(end))) return null;
  return start <= end && start >= "2014-10-01" && start <= now.toISOString().slice(0, 10) ? { start, end } : null;
}

const CLAIMS_RESULT = /\b(has|have|was|were) been (generated|created|produced|mapped|completed|run)\b|\b(resulting|generated) map\b|\bmap (now )?shows\b|\bflooded area (is|was|covers)\b/i;

/** A planned run has no result yet; a reply that says otherwise is replaced, whatever the model wrote. */
export function honest(text: string, cards: { kind: string; findings: { level: string }[] }[]): string {
  if (!cards.some((c) => c.kind === "plan") || !CLAIMS_RESULT.test(text)) return text;
  const warn = cards.some((c) => c.findings.some((f) => f.level !== "ok"));
  return `The plan is ready${warn ? "; read the checks below first" : ""}. Nothing has run yet: press Run in the side panel to map it.`;
}

/** What the assistant can run today, shown when it opens and when asked; keep in step with the tools. */
export const CAN_RUN = [
  "Flood mapping with Sentinel-1 radar (2014 on), checked for mixed orbits and compositing before it runs",
  "Burn scars, vegetation change, surface water through the years, urban growth, tree cover loss, land surface temperature and index time series",
  "Area overview of any place: 7-day forecast and warnings, air quality, solar power, water since 1984, climate, terrain, people and satellite passes",
  "Map layers: wind, clouds, rain, air quality, earthquakes, satellites, population, sea temperature, vegetation, soil moisture, smoke and dust, ozone",
  "Land use and land cover (LULC) of any area: ESA WorldCover 2021, 10 m",
  "Carbon stock in plants and soil, with uncertainty ranges and a chart: biomass (Harmonized Global Biomass, 2010) and soil organic carbon to 30 cm (SoilGrids 2.0)",
  "How many people live in an area (GHS-POP 2020)",
  "GIS tools: buffer an area, terrain statistics with hillshade, slope and aspect maps, area and perimeter, and export to GeoJSON or KML",
  "Saving the map as a publication-ready image, and charts as SVG or 300 dpi PNG",
  "Time-lapse videos of any place through the years, from Landsat (1985 on) or Sentinel-2",
  "Checking a Google Earth Engine Sentinel-1 flood script for mixed orbits, compositing and other mistakes",
];
export const COMING = "Still in progress: land cover classification with your own training samples, measuring and elevation profiles, map images and year-to-year comparisons by request. Until then they are in the Analyse menu and the toolbar.";

const ASKS_ABILITIES = /^\s*(help|\?|what (can|do) you (do|run)|what are you|which analys[ie]s|what analys[ie]s|capabilities)\b/i;
export const asksAbilities = (text: string) => ASKS_ABILITIES.test(text);
export const abilitiesText = () => `I can run these now:\n${CAN_RUN.map((c) => `• ${c}`).join("\n")}\n\n${COMING}`;

/** The last messages, starting at a user message so a tool reply is never cut from its call. */
export function trimHistory(messages: Message[], max = 30): Message[] {
  if (messages.length <= max) return messages;
  const tail = messages.slice(-max);
  const start = tail.findIndex((m) => m.role === "user");
  return start < 0 ? [] : tail.slice(start);
}

/**
 * The place in a request typed without a model, with the command and question
 * words around it removed: "Open Lahore, Pakistan" is "Lahore, Pakistan".
 * Searched as typed, the whole sentence finds an open-air theatre in Lahore.
 */
export function placeFromText(text: string): string {
  return text.trim()
    .replace(/^(please\s+)?(open|show( me)?|go to|fly to|zoom( in)? to|take me to|find|where is|tell me about)\s+/i, "")
    .replace(/^(what('s| is)\s+the\s+)?(weather|forecast|air quality|outlook)(\s+(outlook|forecast))?\s+(for|in|at|of)\s+/i, "")
    .replace(/^(the\s+)?(area|overview)\s+(of|for|around)\s+/i, "")
    .replace(/[?.!]+$/, "")
    .trim();
}

/** Without a model: land cover and carbon requests, with the place after "of", "in" or "for" ("here" means the open area). */
type OfflineTool = "land_cover" | "carbon_stock" | "people_count" | "save_map" | "time_lapse" | "buffer" | "terrain" | "measure_area" | "export_area";
const HERE = /^(here|there|this|it|the same place|this area|this view)$/i;
const placeAfter = (text: string): string | null => {
  const m = /\b(?:of|in|for|at|around)\s+(.+?)[.?!]*$/i.exec(text.trim());
  return m && !HERE.test(m[1]!.trim()) ? m[1]!.trim() : null;
};

export function offlineIntent(text: string): { tool: OfflineTool; place: string | null; args?: Record<string, unknown> } | null {
  const buffered = /\bbuffer\b/i.test(text) ? /([\d.]+)\s*(km|kilomet\w*|m|met\w*)\b/i.exec(text) : null;
  if (/\bbuffer\b/i.test(text)) {
    const km = buffered ? Number(buffered[1]) / (/^k/i.test(buffered[2]!) ? 1 : 1000) : 1;
    return { tool: "buffer", place: placeAfter(text.replace(/([\d.]+)\s*(km|kilomet\w*|m|met\w*)\b/i, "").replace(/\bbuffer\b/i, "")), args: { km } };
  }
  if (/\b(export|download|save)\b.*\b(geojson|kml|boundary|outline|area|shape)\b/i.test(text)) return { tool: "export_area", place: null, args: { format: /\bkml\b/i.test(text) ? "kml" : "geojson" } };
  const relief = /\b(hillshade|slope|aspect)\b/i.exec(text);
  if (relief || /\b(terrain|elevation|relief|zonal)\b/i.test(text)) return { tool: "terrain", place: placeAfter(text), args: relief ? { map: relief[1]!.toLowerCase() } : {} };
  if (/\b(perimeter|centroid|bounding box|how (big|large)|measure (this|the) area|size of)\b/i.test(text)) return { tool: "measure_area", place: placeAfter(text) };
  if (/\btime-?\s?lapse\b/i.test(text)) {
    const m = /\b(?:of|in|for|at)\s+(.+?)[.?!]*$/i.exec(text.trim());
    return { tool: "time_lapse", place: m && !/^(here|there|this|it|this area|this view)$/i.test(m[1]!.trim()) ? m[1]!.trim() : null };
  }
  if (/\b(save|make|export|download|print)\b.*\b(map|image|figure)\b/i.test(text)) return { tool: "save_map", place: null };
  const tool = /\b(carbon|biomass)\b/i.test(text) ? "carbon_stock" : /\b(land ?cover|land use|lulc)\b/i.test(text) ? "land_cover"
    : /\b(people|population|inhabitants|how many live)\b/i.test(text) ? "people_count" : null;
  if (!tool) return null;
  const m = /\b(?:of|in|for|at)\s+(.+?)[.?!]*$/i.exec(text.trim());
  const place = m && !/^(here|there|this|it|the same place|this area)$/i.test(m[1]!.trim()) ? m[1]!.trim() : null;
  return { tool, place };
}

/**
 * Example questions, a fresh handful each time the chat opens or is cleared.
 * Every one is something the tools can run, with real places and real event dates.
 */
export const EXAMPLE_POOL = [
  "Map the floods in Layyah, Pakistan, from 25 August to 5 September 2022",
  "Floods in Dadu, Pakistan, in September 2022",
  "Floods in Sylhet, Bangladesh, in June 2022",
  "Floods in Derna, Libya, in September 2023",
  "Floods in Valencia, Spain, from 29 October to 10 November 2024",
  "Burn scar near Lahaina, Hawaii, August 2023",
  "Burn scar near Jasper, Canada, July 2024",
  "Burn scars in Evia, Greece, August 2021",
  "How much has Lake Urmia shrunk since 2000?",
  "Surface water of Manchar Lake from 2000 to 2024",
  "How has the Aral Sea changed since 1990?",
  "Urban growth of Lahore since 2000",
  "How fast has Dubai grown since 2000?",
  "Built-up growth of Islamabad since 2017",
  "Tree cover loss in Rondonia, Brazil, since 2017",
  "Forest loss near Swat, Pakistan",
  "Vegetation change in Cholistan from 2000 to 2024",
  "NDVI every year in Faisalabad since 2000",
  "Land surface temperature in Jacobabad in June 2024",
  "Heat in Karachi in May 2024",
  "Land cover of Islamabad",
  "LULC of the Nile delta near Tanta, Egypt",
  "Land use around Peshawar",
  "Carbon stock of Murree, Pakistan",
  "How much carbon is stored in the Sundarbans?",
  "Carbon stock of the forests around Abbottabad",
  "What is the weather outlook for Karachi?",
  "Air quality outlook for Lahore",
  "Will it rain in Islamabad this week?",
  "Solar power potential in Quetta",
  "Has Nowshera flooded before? Show water since 1984",
  "When do Landsat and Sentinel next pass over Multan?",
  "Show wind and sea temperature",
  "Show smoke and dust today",
  "Show earthquakes from the past week",
  "Show soil moisture and rain",
  "How many people live in Peshawar?",
  "Population of Hyderabad, Pakistan",
  "Make a map of this view",
  "Make a time-lapse of Dubai",
  "Slope map of Murree, Pakistan",
  "Hillshade of Hunza",
  "Buffer 5 km around Layyah, Pakistan",
  "How big is this area? Area and perimeter",
  "Terrain of Quetta",
  "Time-lapse of Lake Urmia",
];

/** `n` different examples in random order; "What can you do?" always comes first. */
export function pickExamples(n = 4, random: () => number = Math.random): string[] {
  const pool = [...EXAMPLE_POOL];
  for (let i = pool.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [pool[i], pool[j]] = [pool[j]!, pool[i]!];
  }
  return ["What can you do?", ...pool.slice(0, n - 1)];
}
