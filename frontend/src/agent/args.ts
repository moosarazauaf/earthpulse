/** The model's tool arguments, checked before use: anything out of range is dropped, not trusted. */
import type { Ask, AskKind } from "../ask/interpret";

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
  "Checking a Google Earth Engine Sentinel-1 flood script for mixed orbits, compositing and other mistakes",
];
export const COMING = "Still in progress: land cover classification, measuring and elevation profiles, map images and year-to-year comparisons by request. Until then they are in the Analyse menu and the toolbar.";

const ASKS_ABILITIES = /^\s*(help|\?|what (can|do) you (do|run)|what are you|which analys[ie]s|what analys[ie]s|capabilities)\b/i;
export const asksAbilities = (text: string) => ASKS_ABILITIES.test(text);
export const abilitiesText = () => `I can run these now:\n${CAN_RUN.map((c) => `• ${c}`).join("\n")}\n\n${COMING}`;
