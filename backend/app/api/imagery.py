"""Imagery layer metadata and the tile proxy."""
import asyncio
from pathlib import Path

import httpx
import numpy as np
from fastapi import APIRouter, Query
from fastapi import Path as PathParam
from fastapi.responses import Response

from app.core import http
from app.core.config import get_settings
from app.core.errors import UpstreamUnavailable
from app.datasets.catalog import get_dataset
from app.geospatial.raster import encode_png
from app.services import imagery

router = APIRouter(prefix="/api/imagery", tags=["imagery"])

TRANSPARENT_TILE = encode_png(np.zeros((4, 1, 1), dtype=np.uint8))
# Annual mosaics of past years do not change; the current year can.
CACHE_HEADERS = {"Cache-Control": "public, max-age=86400"}
MAX_TILE_INDEX_ZOOM = 16

_async_client: httpx.AsyncClient | None = None


def _client() -> httpx.AsyncClient:
    global _async_client
    if _async_client is None:
        _async_client = httpx.AsyncClient(
            timeout=httpx.Timeout(45.0, connect=10.0),
            headers={"User-Agent": http.USER_AGENT},
            follow_redirects=False,
        )
    return _async_client


@router.get("/layer")
def layer(
    dataset: str = Query(pattern="^(landsat|sentinel2)$"),
    year: int = Query(ge=1982, le=2100),
    render: str = Query(default="truecolor", pattern="^[a-z]+$", max_length=12),
) -> dict:
    return imagery.describe(dataset, year, render)


def _png(body: bytes) -> Response:
    return Response(body, media_type="image/png", headers=CACHE_HEADERS)


@router.get("/tiles/{dataset}/{year}/{render}/{z}/{x}/{y}.png")
async def tile(
    dataset: str = PathParam(pattern="^(landsat|sentinel2)$"),
    year: int = PathParam(ge=1982, le=2100),
    render: str = PathParam(pattern="^[a-z]+$", max_length=12),
    z: int = PathParam(ge=0, le=MAX_TILE_INDEX_ZOOM),
    x: int = PathParam(ge=0),
    y: int = PathParam(ge=0),
) -> Response:
    ds = get_dataset(dataset)
    imagery.check(ds, year, render)
    if z < imagery.MIN_ZOOM or z > imagery.MAX_ZOOM[ds.id] or max(x, y) >= 2**z:
        return _png(TRANSPARENT_TILE)

    cache: Path = get_settings().data_dir / "tiles" / ds.id / str(year) / render / str(z) / str(x)
    cached = cache / f"{y}.png"
    if cached.exists():
        return _png(cached.read_bytes())

    # Registration is a blocking call made once per dataset-year.
    url = await asyncio.to_thread(imagery.tile_url, ds, year, z, x, y)
    http.require_allowed(url)
    try:
        upstream = await _client().get(url, params=imagery.upstream_params(ds, year, render))
    except httpx.HTTPError as exc:
        raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.") from exc
    if upstream.status_code in (204, 404):
        return _png(TRANSPARENT_TILE)  # no scene covers this tile
    if upstream.status_code != 200:
        raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
    cache.mkdir(parents=True, exist_ok=True)
    cached.write_bytes(upstream.content)
    return _png(upstream.content)
