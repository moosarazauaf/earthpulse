/**
 * Bi-temporal spectral-index change detection, computed in the browser.
 *
 * Same method as backend/app/services/change_detection.py: a cloud-free median
 * composite per period, the index on both, the difference, and a threshold.
 * It detects that an index changed. It does not say why.
 */
import type { ChangeRequest, IndexId } from "../app/types";
import {
  type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, classImage, findRegions, hex, histogram, makeOverlay, mean, median,
  rampImage, regionsToGeoJson, typicalDayOfYear,
} from "./common";
import { buildGrid, projectAoi, rasterMask } from "./geo";
import { BANDS, FIRST_YEAR, NATIVE_RES, type Scene, landsatPlatforms, searchScenes, selectScenes } from "./pc";
import { compositeBands, normalizedDifference } from "./raster";

/** Fewer scenes than the backend uses, to suit a browser's memory and connection. */
const SCENES_PER_FOOTPRINT = 2;
const MAX_SCENES = 6;
const ANALYSIS_BANDS = ["green", "red", "nir", "swir1"];

/**
 * Burn severity from dNBR = NBR(before) - NBR(after), with the class limits of
 * Key and Benson (2006), FIREMON Landscape Assessment (USDA RMRS-GTR-164-CD),
 * there given as dNBR x 1000. Calibrated for Landsat; with Sentinel-2 they
 * are a guide, not a calibrated scale.
 */
export const SEVERITY: { label: string; min: number | null; max: number | null; rgb: Rgb }[] = [
  { label: "Enhanced regrowth, high", min: null, max: -0.25, rgb: [26, 120, 60] },
  { label: "Enhanced regrowth, low", min: -0.25, max: -0.1, rgb: [120, 190, 110] },
  { label: "Unburned", min: -0.1, max: 0.1, rgb: [235, 235, 220] },
  { label: "Low severity", min: 0.1, max: 0.27, rgb: [250, 220, 90] },
  { label: "Moderate-low severity", min: 0.27, max: 0.44, rgb: [245, 150, 50] },
  { label: "Moderate-high severity", min: 0.44, max: 0.66, rgb: [225, 70, 40] },
  { label: "High severity", min: 0.66, max: null, rgb: [120, 20, 90] },
];

/** Index of the severity class a dNBR value falls in. */
export function severityClass(dnbr: number): number {
  for (let k = 0; k < SEVERITY.length; k += 1) {
    const c = SEVERITY[k] as (typeof SEVERITY)[number];
    if ((c.min === null || dnbr >= c.min) && (c.max === null || dnbr < c.max)) return k;
  }
  return SEVERITY.length - 1;
}
const HISTOGRAM_BINS = 40;
/** Composites centred this far apart in the calendar may differ through phenology alone. */
const SEASON_MISMATCH_DAYS = 45;
const SENSITIVITY_FACTORS = [0.75, 1.25];

export const INDICES: Record<IndexId, { name: string; positive: string; negative: string; measures: string; reference: string; threshold: number }> = {
  ndvi: { name: "NDVI", positive: "nir", negative: "red", measures: "Green vegetation vigour and cover", reference: "Rouse et al. 1974; Tucker 1979", threshold: 0.15 },
  ndwi: { name: "NDWI", positive: "green", negative: "nir", measures: "Open surface water", reference: "McFeeters 1996", threshold: 0.15 },
  mndwi: { name: "MNDWI", positive: "green", negative: "swir1", measures: "Open surface water, less confused by built-up land than NDWI", reference: "Xu 2006", threshold: 0.15 },
  ndbi: { name: "NDBI", positive: "swir1", negative: "nir", measures: "Built-up and bare surfaces (does not separate the two)", reference: "Zha, Gao and Ni 2003", threshold: 0.1 },
  nbr: { name: "NBR", positive: "nir", negative: "swir2", measures: "Burned land: charred surfaces lower NIR and raise SWIR-2", reference: "Key and Benson 2006", threshold: 0.1 },
};

const DELTA_COLORS: Rgb[] = [[165, 42, 42], [230, 140, 90], [245, 245, 240], [120, 190, 140], [20, 110, 70]];
const INDEX_COLORS: Rgb[] = [[120, 70, 40], [220, 200, 150], [245, 245, 200], [130, 190, 110], [20, 100, 50]];

export interface BrowserChangeRequest extends ChangeRequest {
  maxPixels: number;
  concurrency: number;
}

function indexOf(id: IndexId, bands: Record<string, Float32Array>): Float32Array {
  const def = INDICES[id];
  return normalizedDifference(bands[def.positive] as Float32Array, bands[def.negative] as Float32Array);
}

export async function runChange(request: BrowserChangeRequest, hooks: EngineHooks) {
  const { dataset } = request;
  const index = INDICES[request.index];
  const threshold = request.threshold ?? index.threshold;
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, NATIVE_RES[dataset], request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const size = grid.width * grid.height;
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  const warnings: string[] = [];

  // 1. Scenes for both periods.
  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 2, detail: "Searching the archive" });
  const periods = [request.before, request.after];
  const found = await Promise.all(periods.map(async (period) => {
    const year = Number(period.start.slice(0, 4));
    if (year < FIRST_YEAR[dataset]) throw new Error(`This archive starts in ${FIRST_YEAR[dataset]}. Use Landsat for earlier dates.`);
    const note = dataset === "landsat" ? landsatPlatforms(year).note : null;
    if (note) warnings.push(note);
    const scenes = selectScenes(
      await searchScenes(dataset, aoi.lonLatBounds, period.start, period.end, request.maxCloud, hooks.signal),
      SCENES_PER_FOOTPRINT, MAX_SCENES);
    if (!scenes.length) {
      throw new Error(`No scene with at most ${request.maxCloud}% cloud covers this area between ${period.start} and ${period.end}. Widen the season or pick another year.`);
    }
    return scenes;
  }));
  const [beforeScenes, afterScenes] = found as [Scene[], Scene[]];

  // 2. Composites. Every file read is reported, so the progress bar is real.
  // SWIR-2 is downloaded only when the burn index needs it.
  const bandNames = request.index === "nbr" ? [...ANALYSIS_BANDS, "swir2"] : ANALYSIS_BANDS;
  const total = (beforeScenes.length + afterScenes.length) * (bandNames.length + 1);
  let done = 0;
  const read = (label: string) => () => {
    done += 1;
    hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading the ${label} period: file ${done} of ${total}` });
  };
  const before = await compositeBands(dataset, BANDS[dataset], bandNames, beforeScenes, grid, request.concurrency, read("earlier"), hooks.signal);
  const after = await compositeBands(dataset, BANDS[dataset], bandNames, afterScenes, grid, request.concurrency, read("later"), hooks.signal);

  // 3. Indices.
  hooks.progress({ stage: "CALCULATING_INDICES", done: total, total, detail: "Calculating indices" });
  const outside = (layer: Float32Array) => {
    for (let i = 0; i < size; i += 1) if (!mask[i]) layer[i] = NaN;
    return layer;
  };
  const indices = {} as Record<IndexId, { before: number | null; after: number | null; change: number | null }>;
  for (const id of Object.keys(INDICES) as IndexId[]) {
    if (!before.bands[INDICES[id].negative] || !before.bands[INDICES[id].positive]) continue; // band not downloaded
    const b = outside(indexOf(id, before.bands)), a = outside(indexOf(id, after.bands));
    const both = new Uint8Array(size);
    const diff = new Float32Array(size);
    for (let i = 0; i < size; i += 1) {
      if (!Number.isNaN(b[i] as number) && !Number.isNaN(a[i] as number)) {
        both[i] = 1;
        diff[i] = (a[i] as number) - (b[i] as number);
      }
    }
    indices[id] = { before: mean(b, both), after: mean(a, both), change: mean(diff, both) };
  }
  const indexBefore = outside(indexOf(request.index, before.bands));
  const indexAfter = outside(indexOf(request.index, after.bands));

  // 4. Change.
  hooks.progress({ stage: "DETECTING_CHANGE", done: total, total, detail: "Detecting change" });
  const delta = new Float32Array(size).fill(NaN);
  const valid = new Uint8Array(size);
  const classes = new Uint8Array(size); // 1 decrease, 2 increase
  let validCount = 0, inside = 0, loss = 0, gain = 0;
  const sensitivity = SENSITIVITY_FACTORS.map((f) => ({ threshold: threshold * f, loss: 0, gain: 0 }));
  for (let i = 0; i < size; i += 1) {
    inside += mask[i] as number;
    const d = (indexAfter[i] as number) - (indexBefore[i] as number);
    if (Number.isNaN(d)) continue;
    delta[i] = d;
    valid[i] = 1;
    validCount += 1;
    if (d <= -threshold) { classes[i] = 1; loss += 1; }
    else if (d >= threshold) { classes[i] = 2; gain += 1; }
    for (const s of sensitivity) {
      if (d <= -s.threshold) s.loss += 1;
      else if (d >= s.threshold) s.gain += 1;
    }
  }
  if (!validCount) throw new Error("No part of the area had clear observations in both periods. Try a wider season.");
  const minPixels = Math.max(1, Math.ceil((request.minAreaHa * M2_PER_HA) / grid.res ** 2));
  const regions = findRegions(classes, grid.width, grid.height, minPixels, indexBefore, indexAfter, before.clearCount, after.clearCount);

  const clear = (count: Uint8Array) => {
    const values: number[] = [];
    for (let i = 0; i < size; i += 1) if (mask[i]) values.push(count[i] as number);
    return median(values);
  };
  const gap0 = Math.abs(typicalDayOfYear(beforeScenes.map((s) => s.datetime)) - typicalDayOfYear(afterScenes.map((s) => s.datetime)));
  const gap = Math.min(gap0, 365 - gap0);
  if (gap > SEASON_MISMATCH_DAYS) {
    warnings.push(`The two composites are centred about ${gap.toFixed(0)} days apart in the calendar. Seasonal vegetation and water cycles alone can produce change of this kind.`);
  }
  const sensors = (scenes: Scene[]) => [...new Set(scenes.map((s) => s.platform))].sort();
  if (sensors(beforeScenes).join() !== sensors(afterScenes).join()) {
    warnings.push(`Different sensors were used (${sensors(beforeScenes).join(", ")} then ${sensors(afterScenes).join(", ")}). Their spectral bands differ slightly and no cross-sensor harmonisation was applied.`);
  }
  if (inside && validCount / inside < 0.9) {
    warnings.push(`Only ${((validCount / inside) * 100).toFixed(0)}% of the area had clear observations in both periods. Area totals describe that part only.`);
  }

  // 5. Images for the globe.
  hooks.progress({ stage: "GENERATING_RESULTS", done: total, total, detail: "Drawing the maps" });
  const ramp = (colors: Rgb[], min: number, max: number) => ({ min, max, colors: colors.map(hex) });
  const overlays: Record<string, EngineOverlay> = {
    change: await makeOverlay(`${index.name} change (after minus before)`, rampImage(delta, -0.5, 0.5, DELTA_COLORS), grid, ramp(DELTA_COLORS, -0.5, 0.5), hooks),
    before: await makeOverlay(`${index.name} before`, rampImage(indexBefore, -0.2, 0.8, INDEX_COLORS), grid, ramp(INDEX_COLORS, -0.2, 0.8), hooks),
    after: await makeOverlay(`${index.name} after`, rampImage(indexAfter, -0.2, 0.8, INDEX_COLORS), grid, ramp(INDEX_COLORS, -0.2, 0.8), hooks),
  };
  let severity: { label: string; min: number | null; max: number | null; ha: number; color: string }[] | undefined;
  if (request.index === "nbr") {
    const classes = new Uint8Array(size); // severity index + 1; 0 is no data
    const counts = new Array<number>(SEVERITY.length).fill(0);
    for (let i = 0; i < size; i += 1) {
      if (!valid[i]) continue;
      const k = severityClass(-(delta[i] as number)); // dNBR = before - after
      classes[i] = k + 1;
      counts[k] = (counts[k] as number) + 1;
    }
    severity = SEVERITY.map((c, k) => ({ label: c.label, min: c.min, max: c.max, ha: (counts[k] as number) * pixelHa, color: hex(c.rgb) }));
    const colours = Object.fromEntries(SEVERITY.map((c, k) => [k + 1, c.rgb]));
    overlays.severity = await makeOverlay("Burn severity (dNBR)", classImage(classes, colours), grid,
      { classes: SEVERITY.slice().reverse().map((c) => ({ label: c.label, color: hex(c.rgb) })) }, hooks);
  }
  const publicScene = (s: Scene) => ({ id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: s.cloudCover, footprint: s.footprint });
  const { maxPixels: _budget, concurrency: _parallel, ...stored } = request;
  void _budget;
  void _parallel;

  return {
    type: "change" as const,
    label: request.label ?? null,
    request: { ...stored, threshold },
    aoi: request.aoi,
    valueKind: "DERIVED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      index: { id: request.index, name: index.name, formula: `(${index.positive} - ${index.negative}) / (${index.positive} + ${index.negative})`, measures: index.measures, reference: index.reference },
      method:
        `Per-pixel median composite of clear-sky surface reflectance for each period; ${index.name} computed on each ` +
        `composite; change = after minus before; pixels with |change| >= ${threshold} reported.`,
      cloudMask: dataset === "landsat"
        ? "QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow rejected"
        : "SCL: no data, saturated, cloud shadow, cloud (medium/high), cirrus and snow rejected",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: NATIVE_RES[dataset],
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      maxCloudPercent: request.maxCloud,
      scenes: { before: beforeScenes.map(publicScene), after: afterScenes.map(publicScene) },
      uncertainty:
        "No formal accuracy assessment has been made for this result. The threshold is a user-set parameter, not a " +
        "validated one; the sensitivity figures show how the areas move when it changes by 25%. Areas are pixel " +
        "counts in a UTM grid. Regions are drawn as bounding boxes; their areas are true pixel areas.",
    },
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      analysedAreaHa: validCount * pixelHa,
      validFraction: inside ? validCount / inside : 0,
      before: { mean: mean(indexBefore, valid), median: null },
      after: { mean: mean(indexAfter, valid), median: null },
      meanChange: mean(delta, valid),
      threshold,
      lossAreaHa: loss * pixelHa,
      gainAreaHa: gain * pixelHa,
      lossPercent: (loss / validCount) * 100,
      gainPercent: (gain / validCount) * 100,
      thresholdSensitivity: sensitivity.map((s) => ({ threshold: s.threshold, lossAreaHa: s.loss * pixelHa, gainAreaHa: s.gain * pixelHa })),
      clearObservations: { before: clear(before.clearCount), after: clear(after.clearCount) },
      severity,
    },
    indices,
    histogram: histogram(delta, valid, HISTOGRAM_BINS, -1, 1),
    detections: regionsToGeoJson(regions, grid, (value) => (value === 1 ? "decrease" : "increase")),
    overlays,
    warnings,
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}
