// EarthPulse generated script
// Analysis ID : EP-2026-LAHOREDISTRICT-2EBD2
// Software    : EarthPulse 0.1.0
// Dataset     : Landsat Collection 2 Level-2 (USGS / NASA)
// Index       : NDVI = (nir - red) / (nir + red)  [Rouse et al. 1974; Tucker 1979]
// Before      : 1993-10-01 to 1993-12-31 (9 scenes)
// After       : 2025-10-01 to 2025-12-31 (9 scenes)
// Threshold   : |change| >= 0.15
// Scale       : 60 m, EPSG:32643
//
// This script uses the same scenes, cloud masks, scaling, compositing rule,
// index, threshold and scale as the EarthPulse analysis. Earth Engine
// resamples and reprojects differently, so expect close but not identical
// numbers. EarthPulse reported: decrease 17902.8 ha,
// increase 21972.2 ha.

var aoi = ee.Geometry({"type": "Polygon", "coordinates": [[[73.99826, 31.28096], [74.0102, 31.28096], [74.04199, 31.26209], [74.07377, 31.25983], [74.13116, 31.25907], [74.1497, 31.25002], [74.15942, 31.23794], [74.20974, 31.23265], [74.24418, 31.23114], [74.26802, 31.23492], [74.28302, 31.24171], [74.29627, 31.25454], [74.32099, 31.25983], [74.34395, 31.25983], [74.41956, 31.26897], [74.42803, 31.28878], [74.43142, 31.30133], [74.44725, 31.30954], [74.46815, 31.31243], [74.48454, 31.31243], [74.52544, 31.32294], [74.52646, 31.36359], [74.54461, 31.38812], [74.55973, 31.40102], [74.58845, 31.41909], [74.60509, 31.46424], [74.60357, 31.49003], [74.59601, 31.5055], [74.57787, 31.51581], [74.57182, 31.53514], [74.5688, 31.55576], [74.5567, 31.58023], [74.55519, 31.60728], [74.54914, 31.63946], [74.53402, 31.65105], [74.5133, 31.68884], [74.49167, 31.68787], [74.46408, 31.67613], [74.45856, 31.6503], [74.442, 31.6503], [74.42683, 31.63151], [74.402, 31.63855], [74.38682, 31.65147], [74.35923, 31.64325], [74.3344, 31.62916], [74.26818, 31.61741], [74.25439, 31.60331], [74.25025, 31.57981], [74.23093, 31.56923], [74.22404, 31.54807], [74.22404, 31.53279], [74.21714, 31.51162], [74.20748, 31.50339], [74.19644, 31.49868], [74.18955, 31.48339], [74.18817, 31.46221], [74.18403, 31.45162], [74.17023, 31.44926], [74.16471, 31.43632], [74.15506, 31.42572], [74.11505, 31.42219], [74.10263, 31.40571], [74.08608, 31.40453], [74.07366, 31.39393], [74.0709, 31.37862], [74.06401, 31.3586], [74.04607, 31.35624], [74.0309, 31.35624], [73.99365, 31.30557], [73.99826, 31.28096]]]});

// Landsat Collection 2 Level-2 (TM/ETM+).
// QA_PIXEL bits 0-5: fill, dilated cloud, cirrus, cloud, cloud shadow, snow.
// Surface reflectance = DN * 0.0000275 - 0.2.
function prep_tm(img) {
  var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
  var sr = img.select(['SR_B4', 'SR_B3'], ['a', 'b']).multiply(0.0000275).add(-0.2);
  return sr.updateMask(clear);
}

// Landsat Collection 2 Level-2 (OLI).
// QA_PIXEL bits 0-5: fill, dilated cloud, cirrus, cloud, cloud shadow, snow.
// Surface reflectance = DN * 0.0000275 - 0.2.
function prep_oli(img) {
  var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
  var sr = img.select(['SR_B5', 'SR_B4'], ['a', 'b']).multiply(0.0000275).add(-0.2);
  return sr.updateMask(clear);
}

function index(img) {
  // Reject non-positive sums, which only arise from invalid reflectance.
  var sum = img.select('a').add(img.select('b'));
  return img.select('a').subtract(img.select('b')).divide(sum)
            .updateMask(sum.gt(0)).clamp(-1, 1).rename('ndvi');
}

var beforeScenes = ee.ImageCollection([
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_149038_19931205')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_148039_19931230')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_148038_19931214')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_149038_19931119')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_148039_19931214')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_148038_19931128')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_149038_19931018')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_148039_19931128')),
  prep_tm(ee.Image('LANDSAT/LT05/C02/T1_L2/LT05_148038_19931230'))
]);
var afterScenes = ee.ImageCollection([
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_149038_20251205')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_148039_20251011')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_148038_20251128')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_149038_20251119')),
  prep_oli(ee.Image('LANDSAT/LC08/C02/T1_L2/LC08_148039_20251019')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_148038_20251027')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_149038_20251103')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_148039_20251128')),
  prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_148038_20251011'))
]);

// Per-pixel median of clear observations, then the index on the composite.
var before = index(beforeScenes.median()).clip(aoi);
var after = index(afterScenes.median()).clip(aoi);
var change = after.subtract(before).rename('change');

var decrease = change.lte(-0.15);
var increase = change.gte(0.15);

var proj = ee.Projection('EPSG:32643').atScale(60);
var areaHa = ee.Image.pixelArea().divide(10000);
var stats = areaHa.updateMask(decrease).rename('decrease_ha')
  .addBands(areaHa.updateMask(increase).rename('increase_ha'))
  .reduceRegion({
    reducer: ee.Reducer.sum(), geometry: aoi, crs: proj, maxPixels: 1e10
  });
print('Area of change (ha)', stats);
print('Mean NDVI before / after',
  before.addBands(after).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: aoi, crs: proj, maxPixels: 1e10
  }));

Map.centerObject(aoi);
var indexVis = {min: -0.2, max: 0.8, palette: ['784628', 'dcc896', 'f5f5c8', '82be6e', '146432']};
Map.addLayer(before, indexVis, 'NDVI before', false);
Map.addLayer(after, indexVis, 'NDVI after', false);
Map.addLayer(change, {min: -0.5, max: 0.5,
  palette: ['a52a2a', 'e68c5a', 'f5f5f0', '78be8c', '146e46']}, 'NDVI change');
Map.addLayer(ee.Image().paint(aoi, 1, 2), {palette: ['ffffff']}, 'AOI');
