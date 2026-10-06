"""Export a finished analysis as static files for the hosted demo.

The GitHub Pages build has no analysis service, so it can only display
analyses that were computed here and exported. Usage, from backend/:

    python scripts/export_static.py EP-2026-LAHOREDISTRICT-2EBD2

Writes frontend/public/data/analyses/<id>/ and refreshes
frontend/public/data/catalog.json.
"""
import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.api.analysis import _csv  # noqa: E402
from app.api.catalog import datasets  # noqa: E402
from app.core.config import BACKEND_DIR, get_settings  # noqa: E402
from app.gee.generator import NotReproducible, generate_change_script  # noqa: E402
from app.services import jobs  # noqa: E402

PUBLIC_DATA = BACKEND_DIR.parent / "frontend" / "public" / "data"
# Display rasters plus the change GeoTIFF; the other GeoTIFFs can be
# regenerated from the Earth Engine script and would triple the download.
FILES = ("change.png", "before.png", "after.png", "change.tif")


def export(analysis_id: str) -> Path:
    record = jobs.get_store().get(analysis_id)
    if record is None or record["status"] != "COMPLETE":
        raise SystemExit(f"{analysis_id} is not a completed analysis in this store.")
    result = record["result"]
    record["stages"] = jobs.STAGES

    out = PUBLIC_DATA / "analyses" / analysis_id
    out.mkdir(parents=True, exist_ok=True)
    (out / "record.json").write_text(json.dumps(record), encoding="utf-8")
    (out / "export.json").write_text(json.dumps(result), encoding="utf-8")
    (out / "export.csv").write_text(_csv(result), encoding="utf-8")
    if result["type"] == "change":
        collection = dict(result["detections"])
        collection["earthpulse"] = {
            k: result[k] for k in ("id", "softwareVersion", "valueKind", "provenance", "summary",
                                   "warnings")
        }
        (out / "export.geojson").write_text(json.dumps(collection), encoding="utf-8")
        try:
            (out / "export.js").write_text(generate_change_script(result), encoding="utf-8")
        except NotReproducible as exc:
            print(f"no Earth Engine script: {exc.message}")
        source = get_settings().data_dir / "analyses" / analysis_id
        for name in FILES:
            shutil.copyfile(source / name, out / name)
    (PUBLIC_DATA / "catalog.json").write_text(json.dumps(datasets()), encoding="utf-8")
    return out


if __name__ == "__main__":
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    target = export(sys.argv[1])
    size = sum(f.stat().st_size for f in target.iterdir()) / 1e6
    print(f"wrote {target} ({size:.1f} MB)")
