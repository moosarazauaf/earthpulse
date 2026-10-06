"""Dataset catalogue: what each archive is, and how to read it correctly.

Provenance fields are shown to users verbatim. Scaling and masking rules come
from the providers' product guides, cited beside each constant.
"""
from dataclasses import asdict, dataclass, field
from datetime import date

import numpy as np

from app.core.errors import DatasetUnavailable

ACCESS_DATE = "2026-10-06"


@dataclass(frozen=True)
class Dataset:
    id: str
    name: str
    provider: str
    processing_level: str
    resolution_m: int
    temporal_coverage: str
    license: str
    attribution: str
    reference_url: str
    collection: str  # STAC collection id on Planetary Computer
    first_year: int
    bands: dict[str, str] = field(default_factory=dict)  # common name -> asset key
    qa_asset: str = ""
    access_date: str = ACCESS_DATE

    def public(self) -> dict:
        data = asdict(self)
        data["bands"] = list(self.bands)
        for private in ("collection", "qa_asset"):
            data.pop(private)
        return data


LANDSAT = Dataset(
    id="landsat",
    name="Landsat Collection 2 Level-2",
    provider="USGS / NASA",
    processing_level="Level-2 surface reflectance",
    resolution_m=30,
    temporal_coverage="1982 to present (Landsat 4, 5, 7, 8, 9)",
    license="Public domain (USGS)",
    attribution="Landsat imagery courtesy of the U.S. Geological Survey",
    reference_url="https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products",
    collection="landsat-c2-l2",
    first_year=1982,
    bands={"blue": "blue", "green": "green", "red": "red", "nir": "nir08",
           "swir1": "swir16", "swir2": "swir22"},
    qa_asset="qa_pixel",
)

SENTINEL2 = Dataset(
    id="sentinel2",
    name="Sentinel-2 Level-2A",
    provider="ESA / Copernicus",
    processing_level="Level-2A surface reflectance",
    resolution_m=10,
    temporal_coverage="2015 to present (global L2A coverage from about 2017)",
    license="Copernicus Sentinel data terms (free, full and open)",
    attribution="Contains modified Copernicus Sentinel data",
    reference_url="https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-2-msi",
    collection="sentinel-2-l2a",
    first_year=2016,
    bands={"blue": "B02", "green": "B03", "red": "B04", "nir": "B08",
           "swir1": "B11", "swir2": "B12"},
    qa_asset="SCL",
)

SENTINEL1 = Dataset(
    id="sentinel1",
    name="Sentinel-1 Radiometrically Terrain Corrected",
    provider="ESA / Copernicus; terrain correction by Catalyst for Microsoft",
    processing_level="GRD, radiometrically terrain corrected gamma-nought (linear power)",
    resolution_m=10,
    temporal_coverage="2014 to present",
    license="CC BY 4.0",
    attribution="Contains modified Copernicus Sentinel data, processed by Catalyst",
    reference_url="https://planetarycomputer.microsoft.com/dataset/sentinel-1-rtc",
    collection="sentinel-1-rtc",
    first_year=2014,
    bands={"vv": "vv", "vh": "vh"},
)

# Datasets offered for optical index analysis and map layers.
DATASETS: dict[str, Dataset] = {d.id: d for d in (LANDSAT, SENTINEL2)}

# ESA WorldCover 2021 v200 (10 m). A classified product, so anything derived
# from it inherits its classification error. Class codes from the WorldCover
# Product User Manual v2.0.
WORLDCOVER = {
    "name": "ESA WorldCover 2021 v200",
    "provider": "ESA / VITO",
    "resolution_m": 10,
    "license": "CC BY 4.0",
    "reference_url": "https://esa-worldcover.org/",
    "attribution": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data",
}
WORLDCOVER_CROPLAND = 40
WORLDCOVER_BUILT_UP = 50
WORLDCOVER_PERMANENT_WATER = 80


def get_dataset(dataset_id: str) -> Dataset:
    try:
        return DATASETS[dataset_id]
    except KeyError:
        raise DatasetUnavailable(f"Unknown dataset '{dataset_id}'.") from None


# ---- Landsat ---------------------------------------------------------------
# Collection 2 Level-2 surface reflectance: SR = DN * 0.0000275 - 0.2,
# fill value 0 (USGS, Landsat Collection 2 Level-2 Science Product Guide).
LANDSAT_SCALE = 0.0000275
LANDSAT_OFFSET = -0.2
# QA_PIXEL bits: 0 fill, 1 dilated cloud, 2 cirrus, 3 cloud, 4 cloud shadow,
# 5 snow.
LANDSAT_QA_REJECT = 0b0011_1111
# Landsat 7's scan-line corrector failed on 2003-05-31; later scenes carry
# wedge-shaped data gaps.
LANDSAT7_SLC_FAILURE = date(2003, 5, 31)


def landsat_platforms(year: int) -> tuple[list[str], str | None]:
    """Platforms to use for a year, and a note when the choice costs quality."""
    if year < 1999:
        return ["landsat-4", "landsat-5"], None
    if year <= 2002:
        return ["landsat-5", "landsat-7"], None
    if year <= 2011:
        return ["landsat-5"], None
    if year == 2012:
        # Landsat 5 had stopped imaging and Landsat 8 was not yet launched.
        return ["landsat-7"], (
            "2012 is covered only by Landsat 7 after its scan-line corrector "
            "failed, so composites for this year contain striped data gaps."
        )
    return ["landsat-8", "landsat-9"], None


# ---- Sentinel-2 ------------------------------------------------------------
# L2A reflectance = (DN + BOA_ADD_OFFSET) / 10000. Processing baseline 04.00
# (from 2022-01-25) introduced BOA_ADD_OFFSET = -1000; earlier baselines have
# no offset (ESA, Sentinel-2 Products Specification Document, issue 14.9).
S2_SCALE = 0.0001
S2_OFFSET_BASELINE = 4.0
S2_OFFSET_DN = -1000
S2_OFFSET_START_YEAR = 2022
# Scene classification classes rejected: 0 no data, 1 saturated/defective,
# 3 cloud shadow, 8 cloud medium probability, 9 cloud high probability,
# 10 thin cirrus, 11 snow/ice.
S2_SCL_REJECT = (0, 1, 3, 8, 9, 10, 11)


def to_reflectance(dataset: Dataset, dn: np.ndarray, baseline: float | None) -> np.ndarray:
    """Convert stored digital numbers to surface reflectance; fill becomes NaN."""
    values = dn.astype(np.float32)
    fill = dn == 0
    if dataset.id == "landsat":
        values = values * LANDSAT_SCALE + LANDSAT_OFFSET
    else:
        offset = S2_OFFSET_DN if (baseline or 0.0) >= S2_OFFSET_BASELINE else 0
        values = (values + offset) * S2_SCALE
    values[fill] = np.nan
    return values


def clear_mask(dataset: Dataset, qa: np.ndarray) -> np.ndarray:
    """True where the QA layer reports a usable clear-sky observation."""
    if dataset.id == "landsat":
        return (qa.astype(np.uint16) & LANDSAT_QA_REJECT) == 0
    return ~np.isin(qa, S2_SCL_REJECT)
