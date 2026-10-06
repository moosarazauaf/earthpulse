"""FloodLens on the synthetic provider: a river that is always water and a block that floods."""
import numpy as np
import pytest
from affine import Affine
from shapely.geometry import box

from app.core.config import get_settings
from app.core.errors import NoImagery
from app.models import FloodRequest
from app.providers import demo
from app.providers.base import Grid, Scene
from app.services import flood


def _body(aoi, **extra):
    return {"aoi": aoi, "label": "Test flood", "provider": "demo", "minAreaHa": 0,
            "before": {"start": "2000-06-01", "end": "2000-06-30"},
            "flood": {"start": "2020-06-01", "end": "2020-06-30"}, **extra}


def _run(aoi, **extra):
    request = FloodRequest(**_body(aoi, **extra))
    return flood.run(request, "EP-2026-TEST-F0000", get_settings(), lambda _: None)


def test_flood_extent_excludes_pre_existing_water(aoi):
    result = _run(aoi)
    summary, prov = result["summary"], result["provenance"]
    width, height = prov["gridSize"]
    pixel_ha = prov["workingResolutionM"] ** 2 / 10_000
    block = (2 * height // 3 - height // 3) * (2 * width // 3 - width // 3) * pixel_ha
    river = (height // 10) * width * pixel_ha

    assert result["valueKind"] == "SIMULATED"
    assert summary["floodedAreaHa"] == pytest.approx(block, rel=0.04)
    assert summary["preExistingWaterHa"] == pytest.approx(river, rel=0.06)  # the river is not a flood
    assert summary["waterExtentDuringFloodHa"] == pytest.approx(block + river, rel=0.04)
    assert prov["threshold"]["source"] == "otsu"
    assert demo.WATER_DB < summary["thresholdDb"] < demo.LAND_DB
    assert prov["relativeOrbit"] == 5
    largest = result["detections"]["features"][0]["properties"]
    assert largest["before"] == pytest.approx(demo.LAND_DB, abs=0.5)
    assert largest["after"] == pytest.approx(demo.WATER_DB, abs=0.5)


def test_affected_land_use_splits_the_flooded_area(aoi):
    result = _run(aoi)
    cover, flooded = result["landCover"], result["summary"]["floodedAreaHa"]
    total = cover["croplandFloodedHa"] + cover["builtUpFloodedHa"] + cover["otherFloodedHa"]
    assert total == pytest.approx(flooded)
    assert cover["builtUpFloodedHa"] > 0 and cover["croplandFloodedHa"] > 0
    assert cover["otherFloodedHa"] == 0
    # The radar's pre-flood water agrees with the independent water map.
    assert cover["preExistingWaterAlsoMappedHa"] == pytest.approx(
        result["summary"]["preExistingWaterHa"], rel=0.02)


def test_recession_and_user_threshold(aoi):
    result = _run(aoi, after={"start": "2021-06-01", "end": "2021-06-30"}, thresholdDb=-15)
    recession = result["summary"]["recession"]
    # The synthetic flood never drains, so everything flooded is still water.
    assert recession["stillWaterHa"] == pytest.approx(result["summary"]["floodedAreaHa"])
    assert recession["recededHa"] == 0
    assert result["provenance"]["threshold"] == {"valueDb": -15.0, "source": "user", "separability": None}
    assert "vv_after" in result["overlays"]


def test_no_flood_when_nothing_changed(aoi):
    body = _body(aoi)
    body["before"] = {"start": "2019-06-01", "end": "2019-06-30"}  # block already water
    result = flood.run(FloodRequest(**body), "EP-2026-TEST-F0001", get_settings(), lambda _: None)
    assert result["summary"]["floodedAreaHa"] == 0
    assert result["detections"]["features"] == []


def test_request_validation(aoi):
    with pytest.raises(ValueError):
        FloodRequest(**_body(aoi, flood={"start": "2000-06-15", "end": "2000-07-15"}))
    with pytest.raises(ValueError):
        FloodRequest(**_body(aoi, thresholdDb=5))


# ---- building blocks -------------------------------------------------------
def test_decibel_conversion():
    out = flood.to_db(np.array([1.0, 0.1, 0.01, 0.0, -1.0, np.nan], dtype=np.float32))
    assert out[:3].tolist() == pytest.approx([0.0, -10.0, -20.0], abs=1e-4)
    assert np.isnan(out[3:]).all()


def test_box_mean_ignores_missing_values():
    data = np.array([[1, 1, 1], [1, np.nan, 1], [1, 1, 10]], dtype=np.float32)
    out = flood.box_mean(data)
    assert np.isnan(out[1, 1])  # a gap is not filled in
    assert out[0, 0] == pytest.approx(1.0)  # mean of the three valid neighbours and itself
    assert out[2, 2] == pytest.approx((1 + 1 + 10) / 3)


def test_otsu_separates_two_populations_and_flags_one():
    rng = np.random.default_rng(1)
    two = np.concatenate([rng.normal(-21, 1, 3000), rng.normal(-8, 1.5, 7000)])
    threshold, separability = flood.otsu_threshold(two)
    assert -18 < threshold < -11 and separability > 0.8
    _, single = flood.otsu_threshold(rng.normal(-8, 1.5, 10_000))
    assert single < flood.MIN_SEPARABILITY  # one population: do not trust the threshold


def test_orbit_choice_prefers_full_coverage_in_every_period():
    aoi = box(0, 0, 1, 1)

    def scene(orbit, geometry):
        return Scene(f"s{orbit}", "2022-01-01T00:00:00Z", "S1", None, "", relative_orbit=orbit,
                     geometry=geometry.__geo_interface__)

    full, partial = box(-1, -1, 2, 2), box(-1, -1, 0.21, 2)  # partial covers 21% of the AOI
    before = [scene(5, full), scene(107, full)]
    during = [scene(5, full), scene(107, partial)]
    orbit, coverage = flood.choose_orbit([before, during], aoi)
    assert orbit == 5
    assert coverage[107] == pytest.approx(0.21, abs=0.01)  # judged by its worst period
    with pytest.raises(NoImagery):
        flood.choose_orbit([[scene(107, partial)], [scene(107, partial)]], aoi)


def test_composite_uses_only_the_chosen_orbit():
    grid = Grid(32643, Affine(30, 0, 0, 0, -30, 0), 30, 30)
    provider = demo.DemoProvider()
    scenes = provider.search(flood.SENTINEL1, (0, 0, 1, 1), "2020-06-01", "2020-06-30", None)
    other = Scene("other", "2020-06-09T00:00:00Z", "S1", None, "", assets={"vv": "x"}, relative_orbit=99)
    median, count, used = flood.composite(provider, [*scenes, other], 5, grid)
    assert {s.relative_orbit for s in used} == {5}
    assert count.max() == 2 and median.shape == (30, 30)
