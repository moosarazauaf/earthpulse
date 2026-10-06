/**
 * Reading cloud-optimised GeoTIFFs onto an analysis grid, and the per-pixel
 * arithmetic shared by browser analyses.
 */
import { fromUrl } from "geotiff";

import { type Grid, gridBounds, gridBoundsIn, transformer } from "./geo";
import { type OpticalDataset, type Scene, readToken } from "./pc";

/** Spacing, in pixels, of the lattice on which coordinates are reprojected exactly. */
const LATTICE = 32;

// Landsat Collection 2 Level-2: reflectance = DN * 0.0000275 - 0.2, DN 0 is fill.
const LANDSAT_SCALE = 0.0000275;
const LANDSAT_OFFSET = -0.2;
// QA_PIXEL bits 0-5: fill, dilated cloud, cirrus, cloud, cloud shadow, snow.
const LANDSAT_QA_REJECT = 0b111111;
// Sentinel-2 L2A: reflectance = (DN + offset) / 10000; offset is -1000 from baseline 04.00.
const S2_SCALE = 0.0001;
const S2_OFFSET_BASELINE = 4;
const S2_OFFSET_DN = -1000;
// SCL classes rejected: no data, saturated, cloud shadow, cloud medium/high, cirrus, snow.
const S2_SCL_REJECT = new Set([0, 1, 3, 8, 9, 10, 11]);

type Numeric = Uint8Array | Uint16Array | Int16Array | Float32Array;

/**
 * Read one file onto the grid. The read is made at the grid's resolution, so
 * the library fetches only the overview blocks under the area.
 */
export async function readOntoGrid(
  href: string,
  collection: string,
  sourceEpsg: number,
  grid: Grid,
  categorical: boolean,
  signal?: AbortSignal,
): Promise<Numeric> {
  const tiff = await fromUrl(`${href}?${await readToken(collection)}`, {}, signal);
  // Nearest neighbour for every layer: interpolating would blend the fill value
  // 0 into real reflectance at scene edges. `categorical` is kept for callers
  // that later need a smoother read of continuous data.
  void categorical;
  const resampleMethod = "nearest";
  if (sourceEpsg === grid.epsg) {
    const [data] = (await tiff.readRasters({
      bbox: gridBounds(grid), width: grid.width, height: grid.height,
      samples: [0], fillValue: 0, resampleMethod, signal,
    })) as unknown as Numeric[];
    return data as Numeric;
  }
  // The scene is in a neighbouring UTM zone: read its window, then resample.
  const [west, south, east, north] = gridBoundsIn(grid, sourceEpsg);
  const width = Math.max(1, Math.ceil((east - west) / grid.res));
  const height = Math.max(1, Math.ceil((north - south) / grid.res));
  const [source] = (await tiff.readRasters({
    bbox: [west, south, east, north], width, height, samples: [0], fillValue: 0, resampleMethod, signal,
  })) as unknown as Numeric[];
  return resample(source as Numeric, { west, north, width, height, res: (east - west) / width, resY: (north - south) / height },
    sourceEpsg, grid);
}

interface SourceWindow {
  west: number;
  north: number;
  width: number;
  height: number;
  res: number;
  resY: number;
}

/** Nearest-neighbour resampling between UTM zones, with coordinates interpolated from a lattice. */
function resample(source: Numeric, window: SourceWindow, sourceEpsg: number, grid: Grid): Numeric {
  const forward = transformer(grid.epsg, sourceEpsg);
  const cols = Math.ceil(grid.width / LATTICE) + 1;
  const rows = Math.ceil(grid.height / LATTICE) + 1;
  const latticeX = new Float64Array(cols * rows);
  const latticeY = new Float64Array(cols * rows);
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const [x, y] = forward(grid.west + c * LATTICE * grid.res, grid.north - r * LATTICE * grid.res);
      latticeX[r * cols + c] = x;
      latticeY[r * cols + c] = y;
    }
  }
  const out = new (source.constructor as new (n: number) => Numeric)(grid.width * grid.height);
  for (let row = 0; row < grid.height; row += 1) {
    const fy = (row + 0.5) / LATTICE;
    const r0 = Math.floor(fy);
    const ty = fy - r0;
    for (let col = 0; col < grid.width; col += 1) {
      const fx = (col + 0.5) / LATTICE;
      const c0 = Math.floor(fx);
      const tx = fx - c0;
      const i = r0 * cols + c0;
      const x = lerp2(latticeX, i, cols, tx, ty);
      const y = lerp2(latticeY, i, cols, tx, ty);
      const sc = Math.floor((x - window.west) / window.res);
      const sr = Math.floor((window.north - y) / window.resY);
      if (sc >= 0 && sc < window.width && sr >= 0 && sr < window.height) {
        out[row * grid.width + col] = source[sr * window.width + sc] as number;
      }
    }
  }
  return out;
}

function lerp2(lattice: Float64Array, i: number, cols: number, tx: number, ty: number): number {
  const top = (lattice[i] as number) * (1 - tx) + (lattice[i + 1] as number) * tx;
  const bottom = (lattice[i + cols] as number) * (1 - tx) + (lattice[i + cols + 1] as number) * tx;
  return top * (1 - ty) + bottom * ty;
}

/** Surface reflectance from stored digital numbers; fill and QA-rejected pixels become NaN. */
export function toReflectance(dataset: OpticalDataset, dn: Numeric, qa: Numeric, baseline: number | null): Float32Array {
  const out = new Float32Array(dn.length);
  const offset = dataset === "sentinel2" && (baseline ?? 0) >= S2_OFFSET_BASELINE ? S2_OFFSET_DN : 0;
  for (let i = 0; i < dn.length; i += 1) {
    const value = dn[i] as number;
    const flag = qa[i] as number;
    const clear = dataset === "landsat" ? (flag & LANDSAT_QA_REJECT) === 0 : !S2_SCL_REJECT.has(flag);
    if (value === 0 || !clear) out[i] = NaN;
    else out[i] = dataset === "landsat" ? value * LANDSAT_SCALE + LANDSAT_OFFSET : (value + offset) * S2_SCALE;
  }
  return out;
}

/** Per-pixel median of several layers, ignoring NaN. Also returns how many layers were valid. */
export function medianComposite(layers: Float32Array[]): { median: Float32Array; count: Uint8Array } {
  const length = layers[0]?.length ?? 0;
  const median = new Float32Array(length);
  const count = new Uint8Array(length);
  const values: number[] = [];
  for (let i = 0; i < length; i += 1) {
    values.length = 0;
    for (const layer of layers) {
      const v = layer[i] as number;
      if (!Number.isNaN(v)) values.push(v);
    }
    count[i] = values.length;
    if (values.length === 0) median[i] = NaN;
    else {
      values.sort((a, b) => a - b);
      const mid = values.length >> 1;
      median[i] = values.length % 2 ? (values[mid] as number) : ((values[mid - 1] as number) + (values[mid] as number)) / 2;
    }
  }
  return { median, count };
}

/** (a - b) / (a + b), NaN where either input is missing or the sum is not positive. */
export function normalizedDifference(a: Float32Array, b: Float32Array): Float32Array {
  const out = new Float32Array(a.length);
  for (let i = 0; i < a.length; i += 1) {
    const sum = (a[i] as number) + (b[i] as number);
    out[i] = sum > 0 ? Math.max(-1, Math.min(1, ((a[i] as number) - (b[i] as number)) / sum)) : NaN;
  }
  return out;
}

/**
 * Cloud-free composite of the requested bands for a set of scenes.
 * `onRead` is called after each file arrives, so progress shown is real.
 */
export async function compositeBands(
  dataset: OpticalDataset,
  bands: Record<string, string>,
  bandNames: string[],
  scenes: Scene[],
  grid: Grid,
  concurrency: number,
  onRead: () => void,
  signal?: AbortSignal,
): Promise<{ bands: Record<string, Float32Array>; clearCount: Uint8Array }> {
  const qaKey = bands.qa as string;
  const tasks: { scene: Scene; asset: string }[] = [];
  for (const scene of scenes) for (const name of ["qa", ...bandNames]) tasks.push({ scene, asset: bands[name] as string });
  const raw = new Map<string, Numeric>();
  let next = 0;
  async function worker() {
    while (next < tasks.length) {
      const task = tasks[next++] as { scene: Scene; asset: string };
      const href = task.scene.assets[task.asset];
      if (!href) throw new Error(`Scene ${task.scene.id} has no ${task.asset} band.`);
      raw.set(`${task.scene.id}/${task.asset}`,
        await readOntoGrid(href, task.scene.collection, task.scene.epsg, grid, task.asset === qaKey, signal));
      onRead();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, worker));

  const perBand: Record<string, Float32Array[]> = Object.fromEntries(bandNames.map((n) => [n, []]));
  for (const scene of scenes) {
    const qa = raw.get(`${scene.id}/${qaKey}`) as Numeric;
    const layers = bandNames.map((name) =>
      toReflectance(dataset, raw.get(`${scene.id}/${bands[name]}`) as Numeric, qa, scene.baseline));
    // A pixel is used only where every requested band is valid in that scene.
    for (let i = 0; i < qa.length; i += 1) {
      if (layers.some((layer) => Number.isNaN(layer[i] as number))) for (const layer of layers) layer[i] = NaN;
    }
    bandNames.forEach((name, k) => (perBand[name] as Float32Array[]).push(layers[k] as Float32Array));
  }
  const out: Record<string, Float32Array> = {};
  let clearCount: Uint8Array = new Uint8Array(grid.width * grid.height);
  for (const name of bandNames) {
    const { median, count } = medianComposite(perBand[name] as Float32Array[]);
    out[name] = median;
    clearCount = count;
  }
  return { bands: out, clearCount };
}

/**
 * Reproject an RGBA image from the analysis grid to a north-up EPSG:4326
 * image, which is what the globe can drape. Nearest neighbour.
 */
export function toGeographicRgba(rgba: Uint8ClampedArray, grid: Grid): {
  data: Uint8ClampedArray; width: number; height: number; bounds: [number, number, number, number];
} {
  const [west, south, east, north] = gridBoundsIn(grid, 4326);
  // Keep roughly the grid's pixel count.
  const width = grid.width;
  const height = Math.max(1, Math.round((grid.width * (north - south)) / (east - west) / Math.cos((((north + south) / 2) * Math.PI) / 180)));
  const forward = transformer(4326, grid.epsg);
  const cols = Math.ceil(width / LATTICE) + 1;
  const rows = Math.ceil(height / LATTICE) + 1;
  const latticeX = new Float64Array(cols * rows);
  const latticeY = new Float64Array(cols * rows);
  const dx = (east - west) / width;
  const dy = (north - south) / height;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const [x, y] = forward(west + c * LATTICE * dx, north - r * LATTICE * dy);
      latticeX[r * cols + c] = x;
      latticeY[r * cols + c] = y;
    }
  }
  const data = new Uint8ClampedArray(width * height * 4);
  for (let row = 0; row < height; row += 1) {
    const fy = (row + 0.5) / LATTICE;
    const r0 = Math.floor(fy);
    for (let col = 0; col < width; col += 1) {
      const fx = (col + 0.5) / LATTICE;
      const c0 = Math.floor(fx);
      const i = r0 * cols + c0;
      const x = lerp2(latticeX, i, cols, fx - c0, fy - r0);
      const y = lerp2(latticeY, i, cols, fx - c0, fy - r0);
      const sc = Math.floor((x - grid.west) / grid.res);
      const sr = Math.floor((grid.north - y) / grid.res);
      if (sc >= 0 && sc < grid.width && sr >= 0 && sr < grid.height) {
        const s = (sr * grid.width + sc) * 4;
        const d = (row * width + col) * 4;
        data[d] = rgba[s] as number;
        data[d + 1] = rgba[s + 1] as number;
        data[d + 2] = rgba[s + 2] as number;
        data[d + 3] = rgba[s + 3] as number;
      }
    }
  }
  return { data, width, height, bounds: [west, south, east, north] };
}
