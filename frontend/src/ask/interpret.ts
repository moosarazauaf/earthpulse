/**
 * Plain-language requests, such as "floods in Layyah in August 2022" or "how
 * much has Lake Urmia shrunk since 2000", turned into an analysis recipe.
 *
 * It runs in the browser with rules, not a language model: the site has no
 * server to hold a model key, and rules are predictable. Every guess it makes
 * is written down as a note, and the visitor confirms before anything runs.
 */
import type { SharedRun } from "../app/shareRun";
import type { AoiGeometry, IndexId } from "../app/types";
import { quickActions, spread } from "../area/actions";
import { hotSeason } from "../engine/heat";
import { FIRST_YEAR as MAP_FIRST, LAST_YEAR as MAP_LAST } from "../engine/urban";

export type AskKind = "flood" | "burn" | "vegetation" | "water" | "urban" | "trees" | "heat" | "series";

export interface Ask {
  kind: AskKind;
  place: string | null;
  point: { lat: number; lon: number } | null;
  years: number[];
  /** "since 2000", "from 2000": one year that starts a range ending now. */
  since: boolean;
  months: [number, number] | null;
  sizeKm: number | null;
  index: IndexId | null;
}

// Order matters: the first kind whose words appear wins ("river floods" is a flood).
const KINDS: [AskKind, RegExp][] = [
  ["flood", /\b(flood\w*|inundat\w*|submerg\w*|waterlogg\w*)/i],
  ["burn", /\b(burn\w*|fires?|wildfires?|bushfires?|scorch\w*)\b/i],
  ["trees", /\b(deforest\w*|forests?|trees?|canopy|logging|jungle)\b/i],
  ["urban", /\b(urban\w*|built|built-up|sprawl|construction|buildings?|settlements?|housing|grow\w*|grew)\b/i],
  ["heat", /\b(heat\w*|hot\w*|temperatures?|lst|thermal|cool\w*)\b/i],
  ["series", /\b(trends?|series|over the years|every year|decades?)\b/i],
  ["water", /\b(water|lakes?|reservoirs?|dams?|wetlands?|shr[iu]nk\w*|dr(y|ied|ying) up|drought)\b/i],
  ["vegetation", /\b(vegetation|green\w*|ndvi|crops?|farm\w*|agricultur\w*|chang\w*)\b/i],
];
const INDEX = /\b(ndvi|ndwi|mndwi|ndbi)\b/i;
/** Nouns that are also parts of place names ("Lake Urmia", "Black Forest"): a request only with a date beside them. */
const PLACE_NOUNS = /\b(lakes?|rivers?|reservoirs?|dams?|wetlands?|forests?|jungles?)\b/gi;
const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const MONTH_WORDS = new Map<string, number>(MONTH_NAMES.flatMap((name, i) => [[name.toLowerCase(), i + 1], [name.slice(0, 3).toLowerCase(), i + 1]]));
MONTH_WORDS.set("sept", 9);
const PREPOSITIONS = new Set(["in", "at", "around", "near", "of", "for", "over", "across", "inside", "within"]);
// Words that never belong to a place name. Geographic nouns (lake, river, forest, dam) are left out on purpose.
const SKIP = new Set(
  ("a an the is are was were be been has have had did do does how much many what where when which why who show me map " +
  "find see check tell give analyse analyze analysis measure compare between from since to and or vs versus during this " +
  "last past recent recently now today currently year years month months ago km kilometre kilometres kilometer kilometers " +
  "square area region loss lost gain gained change changed changes changing growth flooding flooded floods flood burned " +
  "burnt burn burning fire fires wildfire wildfires deforestation heat hot hotter temperature temperatures trend trends " +
  "series water vegetation green greenery cover urban built-up built sprawl expansion expanded grow growing grew grown shrink " +
  "shrunk shrinking shrank dried dry drying up get gets got it its there here please surface ground land").split(" "),
);

const YEAR = /^(19[89]\d|20[0-4]\d)$/;
const monthOf = (word: string) => MONTH_WORDS.get(word.toLowerCase()) ?? 0;

/** The request in structured form, or null when the text names no analysis (then it is a place search). */
export function interpret(text: string): Ask | null {
  const dated = /\b(19[89]\d|20[0-4]\d)\b/.test(text) || text.split(/\W+/).some((w) => monthOf(w) > 0);
  const kindIn = (t: string) => KINDS.find(([, words]) => words.test(t))?.[0] ?? (INDEX.test(t) ? "vegetation" : null);
  const kind = kindIn(text.replace(PLACE_NOUNS, " ")) ?? (dated ? kindIn(text) : null);
  if (!kind) return null;
  const index = (text.match(INDEX)?.[1]?.toLowerCase() ?? null) as IndexId | null;

  const coords = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)/);
  const point = coords && coords[1]!.includes(".") && Math.abs(Number(coords[1])) <= 90 && Math.abs(Number(coords[2])) <= 180
    ? { lat: Number(coords[1]), lon: Number(coords[2]) }
    : null;
  const rest = point ? text.replace(coords![0], " ") : text;

  const size = rest.match(/(\d+(?:\.\d+)?)\s*(km|kilomet)/i);
  const tokens = rest.replace(/(\d+(?:\.\d+)?)\s*(km|kilomet\w*)/gi, " ").split(/\s+/).map((t) => t.replace(/^[("'“]+|[?!.)"'”:;]+$/g, "")).filter(Boolean);
  const years = [...new Set(tokens.filter((t) => YEAR.test(t)).map(Number))].sort((a, b) => a - b);
  const monthList = tokens.map(monthOf).filter((m) => m > 0);
  const months: [number, number] | null = monthList.length ? [monthList[0]!, monthList[monthList.length - 1]!] : null;
  const since = years.length === 1 && /\b(since|from|after)\s+(19|20)\d\d\b/i.test(rest);

  return { kind, place: point ? null : placeIn(tokens), point, years, since, months, sizeKm: size ? Number(size[1]) : null, index };
}

/** The words naming the place: after the last preposition that is followed by one, else every word that is not a request word. */
function placeIn(tokens: string[]): string | null {
  const isWord = (t: string) => {
    const bare = t.replace(/,$/, "").toLowerCase();
    return !SKIP.has(bare) && !PREPOSITIONS.has(bare) && !YEAR.test(bare) && !monthOf(bare) && !INDEX.test(bare) && !/^\d/.test(bare);
  };
  for (let i = tokens.length - 2; i >= 0; i -= 1) {
    if (!PREPOSITIONS.has(tokens[i]!.toLowerCase())) continue;
    const run: string[] = [];
    for (let j = i + 1; j < tokens.length && isWord(tokens[j]!); j += 1) run.push(tokens[j]!);
    if (run.length) return run.join(" ").replace(/,$/, "");
  }
  const words = tokens.filter(isWord);
  return words.length ? words.join(" ").replace(/,$/, "") : null;
}

const DAY_MS = 86_400_000;
const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const monthStart = (y: number, m: number) => Date.UTC(y, m - 1, 1);
const monthEnd = (y: number, m: number) => Date.UTC(y, m, 0);
export type Plan = { run: SharedRun; notes: string[] } | { error: string };

/**
 * The recipe for a request over an area, built on the same defaults as the
 * one-click analyses, with every assumption listed in `notes`.
 */
export function planFor(ask: Ask, aoi: AoiGeometry, label: string, lat: number, maxPixels: number, now = new Date()): Plan {
  const notes: string[] = [];
  const quick = quickActions(aoi, label, now, lat);
  const base = (id: string) => quick.find((q) => q.action.id === id)!.action.request as Record<string, unknown>;
  const thisYear = now.getUTCFullYear();
  const lastYear = thisYear - 1;
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const ys = ask.years;
  const range = () => (ask.since || ys.length === 1 ? [ys[0]!, lastYear] : [ys[0]!, ys[ys.length - 1]!]);
  const run = (kind: SharedRun["kind"], request: Record<string, unknown>): Plan => ({ run: { kind, request: request as SharedRun["request"], maxPixels }, notes });

  // A dated window for events (floods, fires): the months named, in the year named.
  const eventWindow = (fallbackMonths: [number, number] | null): { start: number; end: number } | string => {
    if (!ys.length && !ask.months) return "recent";
    let [m1, m2] = ask.months ?? fallbackMonths ?? [0, 0];
    if (!m1) return "Say which month, for example \"fire near Athens in August 2023\": a whole year hides a burn scar.";
    if (m2 < m1) [m1, m2] = [m2, m1];
    let y = ys[ys.length - 1];
    if (y === undefined) {
      y = monthStart(thisYear, m1) <= today ? thisYear : lastYear;
      notes.push(`No year given: assumed ${y}.`);
    } else if (!ask.months) notes.push(`No month given: assumed ${MONTH_NAMES[m1 - 1]} to ${MONTH_NAMES[m2 - 1]}; name the month to change it.`);
    const start = monthStart(y, m1);
    if (start > today) return `${MONTH_NAMES[m1 - 1]} ${y} has not happened yet.`;
    return { start, end: Math.min(monthEnd(y, m2), today) };
  };

  switch (ask.kind) {
    case "flood": {
      const w = eventWindow([8, 9]);
      if (typeof w === "string" && w !== "recent") return { error: w };
      if (w === "recent") {
        notes.push("No date given: the last 14 days against 20 to 50 days ago.");
        return run("flood", base("flood"));
      }
      if (w.start < Date.UTC(2014, 9, 1)) return { error: "Flood mapping uses Sentinel-1 radar, which starts in October 2014. For older floods try \"water in this place in 2010\"." };
      notes.push("Before the flood: the 75 to 15 days before the window, from the same radar orbit.");
      return run("flood", { ...base("flood"), before: { start: day(w.start - 75 * DAY_MS), end: day(w.start - 15 * DAY_MS) }, flood: { start: day(w.start), end: day(w.end) } });
    }
    case "burn": {
      const w = eventWindow(null);
      if (typeof w === "string" && w !== "recent") return { error: w };
      if (w === "recent") {
        notes.push("No date given: the last 30 days against 35 to 75 days ago.");
        return run("change", base("burn"));
      }
      const dataset = w.start < Date.UTC(2017, 0, 1) ? "landsat" : "sentinel2";
      if (dataset === "landsat") notes.push("Before 2017, so Landsat (30 m) instead of Sentinel-2.");
      notes.push("Before the fire: the 75 to 35 days before the window.");
      return run("change", { ...base("burn"), dataset, before: { start: day(w.start - 75 * DAY_MS), end: day(w.start - 35 * DAY_MS) }, after: { start: day(w.start), end: day(w.end) } });
    }
    case "vegetation": {
      const index = ask.index ?? "ndvi";
      const [a, b] = ys.length ? range() : [2000, lastYear];
      if (!ys.length) notes.push(`No years given: 2000 against ${lastYear}.`);
      else if (ys.length === 1) notes.push(`One year given: ${a} against ${b}.`);
      if (a === b) return { error: "Name two different years to compare, for example \"vegetation change in Lahore 2000 to 2024\"." };
      const [m1, m2] = ask.months ?? [1, 12];
      if (ask.months) notes.push(`Only ${MONTH_NAMES[m1 - 1]} to ${MONTH_NAMES[m2 - 1]} of each year, so seasons match.`);
      const period = (y: number) => ({ start: day(monthStart(y, m1)), end: day(monthEnd(y, m2)) });
      return run("change", { ...base("vegetation"), index, before: period(a!), after: period(b!) });
    }
    case "water": {
      let years = ys.length >= 2 && !ask.since ? ys : ys.length ? spread(ys[0]!, lastYear, 5) : (base("water").years as number[]);
      if (years.length > 9) years = spread(years[0]!, years[years.length - 1]!, 9);
      if (!ys.length) notes.push("No years given: 1990 to last year.");
      return run("water", { ...base("water"), years });
    }
    case "series": {
      const [a, b] = ys.length ? range() : [1990, lastYear];
      if (!ys.length) notes.push("No years given: 1990 to last year.");
      return run("timeseries", { ...base("series"), years: spread(a!, b!, 8) });
    }
    case "heat": {
      const r = { ...base("heat") };
      if (ys.length >= 2) Object.assign(r, { year: ys[ys.length - 1], compareYear: ys[0] });
      else if (ys.length === 1) Object.assign(r, ask.since ? { year: lastYear, compareYear: ys[0] } : { year: ys[0], compareYear: null });
      else notes.push(`No year given: ${lastYear} against 2015.`);
      if (ask.months) Object.assign(r, { startMonth: ask.months[0], endMonth: ask.months[1] });
      else notes.push(`Season: ${hotSeason(lat).label}, the hottest months at this latitude.`);
      return run("heat", r);
    }
    case "urban":
    case "trees": {
      const focus = ask.kind === "trees" ? 2 : 7;
      if (focus === 2 && ys.some((y) => y < MAP_FIRST)) {
        const first = Math.max(1985, ys[0]!);
        const last = ys.length >= 2 && !ask.since ? ys[ys.length - 1]! : lastYear;
        const season = hotSeason(lat);
        notes.push(`Before ${MAP_FIRST}, so canopy loss from the Landsat record (drops in NBR on dense canopy), ${season.label} composites.`);
        return run("disturbance", { aoi, label, years: spread(first, last, 8), startMonth: season.startMonth, endMonth: season.endMonth, threshold: 0.25, forestNbr: 0.4, maxCloud: 30 });
      }
      const clamp = (y: number) => Math.min(MAP_LAST, Math.max(MAP_FIRST, y));
      let first = MAP_FIRST, last = MAP_LAST;
      if (ys.length >= 2) [first, last] = [clamp(ys[0]!), clamp(ys[ys.length - 1]!)];
      else if (ys.length === 1) [first, last] = ys[0]! >= MAP_LAST ? [MAP_FIRST, MAP_LAST] : [clamp(ys[0]!), MAP_LAST];
      if (ys.some((y) => y < MAP_FIRST || y > MAP_LAST)) notes.push(`The annual land-cover maps cover ${MAP_FIRST} to ${MAP_LAST}, so the years were moved inside that range.`);
      if (first === last) [first, last] = [MAP_FIRST, MAP_LAST];
      return run("urban", { ...base(focus === 2 ? "trees" : "urban"), firstYear: first, lastYear: last });
    }
  }
}
