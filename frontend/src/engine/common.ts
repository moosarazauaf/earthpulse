/** Pieces shared by the browser analyses: regions, histograms, colour ramps, result images. */
import { type Grid, transformer } from "./geo";
import { toGeographicRgba } from "./raster";

export const M2_PER_HA = 10_000;
export const MAX_REGIONS = 200;

export interface Progress {
  stage: "ACQUIRING_DATA" | "PROCESSING_IMAGERY" | "CALCULATING_INDICES" | "DETECTING_CHANGE" | "GENERATING_RESULTS";
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

export type RampLegend = { min: number; max: number; colors: string[]; unit?: string };
export type ClassLegend = { classes: { label: string; color: string }[] };
export interface EngineOverlay {
  title: string;
  blob: Blob;
  bounds: [number, number, number, number];
  legend: RampLegend | ClassLegend;
}

export type Rgb = [number, number, number];
export const hex = (rgb: Rgb) => `#${rgb.map((c) => c.toString(16).padStart(2, "0")).join("")}`;

export function mean(values: Float32Array, use: Uint8Array): number | null {
  let sum = 0, n = 0;
  for (let i = 0; i < values.length; i += 1) {
    if (use[i]) {
      sum += values[i] as number;
      n += 1;
    }
  }
  return n ? sum / n : null;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

export function histogram(values: Float32Array, use: Uint8Array, bins: number, lo: number, hi: number) {
  const counts = new Array<number>(bins).fill(0);
  for (let i = 0; i < values.length; i += 1) {
    if (!use[i]) continue;
    const bin = Math.floor((((values[i] as number) - lo) / (hi - lo)) * bins);
    if (bin >= 0 && bin < bins) counts[bin] = (counts[bin] as number) + 1;
    else if (bin === bins) counts[bins - 1] = (counts[bins - 1] as number) + 1;
  }
  return { binEdges: Array.from({ length: bins + 1 }, (_, i) => lo + ((hi - lo) * i) / bins), counts };
}

/** Median day of year of a set of acquisition times. */
export function typicalDayOfYear(datetimes: string[]): number {
  const days = datetimes.map((d) => {
    const date = new Date(d);
    return (Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()) - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86_400_000;
  });
  return median(days) ?? 0;
}

// ---- regions ---------------------------------------------------------------------
export interface Region {
  value: number;
  pixels: number;
  before: number | null;
  after: number | null;
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
  centreCol: number;
  centreRow: number;
  countBefore: number | null;
  countAfter: number | null;
}

/**
 * Connected regions (8-neighbour) of each non-zero class, largest first,
 * with the mean of two value layers over each region.
 */
export function findRegions(
  classes: Uint8Array, width: number, height: number, minPixels: number,
  before: Float32Array, after: Float32Array, countBefore?: Uint8Array, countAfter?: Uint8Array,
): Region[] {
  const seen = new Uint8Array(classes.length);
  const stack: number[] = [];
  const regions: Region[] = [];
  for (let start = 0; start < classes.length; start += 1) {
    const value = classes[start] as number;
    if (!value || seen[start]) continue;
    let pixels = 0, sumB = 0, sumA = 0, nB = 0, nA = 0, sumCol = 0, sumRow = 0, cB = 0, cA = 0;
    let minCol = width, maxCol = 0, minRow = height, maxRow = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop() as number;
      const row = Math.floor(i / width);
      const col = i - row * width;
      pixels += 1;
      sumCol += col;
      sumRow += row;
      if (col < minCol) minCol = col;
      if (col > maxCol) maxCol = col;
      if (row < minRow) minRow = row;
      if (row > maxRow) maxRow = row;
      const b = before[i] as number, a = after[i] as number;
      if (!Number.isNaN(b)) { sumB += b; nB += 1; }
      if (!Number.isNaN(a)) { sumA += a; nA += 1; }
      if (countBefore) cB += countBefore[i] as number;
      if (countAfter) cA += countAfter[i] as number;
      for (let dr = -1; dr <= 1; dr += 1) {
        const r = row + dr;
        if (r < 0 || r >= height) continue;
        for (let dc = -1; dc <= 1; dc += 1) {
          const c = col + dc;
          if (c < 0 || c >= width) continue;
          const j = r * width + c;
          if (!seen[j] && classes[j] === value) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    if (pixels >= minPixels) {
      regions.push({
        value, pixels, before: nB ? sumB / nB : null, after: nA ? sumA / nA : null,
        minCol, maxCol, minRow, maxRow, centreCol: sumCol / pixels, centreRow: sumRow / pixels,
        countBefore: countBefore ? cB / pixels : null, countAfter: countAfter ? cA / pixels : null,
      });
    }
  }
  return regions.sort((x, y) => y.pixels - x.pixels);
}

/**
 * Regions as GeoJSON. The browser engine does not trace outlines, so each
 * region's geometry is its bounding box; the area is the true pixel area.
 */
export function regionsToGeoJson(regions: Region[], grid: Grid, directionOf: (value: number) => "decrease" | "increase") {
  const toLonLat = transformer(grid.epsg, 4326);
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  const corner = (col: number, row: number) => toLonLat(grid.west + col * grid.res, grid.north - row * grid.res);
  const features = regions.slice(0, MAX_REGIONS).map((region, index) => {
    const ring = [
      corner(region.minCol, region.maxRow + 1), corner(region.maxCol + 1, region.maxRow + 1),
      corner(region.maxCol + 1, region.minRow), corner(region.minCol, region.minRow),
    ];
    return {
      type: "Feature" as const,
      id: index + 1,
      geometry: { type: "Polygon" as const, coordinates: [[...ring, ring[0] as [number, number]]] },
      properties: {
        direction: directionOf(region.value),
        areaHa: region.pixels * pixelHa,
        before: region.before,
        after: region.after,
        change: region.before !== null && region.after !== null ? region.after - region.before : null,
        clearObservationsBefore: region.countBefore,
        clearObservationsAfter: region.countAfter,
        centroid: corner(region.centreCol + 0.5, region.centreRow + 0.5),
        outline: "bounding-box" as const,
      },
    };
  });
  return { type: "FeatureCollection" as const, features, totalRegions: regions.length, truncated: regions.length > MAX_REGIONS };
}

// ---- result images ---------------------------------------------------------------
/** Colour a continuous layer by linear interpolation between stops; NaN stays transparent. */
export function rampImage(values: Float32Array, lo: number, hi: number, stops: Rgb[]): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(values.length * 4);
  const last = stops.length - 1;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i] as number;
    if (Number.isNaN(v)) continue;
    const t = Math.min(1, Math.max(0, (v - lo) / (hi - lo))) * last;
    const k = Math.min(last - 1, Math.floor(t));
    const f = t - k;
    const a = stops[k] as Rgb, b = stops[k + 1] as Rgb;
    rgba[i * 4] = a[0] + (b[0] - a[0]) * f;
    rgba[i * 4 + 1] = a[1] + (b[1] - a[1]) * f;
    rgba[i * 4 + 2] = a[2] + (b[2] - a[2]) * f;
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

/** Colour a class layer; classes without a colour stay transparent. */
export function classImage(classes: Uint8Array, colours: Record<number, Rgb>): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(classes.length * 4);
  for (let i = 0; i < classes.length; i += 1) {
    const rgb = colours[classes[i] as number];
    if (!rgb) continue;
    rgba[i * 4] = rgb[0];
    rgba[i * 4 + 1] = rgb[1];
    rgba[i * 4 + 2] = rgb[2];
    rgba[i * 4 + 3] = 255;
  }
  return rgba;
}

export async function makeOverlay(
  title: string, rgba: Uint8ClampedArray, grid: Grid, legend: EngineOverlay["legend"], hooks: EngineHooks,
): Promise<EngineOverlay> {
  const image = toGeographicRgba(rgba, grid);
  return { title, legend, bounds: image.bounds, blob: await hooks.encode(image.data, image.width, image.height) };
}

/** Run tasks with a fixed number in flight, preserving result order. */
export async function pooled<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next++;
      results[index] = await task(items[index] as T);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
