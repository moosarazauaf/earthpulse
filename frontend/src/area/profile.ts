/**
 * Ground height along the measuring line, from the same AWS Terrain Tiles as
 * the area overview: points at even spacing along the path, each read from
 * the tile pixel under it, at the finest zoom that keeps the download small.
 */
import { latToTileY, lonToTileX, readTile } from "./elevation";
import { pathKm } from "./measure";
import { distanceKm } from "../news/stories";

const SAMPLES = 128;
const MAX_TILES = 24;

/** `n` points at even distances along the path (straight in longitude and latitude within each segment), with their distance from the start in km. */
export function samplePath(points: [number, number][], n = SAMPLES): { lon: number; lat: number; km: number }[] {
  const total = pathKm(points);
  if (points.length < 2 || total === 0) return [];
  const legs = points.slice(1).map((p, i) => distanceKm({ lon: points[i]![0], lat: points[i]![1] }, { lon: p[0], lat: p[1] }));
  const out: { lon: number; lat: number; km: number }[] = [];
  for (let k = 0; k < n; k += 1) {
    const km = (total * k) / (n - 1);
    let leg = 0, start = 0;
    while (leg < legs.length - 1 && start + legs[leg]! < km) { start += legs[leg]!; leg += 1; }
    const f = legs[leg]! > 0 ? Math.min(1, (km - start) / legs[leg]!) : 0;
    const [lon0, lat0] = points[leg]!, [lon1, lat1] = points[leg + 1]!;
    out.push({ lon: lon0 + (lon1 - lon0) * f, lat: lat0 + (lat1 - lat0) * f, km });
  }
  return out;
}

export interface ProfileStats { min: number; max: number; climb: number; descent: number }

/** Lowest and highest point, and the total climbed and descended along the way. */
export function profileStats(heights: number[]): ProfileStats {
  let climb = 0, descent = 0;
  for (let i = 1; i < heights.length; i += 1) {
    const d = heights[i]! - heights[i - 1]!;
    if (d > 0) climb += d; else descent -= d;
  }
  return { min: Math.min(...heights), max: Math.max(...heights), climb, descent };
}

/**
 * The zoom to read: the coarsest (up to 14) whose pixels are still no larger
 * than the spacing between samples, made coarser while the path would need
 * more than MAX_TILES tiles.
 */
export function profileZoom(samples: { lon: number; lat: number }[], spacingM: number): number {
  const pixelM = (z: number) => (156_543 * Math.cos((samples[0]!.lat * Math.PI) / 180)) / 2 ** z;
  const tiles = (z: number) => new Set(samples.map((s) => `${Math.floor(lonToTileX(s.lon, z))}/${Math.floor(latToTileY(s.lat, z))}`)).size;
  let z = 14;
  while (z > 2 && pixelM(z - 1) <= spacingM) z -= 1;
  while (z > 2 && tiles(z) > MAX_TILES) z -= 1;
  return z;
}

export async function fetchProfile(points: [number, number][], signal?: AbortSignal) {
  const samples = samplePath(points);
  if (!samples.length) return null;
  const z = profileZoom(samples, (samples[samples.length - 1]!.km * 1000) / (SAMPLES - 1));
  const tiles = new Map<string, Promise<Float32Array>>();
  const heights = await Promise.all(samples.map(async (s) => {
    const fx = lonToTileX(s.lon, z), fy = latToTileY(s.lat, z);
    const key = `${Math.floor(fx)}/${Math.floor(fy)}`;
    if (!tiles.has(key)) tiles.set(key, readTile(z, Math.floor(fx), Math.floor(fy), signal));
    const tile = await tiles.get(key)!;
    const px = Math.min(255, Math.floor((fx % 1) * 256)), py = Math.min(255, Math.floor((fy % 1) * 256));
    return tile[py * 256 + px]!;
  }));
  return { samples, heights, stats: profileStats(heights), zoom: z };
}
