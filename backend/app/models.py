"""Request schemas. Everything a client can send is validated here."""
from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

DatasetId = Literal["landsat", "sentinel2"]
IndexId = Literal["ndvi", "ndwi", "mndwi", "ndbi"]
ProviderId = Literal["planetary-computer", "demo"]

# A compositing window longer than a year mixes seasons and stops being a
# statement about one point in time.
MAX_PERIOD_DAYS = 366
EARLIEST_DATE = date(1982, 1, 1)


class ApiModel(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")


class Period(ApiModel):
    start: date
    end: date

    @model_validator(mode="after")
    def _check(self) -> "Period":
        if self.end < self.start:
            raise ValueError("period end is before its start")
        if (self.end - self.start).days > MAX_PERIOD_DAYS:
            raise ValueError("a period may not be longer than one year")
        if self.start < EARLIEST_DATE:
            raise ValueError("no supported dataset covers dates before 1982")
        if self.start > date.today():
            raise ValueError("period starts in the future")
        return self


class AnalysisBase(ApiModel):
    aoi: dict[str, Any]
    label: str | None = Field(default=None, max_length=60)
    dataset: DatasetId = "landsat"
    max_cloud: float = Field(default=20.0, ge=0, le=100)
    provider: ProviderId = "planetary-computer"

    @field_validator("label")
    @classmethod
    def _clean_label(cls, value: str | None) -> str | None:
        return value.strip() or None if value else None


class ChangeRequest(AnalysisBase):
    index: IndexId = "ndvi"
    before: Period
    after: Period
    # Absolute change in index units that counts as a detection. None uses the
    # index default.
    threshold: float | None = Field(default=None, ge=0.02, le=1.0)
    min_area_ha: float = Field(default=0.5, ge=0, le=10_000)

    @model_validator(mode="after")
    def _ordered(self) -> "ChangeRequest":
        if self.after.start <= self.before.end:
            raise ValueError("the 'after' period must start after the 'before' period ends")
        return self


class FloodRequest(ApiModel):
    aoi: dict[str, Any]
    label: str | None = Field(default=None, max_length=60)
    before: Period
    flood: Period
    # Optional third window, to see how much of the flood had receded.
    after: Period | None = None
    # VV threshold in dB separating water from land. None lets Otsu's method
    # choose it from the flood-period histogram.
    threshold_db: float | None = Field(default=None, ge=-30.0, le=-5.0)
    min_area_ha: float = Field(default=1.0, ge=0, le=10_000)
    provider: ProviderId = "planetary-computer"

    @field_validator("label")
    @classmethod
    def _clean_label(cls, value: str | None) -> str | None:
        return value.strip() or None if value else None

    @model_validator(mode="after")
    def _ordered(self) -> "FloodRequest":
        if self.flood.start <= self.before.end:
            raise ValueError("the flood period must start after the 'before' period ends")
        if self.after and self.after.start <= self.flood.end:
            raise ValueError("the 'after' period must start after the flood period ends")
        return self


class TimeSeriesRequest(AnalysisBase):
    years: list[int] = Field(min_length=2, max_length=12)
    # Compositing window inside each year, as month numbers.
    start_month: int = Field(default=1, ge=1, le=12)
    end_month: int = Field(default=12, ge=1, le=12)

    @model_validator(mode="after")
    def _check(self) -> "TimeSeriesRequest":
        if self.end_month < self.start_month:
            raise ValueError("endMonth is before startMonth")
        if sorted(set(self.years)) != self.years:
            raise ValueError("years must be unique and ascending")
        if self.years[0] < 1982 or self.years[-1] > date.today().year:
            raise ValueError("years must lie between 1982 and the current year")
        return self
