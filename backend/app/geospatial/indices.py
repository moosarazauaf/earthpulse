"""Spectral indices.

All four are normalised differences of two surface-reflectance bands, so the
value range is [-1, 1]. Band names are EarthPulse's common names; each dataset
maps them to its own assets.
"""
from dataclasses import dataclass

import numpy as np


@dataclass(frozen=True)
class IndexDef:
    id: str
    name: str
    positive: str  # band added in the numerator
    negative: str  # band subtracted in the numerator
    measures: str
    reference: str
    # Smallest absolute change treated as a detection by default. These are
    # starting points for exploration, not validated thresholds.
    default_threshold: float

    @property
    def formula(self) -> str:
        return f"({self.positive} - {self.negative}) / ({self.positive} + {self.negative})"

    @property
    def bands(self) -> tuple[str, str]:
        return (self.positive, self.negative)


INDICES: dict[str, IndexDef] = {
    i.id: i
    for i in (
        IndexDef(
            "ndvi", "NDVI", "nir", "red",
            "Green vegetation vigour and cover",
            "Rouse et al. 1974; Tucker 1979",
            0.15,
        ),
        IndexDef(
            "ndwi", "NDWI", "green", "nir",
            "Open surface water",
            "McFeeters 1996",
            0.15,
        ),
        IndexDef(
            "mndwi", "MNDWI", "green", "swir1",
            "Open surface water, less confused by built-up land than NDWI",
            "Xu 2006",
            0.15,
        ),
        IndexDef(
            "ndbi", "NDBI", "swir1", "nir",
            "Built-up and bare surfaces (does not separate the two)",
            "Zha, Gao and Ni 2003",
            0.10,
        ),
    )
}


def normalized_difference(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(a - b) / (a + b) as float32, NaN where either input is NaN or a + b <= 0.

    A non-positive sum only occurs for invalid surface reflectance, so those
    pixels are dropped rather than allowed to produce values outside [-1, 1].
    """
    a = a.astype(np.float32, copy=False)
    b = b.astype(np.float32, copy=False)
    total = a + b
    out = np.full(a.shape, np.nan, dtype=np.float32)
    ok = np.isfinite(total) & (total > 0)
    np.divide(a - b, total, out=out, where=ok)
    return np.clip(out, -1.0, 1.0)


def compute_index(index_id: str, bands: dict[str, np.ndarray]) -> np.ndarray:
    index = INDICES[index_id]
    return normalized_difference(bands[index.positive], bands[index.negative])


def required_bands(index_ids: list[str]) -> list[str]:
    seen: list[str] = []
    for index_id in index_ids:
        for band in INDICES[index_id].bands:
            if band not in seen:
                seen.append(band)
    return seen
