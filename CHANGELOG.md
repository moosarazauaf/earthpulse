# Changelog

All notable changes are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); each released version is a git tag.

## [Unreleased]

Phase 2 in progress.

### Added
- **FloodLens.** Flood extent from Sentinel-1 radar (RTC, VV) with before,
  flood and optional after windows. One relative orbit is used throughout,
  chosen by its worst-period coverage of the area. Water is separated with
  Otsu's threshold when the histogram is bimodal, otherwise a fixed -17 dB,
  and a flooded pixel must also have dropped by 3 dB. Reports flooded area,
  pre-existing water, recession, threshold sensitivity, and flooded cropland
  and built-up area from ESA WorldCover 2021.
- Floods mode in the interface, with the flood-extent and radar layers on the
  globe and a stored example (Indus at Layyah, 2022) in the hosted demo.
- `backend/Dockerfile` and `docs/DEPLOY.md` for hosting the backend; the
  Pages build reads the backend address from a repository variable.

- **Browser analysis engine** (`frontend/src/engine/`). Scene search,
  cloud-optimised GeoTIFF reading, cloud masking, compositing and map
  rendering run in a web worker on the visitor's machine. The grid size and
  download parallelism follow the device's reported cores and memory, and the
  visitor can choose fast, balanced or detailed.
- **WaterWatch**, built on that engine: yearly MNDWI water maps, area series
  with gaps kept as gaps, persistence, lost and gained water, a year player on
  the globe, and CSV, JSON and PNG export. It works on the hosted site.
- **Area prompt.** Entering an analysis mode asks which area to study, with
  draw rectangle, draw polygon, upload (zipped shapefile or GeoJSON) and
  example areas. Uploaded files are read in the browser.

### Known limits
- Change detection and FloodLens still run only on the Python backend.
- Browser-run results live in the tab; they have no shareable link yet.
- Shapefile upload is unit tested on parsed input but has not been tried with
  a real .zip in a browser.
- No accuracy assessment of the flood maps or the water maps. Elevation context is missing.
- The Dockerfile has not been built on a host yet.

## [0.1.1] - 2026-10-06

### Added
- Hosted mode for static deployment: with no analysis service configured, the
  client requests imagery layers from Planetary Computer directly and serves
  exported analyses as stored results. New analyses are refused with an
  explanation instead of failing.
- `backend/scripts/export_static.py`, which exports a finished analysis for
  the hosted demo; the Lahore District 1993 and 2025 NDVI analysis is included.
- GitHub Pages deployment workflow. Live at
  https://moosarazauaf.github.io/earthpulse/.
- Author credit in the interface and the README.

### Changed
- Imagery layers no longer request tiles below their first zoom level.
- The dev server reads the API address from `frontend/.env.development`.

## [0.1.0] - 2026-10-06

First working release: explore four decades of imagery on a globe and run a
real change analysis with its evidence attached.

### Added
- FastAPI backend reading Landsat Collection 2 Level-2 and Sentinel-2 L2A
  from the public Planetary Computer archive, with no API key.
- Bi-temporal index change detection (NDVI, NDWI, MNDWI, NDBI): masked median
  composites, change raster, threshold sensitivity, vectorised regions.
- Multi-year index series that reports missing years instead of filling them.
- Annual imagery layers (true colour, false colour, four indices) through a
  tile proxy with fixed server-side presets.
- Analysis IDs, stored records, exports (GeoJSON, CSV, JSON, GeoTIFF) and an
  Earth Engine script generator that names the same scenes.
- React + CesiumJS client: layer panel, timeline with playback, swipe / blink /
  opacity comparison, rectangle and polygon AOI drawing, analysis and evidence
  panels, data-sources sheet, shareable URLs, Lahore guided tour.
- Host allowlist for outbound requests, sanitised errors, rate limiting,
  strict request validation.
- 34 backend tests on a synthetic provider with a known answer; 15 frontend
  tests; CI workflow.

### Known limits
- A district-sized analysis takes two to four minutes.
- The generated Earth Engine script has not yet been run in Earth Engine.
- Polygon drawing and the blink and opacity comparison modes have unit-level
  coverage only; rectangle drawing and swipe were checked in a browser.
- See docs/ARCHITECTURE.md for the rest.

## [0.0.1] - 2026-10-06

### Added
- Repository scaffold, license, environment template.
