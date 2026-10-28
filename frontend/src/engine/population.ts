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
import { projectAoi, transformer } from "./geo";

const URL = "https://data.source.coop/cboettig/population/raw/ghs-pop-2020-cog.tif";
/** Cells read at most; above this the next coarser overview is used. */
const MAX_CELLS = 1_000_000;

export interface PopulationRequest {
  aoi: AoiGeometry;
}
/**
 * People living where an analysis found change: population cells whose
 * centre falls on a raster cell that counts as affected (equal to `equals`,
 * or at most `atMost`), inside the area.
 */
export interface ExposureRequest {
  aoi: AoiGeometry;
  raster: { data: ArrayLike<number>; epsg: number; west: number; north: number; res: number; width: number; height: number };
  equals?: number;
  atMost?: number;
}
export interface ExposureResult {
  /** People on affected land, and in the whole area. */
  people: number;
  total: number;
  cellM: number;
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
 * Sum of the cells whose centre lies in the area (and, if given, where
 * `affected` says so), each standing for `factor`² full-detail cells. Cells
 * are given row by row from the window's north-west corner; negative or
 * non-finite values are no data.
 */
export function countInside(values: ArrayLike<number>, width: number, west: number, north: number, cell: number, factor: number, geometry: AoiGeometry, affected?: (lon: number, lat: number) => boolean): number {
  let sum = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i]!;
    if (!(v > 0)) continue;
    const lon = west + ((i % width) + 0.5) * cell;
    const lat = north - (Math.floor(i / width) + 0.5) * cell;
    if (contains(geometry, lon, lat) && (!affected || affected(lon, lat))) sum += v;
  }
  return sum * factor * factor;
}

/** A test for "this point lies on an affected cell of the raster", in longitude and latitude. */
export function affectedBy(raster: ExposureRequest["raster"], equals?: number, atMost?: number): (lon: number, lat: number) => boolean {
  const toGrid = transformer(4326, raster.epsg);
  return (lon, lat) => {
    const [x, y] = toGrid(lon, lat);
    const col = Math.floor((x - raster.west) / raster.res), row = Math.floor((raster.north - y) / raster.res);
    if (col < 0 || row < 0 || col >= raster.width || row >= raster.height) return false;
    const v = raster.data[row * raster.width + col]!;
    return equals !== undefined ? v === equals : atMost !== undefined && v <= atMost;
  };
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

/** The population cells over the area's bounds, at the finest level within budget. */
async function readWindow(geometry: AoiGeometry, hooks: EngineHooks) {
  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 1, detail: "Reading the population grid" });
  tiff ??= fromUrl(URL).catch((e: unknown) => { tiff = null; throw e; });
  const file = await tiff;
  const base = await file.getImage(0);
  const [x0, , , y1] = base.getBoundingBox() as [number, number, number, number];
  const res = base.getResolution()[0]!;
  const aoi = projectAoi(geometry);
  const [west, south, east, north] = aoi.lonLatBounds;
  const level = levelFor((east - west) / res, (north - south) / res, await file.getImageCount());
  const image = await file.getImage(level);
  const factor = base.getWidth() / image.getWidth();
  const cell = res * factor;
  const window = [Math.floor((west - x0) / cell), Math.floor((y1 - north) / cell), Math.ceil((east - x0) / cell), Math.ceil((y1 - south) / cell)];
  const [values] = (await image.readRasters({ window, signal: hooks.signal })) as unknown as [ArrayLike<number>];
  return { values, width: window[2]! - window[0]!, west: x0 + window[0]! * cell, north: y1 - window[1]! * cell, cell, factor, areaKm2: aoi.areaM2 / 1e6 };
}

export async function runPopulation(request: PopulationRequest, hooks: EngineHooks): Promise<PopulationResult> {
  const w = await readWindow(request.aoi, hooks);
  const people = countInside(w.values, w.width, w.west, w.north, w.cell, w.factor, request.aoi);
  return { people, areaKm2: w.areaKm2, cellM: Math.round(w.cell * 111_320) };
}

export async function runExposure(request: ExposureRequest, hooks: EngineHooks): Promise<ExposureResult> {
  const w = await readWindow(request.aoi, hooks);
  const count = (affected?: (lon: number, lat: number) => boolean) => countInside(w.values, w.width, w.west, w.north, w.cell, w.factor, request.aoi, affected);
  return { people: count(affectedBy(request.raster, request.equals, request.atMost)), total: count(), cellM: Math.round(w.cell * 111_320) };
}
