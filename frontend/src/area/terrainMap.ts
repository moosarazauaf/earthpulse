/**
 * Terrain maps of an area from the height mosaic, as in QGIS's raster terrain
 * analysis: hillshade (relief lit from the north-west), slope in degrees, and
 * aspect (the compass direction each slope faces).
 */
import type { AoiGeometry, ClassLegend, Legend, Overlay } from "../app/types";
import { type HeightGrid, fetchHeights, insideRings, rowResolution, tileYToLat } from "./elevation";

export type TerrainKind = "hillshade" | "slope" | "aspect";
export const TERRAIN_KINDS: { id: TerrainKind; label: string }[] = [
  { id: "hillshade", label: "Hillshade" }, { id: "slope", label: "Slope" }, { id: "aspect", label: "Aspect" },
];

const TILE = 256;
/** Sun from the north-west, 45° up: the cartographic convention, which makes relief read as raised. */
const LIGHT = [-Math.SQRT1_2 * Math.SQRT1_2, Math.SQRT1_2 * Math.SQRT1_2, Math.SQRT1_2];
const SLOPE_RAMP: [number, number, number][] = [[255, 255, 212], [254, 217, 142], [254, 153, 41], [217, 95, 14], [153, 52, 4]];
const SLOPE_MAX = 40;
export const ASPECTS: { label: string; colour: [number, number, number] }[] = [
  { label: "North", colour: [77, 109, 243] }, { label: "North-east", colour: [86, 180, 233] }, { label: "East", colour: [0, 158, 115] }, { label: "South-east", colour: [171, 214, 80] },
  { label: "South", colour: [240, 228, 66] }, { label: "South-west", colour: [230, 159, 0] }, { label: "West", colour: [213, 94, 0] }, { label: "North-west", colour: [204, 121, 167] },
];
const FLAT: [number, number, number] = [150, 150, 150];
/** Below this slope the ground has no meaningful facing direction. */
const FLAT_BELOW = 2;

/** Slope (degrees), aspect (degrees clockwise from north, the way the ground faces downhill) and hillshade (0 to 1) of one pixel. */
export function relief(dzdxEast: number, dzdyNorth: number): { slope: number; aspect: number; shade: number } {
  const norm = Math.hypot(dzdxEast, dzdyNorth, 1);
  const shade = Math.max(0, (-dzdxEast * LIGHT[0]! - dzdyNorth * LIGHT[1]! + LIGHT[2]!) / norm);
  const aspect = ((Math.atan2(-dzdxEast, -dzdyNorth) * 180) / Math.PI + 360) % 360;
  return { slope: (Math.atan(Math.hypot(dzdxEast, dzdyNorth)) * 180) / Math.PI, aspect, shade };
}

const ramp = (t: number): [number, number, number] => {
  const f = Math.min(0.9999, Math.max(0, t)) * (SLOPE_RAMP.length - 1), i = Math.floor(f), u = f - i;
  const a = SLOPE_RAMP[i]!, b = SLOPE_RAMP[i + 1]!;
  return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
};

/** RGBA pixels of the map, transparent outside the area. */
export function terrainPixels(kind: TerrainKind, g: HeightGrid): Uint8ClampedArray {
  const out = new Uint8ClampedArray(g.width * g.height * 4);
  for (let row = 1; row < g.height - 1; row += 1) {
    const lat = tileYToLat(g.y0 + (row + 0.5) / TILE, g.z);
    const res = rowResolution(g, row);
    for (let col = 1; col < g.width - 1; col += 1) {
      const lon = ((g.x0 + (col + 0.5) / TILE) / 2 ** g.z) * 360 - 180;
      if (!insideRings(lon, lat, g.rings)) continue;
      const i = row * g.width + col;
      const dzdx = (g.heights[i + 1]! - g.heights[i - 1]!) / (2 * res);
      // Rows run north to south, so the row above is the northern neighbour.
      const dzdy = (g.heights[i - g.width]! - g.heights[i + g.width]!) / (2 * res);
      const r = relief(dzdx, dzdy);
      const [red, green, blue] = kind === "hillshade" ? [r.shade * 255, r.shade * 255, r.shade * 255]
        : kind === "slope" ? ramp(r.slope / SLOPE_MAX)
        : r.slope < FLAT_BELOW ? FLAT : ASPECTS[Math.round(r.aspect / 45) % 8]!.colour;
      out.set([red, green, blue, 255], i * 4);
    }
  }
  return out;
}

const hex = (c: number[]) => `#${c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function terrainLegend(kind: TerrainKind): Legend | ClassLegend {
  if (kind === "hillshade") return { min: 0, max: 1, colors: ["#000000", "#ffffff"], unit: "shade to light (sun from the north-west)" };
  if (kind === "slope") return { min: 0, max: SLOPE_MAX, colors: SLOPE_RAMP.map(hex), unit: "degrees" };
  return { classes: [...ASPECTS.map((a) => ({ label: a.label, color: hex(a.colour) })), { label: `Flat (under ${FLAT_BELOW}°)`, color: hex(FLAT) }] };
}

/** The map as an overlay the globe can show over the area. */
export async function terrainOverlay(kind: TerrainKind, aoi: AoiGeometry, signal?: AbortSignal): Promise<Overlay> {
  const g = await fetchHeights(aoi, signal);
  const canvas = Object.assign(document.createElement("canvas"), { width: g.width, height: g.height });
  canvas.getContext("2d")!.putImageData(new ImageData(terrainPixels(kind, g) as Uint8ClampedArray<ArrayBuffer>, g.width, g.height), 0, 0);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
  if (!blob) throw new Error("The terrain map could not be drawn.");
  const lon = (x: number) => (x / 2 ** g.z) * 360 - 180;
  return {
    title: `${TERRAIN_KINDS.find((k) => k.id === kind)!.label} (AWS Terrain Tiles, about ${Math.round(rowResolution(g, g.height / 2))} m)`,
    url: URL.createObjectURL(blob),
    geotiff: "",
    // The mosaic is in web-mercator rows; over an area this size, placing it by its corners is within a pixel or two.
    bounds: [lon(g.x0), tileYToLat(g.y0 + g.height / TILE, g.z), lon(g.x0 + g.width / TILE), tileYToLat(g.y0, g.z)],
    legend: terrainLegend(kind),
  };
}
