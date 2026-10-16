/**
 * Land cover of an area from ESA WorldCover 2021 (10 m): the share of each
 * class and a map. A quick read used by the area overview; WorldCover is a
 * classification with a reported overall accuracy of about 77%.
 */
import type { AoiGeometry } from "../app/types";
import { type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, classImage, hex, makeOverlay } from "./common";
import { buildGrid, projectAoi, rasterMask } from "./geo";
import { readOntoGrid } from "./raster";

const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const COLLECTION = "esa-worldcover";
const VERSION = "2021_v200";

/** Class codes and colours from the WorldCover 2021 product user manual. */
export const WORLDCOVER: Record<number, { name: string; colour: Rgb }> = {
  10: { name: "Tree cover", colour: [0, 100, 0] },
  20: { name: "Shrubland", colour: [255, 187, 34] },
  30: { name: "Grassland", colour: [255, 255, 76] },
  40: { name: "Cropland", colour: [240, 150, 255] },
  50: { name: "Built-up", colour: [250, 0, 0] },
  60: { name: "Bare or sparse vegetation", colour: [180, 180, 180] },
  70: { name: "Snow and ice", colour: [240, 240, 240] },
  80: { name: "Permanent water", colour: [0, 100, 200] },
  90: { name: "Herbaceous wetland", colour: [0, 150, 160] },
  95: { name: "Mangroves", colour: [0, 207, 117] },
  100: { name: "Moss and lichen", colour: [250, 230, 160] },
};

export interface CoverRequest {
  aoi: AoiGeometry;
  maxPixels: number;
}

/** Hectares and share of each class among the mapped pixels inside the mask, largest first. */
export function coverShares(map: Uint8Array, mask: Uint8Array, pixelHa: number): { code: number; name: string; ha: number; share: number }[] {
  const counts = new Map<number, number>();
  let total = 0;
  for (let i = 0; i < map.length; i += 1) {
    const c = map[i] as number;
    if (!mask[i] || !c) continue;
    counts.set(c, (counts.get(c) ?? 0) + 1);
    total += 1;
  }
  return [...counts.entries()]
    .map(([code, n]) => ({ code, name: WORLDCOVER[code]?.name ?? `Class ${code}`, ha: n * pixelHa, share: total ? n / total : 0 }))
    .sort((a, b) => b.ha - a.ha);
}

export async function runCover(request: CoverRequest, hooks: EngineHooks) {
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, 10, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 1, detail: "Finding the land-cover map" });
  const response = await fetch(STAC_SEARCH, {
    method: "POST", signal: hooks.signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collections: [COLLECTION], bbox: aoi.lonLatBounds, limit: 20 }),
  });
  if (!response.ok) throw new Error("The land-cover catalogue is temporarily unavailable.");
  const tiles = ((await response.json()) as { features: { id: string; assets: Record<string, { href: string }> }[] }).features
    .filter((f) => f.id.includes(VERSION) && f.assets.map);
  if (!tiles.length) throw new Error("No WorldCover map covers this area.");
  const map = new Uint8Array(grid.width * grid.height);
  let done = 0;
  for (const tile of tiles) {
    const part = await readOntoGrid(tile.assets.map!.href, COLLECTION, 4326, grid, true, hooks.signal);
    for (let i = 0; i < map.length; i += 1) if (!map[i]) map[i] = part[i] as number;
    done += 1;
    hooks.progress({ stage: "PROCESSING_IMAGERY", done, total: tiles.length, detail: "Reading the land-cover map" });
  }
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  const shares = coverShares(map, mask, pixelHa);
  const masked = map.map((v, i) => (mask[i] ? v : 0));
  const colours = Object.fromEntries(Object.entries(WORLDCOVER).map(([c, v]) => [Number(c), v.colour])) as Record<number, Rgb>;
  const overlay: EngineOverlay = await makeOverlay("Land cover 2021 (ESA WorldCover)", classImage(masked, colours), grid, {
    classes: shares.map((s) => ({ label: s.name, color: hex(WORLDCOVER[s.code]?.colour ?? [128, 128, 128]) })),
  }, hooks);
  return { type: "cover" as const, shares, resolution: grid.res, overlays: { cover: overlay }, grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height } };
}

export type CoverResult = Awaited<ReturnType<typeof runCover>>;
