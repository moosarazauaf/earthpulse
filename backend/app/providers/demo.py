"""Synthetic imagery with a known answer.

Used by the test suite and for running the application offline. It is not
satellite data: `is_observed` is False and every result built on it is
labelled SIMULATED.

The scene is uniform vegetation. In any scene dated 2010 or later, a square
block covering the central third of the grid has become built-up, so the
correct change area is exactly the block.
"""
import numpy as np

from app.datasets.catalog import LANDSAT_OFFSET, LANDSAT_SCALE, Dataset
from app.providers.base import Grid, Scene

CHANGE_YEAR = 2010
# Surface reflectance of the two cover types (typical textbook values).
VEGETATION = {"blue": 0.03, "green": 0.06, "red": 0.04, "nir": 0.40, "swir1": 0.20, "swir2": 0.10}
BUILT_UP = {"blue": 0.12, "green": 0.14, "red": 0.16, "nir": 0.22, "swir1": 0.28, "swir2": 0.25}


# Typical C-band VV backscatter of land and of calm open water, in dB.
LAND_DB = -8.0
WATER_DB = -21.0


def river(grid: Grid) -> np.ndarray:
    """Permanent water along the northern edge, present in every epoch."""
    mask = np.zeros((grid.height, grid.width), dtype=bool)
    mask[: grid.height // 10] = True
    return mask


def changed_block(grid: Grid) -> np.ndarray:
    """Boolean mask of the block that changes between the two epochs."""
    mask = np.zeros((grid.height, grid.width), dtype=bool)
    mask[grid.height // 3 : 2 * grid.height // 3, grid.width // 3 : 2 * grid.width // 3] = True
    return mask


class DemoProvider:
    id = "demo"
    name = "Synthetic demo data (not satellite observations)"
    is_observed = False

    def search(self, dataset: Dataset, bbox, start: str, end: str, max_cloud: float,
               platforms: list[str] | None = None) -> list[Scene]:
        year = int(start[:4])
        return [
            Scene(
                id=f"DEMO_{dataset.id}_{year}_{n}",
                datetime=f"{year}-06-0{n + 1}T05:30:00Z",
                platform="demo",
                cloud_cover=0.0,
                footprint_key="demo",
                assets={a: f"demo://{a}" for a in [*dataset.bands.values(), dataset.qa_asset] if a},
                collection=dataset.collection,
                relative_orbit=5,
                orbit_state="descending",
                geometry={"type": "Polygon", "coordinates": [[
                    [bbox[0] - 1, bbox[1] - 1], [bbox[2] + 1, bbox[1] - 1],
                    [bbox[2] + 1, bbox[3] + 1], [bbox[0] - 1, bbox[3] + 1],
                    [bbox[0] - 1, bbox[1] - 1]]]},
            )
            for n in range(2)
        ]

    def read_static(self, layer: str, grid: Grid) -> np.ndarray:
        """Synthetic land cover: cropland, with built-up on the western half of the block."""
        classes = np.full((grid.height, grid.width), 40, dtype=np.uint8)
        block = changed_block(grid)
        block[:, grid.width // 2:] = False
        classes[block] = 50
        classes[river(grid)] = 80
        return classes

    def read(self, scene: Scene, asset: str, grid: Grid, categorical: bool) -> np.ndarray:
        shape = (grid.height, grid.width)
        if asset in ("vv", "vh"):
            # Linear power. The river is always water; the block floods from CHANGE_YEAR.
            power = np.full(shape, 10 ** (LAND_DB / 10), dtype=np.float32)
            power[river(grid)] = 10 ** (WATER_DB / 10)
            if int(scene.datetime[:4]) >= CHANGE_YEAR:
                power[changed_block(grid)] = 10 ** (WATER_DB / 10)
            return power
        if categorical:
            # Landsat QA_PIXEL "clear" bit pattern / Sentinel-2 SCL class 4 (vegetation).
            return np.full(shape, 64 if asset == "qa_pixel" else 4, dtype=np.uint16)
        common = {"nir08": "nir", "swir16": "swir1", "swir22": "swir2",
                  "B02": "blue", "B03": "green", "B04": "red", "B08": "nir",
                  "B11": "swir1", "B12": "swir2"}.get(asset, asset)
        reflectance = np.full(shape, VEGETATION[common], dtype=np.float32)
        if int(scene.datetime[:4]) >= CHANGE_YEAR:
            reflectance[changed_block(grid)] = BUILT_UP[common]
        if scene.collection == "landsat-c2-l2":
            return np.round((reflectance - LANDSAT_OFFSET) / LANDSAT_SCALE).astype(np.uint16)
        return np.round(reflectance / 0.0001).astype(np.uint16)
