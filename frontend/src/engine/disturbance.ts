/**
 * Forest disturbance from the Landsat record: yearly composites of the
 * Normalized Burn Ratio, and for each pixel the largest drop between one
 * observed year and the next. A drop counts as a disturbance only where the
 * pixel was densely vegetated before it, so cropland cycles are left out.
 * A drop in NBR is a loss of green canopy: clearing, logging, fire, storm or
 * drought. It is not by itself deforestation.
 */
import type { AoiGeometry } from "../app/types";
import { type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, classImage, hex, makeOverlay } from "./common";
import { buildGrid, projectAoi, rasterMask } from "./geo";
import { BANDS, FIRST_YEAR, NATIVE_RES, type Scene, landsatPlatforms, searchScenes, seasonWindow, selectScenes } from "./pc";
import { compositeBands, normalizedDifference } from "./raster";

const SCENES_PER_FOOTPRINT = 2;
const MAX_SCENES = 6;
/** Colours from early (dark red) to late (yellow) periods. */
const PERIOD_RAMP: Rgb[] = [[127, 0, 0], [179, 0, 0], [215, 48, 31], [239, 101, 72], [252, 141, 89], [253, 187, 132], [254, 217, 118], [255, 237, 160], [255, 255, 204], [210, 230, 250], [160, 200, 240]];

export interface DisturbanceRequest {
  aoi: AoiGeometry;
  label: string;
  years: number[];
  startMonth: number;
  endMonth: number;
  /** Smallest NBR drop counted (Key and Benson's moderate-low severity starts at 0.27). */
  threshold: number;
  /** NBR the pixel must have before the drop to count as densely vegetated. */
  forestNbr: number;
  maxCloud: number;
  maxPixels: number;
  concurrency: number;
}

/**
 * For one pixel's yearly NBR values (NaN where unobserved), the index of the
 * year after the largest qualifying drop, and the drop; null if none qualifies.
 */
export function largestDrop(values: number[], threshold: number, forestNbr: number): { after: number; drop: number } | null {
  let best: { after: number; drop: number } | null = null;
  let previous = -1;
  for (let i = 0; i < values.length; i += 1) {
    if (!Number.isFinite(values[i]!)) continue;
    if (previous >= 0) {
      const before = values[previous]!, drop = before - values[i]!;
      if (before >= forestNbr && drop >= threshold && (!best || drop > best.drop)) best = { after: i, drop };
    }
    previous = i;
  }
  return best;
}

export async function runDisturbance(request: DisturbanceRequest, hooks: EngineHooks) {
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, NATIVE_RES.landsat, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const years = [...request.years].sort((a, b) => a - b).filter((y) => y >= FIRST_YEAR.landsat);
  if (years.length < 2) throw new Error("Choose at least two years from 1984 on.");
  const warnings: string[] = [];

  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: years.length, detail: "Searching the Landsat archive" });
  const plans = await Promise.all(years.map(async (year) => {
    const [start, end] = seasonWindow(year, request.startMonth, request.endMonth);
    const scenes = selectScenes(await searchScenes("landsat", aoi.lonLatBounds, start, end, request.maxCloud, hooks.signal), SCENES_PER_FOOTPRINT, MAX_SCENES);
    const note = landsatPlatforms(year).note;
    if (note && !warnings.includes(note)) warnings.push(note);
    return { year, scenes };
  }));
  const missing = plans.filter((p) => !p.scenes.length).map((p) => p.year);
  if (missing.length) warnings.push(`No clear Landsat scene in ${missing.join(", ")}; ${missing.length === 1 ? "that year is" : "those years are"} skipped, so a drop is attributed to the next observed year.`);

  const total = plans.reduce((sum, p) => sum + p.scenes.length * 3, 0);
  let done = 0;
  const observed: { year: number; nbr: Float32Array; scenes: Scene[] }[] = [];
  for (const plan of plans) {
    if (!plan.scenes.length) continue;
    const c = await compositeBands("landsat", BANDS.landsat, ["nir", "swir2"], plan.scenes, grid, request.concurrency, () => {
      done += 1;
      hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading ${plan.year}: file ${done} of ${total}` });
    }, hooks.signal);
    observed.push({ year: plan.year, nbr: normalizedDifference(c.bands.nir as Float32Array, c.bands.swir2 as Float32Array), scenes: plan.scenes });
  }
  if (observed.length < 2) throw new Error("Fewer than two years had clear Landsat scenes; try a longer season or other years.");

  hooks.progress({ stage: "DETECTING_CHANGE", done: total, total, detail: "Finding the largest drop in each pixel" });
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  const periods = observed.slice(1).map((o, i) => ({ from: observed[i]!.year, to: o.year, ha: 0 }));
  const yearMap = new Float32Array(grid.width * grid.height).fill(NaN);
  const periodMap = new Uint8Array(grid.width * grid.height); // period index + 1
  let forestHa = 0, disturbedHa = 0;
  const values: number[] = new Array(observed.length);
  for (let i = 0; i < yearMap.length; i += 1) {
    if (!mask[i]) continue;
    for (let k = 0; k < observed.length; k += 1) values[k] = observed[k]!.nbr[i] as number;
    const firstSeen = values.find(Number.isFinite);
    if (firstSeen !== undefined && firstSeen >= request.forestNbr) forestHa += pixelHa;
    const hit = largestDrop(values, request.threshold, request.forestNbr);
    if (!hit) continue;
    yearMap[i] = observed[hit.after]!.year;
    periodMap[i] = hit.after; // the period ending at observed[hit.after] has index hit.after - 1
    periods[hit.after - 1]!.ha += pixelHa;
    disturbedHa += pixelHa;
  }
  const gap = Math.max(...observed.slice(1).map((o, i) => o.year - observed[i]!.year));
  if (gap > 3) warnings.push(`Up to ${gap} years separate the composites: canopy cleared and regrown within a gap can be missed, and every drop is dated to the end of its gap.`);
  warnings.push("A drop in NBR is a loss of green canopy, from clearing, logging, fire, storm or drought; it is not by itself deforestation. Check disturbed areas against the imagery.");
  if (new Set(observed.flatMap((o) => o.scenes.map((s) => s.platform))).size > 1) {
    warnings.push("Several Landsat sensors are used without cross-sensor harmonisation; small steps between sensors are not change, which is one reason the threshold is high.");
  }

  hooks.progress({ stage: "GENERATING_RESULTS", done: total, total, detail: "Drawing the map" });
  const colours = Object.fromEntries(periods.map((_, i) => [i + 1, PERIOD_RAMP[Math.round((i * (PERIOD_RAMP.length - 1)) / Math.max(periods.length - 1, 1))]!])) as Record<number, Rgb>;
  const overlays: Record<string, EngineOverlay> = {
    disturbance: await makeOverlay(`Canopy loss, ${observed[0]!.year} to ${observed[observed.length - 1]!.year}`, classImage(periodMap, colours), grid, {
      classes: periods.map((p, i) => ({ label: `${p.from} to ${p.to}`, color: hex(colours[i + 1]!) })),
    }, hooks),
  };

  const publicScene = (s: Scene) => ({ id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: s.cloudCover, footprint: s.footprint });
  const { maxPixels: _budget, concurrency: _parallel, ...stored } = request;
  void _budget;
  void _parallel;
  return {
    type: "disturbance" as const,
    label: request.label,
    request: stored,
    aoi: request.aoi,
    valueKind: "DERIVED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        "Yearly median composites of clear-sky Landsat surface reflectance in the chosen season; NBR = (NIR - SWIR2) / (NIR + SWIR2). " +
        `For each pixel, the largest drop in NBR between consecutive observed years, counted where it is at least ${request.threshold} ` +
        `and NBR before the drop was at least ${request.forestNbr} (dense green canopy). The drop is dated to the later year.`,
      cloudMask: "QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow rejected",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: NATIVE_RES.landsat,
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      maxCloudPercent: request.maxCloud,
      scenes: Object.fromEntries(observed.map((o) => [String(o.year), o.scenes.map(publicScene)])),
      uncertainty:
        "No accuracy assessment has been made. The thresholds are fixed values, not calibrated for this region; a single yearly " +
        "composite can miss a disturbance hidden by cloud or regrowth, and can mistake a dry year for one.",
    },
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      years: observed.map((o) => o.year),
      forestHa,
      disturbedHa,
      periods,
    },
    overlays,
    warnings,
    raster: {
      name: "disturbance-year",
      description: `Year a canopy-loss drop in NBR was first seen (end of its gap between composites); NaN where none.`,
      data: yearMap, epsg: grid.epsg, west: grid.west, north: grid.north, res: grid.res, width: grid.width, height: grid.height, noData: "nan",
    },
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}
