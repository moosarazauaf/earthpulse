/**
 * UrbanEye: where built-up land grew, and what it replaced.
 *
 * Uses the Impact Observatory annual land-cover maps (10 m, 2017 onwards,
 * derived from Sentinel-2 by a deep-learning classifier). EarthPulse does not
 * classify anything here: it reads the published maps and counts. The result
 * is therefore MODELED, and inherits the classifier's errors.
 */
import type { AoiGeometry } from "../app/types";
import { type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, classImage, hex, makeOverlay, pooled } from "./common";
import { buildGrid, projectAoi, rasterMask } from "./geo";
import { readOntoGrid } from "./raster";
import { linearTrend } from "./water";

const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const COLLECTION = "io-lulc-annual-v02";
const NATIVE_RES = 10;
export const FIRST_YEAR = 2017;
export const LAST_YEAR = 2023;

/** Class codes of the 9-class map (Impact Observatory LULC v2 documentation). */
export const CLASSES: Record<number, { name: string; colour: Rgb }> = {
  1: { name: "Water", colour: [65, 155, 223] },
  2: { name: "Trees", colour: [57, 125, 73] },
  4: { name: "Flooded vegetation", colour: [122, 135, 198] },
  5: { name: "Crops", colour: [228, 150, 53] },
  7: { name: "Built area", colour: [196, 40, 27] },
  8: { name: "Bare ground", colour: [165, 155, 143] },
  9: { name: "Snow or ice", colour: [168, 235, 255] },
  10: { name: "Clouds", colour: [97, 97, 97] },
  11: { name: "Rangeland", colour: [227, 226, 195] },
};
export const BUILT = 7;
const NEW_BUILT_RGB: Rgb = [255, 90, 60];
const OLD_BUILT_RGB: Rgb = [120, 40, 40];

export interface UrbanRequest {
  aoi: AoiGeometry;
  label: string;
  firstYear: number;
  lastYear: number;
  maxPixels: number;
  concurrency: number;
}

/** Area of each class in each map, in hectares, counted inside the mask. */
export function classAreas(map: Uint8Array, mask: Uint8Array, pixelHa: number): Record<number, number> {
  const counts: Record<number, number> = {};
  for (let i = 0; i < map.length; i += 1) {
    if (!mask[i] || !map[i]) continue;
    const c = map[i] as number;
    counts[c] = (counts[c] ?? 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).map(([c, n]) => [c, n * pixelHa]));
}

/** What the land that is built-up in the last map was in the first map. */
export function conversions(first: Uint8Array, last: Uint8Array, mask: Uint8Array, pixelHa: number): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < first.length; i += 1) {
    if (!mask[i] || last[i] !== BUILT) continue;
    const before = first[i] as number;
    if (!before || before === BUILT) continue;
    out[before] = (out[before] ?? 0) + pixelHa;
  }
  return out;
}

export async function runUrban(request: UrbanRequest, hooks: EngineHooks) {
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, NATIVE_RES, request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const pixelHa = grid.res ** 2 / M2_PER_HA;

  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 1, detail: "Finding the land-cover maps" });
  const response = await fetch(STAC_SEARCH, {
    method: "POST", signal: hooks.signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ collections: [COLLECTION], bbox: aoi.lonLatBounds, limit: 100 }),
  });
  if (!response.ok) throw new Error("The land-cover catalogue is temporarily unavailable.");
  const features = ((await response.json()) as { features: { properties: Record<string, unknown>; assets: Record<string, { href: string }> }[] }).features;
  const tiles = features
    .map((f) => ({
      year: Number(String(f.properties.start_datetime ?? "").slice(0, 4)),
      epsg: Number(f.properties["proj:epsg"]),
      href: f.assets.data?.href ?? "",
    }))
    .filter((t) => t.href && t.year >= request.firstYear && t.year <= request.lastYear);
  const years = [...new Set(tiles.map((t) => t.year))].sort();
  if (years.length < 2) throw new Error("Fewer than two years of land-cover maps cover this area.");

  let done = 0;
  const raw = await pooled(tiles, request.concurrency, async (tile) => {
    const data = (await readOntoGrid(tile.href, COLLECTION, tile.epsg, grid, true, hooks.signal)) as Uint8Array;
    done += 1;
    hooks.progress({ stage: "PROCESSING_IMAGERY", done, total: tiles.length, detail: `Reading land-cover maps: ${done} of ${tiles.length}` });
    return { year: tile.year, data };
  });
  // Several tiles can cover one year near zone edges; fill gaps from each in turn.
  const maps = years.map((year) => {
    const map = new Uint8Array(grid.width * grid.height);
    for (const part of raw.filter((r) => r.year === year)) {
      for (let i = 0; i < map.length; i += 1) if (!map[i]) map[i] = part.data[i] as number;
    }
    return { year, map };
  });

  hooks.progress({ stage: "DETECTING_CHANGE", done: tiles.length, total: tiles.length, detail: "Comparing the years" });
  const series = maps.map(({ year, map }) => {
    const areas = classAreas(map, mask, pixelHa);
    return { year, builtHa: areas[BUILT] ?? 0, classes: areas, cloudHa: areas[10] ?? 0 };
  });
  const first = maps[0] as { year: number; map: Uint8Array };
  const last = maps[maps.length - 1] as { year: number; map: Uint8Array };
  const replaced = conversions(first.map, last.map, mask, pixelHa);
  let lostBuilt = 0;
  for (let i = 0; i < first.map.length; i += 1) if (mask[i] && first.map[i] === BUILT && last.map[i] && last.map[i] !== BUILT) lostBuilt += pixelHa;
  const trend = linearTrend(series.map((s) => [s.year, s.builtHa]));
  const firstBuilt = series[0]?.builtHa ?? 0;
  const lastBuilt = series[series.length - 1]?.builtHa ?? 0;
  const warnings: string[] = [];
  if (lostBuilt > 0.05 * Math.max(1, firstBuilt)) {
    warnings.push(`${Math.round(lostBuilt)} ha mapped as built-up in ${first.year} is not built-up in ${last.year}. Real demolition is rare, so much of this is classification disagreement between years; read the growth figures with that in mind.`);
  }
  if (series.some((s) => s.cloudHa > 0)) warnings.push("Some of the area is labelled as cloud in at least one year, so it has no land-cover class there.");

  hooks.progress({ stage: "GENERATING_RESULTS", done: tiles.length, total: tiles.length, detail: "Drawing the maps" });
  const growth = new Uint8Array(first.map.length); // 1 built in both, 2 newly built
  for (let i = 0; i < growth.length; i += 1) {
    if (!mask[i] || last.map[i] !== BUILT) continue;
    growth[i] = first.map[i] === BUILT ? 1 : 2;
  }
  const masked = (map: Uint8Array) => map.map((v, i) => (mask[i] ? v : 0));
  const classColours = Object.fromEntries(Object.entries(CLASSES).map(([c, v]) => [Number(c), v.colour])) as Record<number, Rgb>;
  const classLegend = { classes: Object.entries(CLASSES).filter(([c]) => c !== "9" && c !== "10").map(([, v]) => ({ label: v.name, color: hex(v.colour) })) };
  const overlays: Record<string, EngineOverlay> = {
    growth: await makeOverlay(`Built area ${first.year} to ${last.year}`, classImage(growth, { 1: OLD_BUILT_RGB, 2: NEW_BUILT_RGB }), grid, {
      classes: [
        { label: `Built-up since ${last.year} only`, color: hex(NEW_BUILT_RGB) },
        { label: `Built-up in both ${first.year} and ${last.year}`, color: hex(OLD_BUILT_RGB) },
      ],
    }, hooks),
  };
  for (const { year, map } of maps) {
    overlays[`y${year}`] = await makeOverlay(`Land cover ${year}`, classImage(masked(map), classColours), grid, classLegend, hooks);
  }

  return {
    type: "urban" as const,
    label: request.label,
    request: { aoi: request.aoi, label: request.label, firstYear: request.firstYear, lastYear: request.lastYear, maxPixels: request.maxPixels },
    aoi: request.aoi,
    valueKind: "MODELED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        "Reads the published Impact Observatory annual land-cover map for each year and counts pixels inside the " +
        "area. Growth is land classed as built area in the last year that had another class in the first year. " +
        "EarthPulse does not reclassify or correct the maps.",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: NATIVE_RES,
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      landCover: {
        name: "Impact Observatory 10 m Annual Land Use Land Cover (9-class) v2",
        provider: "Impact Observatory, Microsoft and Esri",
        license: "CC BY 4.0",
        attribution: "© Impact Observatory, Microsoft and Esri, derived from ESA Sentinel-2",
      },
      scenes: Object.fromEntries(years.map((year) => [String(year), tiles.filter((t) => t.year === year).map((t) => ({
        id: t.href.split("/").pop()?.split("?")[0] ?? String(year), datetime: `${year}-01-01T00:00:00Z`,
        platform: "Sentinel-2 (classified)", cloudCover: null, footprint: "",
      }))])),
      uncertainty:
        "These are machine-learning classifications, not measurements. Their accuracy varies by region and class, and " +
        "built area is often confused with bare ground and with fallow fields. Year-to-year differences include " +
        "classification noise, so small changes should not be read as real. Check the maps against imagery before " +
        "relying on a figure.",
    },
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      firstYear: first.year,
      lastYear: last.year,
      builtFirstHa: firstBuilt,
      builtLastHa: lastBuilt,
      growthHa: lastBuilt - firstBuilt,
      growthPercent: firstBuilt > 0 ? ((lastBuilt - firstBuilt) / firstBuilt) * 100 : null,
      newBuiltHa: Object.values(replaced).reduce((a, b) => a + b, 0),
      lostBuiltHa: lostBuilt,
      trendHaPerYear: trend?.slope ?? null,
      replaced: Object.entries(replaced)
        .map(([c, ha]) => ({ class: CLASSES[Number(c)]?.name ?? `Class ${c}`, ha }))
        .sort((a, b) => b.ha - a.ha),
    },
    series,
    overlays,
    warnings,
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}
