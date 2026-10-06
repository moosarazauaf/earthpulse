"""Runtime settings, read from environment variables prefixed EARTHPULSE_."""
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

SOFTWARE_VERSION = "0.1.1"
# Paths are anchored to the backend folder so the service behaves the same
# whatever directory it is started from.
BACKEND_DIR = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="EARTHPULSE_", env_file=BACKEND_DIR / ".env", extra="ignore")

    cors_origins: str = "http://localhost:5173"
    # 20 000 km2 is roughly a large district; bigger AOIs need the tiled
    # processing planned for phase 6.
    max_aoi_km2: float = 20_000.0
    # Pixels per band per scene. 1.5 M keeps a 12-scene, 4-band composite
    # under about 300 MB of float32 in memory.
    max_pixels: int = 1_500_000
    rate_limit_per_minute: int = 20
    data_dir: Path = BACKEND_DIR / "var"
    gee_service_account_file: str | None = None
    gee_project: str | None = None

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    if not settings.data_dir.is_absolute():
        settings.data_dir = BACKEND_DIR / settings.data_dir
    settings.data_dir.mkdir(parents=True, exist_ok=True)
    return settings
