"""From an AOI and a date window to a cloud-free composite, with its paper trail."""
from dataclasses import dataclass, field
from datetime import date

from shapely.geometry.base import BaseGeometry

from app.core.errors import DatasetUnavailable, NoImagery
from app.datasets.catalog import Dataset, landsat_platforms
from app.geospatial.raster import Composite, build_composite, select_scenes
from app.providers.base import Grid, ImageryProvider

# The four bands that together give NDVI, NDWI, MNDWI and NDBI.
ANALYSIS_BANDS = ["green", "red", "nir", "swir1"]


@dataclass
class Acquisition:
    composite: Composite
    notes: list[str] = field(default_factory=list)

    @property
    def platforms(self) -> list[str]:
        return sorted({s.platform for s in self.composite.scenes})


def acquire(
    provider: ImageryProvider,
    dataset: Dataset,
    aoi: BaseGeometry,
    grid: Grid,
    start: date,
    end: date,
    max_cloud: float,
) -> Acquisition:
    if start.year < dataset.first_year:
        raise DatasetUnavailable(
            f"{dataset.name} does not cover {start.year}.",
            hint=f"It starts in {dataset.first_year}. Use Landsat for earlier dates.",
        )
    notes: list[str] = []
    platforms: list[str] | None = None
    if dataset.id == "landsat" and provider.is_observed:
        platforms, note = landsat_platforms(start.year)
        if note:
            notes.append(note)
    scenes = provider.search(dataset, aoi.bounds, start.isoformat(), end.isoformat(),
                             max_cloud, platforms)
    if not scenes:
        raise NoImagery(
            f"No {dataset.name} scene with at most {max_cloud:.0f}% cloud covers this area "
            f"between {start} and {end}.",
            hint="Widen the date window or raise the cloud limit.",
        )
    chosen = select_scenes(scenes)
    composite = build_composite(provider, dataset, chosen, ANALYSIS_BANDS, grid)
    return Acquisition(composite, notes)
