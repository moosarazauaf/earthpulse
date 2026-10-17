/**
 * A Google Earth Engine script that repeats a change analysis: the same
 * scenes, cloud masks, scaling, compositing rule, index, threshold and scale.
 * Earth Engine resamples and reprojects with its own machinery, so its
 * numbers will be close to EarthPulse's but not identical; the header says so.
 * Ported from the backend's generator so browser results get one too.
 */
import type { ChangeResult } from "../app/types";

const TM: Record<string, string> = { blue: "SR_B1", green: "SR_B2", red: "SR_B3", nir: "SR_B4", swir1: "SR_B5", swir2: "SR_B7" };
const OLI: Record<string, string> = { blue: "SR_B2", green: "SR_B3", red: "SR_B4", nir: "SR_B5", swir1: "SR_B6", swir2: "SR_B7" };
const S2: Record<string, string> = { blue: "B2", green: "B3", red: "B4", nir: "B8", swir1: "B11", swir2: "B12" };
const INDEX_BANDS: Record<string, [string, string]> = {
  ndvi: ["nir", "red"], ndwi: ["green", "nir"], mndwi: ["green", "swir1"], ndbi: ["swir1", "nir"], nbr: ["nir", "swir2"],
};

export class NotReproducible extends Error {}

/** A Planetary Computer scene id as an Earth Engine asset id and sensor family. */
export function geeAssetId(sceneId: string): [string, "s2" | "tm" | "oli"] {
  const parts = sceneId.split("_");
  if (sceneId.startsWith("S2") && parts.length === 6) {
    // S2C_MSIL2A_<sensing>_R005_<tile>_<processing>
    return [`COPERNICUS/S2_SR_HARMONIZED/${parts[2]}_${parts[5]}_${parts[4]}`, "s2"];
  }
  const sensor = sceneId.slice(0, 4);
  if (["LT04", "LT05", "LE07", "LC08", "LC09"].includes(sensor) && parts.length === 6) {
    // LT05_L2SP_<pathrow>_<date>_02_T1
    const family = sensor === "LC08" || sensor === "LC09" ? "oli" : "tm";
    return [`LANDSAT/${sensor}/C02/${parts[5]}_L2/${sensor}_${parts[2]}_${parts[3]}`, family];
  }
  throw new NotReproducible(`Scene '${sceneId}' has no known Earth Engine equivalent.`);
}

function prepFunctions(families: Set<string>, bands: [string, string]): string {
  const out: string[] = [];
  for (const [family, table, name] of [["tm", TM, "TM/ETM+"], ["oli", OLI, "OLI"]] as const) {
    if (!families.has(family)) continue;
    out.push(`// Landsat Collection 2 Level-2 (${name}).
// QA_PIXEL bits 0-5: fill, dilated cloud, cirrus, cloud, cloud shadow, snow.
// Surface reflectance = DN * 0.0000275 - 0.2.
function prep_${family}(img) {
  var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
  var sr = img.select(['${table[bands[0]]}', '${table[bands[1]]}'], ['a', 'b']).multiply(0.0000275).add(-0.2);
  return sr.updateMask(clear);
}`);
  }
  if (families.has("s2")) {
    out.push(`// Sentinel-2 L2A, harmonised collection (the baseline 04.00 offset is already removed).
// SCL classes 0, 1, 3, 8, 9, 10, 11 rejected.
function prep_s2(img) {
  var scl = img.select('SCL');
  var clear = scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.lt(8).or(scl.gt(11)));
  var sr = img.select(['${S2[bands[0]]}', '${S2[bands[1]]}'], ['a', 'b']).multiply(0.0001);
  return sr.updateMask(clear);
}`);
  }
  return out.join("\n\n");
}

const ids = (scenes: { id: string }[]) => scenes.map((s) => { const [asset, family] = geeAssetId(s.id); return `  prep_${family}(ee.Image('${asset}'))`; }).join(",\n");

export function changeScript(result: ChangeResult): string {
  const prov = result.provenance;
  if (!prov.provider.observed) throw new NotReproducible("This analysis used synthetic demo data, which has no Earth Engine equivalent.");
  const index = prov.index;
  const scenes = prov.scenes as { before?: { id: string }[]; after?: { id: string }[] } | undefined;
  if (!index || !scenes?.before || !scenes.after) throw new NotReproducible("This result does not list its scenes.");
  const bands = INDEX_BANDS[index.id];
  if (!bands) throw new NotReproducible(`No Earth Engine recipe for ${index.id}.`);
  const families = new Set([...scenes.before, ...scenes.after].map((s) => geeAssetId(s.id)[1]));
  const { request, summary } = result;
  // Numbers only: nothing from a request reaches the script as text.
  const t = Number(summary.threshold);
  const scale = Number(prov.workingResolutionM);
  const dataset = prov.dataset ? `${prov.dataset.name} (${prov.dataset.provider})` : request.dataset === "sentinel2" ? "Sentinel-2 L2A (ESA)" : "Landsat Collection 2 Level-2 (USGS)";
  return `// EarthPulse generated script
// Analysis ID : ${result.id}
// Software    : EarthPulse ${result.softwareVersion}${prov.computedOn === "browser" ? " (computed in the browser)" : ""}
// Dataset     : ${dataset}
// Index       : ${index.name} = ${index.formula}  [${index.reference}]
// Before      : ${request.before.start} to ${request.before.end} (${scenes.before.length} scenes)
// After       : ${request.after.start} to ${request.after.end} (${scenes.after.length} scenes)
// Threshold   : |change| >= ${t}
// Scale       : ${scale} m, ${prov.crs}
//
// This script uses the same scenes, cloud masks, scaling, compositing rule,
// index, threshold and scale as the EarthPulse analysis. Earth Engine
// resamples and reprojects differently, so expect close but not identical
// numbers. EarthPulse reported: decrease ${summary.lossAreaHa.toFixed(1)} ha,
// increase ${summary.gainAreaHa.toFixed(1)} ha.

var aoi = ee.Geometry(${JSON.stringify(result.aoi)});

${prepFunctions(families, bands)}

function index(img) {
  // Reject non-positive sums, which only arise from invalid reflectance.
  var sum = img.select('a').add(img.select('b'));
  return img.select('a').subtract(img.select('b')).divide(sum)
            .updateMask(sum.gt(0)).clamp(-1, 1).rename('${index.id}');
}

var beforeScenes = ee.ImageCollection([
${ids(scenes.before)}
]);
var afterScenes = ee.ImageCollection([
${ids(scenes.after)}
]);

// Per-pixel median of clear observations, then the index on the composite.
var before = index(beforeScenes.median()).clip(aoi);
var after = index(afterScenes.median()).clip(aoi);
var change = after.subtract(before).rename('change');
${index.id === "nbr" ? "// For burn severity, dNBR = NBR before - NBR after, so a burn is a decrease here.\n" : ""}
var decrease = change.lte(${-t});
var increase = change.gte(${t});

var proj = ee.Projection('${prov.crs}').atScale(${scale});
var areaHa = ee.Image.pixelArea().divide(10000);
var stats = areaHa.updateMask(decrease).rename('decrease_ha')
  .addBands(areaHa.updateMask(increase).rename('increase_ha'))
  .reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, crs: proj, maxPixels: 1e10
  });
print('Area of change (ha)', stats);
print('Mean ${index.name} before / after',
  before.addBands(after).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: aoi, crs: proj, maxPixels: 1e10
  }));

Map.centerObject(aoi);
var indexVis = {min: -0.2, max: 0.8, palette: ['784628', 'dcc896', 'f5f5c8', '82be6e', '146432']};
Map.addLayer(before, indexVis, '${index.name} before', false);
Map.addLayer(after, indexVis, '${index.name} after', false);
Map.addLayer(change, {min: -0.5, max: 0.5,
  palette: ['a52a2a', 'e68c5a', 'f5f5f0', '78be8c', '146e46']}, '${index.name} change');
Map.addLayer(ee.Image().paint(aoi, 1, 2), {palette: ['ffffff']}, 'AOI');
`;
}
