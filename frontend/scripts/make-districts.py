"""
Writes public/data/districts/: second-level administrative units (districts)
from FAO GAUL 2024 (CC BY 4.0), one GeoJSON file per country, simplified to
about 500 m like Earth Engine's FAO/GAUL_SIMPLIFIED_500m, and index.json with
each file's bounding box and country name so the browser knows which file
covers a point, and can try the searched country first.

Source: the GeoParquet copy on Source Cooperative (nlebovits/gaul-l2-admin),
partitioned by ISO3 code. GAUL 2015, the edition in Earth Engine's
FAO/GAUL/2015, may not be redistributed, so it is not used.

    pip install pyarrow shapely
    python scripts/make-districts.py /path/to/download/cache
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

import pyarrow.parquet as pq
import shapely

BUCKET = "https://data.source.coop/nlebovits/gaul-l2-admin/"
TOLERANCE_DEG = 0.005  # about 500 m at the equator
PRECISION_DEG = 0.0001  # about 11 m: finer than the simplification
OUT = Path(__file__).resolve().parent.parent / "public" / "data" / "districts"
# The bucket refuses Python's default user agent.
HEADERS = {"User-Agent": "EarthPulse district builder (https://github.com/moosarazauaf/earthpulse)"}


def get(url: str) -> bytes:
    return urllib.request.urlopen(urllib.request.Request(url, headers=HEADERS)).read()


def country_files() -> list[str]:
    listing = get(BUCKET).decode()
    return sorted(re.findall(r"<Key>gaul-l2-admin/by_country/([^<]+)\.parquet</Key>", listing))


def main(cache: Path) -> None:
    cache.mkdir(parents=True, exist_ok=True)
    OUT.mkdir(parents=True, exist_ok=True)
    index = {}
    for code in country_files():
        local = cache / f"{code}.parquet"
        if not local.exists():
            local.write_bytes(get(f"{BUCKET}by_country/{code}.parquet"))
        features = []
        for row in pq.read_table(local).to_pylist():
            geometry = shapely.from_wkb(row["geometry"])
            geometry = shapely.set_precision(geometry.simplify(TOLERANCE_DEG, preserve_topology=True), PRECISION_DEG)
            if geometry.is_empty:
                continue
            features.append({
                "type": "Feature",
                "properties": {"name": row["gaul2_name"], "admin1": row["gaul1_name"], "country": row["gaul0_name"], "code": row["gaul2_code"]},
                "geometry": shapely.geometry.mapping(geometry),
            })
        if not features:
            continue
        bounds = shapely.total_bounds([shapely.geometry.shape(f["geometry"]) for f in features])
        index[code] = [*(round(float(v), 3) for v in bounds), features[0]["properties"]["country"]]
        (OUT / f"{code}.json").write_text(json.dumps({"type": "FeatureCollection", "features": features}, separators=(",", ":")), encoding="utf-8")
        print(code, len(features), (OUT / f"{code}.json").stat().st_size // 1024, "KB")
    (OUT / "index.json").write_text(json.dumps(index, separators=(",", ":")), encoding="utf-8")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
