# Roadmap

Each phase ends in a tagged release. A box is ticked only when the feature
runs against real data and has tests.

## Phase 1 — Explore and measure (`v0.1.0`)

- [ ] 3D globe with satellite basemap, search, camera bookmarks
- [ ] Layer system with a common interface, legend and provenance
- [ ] Timeline that changes the imagery on the globe
- [ ] Landsat 5/7/8/9 and Sentinel-2 annual composites
- [ ] NDVI, NDWI, MNDWI, NDBI as map layers and as AOI statistics
- [ ] AOI drawing (rectangle, polygon) and preset regions
- [ ] Before/after comparison (swipe, blink, opacity)
- [ ] Index change detection with real job states
- [ ] Analysis panel, evidence panel, statistics and charts
- [ ] GeoJSON and CSV export, Earth Engine script generation
- [ ] Analysis IDs and shareable URLs
- [ ] Lahore 1993 → 2026 demonstration

## Phase 2 — Thematic modes (`v0.2.0`)

- [ ] FloodLens: Sentinel-1 before/flood/after, Otsu threshold, permanent-water mask
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
