"""AOI parsing and measurement.

Areas are never computed in degrees. `geodesic_area_m2` integrates on the
WGS84 ellipsoid; raster work happens in the AOI's UTM zone.
"""
from typing import Any

from pyproj import Geod
from shapely.geometry import MultiPolygon, Polygon, mapping, shape
from shapely.geometry.base import BaseGeometry
from shapely.validation import explain_validity

from app.core.errors import AOITooLarge, InvalidAOI

_GEOD = Geod(ellps="WGS84")
# Guards against pathological uploads; real AOIs are far below this.
MAX_VERTICES = 20_000


def parse_aoi(geojson: dict[str, Any], max_km2: float | None = None) -> BaseGeometry:
    """Turn a GeoJSON Polygon, MultiPolygon or Feature into a validated geometry."""
    if not isinstance(geojson, dict):
        raise InvalidAOI("The area of interest must be a GeoJSON object.")
    if geojson.get("type") == "Feature":
        geojson = geojson.get("geometry") or {}
    if geojson.get("type") == "FeatureCollection":
        features = geojson.get("features") or []
        if len(features) != 1:
            raise InvalidAOI("Provide exactly one polygon as the area of interest.")
        geojson = features[0].get("geometry") or {}
    if geojson.get("type") not in ("Polygon", "MultiPolygon"):
        raise InvalidAOI("The area of interest must be a polygon.")
    try:
        geom = shape(geojson)
    except Exception as exc:  # shapely raises several unrelated types here
        raise InvalidAOI("The area of interest is not valid GeoJSON.") from exc
    if geom.is_empty:
        raise InvalidAOI("The area of interest is empty.")
    if _vertex_count(geom) > MAX_VERTICES:
        raise InvalidAOI("The area of interest has too many vertices. Simplify it and retry.")
    min_lon, min_lat, max_lon, max_lat = geom.bounds
    if min_lon < -180 or max_lon > 180 or min_lat < -90 or max_lat > 90:
        raise InvalidAOI("Coordinates must be longitude/latitude in degrees (EPSG:4326).")
    if not geom.is_valid:
        raise InvalidAOI(f"The polygon is not valid: {explain_validity(geom)}.")
    if max_km2 is not None:
        km2 = geodesic_area_m2(geom) / 1e6
        if km2 > max_km2:
            raise AOITooLarge(
                f"The area is {km2:,.0f} km², above the {max_km2:,.0f} km² limit.",
                hint="Try a smaller area.",
            )
    return geom


def _vertex_count(geom: BaseGeometry) -> int:
    polygons = geom.geoms if isinstance(geom, MultiPolygon) else [geom]
    return sum(
        len(p.exterior.coords) + sum(len(r.coords) for r in p.interiors)
        for p in polygons
        if isinstance(p, Polygon)
    )


def geodesic_area_m2(geom: BaseGeometry) -> float:
    """Area on the WGS84 ellipsoid, in square metres."""
    area, _ = _GEOD.geometry_area_perimeter(geom)
    return abs(area)


def utm_epsg(lon: float, lat: float) -> int:
    """EPSG code of the WGS84 UTM zone containing a point."""
    zone = min(int((lon + 180.0) // 6.0) + 1, 60)
    return (32600 if lat >= 0 else 32700) + zone


def aoi_utm_epsg(geom: BaseGeometry) -> int:
    centroid = geom.centroid
    return utm_epsg(centroid.x, centroid.y)


def to_geojson(geom: BaseGeometry) -> dict[str, Any]:
    return mapping(geom)
