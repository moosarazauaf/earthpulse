/**
 * FloodLens in the browser: flood extent from Sentinel-1 radar.
 *
 * Same method as backend/app/services/flood.py. Open water is dark in VV
 * backscatter; a pixel is flooded when it is dark in the flood window, was not
 * dark before, and fell by a clear margin. One relative orbit is used
 * throughout, chosen by how well it covers the area in every window.
 */
import type { AoiGeometry, FloodRequest } from "../app/types";
import {
  type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, classImage, findRegions, hex, histogram, makeOverlay,
  pooled, rampImage, regionsToGeoJson,
} from "./common";
import { type Grid, buildGrid, outerRings, projectAoi, rasterMask } from "./geo";
import { readOntoGrid } from "./raster";

const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const RADAR = "sentinel-1-rtc";
const RADAR_RES = 10;
/** ESA WorldCover 2021 v200 class codes (Product User Manual v2.0). */
const WORLDCOVER = { collection: "esa-worldcover", version: "2021_v200", cropland: 40, builtUp: 50, water: 80 };

// The constants below mirror the backend; see flood.py for the reasoning.
const THRESHOLD_RANGE_DB: [number, number] = [-23, -13];
const FALLBACK_THRESHOLD_DB = -17;
/** A single Gaussian scores 2/pi (0.64) on Otsu separability, so the bar sits above that. */
const MIN_SEPARABILITY = 0.7;
const MIN_DROP_DB = 3;
/** Passes per window. Each costs about 10 MB of download, so the browser uses fewer than the backend. */
const MAX_PASSES = 2;
const MIN_COVERAGE = 0.5;
/**
 * Radar files downloaded at once. Each window read is about 10 MB, so many in
 * parallel would starve each other of bandwidth and time out together.
 */
const RADAR_CONCURRENCY = 3;
const SPECKLE_FILTER_BELOW_M = 30;
const HISTOGRAM_BINS = 60;
/** Points sampled across the area to measure how much of it an orbit covers. */
const COVERAGE_SAMPLES = 24;

const EXTENT_COLORS: Record<number, Rgb> = { 1: [60, 130, 220], 2: [255, 80, 60] };
const GREY: Rgb[] = [[0, 0, 0], [255, 255, 255]];

export interface BrowserFloodRequest extends FloodRequest {
  maxPixels: number;
  concurrency: number;
}

interface RadarScene {
  id: string;
  datetime: string;
  platform: string;
  orbit: number;
  orbitState: string;
  epsg: number;
  footprint: number[][][];
  href: string;
}

// ---- pure building blocks (unit tested) ---------------------------------------
/** Linear backscatter to decibels; non-positive and missing values become NaN. */
export function toDb(power: Float32Array): Float32Array {
  const out = new Float32Array(power.length);
  for (let i = 0; i < power.length; i += 1) {
    const v = power[i] as number;
    out[i] = v > 0 ? 10 * Math.log10(v) : NaN;
  }
  return out;
}

/** 3x3 mean that ignores NaN and leaves gaps as gaps. On linear power this is multilooking. */
export function boxMean(data: Float32Array, width: number, height: number): Float32Array {
  const out = new Float32Array(data.length);
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      const i = row * width + col;
      if (Number.isNaN(data[i] as number)) {
        out[i] = NaN;
        continue;
      }
      let sum = 0, n = 0;
      for (let r = Math.max(0, row - 1); r <= Math.min(height - 1, row + 1); r += 1) {
        for (let c = Math.max(0, col - 1); c <= Math.min(width - 1, col + 1); c += 1) {
          const v = data[r * width + c] as number;
          if (!Number.isNaN(v)) { sum += v; n += 1; }
        }
      }
      out[i] = sum / n;
    }
  }
  return out;
}

/** Otsu's threshold and its separability (0 to 1) for the values where `use` is set. */
export function otsuThreshold(values: Float32Array, use: Uint8Array, bins = 256): { threshold: number; separability: number } {
  let lo = Infinity, hi = -Infinity, n = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (!use[i]) continue;
    const v = values[i] as number;
    if (v < lo) lo = v;
    if (v > hi) hi = v;
    n += 1;
  }
  if (!n || hi <= lo) return { threshold: lo, separability: 0 };
  const counts = new Float64Array(bins);
  for (let i = 0; i < values.length; i += 1) {
    if (use[i]) counts[Math.min(bins - 1, Math.floor((((values[i] as number) - lo) / (hi - lo)) * bins))]! += 1;
  }
  const width = (hi - lo) / bins;
  const centre = (k: number) => lo + (k + 0.5) * width;
  let totalMean = 0;
  for (let k = 0; k < bins; k += 1) totalMean += ((counts[k] as number) / n) * centre(k);
  let totalVariance = 0;
  for (let k = 0; k < bins; k += 1) totalVariance += ((counts[k] as number) / n) * (centre(k) - totalMean) ** 2;
  let best = 0, bestK = 0, weight = 0, cumulative = 0;
  for (let k = 0; k < bins - 1; k += 1) {
    weight += (counts[k] as number) / n;
    cumulative += ((counts[k] as number) / n) * centre(k);
    if (weight <= 0 || weight >= 1) continue;
    const between = (totalMean * weight - cumulative) ** 2 / (weight * (1 - weight));
    if (between > best) { best = between; bestK = k; }
  }
  return { threshold: lo + (bestK + 1) * width, separability: totalVariance > 0 ? best / totalVariance : 0 };
}

function inRing(lon: number, lat: number, ring: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi = 0, yi = 0] = ring[i] ?? [];
    const [xj = 0, yj = 0] = ring[j] ?? [];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Share of the area each relative orbit covers in its worst window.
 * Mixing orbits changes the look angle, and an orbit that clips the area
 * silently drops part of it, so coverage is measured before anything is read.
 */
export function orbitCoverage(windows: { orbit: number; footprint: number[][][] }[][], aoi: AoiGeometry): Record<number, number> {
  const rings = outerRings(aoi);
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) { west = Math.min(west, x); east = Math.max(east, x); south = Math.min(south, y); north = Math.max(north, y); }
  const samples: [number, number][] = [];
  for (let r = 0; r < COVERAGE_SAMPLES; r += 1) {
    for (let c = 0; c < COVERAGE_SAMPLES; c += 1) {
      const lon = west + ((c + 0.5) / COVERAGE_SAMPLES) * (east - west);
      const lat = south + ((r + 0.5) / COVERAGE_SAMPLES) * (north - south);
      if (rings.some((ring) => inRing(lon, lat, ring))) samples.push([lon, lat]);
    }
  }
  const orbits = new Set(windows.flat().map((s) => s.orbit));
  const coverage: Record<number, number> = {};
  for (const orbit of orbits) {
    let worst = 1;
    for (const scenes of windows) {
      const footprints = scenes.filter((s) => s.orbit === orbit).map((s) => s.footprint[0] ?? []);
      const covered = samples.filter(([lon, lat]) => footprints.some((ring) => inRing(lon, lat, ring))).length;
      worst = Math.min(worst, samples.length ? covered / samples.length : 0);
    }
    coverage[orbit] = worst;
  }
  return coverage;
}

// ---- data access ---------------------------------------------------------------
async function stac(body: object, signal?: AbortSignal) {
  const response = await fetch(STAC_SEARCH, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error("Satellite imagery is temporarily unavailable.");
  return ((await response.json()) as { features: { id: string; geometry: { type: string; coordinates: number[][][] }; properties: Record<string, unknown>; assets: Record<string, { href: string }> }[] }).features;
}

async function searchRadar(bbox: number[], start: string, end: string, signal?: AbortSignal): Promise<RadarScene[]> {
  const features = await stac({
    collections: [RADAR], bbox, datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
    sortby: [{ field: "properties.datetime", direction: "asc" }], limit: 100,
  }, signal);
  return features.filter((f) => f.assets.vv && f.geometry?.type === "Polygon").map((f) => ({
    id: f.id,
    datetime: String(f.properties.datetime),
    platform: String(f.properties.platform ?? ""),
    orbit: Number(f.properties["sat:relative_orbit"]),
    orbitState: String(f.properties["sat:orbit_state"] ?? ""),
    epsg: Number(f.properties["proj:epsg"] ?? String(f.properties["proj:code"] ?? "").replace("EPSG:", "")),
    footprint: f.geometry.coordinates,
    href: (f.assets.vv as { href: string }).href,
  }));
}

/** One VV image per window from the passes of one orbit: median, or the darkest pass ("min"). */
async function composite(scenes: RadarScene[], orbit: number, grid: Grid, reducer: "median" | "min", concurrency: number, onRead: () => void, signal?: AbortSignal) {
  const byDay = new Map<string, RadarScene[]>();
  for (const scene of scenes) {
    if (scene.orbit !== orbit) continue;
    const day = scene.datetime.slice(0, 10); // slices of one pass share a date
    byDay.set(day, [...(byDay.get(day) ?? []), scene]);
  }
  const days = [...byDay.keys()].sort().slice(-MAX_PASSES);
  const used = days.flatMap((day) => byDay.get(day) as RadarScene[]);
  const raw = await pooled(used, concurrency, async (scene) => {
    const data = (await readOntoGrid(scene.href, RADAR, scene.epsg, grid, false, signal)) as Float32Array;
    onRead();
    return data;
  });
  const size = grid.width * grid.height;
  const passes = days.map((day) => {
    const mosaic = new Float32Array(size).fill(NaN);
    used.forEach((scene, k) => {
      if (scene.datetime.slice(0, 10) !== day) return;
      const data = raw[k] as Float32Array;
      for (let i = 0; i < size; i += 1) {
        const v = data[i] as number;
        if (Number.isNaN(mosaic[i] as number) && v > 0) mosaic[i] = v; // 0 and negatives are fill
      }
    });
    return mosaic;
  });
  const out = new Float32Array(size);
  const count = new Uint8Array(size);
  const values: number[] = [];
  for (let i = 0; i < size; i += 1) {
    values.length = 0;
    for (const pass of passes) if (!Number.isNaN(pass[i] as number)) values.push(pass[i] as number);
    count[i] = values.length;
    if (!values.length) out[i] = NaN;
    else if (reducer === "min") out[i] = Math.min(...values);
    else {
      values.sort((a, b) => a - b);
      const mid = values.length >> 1;
      out[i] = values.length % 2 ? (values[mid] as number) : ((values[mid - 1] as number) + (values[mid] as number)) / 2;
    }
  }
  return { power: out, count, used };
}

async function landCover(grid: Grid, bbox: number[], signal?: AbortSignal): Promise<Uint8Array | null> {
  try {
    const tiles = (await stac({ collections: [WORLDCOVER.collection], bbox, limit: 20 }, signal))
      .filter((f) => f.id.includes(WORLDCOVER.version) && f.assets.map);
    if (!tiles.length) return null;
    const out = new Uint8Array(grid.width * grid.height);
    for (const tile of tiles) {
      const part = await readOntoGrid((tile.assets.map as { href: string }).href, WORLDCOVER.collection, 4326, grid, true, signal);
      for (let i = 0; i < out.length; i += 1) if (!out[i]) out[i] = part[i] as number; // 0 is no data
    }
    return out;
  } catch {
    return null;
  }
}

// ---- the analysis ----------------------------------------------------------------
export async function runFlood(request: BrowserFloodRequest, hooks: EngineHooks) {
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, RADAR_RES, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const size = grid.width * grid.height;
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  const bbox = aoi.lonLatBounds;
  const notes: string[] = [];

  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 1, detail: "Searching for radar passes" });
  const windows: Record<string, { start: string; end: string }> = { before: request.before, flood: request.flood };
  if (request.after) windows.after = request.after;
  const names = Object.keys(windows);
  const found = await Promise.all(names.map(async (name) => {
    const w = windows[name] as { start: string; end: string };
    if (w.start < "2014-10-01") throw new Error("Sentinel-1 does not cover dates before October 2014.");
    const scenes = await searchRadar(bbox, w.start, w.end, hooks.signal);
    if (!scenes.length) throw new Error(`No Sentinel-1 pass covers this area between ${w.start} and ${w.end}. Widen the window.`);
    return scenes;
  }));
  const coverage = orbitCoverage(found, request.aoi);
  const usable = Object.entries(coverage).filter(([, c]) => c >= MIN_COVERAGE).sort((a, b) => b[1] - a[1]);
  if (!usable.length) throw new Error("No single Sentinel-1 orbit covers this area in every window. Widen the windows: the same orbit returns every 6 to 12 days.");
  const orbit = Number((usable[0] as [string, number])[0]);

  const perWindow = found.map((scenes) => {
    const days = [...new Set(scenes.filter((s) => s.orbit === orbit).map((s) => s.datetime.slice(0, 10)))].sort().slice(-MAX_PASSES);
    return scenes.filter((s) => s.orbit === orbit && days.includes(s.datetime.slice(0, 10))).length;
  });
  const total = perWindow.reduce((a, b) => a + b, 0);
  let done = 0;
  const onRead = () => {
    done += 1;
    hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading radar passes: file ${done} of ${total}` });
  };
  hooks.progress({ stage: "PROCESSING_IMAGERY", done: 0, total, detail: `Reading ${total} radar files, about 10 MB each on a district-sized area` });
  const filtered = grid.res < SPECKLE_FILTER_BELOW_M;
  const db: Record<string, Float32Array> = {};
  const counts: Record<string, Uint8Array> = {};
  const used: Record<string, RadarScene[]> = {};
  for (const [k, name] of names.entries()) {
    // The flood image keeps the darkest pass so a flood seen once is not averaged out.
    const result = await composite(found[k] as RadarScene[], orbit, grid, name === "flood" ? "min" : "median", Math.min(RADAR_CONCURRENCY, request.concurrency), onRead, hooks.signal);
    const power = filtered ? boxMean(result.power, grid.width, grid.height) : result.power;
    const layer = toDb(power);
    for (let i = 0; i < size; i += 1) if (!mask[i]) layer[i] = NaN;
    db[name] = layer;
    counts[name] = result.count;
    used[name] = result.used;
  }
  const before = db.before as Float32Array, during = db.flood as Float32Array, after = db.after;

  hooks.progress({ stage: "CALCULATING_INDICES", done: total, total, detail: "Choosing the water threshold" });
  const valid = new Uint8Array(size);
  let validCount = 0, inside = 0;
  for (let i = 0; i < size; i += 1) {
    inside += mask[i] as number;
    if (!Number.isNaN(before[i] as number) && !Number.isNaN(during[i] as number)) { valid[i] = 1; validCount += 1; }
  }
  if (!validCount) throw new Error("The selected orbit has no data inside this area.");
  let thresholdInfo: { valueDb: number; source: "otsu" | "user" | "fallback"; separability: number | null; otsuValueDb?: number };
  if (request.thresholdDb !== undefined) thresholdInfo = { valueDb: request.thresholdDb, source: "user", separability: null };
  else {
    const otsu = otsuThreshold(during, valid);
    const ok = otsu.separability >= MIN_SEPARABILITY && otsu.threshold >= THRESHOLD_RANGE_DB[0] && otsu.threshold <= THRESHOLD_RANGE_DB[1];
    thresholdInfo = ok
      ? { valueDb: Math.round(otsu.threshold * 100) / 100, source: "otsu", separability: Math.round(otsu.separability * 1000) / 1000 }
      : { valueDb: FALLBACK_THRESHOLD_DB, source: "fallback", separability: Math.round(otsu.separability * 1000) / 1000, otsuValueDb: Math.round(otsu.threshold * 100) / 100 };
  }
  const threshold = thresholdInfo.valueDb;

  hooks.progress({ stage: "DETECTING_CHANGE", done: total, total, detail: "Mapping the flood" });
  const extent = new Uint8Array(size); // 1 pre-existing water, 2 flooded
  let flooded = 0, preExisting = 0, waterDuring = 0, low = 0, high = 0, still = 0, receded = 0, unseen = 0;
  for (let i = 0; i < size; i += 1) {
    if (!valid[i]) continue;
    const b = before[i] as number, d = during[i] as number;
    const drop = b - d >= MIN_DROP_DB;
    if (b < threshold) { extent[i] = 1; preExisting += 1; }
    if (d < threshold) waterDuring += 1;
    if (d < threshold && !(b < threshold) && drop) {
      extent[i] = 2;
      flooded += 1;
      if (after) {
        const a = after[i] as number;
        if (Number.isNaN(a)) unseen += 1;
        else if (a < threshold) still += 1;
        else receded += 1;
      }
    }
    if (drop && d < threshold - 1 && !(b < threshold - 1)) low += 1;
    if (drop && d < threshold + 1 && !(b < threshold + 1)) high += 1;
  }
  const best = coverage[orbit] as number;
  if (best < 0.98) notes.push(`The orbit used covers ${(best * 100).toFixed(0)}% of the area. Totals describe that part only.`);
  if (thresholdInfo.source === "fallback") {
    notes.push(`The backscatter histogram did not separate water from land clearly (Otsu separability ${thresholdInfo.separability}), so a fixed threshold of ${FALLBACK_THRESHOLD_DB} dB was used. This usually means water covers only a small share of the area. Check the result against the radar images.`);
  }
  if (flooded > 0 && (high - low) / flooded > 0.5) notes.push("The flooded area changes by more than half when the threshold moves by 1 dB either way. Treat the total as approximate.");

  const cover = await landCover(grid, bbox, hooks.signal);
  let landCoverResult = null;
  if (!cover) notes.push("Land cover could not be loaded, so affected land use is not reported.");
  else {
    let crop = 0, built = 0, mapped = 0, agree = 0;
    for (let i = 0; i < size; i += 1) {
      const c = cover[i];
      if (extent[i] === 2) { if (c === WORLDCOVER.cropland) crop += 1; else if (c === WORLDCOVER.builtUp) built += 1; }
      if (mask[i] && c === WORLDCOVER.water) { mapped += 1; if (extent[i] === 1) agree += 1; }
    }
    landCoverResult = {
      valueKind: "DERIVED",
      croplandFloodedHa: crop * pixelHa,
      builtUpFloodedHa: built * pixelHa,
      otherFloodedHa: (flooded - crop - built) * pixelHa,
      permanentWaterMappedHa: mapped * pixelHa,
      preExistingWaterAlsoMappedHa: agree * pixelHa,
      note: "Flood extent intersected with ESA WorldCover 2021 classes. WorldCover is itself a classification (reported overall accuracy about 77%), and radar misses water under crops and between buildings, so these are lower-bound estimates.",
    };
  }

  hooks.progress({ stage: "GENERATING_RESULTS", done: total, total, detail: "Drawing the maps" });
  const floodedOnly = new Uint8Array(size);
  for (let i = 0; i < size; i += 1) if (extent[i] === 2) floodedOnly[i] = 1;
  const minPixels = Math.max(1, Math.ceil((request.minAreaHa * M2_PER_HA) / grid.res ** 2));
  const labels = new Int32Array(floodedOnly.length);
  const regions = findRegions(floodedOnly, grid.width, grid.height, minPixels, before, during, counts.before, counts.flood, labels);
  const greyLegend = { min: -25, max: 0, colors: ["#000000", "#ffffff"], unit: "dB" };
  const titles: Record<string, string> = { before: "VV backscatter before", flood: "VV backscatter during flood", after: "VV backscatter after" };
  const overlays: Record<string, EngineOverlay> = {
    flood: await makeOverlay("Flood extent", classImage(extent, EXTENT_COLORS), grid, {
      classes: [
        { label: "Flooded", color: hex(EXTENT_COLORS[2] as Rgb) },
        { label: "Pre-existing water", color: hex(EXTENT_COLORS[1] as Rgb) },
      ],
    }, hooks),
  };
  for (const name of names) {
    overlays[`vv_${name}`] = await makeOverlay(titles[name] as string, rampImage(db[name] as Float32Array, -25, 0, GREY), grid, greyLegend, hooks);
  }
  const medianCount = (count: Uint8Array) => {
    const values: number[] = [];
    for (let i = 0; i < size; i += 1) if (mask[i]) values.push(count[i] as number);
    values.sort((a, b) => a - b);
    return values[values.length >> 1] ?? 0;
  };
  const { maxPixels: _budget, concurrency: _parallel, ...stored } = request;
  void _budget;
  void _parallel;

  return {
    type: "flood" as const,
    label: request.label ?? null,
    request: stored,
    aoi: request.aoi,
    valueKind: "DERIVED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        "VV backscatter from one relative orbit: the median of the passes before (and after), and the lowest value of " +
        `the passes in the flood window, which maps the largest extent seen. A pixel is flooded when VV during the flood ` +
        `window is below ${threshold.toFixed(1)} dB, VV before was not, and VV fell by at least ${MIN_DROP_DB} dB. Pixels below ` +
        "the threshold before the flood are reported as pre-existing water.",
      polarisation: "VV",
      relativeOrbit: orbit,
      orbitState: (used.flood as RadarScene[])[0]?.orbitState ?? null,
      orbitCoverage: Object.fromEntries(Object.entries(coverage).map(([o, c]) => [o, Math.round(c * 1000) / 1000])),
      threshold: thresholdInfo,
      speckleFilter: filtered ? "3x3 mean on linear power" : "none: the working grid already averages many looks",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: RADAR_RES,
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      scenes: Object.fromEntries(names.map((name) => [name, (used[name] as RadarScene[]).map((s) => ({
        id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: null, footprint: `orbit ${s.orbit}`,
      }))])),
      landCover: landCoverResult
        ? { name: "ESA WorldCover 2021 v200", provider: "ESA / VITO", license: "CC BY 4.0", attribution: "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data" }
        : null,
      uncertainty:
        "No accuracy assessment has been made against ground or optical reference data. Known error sources: " +
        "wind-roughened water is missed; smooth dry surfaces and radar shadow can be mistaken for water; water under " +
        "vegetation or between buildings is not detected, so flooding in dense crops and built-up areas is " +
        "underestimated. Fields flooded on purpose, such as rice paddies, are open water too and are counted. " +
        "Regions are drawn as their traced outer outlines (holes inside them are not cut out); their areas are true pixel areas.",
    },
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      analysedAreaHa: validCount * pixelHa,
      validFraction: inside ? validCount / inside : 0,
      floodedAreaHa: flooded * pixelHa,
      floodedPercent: (flooded / validCount) * 100,
      preExistingWaterHa: preExisting * pixelHa,
      waterExtentDuringFloodHa: waterDuring * pixelHa,
      thresholdDb: threshold,
      minDropDb: MIN_DROP_DB,
      thresholdSensitivity: [
        { thresholdDb: threshold - 1, floodedAreaHa: low * pixelHa },
        { thresholdDb: threshold + 1, floodedAreaHa: high * pixelHa },
      ],
      passes: Object.fromEntries(names.map((name) => [name, medianCount(counts[name] as Uint8Array)])),
      ...(after ? { recession: { stillWaterHa: still * pixelHa, recededHa: receded * pixelHa, notObservedHa: unseen * pixelHa } } : {}),
    },
    landCover: landCoverResult,
    histogram: histogram(during, valid, HISTOGRAM_BINS, -30, 0),
    detections: regionsToGeoJson(regions, grid, () => "decrease", labels),
    raster: floodRaster(extent, mask, during, grid, request),
    overlays,
    warnings: notes,
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}

/** Flood extent as a coded grid for GeoTIFF export: 0 not observed or outside, 1 dry, 2 water before, 3 flooded. */
function floodRaster(extent: Uint8Array, mask: Uint8Array, during: Float32Array, grid: Grid, request: BrowserFloodRequest) {
  const data = new Uint8Array(extent.length);
  for (let i = 0; i < data.length; i += 1) {
    if (!mask[i] || Number.isNaN(during[i] as number)) continue;
    data[i] = extent[i] === 2 ? 3 : extent[i] === 1 ? 2 : 1;
  }
  return {
    name: "flood-extent",
    description: `Flood extent from Sentinel-1 VV, flood window ${request.flood.start} to ${request.flood.end} against ${request.before.start} to ${request.before.end}.`,
    data, epsg: grid.epsg, west: grid.west, north: grid.north, res: grid.res, width: grid.width, height: grid.height, noData: "0",
    codes: { 0: "Not observed or outside the area", 1: "Dry", 2: "Water before the flood", 3: "Flooded" },
  };
}
