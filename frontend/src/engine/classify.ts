/**
 * Land-cover classification with the visitor's own training samples.
 *
 * A clear-sky composite for one season gives eight features per pixel (five
 * bands and NDVI, MNDWI, NDBI). Samples are split into training and test
 * sets by feature, not by pixel, so that pixels from one polygon never sit
 * on both sides: neighbouring pixels are alike, and splitting them would
 * inflate the accuracy. A random forest is trained, the test samples give
 * the confusion matrix, and every pixel in the area is classified.
 */
import type { Sample } from "../analysis/samples";
import type { AoiGeometry } from "../app/types";
import { type EngineHooks, type EngineOverlay, M2_PER_HA, type Rgb, classImage, hex, makeOverlay } from "./common";
import { accuracy, predict, rng, trainForest } from "./forest";
import { type Grid, buildGrid, projectAoi, rasterMask, transformer } from "./geo";
import { BANDS, FIRST_YEAR, NATIVE_RES, type OpticalDataset, landsatPlatforms, searchScenes, seasonWindow, selectScenes } from "./pc";
import { CLASS_COLOURS } from "./palette";
import { compositeBands, normalizedDifference } from "./raster";

export const FEATURE_NAMES = ["Green", "Red", "NIR", "SWIR-1", "SWIR-2", "NDVI", "MNDWI", "NDBI"];
const SCENES_PER_FOOTPRINT = 2;
const MAX_SCENES = 6;
/** Pixels taken from one polygon at most, so large polygons do not swamp the rest. */
const MAX_PIXELS_PER_POLYGON = 60;
const TREES = 50;
/** Training rows beyond this make each tree slow to grow in a browser for little gain. */
const MAX_TRAINING_PIXELS = 20_000;

export interface ClassifyRequest {
  aoi: AoiGeometry;
  label: string;
  dataset: OpticalDataset;
  year: number;
  startMonth: number;
  endMonth: number;
  maxCloud: number;
  classes: string[];
  /** Samples with the index of their class in `classes`. */
  samples: (Sample & { classIndex: number })[];
  /** Share of features held back for testing. */
  testShare: number;
  seed: number;
  maxPixels: number;
  concurrency: number;
}

/** Pixel indices a sample covers on the grid (a point covers one, a polygon up to MAX_PIXELS_PER_POLYGON). */
export function samplePixels(sample: Sample, grid: Grid, random: () => number): number[] {
  const toGrid = transformer(4326, grid.epsg);
  const index = (x: number, y: number) => {
    const col = Math.floor((x - grid.west) / grid.res), row = Math.floor((grid.north - y) / grid.res);
    return col >= 0 && row >= 0 && col < grid.width && row < grid.height ? row * grid.width + col : -1;
  };
  if (sample.geometry.type === "Point") {
    const [x, y] = toGrid(sample.geometry.coordinates[0], sample.geometry.coordinates[1]);
    const i = index(x, y);
    return i >= 0 ? [i] : [];
  }
  const polygons = sample.geometry.type === "Polygon" ? [sample.geometry.coordinates] : sample.geometry.coordinates;
  const rings = polygons.map((p) => p[0]!.map(([lon, lat]) => toGrid(lon!, lat!)));
  const inside = pixelsInside(rings, grid);
  if (inside.length === 0) {
    // A polygon smaller than one pixel still counts: use the pixel under its first vertex.
    const [x, y] = rings[0]![0]!;
    const i = index(x, y);
    return i >= 0 ? [i] : [];
  }
  for (let i = inside.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [inside[i], inside[j]] = [inside[j]!, inside[i]!];
  }
  return inside.slice(0, MAX_PIXELS_PER_POLYGON);
}

/**
 * Grid indices of pixel centres inside the rings, rasterising only the rings'
 * bounding box: a mask of the whole grid per polygon is far too slow for
 * files with thousands of polygons.
 */
export function pixelsInside(rings: [number, number][][], grid: Grid): number[] {
  const xs = rings.flat().map((p) => p[0]), ys = rings.flat().map((p) => p[1]);
  const col0 = Math.max(0, Math.floor((Math.min(...xs) - grid.west) / grid.res));
  const col1 = Math.min(grid.width - 1, Math.floor((Math.max(...xs) - grid.west) / grid.res));
  const row0 = Math.max(0, Math.floor((grid.north - Math.max(...ys)) / grid.res));
  const row1 = Math.min(grid.height - 1, Math.floor((grid.north - Math.min(...ys)) / grid.res));
  if (col1 < col0 || row1 < row0) return [];
  const sub = { ...grid, west: grid.west + col0 * grid.res, north: grid.north - row0 * grid.res, width: col1 - col0 + 1, height: row1 - row0 + 1 };
  const mask = rasterMask(rings, sub);
  const out: number[] = [];
  for (let j = 0; j < mask.length; j += 1) {
    if (mask[j]) out.push((Math.floor(j / sub.width) + row0) * grid.width + (j % sub.width) + col0);
  }
  return out;
}

/** Indices of at most `max` rows, chosen at random within each class in proportion to its size (all rows when under the cap). */
export function capPerClass(labels: number[], max: number, random: () => number): number[] {
  if (labels.length <= max) return labels.map((_, i) => i);
  const byClass = new Map<number, number[]>();
  labels.forEach((label, i) => byClass.set(label, [...(byClass.get(label) ?? []), i]));
  const kept: number[] = [];
  for (const rows of byClass.values()) {
    for (let i = rows.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [rows[i], rows[j]] = [rows[j]!, rows[i]!];
    }
    kept.push(...rows.slice(0, Math.max(1, Math.round((max * rows.length) / labels.length))));
  }
  return kept;
}

/** Which features go to testing: a share of each class's features, at random; classes with one feature stay in training. */
export function splitFeatures(samples: { feature: number; classIndex: number }[], testShare: number, random: () => number): Set<number> {
  const byClass = new Map<number, number[]>();
  for (const s of samples) {
    const list = byClass.get(s.classIndex) ?? [];
    if (!list.includes(s.feature)) list.push(s.feature);
    byClass.set(s.classIndex, list);
  }
  const test = new Set<number>();
  for (const features of byClass.values()) {
    if (features.length < 2) continue;
    const shuffled = [...features];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
    }
    const n = Math.max(1, Math.round(features.length * testShare));
    for (const f of shuffled.slice(0, Math.min(n, features.length - 1))) test.add(f);
  }
  return test;
}

export async function runClassify(request: ClassifyRequest, hooks: EngineHooks) {
  const { dataset } = request;
  const aoi = projectAoi(request.aoi);
  const grid = buildGrid(aoi, NATIVE_RES[dataset], request.maxPixels);
  const mask = rasterMask(aoi.rings, grid);
  const warnings: string[] = [];
  if (request.year < FIRST_YEAR[dataset]) throw new Error(`This archive starts in ${FIRST_YEAR[dataset]}.`);

  hooks.progress({ stage: "ACQUIRING_DATA", done: 0, total: 1, detail: "Searching the archive" });
  const [start, end] = seasonWindow(request.year, request.startMonth, request.endMonth);
  const scenes = selectScenes(await searchScenes(dataset, aoi.lonLatBounds, start, end, request.maxCloud, hooks.signal), SCENES_PER_FOOTPRINT, MAX_SCENES);
  if (!scenes.length) throw new Error(`No scene with at most ${request.maxCloud}% cloud in ${start} to ${end}. Try another season or year.`);
  const note = dataset === "landsat" ? landsatPlatforms(request.year).note : null;
  if (note) warnings.push(note);

  const bands = ["green", "red", "nir", "swir1", "swir2"];
  const total = scenes.length * (bands.length + 1);
  let done = 0;
  const c = await compositeBands(dataset, BANDS[dataset], bands, scenes, grid, request.concurrency, () => {
    done += 1;
    hooks.progress({ stage: "PROCESSING_IMAGERY", done, total, detail: `Reading the imagery: file ${done} of ${total}` });
  }, hooks.signal);
  const layers = [
    ...bands.map((b) => c.bands[b] as Float32Array),
    normalizedDifference(c.bands.nir as Float32Array, c.bands.red as Float32Array),
    normalizedDifference(c.bands.green as Float32Array, c.bands.swir1 as Float32Array),
    normalizedDifference(c.bands.swir1 as Float32Array, c.bands.nir as Float32Array),
  ];
  const featuresAt = (i: number): Float32Array | null => {
    const row = new Float32Array(layers.length);
    for (let k = 0; k < layers.length; k += 1) {
      const v = layers[k]![i] as number;
      if (!Number.isFinite(v)) return null;
      row[k] = v;
    }
    return row;
  };

  // Samples to pixels, then the split by feature.
  hooks.progress({ stage: "CALCULATING_INDICES", done: total, total, detail: "Reading the training samples" });
  const random = rng(request.seed);
  const testFeatures = splitFeatures(request.samples, request.testShare, random);
  const train = { x: [] as Float32Array[], y: [] as number[] };
  const test = { x: [] as Float32Array[], y: [] as number[] };
  let outside = 0, cloudy = 0;
  for (const sample of request.samples) {
    const pixels = samplePixels(sample, grid, random);
    if (!pixels.length) { outside += 1; continue; }
    for (const p of pixels) {
      const row = featuresAt(p);
      if (!row) { cloudy += 1; continue; }
      const target = testFeatures.has(sample.feature) ? test : train;
      target.x.push(row);
      target.y.push(sample.classIndex);
    }
  }
  if (outside) warnings.push(`${outside} sample${outside === 1 ? " lies" : "s lie"} outside the area and ${outside === 1 ? "was" : "were"} left out.`);
  if (cloudy) warnings.push(`${cloudy} sample pixel${cloudy === 1 ? " had" : "s had"} no clear view in the composite and ${cloudy === 1 ? "was" : "were"} left out.`);
  const present = new Set(train.y);
  const missing = request.classes.filter((_, i) => !present.has(i));
  if (missing.length) warnings.push(`No usable training samples for ${missing.join(", ")}; ${missing.length === 1 ? "it" : "they"} cannot appear in the map.`);
  if (present.size < 2) throw new Error("At least two classes need usable training samples inside the area.");

  const kept = capPerClass(train.y, MAX_TRAINING_PIXELS, random);
  if (kept.length < train.y.length) warnings.push(`Training used a random ${kept.length.toLocaleString("en")} of ${train.y.length.toLocaleString("en")} sample pixels, in proportion to each class, to keep training to minutes.`);
  hooks.progress({ stage: "DETECTING_CHANGE", done: total, total, detail: `Training ${TREES} trees on ${kept.length} pixels` });
  const forest = trainForest(kept.map((i) => train.x[i]!), kept.map((i) => train.y[i]!), { trees: TREES, maxDepth: 14, minLeaf: 1, seed: request.seed });

  const assessed = test.y.length > 0 ? accuracy(test.y, test.x.map((row) => predict(forest, row)), request.classes.map((_, i) => i)) : null;
  if (!assessed) warnings.push("No samples were left for testing (each class needs at least two features), so no accuracy can be reported.");
  else {
    const thin = request.classes.filter((_, i) => (assessed.matrix[i]?.reduce((a, b) => a + b, 0) ?? 0) < 20);
    if (thin.length) warnings.push(`Fewer than 20 test pixels for ${thin.join(", ")}: their accuracies are very uncertain.`);
    warnings.push("Accuracy is measured on your held-back samples, not on a random probability sample of the map, so it describes the map only as well as the samples represent the area (Olofsson et al. 2014).");
  }

  // Classify every observed pixel inside the area.
  const map = new Uint8Array(grid.width * grid.height); // class index + 1; 0 is no data
  const counts = request.classes.map(() => 0);
  let classified = 0, inside = 0;
  for (let i = 0; i < map.length; i += 1) {
    if (!mask[i]) continue;
    inside += 1;
    const row = featuresAt(i);
    if (!row) continue;
    const k = predict(forest, row);
    map[i] = k + 1;
    counts[k]! += 1;
    classified += 1;
    if (classified % 50_000 === 0) hooks.progress({ stage: "GENERATING_RESULTS", done: classified, total: inside, detail: `Classifying: ${Math.round((classified / inside) * 100)}%` });
  }
  if (classified < 0.9 * inside) warnings.push(`${Math.round((1 - classified / Math.max(inside, 1)) * 100)}% of the area had no clear view and is left unclassified.`);

  hooks.progress({ stage: "GENERATING_RESULTS", done: inside, total: inside, detail: "Drawing the map" });
  const pixelHa = grid.res ** 2 / M2_PER_HA;
  const colours = Object.fromEntries(request.classes.map((_, i) => [i + 1, CLASS_COLOURS[i % CLASS_COLOURS.length]!])) as Record<number, Rgb>;
  const overlays: Record<string, EngineOverlay> = {
    classes: await makeOverlay(`Land cover ${request.year} (your classes)`, classImage(map, colours), grid, {
      classes: request.classes.map((name, i) => ({ label: name, color: hex(CLASS_COLOURS[i % CLASS_COLOURS.length]!) })),
    }, hooks),
  };

  const publicScene = (s: (typeof scenes)[number]) => ({ id: s.id, datetime: s.datetime, platform: s.platform, cloudCover: s.cloudCover, footprint: s.footprint });
  return {
    type: "classify" as const,
    label: request.label,
    request: { aoi: request.aoi, label: request.label, dataset, year: request.year, startMonth: request.startMonth, endMonth: request.endMonth, maxCloud: request.maxCloud, classes: request.classes, testShare: request.testShare, seed: request.seed },
    aoi: request.aoi,
    valueKind: "MODELED" as const,
    provenance: {
      provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
      method:
        `Random forest (Breiman 2001), ${TREES} trees, maximum depth 14, square-root feature sampling, trained on a median ` +
        `composite of clear-sky surface reflectance (${start} to ${end}) with ${FEATURE_NAMES.length} features: ${FEATURE_NAMES.join(", ")}. ` +
        `Samples split by feature, ${Math.round(request.testShare * 100)}% of each class's features held back for testing; up to ` +
        `${MAX_PIXELS_PER_POLYGON} pixels per polygon. Seed ${request.seed}.`,
      cloudMask: dataset === "landsat"
        ? "QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow rejected"
        : "SCL: no data, saturated, cloud shadow, cloud (medium/high), cirrus and snow rejected",
      crs: `EPSG:${grid.epsg}`,
      nativeResolutionM: NATIVE_RES[dataset],
      workingResolutionM: grid.res,
      gridSize: [grid.width, grid.height] as [number, number],
      maxCloudPercent: request.maxCloud,
      scenes: { composite: scenes.map(publicScene) },
      uncertainty:
        "A classification is a model: its errors depend on how well the samples represent each class and the whole area. " +
        "Report the confusion matrix with any area figure, and prefer area estimates adjusted for the errors (Olofsson et al. 2014) for formal work.",
    },
    summary: {
      aoiAreaHa: aoi.areaM2 / M2_PER_HA,
      classes: request.classes.map((name, i) => ({ name, ha: counts[i]! * pixelHa, share: classified ? counts[i]! / classified : 0, colour: hex(CLASS_COLOURS[i % CLASS_COLOURS.length]!) })),
      trainPixels: kept.length,
      testPixels: test.y.length,
      accuracy: assessed,
      importance: FEATURE_NAMES.map((name, i) => ({ name, value: forest.importance[i]! })).sort((a, b) => b.value - a.value),
    },
    overlays,
    warnings,
    raster: {
      name: `classes-${request.year}`,
      description: `Land cover classified from your samples, ${start} to ${end}; 0 is no data.`,
      data: map, epsg: grid.epsg, west: grid.west, north: grid.north, res: grid.res, width: grid.width, height: grid.height, noData: "0",
      codes: Object.fromEntries([[0, "No data"], ...request.classes.map((name, i) => [i + 1, name])]),
    },
    grid: { epsg: grid.epsg, res: grid.res, width: grid.width, height: grid.height },
  };
}
