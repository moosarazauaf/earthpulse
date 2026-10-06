import json
import time

import pytest
from fastapi.testclient import TestClient

from app.core import http, ratelimit
from app.core.errors import RateLimited
from app.main import app

client = TestClient(app)


def _wait(analysis_id: str) -> dict:
    for _ in range(200):
        record = client.get(f"/api/analysis/{analysis_id}").json()
        if record["status"] in ("COMPLETE", "FAILED"):
            return record
        time.sleep(0.05)
    raise AssertionError("analysis did not finish")


def test_health_and_catalogue():
    assert client.get("/api/health").json()["status"] == "ok"
    body = client.get("/api/datasets").json()
    assert {d["id"] for d in body["datasets"]} == {"landsat", "sentinel2"}
    for dataset in body["datasets"]:
        for key in ("provider", "resolution_m", "license", "attribution", "reference_url",
                    "access_date", "processing_level", "temporal_coverage"):
            assert dataset[key], key
    assert {i["id"] for i in body["indices"]} == {"ndvi", "ndwi", "mndwi", "ndbi"}


def test_change_analysis_lifecycle_and_exports(demo_change_body):
    submitted = client.post("/api/analysis/change", json=demo_change_body)
    assert submitted.status_code == 202
    analysis_id = submitted.json()["id"]
    assert analysis_id.startswith("EP-") and "-TESTAREA-" in analysis_id

    record = _wait(analysis_id)
    assert record["status"] == "COMPLETE", record["error"]
    result = record["result"]
    assert result["summary"]["lossAreaHa"] > 0

    png = client.get(result["overlays"]["change"]["url"])
    assert png.status_code == 200 and png.content[:4] == b"\x89PNG"
    tif = client.get(result["overlays"]["change"]["geotiff"])
    assert tif.status_code == 200 and tif.content[:2] in (b"II", b"MM")

    geojson = client.get(f"/api/analysis/{analysis_id}/export?format=geojson").json()
    assert geojson["type"] == "FeatureCollection" and geojson["features"]
    assert geojson["earthpulse"]["id"] == analysis_id  # provenance travels with the data
    assert geojson["earthpulse"]["valueKind"] == "SIMULATED"

    csv_text = client.get(f"/api/analysis/{analysis_id}/export?format=csv").text
    assert "ndvi_before" in csv_text and "decrease" in csv_text

    gee = client.post("/api/gee/generate", json={"analysisId": analysis_id})
    assert gee.status_code == 400 and gee.json()["error"]["code"] == "not_reproducible"


def test_timeseries_lifecycle(aoi):
    body = {"aoi": aoi, "years": [2000, 2020], "provider": "demo"}
    analysis_id = client.post("/api/analysis/timeseries", json=body).json()["id"]
    record = _wait(analysis_id)
    assert record["status"] == "COMPLETE"
    assert [e["year"] for e in record["result"]["series"]] == [2000, 2020]
    assert "year,period_start" in client.get(f"/api/analysis/{analysis_id}/export?format=csv").text


def test_errors_are_sanitised(demo_change_body):
    bad = {**demo_change_body, "aoi": {"type": "Point", "coordinates": [0, 0]}}
    response = client.post("/api/analysis/change", json=bad)
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_aoi"

    huge = {**demo_change_body, "aoi": {"type": "Polygon", "coordinates": [
        [[60, 20], [80, 20], [80, 40], [60, 40], [60, 20]]]}}
    response = client.post("/api/analysis/change", json=huge)
    assert response.json()["error"]["code"] == "aoi_too_large"
    assert "smaller" in response.json()["error"]["hint"]

    response = client.post("/api/analysis/change", json={**demo_change_body, "index": "evil"})
    assert response.status_code == 422
    assert "Traceback" not in json.dumps(response.json())

    assert client.get("/api/analysis/EP-2026-NOPE-ABCDE").status_code == 404
    assert client.get("/api/analysis/not-an-id").status_code == 422


def test_file_endpoint_cannot_be_used_for_path_traversal():
    for name in ("..%2F..%2Fearthpulse.sqlite3", "change.png%2F..%2F..", "secrets.env"):
        response = client.get(f"/api/analysis/EP-2026-TEST-00000/files/{name}")
        assert response.status_code in (404, 422)


def test_outbound_requests_are_allowlisted():
    assert http.is_allowed_url("https://planetarycomputer.microsoft.com/api/stac/v1/search")
    assert http.is_allowed_url("https://landsateuwest.blob.core.windows.net/landsat-c2/x.TIF")
    for url in (
        "http://planetarycomputer.microsoft.com/",  # not https
        "https://169.254.169.254/latest/meta-data/",
        "https://localhost/admin",
        "https://blob.core.windows.net.evil.example/x.tif",
        "https://evil.example/?x=.blob.core.windows.net",
        "file:///etc/passwd",
    ):
        assert not http.is_allowed_url(url), url


def test_tile_endpoint_validates_and_short_circuits_low_zoom():
    low = client.get("/api/imagery/tiles/landsat/1993/truecolor/2/1/1.png")
    assert low.status_code == 200 and low.content[:4] == b"\x89PNG"  # transparent, no upstream call
    assert client.get("/api/imagery/tiles/landsat/1993/nope/9/1/1.png").status_code == 404
    assert client.get("/api/imagery/tiles/other/1993/truecolor/9/1/1.png").status_code == 422
    assert client.get("/api/imagery/tiles/sentinel2/1993/truecolor/9/1/1.png").status_code == 404


def test_rate_limiter():
    ratelimit.reset()
    for _ in range(3):
        ratelimit.check("k", limit=3, now=100.0)
    with pytest.raises(RateLimited):
        ratelimit.check("k", limit=3, now=101.0)
    ratelimit.check("k", limit=3, now=200.0)  # window has passed
