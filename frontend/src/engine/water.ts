/**
 * WaterWatch: surface-water extent through time, computed in the browser.
 *
 * For each year a cloud-free composite is built and classified with MNDWI
 * (Xu 2006). The yearly maps give the area series, how persistent each water
 * pixel is, and what was lost or gained between the first and last year.
 */
import type { AoiGeometry } from "../app/types";
import { type Grid, buildGrid, projectAoi, rasterMask } from "./geo";
import { BANDS, FIRST_YEAR, NATIVE_RES, type OpticalDataset, type Scene, landsatPlatforms, searchScenes, selectScenes } from "./pc";
import { compositeBands, normalizedDifference, toGeographicRgba } from "./raster";

export const SOFTWARE_VERSION = "0.2.0-alpha.2";
const M2_PER_HA = 10_000;
/** Scenes per path/row or tile, and per year in total. Fewer than the backend uses, to suit a browser. */
const SCENES_PER_FOOTPRINT = 2;
const MAX_SCENES_PER_YEAR = 6;
/** Share of the area that must be observed in a year for its total to be trusted. */
const MIN_VALID_FRACTION = 0.9;

// Pixel codes in the yearly maps.
export const NO_DATA = 0;
export const LAND = 1;
export const WATER = 2;

const WATER_RGB: [number, number, number] = [45, 140, 240];
const LOST_RGB: [number, number, number] = [255, 138, 92];
const GAINED_RGB: [number, number, number] = [95, 208, 197];
const STABLE_RGB: [number, number, number] = [30, 80, 170];
/** Persistence ramp, from seen once to always water. */
const PERSISTENCE_RAMP: [number, number, number][] = [[198, 226, 255], [110, 175, 245], [45, 110, 215], [12, 44, 132]];

export interface WaterRequest {
  aoi: AoiGeometry;
  label: string;
  dataset: OpticalDataset;
  years: number[];
  startMonth: number;
  endMonth: number;
  /** MNDWI above this is water. Xu (2006) used 0. */
  threshold: number;
  maxCloud: number;
  /** Pixel budget and parallel downloads, chosen from the visitor's device. */
  maxPixels: number;
  concurrency: number;
}

export interface Progress {
  stage: "ACQUIRING_DATA" | "PROCESSING_IMAGERY" | "DETECTING_CHANGE" | "GENERATING_RESULTS";
  done: number;
  total: number;
  detail: string;
}

export interface EngineHooks {
  progress: (p: Progress) => void;
  /** Encode an RGBA image as PNG. Supplied by the worker, which owns a canvas. */
  encode: (rgba: Uint8ClampedArray, width: number, height: number) => Promise<Blob>;
  signal?: AbortSignal;
}

export interface WaterYear {
  year: number;
  period: [string, string];
  status: "OBSERVED" | "NO_DATA";
  reason?: string;
  waterHa: number | null;
  validFraction: number;
  platforms: string[];
  scenes: { id: string; datetime: string; platform: string; cloudCover: number | null; footprint: string }[];
}

export interface EngineOverlay {
  title: string;
  blob: Blob;
  bounds: [number, number, number, number];
  legend: { classes: { label: string; color: string }[] } | { min: number; max: number; colors: string[]; unit?: string };
}

// ---- pure building blocks (unit tested) ---------------------------------------
/** Classify MNDWI into NO_DATA / LAND / WATER inside the area mask. */
export function classifyWater(mndwi: Float32Array, mask: Uint8Array, threshold: number): Uint8Array {
  const out = new Uint8Array(mndwi.length);
  for (let i = 0; i < mndwi.length; i += 1) {
    const v = mndwi[i] as number;
    if (mask[i] && !Number.isNaN(v)) out[i] = v > threshold ? WATER : LAND;
  }
  return out;
}

/** Ordinary least-squares slope and intercept. Returns null with fewer than three points. */
export function linearTrend(points: [number, number][]): { slope: number; intercept: number; n: number } | null {
  const n = points.length;
  if (n < 3) return null;
  const meanX = points.reduce((s, p) => s + p[0], 0) / n;
  const meanY = points.reduce((s, p) => s + p[1], 0) / n;
  let sxy = 0, sxx = 0;
  for (const [x, y] of points) {
    sxy += (x - meanX) * (y - meanY);
    sxx += (x - meanX) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: meanY - slope * meanX, n };
}

/** Per-pixel counts across the yearly maps: years observed and years water. */
export function persistence(maps: Uint8Array[]): { observed: Uint8Array; water: Uint8Array } {
  const length = maps[0]?.length ?? 0;
  const observed = new Uint8Array(length);
  const water = new Uint8Array(length);
  for (const map of maps) {
    for (let i = 0; i < length; i += 1) {
      const v = map[i] as number;
      if (v !== NO_DATA) observed[i] = (observed[i] as number) + 1;
      if (v === WATER) water[i] = (water[i] as number) + 1;
    }
  }
  return { observed, water };
}

function paint(rgba: Uint8ClampedArray, i: number, rgb: [number, number, number]) {
  rgba[i * 4] = rgb[0];
  rgba[i * 4 + 1] = rgb[1];
  rgba[i * 4 + 2] = rgb[2];
  rgba[i * 4 + 3] = 255;
}
const hex = (rgb: [number, number, number]) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;
const pad = (n: number) => String(n).padStart(2, "0");

function periodFor(year: number, startMonth: number, endMonth: number): [string, string] {
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  const today = new Date().toISOString().slice(0, 10);
  const end = `${year}-${pad(endMonth)}-${pad(lastDay)}`;
  return [`${year}-${pad(startMonth)}-01`, end > today ? today : end];
}

// ---- the analysis ----------------------------------------------------------------
export async function runWater(request: WaterRequest, hooks: EngineHooks) {
  const { dataset } = request;
  const aoi = projectAoi(request.aoi);
  const grid: Grid = buildGrid(aoi, NATIVE_RES[dataset], request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  let insidePixels = 0;
  for (const m of mask) insidePixels += m;
  const warnings: string[] = [];

  // 1. Find the scenes for every year first, so the total amount of work is known.
  let searched = 0;
  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: request.years.length, detail: "Searching the archive" });
  const plan = await Promise.all(request.years.map(async (year) => {
    const period = periodFor(year, request.startMonth, request.endMonth);
    if (year < FIRST_YEAR[dataset]) {
      return { year, period, scenes: [] as Scene[], reason: `This archive starts in ${FIRST_YEAR[dataset]}.` };
    }
    const found = await searchScenes(dataset, aoi.lonLatBounds, period[0], period[1], request.maxCloud, hooks.signal);
    const scenes = selectScenes(found, SCENES_PER_FOOTPRINT, MAX_SCENES_PER_YEAR);
    const note = dataset === "landsat" ? landsatPlatforms(year).note : null;
    if (note && !warnings.includes(note)) warnings.push(note);
    searched += 1;
    hooks.progress({ stage: "ACQUIRING_DATA", done: searched, total: request.years.length, detail: `Found ${scenes.length} scenes for ${year}` });
    return { year, period, scenes, reason: scenes.length ? undefined : `No scene with at most ${request.maxCloud}% cloud in this window.` };
  }));

  // 2. Build and classify one composite per year.
  const filesPerScene = 3; // green, SWIR-1 and the quality layer
  const total = plan.reduce((sum, p) => sum + p.scenes.length * filesPerScene, 0);
  let done = 0;
  const series: WaterYear[] = [];
  const maps: { year: number; map: Uint8Array }[] = [];
  for (const item of plan) {
    const base = { year: item.year, period: item.period, platforms: [] as string[], scenes: [] as WaterYear["scenes"] };
    if (!item.scenes.length) {
      series.push({ ...base, status: "NO_DATA", reason: item.reason, waterHa: null, validFraction: 0 });
      continue;
    }
    const composite = await compositeBands(dataset, BANDS[dataset], ["green", "swir1"], item.scenes, grid, request.concurrency, () => {
      done += 1;
      hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading ${item.year}: file ${done} of ${total}` });
    }, hooks.signal);
    const mndwi = normalizedDifference(composite.bands.green as Float32Array, composite.bands.swir1 as Float32Array);
    const map = classifyWater(mndwi, mask, request.threshold);
    let valid = 0, water = 0;
    for (const v of map) {
      if (v !== NO_DATA) valid += 1;
      if (v === WATER) water += 1;
    }
    const validFraction = insidePixels ? valid / insidePixels : 0;
    series.push({
      ...base,
      status: "OBSERVED",
      waterHa: water * pixelHa,
      validFraction,
      platforms: [...new Set(item.scenes.map((s) => s.platform))].sort(),
      scenes: item.scenes.map((s) => ({ id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: s.cloudCover, footprint: s.footprint })),
    });
    maps.push({ year: item.year, map });
  }
  if (!maps.length) throw new Error("No usable imagery was found for any of the selected years.");

  // 3. Persistence and first-to-last change.
  hooks.progress({ stage: "DETECTING_CHANGE", done: total, total, detail: "Comparing the years" });
  const { observed, water } = persistence(maps.map((m) => m.map));
  const first = maps[0] as { year: number; map: Uint8Array };
  const last = maps[maps.length - 1] as { year: number; map: Uint8Array };
  let permanent = 0, occasional = 0, lost = 0, gained = 0, stable = 0;
  for (let i = 0; i < observed.length; i += 1) {
    const w = water[i] as number;
    if (w > 0 && w === observed[i]) permanent += 1;
    else if (w > 0) occasional += 1;
    const a = first.map[i], b = last.map[i];
    if (a === WATER && b === LAND) lost += 1;
    else if (a === LAND && b === WATER) gained += 1;
    else if (a === WATER && b === WATER) stable += 1;
  }
  const reliable = series.filter((s) => s.status === "OBSERVED" && s.validFraction >= MIN_VALID_FRACTION);
  const trend = linearTrend(reliable.map((s) => [s.year, s.waterHa as number]));
  const partial = series.filter((s) => s.status === "OBSERVED" && s.validFraction < MIN_VALID_FRACTION).map((s) => s.year);
  if (partial.length) {
    warnings.push(`Less than ${MIN_VALID_FRACTION * 100}% of the area had clear observations in ${partial.join(", ")}. Those totals are low estimates and are left out of the trend.`);
  }
  const sensors = new Set(series.flatMap((s) => s.platforms));
  if (sensors.size > 1) warnings.push(`The series spans several sensors (${[...sensors].sort().join(", ")}). No cross-sensor harmonisation was applied.`);

  // 4. Images for the globe.
  hooks.progress({ stage: "GENERATING_RESULTS", done: total, total, detail: "Drawing the maps" });
  const overlays: Record<string, EngineOverlay> = {};
  async function addOverlay(key: string, title: string, legend: EngineOverlay["legend"], colour: (i: number) => [number, number, number] | null) {
    const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
    for (let i = 0; i < grid.width * grid.height; i += 1) {
      const rgb = colour(i);
      if (rgb) paint(rgba, i, rgb);
    }
    const image = toGeographicRgba(rgba, grid);
    overlays[key] = { title, legend, bounds: image.bounds, blob: await hooks.encode(image.data, image.width, image.height) };
  }
  const steps = PERSISTENCE_RAMP.length;
  await addOverlay("persistence", "Water persistence", { min: 0, max: 100, colors: PERSISTENCE_RAMP.map(hex), unit: "% of observed years" }, (i) => {
    const w = water[i] as number;
    if (!w) return null;
    return PERSISTENCE_RAMP[Math.min(steps - 1, Math.floor((w / (observed[i] as number)) * steps - 1e-9))] as [number, number, number];
  });
  await addOverlay("change", `Water ${first.year} to ${last.year}`, {
    classes: [
      { label: `Water in ${first.year}, land in ${last.year}`, color: hex(LOST_RGB) },
      { label: `Land in ${first.year}, water in ${last.year}`, color: hex(GAINED_RGB) },
      { label: "Water in both", color: hex(STABLE_RGB) },
    ],
  }, (i) => {
    const a = first.map[i], b = last.map[i];
    if (a === WATER && b === LAND) return LOST_RGB;
    if (a === LAND && b === WATER) return GAINED_RGB;
    return a === WATER && b === WATER ? STABLE_RGB : null;
  });
  for (const { year, map } of maps) {
    await addOverlay(`y${year}`, `Water in ${year}`, { classes: [{ label: `Water in ${year}`, color: hex(WATER_RGB) }] },
      (i) => (map[i] === WATER ? WATER_RGB : null));
  }

  const firstHa = (series.find((s) => s.year === first.year)?.waterHa ?? 0) as number;
  const lastHa = (series.find((s) => s.year === last.year)?.waterHa ?? 0) as number;
  return {
    type: "water" as const,
    label: request.label,
    softwareVersion: SOFTWARE_VERSION,
    request,
    aoi: request.aoi,
    valueKind: "DERIVED" as const,
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      firstYear: first.year,
      lastYear: last.year,
      firstHa,
      lastHa,
      changeHa: lastHa - firstHa,
      changePercent: firstHa > 0 ? ((lastHa - firstHa) / firstHa) * 100 : null,
      lostHa: lost * pixelHa,
      gainedHa: gained * pixelHa,
      stableHa: stable * pixelHa,
      permanentHa: permanent * pixelHa,
      occasionalHa: occasional * pixelHa,
      trendHaPerYear: trend?.slope ?? null,
      trendYears: trend?.n ?? reliable.length,
      threshold: request.threshold,
    },
    series,
    overlays,
    warnings,
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}

export type WaterEngineResult = Awaited<ReturnType<typeof runWater>>;
