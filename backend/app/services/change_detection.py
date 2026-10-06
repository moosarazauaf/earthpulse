"""Bi-temporal spectral-index change detection.

Method: build a cloud-free median composite for each period, compute the
index on both, difference them, and report pixels whose change exceeds a
threshold. This detects that an index changed. It does not say why.
"""
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any

import numpy as np
from affine import Affine
from rasterio.features import geometry_mask, shapes, sieve
from shapely.geometry import mapping, shape

from app.core.config import SOFTWARE_VERSION, Settings
from app.datasets.catalog import Dataset, get_dataset
from app.geospatial import raster
from app.geospatial.geometry import aoi_utm_epsg, geodesic_area_m2, parse_aoi, to_geojson
from app.geospatial.indices import INDICES, compute_index
from app.models import ChangeRequest
from app.providers.base import Grid
from app.providers.registry import get_provider
from app.services.acquisition import Acquisition, acquire

Stage = Callable[[str], None]

M2_PER_HA = 10_000.0
MAX_DETECTIONS = 200
HISTOGRAM_BINS = 40
# Composites built from scenes this far apart in the calendar may differ
# because of crop and leaf phenology alone.
SEASON_MISMATCH_DAYS = 45
# Fractions of the threshold used to show how sensitive the areas are to it.
SENSITIVITY_FACTORS = (0.75, 1.25)

# Colour stops (RGB). Diverging for change, sequential for index value.
DELTA_COLORS = [(165, 42, 42), (230, 140, 90), (245, 245, 240), (120, 190, 140), (20, 110, 70)]
INDEX_COLORS = [(120, 70, 40), (220, 200, 150), (245, 245, 200), (130, 190, 110), (20, 100, 50)]


def run(request: ChangeRequest, analysis_id: str, settings: Settings, stage: Stage) -> dict[str, Any]:
    provider = get_provider(request.provider)
    dataset = get_dataset(request.dataset)
    index = INDICES[request.index]
    threshold = request.threshold if request.threshold is not None else index.default_threshold

    aoi = parse_aoi(request.aoi, settings.max_aoi_km2)
    epsg = aoi_utm_epsg(aoi)
    aoi_utm = raster.project_geometry(aoi, 4326, epsg)
    grid = raster.build_grid(aoi_utm, epsg, dataset.resolution_m, settings.max_pixels)
    inside = raster.aoi_mask(aoi_utm, grid)

    stage("ACQUIRING_DATA")
    before = acquire(provider, dataset, aoi, grid, request.before.start, request.before.end,
                     request.max_cloud)
    stage("PROCESSING_IMAGERY")
    after = acquire(provider, dataset, aoi, grid, request.after.start, request.after.end,
                    request.max_cloud)

    stage("CALCULATING_INDICES")
    all_indices: dict[str, dict[str, float | None]] = {}
    for index_id in INDICES:
        b = _masked(compute_index(index_id, before.composite.bands), inside)
        a = _masked(compute_index(index_id, after.composite.bands), inside)
        both = np.isfinite(a) & np.isfinite(b)
        all_indices[index_id] = {
            "before": _mean(b[both]), "after": _mean(a[both]),
            "change": _mean(a[both] - b[both]),
        }
    index_before = _masked(compute_index(index.id, before.composite.bands), inside)
    index_after = _masked(compute_index(index.id, after.composite.bands), inside)

    stage("DETECTING_CHANGE")
    delta = index_after - index_before
    valid = np.isfinite(delta)
    pixel_ha = grid.resolution**2 / M2_PER_HA
    analysed_ha = float(valid.sum()) * pixel_ha
    loss = valid & (delta <= -threshold)
    gain = valid & (delta >= threshold)
    detections = _detections(loss, gain, index_before, index_after, grid,
                             request.min_area_ha, before, after)

    stage("GENERATING_RESULTS")
    out_dir = settings.data_dir / "analyses" / analysis_id
    out_dir.mkdir(parents=True, exist_ok=True)
    overlays = _write_outputs(out_dir, analysis_id, index.name, index_before, index_after,
                              delta, grid)

    aoi_ha = geodesic_area_m2(aoi) / M2_PER_HA
    inside_px = int(inside.sum())
    return {
        "id": analysis_id,
        "type": "change",
        "label": request.label,
        "softwareVersion": SOFTWARE_VERSION,
        "request": request.model_dump(mode="json", by_alias=True),
        "aoi": to_geojson(aoi),
        "valueKind": "DERIVED" if provider.is_observed else "SIMULATED",
        "provenance": _provenance(provider, dataset, index, grid, threshold, before, after, request),
        "summary": {
            "aoiAreaHa": aoi_ha,
            "analysedAreaHa": analysed_ha,
            "validFraction": float(valid.sum()) / inside_px if inside_px else 0.0,
            "before": {"mean": _mean(index_before[valid]), "median": _median(index_before[valid])},
            "after": {"mean": _mean(index_after[valid]), "median": _median(index_after[valid])},
            "meanChange": _mean(delta[valid]),
            "threshold": threshold,
            "lossAreaHa": float(loss.sum()) * pixel_ha,
            "gainAreaHa": float(gain.sum()) * pixel_ha,
            "lossPercent": _pct(loss.sum(), valid.sum()),
            "gainPercent": _pct(gain.sum(), valid.sum()),
            "thresholdSensitivity": [
                {
                    "threshold": threshold * f,
                    "lossAreaHa": float((valid & (delta <= -threshold * f)).sum()) * pixel_ha,
                    "gainAreaHa": float((valid & (delta >= threshold * f)).sum()) * pixel_ha,
                }
                for f in SENSITIVITY_FACTORS
            ],
            "clearObservations": {
                "before": _median(before.composite.clear_count[inside]),
                "after": _median(after.composite.clear_count[inside]),
            },
        },
        "indices": all_indices,
        "histogram": _histogram(delta[valid]),
        "detections": detections,
        "overlays": overlays,
        "warnings": _warnings(before, after, valid.sum(), inside_px),
    }


# ---- helpers ---------------------------------------------------------------
def _masked(data: np.ndarray, inside: np.ndarray) -> np.ndarray:
    out = data.copy()
    out[~inside] = np.nan
    return out


def _mean(values: np.ndarray) -> float | None:
    return float(np.mean(values)) if values.size else None


def _median(values: np.ndarray) -> float | None:
    return float(np.median(values)) if values.size else None


def _pct(part: Any, whole: Any) -> float:
    return float(part) / float(whole) * 100.0 if whole else 0.0


def _histogram(values: np.ndarray) -> dict[str, list[float]]:
    counts, edges = np.histogram(values, bins=HISTOGRAM_BINS, range=(-1.0, 1.0))
    return {"binEdges": [float(e) for e in edges], "counts": [int(c) for c in counts]}


def _detections(loss, gain, index_before, index_after, grid: Grid, min_area_ha: float,
                before: Acquisition, after: Acquisition) -> dict[str, Any]:
    """Vectorise contiguous change regions and describe each one."""
    classes = np.zeros(loss.shape, dtype=np.uint8)
    classes[loss] = 1
    classes[gain] = 2
    min_pixels = max(1, int(np.ceil(min_area_ha * M2_PER_HA / grid.resolution**2)))
    if min_pixels > 1:
        cleaned = sieve(classes, size=min_pixels, connectivity=8)
        # sieve merges small regions into neighbours; keep only pixels that
        # were a detection of the same class to begin with.
        classes = np.where(cleaned == classes, cleaned, 0).astype(np.uint8)

    regions = [
        (shape(geom), int(value))
        for geom, value in shapes(classes, mask=classes > 0, connectivity=8, transform=grid.transform)
    ]
    regions = [r for r in regions if r[0].area / M2_PER_HA >= min_area_ha]
    regions.sort(key=lambda r: r[0].area, reverse=True)
    total = len(regions)

    features = []
    for number, (polygon, value) in enumerate(regions[:MAX_DETECTIONS], start=1):
        min_x, min_y, max_x, max_y = polygon.bounds
        west, north, res = grid.transform.c, grid.transform.f, grid.resolution
        cols = slice(max(0, int((min_x - west) // res)),
                     min(grid.width, int(np.ceil((max_x - west) / res))))
        rows = slice(max(0, int((north - max_y) // res)),
                     min(grid.height, int(np.ceil((north - min_y) / res))))
        sub_transform = grid.transform @ Affine.translation(cols.start, rows.start)
        shape_hw = (rows.stop - rows.start, cols.stop - cols.start)
        member = geometry_mask([polygon], out_shape=shape_hw, transform=sub_transform, invert=True)
        b, a = index_before[rows, cols][member], index_after[rows, cols][member]
        ok = np.isfinite(a) & np.isfinite(b)
        geographic = raster.project_geometry(polygon, grid.epsg, 4326)
        centroid = geographic.centroid
        features.append({
            "type": "Feature",
            "id": number,
            "geometry": mapping(geographic),
            "properties": {
                "direction": "decrease" if value == 1 else "increase",
                "areaHa": polygon.area / M2_PER_HA,
                "before": _mean(b[ok]),
                "after": _mean(a[ok]),
                "change": _mean(a[ok] - b[ok]),
                "clearObservationsBefore": _median(before.composite.clear_count[rows, cols][member]),
                "clearObservationsAfter": _median(after.composite.clear_count[rows, cols][member]),
                "centroid": [centroid.x, centroid.y],
            },
        })
    return {"type": "FeatureCollection", "features": features,
            "totalRegions": total, "truncated": total > MAX_DETECTIONS}


def _write_outputs(out_dir: Path, analysis_id: str, index_name: str, index_before, index_after,
                   delta, grid: Grid) -> dict[str, Any]:
    overlays: dict[str, Any] = {}
    layers = {
        "change": (delta, -0.5, 0.5, DELTA_COLORS, f"{index_name} change (after minus before)"),
        "before": (index_before, -0.2, 0.8, INDEX_COLORS, f"{index_name} before"),
        "after": (index_after, -0.2, 0.8, INDEX_COLORS, f"{index_name} after"),
    }
    for name, (data, vmin, vmax, colors, title) in layers.items():
        geographic, bounds = raster.to_geographic(data, grid)
        (out_dir / f"{name}.png").write_bytes(
            raster.encode_png(raster.colorize(geographic, vmin, vmax, colors))
        )
        raster.write_geotiff(str(out_dir / f"{name}.tif"), data, grid, title)
        overlays[name] = {
            "title": title,
            "url": f"/api/analysis/{analysis_id}/files/{name}.png",
            "geotiff": f"/api/analysis/{analysis_id}/files/{name}.tif",
            "bounds": list(bounds),  # west, south, east, north in EPSG:4326
            "legend": {"min": vmin, "max": vmax,
                       "colors": ["#{:02x}{:02x}{:02x}".format(*c) for c in colors]},
        }
    return overlays


def _provenance(provider, dataset: Dataset, index, grid: Grid, threshold: float,
                before: Acquisition, after: Acquisition, request: ChangeRequest) -> dict[str, Any]:
    return {
        "provider": {"id": provider.id, "name": provider.name, "observed": provider.is_observed},
        "dataset": dataset.public(),
        "index": {"id": index.id, "name": index.name, "formula": index.formula,
                  "measures": index.measures, "reference": index.reference},
        "method": (
            "Per-pixel median composite of clear-sky surface reflectance for each period; "
            f"{index.name} computed on each composite; change = after minus before; "
            f"pixels with |change| >= {threshold:g} reported."
        ),
        "cloudMask": (
            "QA_PIXEL: fill, dilated cloud, cirrus, cloud, cloud shadow and snow rejected"
            if dataset.id == "landsat"
            else "SCL: no data, saturated, cloud shadow, cloud (medium/high), cirrus and snow rejected"
        ),
        "crs": f"EPSG:{grid.epsg}",
        "nativeResolutionM": dataset.resolution_m,
        "workingResolutionM": grid.resolution,
        "gridSize": [grid.width, grid.height],
        "maxCloudPercent": request.max_cloud,
        "scenes": {
            "before": [s.public() for s in before.composite.scenes],
            "after": [s.public() for s in after.composite.scenes],
        },
        "uncertainty": (
            "No formal accuracy assessment has been made for this result. The threshold is a "
            "user-set parameter, not a validated one; thresholdSensitivity shows how the areas "
            "move when it changes by 25%. Areas are pixel counts in a UTM grid, whose scale "
            "error is below 0.1% within a zone."
        ),
    }


def _day_of_year(acquisition: Acquisition) -> float:
    days = [datetime.fromisoformat(s.datetime.replace("Z", "+00:00")).timetuple().tm_yday
            for s in acquisition.composite.scenes]
    return float(np.median(days))


def _warnings(before: Acquisition, after: Acquisition, valid_px: Any, inside_px: int) -> list[str]:
    warnings = [*before.notes, *after.notes]
    gap = abs(_day_of_year(before) - _day_of_year(after))
    gap = min(gap, 365 - gap)
    if gap > SEASON_MISMATCH_DAYS:
        warnings.append(
            f"The two composites are centred about {gap:.0f} days apart in the calendar. "
            "Seasonal vegetation and water cycles alone can produce change of this kind."
        )
    if set(before.platforms) != set(after.platforms):
        warnings.append(
            f"Different sensors were used ({', '.join(before.platforms)} then "
            f"{', '.join(after.platforms)}). Their spectral bands differ slightly and no "
            "cross-sensor harmonisation was applied."
        )
    if inside_px and float(valid_px) / inside_px < 0.9:
        warnings.append(
            f"Only {float(valid_px) / inside_px:.0%} of the area had clear observations in both "
            "periods. Area totals describe that part only."
        )
    return warnings
