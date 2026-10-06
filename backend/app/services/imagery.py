"""Annual imagery layers for the globe.

Tiles are rendered by Planetary Computer's mosaic service from a STAC search
that this module registers. The browser only ever sees EarthPulse tile URLs,
and every upstream parameter comes from the presets below, never from the
caller.
"""
import threading
from typing import Any

from app.core import http
from app.core.errors import DatasetUnavailable, UpstreamUnavailable
from app.datasets.catalog import (
    LANDSAT_OFFSET,
    LANDSAT_SCALE,
    S2_OFFSET_DN,
    S2_OFFSET_START_YEAR,
    Dataset,
    get_dataset,
    landsat_platforms,
)
from app.geospatial.indices import INDICES

MOSAIC_REGISTER = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic/register"
MOSAIC_TILE = ("https://planetarycomputer.microsoft.com/api/data/v1/mosaic/{search}/tiles/"
               "WebMercatorQuad/{z}/{x}/{y}@1x")
# Below this zoom one tile needs dozens of scenes; the mosaic service is too
# slow to be useful there, so the layer simply starts at regional scale.
MIN_ZOOM = 7
MAX_ZOOM = {"landsat": 13, "sentinel2": 14}
LAYER_MAX_CLOUD = 20

# Legend colours approximating the matplotlib colormaps requested upstream.
COLORMAPS = {
    "rdylgn": ["#a50026", "#f46d43", "#fee08b", "#ffffbf", "#a6d96a", "#1a9850", "#006837"],
    "rdbu": ["#67001f", "#d6604d", "#fddbc7", "#f7f7f7", "#92c5de", "#2166ac", "#053061"],
    "brbg_r": ["#003c30", "#35978f", "#c7eae5", "#f5f5f5", "#dfc27d", "#8c510a", "#543005"],
}
# index id -> (colormap, min, max)
INDEX_STYLE = {
    "ndvi": ("rdylgn", -0.2, 0.8),
    "ndwi": ("rdbu", -0.5, 0.5),
    "mndwi": ("rdbu", -0.5, 0.5),
    "ndbi": ("brbg_r", -0.4, 0.4),
}
RENDERS = ("truecolor", "falsecolor", *INDICES)

_searches: dict[tuple[str, int], str] = {}
_lock = threading.Lock()


def _landsat_dn(reflectance: float) -> int:
    return round((reflectance - LANDSAT_OFFSET) / LANDSAT_SCALE)


def _s2_offset(year: int) -> int:
    return -S2_OFFSET_DN if year >= S2_OFFSET_START_YEAR else 0


def check(dataset: Dataset, year: int, render: str) -> None:
    if render not in RENDERS:
        raise DatasetUnavailable(f"Unknown rendering '{render}'.")
    if year < dataset.first_year:
        raise DatasetUnavailable(
            f"{dataset.name} does not cover {year}.",
            hint=f"It starts in {dataset.first_year}.",
        )


def search_id(dataset: Dataset, year: int) -> str:
    """Register (once) the STAC search behind a year's mosaic."""
    key = (dataset.id, year)
    with _lock:
        if key in _searches:
            return _searches[key]
    filters: list[dict[str, Any]] = [
        {"op": "anyinteracts", "args": [
            {"property": "datetime"},
            {"interval": [f"{year}-01-01T00:00:00Z", f"{year}-12-31T23:59:59Z"]},
        ]},
        {"op": "<=", "args": [{"property": "eo:cloud_cover"}, LAYER_MAX_CLOUD]},
    ]
    if dataset.id == "landsat":
        platforms, _ = landsat_platforms(year)
        filters.append({"op": "in", "args": [{"property": "platform"}, platforms]})
    body = {
        "collections": [dataset.collection],
        "filter-lang": "cql2-json",
        "filter": {"op": "and", "args": filters},
        "sortby": [{"field": "eo:cloud_cover", "direction": "asc"}],
    }
    response = http.request("POST", MOSAIC_REGISTER, json=body)
    if response.status_code != 200:
        raise UpstreamUnavailable("Satellite imagery is temporarily unavailable.")
    found = response.json()["searchid"]
    with _lock:
        _searches[key] = found
    return found


def upstream_params(dataset: Dataset, year: int, render: str) -> list[tuple[str, str]]:
    """Query parameters for the mosaic tile endpoint."""
    params: list[tuple[str, str]] = [("collection", dataset.collection), ("nodata", "0"),
                                     ("format", "png")]
    bands = dataset.bands
    if render in ("truecolor", "falsecolor"):
        names = ("red", "green", "blue") if render == "truecolor" else ("nir", "red", "green")
        params += [("assets", bands[n]) for n in names]
        top = 0.3 if render == "truecolor" else 0.45  # reflectance mapped to white
        if dataset.id == "landsat":
            low, high = _landsat_dn(0.0), _landsat_dn(top)
        else:
            low, high = _s2_offset(year), round(top * 10_000) + _s2_offset(year)
        params += [("rescale", f"{low},{high}"), ("color_formula", "gamma RGB 1.6")]
        return params
    index = INDICES[render]
    a, b = bands[index.positive], bands[index.negative]
    # The reflectance offset cancels in the numerator but not in the sum.
    if dataset.id == "landsat":
        correction = 2 * LANDSAT_OFFSET / LANDSAT_SCALE  # negative
    else:
        correction = -2 * _s2_offset(year)
    denominator = f"({a}+{b}{correction:+.4f})" if correction else f"({a}+{b})"
    colormap, low, high = INDEX_STYLE[render]
    params += [("expression", f"({a}-{b})/{denominator}"), ("asset_as_band", "true"),
               ("rescale", f"{low},{high}"), ("colormap_name", colormap)]
    return params


def tile_url(dataset: Dataset, year: int, z: int, x: int, y: int) -> str:
    return MOSAIC_TILE.format(search=search_id(dataset, year), z=z, x=x, y=y)


def describe(dataset_id: str, year: int, render: str) -> dict[str, Any]:
    """Layer metadata for the client: tile template, legend and provenance."""
    dataset = get_dataset(dataset_id)
    check(dataset, year, render)
    note = landsat_platforms(year)[1] if dataset.id == "landsat" else None
    layer: dict[str, Any] = {
        "id": f"{dataset.id}-{year}-{render}",
        "dataset": dataset.public(),
        "year": year,
        "render": render,
        "tileUrl": f"/api/imagery/tiles/{dataset.id}/{year}/{render}/{{z}}/{{x}}/{{y}}.png",
        "minZoom": MIN_ZOOM,
        "maxZoom": MAX_ZOOM[dataset.id],
        "compositing": (
            f"Mosaic of {year} scenes with at most {LAYER_MAX_CLOUD}% cloud, least cloudy scene "
            "on top. Scenes are not cloud-masked per pixel, so some cloud can remain."
        ),
        "note": note,
    }
    if render in INDICES:
        index = INDICES[render]
        colormap, low, high = INDEX_STYLE[render]
        layer.update(
            valueKind="DERIVED",
            title=f"{index.name} {year}",
            description=f"{index.measures}. {index.formula}; {index.reference}.",
            legend={"min": low, "max": high, "colors": COLORMAPS[colormap]},
        )
    else:
        composite = "red, green, blue" if render == "truecolor" else "near-infrared, red, green"
        layer.update(
            valueKind="OBSERVED",
            title=f"{dataset.name.split(' ')[0]} {year} {'true' if render == 'truecolor' else 'false'} colour",
            description=f"Surface reflectance shown as {composite}.",
            legend=None,
        )
    return layer
