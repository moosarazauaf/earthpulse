"""End-to-end analysis on the synthetic provider, where the right answer is known."""
import pytest

from app.core.config import get_settings
from app.core.errors import DatasetUnavailable
from app.datasets.catalog import LANDSAT, SENTINEL2
from app.gee.generator import NotReproducible, gee_asset_id, generate_change_script
from app.models import ChangeRequest, TimeSeriesRequest
from app.providers import demo
from app.services import change_detection, imagery, timeseries

VEG_NDVI = (0.40 - 0.04) / (0.40 + 0.04)
BUILT_NDVI = (0.22 - 0.16) / (0.22 + 0.16)


def _run_change(body, **overrides):
    stages = []
    request = ChangeRequest(**{**body, **overrides})
    result = change_detection.run(request, "EP-2026-TEST-00000", get_settings(), stages.append)
    return result, stages


def test_change_detection_recovers_the_known_block(demo_change_body):
    result, stages = _run_change(demo_change_body)
    assert stages == ["ACQUIRING_DATA", "PROCESSING_IMAGERY", "CALCULATING_INDICES",
                      "DETECTING_CHANGE", "GENERATING_RESULTS"]
    summary, prov = result["summary"], result["provenance"]
    assert result["valueKind"] == "SIMULATED"  # demo data is never called observed

    width, height = prov["gridSize"]
    res = prov["workingResolutionM"]
    block_px = (2 * height // 3 - height // 3) * (2 * width // 3 - width // 3)
    assert summary["lossAreaHa"] == pytest.approx(block_px * res * res / 10_000, rel=0.03)
    assert summary["gainAreaHa"] == 0

    assert summary["before"]["mean"] == pytest.approx(VEG_NDVI, abs=0.01)
    largest = result["detections"]["features"][0]["properties"]
    assert largest["direction"] == "decrease"
    assert largest["before"] == pytest.approx(VEG_NDVI, abs=0.01)
    assert largest["after"] == pytest.approx(BUILT_NDVI, abs=0.01)
    assert largest["areaHa"] == pytest.approx(summary["lossAreaHa"], rel=0.03)
    assert largest["clearObservationsBefore"] == 2


def test_analysed_area_matches_geodesic_aoi_area(demo_change_body):
    result, _ = _run_change(demo_change_body)
    summary = result["summary"]
    # Pixel-count area in UTM against the ellipsoidal area of the polygon.
    assert summary["analysedAreaHa"] == pytest.approx(summary["aoiAreaHa"], rel=0.01)
    assert summary["validFraction"] == pytest.approx(1.0)


def test_other_indices_and_sentinel2_encoding(demo_change_body):
    body = {**demo_change_body, "dataset": "sentinel2",
            "before": {"start": "2017-01-01", "end": "2017-12-31"}}
    # Both epochs are after the synthetic change year, so nothing changes.
    result, _ = _run_change(body)
    assert result["summary"]["lossAreaHa"] == 0
    # AOI mean NDBI: one ninth built-up block, the rest vegetation.
    expected = ((0.28 - 0.22) / 0.50 + 8 * (0.20 - 0.40) / 0.60) / 9
    assert result["indices"]["ndbi"]["before"] == pytest.approx(expected, abs=0.02)

    result, _ = _run_change(demo_change_body, index="ndbi")
    assert result["summary"]["gainAreaHa"] > 0  # built-up index rises on the block


def test_threshold_sensitivity_and_min_area(demo_change_body):
    result, _ = _run_change(demo_change_body, threshold=0.9)  # larger than the real change
    assert result["summary"]["lossAreaHa"] == 0
    assert result["detections"]["features"] == []
    result, _ = _run_change(demo_change_body, minAreaHa=10_000)
    assert result["detections"]["features"] == []  # block is smaller than the minimum
    assert result["summary"]["lossAreaHa"] > 0  # the area total is unaffected by the filter


def test_request_validation(demo_change_body):
    with pytest.raises(ValueError):
        ChangeRequest(**{**demo_change_body, "after": demo_change_body["before"]})
    with pytest.raises(ValueError):
        ChangeRequest(**{**demo_change_body,
                         "before": {"start": "1999-01-01", "end": "2001-06-01"}})
    with pytest.raises(ValueError):
        ChangeRequest(**{**demo_change_body, "unexpected": 1})


def test_timeseries_reports_gaps_instead_of_filling_them(aoi):
    request = TimeSeriesRequest(aoi=aoi, dataset="sentinel2", years=[2000, 2018, 2020],
                                provider="demo")
    result = timeseries.run(request, "EP-2026-TEST-00001", get_settings(), lambda _: None)
    first, second, third = result["series"]
    assert first["status"] == "NO_DATA" and first["values"] is None  # before Sentinel-2
    assert second["status"] == "SIMULATED"
    assert second["values"]["ndvi"] == pytest.approx(third["values"]["ndvi"], abs=1e-6)


def test_demo_block_is_one_ninth_of_grid():
    from affine import Affine

    from app.providers.base import Grid

    grid = Grid(32643, Affine(30, 0, 0, 0, -30, 0), 90, 90)
    assert demo.changed_block(grid).sum() == 900


# ---- Earth Engine script ---------------------------------------------------
def test_scene_ids_map_to_earth_engine_assets():
    assert gee_asset_id("LT05_L2SP_148038_19931230_02_T1") == (
        "LANDSAT/LT05/C02/T1_L2/LT05_148038_19931230", "tm")
    assert gee_asset_id("LC09_L2SP_149038_20260110_02_T1")[1] == "oli"
    assert gee_asset_id("S2C_MSIL2A_20261003T053651_R005_T43SDR_20261003T101308") == (
        "COPERNICUS/S2_SR_HARMONIZED/20261003T053651_20261003T101308_T43SDR", "s2")
    with pytest.raises(NotReproducible):
        gee_asset_id("DEMO_landsat_2000_0")


def test_script_refuses_simulated_data_and_carries_real_parameters(demo_change_body):
    result, _ = _run_change(demo_change_body)
    with pytest.raises(NotReproducible):
        generate_change_script(result)

    # Swap in real scene ids to exercise the generator itself.
    result["provenance"]["provider"]["observed"] = True
    result["provenance"]["scenes"] = {
        "before": [{"id": "LT05_L2SP_148038_19931230_02_T1"}],
        "after": [{"id": "LC09_L2SP_149038_20260110_02_T1"}],
    }
    script = generate_change_script(result)
    assert "LANDSAT/LT05/C02/T1_L2/LT05_148038_19931230" in script
    assert "function prep_tm" in script and "function prep_oli" in script
    assert "'SR_B4', 'SR_B3'" in script and "'SR_B5', 'SR_B4'" in script  # NIR, red per sensor
    assert "change.lte(-0.15)" in script and result["id"] in script


# ---- imagery layer presets -------------------------------------------------
def test_index_tile_expression_corrects_for_reflectance_offset():
    params = dict(imagery.upstream_params(LANDSAT, 1993, "ndvi"))
    assert params["expression"] == "(nir08-red)/(nir08+red-14545.4545)"
    assert dict(imagery.upstream_params(SENTINEL2, 2018, "ndvi"))["expression"] == "(B08-B04)/(B08+B04)"
    assert dict(imagery.upstream_params(SENTINEL2, 2026, "ndvi"))["expression"] == (
        "(B08-B04)/(B08+B04-2000.0000)")


def test_layer_description_is_honest_about_kind_and_coverage():
    assert imagery.describe("landsat", 1993, "truecolor")["valueKind"] == "OBSERVED"
    assert imagery.describe("landsat", 1993, "ndvi")["valueKind"] == "DERIVED"
    assert imagery.describe("landsat", 2012, "truecolor")["note"]
    with pytest.raises(DatasetUnavailable):
        imagery.describe("sentinel2", 2005, "truecolor")
