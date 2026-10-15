# Changelog

All notable changes are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); each released version is a git tag.

## [Unreleased]

### Added
- **Hazard news on the globe** (Live → In the news). Every hour a GitHub
  Actions job scans the RSS feeds of about 40 news outlets and UN services
  for earthquakes, floods, landslides, storms, wildfires, heavy rain and
  other natural hazards, places each headline from the place names in it
  (GeoNames), groups headlines about the same event, and republishes the
  site. Each story links to its sources, says how exactly it was placed, and
  is checked against the USGS earthquake catalogue and GDACS alerts.
- **"How did it happen?"** for each story: rain in the 3, 7 and 30 days
  before the event (or heat, or 90-day drought) ranked against the same days
  in every year from 1991 to 2020 (Open-Meteo, ERA5), and for earthquakes
  the depth and energy explained from the USGS record.
- **"See it from space"**: one click proposes FloodLens, FireWatch or a
  landslide-scar search with dates and an area worked out from the story,
  confirmed before anything downloads.
- The Live panel is split into three tabs (news, agency alerts, map layers)
  so it opens on one short list instead of everything at once.

### Changed
- **Simpler first screen.** The top bar has three entries, Live, Explore and
  Analyse; Analyse opens a menu that lists each analysis by the question it
  answers ("Where did flood water spread?"). The opening card offers three
  choices instead of seven, with the worked examples in one line beneath.
  The disabled Forests and Carbon buttons are gone (they are on the roadmap).
- The Layers panel starts closed and opens the first time Explore is chosen.

## [0.2.0-alpha.7] - 2026-10-15

### Added
- **FireWatch** (Fires mode): burn severity from dNBR with the Key and Benson
  (2006) classes, area per class and a severity map, from Landsat or
  Sentinel-2, in the browser. SWIR-2 is downloaded only for this analysis.
- **UrbanEye** (Cities mode): built area per year from 2017 to 2023, where it
  grew, and what land it replaced, counted from the Impact Observatory annual
  land-cover maps in the browser. Labelled MODELED, since the maps are
  machine-learning classifications.
- Shareable links for browser analyses: the link carries the recipe and
  re-runs the analysis on the recipient's device after they confirm.
- README rebuilt around real screenshots and an animation of the live app,
  CITATION.cff, a code of conduct, and issue and pull request templates.

### Changed
- The opening card is lower and shorter, so the globe is visible on arrival.
- Phones: the mode menu is a scrollable strip (it was hidden, which made
  every analysis unreachable on a phone), the top bar no longer overflows, the
  layers panel starts closed, and the opening card has a close button.

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

- **Live hazards mode**, aimed at the general public: red and orange alerts
  from GDACS as markers and a list, and map layers for active fire detections
  (NASA VIIRS), fire danger forecast (Copernicus GWIS), river flood forecasts
  for days 1 to 3 and 4 to 10, and observed flood extent (Copernicus GloFAS /
  GFM). Each layer says whether it is observed or modelled and what it is not.
- **Installable app.** A web manifest and service worker let browsers install
  EarthPulse as a standalone window. Nothing is cached.
- Earthquakes of the past week (USGS) in the Live view, search by typed
  coordinates with no network request, a Reset view control, and the time the
  live feeds were last read. These ideas were adapted from God's Eye View
  (MIT); no code, assets or data were taken from it.
- **Change detection and FloodLens in the browser.** Both now run on the
  visitor's device and therefore on the hosted site: the same composites,
  indices, thresholds, orbit selection, Otsu test, land-cover intersection and
  warnings as the backend. Regions are found by connected-component labelling
  and drawn as bounding boxes with their true areas.
- File reads time out and retry, so one stalled download no longer blocks an
  analysis, and the analysis grid now steps through the files' own overview
  levels (30, 60, 120 m ...), which reads provider-averaged pixels instead of
  subsampling a finer level.
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
- No landslide layer: no open landslide forecast service could be reached.
- Live layers are other agencies' products shown as published; EarthPulse has not validated them.
- The installed app was not test-installed; only the manifest and worker were built.
- Radar is slow on a slow connection: each Sentinel-1 pass costs about 10 MB.
- The browser and backend engines give close but not identical numbers.
- The index series and the Earth Engine script still need the backend.
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
