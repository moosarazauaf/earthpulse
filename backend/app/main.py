"""EarthPulse API."""
import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import analysis, catalog, imagery
from app.core.config import SOFTWARE_VERSION, get_settings
from app.core.errors import install_handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="EarthPulse API",
        version=SOFTWARE_VERSION,
        description="Imagery layers and reproducible change analyses from open satellite archives.",
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    install_handlers(app)
    for module in (catalog, imagery, analysis):
        app.include_router(module.router)
    return app


app = create_app()
