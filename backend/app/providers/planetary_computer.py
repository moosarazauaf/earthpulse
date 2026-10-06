"""Microsoft Planetary Computer: public STAC search and cloud-optimised GeoTIFFs.

No account is needed. Asset URLs must carry a short-lived read token, which
the public signing endpoint issues per collection.
"""
import math
import threading
import time
from datetime import UTC, datetime

import numpy as np
import rasterio
from affine import Affine
from rasterio.crs import CRS
from rasterio.enums import Resampling
from rasterio.errors import WindowError
from rasterio.warp import reproject, transform_bounds
from rasterio.windows import Window, from_bounds

from app.core import http
from app.core.errors import NoImagery, UpstreamUnavailable
from app.datasets.catalog import Dataset
from app.providers.base import Grid, Scene

STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search"
SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/{collection}"
# One page is enough: the engine keeps only a few scenes per footprint.
SEARCH_LIMIT = 250
# Renew a token this long before it expires.
TOKEN_MARGIN_SECONDS = 300
TOKEN_ATTEMPTS = 4

# GDAL settings for reading COGs over HTTP without directory listings.
GDAL_ENV = {
    "GDAL_DISABLE_READDIR_ON_OPEN": "EMPTY_DIR",
    "CPL_VSIL_CURL_ALLOWED_EXTENSIONS": ".tif,.TIF,.tiff",
    "GDAL_HTTP_MAX_RETRY": "3",
    "GDAL_HTTP_RETRY_DELAY": "1",
    "GDAL_HTTP_TIMEOUT": "60",
    "VSI_CACHE": "TRUE",
    # Fetch neighbouring blocks in one request instead of one request each.
    "GDAL_HTTP_MERGE_CONSECUTIVE_RANGES": "YES",
    # Read the whole COG header in the first request.
    "GDAL_INGESTED_BYTES_AT_OPEN": "65536",
}
# Source pixels read beyond the grid edge so resampling has neighbours.
WINDOW_PAD = 2
# Length of a degree of latitude; adequate for choosing an overview level.
METRES_PER_DEGREE = 111_320.0
# Reference layers: name -> (collection, asset, id fragment selecting the version).
STATIC_LAYERS = {"worldcover": ("esa-worldcover", "map", "2021_v200")}


class PlanetaryComputerProvider:
    id = "planetary-computer"
    name = "Microsoft Planetary Computer"
    is_observed = True

    def __init__(self) -> None:
        self._tokens: dict[str, tuple[str, float]] = {}
        self._lock = threading.Lock()

    # ---- search ------------------------------------------------------------
    def search(
        self,
        dataset: Dataset,
        bbox: tuple[float, float, float, float],
        start: str,
        end: str,
        max_cloud: float | None,
        platforms: list[str] | None = None,
    ) -> list[Scene]:
        query: dict = {}
        sort_field = "properties.datetime"
        if max_cloud is not None:
            query["eo:cloud_cover"] = {"lte": max_cloud}
            sort_field = "properties.eo:cloud_cover"
        if platforms:
            query["platform"] = {"in": platforms}
        body = {
            "collections": [dataset.collection],
            "bbox": list(bbox),
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "query": query,
            "sortby": [{"field": sort_field, "direction": "asc"}],
            "limit": SEARCH_LIMIT,
        }
        response = http.request("POST", STAC_SEARCH, json=body)
        if response.status_code != 200:
            raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
        return [self._scene(dataset, f) for f in response.json().get("features", [])]

    @staticmethod
    def _scene(dataset: Dataset, feature: dict) -> Scene:
        props = feature["properties"]
        if dataset.id == "landsat":
            key = f"{props.get('landsat:wrs_path')}/{props.get('landsat:wrs_row')}"
        elif dataset.id == "sentinel1":
            key = f"orbit {props.get('sat:relative_orbit')}"
        else:
            key = str(props.get("s2:mgrs_tile"))
        wanted = [a for a in (*dataset.bands.values(), dataset.qa_asset) if a]
        assets = {
            name: feature["assets"][name]["href"]
            for name in wanted
            if name in feature["assets"]
        }
        baseline = props.get("s2:processing_baseline")
        return Scene(
            id=feature["id"],
            datetime=props["datetime"],
            platform=props.get("platform", ""),
            cloud_cover=props.get("eo:cloud_cover"),
            footprint_key=key,
            assets=assets,
            processing_baseline=float(baseline) if baseline else None,
            collection=dataset.collection,
            relative_orbit=props.get("sat:relative_orbit"),
            orbit_state=props.get("sat:orbit_state"),
            geometry=feature.get("geometry"),
        )

    # ---- read --------------------------------------------------------------
    def _token(self, collection: str) -> str:
        """Read token for a collection's storage, fetched once and shared.

        The lock is held across the request on purpose: the signing endpoint
        is rate limited, and a burst of reader threads must not each ask.
        """
        with self._lock:
            cached = self._tokens.get(collection)
            if cached and cached[1] - time.time() > TOKEN_MARGIN_SECONDS:
                return cached[0]
            for attempt in range(TOKEN_ATTEMPTS):
                response = http.client().get(SAS_TOKEN.format(collection=collection))
                if response.status_code == 200:
                    break
                time.sleep(2.0 * (attempt + 1))  # 429 from the signing endpoint clears quickly
            else:
                raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
            data = response.json()
            expiry = datetime.fromisoformat(data["msft:expiry"].replace("Z", "+00:00"))
            self._tokens[collection] = (data["token"], expiry.astimezone(UTC).timestamp())
            return data["token"]

    def read(self, scene: Scene, asset: str, grid: Grid, categorical: bool) -> np.ndarray:
        href = scene.assets.get(asset)
        if not href:
            raise NoImagery(f"Scene {scene.id} has no '{asset}' band.")
        return self._read_href(href, scene.collection, grid, categorical)

    def read_static(self, layer: str, grid: Grid) -> np.ndarray:
        """Mosaic the tiles of a reference layer that cover the grid."""
        collection, asset, version = STATIC_LAYERS[layer]
        west, south, east, north = transform_bounds(
            CRS.from_epsg(grid.epsg), CRS.from_epsg(4326), *grid.bounds, densify_pts=21)
        response = http.request("POST", STAC_SEARCH, json={
            "collections": [collection], "bbox": [west, south, east, north], "limit": 50})
        if response.status_code != 200:
            raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
        tiles = [f["assets"][asset]["href"] for f in response.json().get("features", [])
                 if version in f["id"]]
        out: np.ndarray | None = None
        for href in tiles:
            part = self._read_href(href, collection, grid, categorical=True)
            out = part if out is None else np.where(out == 0, part, out)  # 0 is no data
        if out is None:
            raise NoImagery("The reference layer does not cover this area.")
        return out

    def _read_href(self, href: str, collection: str, grid: Grid, categorical: bool) -> np.ndarray:
        """Read the part of a file under the grid, then resample onto the grid.

        The window is read at roughly the grid's resolution, which lets GDAL
        serve it from the file's overviews instead of fetching full-resolution
        blocks over the network.
        """
        http.require_allowed(href)
        url = f"/vsicurl/{href}?{self._token(collection)}"
        resampling = Resampling.nearest if categorical else Resampling.bilinear
        dst_crs = CRS.from_epsg(grid.epsg)
        try:
            with rasterio.Env(**GDAL_ENV), rasterio.open(url) as src:
                fill = src.nodata if src.nodata is not None else 0
                out = np.full((grid.height, grid.width), fill, dtype=src.dtypes[0])
                bounds = grid.bounds
                if src.crs != dst_crs:
                    bounds = transform_bounds(dst_crs, src.crs, *bounds, densify_pts=21)
                window = from_bounds(*bounds, transform=src.transform)
                window = Window(window.col_off - WINDOW_PAD, window.row_off - WINDOW_PAD,
                                window.width + 2 * WINDOW_PAD, window.height + 2 * WINDOW_PAD)
                try:
                    window = window.intersection(Window(0, 0, src.width, src.height))
                except WindowError:
                    return out  # the scene does not reach this grid
                window = window.round_offsets().round_lengths()
                if window.width < 1 or window.height < 1:
                    return out
                # Source pixel size in metres (geographic rasters are in degrees).
                source_res = src.res[0] * (METRES_PER_DEGREE if src.crs.is_geographic else 1.0)
                step = max(1, int(grid.resolution // source_res))
                shape = (max(1, math.ceil(window.height / step)),
                         max(1, math.ceil(window.width / step)))
                data = src.read(1, window=window, out_shape=shape, resampling=resampling)
                transform = src.window_transform(window) @ Affine.scale(
                    window.width / shape[1], window.height / shape[0])
                reproject(
                    source=data, destination=out,
                    src_transform=transform, src_crs=src.crs, src_nodata=fill,
                    dst_transform=grid.transform, dst_crs=dst_crs, dst_nodata=fill,
                    resampling=resampling,
                )
                return out
        except rasterio.errors.RasterioError as exc:
            raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.") from exc
