# Roadmap

Each phase ends in a tagged release. A box is ticked only when the feature
runs against real data and has tests.

## Phase 1 — Explore and measure (`v0.1.0`)

- [x] 3D globe with satellite basemap and place search
- [x] Layer panel with legend, value kind and provenance for each layer
- [x] Timeline that changes the imagery on the globe, with playback
- [x] Landsat 5/7/8/9 and Sentinel-2 annual layers, true and false colour
- [x] NDVI, NDWI, MNDWI, NDBI as map layers and as AOI statistics
- [x] AOI drawing (rectangle, polygon) and a Lahore District preset
- [x] Before/after comparison: swipe, blink, opacity
- [x] Index change detection with real job stages
- [x] Multi-year index series with gaps kept as gaps
- [x] Analysis panel, evidence panel, statistics and charts
- [x] GeoJSON, CSV, JSON and GeoTIFF export; Earth Engine script generation
- [x] Analysis IDs and shareable URLs
- [x] Lahore 1993 to today guided tour

Carried over to later releases:

- [ ] Camera bookmarks, measurement tools, circle and line drawing
- [ ] 2D map mode and a side-by-side dual view
- [ ] Day and month resolution on the timeline, event markers
- [ ] Terrain without a Cesium ion token
- [ ] Component-level frontend tests (current tests cover state and logic)
- [ ] Run the generated Earth Engine script in Earth Engine and record the difference

## Phase 2 — Thematic modes (`v0.2.0`)

- [x] FloodLens: Sentinel-1 before/flood/after, Otsu threshold with fallback, pre-existing
      water excluded, recession, flooded cropland and built-up area (ESA WorldCover)
- [ ] FloodLens: elevation context (the Copernicus DEM is not readable without credentials),
      VH polarisation, flood duration, affected roads, Earth Engine script
- [ ] WaterWatch: surface-water area, persistence and trend
- [ ] UrbanEye: built-up growth profile, surface temperature where thermal data exists
- [ ] ForestEye: loss, gain and disturbance with explicit terminology
- [ ] FireWatch: NASA FIRMS active-fire detections

## Phase 3 — Classification and carbon (`v0.3.0`)

- [ ] LULC engine (Random Forest, CART, SVM) with uploaded training data
- [ ] Validation: confusion matrix, overall/producer's/user's accuracy, F1, kappa
- [ ] CarbonWatch with user-defined pools and exposed equations

## Phase 4 — Research Lab (`v0.4.0`)

- [ ] Guided workflow from AOI to export
- [ ] PDF reports
- [ ] PostGIS store in place of the SQLite MVP store
- [ ] Optional Earth Engine processing backend

## Phase 5 — Assistant and stories (`v0.5.0`)

- [ ] Natural-language request to structured analysis, with confirmation step
- [ ] Assistant grounded in application state
- [ ] Voice commands
- [ ] Story mode

## Phase 6 — Global scale (`v0.6.0`)

- [ ] Event feed, regional scan, hotspot clustering
