"""Dataset catalogue, index definitions and place search."""
import threading
from typing import Any

from fastapi import APIRouter, Depends, Query

from app.core import http
from app.core.config import SOFTWARE_VERSION
from app.core.errors import UpstreamUnavailable
from app.core.ratelimit import limit_analysis
from app.datasets.catalog import DATASETS, SENTINEL1, WORLDCOVER
from app.geospatial.indices import INDICES
from app.services.imagery import RENDERS

router = APIRouter(prefix="/api", tags=["catalog"])

NOMINATIM = "https://nominatim.openstreetmap.org/search"
GEOCODE_CACHE_SIZE = 500

_geocode_cache: dict[str, list[dict[str, Any]]] = {}
_lock = threading.Lock()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "version": SOFTWARE_VERSION}


@router.get("/datasets")
def datasets() -> dict[str, Any]:
    return {
        "datasets": [d.public() for d in (*DATASETS.values(), SENTINEL1)],
        "referenceLayers": [WORLDCOVER],
        "indices": [
            {"id": i.id, "name": i.name, "formula": i.formula, "measures": i.measures,
             "reference": i.reference, "defaultThreshold": i.default_threshold}
            for i in INDICES.values()
        ],
        "renders": list(RENDERS),
        "processing": {
            "provider": "Microsoft Planetary Computer",
            "url": "https://planetarycomputer.microsoft.com/",
            "note": "Public STAC catalogue of cloud-optimised GeoTIFFs; no account required.",
        },
    }


@router.get("/geocode", dependencies=[Depends(limit_analysis)])
def geocode(q: str = Query(min_length=2, max_length=120)) -> dict[str, Any]:
    """Place search through OpenStreetMap Nominatim, cached to respect its usage policy."""
    key = q.strip().lower()
    with _lock:
        if key in _geocode_cache:
            return {"results": _geocode_cache[key], "attribution": "© OpenStreetMap contributors"}
    response = http.request("GET", NOMINATIM,
                            params={"q": q, "format": "jsonv2", "limit": 6, "addressdetails": 0})
    if response.status_code != 200:
        raise UpstreamUnavailable("Place search is temporarily unavailable.")
    results = []
    for item in response.json():
        south, north, west, east = (float(v) for v in item["boundingbox"])
        results.append({
            "name": item.get("display_name", ""),
            "lat": float(item["lat"]),
            "lon": float(item["lon"]),
            "bbox": [west, south, east, north],
            "kind": item.get("addresstype") or item.get("type") or "",
        })
    with _lock:
        if len(_geocode_cache) >= GEOCODE_CACHE_SIZE:
            _geocode_cache.pop(next(iter(_geocode_cache)))
        _geocode_cache[key] = results
    return {"results": results, "attribution": "© OpenStreetMap contributors"}
