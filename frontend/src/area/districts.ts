/**
 * The district (second-level administrative unit) at a point, from FAO GAUL
 * 2024 (CC BY 4.0), simplified to about 500 m and served with the site
 * (built by scripts/make-districts.py). A district is found by where a place
 * is, not by how its name is spelt, so "Layyah" finds GAUL's "Leiah".
 */
import type { AoiGeometry } from "../app/types";
import { insideRings } from "./elevation";

export interface District {
  name: string;
  admin1: string;
  country: string;
  code: number;
  geometry: AoiGeometry;
}
type Bounds = [west: number, south: number, east: number, north: number, country?: string];
type DistrictFile = { features: { properties: Omit<District, "geometry">; geometry: AoiGeometry }[] };

const BASE = `${import.meta.env.BASE_URL}data/districts/`;
const files = new Map<string, Promise<DistrictFile>>();
let index: Promise<Record<string, Bounds>> | null = null;

/**
 * The country files whose bounding box holds the point (disputed areas have
 * files of their own), the one named like `country` first and then the
 * smallest, so the right file is usually the only one downloaded.
 */
export function filesCovering(bounds: Record<string, Bounds>, lon: number, lat: number, country = ""): string[] {
  const hint = country.toLowerCase();
  const named = (c?: string) => !!hint && !!c && (c.toLowerCase().startsWith(hint) || hint.startsWith(c.toLowerCase()));
  const area = ([w, s, e, n]: Bounds) => (e - w) * (n - s);
  return Object.entries(bounds)
    .filter(([, [w, s, e, n]]) => lon >= w && lon <= e && lat >= s && lat <= n)
    .sort(([, a], [, b]) => Number(named(b[4])) - Number(named(a[4])) || area(a) - area(b))
    .map(([code]) => code);
}

export function contains(geometry: AoiGeometry, lon: number, lat: number): boolean {
  return geometry.type === "Polygon"
    ? insideRings(lon, lat, geometry.coordinates)
    : geometry.coordinates.some((polygon) => insideRings(lon, lat, polygon));
}

function load<T>(cache: Map<string, Promise<T>>, name: string): Promise<T> {
  let hit = cache.get(name);
  if (!hit) {
    hit = fetch(`${BASE}${name}.json`).then((r) => {
      if (!r.ok) throw new Error("District boundaries could not be loaded.");
      return r.json() as Promise<T>;
    });
    hit.catch(() => cache.delete(name));
    cache.set(name, hit);
  }
  return hit;
}

/** The GAUL district containing the point, or null over the sea or where GAUL has none. */
export async function districtAt(lon: number, lat: number, country?: string): Promise<District | null> {
  index ??= fetch(`${BASE}index.json`).then((r) => r.json() as Promise<Record<string, Bounds>>).catch((e: unknown) => {
    index = null;
    throw e;
  });
  for (const code of filesCovering(await index, lon, lat, country)) {
    const file = await load(files, code);
    const hit = file.features.find((f) => contains(f.geometry, lon, lat));
    if (hit) return { ...hit.properties, geometry: hit.geometry };
  }
  return null;
}
