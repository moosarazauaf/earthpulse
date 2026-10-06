# Architecture

## Data flow

```
Browser (React + CesiumJS)
   │  JSON, PNG tiles
   ▼
EarthPulse API (FastAPI)
   ├── imagery service   → registers a STAC mosaic, proxies its tiles
   ├── analysis service  → searches scenes, reads COG windows, computes results
   ├── job runner        → background threads, real stage reporting
   └── store             → analysis records and output rasters
   │  HTTPS, allowlisted hosts only
   ▼
Imagery provider (default: Microsoft Planetary Computer)
```

The browser never talks to a data provider for analysis and never holds a
credential. It does load the basemap and labels directly from Esri.

## Backend

```
backend/app/
  main.py                 application factory
  models.py               request schemas (everything a client can send)
  core/
    config.py             settings from EARTHPULSE_* variables
    errors.py             user-safe errors and handlers
    http.py               outbound HTTP with a host allowlist
    ratelimit.py          sliding-window limiter
  datasets/catalog.py     provenance, band maps, scaling, cloud masks
  geospatial/
    geometry.py           AOI validation, geodesic area, UTM zone
    indices.py            NDVI, NDWI, MNDWI, NDBI
    raster.py             grids, scene selection, composites, PNG/GeoTIFF
  providers/
    base.py               ImageryProvider protocol, Scene, Grid
    planetary_computer.py STAC search + signed COG reads
    demo.py               synthetic data with a known answer (tests, offline)
    registry.py
  services/
    acquisition.py        AOI + dates → composite, with notes
    change_detection.py   bi-temporal index change
    timeseries.py         per-year AOI means, gaps kept as gaps
    imagery.py            annual tile layers and their presets
    jobs.py               background execution and analysis IDs
    store.py              SQLite store (PostGIS planned)
  gee/generator.py        Earth Engine script for a stored analysis
  api/                    catalog, imagery, analysis routers
```

### The provider interface

`ImageryProvider` has two methods: `search(dataset, bbox, start, end,
max_cloud, platforms)` and `read(scene, asset, grid, categorical)`. The
analysis code calls nothing else, so a Google Earth Engine or local-archive
backend is one new class registered in `providers/registry.py`. Each provider
declares `is_observed`; results built on a provider where it is false are
labelled `SIMULATED` throughout.

### How a change analysis runs

1. The AOI is validated and its geodesic area checked against the limit.
2. A north-up grid is built in the AOI's UTM zone. If the AOI would exceed the
   pixel budget at native resolution, the resolution is raised in whole
   multiples of the native pixel and the value used is reported.
3. For each period: STAC search, then the three clearest scenes per path/row
   or MGRS tile (at most twelve), so every part of the AOI gets up to three
   looks.
4. Each band is read as a window at about the grid's resolution, which lets
   GDAL use the file's overviews, and resampled onto the grid. The QA layer is
   read nearest-neighbour.
5. Digital numbers become surface reflectance; QA-flagged pixels become NaN;
   the per-pixel median across scenes is the composite.
6. The index is computed on both composites and differenced. Pixels whose
   change reaches the threshold are counted; contiguous regions above the
   minimum area are vectorised and described.
7. Outputs: summary statistics, a histogram, detection polygons in EPSG:4326,
   display PNGs reprojected to EPSG:4326, GeoTIFFs in UTM, the scene lists and
   every parameter.

Job stages (`ACQUIRING_DATA`, `PROCESSING_IMAGERY`, `CALCULATING_INDICES`,
`DETECTING_CHANGE`, `GENERATING_RESULTS`) are written by the pipeline as it
reaches them. The client polls and displays what it reads.

### Coordinate systems

| Purpose | CRS |
|---|---|
| AOI input, detections output, display rasters | EPSG:4326 |
| Raster processing, GeoTIFF output, pixel areas | UTM zone of the AOI centroid (EPSG:326xx / 327xx) |
| AOI area | Geodesic on the WGS84 ellipsoid |
| Imagery tiles | Web Mercator (EPSG:3857) tile grid |

Areas are never computed from degrees. A test checks pixel-count area in UTM
against the geodesic polygon area (agreement within 1%).

## Frontend

```
frontend/src/
  app/        store (zustand), api client, types, pure logic
  globe/      Globe (all Cesium calls), Drawing (AOI + picking), GlobeViewer
  layers/     LayerPanel
  timeline/   Timeline
  compare/    SwipeHandle
  analysis/   AnalysisForm, ContextPanel, Results, Evidence, charts
  demo/       Lahore tour
  ui/         TopBar, overlays, KindBadge
```

State lives in one store. React components describe what should be shown;
`GlobeViewer` turns store changes into calls on `Globe`, the only module that
imports Cesium rendering types. Rules that do not need a browser (season
windows, URL encoding, dataset fallback, formatting) are in `app/logic.ts` and
are unit tested.

Comparison uses Cesium's imagery split: the earlier year is clipped to the
left of the divider and the later year to the right. Both are layers on the
same globe, so pan and zoom cannot drift apart.

## Known limits of this version

- **Speed.** An analysis reads its scenes from cloud storage on demand. A
  district-sized area takes two to four minutes (Lahore District, 18 scenes, measured at 3 min 48 s), most of it network time.
- **SQLite, in-process jobs, in-memory rate limiter.** Correct for one
  process. PostGIS, a queue and Redis are the planned replacements; each sits
  behind one module.
- **Layer mosaics are not cloud-masked per pixel.** They show the least
  cloudy scenes of a year; analyses use masked median composites instead.
- **No cross-sensor harmonisation.** Results that span Landsat 5 and 8/9 say
  so in their warnings.
- **No terrain** unless a Cesium ion token is supplied.
- **No 2D map mode, measurement tools, or side-by-side dual view yet.**
