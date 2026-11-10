/**
 * Desktop-GIS basics for the chosen area, as in QGIS's vector menu: measure
 * its geometry, buffer it, and save it as a file other GIS software opens.
 */
import type { AoiGeometry } from "../app/types";
import { outerRings, projectAoi } from "../engine/geo";
import { pathKm } from "./measure";

export interface GeometryInfo {
  areaKm2: number;
  perimeterKm: number;
  /** Area-weighted centre of the outline, [lon, lat]. */
  centroid: [number, number];
  /** [west, south, east, north]. */
  bbox: [number, number, number, number];
  vertices: number;
}

export function geometryInfo(geometry: AoiGeometry): GeometryInfo {
  const rings = outerRings(geometry) as [number, number][][];
  let cx = 0, cy = 0, twiceArea = 0, vertices = 0;
  for (const ring of rings) {
    vertices += ring.length - 1;
    for (let i = 0; i < ring.length - 1; i += 1) {
      const [x0, y0] = ring[i]!, [x1, y1] = ring[i + 1]!;
      const cross = x0 * y1 - x1 * y0;
      twiceArea += cross;
      cx += (x0 + x1) * cross;
      cy += (y0 + y1) * cross;
    }
  }
  const all = rings.flat();
  const lons = all.map((p) => p[0]), lats = all.map((p) => p[1]);
  return {
    areaKm2: projectAoi(geometry).areaM2 / 1e6,
    perimeterKm: rings.reduce((sum, ring) => sum + pathKm(ring), 0),
    centroid: twiceArea ? [cx / (3 * twiceArea), cy / (3 * twiceArea)] : [lons[0] ?? 0, lats[0] ?? 0],
    bbox: [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)],
    vertices,
  };
}

/** Convex hull (Andrew's monotone chain), counter-clockwise, without the closing point. */
function hull(points: [number, number][]): [number, number][] {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]).filter((q, i, s) => !i || q[0] !== s[i - 1]![0] || q[1] !== s[i - 1]![1]);
  if (p.length < 3) return p;
  const cross = (o: [number, number], a: [number, number], b: [number, number]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (list: [number, number][]) => {
    const out: [number, number][] = [];
    for (const q of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, q) <= 0) out.pop();
      out.push(q);
    }
    return out.slice(0, -1);
  };
  return [...half(p), ...half([...p].reverse())];
}

/**
 * The area grown outward by `km` on every side, with rounded corners.
 * shortcut: buffers the area's convex hull, so the inlets of a concave shape
 * (a winding district) are filled in; a true concave buffer needs a polygon
 * union library, worth adding if buffers of districts start to matter.
 */
export function bufferGeometry(geometry: AoiGeometry, km: number): AoiGeometry {
  const all = (outerRings(geometry) as [number, number][][]).flat();
  const lat0 = all.reduce((s, p) => s + p[1], 0) / all.length;
  const kx = 111.32 * Math.max(Math.cos((lat0 * Math.PI) / 180), 0.05), ky = 110.574;
  const h = hull(all.map(([lon, lat]) => [lon * kx, lat * ky]));
  const ring: [number, number][] = [];
  const arc = (c: [number, number], from: number, to: number) => {
    const sweep = ((to - from) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) || 2 * Math.PI;
    const steps = Math.max(2, Math.ceil(sweep / (Math.PI / 18)));
    for (let s = 0; s <= steps; s += 1) {
      const a = from + (sweep * s) / steps;
      ring.push([(c[0] + km * Math.cos(a)) / kx, (c[1] + km * Math.sin(a)) / ky]);
    }
  };
  if (h.length === 1) arc(h[0]!, 0, 2 * Math.PI);
  else {
    // Outward normal of a counter-clockwise edge points to its right.
    const normal = (a: [number, number], b: [number, number]) => Math.atan2(-(b[0] - a[0]), b[1] - a[1]);
    h.forEach((v, i) => {
      const prev = h[(i + h.length - 1) % h.length]!, next = h[(i + 1) % h.length]!;
      arc(v, normal(prev, v), normal(v, next));
    });
  }
  ring.push(ring[0]!);
  return { type: "Polygon", coordinates: [ring] };
}

const round = (ring: number[][]) => ring.map(([x, y]) => [Number(x!.toFixed(6)), Number(y!.toFixed(6))]);

/** The area as a GeoJSON FeatureCollection (WGS 84), which QGIS, ArcGIS and Google Earth Engine open. */
export function toGeoJson(geometry: AoiGeometry, label: string): string {
  const info = geometryInfo(geometry);
  const rounded = geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates.map(round) }
    : { type: "MultiPolygon", coordinates: geometry.coordinates.map((poly) => poly.map(round)) };
  return JSON.stringify({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: { name: label, area_km2: Number(info.areaKm2.toFixed(3)), perimeter_km: Number(info.perimeterKm.toFixed(3)) }, geometry: rounded }],
  }, null, 1);
}

/** The area as KML, for Google Earth. */
export function toKml(geometry: AoiGeometry, label: string): string {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const polygons = (outerRings(geometry) as number[][][]).map((ring) =>
    `<Polygon><outerBoundaryIs><LinearRing><coordinates>${round(ring).map((p) => `${p[0]},${p[1]},0`).join(" ")}</coordinates></LinearRing></outerBoundaryIs></Polygon>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><name>${esc(label)}</name>`
    + `${polygons.length > 1 ? `<MultiGeometry>${polygons.join("")}</MultiGeometry>` : polygons[0]}</Placemark></Document></kml>\n`;
}
