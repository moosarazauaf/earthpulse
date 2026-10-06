/** Turn an uploaded shapefile or GeoJSON file into an area of interest. */
import type { Feature, FeatureCollection, Geometry, Position } from "geojson";

import type { AoiGeometry } from "../app/types";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
/** Guards against files that would make every later step slow. */
const MAX_VERTICES = 20_000;
const MAX_PARTS = 200;

function collect(input: unknown, out: Position[][][]): void {
  if (!input || typeof input !== "object") return;
  if (Array.isArray(input)) {
    for (const item of input) collect(item, out); // shpjs returns an array for multi-layer archives
    return;
  }
  const object = input as { type?: string };
  if (object.type === "FeatureCollection") collect((input as FeatureCollection).features, out);
  else if (object.type === "Feature") collect((input as Feature).geometry, out);
  else if (object.type === "GeometryCollection") collect((input as { geometries: Geometry[] }).geometries, out);
  else if (object.type === "Polygon") out.push((input as { coordinates: Position[][] }).coordinates);
  else if (object.type === "MultiPolygon") out.push(...(input as { coordinates: Position[][][] }).coordinates);
}

/** Extract the polygons of any GeoJSON object as one validated area. */
export function areaFromGeoJson(input: unknown): AoiGeometry {
  const polygons: Position[][][] = [];
  collect(input, polygons);
  if (polygons.length === 0) throw new Error("The file has no polygons. An area of interest must be a polygon layer.");
  if (polygons.length > MAX_PARTS) throw new Error(`The file has ${polygons.length} polygons. Use a layer with at most ${MAX_PARTS}.`);
  let vertices = 0;
  for (const polygon of polygons) {
    for (const ring of polygon) {
      vertices += ring.length;
      for (const [lon, lat] of ring) {
        if (typeof lon !== "number" || typeof lat !== "number" || Math.abs(lon) > 180 || Math.abs(lat) > 90) {
          throw new Error("Coordinates are not longitude and latitude. A shapefile needs its .prj file so it can be converted; GeoJSON must be in EPSG:4326.");
        }
      }
    }
  }
  if (vertices > MAX_VERTICES) throw new Error("The outline is too detailed. Simplify it and upload again.");
  // Drop any Z values so every position is [lon, lat].
  const clean = polygons.map((polygon) => polygon.map((ring) => ring.map(([lon, lat]) => [lon as number, lat as number])));
  return clean.length === 1
    ? { type: "Polygon", coordinates: clean[0] as number[][][] }
    : { type: "MultiPolygon", coordinates: clean };
}

export async function readAreaFile(file: File): Promise<{ geometry: AoiGeometry; label: string }> {
  if (file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 10 MB. Upload only the boundary layer.");
  const label = file.name.replace(/\.[^.]+$/, "").slice(0, 60) || "Uploaded area";
  const name = file.name.toLowerCase();
  if (name.endsWith(".zip")) {
    const { default: shp } = await import("shpjs"); // loaded only when a shapefile is used
    let parsed: unknown;
    try {
      parsed = await shp(await file.arrayBuffer());
    } catch {
      throw new Error("The zip could not be read as a shapefile. It must contain .shp, .dbf and .prj files.");
    }
    return { geometry: areaFromGeoJson(parsed), label };
  }
  if (name.endsWith(".geojson") || name.endsWith(".json")) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("The file is not valid GeoJSON.");
    }
    return { geometry: areaFromGeoJson(parsed), label };
  }
  throw new Error("Upload a zipped shapefile (.zip) or a GeoJSON file (.geojson).");
}
