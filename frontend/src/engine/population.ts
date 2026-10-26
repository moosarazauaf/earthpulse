/**
 * People living in an area, from GHS-POP 2020 (European Commission JRC,
 * CC BY 4.0): residential population per cell on a 3-arc-second grid (about
 * 90 m), read from a public Cloud Optimized GeoTIFF on Source Cooperative
 * (cboettig/population). Its overviews are averages, so a coarser level
 * multiplied by the cells it stands for keeps the total; large areas are read
 * at the coarsest level that still has detail.
 */
import { fromUrl, type GeoTIFF } from "geotiff";

import type { AoiGeometry } from "../app/types";
import { contains } from "../area/districts";
import type { EngineHooks } from "./common";
import { projectAoi } from "./geo";

const URL = "https://data.source.coop/cboettig/population/raw/ghs-pop-2020-cog.tif";
/** Cells read at most; above this the next coarser overview is used. */
const MAX_CELLS = 1_000_000;

export interface PopulationRequest {
  aoi: AoiGeometry;
}
export interface PopulationResult {
  people: number;
  areaKm2: number;
  /** Size of the cells actually counted, metres at the equator. */
  cellM: number;
}

/** The overview level (0 is full detail) at which a window of this many cells fits the budget. */
export function levelFor(widthCells: number, heightCells: number, levels: number, max = MAX_CELLS): number {
  let level = 0;
  while (level < levels - 1 && (widthCells / 2 ** level) * (heightCells / 2 ** level) > max) level += 1;
  return level;
}

/**
 * Sum of the cells whose centre lies in the area, each standing for `factor`²
 * full-detail cells. Cells are given row by row from the window's north-west
 * corner; negative or non-finite values are no data.
 */
export function countInside(values: ArrayLike<number>, width: number, west: number, north: number, cell: number, factor: number, geometry: AoiGeometry): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (!(v > 0)) continue;
    const lon = west + ((i % width) + 0.5) * cell;
    const lat = north - (Math.floor(i / width) + 0.5) * cell;
    if (contains(geometry, lon, lat)) sum += v;
  }
  return sum * factor * factor;
}

/** "About 8.59 million": three significant figures, since the grid is a model, not a census. */
export function formatPeople(n: number): string {
  if (n < 1) return "almost no one";
  const three = new Intl.NumberFormat("en", { maximumSignificantDigits: 3 });
  if (n >= 1e9) return `about ${three.format(n / 1e9)} billion people`;
  if (n >= 1e6) return `about ${three.format(n / 1e6)} million people`;
  return `about ${three.format(n)} people`;
}

let tiff: Promise<GeoTIFF> | null = null;

export async function runPopulation(request: PopulationRequest, hooks: EngineHooks): Promise<PopulationResult> {
  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 1, detail: "Reading the population grid" });
  tiff ??= fromUrl(URL).catch((e: unknown) => { tiff = null; throw e; });
  const file = await tiff;
  const base = await file.getImage(0);
  const [x0, , , y1] = base.getBoundingBox() as [number, number, number, number];
  const res = base.getResolution()[0]!;
  const aoi = projectAoi(request.aoi);
  const [west, south, east, north] = aoi.lonLatBounds;
  const level = levelFor((east - west) / res, (north - south) / res, await file.getImageCount());
  const image = await file.getImage(level);
  const factor = base.getWidth() / image.getWidth();
  const cell = res * factor;
  const window = [Math.floor((west - x0) / cell), Math.floor((y1 - north) / cell), Math.ceil((east - x0) / cell), Math.ceil((y1 - south) / cell)];
  const [values] = (await image.readRasters({ window, signal: hooks.signal })) as unknown as [ArrayLike<number>];
  const people = countInside(values, window[2]! - window[0]!, x0 + window[0]! * cell, y1 - window[1]! * cell, cell, factor, request.aoi);
  return { people, areaKm2: aoi.areaM2 / 1e6, cellM: Math.round(cell * 111_320) };
}
