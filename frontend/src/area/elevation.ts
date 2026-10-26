/**
 * Terrain of an area from the AWS Terrain Tiles (open data, no key): heights
 * encoded in PNG tiles ("Terrarium"), built by Mapzen from SRTM, GMTED2010,
 * ETOPO1 and national elevation models. About 30 m in most of the world.
 * SRTM-based heights are a surface model: in cities and forests they include
 * the tops of buildings and trees.
 */
import type { AoiGeometry } from "../app/types";

const TILES = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium";
const TILE = 256;
const MAX_ZOOM = 14;
const MAX_TILES = 9;
const EQUATOR_M = 40_075_016.686;

/** Slope classes in degrees, with the upper bound of each. */
export const SLOPE_CLASSES = [
  { label: "Flat", max: 2 },
  { label: "Gentle", max: 8 },
  { label: "Moderate", max: 15 },
  { label: "Steep", max: 30 },
  { label: "Very steep", max: 90 },
] as const;

export function decodeTerrarium(r: number, g: number, b: number): number {
  return r * 256 + g + b / 256 - 32768;
}

export function lonToTileX(lon: number, z: number): number {
  return ((lon + 180) / 360) * 2 ** z;
}
export function latToTileY(lat: number, z: number): number {
  const rad = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * 2 ** z;
}
function tileYToLat(y: number, z: number): number {
  const n = Math.PI - (2 * Math.PI * y) / 2 ** z;
  return (180 / Math.PI) * Math.atan(Math.sinh(n));
}

/** The zoom at which the area spans a few hundred pixels and at most nine tiles. */
export function chooseZoom(bounds: [number, number, number, number]): number {
  const [w, s, e, n] = bounds;
  let z = MAX_ZOOM;
  while (z > 1) {
    const nx = Math.floor(lonToTileX(e, z)) - Math.floor(lonToTileX(w, z)) + 1;
    const ny = Math.floor(latToTileY(s, z)) - Math.floor(latToTileY(n, z)) + 1;
    const px = (lonToTileX(e, z) - lonToTileX(w, z)) * TILE;
    if (nx * ny <= MAX_TILES && px <= 768) return z;
    z -= 1;
  }
  return z;
}

/** Even-odd test, so holes in a polygon count as outside. */
export function insideRings(lon: number, lat: number, rings: number[][][]): boolean {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi = 0, yi = 0] = ring[i]!, [xj = 0, yj = 0] = ring[j]!;
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

export interface Terrain {
  min: number;
  max: number;
  mean: number;
  lowest: [number, number];
  highest: [number, number];
  /** Share of the area in each slope class, in SLOPE_CLASSES order. */
  slopeShares: number[];
  meanSlope: number;
  resolutionM: number;
}

/**
 * Statistics over a height mosaic. `heights` is row-major, `width` wide,
 * with its top-left pixel at tile coordinates (x0, y0) at zoom z.
 */
export function terrainStats(heights: Float32Array, width: number, height: number, x0: number, y0: number, z: number, rings: number[][][]): Terrain | null {
  let n = 0, sum = 0, min = Infinity, max = -Infinity, slopeSum = 0;
  let lowest: [number, number] = [0, 0], highest: [number, number] = [0, 0];
  const shares = SLOPE_CLASSES.map(() => 0);
  let latMid = 0;
  for (let row = 1; row < height - 1; row += 1) {
    const lat = tileYToLat(y0 + (row + 0.5) / TILE, z);
    const res = (EQUATOR_M * Math.cos((lat * Math.PI) / 180)) / (TILE * 2 ** z);
    for (let col = 1; col < width - 1; col += 1) {
      const lon = ((x0 + (col + 0.5) / TILE) / 2 ** z) * 360 - 180;
      if (!insideRings(lon, lat, rings)) continue;
      const i = row * width + col;
      const h = heights[i] as number;
      n += 1;
      sum += h;
      latMid += lat;
      if (h < min) { min = h; lowest = [lon, lat]; }
      if (h > max) { max = h; highest = [lon, lat]; }
      // Horn would be smoother; central differences are enough for class shares.
      const dzdx = ((heights[i + 1] as number) - (heights[i - 1] as number)) / (2 * res);
      const dzdy = ((heights[i + width] as number) - (heights[i - width] as number)) / (2 * res);
      const slope = (Math.atan(Math.hypot(dzdx, dzdy)) * 180) / Math.PI;
      slopeSum += slope;
      shares[SLOPE_CLASSES.findIndex((c) => slope < c.max)]! += 1;
    }
  }
  if (!n) return null;
  const meanLat = latMid / n;
  return {
    min, max, mean: sum / n, lowest, highest,
    slopeShares: shares.map((c) => c / n),
    meanSlope: slopeSum / n,
    resolutionM: (EQUATOR_M * Math.cos((meanLat * Math.PI) / 180)) / (TILE * 2 ** z),
  };
}

async function readTile(z: number, x: number, y: number, signal?: AbortSignal): Promise<Float32Array> {
  const response = await fetch(`${TILES}/${z}/${x}/${y}.png`, { signal });
  if (!response.ok) throw new Error("Elevation tiles could not be read.");
  const bitmap = await createImageBitmap(await response.blob());
  // Older Safari has no 2D OffscreenCanvas; a detached canvas element does the same job.
  const canvas: OffscreenCanvas | HTMLCanvasElement = typeof OffscreenCanvas !== "undefined"
    ? new OffscreenCanvas(TILE, TILE)
    : Object.assign(document.createElement("canvas"), { width: TILE, height: TILE });
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  context.drawImage(bitmap, 0, 0);
  const { data } = context.getImageData(0, 0, TILE, TILE);
  const out = new Float32Array(TILE * TILE);
  for (let i = 0; i < out.length; i += 1) out[i] = decodeTerrarium(data[i * 4]!, data[i * 4 + 1]!, data[i * 4 + 2]!);
  return out;
}

export async function fetchTerrain(aoi: AoiGeometry, signal?: AbortSignal): Promise<Terrain | null> {
  const rings = aoi.type === "Polygon" ? [aoi.coordinates[0]!] : aoi.coordinates.map((p) => p[0]!);
  const all = rings.flat();
  const bounds: [number, number, number, number] = [
    Math.min(...all.map((p) => p[0]!)), Math.min(...all.map((p) => p[1]!)),
    Math.max(...all.map((p) => p[0]!)), Math.max(...all.map((p) => p[1]!)),
  ];
  const z = chooseZoom(bounds);
  const tx0 = Math.floor(lonToTileX(bounds[0], z)), tx1 = Math.floor(lonToTileX(bounds[2], z));
  const ty0 = Math.floor(latToTileY(bounds[3], z)), ty1 = Math.floor(latToTileY(bounds[1], z));
  const nx = tx1 - tx0 + 1, ny = ty1 - ty0 + 1;
  const width = nx * TILE, height = ny * TILE;
  const heights = new Float32Array(width * height);
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      jobs.push(readTile(z, tx, ty, signal).then((tile) => {
        const ox = (tx - tx0) * TILE, oy = (ty - ty0) * TILE;
        for (let r = 0; r < TILE; r += 1) heights.set(tile.subarray(r * TILE, (r + 1) * TILE), (oy + r) * width + ox);
      }));
    }
  }
  await Promise.all(jobs);
  return terrainStats(heights, width, height, tx0, ty0, z, rings as number[][][]);
}
