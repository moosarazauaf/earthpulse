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
        max_cloud: float,
        platforms: list[str] | None = None,
    ) -> list[Scene]:
        query: dict = {"eo:cloud_cover": {"lte": max_cloud}}
        if platforms:
            query["platform"] = {"in": platforms}
        body = {
            "collections": [dataset.collection],
            "bbox": list(bbox),
            "datetime": f"{start}T00:00:00Z/{end}T23:59:59Z",
            "query": query,
            "sortby": [{"field": "properties.eo:cloud_cover", "direction": "asc"}],
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
        else:
            key = str(props.get("s2:mgrs_tile"))
        wanted = [*dataset.bands.values(), dataset.qa_asset]
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
        """Read the part of an asset under the grid, then resample onto the grid.

        The window is read at roughly the grid's resolution, which lets GDAL
        serve it from the file's overviews instead of fetching full-resolution
        blocks over the network.
        """
        href = scene.assets.get(asset)
        if not href:
            raise NoImagery(f"Scene {scene.id} has no '{asset}' band.")
        http.require_allowed(href)
        url = f"/vsicurl/{href}?{self._token(scene.collection)}"
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
                step = max(1, int(grid.resolution // src.res[0]))
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
