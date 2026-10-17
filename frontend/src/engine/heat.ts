/**
 * HeatWatch: land surface temperature in the hot season, from the Landsat
 * Collection 2 surface temperature product, computed in the browser.
 *
 * The median of clear scenes in the season gives a typical late-morning
 * (Landsat passes at about 10:30 local time) ground temperature. It is the
 * temperature of the surface, roofs and roads included, not of the air, and
 * it is not the day's maximum.
 */
import type { AoiGeometry } from "../app/types";
import { type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, hex, makeOverlay, rampImage } from "./common";
import { type Grid, buildGrid, projectAoi, rasterMask } from "./geo";
import { BANDS, FIRST_YEAR, landsatPlatforms, type Scene, searchScenes, seasonWindow, selectScenes } from "./pc";
import { compositeBands, normalizedDifference } from "./raster";

const NATIVE_RES = 30;
const SCENES_PER_FOOTPRINT = 3;
const MAX_SCENES = 8;
/** Vegetated and bare or built ground, by NDVI on the same composite. */
const GREEN_NDVI = 0.4;
const BARE_NDVI = 0.2;
const HEAT_RAMP: Rgb[] = [[49, 54, 149], [116, 173, 209], [254, 224, 144], [244, 109, 67], [165, 0, 38]];
const CHANGE_RAMP: Rgb[] = [[33, 102, 172], [146, 197, 222], [247, 247, 247], [244, 165, 130], [178, 24, 43]];

export interface HeatRequest {
  aoi: AoiGeometry;
  label: string;
  year: number;
  /** An earlier year to compare with, or null. */
  compareYear: number | null;
  startMonth: number;
  endMonth: number;
  maxCloud: number;
  maxPixels: number;
  concurrency: number;
}

/** The hottest months by latitude: northern summer, southern summer, and the whole year in the tropics. */
export function hotSeason(lat: number): { startMonth: number; endMonth: number; label: string } {
  if (lat >= 23) return { startMonth: 5, endMonth: 8, label: "May to August" };
  if (lat <= -23) return { startMonth: 1, endMonth: 3, label: "January to March" };
  return { startMonth: 1, endMonth: 12, label: "the whole year" };
}

/** The finite values, sorted, so several quantiles can be read with one sort. */
export function sortedFinite(values: Float32Array): Float32Array {
  let n = 0;
  for (const v of values) if (Number.isFinite(v)) n += 1;
  const out = new Float32Array(n);
  let k = 0;
  for (const v of values) if (Number.isFinite(v)) out[k++] = v;
  return out.sort();
}

/** Value at a quantile (0 to 1) of an already sorted array. */
export function quantileOf(sorted: Float32Array, q: number): number | null {
  if (!sorted.length) return null;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))))]!;
}

/** Value at a quantile of the finite values (0 to 1). */
export function quantile(values: Float32Array, q: number): number | null {
  return quantileOf(sortedFinite(values), q);
}

/** Mean temperature of vegetated and of bare or built pixels, when each covers at least 5% of the area. */
export function greenContrast(lst: Float32Array, ndvi: Float32Array): { green: number; bare: number; greenShare: number; bareShare: number } | null {
  let g = 0, gn = 0, b = 0, bn = 0, n = 0;
  for (let i = 0; i < lst.length; i += 1) {
    const t = lst[i] as number, v = ndvi[i] as number;
    if (!Number.isFinite(t) || !Number.isFinite(v)) continue;
    n += 1;
    if (v >= GREEN_NDVI) { g += t; gn += 1; } else if (v < BARE_NDVI) { b += t; bn += 1; }
  }
  if (!n || gn < 0.05 * n || bn < 0.05 * n) return null;
  return { green: g / gn, bare: b / bn, greenShare: gn / n, bareShare: bn / n };
}


export async function runHeat(request: HeatRequest, hooks: EngineHooks) {
  const aoi = projectAoi(request.aoi);
  const grid: Grid = buildGrid(aoi, NATIVE_RES, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const years = request.compareYear !== null ? [request.compareYear, request.year] : [request.year];
  const warnings: string[] = [];

  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: years.length, detail: "Searching for Landsat scenes" });
  const plans = await Promise.all(years.map(async (year) => {
    if (year < FIRST_YEAR.landsat) throw new Error(`Landsat starts in ${FIRST_YEAR.landsat}.`);
    const [start, end] = seasonWindow(year, request.startMonth, request.endMonth);
    const found = await searchScenes("landsat", aoi.lonLatBounds, start, end, request.maxCloud, hooks.signal);
    const scenes = selectScenes(found, SCENES_PER_FOOTPRINT, MAX_SCENES);
    if (!scenes.length) throw new Error(`No Landsat scene with at most ${request.maxCloud}% cloud in ${start} to ${end}. The archive has gaps in some years and regions: try a year either side.`);
    const note = landsatPlatforms(year).note;
    if (note && !warnings.includes(note)) warnings.push(note);
    return { year, period: [start, end] as [string, string], scenes };
  }));

  const total = plans.reduce((sum, p) => sum + p.scenes.length * 4, 0);
  let done = 0;
  const composites: { year: number; lst: Float32Array; ndvi: Float32Array; scenes: Scene[]; period: [string, string] }[] = [];
  for (const plan of plans) {
    const c = await compositeBands("landsat", BANDS.landsat, ["lst", "red", "nir"], plan.scenes, grid, request.concurrency, () => {
      done += 1;
      hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading ${plan.year}: file ${done} of ${total}` });
    }, hooks.signal);
    const lst = c.bands.lst as Float32Array;
    for (let i = 0; i < lst.length; i += 1) if (!mask[i]) lst[i] = NaN;
    composites.push({ year: plan.year, lst, ndvi: normalizedDifference(c.bands.nir as Float32Array, c.bands.red as Float32Array), scenes: plan.scenes, period: plan.period });
  }

  hooks.progress({ stage: "CALCULATING_INDICES", done: total, total, detail: "Summarising temperatures" });
  const latest = composites[composites.length - 1]!;
  const stats = (lst: Float32Array) => {
    const sorted = sortedFinite(lst);
    let sum = 0;
    for (const v of sorted) sum += v;
    const n = sorted.length;
    return { mean: n ? sum / n : null, p10: quantileOf(sorted, 0.1), p90: quantileOf(sorted, 0.9), p98: quantileOf(sorted, 0.98), max: quantileOf(sorted, 1), n };
  };
  const now = stats(latest.lst);
  if (now.mean === null) throw new Error("No clear view of the ground in the chosen season.");
  let inside = 0;
  for (const m of mask) inside += m;
  const validFraction = now.n / Math.max(inside, 1);
  if (validFraction < 0.6) warnings.push(`Only ${Math.round(validFraction * 100)}% of the area had a clear view in ${latest.year}; the figures describe that part.`);
  const contrast = greenContrast(latest.lst, latest.ndvi);

  let comparison: { year: number; mean: number; change: number } | null = null;
  let delta: Float32Array | null = null;
  if (composites.length === 2) {
    const earlier = composites[0]!;
    const then = stats(earlier.lst);
    delta = new Float32Array(latest.lst.length).fill(NaN);
    for (let i = 0; i < delta.length; i += 1) delta[i] = (latest.lst[i] as number) - (earlier.lst[i] as number);
    if (then.mean !== null) comparison = { year: earlier.year, mean: then.mean, change: now.mean - then.mean };
    warnings.push("A single season's median depends on that season's weather; a hotter year is not by itself a trend. Compare several years before drawing conclusions.");
  }

  hooks.progress({ stage: "GENERATING_RESULTS", done: total, total, detail: "Drawing the maps" });
  const lo = Math.floor(now.p10 ?? now.mean - 5), hi = Math.ceil(now.p98 ?? now.mean + 5);
  const overlays: Record<string, EngineOverlay> = {
    lst: await makeOverlay(`Surface temperature, ${latest.year}`, rampImage(latest.lst, lo, hi, HEAT_RAMP), grid,
      { min: lo, max: hi, colors: HEAT_RAMP.map(hex), unit: "°C" }, hooks),
  };
  if (delta && comparison) {
    overlays.change = await makeOverlay(`Change since ${comparison.year}`, rampImage(delta, -6, 6, CHANGE_RAMP), grid,
      { min: -6, max: 6, colors: CHANGE_RAMP.map(hex), unit: "°C" }, hooks);
  }

  const publicScene = (s: Scene) => ({ id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: s.cloudCover, footprint: s.footprint });
  const { maxPixels: _budget, concurrency: _parallel, ...stored } = request;
  void _budget;
  void _parallel;
  return {
    type: "heat" as const,
    label: request.label,
    request: stored,
    aoi: request.aoi,
    valueKind: "DERIVED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        "Landsat Collection 2 Level-2 surface temperature (ST_B10 on Landsat 8 and 9, ST_B6 on 4 to 7), kelvin = DN x " +
        "0.00341802 + 149, converted to °C; per-pixel median of clear scenes in the season. Vegetated and bare or built " +
        `ground split by NDVI from the same scenes (at least ${GREEN_NDVI} and below ${BARE_NDVI}).`,
      cloudMask: "QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow rejected",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: NATIVE_RES,
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      maxCloudPercent: request.maxCloud,
      scenes: Object.fromEntries(composites.map((c) => [String(c.year), c.scenes.map(publicScene)])),
      uncertainty:
        "The USGS product is derived from thermal radiance with emissivity from ASTER and modelled atmosphere; its stated " +
        "accuracy is about 1 to 2 K over most surfaces, worse over water and where emissivity is uncertain. The thermal " +
        "band is collected at 100 m (120 m for Landsat 5) and resampled to 30 m, so small hot spots are blurred.",
    },
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      year: latest.year,
      period: latest.period,
      meanC: now.mean,
      p10C: now.p10,
      p90C: now.p90,
      maxC: now.max,
      validFraction,
      contrast,
      comparison,
    },
    overlays,
    warnings,
    raster: {
      name: `lst-${latest.year}`,
      description: `Median land surface temperature in °C, ${latest.period[0]} to ${latest.period[1]}, Landsat; NaN outside the area or where no clear view.`,
      data: latest.lst, epsg: grid.epsg, west: grid.west, north: grid.north, res: grid.res, width: grid.width, height: grid.height, noData: "nan",
    },
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}

export type HeatEngineResult = Awaited<ReturnType<typeof runHeat>>;
