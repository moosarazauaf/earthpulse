"""Target grids, cloud-free composites and raster outputs."""
import math
import warnings
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass

import numpy as np
import rasterio
from affine import Affine
from pyproj import Transformer
from rasterio.errors import NotGeoreferencedWarning
from rasterio.features import geometry_mask
from rasterio.io import MemoryFile
from rasterio.warp import Resampling, calculate_default_transform, reproject
from shapely.geometry.base import BaseGeometry
from shapely.ops import transform as shapely_transform

from app.datasets.catalog import Dataset, clear_mask, to_reflectance
from app.providers.base import Grid, ImageryProvider, Scene

# Scenes kept per path/row or MGRS tile. Three clear looks is the point where
# a per-pixel median can reject one bad observation.
SCENES_PER_FOOTPRINT = 3
MAX_SCENES = 12
READ_THREADS = 24


def project_geometry(geom: BaseGeometry, src_epsg: int, dst_epsg: int) -> BaseGeometry:
    transformer = Transformer.from_crs(src_epsg, dst_epsg, always_xy=True)
    return shapely_transform(transformer.transform, geom)


def build_grid(aoi_utm: BaseGeometry, epsg: int, native_res: float, max_pixels: int) -> Grid:
    """Smallest grid covering the AOI, coarsened to respect the pixel budget.

    Resolution is a whole multiple of the native pixel, so a coarsened grid
    lines up with the overview levels stored in the source files.
    """
    min_x, south, east, max_y = aoi_utm.bounds
    factor = 1
    while True:
        res = native_res * factor
        # Snap the origin to multiples of the resolution so repeated runs align.
        west = math.floor(min_x / res) * res
        north = math.ceil(max_y / res) * res
        width = max(1, math.ceil((east - west) / res))
        height = max(1, math.ceil((north - south) / res))
        if width * height <= max_pixels:
            break
        factor += 1
    return Grid(epsg, Affine(res, 0, west, 0, -res, north), width, height)


def aoi_mask(aoi_utm: BaseGeometry, grid: Grid) -> np.ndarray:
    """True for pixels whose centre lies inside the AOI."""
    return geometry_mask(
        [aoi_utm], out_shape=(grid.height, grid.width), transform=grid.transform, invert=True
    )


def select_scenes(scenes: list[Scene]) -> list[Scene]:
    """Keep the clearest few scenes from each footprint so the AOI is covered."""
    by_footprint: dict[str, list[Scene]] = defaultdict(list)
    for scene in scenes:  # already sorted least cloudy first
        if len(by_footprint[scene.footprint_key]) < SCENES_PER_FOOTPRINT:
            by_footprint[scene.footprint_key].append(scene)
    chosen: list[Scene] = []
    rank = 0
    while len(chosen) < MAX_SCENES:
        added = False
        for group in by_footprint.values():
            if rank < len(group) and len(chosen) < MAX_SCENES:
                chosen.append(group[rank])
                added = True
        if not added:
            break
        rank += 1
    return chosen


@dataclass
class Composite:
    bands: dict[str, np.ndarray]  # common band name -> reflectance, NaN where no clear data
    clear_count: np.ndarray  # clear observations per pixel
    scenes: list[Scene]


def build_composite(
    provider: ImageryProvider,
    dataset: Dataset,
    scenes: list[Scene],
    band_names: list[str],
    grid: Grid,
) -> Composite:
    """Per-pixel median of clear-sky surface reflectance across scenes."""

    # One task per file: the time goes on network round trips, not the CPU.
    assets = [dataset.qa_asset, *(dataset.bands[n] for n in band_names)]
    tasks = [(scene, asset) for scene in scenes for asset in assets]
    with ThreadPoolExecutor(max_workers=READ_THREADS) as pool:
        raw = list(pool.map(
            lambda t: provider.read(t[0], t[1], grid, categorical=t[1] == dataset.qa_asset), tasks
        ))

    results: list[tuple[dict[str, np.ndarray], np.ndarray]] = []
    for position, scene in enumerate(scenes):
        qa, *digital = raw[position * len(assets):(position + 1) * len(assets)]
        clear = clear_mask(dataset, qa)
        out: dict[str, np.ndarray] = {}
        for name, dn in zip(band_names, digital, strict=True):
            refl = to_reflectance(dataset, dn, scene.processing_baseline)
            refl[~clear] = np.nan
            out[name] = refl
        results.append((out, np.all([np.isfinite(a) for a in out.values()], axis=0)))

    clear_count = np.sum([valid for _, valid in results], axis=0).astype(np.uint8)
    bands: dict[str, np.ndarray] = {}
    for name in band_names:
        stack = np.stack([scene_bands[name] for scene_bands, _ in results])
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels stay NaN
            bands[name] = np.nanmedian(stack, axis=0).astype(np.float32)
    return Composite(bands, clear_count, scenes)


# ---- outputs ---------------------------------------------------------------
def to_geographic(data: np.ndarray, grid: Grid) -> tuple[np.ndarray, tuple[float, float, float, float]]:
    """Reproject a float raster to EPSG:4326 for display. Returns (array, w/s/e/n)."""
    west, south, east, north = grid.bounds
    transform, width, height = calculate_default_transform(
        f"EPSG:{grid.epsg}", "EPSG:4326", grid.width, grid.height, west, south, east, north
    )
    out = np.full((height, width), np.nan, dtype=np.float32)
    reproject(
        source=data.astype(np.float32),
        destination=out,
        src_transform=grid.transform,
        src_crs=f"EPSG:{grid.epsg}",
        src_nodata=np.nan,
        dst_transform=transform,
        dst_crs="EPSG:4326",
        dst_nodata=np.nan,
        resampling=Resampling.nearest,
    )
    bounds = (transform.c, transform.f + transform.e * height,
              transform.c + transform.a * width, transform.f)
    return out, bounds


def colorize(data: np.ndarray, vmin: float, vmax: float, stops: list[tuple[int, int, int]]) -> np.ndarray:
    """Map values to RGBA by linear interpolation between colour stops."""
    scaled = np.clip((data - vmin) / (vmax - vmin), 0.0, 1.0)
    positions = np.linspace(0.0, 1.0, len(stops))
    rgba = np.zeros((4, *data.shape), dtype=np.uint8)
    filled = np.nan_to_num(scaled, nan=0.0)
    for channel in range(3):
        rgba[channel] = np.interp(filled, positions, [s[channel] for s in stops]).astype(np.uint8)
    rgba[3] = np.where(np.isfinite(data), 255, 0)
    return rgba


def encode_png(rgba: np.ndarray) -> bytes:
    with warnings.catch_warnings(), MemoryFile() as memory:
        warnings.simplefilter("ignore", NotGeoreferencedWarning)  # a PNG carries no CRS
        with memory.open(driver="PNG", width=rgba.shape[2], height=rgba.shape[1],
                         count=4, dtype="uint8") as dst:
            dst.write(rgba)
        return memory.read()


def write_geotiff(path: str, data: np.ndarray, grid: Grid, description: str) -> None:
    with rasterio.open(
        path, "w", driver="GTiff", width=grid.width, height=grid.height, count=1,
        dtype="float32", crs=f"EPSG:{grid.epsg}", transform=grid.transform,
        nodata=np.nan, compress="deflate",
    ) as dst:
        dst.write(data.astype(np.float32), 1)
        dst.set_band_description(1, description)
