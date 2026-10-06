"""Generate a Google Earth Engine script that repeats a change analysis.

The script uses the same scenes, masks, scaling, index, threshold and working
scale as the stored analysis. Earth Engine resamples and reprojects with its
own machinery, so its numbers will be close to EarthPulse's but not
bit-identical; the script header says so.
"""
import json
from typing import Any

from app.core.errors import AppError

# Band names in the Earth Engine Landsat Collection 2 Level-2 collections.
TM_BANDS = {"blue": "SR_B1", "green": "SR_B2", "red": "SR_B3", "nir": "SR_B4",
            "swir1": "SR_B5", "swir2": "SR_B7"}
OLI_BANDS = {"blue": "SR_B2", "green": "SR_B3", "red": "SR_B4", "nir": "SR_B5",
             "swir1": "SR_B6", "swir2": "SR_B7"}
S2_BANDS = {"blue": "B2", "green": "B3", "red": "B4", "nir": "B8", "swir1": "B11", "swir2": "B12"}
INDEX_BANDS = {"ndvi": ("nir", "red"), "ndwi": ("green", "nir"),
               "mndwi": ("green", "swir1"), "ndbi": ("swir1", "nir")}


class NotReproducible(AppError):
    code = "not_reproducible"


def gee_asset_id(scene_id: str) -> tuple[str, str]:
    """Map a Planetary Computer scene id to (Earth Engine asset id, sensor family)."""
    parts = scene_id.split("_")
    if scene_id.startswith("S2") and len(parts) == 6:
        # S2C_MSIL2A_<sensing>_R005_<tile>_<processing>
        return f"COPERNICUS/S2_SR_HARMONIZED/{parts[2]}_{parts[5]}_{parts[4]}", "s2"
    if scene_id[:4] in ("LT04", "LT05", "LE07", "LC08", "LC09") and len(parts) == 6:
        # LT05_L2SP_<pathrow>_<date>_02_T1
        sensor, tier = parts[0], parts[5]
        family = "oli" if sensor in ("LC08", "LC09") else "tm"
        return f"LANDSAT/{sensor}/C02/{tier}_L2/{sensor}_{parts[2]}_{parts[3]}", family
    raise NotReproducible(f"Scene '{scene_id}' has no known Earth Engine equivalent.")


def _id_list(scenes: list[dict[str, Any]]) -> str:
    lines = []
    for scene in scenes:
        asset, family = gee_asset_id(scene["id"])
        lines.append(f"  prep_{family}(ee.Image('{asset}'))")
    return ",\n".join(lines)


def _prep_functions(families: set[str], bands: tuple[str, str]) -> str:
    out = []
    for family, table in (("tm", TM_BANDS), ("oli", OLI_BANDS)):
        if family in families:
            a, b = table[bands[0]], table[bands[1]]
            out.append(f"""// Landsat Collection 2 Level-2 ({'TM/ETM+' if family == 'tm' else 'OLI'}).
// QA_PIXEL bits 0-5: fill, dilated cloud, cirrus, cloud, cloud shadow, snow.
// Surface reflectance = DN * 0.0000275 - 0.2.
function prep_{family}(img) {{
  var clear = img.select('QA_PIXEL').bitwiseAnd(63).eq(0);
  var sr = img.select(['{a}', '{b}'], ['a', 'b']).multiply(0.0000275).add(-0.2);
  return sr.updateMask(clear);
}}""")
    if "s2" in families:
        a, b = S2_BANDS[bands[0]], S2_BANDS[bands[1]]
        out.append(f"""// Sentinel-2 L2A, harmonised collection (the baseline 04.00 offset is already removed).
// SCL classes 0, 1, 3, 8, 9, 10, 11 rejected.
function prep_s2(img) {{
  var scl = img.select('SCL');
  var clear = scl.neq(0).and(scl.neq(1)).and(scl.neq(3)).and(scl.lt(8).or(scl.gt(11)));
  var sr = img.select(['{a}', '{b}'], ['a', 'b']).multiply(0.0001);
  return sr.updateMask(clear);
}}""")
    return "\n\n".join(out)


def generate_change_script(result: dict[str, Any]) -> str:
    if result.get("type") != "change":
        raise NotReproducible("Script generation is available for change analyses only.")
    prov = result["provenance"]
    if not prov["provider"]["observed"]:
        raise NotReproducible(
            "This analysis used synthetic demo data, which has no Earth Engine equivalent."
        )
    request, summary = result["request"], result["summary"]
    index = prov["index"]
    bands = INDEX_BANDS[index["id"]]
    scenes = prov["scenes"]
    families = {gee_asset_id(s["id"])[1] for s in scenes["before"] + scenes["after"]}
    scale = prov["workingResolutionM"]
    threshold = summary["threshold"]
    aoi = json.dumps(result["aoi"])

    return f"""// EarthPulse generated script
// Analysis ID : {result['id']}
// Software    : EarthPulse {result['softwareVersion']}
// Dataset     : {prov['dataset']['name']} ({prov['dataset']['provider']})
// Index       : {index['name']} = {index['formula']}  [{index['reference']}]
// Before      : {request['before']['start']} to {request['before']['end']} ({len(scenes['before'])} scenes)
// After       : {request['after']['start']} to {request['after']['end']} ({len(scenes['after'])} scenes)
// Threshold   : |change| >= {threshold:g}
// Scale       : {scale:g} m, {prov['crs']}
//
// This script uses the same scenes, cloud masks, scaling, compositing rule,
// index, threshold and scale as the EarthPulse analysis. Earth Engine
// resamples and reprojects differently, so expect close but not identical
// numbers. EarthPulse reported: decrease {summary['lossAreaHa']:.1f} ha,
// increase {summary['gainAreaHa']:.1f} ha.

var aoi = ee.Geometry({aoi});

{_prep_functions(families, bands)}

function index(img) {{
  // Reject non-positive sums, which only arise from invalid reflectance.
  var sum = img.select('a').add(img.select('b'));
  return img.select('a').subtract(img.select('b')).divide(sum)
            .updateMask(sum.gt(0)).clamp(-1, 1).rename('{index['id']}');
}}

var beforeScenes = ee.ImageCollection([
{_id_list(scenes['before'])}
]);
var afterScenes = ee.ImageCollection([
{_id_list(scenes['after'])}
]);

// Per-pixel median of clear observations, then the index on the composite.
var before = index(beforeScenes.median()).clip(aoi);
var after = index(afterScenes.median()).clip(aoi);
var change = after.subtract(before).rename('change');

var decrease = change.lte({-threshold:g});
var increase = change.gte({threshold:g});

var proj = ee.Projection('{prov['crs']}').atScale({scale:g});
var areaHa = ee.Image.pixelArea().divide(10000);
var stats = areaHa.updateMask(decrease).rename('decrease_ha')
  .addBands(areaHa.updateMask(increase).rename('increase_ha'))
  .reduceRegion({{
    reducer: ee.Reducer.sum(), geometry: aoi, crs: proj, maxPixels: 1e10
  }});
print('Area of change (ha)', stats);
print('Mean {index['name']} before / after',
  before.addBands(after).reduceRegion({{
    reducer: ee.Reducer.mean(), geometry: aoi, crs: proj, maxPixels: 1e10
  }}));

Map.centerObject(aoi);
var indexVis = {{min: -0.2, max: 0.8, palette: ['784628', 'dcc896', 'f5f5c8', '82be6e', '146432']}};
Map.addLayer(before, indexVis, '{index['name']} before', false);
Map.addLayer(after, indexVis, '{index['name']} after', false);
Map.addLayer(change, {{min: -0.5, max: 0.5,
  palette: ['a52a2a', 'e68c5a', 'f5f5f0', '78be8c', '146e46']}}, '{index['name']} change');
Map.addLayer(ee.Image().paint(aoi, 1, 2), {{palette: ['ffffff']}}, 'AOI');
"""
