"""Analysis endpoints: submit, poll, download, export."""
import csv
import io
import json
import re
from typing import Any

from fastapi import APIRouter, Depends, Query
from fastapi import Path as PathParam
from fastapi.responses import FileResponse, PlainTextResponse, Response

from app.core.config import get_settings
from app.core.errors import AppError, NotFound
from app.core.ratelimit import limit_analysis
from app.gee.generator import generate_change_script
from app.geospatial.geometry import parse_aoi
from app.models import ChangeRequest, TimeSeriesRequest
from app.services import change_detection, jobs, timeseries

router = APIRouter(prefix="/api", tags=["analysis"])

ID_PATTERN = r"^EP-\d{4}-[A-Z0-9]{1,16}-[0-9A-F]{5}$"
FILE_PATTERN = r"^(change|before|after)\.(png|tif)$"
MEDIA = {"png": "image/png", "tif": "image/tiff"}


def _submit(kind: str, request: Any, runner: jobs.Runner) -> dict[str, str]:
    # Reject a bad AOI now rather than after the job has been queued.
    parse_aoi(request.aoi, get_settings().max_aoi_km2)
    analysis_id = jobs.submit(kind, request, runner)
    return {"id": analysis_id, "status": "QUEUED", "url": f"/api/analysis/{analysis_id}"}


@router.post("/analysis/change", status_code=202, dependencies=[Depends(limit_analysis)])
def submit_change(request: ChangeRequest) -> dict[str, str]:
    return _submit("change", request, change_detection.run)


@router.post("/analysis/timeseries", status_code=202, dependencies=[Depends(limit_analysis)])
def submit_timeseries(request: TimeSeriesRequest) -> dict[str, str]:
    return _submit("timeseries", request, timeseries.run)


def _load(analysis_id: str) -> dict[str, Any]:
    record = jobs.get_store().get(analysis_id)
    if record is None:
        raise NotFound("No analysis has this ID.")
    return record


def _result(analysis_id: str) -> dict[str, Any]:
    record = _load(analysis_id)
    if record["status"] != "COMPLETE":
        raise AppError("This analysis has not finished.")
    return record["result"]


@router.get("/analysis/{analysis_id}")
def get_analysis(analysis_id: str = PathParam(pattern=ID_PATTERN)) -> dict[str, Any]:
    record = _load(analysis_id)
    record["stages"] = jobs.STAGES
    return record


@router.get("/analysis/{analysis_id}/files/{name}")
def get_file(
    analysis_id: str = PathParam(pattern=ID_PATTERN),
    name: str = PathParam(pattern=FILE_PATTERN),
) -> FileResponse:
    # Both path parts are constrained by the patterns above, so the joined
    # path cannot leave the analysis directory.
    path = get_settings().data_dir / "analyses" / analysis_id / name
    if not path.is_file():
        raise NotFound("That file does not exist for this analysis.")
    extension = name.rsplit(".", 1)[1]
    download = f"{analysis_id}-{name}" if extension == "tif" else None
    return FileResponse(path, media_type=MEDIA[extension], filename=download)


@router.post("/gee/generate")
def generate_gee(body: dict[str, str]) -> dict[str, str]:
    analysis_id = body.get("analysisId", "")
    if not re.match(ID_PATTERN, analysis_id):
        raise AppError("Provide a valid analysisId.")
    return {
        "analysisId": analysis_id,
        "script": generate_change_script(_result(analysis_id)),
        "codeEditorUrl": "https://code.earthengine.google.com/",
    }


def _csv(result: dict[str, Any]) -> str:
    buffer = io.StringIO()
    writer = csv.writer(buffer, lineterminator="\n")
    writer.writerow([f"# EarthPulse analysis {result['id']}", f"value kind: {result['valueKind']}"])
    if result["type"] == "timeseries":
        writer.writerow(["year", "period_start", "period_end", "status", "ndvi", "ndwi", "mndwi",
                         "ndbi", "valid_fraction", "platforms", "scene_count"])
        for e in result["series"]:
            v = e.get("values") or {}
            writer.writerow([e["year"], *e["period"], e["status"], v.get("ndvi"), v.get("ndwi"),
                             v.get("mndwi"), v.get("ndbi"), e.get("validFraction"),
                             " ".join(e.get("platforms", [])), len(e.get("scenes", []))])
    else:
        index = result["provenance"]["index"]["id"]
        writer.writerow(["id", "direction", "area_ha", f"{index}_before", f"{index}_after",
                         f"{index}_change", "centroid_lon", "centroid_lat",
                         "clear_obs_before", "clear_obs_after"])
        for f in result["detections"]["features"]:
            p = f["properties"]
            writer.writerow([f["id"], p["direction"], round(p["areaHa"], 4), p["before"],
                             p["after"], p["change"], *p["centroid"],
                             p["clearObservationsBefore"], p["clearObservationsAfter"]])
    return buffer.getvalue()


@router.get("/analysis/{analysis_id}/export")
def export(
    analysis_id: str = PathParam(pattern=ID_PATTERN),
    format: str = Query(pattern="^(geojson|csv|json|gee)$"),
) -> Response:
    result = _result(analysis_id)
    extension = "js" if format == "gee" else format
    headers = {"Content-Disposition": f'attachment; filename="{analysis_id}.{extension}"'}
    if format == "csv":
        return PlainTextResponse(_csv(result), media_type="text/csv", headers=headers)
    if format == "gee":
        return PlainTextResponse(generate_change_script(result),
                                 media_type="text/javascript", headers=headers)
    if format == "json":
        return Response(json.dumps(result), media_type="application/json", headers=headers)
    if result["type"] != "change":
        raise AppError("GeoJSON export is available for change analyses.")
    collection = dict(result["detections"])
    # Foreign members carry the provenance with the geometry (RFC 7946 s6.1).
    collection["earthpulse"] = {
        k: result[k] for k in ("id", "softwareVersion", "valueKind", "provenance", "summary",
                               "warnings")
    }
    return Response(json.dumps(collection), media_type="application/geo+json", headers=headers)
