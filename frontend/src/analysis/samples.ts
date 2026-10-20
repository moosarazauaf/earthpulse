/**
 * Training samples for land-cover classification: points or polygons from a
 * GeoJSON file or zipped shapefile, each with a class in one attribute.
 */
import type { Feature, FeatureCollection } from "geojson";

const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FEATURES = 5000;
export const MAX_CLASSES = 12;

export interface Sample {
  /** Index of the feature in the file: samples from one feature stay on one side of the train/test split. */
  feature: number;
  className: string;
  geometry: { type: "Point"; coordinates: [number, number] } | { type: "Polygon"; coordinates: number[][][] } | { type: "MultiPolygon"; coordinates: number[][][][] };
}

export interface SampleFile {
  name: string;
  features: Feature[];
  /** Attributes that could hold a class: 2 to MAX_CLASSES distinct values. */
  fields: string[];
}

function flatten(input: unknown): Feature[] {
  if (Array.isArray(input)) return input.flatMap(flatten);
  const o = input as { type?: string } | null;
  if (o?.type === "FeatureCollection") return (input as FeatureCollection).features;
  if (o?.type === "Feature") return [input as Feature];
  return [];
}

function lonLatOk(p: unknown): boolean {
  return Array.isArray(p) && typeof p[0] === "number" && typeof p[1] === "number" && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90;
}

/** Fields whose values could be classes: at least two and at most MAX_CLASSES distinct non-empty values. */
export function classFields(features: Feature[]): string[] {
  const keys = new Set(features.flatMap((f) => Object.keys(f.properties ?? {})));
  return [...keys].filter((key) => {
    const values = new Set(features.map((f) => f.properties?.[key]).filter((v) => v !== null && v !== undefined && v !== "").map(String));
    return values.size >= 2 && values.size <= MAX_CLASSES;
  });
}

export function parseSamples(input: unknown, name: string): SampleFile {
  const features = flatten(input).filter((f) => f.geometry && ["Point", "Polygon", "MultiPolygon", "MultiPoint"].includes(f.geometry.type));
  if (features.length === 0) throw new Error("The file has no points or polygons.");
  if (features.length > MAX_FEATURES) throw new Error(`The file has ${features.length} features; use at most ${MAX_FEATURES}.`);
  const first = features[0]!.geometry as { coordinates: unknown };
  const sample = (first.coordinates as unknown[]).flat(3).slice(0, 2);
  if (!lonLatOk(sample)) throw new Error("Coordinates are not longitude and latitude. A shapefile needs its .prj; GeoJSON must be in EPSG:4326.");
  const fields = classFields(features);
  if (fields.length === 0) throw new Error(`No attribute has between 2 and ${MAX_CLASSES} classes. Each feature needs a class name or code in one attribute.`);
  return { name, features, fields };
}

/** The samples for one class field; features without a class are left out. */
export function samplesFor(file: SampleFile, field: string): Sample[] {
  const out: Sample[] = [];
  file.features.forEach((f, i) => {
    const value = f.properties?.[field];
    if (value === null || value === undefined || value === "") return;
    const g = f.geometry;
    if (g.type === "Point" && lonLatOk(g.coordinates)) out.push({ feature: i, className: String(value), geometry: { type: "Point", coordinates: [g.coordinates[0]!, g.coordinates[1]!] } });
    else if (g.type === "MultiPoint") for (const p of g.coordinates) { if (lonLatOk(p)) out.push({ feature: i, className: String(value), geometry: { type: "Point", coordinates: [p[0]!, p[1]!] } }); }
    else if (g.type === "Polygon") out.push({ feature: i, className: String(value), geometry: { type: "Polygon", coordinates: g.coordinates.map((r) => r.map((p) => [p[0]!, p[1]!])) } });
    else if (g.type === "MultiPolygon") out.push({ feature: i, className: String(value), geometry: { type: "MultiPolygon", coordinates: g.coordinates.map((poly) => poly.map((r) => r.map((p) => [p[0]!, p[1]!]))) } });
  });
  return out;
}

export async function readSampleFile(file: File): Promise<SampleFile> {
  if (file.size > MAX_FILE_BYTES) throw new Error("The file is larger than 10 MB.");
  const lower = file.name.toLowerCase();
  let parsed: unknown;
  if (lower.endsWith(".zip")) {
    const { default: shp } = await import("shpjs");
    try {
      parsed = await shp(await file.arrayBuffer());
    } catch {
      throw new Error("The zip could not be read as a shapefile. It must contain .shp, .dbf and .prj files.");
    }
  } else if (lower.endsWith(".geojson") || lower.endsWith(".json")) {
    try {
      parsed = JSON.parse(await file.text());
    } catch {
      throw new Error("The file is not valid GeoJSON.");
    }
  } else {
    throw new Error("Upload a zipped shapefile (.zip) or a GeoJSON file (.geojson).");
  }
  return parseSamples(parsed, file.name);
}
