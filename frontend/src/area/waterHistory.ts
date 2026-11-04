/**
 * Has this ground been under water? The JRC Global Surface Water occurrence
 * map (European Commission JRC and Google, from every Landsat image 1984 to
 * 2021, 30 m) gives, for each pixel, the share of clear observations in which
 * it was water. Its public tiles colour that share from red (rarely) to blue
 * (always) and are transparent where water was never seen, so the share can
 * be read back from the blue channel.
 */
import type { AoiGeometry } from "../app/types";
import { chooseZoom, insideRings, latToTileY, lonToTileX, readPixels, tileYToLat } from "./elevation";

export const WATER_TILES = "https://storage.googleapis.com/global-surface-water/tiles2021/occurrence";
/** The occurrence tiles stop at this zoom. */
const MAX_ZOOM = 12;
const TILE = 256;

/** Water occurrence (% of observations, 0 = never seen) from a tile pixel. */
export const occurrence = (b: number, a: number) => (a === 0 ? 0 : Math.max(1, Math.round((b / 255) * 100)));

export interface WaterHistory {
  /** Share of the area's pixels that were water at least once. */
  ever: number;
  /** Share that was water in at least half of all observations: rivers, lakes and reservoirs. */
  often: number;
  /** Share that was water sometimes but less than half the time: floodplains, seasonal and shifting water. */
  sometimes: number;
  pixels: number;
}

export function summarise(values: number[]): WaterHistory | null {
  if (!values.length) return null;
  const ever = values.filter((v) => v > 0).length / values.length;
  const often = values.filter((v) => v >= 50).length / values.length;
  return { ever, often, sometimes: ever - often, pixels: values.length };
}

export async function fetchWaterHistory(aoi: AoiGeometry, signal?: AbortSignal): Promise<WaterHistory | null> {
  const rings = (aoi.type === "Polygon" ? [aoi.coordinates[0]!] : aoi.coordinates.map((p) => p[0]!)) as number[][][];
  const all = rings.flat();
  const bounds: [number, number, number, number] = [
    Math.min(...all.map((p) => p[0]!)), Math.min(...all.map((p) => p[1]!)),
    Math.max(...all.map((p) => p[0]!)), Math.max(...all.map((p) => p[1]!)),
  ];
  const z = Math.min(chooseZoom(bounds), MAX_ZOOM);
  const tx0 = Math.floor(lonToTileX(bounds[0], z)), tx1 = Math.floor(lonToTileX(bounds[2], z));
  const ty0 = Math.floor(latToTileY(bounds[3], z)), ty1 = Math.floor(latToTileY(bounds[1], z));
  const values: number[] = [];
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty += 1) {
    for (let tx = tx0; tx <= tx1; tx += 1) {
      const add = (data: Uint8ClampedArray | null) => {
        for (let py = 0; py < TILE; py += 1) {
          const lat = tileYToLat(ty + (py + 0.5) / TILE, z);
          for (let px = 0; px < TILE; px += 1) {
            const lon = ((tx + (px + 0.5) / TILE) / 2 ** z) * 360 - 180;
            if (!insideRings(lon, lat, rings)) continue;
            const i = (py * TILE + px) * 4;
            values.push(data ? occurrence(data[i + 2]!, data[i + 3]!) : 0);
          }
        }
      };
      // A tile that is not published (404) has no water in it; any other failure is an error.
      jobs.push(readPixels(`${WATER_TILES}/${z}/${tx}/${ty}.png`, signal).then(add, (e: unknown) => {
        if ((e as { status?: number }).status !== 404) throw e;
        add(null);
      }));
    }
  }
  await Promise.all(jobs);
  return summarise(values);
}
