"""The contract every imagery backend implements.

The analysis engine depends only on this interface, so Planetary Computer,
Earth Engine or a local archive can be swapped without touching the science.
"""
from dataclasses import dataclass, field
from typing import Protocol

import numpy as np
from affine import Affine

from app.datasets.catalog import Dataset


@dataclass(frozen=True)
class Scene:
    id: str
    datetime: str  # ISO 8601, UTC
    platform: str
    cloud_cover: float | None
    footprint_key: str  # path/row or MGRS tile: scenes sharing it overlap fully
    assets: dict[str, str] = field(default_factory=dict, repr=False)
    processing_baseline: float | None = None
    collection: str = ""
    # Radar scenes: the viewing geometry must match between dates.
    relative_orbit: int | None = None
    orbit_state: str | None = None
    geometry: dict | None = field(default=None, repr=False)  # footprint, EPSG:4326

    def public(self) -> dict:
        return {
            "id": self.id,
            "datetime": self.datetime,
            "platform": self.platform,
            "cloudCover": self.cloud_cover,
            "footprint": self.footprint_key,
            "relativeOrbit": self.relative_orbit,
            "orbitState": self.orbit_state,
        }


@dataclass(frozen=True)
class Grid:
    """A north-up target raster grid in a projected CRS."""
    epsg: int
    transform: Affine
    width: int
    height: int

    @property
    def resolution(self) -> float:
        return self.transform.a

    @property
    def bounds(self) -> tuple[float, float, float, float]:
        west, north = self.transform.c, self.transform.f
        return (west, north - self.height * self.resolution,
                west + self.width * self.resolution, north)


class ImageryProvider(Protocol):
    id: str
    name: str
    # False for synthetic providers, so results can be labelled as demo data.
    is_observed: bool

    def search(
        self,
        dataset: Dataset,
        bbox: tuple[float, float, float, float],
        start: str,
        end: str,
        max_cloud: float | None,
        platforms: list[str] | None = None,
    ) -> list[Scene]:
        """Scenes intersecting bbox in [start, end], least cloudy first.

        max_cloud is None for sensors without a cloud measure (radar); those
        are returned oldest first.
        """
        ...

    def read(self, scene: Scene, asset: str, grid: Grid, categorical: bool) -> np.ndarray:
        """Read one asset resampled onto grid. Returns raw stored values."""
        ...

    def read_static(self, layer: str, grid: Grid) -> np.ndarray:
        """Read a dateless reference layer (for example land cover) onto grid."""
        ...
