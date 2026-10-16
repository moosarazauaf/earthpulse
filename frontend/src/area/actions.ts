/**
 * One-click analyses for an area. Each has fixed, stated defaults, so a
 * visitor can go from "this place" to a result without filling in a form;
 * the full form for each analysis is still there to change them.
 */
import type { AoiGeometry, ChangeRequest, FloodRequest, TimeSeriesRequest } from "../app/types";
import type { AnalysisMode } from "../ui/modes";
import { hotSeason } from "../engine/heat";

const DAY_MS = 86_400_000;
const MAX_CLOUD = 20;

export type QuickAction =
  | { id: "vegetation"; kind: "change"; request: ChangeRequest }
  | { id: "burn"; kind: "fire"; request: ChangeRequest }
  | { id: "flood"; kind: "flood"; request: FloodRequest }
  | { id: "water"; kind: "water"; request: { aoi: AoiGeometry; label: string; dataset: "landsat"; years: number[]; startMonth: number; endMonth: number; threshold: number; maxCloud: number } }
  | { id: "series"; kind: "series"; request: TimeSeriesRequest }
  | { id: "heat"; kind: "heat"; request: { aoi: AoiGeometry; label: string; year: number; compareYear: number | null; startMonth: number; endMonth: number; maxCloud: number } }
  | { id: "urban" | "trees"; kind: "urban"; request: { aoi: AoiGeometry; label: string; firstYear: number; lastYear: number; focus: 2 | 7 } };

export interface QuickActionInfo {
  action: QuickAction;
  label: string;
  explain: string;
  mode: AnalysisMode;
  /** Rough relative cost, shown so a visitor on a slow connection can choose. */
  weight: "light" | "medium" | "heavy";
}

const day = (t: number) => new Date(t).toISOString().slice(0, 10);

export function quickActions(aoi: AoiGeometry, label: string, now = new Date(), lat = centreLat(aoi)): QuickActionInfo[] {
  const season = hotSeason(lat);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const lastYear = now.getUTCFullYear() - 1;
  const whole = { startMonth: 1, endMonth: 12 };
  return [
    {
      label: "What changed since 2000?",
      explain: `Vegetation (NDVI) in 2000 against ${lastYear}, whole-year Landsat composites, with the changed areas outlined.`,
      mode: "change",
      weight: "medium",
      action: {
        id: "vegetation", kind: "change",
        request: { aoi, label, dataset: "landsat", index: "ndvi", before: { start: "2000-01-01", end: "2000-12-31" }, after: { start: `${lastYear}-01-01`, end: `${lastYear}-12-31` }, maxCloud: MAX_CLOUD, minAreaHa: 0.5 },
      },
    },
    {
      label: "Index series since 1990",
      explain: `Mean NDVI, NDWI, MNDWI and NDBI over the area for 8 years from 1990 to ${lastYear}, with trends.`,
      mode: "research",
      weight: "heavy",
      action: { id: "series", kind: "series", request: { aoi, label, dataset: "landsat", years: spread(1990, lastYear, 8), ...whole, maxCloud: MAX_CLOUD } },
    },
    {
      label: "Surface water through time",
      explain: `Water mapped in 1990, 2000, 2010, 2020 and ${lastYear}, with what was lost and gained.`,
      mode: "water",
      weight: "heavy",
      action: { id: "water", kind: "water", request: { aoi, label, dataset: "landsat", years: [1990, 2000, 2010, 2020, lastYear], ...whole, threshold: 0, maxCloud: MAX_CLOUD } },
    },
    {
      label: "Built-up growth, 2017 to 2023",
      explain: "Built area each year from the annual 10 m land-cover maps, and what it replaced.",
      mode: "cities",
      weight: "light",
      action: { id: "urban", kind: "urban", request: { aoi, label, firstYear: 2017, lastYear: 2023, focus: 7 } },
    },
    {
      label: "Tree cover, 2017 to 2023",
      explain: "Tree cover each year from the same maps, where it was lost and gained, and what replaced it.",
      mode: "forests",
      weight: "light",
      action: { id: "trees", kind: "urban", request: { aoi, label, firstYear: 2017, lastYear: 2023, focus: 2 } },
    },
    {
      label: "How hot does the ground get?",
      explain: `Landsat surface temperature, ${season.label} ${lastYear}, against 2015, and how much cooler green ground is.`,
      mode: "heat",
      weight: "medium",
      action: { id: "heat", kind: "heat", request: { aoi, label, year: lastYear, compareYear: 2015, startMonth: season.startMonth, endMonth: season.endMonth, maxCloud: MAX_CLOUD } },
    },
    {
      label: "Is it flooded now?",
      explain: "Sentinel-1 radar from the last 14 days against 20 to 50 days ago. Radar sees through cloud.",
      mode: "floods",
      weight: "heavy",
      action: { id: "flood", kind: "flood", request: { aoi, label, before: { start: day(today - 50 * DAY_MS), end: day(today - 20 * DAY_MS) }, flood: { start: day(today - 14 * DAY_MS), end: day(today) }, minAreaHa: 1 } },
    },
    {
      label: "Has it burned recently?",
      explain: "Burn severity (dNBR) from Sentinel-2: the last 30 days against 35 to 75 days ago.",
      mode: "fires",
      weight: "medium",
      action: { id: "burn", kind: "fire", request: { aoi, label, dataset: "sentinel2", index: "nbr", before: { start: day(today - 75 * DAY_MS), end: day(today - 35 * DAY_MS) }, after: { start: day(today - 30 * DAY_MS), end: day(today) }, threshold: 0.1, maxCloud: MAX_CLOUD, minAreaHa: 1 } },
    },
  ];
}

/** `count` years spread evenly from first to last, both included. */
export function spread(first: number, last: number, count: number): number[] {
  if (count <= 1 || last <= first) return [first];
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round(first + ((last - first) * i) / (count - 1))))];
}

function centreLat(aoi: AoiGeometry): number {
  const ring = aoi.type === "Polygon" ? aoi.coordinates[0]! : aoi.coordinates[0]![0]!;
  const lats = ring.map((p) => p[1]!);
  return (Math.min(...lats) + Math.max(...lats)) / 2;
}
