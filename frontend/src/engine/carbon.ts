/**
 * Carbon stored in living plants over an area, from the Harmonized Global
 * Biomass map (Spawn, Sullivan, Lark and Gibbs 2020, Scientific Data; 300 m,
 * year 2010) on Microsoft Planetary Computer. It gives above- and
 * below-ground biomass carbon density in tonnes of carbon per hectare, stored
 * as whole numbers ten times the value (Amazon forest reads 1489, 148.9 t C/ha).
 *
 * Biomass only: soil and dead-wood carbon are not included, and the map shows
 * 2010, so clearing or planting since then is not reflected.
 */
import type { AoiGeometry } from "../app/types";
import { type EngineHooks, M2_PER_HA } from "./common";
import { buildGrid, projectAoi, rasterMask } from "./geo";
import { readOntoGrid } from "./raster";

const COLLECTION = "hgb";
const BASE = "https://cpdataeuwest.blob.core.windows.net/cpdata/raw/2010-harmonized-biomass/global/300m";
const SCALE = 0.1;
/** Tonnes of CO2 per tonne of carbon (molar masses 44 and 12). */
export const CO2_PER_C = 44 / 12;
/** The map's pixels are 300 m; reading finer only repeats them. */
const GRID_RES = 100;

export interface CarbonRequest { aoi: AoiGeometry; maxPixels: number }

export interface CarbonSums {
  /** Tonnes of carbon above and below ground, and their total. */
  above: number;
  below: number;
  total: number;
  /** Mean total carbon density, t C/ha, over the mapped hectares. */
  meanDensity: number;
  hectares: number;
}

/** Sums density × area over the pixels inside the mask; zero both ways (open water, sea) counts as no data. */
export function sumCarbon(above: ArrayLike<number>, below: ArrayLike<number>, mask: ArrayLike<number>, pixelHa: number): CarbonSums {
  let a = 0, b = 0, n = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const va = above[i] ?? 0, vb = below[i] ?? 0;
    if (!va && !vb) continue;
    a += va * SCALE * pixelHa;
    b += vb * SCALE * pixelHa;
    n += 1;
  }
  const hectares = n * pixelHa;
  return { above: a, below: b, total: a + b, meanDensity: hectares ? (a + b) / hectares : 0, hectares };
}

export async function runCarbon(request: CarbonRequest, hooks: EngineHooks): Promise<CarbonSums & { areaHa: number }> {
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, GRID_RES, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  hooks.progress({ stage: "PROCESSING_IMAGERY", done: 0, total: 2, detail: "Reading the biomass carbon map" });
  const above = await readOntoGrid(`${BASE}/aboveground.tif`, COLLECTION, 4326, grid, true, hooks.signal);
  hooks.progress({ stage: "PROCESSING_IMAGERY", done: 1, total: 2, detail: "Reading the biomass carbon map" });
  const below = await readOntoGrid(`${BASE}/belowground.tif`, COLLECTION, 4326, grid, true, hooks.signal);
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  let inside = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) inside += 1;
  return { ...sumCarbon(above, below, mask, pixelHa), areaHa: inside * pixelHa };
}
