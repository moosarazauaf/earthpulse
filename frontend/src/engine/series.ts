/**
 * Index series: the mean of four spectral indices over an area, year by year,
 * computed in the browser. Same method as the backend's series: one clear-sky
 * median composite per year and season, indices averaged over the observed
 * pixels inside the area. Missing years stay missing.
 */
import type { AoiGeometry, IndexId, SeriesEntry } from "../app/types";
import { type EngineHooks, M2_PER_HA, mean } from "./common";
import { type Grid, buildGrid, projectAoi, rasterMask } from "./geo";
import { BANDS, FIRST_YEAR, NATIVE_RES, type OpticalDataset, type Scene, landsatPlatforms, searchScenes, seasonWindow, selectScenes } from "./pc";
import { compositeBands, normalizedDifference } from "./raster";
import { linearTrend } from "./water";

const SCENES_PER_FOOTPRINT = 2;
const MAX_SCENES_PER_YEAR = 6;
/** Below this share of the area observed, a year's mean describes only part of it. */
const MIN_VALID_FRACTION = 0.6;

export interface SeriesRequest {
  aoi: AoiGeometry;
  label: string | null;
  dataset: OpticalDataset;
  years: number[];
  startMonth: number;
  endMonth: number;
  maxCloud: number;
  maxPixels: number;
  concurrency: number;
}

/** Index name, numerator band and denominator band; all are (a - b) / (a + b). */
export const SERIES_INDICES: { id: IndexId; a: string; b: string }[] = [
  { id: "ndvi", a: "nir", b: "red" },
  { id: "ndwi", a: "green", b: "nir" },
  { id: "mndwi", a: "green", b: "swir1" },
  { id: "ndbi", a: "swir1", b: "nir" },
];


/** Change per decade from a least-squares line, or null with fewer than three years. */
export function trendPerDecade(points: [number, number][]): { perDecade: number; n: number } | null {
  const fit = linearTrend(points);
  return fit ? { perDecade: fit.slope * 10, n: fit.n } : null;
}

export async function runSeries(request: SeriesRequest, hooks: EngineHooks) {
  const { dataset } = request;
  const aoi = projectAoi(request.aoi);
  const grid: Grid = buildGrid(aoi, NATIVE_RES[dataset], request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  let inside = 0;
  for (const m of mask) inside += m;
  const warnings: string[] = [];

  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: request.years.length, detail: "Searching the archive" });
  let searched = 0;
  const plan = await Promise.all(request.years.map(async (year) => {
    const period = seasonWindow(year, request.startMonth, request.endMonth);
    if (year < FIRST_YEAR[dataset]) return { year, period, scenes: [] as Scene[], reason: `This archive starts in ${FIRST_YEAR[dataset]}.` };
    const found = await searchScenes(dataset, aoi.lonLatBounds, period[0], period[1], request.maxCloud, hooks.signal);
    const scenes = selectScenes(found, SCENES_PER_FOOTPRINT, MAX_SCENES_PER_YEAR);
    const note = dataset === "landsat" ? landsatPlatforms(year).note : null;
    if (note && !warnings.includes(note)) warnings.push(note);
    searched += 1;
    hooks.progress({ stage: "ACQUIRING_DATA", done: searched, total: request.years.length, detail: `Found ${scenes.length} scenes for ${year}` });
    return { year, period, scenes, reason: scenes.length ? undefined : `No scene with at most ${request.maxCloud}% cloud in this window.` };
  }));

  const bands = ["green", "red", "nir", "swir1"];
  const total = plan.reduce((sum, p) => sum + p.scenes.length * (bands.length + 1), 0);
  let done = 0;
  const series: SeriesEntry[] = [];
  const allScenes: Record<string, ReturnType<typeof publicScene>[]> = {};
  for (const item of plan) {
    const base = { year: item.year, period: item.period };
    if (!item.scenes.length) {
      series.push({ ...base, status: "NO_DATA" as const, reason: item.reason, values: null });
      continue;
    }
    const composite = await compositeBands(dataset, BANDS[dataset], bands, item.scenes, grid, request.concurrency, () => {
      done += 1;
      hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading ${item.year}: file ${done} of ${total}` });
    }, hooks.signal);
    hooks.progress({ stage: "CALCULATING_INDICES", done, total, detail: `Indices for ${item.year}` });
    const values = {} as Record<IndexId, number | null>;
    let valid = 0;
    const use = new Uint8Array(mask.length);
    const ndvi = normalizedDifference(composite.bands.nir as Float32Array, composite.bands.red as Float32Array);
    for (let i = 0; i < mask.length; i += 1) {
      if (mask[i] && !Number.isNaN(ndvi[i] as number)) { use[i] = 1; valid += 1; }
    }
    for (const index of SERIES_INDICES) {
      const v = normalizedDifference(composite.bands[index.a] as Float32Array, composite.bands[index.b] as Float32Array);
      values[index.id] = mean(v, use);
    }
    values.nbr = null;
    const validFraction = inside ? valid / inside : 0;
    series.push({
      ...base,
      status: "OBSERVED" as const,
      values,
      validFraction,
      platforms: [...new Set(item.scenes.map((s) => s.platform))].sort(),
      scenes: item.scenes.map(publicScene),
    });
    allScenes[String(item.year)] = item.scenes.map(publicScene);
  }
  if (!series.some((s) => s.values)) throw new Error("No usable imagery was found for any of the selected years.");

  const partial = series.filter((s) => s.values && (s.validFraction ?? 0) < MIN_VALID_FRACTION).map((s) => s.year);
  if (partial.length) warnings.push(`In ${partial.join(", ")} less than ${MIN_VALID_FRACTION * 100}% of the area had a clear view; those means describe only part of it and are left out of the trends.`);
  const sensors = new Set(series.flatMap((s) => s.platforms ?? []));
  if (sensors.size > 1) warnings.push(`The series spans several sensors (${[...sensors].sort().join(", ")}). No cross-sensor harmonisation was applied, so small steps between sensors are not change.`);

  const reliable = series.filter((s) => s.values && (s.validFraction ?? 0) >= MIN_VALID_FRACTION);
  const trends: Record<string, { perDecade: number; n: number } | null> = {};
  for (const index of SERIES_INDICES) {
    trends[index.id] = trendPerDecade(reliable.flatMap((s) => (s.values?.[index.id] == null ? [] : [[s.year, s.values[index.id] as number] as [number, number]])));
  }

  const { maxPixels: _budget, concurrency: _parallel, ...stored } = request;
  void _budget;
  void _parallel;
  return {
    type: "timeseries" as const,
    label: request.label,
    request: stored,
    aoi: request.aoi,
    valueKind: "DERIVED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        "For each year and season: per-pixel median of clear-sky surface reflectance from the clearest scenes; " +
        "NDVI, NDWI, MNDWI and NDBI computed on the composite and averaged over the observed pixels inside the area.",
      cloudMask: dataset === "landsat"
        ? "QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow rejected"
        : "SCL: no data, saturated, cloud shadow, cloud (medium/high), cirrus and snow rejected",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: NATIVE_RES[dataset],
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      maxCloudPercent: request.maxCloud,
      scenes: allScenes,
      uncertainty:
        "Area means hide what happens inside the area: a rise in one part and a fall in another cancel out. Trends are " +
        "least-squares lines through the years with a clear view of most of the area, with no significance test; with " +
        "a handful of points treat them as a description, not a finding.",
    },
    summary: { aoiAreaHa: aoi.areaM2 / M2_PER_HA, trends },
    series,
    overlays: {},
    warnings,
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}

function publicScene(s: Scene) {
  return { id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: s.cloudCover, footprint: s.footprint };
}
