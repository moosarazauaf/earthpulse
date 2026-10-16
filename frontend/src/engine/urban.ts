/**
 * UrbanEye and ForestEye: how much land one land-cover class covers each
 * year, where it was gained and lost, and what it replaced or became.
 * UrbanEye follows "Built area", ForestEye follows "Trees".
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
export const TREES = 2;
export type FocusClass = typeof BUILT | typeof TREES;
const NEW_BUILT_RGB: Rgb = [255, 90, 60];
const OLD_BUILT_RGB: Rgb = [120, 40, 40];
const LOST_TREES_RGB: Rgb = [255, 138, 92];
const GAINED_TREES_RGB: Rgb = [123, 216, 143];
const STABLE_TREES_RGB: Rgb = [30, 90, 50];

export interface UrbanRequest {
  aoi: AoiGeometry;
  label: string;
  firstYear: number;
  lastYear: number;
  /** The class followed; built area unless set. */
  focus?: FocusClass;
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

/** What the land in the focus class in the last map was in the first map (gains, by former class). */
export function conversions(first: Uint8Array, last: Uint8Array, mask: Uint8Array, pixelHa: number, focus: number = BUILT): Record<number, number> {
  const out: Record<number, number> = {};
  for (let i = 0; i < first.length; i += 1) {
    if (!mask[i] || last[i] !== focus) continue;
    const before = first[i] as number;
    if (!before || before === focus) continue;
    out[before] = (out[before] ?? 0) + pixelHa;
  }
  return out;
}

/** What land in the focus class in the first map became by the last map (losses, by new class). */
export function losses(first: Uint8Array, last: Uint8Array, mask: Uint8Array, pixelHa: number, focus: number): Record<number, number> {
  return conversions(last, first, mask, pixelHa, focus);
}

export async function runUrban(request: UrbanRequest, hooks: EngineHooks) {
  const focus = request.focus ?? BUILT;
  const focusName = CLASSES[focus]!.name;
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
    return { year, focusHa: areas[focus] ?? 0, classes: areas, cloudHa: areas[10] ?? 0 };
  });
  const first = maps[0] as { year: number; map: Uint8Array };
  const last = maps[maps.length - 1] as { year: number; map: Uint8Array };
  const gained = conversions(first.map, last.map, mask, pixelHa, focus);
  const lost = losses(first.map, last.map, mask, pixelHa, focus);
  const gainedHa = Object.values(gained).reduce((a, b) => a + b, 0);
  const lostHa = Object.values(lost).reduce((a, b) => a + b, 0);
  const trend = linearTrend(series.map((s) => [s.year, s.focusHa]));
  const firstHa = series[0]?.focusHa ?? 0;
  const lastHa = series[series.length - 1]?.focusHa ?? 0;
  const warnings: string[] = [];
  if (focus === BUILT && lostHa > 0.05 * Math.max(1, firstHa)) {
    warnings.push(`${Math.round(lostHa)} ha mapped as built-up in ${first.year} is not built-up in ${last.year}. Real demolition is rare, so much of this is classification disagreement between years; read the growth figures with that in mind.`);
  }
  if (focus === TREES) {
    warnings.push("Leaving the Trees class is a change of map class, not deforestation as FAO defines it: harvest and replanting, fire, storm damage, seasonal leaf loss and classifier disagreement between years all show up here. Check losses against the imagery.");
    if (gainedHa > 0.05 * Math.max(1, firstHa)) {
      warnings.push("New forest takes years to reach tree height, so large gains over a few years are more often classification differences than new trees.");
    }
  }
  if (series.some((s) => s.cloudHa > 0)) warnings.push("Some of the area is labelled as cloud in at least one year, so it has no land-cover class there.");

  hooks.progress({ stage: "GENERATING_RESULTS", done: tiles.length, total: tiles.length, detail: "Drawing the maps" });
  const growth = new Uint8Array(first.map.length); // 1 in both years, 2 gained, 3 lost
  for (let i = 0; i < growth.length; i += 1) {
    if (!mask[i]) continue;
    const a = first.map[i] === focus, b = last.map[i] === focus;
    if (a && b) growth[i] = 1;
    else if (b && first.map[i]) growth[i] = 2;
    else if (a && last.map[i] && focus === TREES) growth[i] = 3;
  }
  const masked = (map: Uint8Array) => map.map((v, i) => (mask[i] ? v : 0));
  const classColours = Object.fromEntries(Object.entries(CLASSES).map(([c, v]) => [Number(c), v.colour])) as Record<number, Rgb>;
  const classLegend = { classes: Object.entries(CLASSES).filter(([c]) => c !== "9" && c !== "10").map(([, v]) => ({ label: v.name, color: hex(v.colour) })) };
  const overlays: Record<string, EngineOverlay> = {
    growth: focus === BUILT
      ? await makeOverlay(`Built area ${first.year} to ${last.year}`, classImage(growth, { 1: OLD_BUILT_RGB, 2: NEW_BUILT_RGB }), grid, {
          classes: [
            { label: `Built-up by ${last.year}, not in ${first.year}`, color: hex(NEW_BUILT_RGB) },
            { label: `Built-up in both ${first.year} and ${last.year}`, color: hex(OLD_BUILT_RGB) },
          ],
        }, hooks)
      : await makeOverlay(`Tree cover ${first.year} to ${last.year}`, classImage(growth, { 1: STABLE_TREES_RGB, 2: GAINED_TREES_RGB, 3: LOST_TREES_RGB }), grid, {
          classes: [
            { label: `Trees in ${first.year}, not in ${last.year}`, color: hex(LOST_TREES_RGB) },
            { label: `Trees in ${last.year}, not in ${first.year}`, color: hex(GAINED_TREES_RGB) },
            { label: "Trees in both years", color: hex(STABLE_TREES_RGB) },
          ],
        }, hooks),
  };
  for (const { year, map } of maps) {
    overlays[`y${year}`] = await makeOverlay(`Land cover ${year}`, classImage(masked(map), classColours), grid, classLegend, hooks);
  }

  return {
    type: "urban" as const,
    label: request.label,
    request: { aoi: request.aoi, label: request.label, firstYear: request.firstYear, lastYear: request.lastYear, focus, maxPixels: request.maxPixels },
    aoi: request.aoi,
    valueKind: "MODELED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        "Reads the published Impact Observatory annual land-cover map for each year and counts pixels inside the " +
        `area. A gain is land classed as ${focusName.toLowerCase()} in the last year that had another class in the first year; ` +
        "a loss is the reverse. " +
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
      focus,
      focusName,
      firstHa,
      lastHa,
      changeHa: lastHa - firstHa,
      changePercent: firstHa > 0 ? ((lastHa - firstHa) / firstHa) * 100 : null,
      gainedHa,
      lostHa,
      trendHaPerYear: trend?.slope ?? null,
      gainedFrom: byClass(gained),
      lostTo: byClass(lost),
    },
    series,
    overlays,
    warnings,
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}

function byClass(areas: Record<number, number>): { class: string; ha: number }[] {
  return Object.entries(areas)
    .map(([c, ha]) => ({ class: CLASSES[Number(c)]?.name ?? `Class ${c}`, ha }))
    .filter((r) => r.ha >= 0.05)
    .sort((a, b) => b.ha - a.ha);
}
