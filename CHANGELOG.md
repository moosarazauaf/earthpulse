# Changelog

All notable changes are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); each released version is a git tag.

## [Unreleased]

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
