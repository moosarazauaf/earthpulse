"""Mean index values over an AOI for a set of years.

Each year is an independent composite. Years with no usable imagery are
returned as gaps; nothing is interpolated.
"""
from calendar import monthrange
from datetime import date
from typing import Any

import numpy as np

from app.core.config import SOFTWARE_VERSION, Settings
from app.core.errors import AppError
from app.datasets.catalog import get_dataset
from app.geospatial import raster
from app.geospatial.geometry import aoi_utm_epsg, geodesic_area_m2, parse_aoi, to_geojson
from app.geospatial.indices import INDICES, compute_index
from app.models import TimeSeriesRequest
from app.providers.registry import get_provider
from app.services.acquisition import acquire
from app.services.change_detection import Stage


def run(request: TimeSeriesRequest, analysis_id: str, settings: Settings, stage: Stage) -> dict[str, Any]:
    provider = get_provider(request.provider)
    dataset = get_dataset(request.dataset)
    aoi = parse_aoi(request.aoi, settings.max_aoi_km2)
    epsg = aoi_utm_epsg(aoi)
    aoi_utm = raster.project_geometry(aoi, 4326, epsg)
    grid = raster.build_grid(aoi_utm, epsg, dataset.resolution_m, settings.max_pixels)
    inside = raster.aoi_mask(aoi_utm, grid)
    inside_px = int(inside.sum())

    series: list[dict[str, Any]] = []
    warnings: list[str] = []
    for position, year in enumerate(request.years):
        stage("ACQUIRING_DATA" if position == 0 else "PROCESSING_IMAGERY")
        start = date(year, request.start_month, 1)
        end = min(date(year, request.end_month, monthrange(year, request.end_month)[1]),
                  date.today())
        entry: dict[str, Any] = {"year": year, "period": [start.isoformat(), end.isoformat()]}
        try:
            acquisition = acquire(provider, dataset, aoi, grid, start, end, request.max_cloud)
        except AppError as exc:
            # A gap is a result, not a failure of the whole series.
            entry.update(status="NO_DATA", reason=exc.message, values=None)
            series.append(entry)
            continue
        values: dict[str, float | None] = {}
        valid_px = 0
        for index_id in INDICES:
            data = compute_index(index_id, acquisition.composite.bands)[inside]
            finite = data[np.isfinite(data)]
            values[index_id] = float(finite.mean()) if finite.size else None
            valid_px = max(valid_px, int(finite.size))
        entry.update(
            status="OBSERVED" if provider.is_observed else "SIMULATED",
            values=values,
            validFraction=valid_px / inside_px if inside_px else 0.0,
            platforms=acquisition.platforms,
            scenes=[s.public() for s in acquisition.composite.scenes],
        )
        warnings.extend(n for n in acquisition.notes if n not in warnings)
        series.append(entry)

    stage("GENERATING_RESULTS")
    platforms = {p for e in series for p in e.get("platforms", [])}
    if len(platforms) > 1:
        warnings.append(
            f"The series spans several sensors ({', '.join(sorted(platforms))}). No cross-sensor "
            "harmonisation was applied, so small steps between sensors are not evidence of change."
        )
    return {
        "id": analysis_id,
        "type": "timeseries",
        "label": request.label,
        "softwareVersion": SOFTWARE_VERSION,
        "request": request.model_dump(mode="json", by_alias=True),
        "aoi": to_geojson(aoi),
        "valueKind": "DERIVED" if provider.is_observed else "SIMULATED",
        "provenance": {
            "provider": {"id": provider.id, "name": provider.name, "observed": provider.is_observed},
            "dataset": dataset.public(),
            "indices": [{"id": i.id, "name": i.name, "formula": i.formula, "measures": i.measures,
                         "reference": i.reference} for i in INDICES.values()],
            "method": (
                "For each year: per-pixel median composite of clear-sky surface reflectance "
                "within the month window, index computed per pixel, then averaged over the AOI."
            ),
            "crs": f"EPSG:{grid.epsg}",
            "nativeResolutionM": dataset.resolution_m,
            "workingResolutionM": grid.resolution,
            "maxCloudPercent": request.max_cloud,
        },
        "summary": {"aoiAreaHa": geodesic_area_m2(aoi) / 10_000.0},
        "series": series,
        "warnings": warnings,
    }
