"""Provider lookup. New backends (for example Earth Engine) register here."""
from functools import lru_cache

from app.core.errors import DatasetUnavailable
from app.providers.base import ImageryProvider
from app.providers.demo import DemoProvider
from app.providers.planetary_computer import PlanetaryComputerProvider

DEFAULT_PROVIDER = "planetary-computer"


@lru_cache
def _providers() -> dict[str, ImageryProvider]:
    return {p.id: p for p in (PlanetaryComputerProvider(), DemoProvider())}


def get_provider(provider_id: str = DEFAULT_PROVIDER) -> ImageryProvider:
    try:
        return _providers()[provider_id]
    except KeyError:
        raise DatasetUnavailable(f"Unknown imagery provider '{provider_id}'.") from None
