import numpy as np
import pytest
from shapely.geometry import box

from app.core.errors import AOITooLarge, InvalidAOI
from app.datasets import catalog
from app.geospatial import raster
from app.geospatial.geometry import aoi_utm_epsg, geodesic_area_m2, parse_aoi, utm_epsg
from app.geospatial.indices import INDICES, compute_index, normalized_difference, required_bands
from app.providers.base import Scene


# ---- geometry --------------------------------------------------------------
def test_geodesic_area_of_one_degree_cell_at_equator():
    # 1 deg of longitude at the equator is 111.320 km and 1 deg of latitude is
    # 110.574 km on WGS84, so the cell is about 12 309 km2.
    area_km2 = geodesic_area_m2(box(0, 0, 1, 1)) / 1e6
    assert area_km2 == pytest.approx(12_309, rel=0.002)


def test_area_shrinks_with_latitude_unlike_degrees():
    equator = geodesic_area_m2(box(0, 0, 1, 1))
    north = geodesic_area_m2(box(0, 60, 1, 61))
    assert north / equator == pytest.approx(0.49, abs=0.02)  # roughly cos(60.5 deg)


def test_utm_zones():
    assert utm_epsg(74.35, 31.52) == 32643  # Lahore
    assert utm_epsg(-58.4, -34.6) == 32721  # Buenos Aires
    assert utm_epsg(179.99, 10) == 32660
    assert aoi_utm_epsg(box(74.3, 31.4, 74.4, 31.5)) == 32643


def test_parse_aoi_accepts_feature_and_rejects_bad_input(aoi):
    assert parse_aoi({"type": "Feature", "geometry": aoi, "properties": {}}).is_valid
    with pytest.raises(InvalidAOI):
        parse_aoi({"type": "Point", "coordinates": [74, 31]})
    with pytest.raises(InvalidAOI):  # projected metres, not degrees
        parse_aoi({"type": "Polygon", "coordinates": [[[400000, 3400000], [410000, 3400000],
                                                        [410000, 3410000], [400000, 3400000]]]})
    bowtie = {"type": "Polygon", "coordinates": [[[0, 0], [1, 1], [1, 0], [0, 1], [0, 0]]]}
    with pytest.raises(InvalidAOI):
        parse_aoi(bowtie)


def test_parse_aoi_enforces_area_limit(aoi):
    with pytest.raises(AOITooLarge):
        parse_aoi(aoi, max_km2=50)
    assert parse_aoi(aoi, max_km2=200) is not None


# ---- indices ---------------------------------------------------------------
def test_normalized_difference_values():
    a = np.array([0.4, 0.1, 0.0, np.nan], dtype=np.float32)
    b = np.array([0.1, 0.4, 0.0, 0.2], dtype=np.float32)
    out = normalized_difference(a, b)
    assert out[0] == pytest.approx(0.6)
    assert out[1] == pytest.approx(-0.6)
    assert np.isnan(out[2])  # zero sum
    assert np.isnan(out[3])  # missing input


def test_index_never_leaves_valid_range():
    rng = np.random.default_rng(0)
    a, b = rng.uniform(-0.1, 1, 1000), rng.uniform(-0.1, 1, 1000)
    out = normalized_difference(a, b)
    finite = out[np.isfinite(out)]
    assert finite.min() >= -1 and finite.max() <= 1


def test_index_definitions_use_the_published_bands():
    assert INDICES["ndvi"].bands == ("nir", "red")
    assert INDICES["ndwi"].bands == ("green", "nir")
    assert INDICES["mndwi"].bands == ("green", "swir1")
    assert INDICES["ndbi"].bands == ("swir1", "nir")
    bands = {"nir": np.array([0.5]), "red": np.array([0.1]),
             "green": np.array([0.1]), "swir1": np.array([0.3])}
    assert compute_index("ndvi", bands)[0] == pytest.approx(0.6667, abs=1e-3)
    assert compute_index("ndbi", bands)[0] == pytest.approx(-0.25)
    assert required_bands(["ndvi", "ndwi"]) == ["nir", "red", "green"]


# ---- dataset scaling and masks ---------------------------------------------
def test_landsat_scaling_and_fill():
    dn = np.array([0, 7273, 43636], dtype=np.uint16)
    refl = catalog.to_reflectance(catalog.LANDSAT, dn, None)
    assert np.isnan(refl[0])
    assert refl[1] == pytest.approx(0.0, abs=1e-4)
    assert refl[2] == pytest.approx(1.0, abs=1e-4)


def test_sentinel2_offset_applies_only_from_baseline_4():
    dn = np.array([2000], dtype=np.uint16)
    assert catalog.to_reflectance(catalog.SENTINEL2, dn, 3.01)[0] == pytest.approx(0.2)
    assert catalog.to_reflectance(catalog.SENTINEL2, dn, 5.13)[0] == pytest.approx(0.1)


def test_cloud_masks():
    # Landsat QA_PIXEL: 21824 clear, bit 3 cloud, bit 4 shadow, bit 0 fill.
    qa = np.array([21824, 21824 | 8, 21824 | 16, 1], dtype=np.uint16)
    assert catalog.clear_mask(catalog.LANDSAT, qa).tolist() == [True, False, False, False]
    scl = np.array([4, 5, 6, 9, 3, 0], dtype=np.uint8)
    assert catalog.clear_mask(catalog.SENTINEL2, scl).tolist() == [True, True, True, False, False, False]


def test_landsat_platform_rules():
    assert catalog.landsat_platforms(1993) == (["landsat-4", "landsat-5"], None)
    assert catalog.landsat_platforms(2008)[0] == ["landsat-5"]  # avoids striped Landsat 7
    platforms, note = catalog.landsat_platforms(2012)
    assert platforms == ["landsat-7"] and "striped" in note
    assert catalog.landsat_platforms(2026)[0] == ["landsat-8", "landsat-9"]


# ---- grids and scene selection ---------------------------------------------
def test_grid_respects_pixel_budget_with_whole_multiples():
    aoi = box(400_000, 3_400_000, 460_000, 3_460_000)  # 60 km square
    full = raster.build_grid(aoi, 32643, 30, 10_000_000)
    assert full.resolution == 30 and 2000 <= full.width <= 2002  # origin snaps to the grid
    coarse = raster.build_grid(aoi, 32643, 30, 1_000_000)
    assert coarse.resolution % 30 == 0 and coarse.resolution > 30
    assert coarse.width * coarse.height <= 1_000_000
    west, south, east, north = coarse.bounds
    assert west <= 400_000 and east >= 460_000 and south <= 3_400_000 and north >= 3_460_000


def test_scene_selection_covers_every_footprint():
    scenes = [Scene(f"a{i}", "2020-01-01T00:00:00Z", "p", float(i), "148/38") for i in range(10)]
    scenes += [Scene("b0", "2020-01-01T00:00:00Z", "p", 19.0, "149/38")]
    chosen = raster.select_scenes(scenes)
    assert {s.footprint_key for s in chosen} == {"148/38", "149/38"}
    assert len(chosen) == raster.SCENES_PER_FOOTPRINT + 1
    assert chosen[0].id == "a0"  # clearest first


def test_reprojection_to_geographic_keeps_data_and_orientation():
    grid = raster.build_grid(box(400_000, 3_480_000, 409_000, 3_489_000), 32643, 30, 10_000_000)
    data = np.zeros((grid.height, grid.width), dtype=np.float32)
    data[: grid.height // 2] = 1.0  # northern half
    out, (west, south, east, north) = raster.to_geographic(data, grid)
    assert 73 < west < east < 75 and 31 < south < north < 32
    assert np.nanmean(out[: out.shape[0] // 3]) > 0.9
    assert np.nanmean(out[-out.shape[0] // 3 :]) < 0.1
