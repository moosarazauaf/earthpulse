/**
 * Carbon stored over an area, in plants and in the soil, each with its uncertainty.
 *
 * Plants: the Harmonized Global Biomass map (Spawn, Sullivan, Lark and Gibbs
 * 2020, Scientific Data; 300 m, year 2010) on Microsoft Planetary Computer:
 * above- and below-ground biomass carbon density and the uncertainty published
 * with each, all stored as whole numbers ten times t C/ha (Amazon forest reads
 * 1489, 148.9 t C/ha).
 *
 * Soil: SoilGrids 2.0 (ISRIC; Poggio et al. 2021, SOIL), organic carbon stock
 * in the top 30 cm in t C/ha at 250 m, with its 5% and 95% quantiles, cut out
 * for the area by ISRIC's coverage service.
 *
 * Area totals add the pixels' uncertainties directly, as if their errors all
 * leaned the same way: the cautious range. The range if they were independent
 * (square root of the sum of squares) is narrower and reported beside it.
 */
import { fromArrayBuffer } from "geotiff";

import type { AoiGeometry } from "../app/types";
import { type EngineHooks, M2_PER_HA } from "./common";
import { buildGrid, outerRings, projectAoi, rasterMask } from "./geo";
import { readOntoGrid } from "./raster";
import { insideRings } from "../area/elevation";

const COLLECTION = "hgb";
const BASE = "https://cpdataeuwest.blob.core.windows.net/cpdata/raw/2010-harmonized-biomass/global/300m";
const SCALE = 0.1;
/** Tonnes of CO2 per tonne of carbon (molar masses 44 and 12). */
export const CO2_PER_C = 44 / 12;
/** The map's pixels are 300 m; reading finer only repeats them. */
const MAP_RES = 300;
const GRID_RES = 100;
const SOILGRIDS = "https://maps.isric.org/mapserv?map=/map/ocs.map&SERVICE=WCS&VERSION=2.0.1&REQUEST=GetCoverage&FORMAT=image/tiff"
  + "&SUBSETTINGCRS=http://www.opengis.net/def/crs/EPSG/0/4326&OUTPUTCRS=http://www.opengis.net/def/crs/EPSG/0/4326";

export interface CarbonRequest { aoi: AoiGeometry; maxPixels: number }

export interface BiomassSums {
  /** Tonnes of carbon above and below ground, and their total. */
  above: number;
  below: number;
  total: number;
  /** Uncertainty of the total in tonnes: pixel errors added directly (cautious) or as independent. */
  uncertainty: number;
  uncertaintyIndependent: number;
  /** Mean total carbon density, t C/ha, over the mapped hectares. */
  meanDensity: number;
  hectares: number;
}

export interface SoilSums {
  /** Tonnes of soil organic carbon in the top 30 cm: mean estimate and the 5% to 95% range. */
  total: number;
  low: number;
  high: number;
  meanDensity: number;
  hectares: number;
}

/** Sums density × area inside the mask; zero both ways (open water, sea) counts as no data. */
export function sumCarbon(
  above: ArrayLike<number>, below: ArrayLike<number>, mask: ArrayLike<number>, pixelHa: number,
  aboveU: ArrayLike<number> = [], belowU: ArrayLike<number> = [],
  /** Grid pixels per map pixel: a 300 m pixel read onto a 100 m grid appears 9 times, and its copies share one error. */
  copies = 1,
): BiomassSums {
  let a = 0, b = 0, n = 0, u = 0, u2 = 0;
  for (let i = 0; i < mask.length; i += 1) {
    if (!mask[i]) continue;
    const va = above[i] ?? 0, vb = below[i] ?? 0;
    if (!va && !vb) continue;
    a += va * SCALE * pixelHa;
    b += vb * SCALE * pixelHa;
    // Above and below ground come from linked models, so within a pixel their errors are added.
    const up = ((aboveU[i] ?? 0) + (belowU[i] ?? 0)) * SCALE * pixelHa;
    u += up;
    u2 += up * up;
    n += 1;
  }
  const hectares = n * pixelHa;
  // Each map pixel's error is its copies' errors added (copies × u), so the independent sum is sqrt(copies × Σu²).
  return { above: a, below: b, total: a + b, uncertainty: u, uncertaintyIndependent: Math.sqrt(copies * u2), meanDensity: hectares ? (a + b) / hectares : 0, hectares };
}

/** Soil carbon over the pixels that are inside the area; `pixelHa` gives each pixel's area (it shrinks towards the poles). */
export function sumSoil(mean: ArrayLike<number>, q05: ArrayLike<number>, q95: ArrayLike<number>, inside: ArrayLike<number>, pixelHa: ArrayLike<number>): SoilSums {
  let t = 0, lo = 0, hi = 0, ha = 0;
  for (let i = 0; i < inside.length; i += 1) {
    const m = mean[i] ?? 0;
    if (!inside[i] || !m) continue;
    const area = pixelHa[i] ?? 0;
    t += m * area;
    lo += (q05[i] ?? 0) * area;
    hi += (q95[i] ?? 0) * area;
    ha += area;
  }
  return { total: t, low: lo, high: hi, meanDensity: ha ? t / ha : 0, hectares: ha };
}


async function soilGrid(coverage: string, bounds: number[], signal?: AbortSignal) {
  const [w, s, e, n] = bounds;
  const url = `${SOILGRIDS}&COVERAGEID=${coverage}&SUBSET=long(${w!.toFixed(5)},${e!.toFixed(5)})&SUBSET=lat(${s!.toFixed(5)},${n!.toFixed(5)})`;
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The SoilGrids service did not respond.");
  const image = await (await fromArrayBuffer(await response.arrayBuffer())).getImage();
  const [band] = (await image.readRasters()) as unknown as ArrayLike<number>[];
  const [x0, y0] = image.getOrigin() as [number, number];
  const [dx, dy] = image.getResolution() as [number, number];
  return { values: band!, width: image.getWidth(), height: image.getHeight(), x0, y0, dx, dy };
}

/** Soil organic carbon, 0 to 30 cm, read from SoilGrids for the area's bounding box and summed inside it. */
export async function soilCarbon(aoi: AoiGeometry, signal?: AbortSignal): Promise<SoilSums> {
  const rings = outerRings(aoi);
  const all = rings.flat();
  const bounds = [Math.min(...all.map((p) => p[0]!)), Math.min(...all.map((p) => p[1]!)), Math.max(...all.map((p) => p[0]!)), Math.max(...all.map((p) => p[1]!))];
  const [mean, q05, q95] = await Promise.all(["ocs_0-30cm_mean", "ocs_0-30cm_Q0.05", "ocs_0-30cm_Q0.95"].map((c) => soilGrid(c, bounds, signal)));
  const g = mean!;
  const inside = new Uint8Array(g.width * g.height);
  const pixelHa = new Float64Array(g.width * g.height);
  for (let row = 0; row < g.height; row += 1) {
    const lat = g.y0 + (row + 0.5) * g.dy;
    const ha = (Math.abs(g.dx) * 111_320 * Math.cos((lat * Math.PI) / 180) * Math.abs(g.dy) * 110_574) / M2_PER_HA;
    for (let col = 0; col < g.width; col += 1) {
      const i = row * g.width + col;
      inside[i] = insideRings(g.x0 + (col + 0.5) * g.dx, lat, rings) ? 1 : 0;
      pixelHa[i] = ha;
    }
  }
  return sumSoil(g.values, q05!.values, q95!.values, inside, pixelHa);
}

export async function runCarbon(request: CarbonRequest, hooks: EngineHooks): Promise<{ biomass: BiomassSums; soil: SoilSums | null; soilError: string | null; areaHa: number }> {
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, GRID_RES, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  // Soil comes from another service; it is read alongside, and its failure does not stop the plant total.
  const soil = soilCarbon(request.aoi, hooks.signal).then((s) => ({ s, e: null }), (e: unknown) => ({ s: null, e: e instanceof Error ? e.message : "SoilGrids could not be read." }));
  const layers = ["aboveground", "belowground", "aboveground_uncertainty", "belowground_uncertainty"];
  const read: ArrayLike<number>[] = [];
  for (const [k, name] of layers.entries()) {
    hooks.progress({ stage: "PROCESSING_IMAGERY", done: k, total: layers.length, detail: "Reading the biomass carbon map" });
    read.push(await readOntoGrid(`${BASE}/${name}.tif`, COLLECTION, 4326, grid, true, hooks.signal));
  }
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  let inside = 0;
  for (let i = 0; i < mask.length; i += 1) if (mask[i]) inside += 1;
  const { s, e } = await soil;
  const copies = Math.max(1, (MAP_RES / grid.res) ** 2);
  return { biomass: sumCarbon(read[0]!, read[1]!, mask, pixelHa, read[2], read[3], copies), soil: s, soilError: e, areaHa: inside * pixelHa };
}
