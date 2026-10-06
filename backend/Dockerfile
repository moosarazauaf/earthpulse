# EarthPulse analysis service.
# Built for Hugging Face Spaces (Docker SDK), which expects port 7860 and runs
# the container as user 1000. It works unchanged on any container host.
FROM python:3.12-slim

RUN useradd --create-home --uid 1000 app
WORKDIR /home/app/backend

# rasterio, pyproj and shapely ship wheels that bundle GDAL, PROJ and GEOS,
# so no system packages are needed.
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY --chown=app:app app ./app
USER app

# The container's disk is temporary on free hosts: stored analyses and the
# tile cache are lost on restart.
ENV EARTHPULSE_DATA_DIR=/tmp/earthpulse \
    EARTHPULSE_CORS_ORIGINS=https://moosarazauaf.github.io \
    PORT=7860
EXPOSE 7860
CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT}"]
