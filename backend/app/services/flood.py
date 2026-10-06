"""FloodLens: flood extent from Sentinel-1 radar.

Open water reflects the radar pulse away from the sensor, so it appears dark
in VV backscatter. A pixel is mapped as flooded when it is dark during the
flood period, was not dark before it, and its backscatter dropped by a clear
margin. The drop criterion keeps permanently dark surfaces such as dry sand
from being counted.

No machine learning is used: for a before/after radar pair, thresholding with
a change test is the standard approach (for example the UN-SPIDER recommended
practice), and it keeps every step inspectable.
"""
import warnings
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import date
from typing import Any

import numpy as np
from shapely.geometry import shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import unary_union

from app.core.config import SOFTWARE_VERSION, Settings
from app.core.errors import AppError, NoImagery
from app.datasets.catalog import (
    SENTINEL1,
    WORLDCOVER,
    WORLDCOVER_BUILT_UP,
    WORLDCOVER_CROPLAND,
    WORLDCOVER_PERMANENT_WATER,
)
from app.geospatial import raster
from app.geospatial.geometry import aoi_utm_epsg, geodesic_area_m2, parse_aoi, to_geojson
from app.models import FloodRequest
from app.providers.base import Grid, ImageryProvider, Scene
from app.providers.registry import get_provider
from app.services.change_detection import Stage, vectorise_regions

M2_PER_HA = 10_000.0
# Search range for the water threshold. Calm open water in C-band VV usually
# lies below about -15 dB and land above about -12 dB; a threshold outside
# this range means the histogram did not separate water from land.
THRESHOLD_RANGE_DB = (-23.0, -13.0)
FALLBACK_THRESHOLD_DB = -17.0
# Otsu separability (between-class variance / total variance) below which the
# histogram is treated as not bimodal. A single Gaussian population scores
# 2/pi (about 0.64), so the bar has to sit above that.
MIN_SEPARABILITY = 0.70
# Minimum fall in backscatter for a dark pixel to count as newly flooded.
MIN_DROP_DB = 3.0
# Passes per period used in the composite; more adds little and costs time.
MAX_PASSES = 4
# Smallest share of the AOI an orbit must cover in every period to be used.
MIN_COVERAGE = 0.5
# Below this working resolution a 3x3 mean is applied to suppress speckle;
# coarser grids are already averages of many looks.
SPECKLE_FILTER_BELOW_M = 30.0
HISTOGRAM_BINS = 60
HISTOGRAM_RANGE_DB = (-30.0, 0.0)

GREY = [(0, 0, 0), (255, 255, 255)]
# Extent classes: 1 pre-existing water, 2 flooded.
EXTENT_COLORS = {1: (60, 130, 220), 2: (255, 80, 60)}


def to_db(power: np.ndarray) -> np.ndarray:
    """Linear backscatter to decibels; non-positive and missing values become NaN."""
    out = np.full(power.shape, np.nan, dtype=np.float32)
    ok = np.isfinite(power) & (power > 0)
    out[ok] = 10.0 * np.log10(power[ok])
    return out


def box_mean(data: np.ndarray, size: int = 3) -> np.ndarray:
    """Mean filter that ignores NaN. Applied to linear power, this is multilooking."""
    pad = size // 2
    valid = np.isfinite(data)
    padded = np.pad(np.where(valid, data, 0.0), pad)
    weights = np.pad(valid.astype(np.float32), pad)
    total = np.zeros(data.shape, dtype=np.float32)
    count = np.zeros(data.shape, dtype=np.float32)
    for dy in range(size):
        for dx in range(size):
            total += padded[dy:dy + data.shape[0], dx:dx + data.shape[1]]
            count += weights[dy:dy + data.shape[0], dx:dx + data.shape[1]]
    out = np.full(data.shape, np.nan, dtype=np.float32)
    np.divide(total, count, out=out, where=(count > 0) & valid)
    return out


def otsu_threshold(values: np.ndarray, bins: int = 256) -> tuple[float, float]:
    """Otsu's threshold and its separability (0 to 1) for a 1-D sample."""
    counts, edges = np.histogram(values, bins=bins)
    centres = (edges[:-1] + edges[1:]) / 2
    weights = counts / counts.sum()
    cumulative = np.cumsum(weights)
    cumulative_mean = np.cumsum(weights * centres)
    total_mean = cumulative_mean[-1]
    with np.errstate(divide="ignore", invalid="ignore"):
        between = (total_mean * cumulative - cumulative_mean) ** 2 / (cumulative * (1 - cumulative))
    between = np.nan_to_num(between)
    best = int(np.argmax(between))
    total_variance = float(np.sum(weights * (centres - total_mean) ** 2))
    separability = float(between[best] / total_variance) if total_variance > 0 else 0.0
    return float(edges[best + 1]), separability


def choose_orbit(periods: list[list[Scene]], aoi: BaseGeometry) -> tuple[int, dict[int, float]]:
    """Pick the relative orbit that covers the AOI best in every period.

    Mixing orbits changes the look angle, and an orbit that clips the AOI
    silently drops area, so one orbit is used throughout and its coverage is
    reported.
    """
    coverage: dict[int, float] = {}
    orbits = {s.relative_orbit for scenes in periods for s in scenes if s.relative_orbit is not None}
    for orbit in orbits:
        worst = 1.0
        for scenes in periods:
            footprints = [shape(s.geometry) for s in scenes
                          if s.relative_orbit == orbit and s.geometry]
            covered = unary_union(footprints).intersection(aoi).area / aoi.area if footprints else 0.0
            worst = min(worst, covered)
        coverage[orbit] = worst
    usable = {o: c for o, c in coverage.items() if c >= MIN_COVERAGE}
    if not usable:
        raise NoImagery(
            "No single Sentinel-1 orbit covers this area in every period.",
            hint="Widen the date windows. Sentinel-1 revisits the same orbit every 6 to 12 days.",
        )
    return max(usable, key=lambda o: usable[o]), coverage


def composite(provider: ImageryProvider, scenes: list[Scene], orbit: int, grid: Grid,
              reducer: str = "median") -> tuple[np.ndarray, np.ndarray, list[Scene]]:
    """Combine the passes of one orbit into one VV image (linear power).

    "median" gives a stable reference image. "min" keeps the lowest backscatter
    seen in any pass, which maps the largest water extent in the window; it is
    slightly biased towards water because it also keeps the darkest speckle.
    Returns the image, the number of passes per pixel, and the scenes used.
    """
    passes: dict[str, list[Scene]] = defaultdict(list)
    for scene in scenes:
        if scene.relative_orbit == orbit:
            passes[scene.datetime[:10]].append(scene)  # slices of one pass share a date
    chosen = sorted(passes)[-MAX_PASSES:]
    used = [scene for day in chosen for scene in passes[day]]
    with ThreadPoolExecutor(max_workers=raster.READ_THREADS) as pool:
        raw = list(pool.map(
            lambda s: provider.read(s, SENTINEL1.bands["vv"], grid, categorical=False), used))
    arrays = dict(zip((s.id for s in used), raw, strict=True))

    layers = []
    for day in chosen:
        mosaic = np.full((grid.height, grid.width), np.nan, dtype=np.float32)
        for scene in passes[day]:
            data = arrays[scene.id].astype(np.float32)
            data[~np.isfinite(data) | (data <= 0)] = np.nan
            mosaic = np.where(np.isfinite(mosaic), mosaic, data)
        layers.append(mosaic)
    stack = np.stack(layers)
    count = np.isfinite(stack).sum(axis=0).astype(np.uint8)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)  # all-NaN pixels stay NaN
        combined = (np.nanmin if reducer == "min" else np.nanmedian)(stack, axis=0)
    return combined.astype(np.float32), count, used


def run(request: FloodRequest, analysis_id: str, settings: Settings, stage: Stage) -> dict[str, Any]:
    provider = get_provider(request.provider)
    aoi = parse_aoi(request.aoi, settings.max_aoi_km2)
    epsg = aoi_utm_epsg(aoi)
    aoi_utm = raster.project_geometry(aoi, 4326, epsg)
    grid = raster.build_grid(aoi_utm, epsg, SENTINEL1.resolution_m, settings.max_pixels)
    inside = raster.aoi_mask(aoi_utm, grid)
    pixel_ha = grid.resolution**2 / M2_PER_HA

    stage("ACQUIRING_DATA")
    windows = {"before": request.before, "flood": request.flood}
    if request.after:
        windows["after"] = request.after
    found: dict[str, list[Scene]] = {}
    for name, period in windows.items():
        if provider.is_observed:
            _check_date(period.start)
        found[name] = provider.search(SENTINEL1, aoi.bounds, period.start.isoformat(),
                                      period.end.isoformat(), None)
        if not found[name]:
            raise NoImagery(
                f"No Sentinel-1 scene covers this area between {period.start} and {period.end}.",
                hint="Widen the date window.",
            )
    orbit, coverage = choose_orbit(list(found.values()), aoi)

    stage("PROCESSING_IMAGERY")
    power: dict[str, np.ndarray] = {}
    counts: dict[str, np.ndarray] = {}
    used: dict[str, list[Scene]] = {}
    for name, scenes in found.items():
        # The flood image keeps the darkest pass so a flood seen once is not averaged out.
        reducer = "min" if name == "flood" else "median"
        power[name], counts[name], used[name] = composite(provider, scenes, orbit, grid, reducer)
    filtered = grid.resolution < SPECKLE_FILTER_BELOW_M
    db = {}
    for name, data in power.items():
        data = box_mean(data) if filtered else data
        layer = to_db(data)
        layer[~inside] = np.nan
        db[name] = layer

    stage("CALCULATING_INDICES")
    valid = np.isfinite(db["before"]) & np.isfinite(db["flood"])
    if not valid.any():
        raise NoImagery("The selected orbit has no data inside this area.")
    threshold_info = _threshold(db["flood"][valid], request.threshold_db)
    threshold = threshold_info["valueDb"]

    stage("DETECTING_CHANGE")
    water_before = valid & (db["before"] < threshold)
    water_flood = valid & (db["flood"] < threshold)
    drop = db["before"] - db["flood"]
    flooded = water_flood & ~water_before & (drop >= MIN_DROP_DB)
    grid_shape = (grid.height, grid.width)
    extent = np.zeros(grid_shape, dtype=np.uint8)
    extent[water_before] = 1
    extent[flooded] = 2

    summary: dict[str, Any] = {
        "aoiAreaHa": geodesic_area_m2(aoi) / M2_PER_HA,
        "analysedAreaHa": float(valid.sum()) * pixel_ha,
        "validFraction": float(valid.sum()) / max(1, int(inside.sum())),
        "floodedAreaHa": float(flooded.sum()) * pixel_ha,
        "floodedPercent": float(flooded.sum()) / float(valid.sum()) * 100.0,
        "preExistingWaterHa": float(water_before.sum()) * pixel_ha,
        "waterExtentDuringFloodHa": float(water_flood.sum()) * pixel_ha,
        "thresholdDb": threshold,
        "minDropDb": MIN_DROP_DB,
        # How much the answer moves if the threshold is 1 dB off.
        "thresholdSensitivity": [
            {"thresholdDb": threshold + shift,
             "floodedAreaHa": float((valid & (db["flood"] < threshold + shift)
                                     & ~(db["before"] < threshold + shift)
                                     & (drop >= MIN_DROP_DB)).sum()) * pixel_ha}
            for shift in (-1.0, 1.0)
        ],
        "passes": {name: int(np.median(c[inside])) for name, c in counts.items()},
    }
    notes = _warnings(coverage[orbit], threshold_info, summary)

    if "after" in db:
        still = flooded & np.isfinite(db["after"]) & (db["after"] < threshold)
        observed_after = flooded & np.isfinite(db["after"])
        summary["recession"] = {
            "stillWaterHa": float(still.sum()) * pixel_ha,
            "recededHa": float((observed_after & ~still).sum()) * pixel_ha,
            "notObservedHa": float((flooded & ~observed_after).sum()) * pixel_ha,
        }

    land_cover = _land_cover(provider, grid, flooded, water_before, pixel_ha, notes)

    stage("GENERATING_RESULTS")
    detections = vectorise_regions(flooded, np.zeros(grid_shape, dtype=bool), db["before"],
                                   db["flood"], grid, request.min_area_ha,
                                   counts["before"], counts["flood"])
    out_dir = settings.data_dir / "analyses" / analysis_id
    out_dir.mkdir(parents=True, exist_ok=True)
    overlays = _write_outputs(out_dir, analysis_id, extent, db, grid)
    counts_hist, edges = np.histogram(db["flood"][valid], bins=HISTOGRAM_BINS, range=HISTOGRAM_RANGE_DB)

    return {
        "id": analysis_id,
        "type": "flood",
        "label": request.label,
        "softwareVersion": SOFTWARE_VERSION,
        "request": request.model_dump(mode="json", by_alias=True),
        "aoi": to_geojson(aoi),
        "valueKind": "DERIVED" if provider.is_observed else "SIMULATED",
        "provenance": {
            "provider": {"id": provider.id, "name": provider.name, "observed": provider.is_observed},
            "dataset": SENTINEL1.public(),
            "method": (
                "VV backscatter from one relative orbit: the median of the passes before (and after), "
                "and the lowest value of the passes in the flood window, which maps the largest "
                "extent seen. A pixel is flooded when "
                f"VV during the flood period is below {threshold:.1f} dB, VV before was not, and VV "
                f"fell by at least {MIN_DROP_DB:g} dB. Pixels below the threshold before the flood "
                "are reported as pre-existing water."
            ),
            "polarisation": "VV",
            "relativeOrbit": orbit,
            "orbitState": used["flood"][0].orbit_state if used["flood"] else None,
            "orbitCoverage": {str(o): round(c, 3) for o, c in sorted(coverage.items())},
            "threshold": threshold_info,
            "speckleFilter": "3x3 mean on linear power" if filtered else
                             "none: the working grid already averages many looks",
            "crs": f"EPSG:{grid.epsg}",
            "nativeResolutionM": SENTINEL1.resolution_m,
            "workingResolutionM": grid.resolution,
            "gridSize": [grid.width, grid.height],
            "scenes": {name: [s.public() for s in scenes] for name, scenes in used.items()},
            "landCover": WORLDCOVER if land_cover else None,
            "uncertainty": (
                "No accuracy assessment has been made against ground or optical reference data. "
                "Known error sources: wind-roughened water is missed; smooth dry surfaces and "
                "radar shadow can be mistaken for water; water under vegetation or between "
                "buildings is not detected, so flooding in dense crops and built-up areas is "
                "underestimated. Fields flooded on purpose, such as rice paddies, are open water "
                "too and are counted as flooded. thresholdSensitivity shows the effect of a 1 dB "
                "threshold error."
            ),
        },
        "summary": summary,
        "landCover": land_cover,
        "histogram": {"binEdges": [float(e) for e in edges], "counts": [int(c) for c in counts_hist]},
        "detections": detections,
        "overlays": overlays,
        "warnings": notes,
    }


# ---- helpers ---------------------------------------------------------------
def _check_date(start: date) -> None:
    if start.year < SENTINEL1.first_year:
        raise AppError("Sentinel-1 does not cover dates before 2014.",
                       hint="Choose dates from October 2014 onward.")


def _threshold(flood_db: np.ndarray, requested: float | None) -> dict[str, Any]:
    if requested is not None:
        return {"valueDb": requested, "source": "user", "separability": None}
    value, separability = otsu_threshold(flood_db)
    low, high = THRESHOLD_RANGE_DB
    if separability >= MIN_SEPARABILITY and low <= value <= high:
        return {"valueDb": round(value, 2), "source": "otsu", "separability": round(separability, 3)}
    return {"valueDb": FALLBACK_THRESHOLD_DB, "source": "fallback",
            "separability": round(separability, 3), "otsuValueDb": round(value, 2)}


def _warnings(coverage: float, threshold: dict[str, Any], summary: dict[str, Any]) -> list[str]:
    notes = []
    if coverage < 0.98:
        notes.append(
            f"The orbit used covers {coverage:.0%} of the area. Totals describe that part only."
        )
    if threshold["source"] == "fallback":
        notes.append(
            "The backscatter histogram did not separate water from land clearly (Otsu "
            f"separability {threshold['separability']}), so a fixed threshold of "
            f"{FALLBACK_THRESHOLD_DB:g} dB was used. This usually means water covers only a small "
            "share of the area. Check the result against the radar images."
        )
    low, high = (s["floodedAreaHa"] for s in summary["thresholdSensitivity"])
    if summary["floodedAreaHa"] > 0 and (high - low) / summary["floodedAreaHa"] > 0.5:
        notes.append(
            "The flooded area changes by more than half when the threshold moves by 1 dB either "
            "way. Treat the total as approximate."
        )
    return notes


def _land_cover(provider: ImageryProvider, grid: Grid, flooded: np.ndarray,
                water_before: np.ndarray, pixel_ha: float, notes: list[str]) -> dict[str, Any] | None:
    """Flooded area by WorldCover class. Returns None if the layer is unavailable."""
    try:
        classes = provider.read_static("worldcover", grid)
    except AppError:
        notes.append("Land cover could not be loaded, so affected land use is not reported.")
        return None

    def area(mask: np.ndarray) -> float:
        return float((flooded & mask).sum()) * pixel_ha

    cropland, built = classes == WORLDCOVER_CROPLAND, classes == WORLDCOVER_BUILT_UP
    mapped_water = classes == WORLDCOVER_PERMANENT_WATER
    return {
        "valueKind": "DERIVED",
        "croplandFloodedHa": area(cropland),
        "builtUpFloodedHa": area(built),
        "otherFloodedHa": area(~cropland & ~built),
        # Cross-check of the radar's pre-flood water against an independent map.
        "permanentWaterMappedHa": float(mapped_water.sum()) * pixel_ha,
        "preExistingWaterAlsoMappedHa": float((water_before & mapped_water).sum()) * pixel_ha,
        "note": (
            "Flood extent intersected with ESA WorldCover 2021 classes. WorldCover is itself a "
            "classification (reported overall accuracy about 77%), and radar misses water under "
            "crops and between buildings, so these are lower-bound estimates."
        ),
    }


def _write_outputs(out_dir, analysis_id: str, extent: np.ndarray, db: dict[str, np.ndarray],
                   grid: Grid) -> dict[str, Any]:
    overlays: dict[str, Any] = {}

    def register(name: str, title: str, rgba: np.ndarray, bounds, legend: dict, data: np.ndarray) -> None:
        (out_dir / f"{name}.png").write_bytes(raster.encode_png(rgba))
        raster.write_geotiff(str(out_dir / f"{name}.tif"), data, grid, title)
        overlays[name] = {
            "title": title,
            "url": f"/api/analysis/{analysis_id}/files/{name}.png",
            "geotiff": f"/api/analysis/{analysis_id}/files/{name}.tif",
            "bounds": list(bounds),
            "legend": legend,
        }

    geographic, bounds = raster.to_geographic(extent.astype(np.float32), grid)
    rgba = np.zeros((4, *geographic.shape), dtype=np.uint8)
    for value, colour in EXTENT_COLORS.items():
        member = geographic == value
        for channel in range(3):
            rgba[channel][member] = colour[channel]
        rgba[3][member] = 255
    register("flood", "Flood extent", rgba, bounds, {
        "classes": [
            {"label": "Flooded", "color": "#{:02x}{:02x}{:02x}".format(*EXTENT_COLORS[2])},
            {"label": "Pre-existing water", "color": "#{:02x}{:02x}{:02x}".format(*EXTENT_COLORS[1])},
        ]}, extent.astype(np.float32))

    titles = {"before": "VV backscatter before", "flood": "VV backscatter during flood",
              "after": "VV backscatter after"}
    for name, layer in db.items():
        geographic, bounds = raster.to_geographic(layer, grid)
        register(f"vv_{name}", titles[name], raster.colorize(geographic, -25.0, 0.0, GREY), bounds,
                 {"min": -25, "max": 0, "colors": ["#000000", "#ffffff"], "unit": "dB"}, layer)
    return overlays
