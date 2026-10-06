/**
 * Grids, projections and masks for analyses that run in the browser.
 *
 * Same rules as the Python engine: raster work happens on a north-up grid in
 * the UTM zone of the area, at a whole multiple of the sensor's pixel size,
 * and areas are never measured in degrees.
 */
import proj4 from "proj4";

import type { AoiGeometry } from "../app/types";

export interface Grid {
  epsg: number;
  /** Pixel size in metres. */
  res: number;
  /** Easting of the west edge and northing of the north edge. */
  west: number;
  north: number;
  width: number;
  height: number;
}

export type LonLat = [number, number];

/** EPSG code of the WGS84 UTM zone containing a point. */
export function utmEpsg(lon: number, lat: number): number {
  const zone = Math.min(Math.floor((lon + 180) / 6) + 1, 60);
  return (lat >= 0 ? 32600 : 32700) + zone;
}

/** proj4 definition for a WGS84 UTM EPSG code or for EPSG:4326. */
export function projDef(epsg: number): string {
  if (epsg === 4326) return "+proj=longlat +datum=WGS84 +no_defs";
  const south = epsg >= 32700;
  const zone = epsg - (south ? 32700 : 32600);
  if (zone < 1 || zone > 60) throw new Error(`Unsupported coordinate system EPSG:${epsg}`);
  return `+proj=utm +zone=${zone}${south ? " +south" : ""} +datum=WGS84 +units=m +no_defs`;
}

export function transformer(fromEpsg: number, toEpsg: number): (x: number, y: number) => [number, number] {
  if (fromEpsg === toEpsg) return (x, y) => [x, y];
  const converter = proj4(projDef(fromEpsg), projDef(toEpsg));
  return (x, y) => converter.forward([x, y]) as [number, number];
}

export function outerRings(geometry: AoiGeometry): LonLat[][] {
  const polygons = geometry.type === "Polygon" ? [geometry.coordinates] : geometry.coordinates;
  return polygons.map((polygon) => (polygon[0] ?? []).map((c) => [c[0] ?? 0, c[1] ?? 0] as LonLat));
}

export function bounds(rings: [number, number][][]): [number, number, number, number] {
  let west = Infinity, south = Infinity, east = -Infinity, north = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      west = Math.min(west, x);
      east = Math.max(east, x);
      south = Math.min(south, y);
      north = Math.max(north, y);
    }
  }
  return [west, south, east, north];
}

/** Planar (shoelace) area of rings. In UTM this is within about 0.1% of the ellipsoidal area. */
export function ringsArea(rings: [number, number][][]): number {
  let total = 0;
  for (const ring of rings) {
    let twice = 0;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x1, y1] = ring[i] as [number, number];
      const [x2, y2] = ring[i + 1] as [number, number];
      twice += x1 * y2 - x2 * y1;
    }
    total += Math.abs(twice) / 2;
  }
  return total;
}

export interface ProjectedAoi {
  epsg: number;
  rings: [number, number][][];
  /** Area in square metres, measured in UTM. */
  areaM2: number;
  /** west, south, east, north in degrees. */
  lonLatBounds: [number, number, number, number];
}

export function projectAoi(geometry: AoiGeometry): ProjectedAoi {
  const lonLat = outerRings(geometry);
  const box = bounds(lonLat);
  const epsg = utmEpsg((box[0] + box[2]) / 2, (box[1] + box[3]) / 2);
  const forward = transformer(4326, epsg);
  const rings = lonLat.map((ring) => ring.map(([lon, lat]) => forward(lon, lat)));
  return { epsg, rings, areaM2: ringsArea(rings), lonLatBounds: box };
}

/** Smallest grid covering the rings, coarsened in whole multiples of the native pixel to fit the budget. */
export function buildGrid(aoi: ProjectedAoi, nativeRes: number, maxPixels: number): Grid {
  const [minX, minY, maxX, maxY] = bounds(aoi.rings);
  for (let factor = 1; ; factor += 1) {
    const res = nativeRes * factor;
    const west = Math.floor(minX / res) * res;
    const north = Math.ceil(maxY / res) * res;
    const width = Math.max(1, Math.ceil((maxX - west) / res));
    const height = Math.max(1, Math.ceil((north - minY) / res));
    if (width * height <= maxPixels) return { epsg: aoi.epsg, res, west, north, width, height };
  }
}

/**
 * Rasterise the rings onto the grid: 1 where the pixel centre is inside.
 * Even-odd scanline fill, so holes between overlapping rings behave as in GeoJSON.
 */
export function rasterMask(rings: [number, number][][], grid: Grid): Uint8Array {
  const mask = new Uint8Array(grid.width * grid.height);
  for (let row = 0; row < grid.height; row += 1) {
    const y = grid.north - (row + 0.5) * grid.res;
    const crossings: number[] = [];
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [x1, y1] = ring[i] as [number, number];
        const [x2, y2] = ring[i + 1] as [number, number];
        if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
          crossings.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
        }
      }
    }
    crossings.sort((a, b) => a - b);
    for (let k = 0; k + 1 < crossings.length; k += 2) {
      // Pixel centres strictly between the two crossings are inside.
      const first = Math.max(0, Math.ceil(((crossings[k] as number) - grid.west) / grid.res - 0.5));
      const last = Math.min(grid.width - 1, Math.floor(((crossings[k + 1] as number) - grid.west) / grid.res - 0.5));
      for (let col = first; col <= last; col += 1) mask[row * grid.width + col] = 1;
    }
  }
  return mask;
}

/** Extent of the grid as west, south, east, north in its own CRS. */
export function gridBounds(grid: Grid): [number, number, number, number] {
  return [grid.west, grid.north - grid.height * grid.res, grid.west + grid.width * grid.res, grid.north];
}

/** Bounding box of the grid in another CRS, from a densified outline. */
export function gridBoundsIn(grid: Grid, epsg: number, steps = 16): [number, number, number, number] {
  const [west, south, east, north] = gridBounds(grid);
  const forward = transformer(grid.epsg, epsg);
  const outline: [number, number][] = [];
  for (let i = 0; i <= steps; i += 1) {
    const x = west + ((east - west) * i) / steps;
    const y = south + ((north - south) * i) / steps;
    outline.push(forward(x, south), forward(x, north), forward(west, y), forward(east, y));
  }
  return bounds([outline]);
}
