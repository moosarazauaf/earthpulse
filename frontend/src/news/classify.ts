/**
 * Which natural hazard, if any, a headline is about.
 *
 * Plain keyword rules, written to be read and argued with. Each rule has the
 * words that trigger it, the figurative uses that must not ("a landslide
 * victory", "a flood of complaints"), and for the most abused words a second
 * word that has to appear as well. Nothing here is learned from data.
 */
import type { Hazard } from "./types";

interface Rule {
  hazard: Hazard;
  match: RegExp;
  /** Figurative or unrelated uses; a match here cancels the rule. */
  unless?: RegExp;
  /** A word that must also appear, for words with common figurative uses. */
  needs?: RegExp;
}

/** Order is priority: the first hazard found is the one a story is filed under. */
export const RULES: Rule[] = [
  { hazard: "tsunami", match: /\btsunamis?\b/, unless: /\b(silver )?tsunami of\b/ },
  {
    hazard: "earthquake",
    match: /\b(earthquakes?|quakes?|tremors?|aftershocks?|seismic)\b/,
    unless: /\b(political|electoral|financial|market|youth|cultural)\s+(earthquake|quake)|\bseismic (shift|change|moment)s?\b|\bquake champions\b|\bparkinson/,
  },
  {
    hazard: "volcano",
    match: /\b(volcano(es)?|volcanic|lava|eruptions?|erupted|erupts|erupting|ash (cloud|plume|column)s?)\b/,
    needs: /\b(volcan\w*|lava|ash|magma|crater|pyroclastic)\b/,
  },
  {
    hazard: "landslide",
    match: /\b(landslides?|landslips?|mudslides?|mudflows?|rockfalls?|rockslides?|debris flows?|land subsidence)\b/,
    unless: /\blandslide (victory|win|wins|won|election|defeat|majority|vote|re-?election|mandate|margin|loss)\b|\b(by|in|won|win|wins|winning|lost) a landslide\b/,
    needs: /\b(rains?|rainfall|buried|bury|killed|dead|deaths?|died|missing|rescu\w*|villages?|roads?|highway|slopes?|mud|debris|earthquake|monsoon|homes?|houses?|hills?|hillside|mountains?|swept|trapped|bodies|injured|collapsed?)\b/,
  },
  {
    hazard: "flood",
    match: /\b(floods?|flooding|flooded|floodwaters?|flash-floods?|inundat\w+|deluge)\b/,
    unless: /\bflood(ed|ing|s)? (of|with) (calls|complaints|migrants|refugees|messages|orders|tears|applications|requests|cash|money|imports|goods|emails|letters|tourists|visitors|bids|offers|tributes|support)\b|\bflooded the zone\b|\bflood the zone\b/,
  },
  {
    hazard: "storm",
    match: /\b(cyclones?|hurricanes?|typhoons?|tropical storms?|tropical depressions?|storm surges?|severe storms?|windstorms?|hailstorms?|thunderstorms?|gales?|storm [a-z]+ (hits|batters|lashes|slams|makes landfall|brings))\b/,
    unless: /\b(carolina hurricanes|iowa state cyclones|hurricanes? (beat|win|wins|lose|lost|defeat|rally)|storm shadow|desert storm|brainstorm|political storm|firestorm|storm of (criticism|protest|controversy|outrage))\b/,
  },
  { hazard: "tornado", match: /\b(tornado(es)?|twisters?|waterspouts?)\b/, unless: /\btwisters? (movie|film|sequel)\b/ },
  { hazard: "wildfire", match: /\b(wildfires?|bushfires?|forest fires?|brush ?fires?|grass ?fires?|wild ?fires?|veld ?fires?|peat fires?|fire danger|(toxic|smoke|transboundary|choking) haze|haze from)\b/ },
  {
    hazard: "rain",
    match: /\b((heavy|torrential|incessant|intense|record|monsoon|pre-monsoon|relentless|extreme) (rains?|rainfall|downpours?|showers)|cloudbursts?|downpours?|rainstorms?)\b/,
  },
  { hazard: "heat", match: /\b(heat ?waves?|extreme heat|record heat|scorching heat|heatstroke|heat stroke|record temperatures?)\b/ },
  { hazard: "drought", match: /\b(droughts?|drought-hit|dry spell|water crisis)\b/ },
  { hazard: "winter", match: /\b(avalanches?|blizzards?|snowstorms?|cold waves?|cold snap|extreme cold|winter storms?|ice storms?|heavy snow(fall)?)\b/ },
  { hazard: "dust", match: /\b(sandstorms?|dust ?storms?)\b/ },
];

/** Retrospectives are not news of an event happening now. */
const RETROSPECTIVE = /\b(anniversary|years (after|since|ago|on)|decades? (after|ago|on)|in memory of|commemorat\w+|remembering)\b/;

/** Hazards a text is about, in priority order; empty when it is about none. */
export function classify(text: string): Hazard[] {
  const lower = text.toLowerCase();
  if (RETROSPECTIVE.test(lower)) return [];
  const found: Hazard[] = [];
  for (const rule of RULES) {
    if (!rule.match.test(lower)) continue;
    if (rule.unless?.test(lower)) continue;
    if (rule.needs && !rule.needs.test(lower)) continue;
    found.push(rule.hazard);
  }
  // Named European storms ("Storm Amy") are proper nouns, so they are matched in the original case.
  if (!found.includes("storm") && /\bStorm [A-Z][a-z]+\b/.test(text) && !/\bStorm Shadow\b/.test(text)) {
    const at = RULES.findIndex((r) => r.hazard === "storm");
    const insert = found.findIndex((h) => RULES.findIndex((r) => r.hazard === h) > at);
    found.splice(insert < 0 ? found.length : insert, 0, "storm");
  }
  return found;
}
