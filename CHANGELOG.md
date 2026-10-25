# Changelog

All notable changes are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); each released version is a git tag.

## [Unreleased]

## [0.2.0-alpha.17] - 2026-10-25

### Added
- **Clouds** (K): the EUMETSAT world cloud map (Meteosat, GOES and
  Himawari infrared, every 3 hours) on a shell above the globe, looping
  through the past 24 hours and fading as the camera comes down to an area.
- **Rain and snow** (W): NASA GPM IMERG rate for the last 3 published half
  hours, looped under the place names.
- **Air quality at 476 cities** (Q): US AQI from CAMS through Open-Meteo,
  a dot per city in its band colour, the five worst listed in the Layers
  panel.
- Choosing an area picks Sentinel-2 (10 m) for areas up to 40 km across
  and Landsat (30 m) for larger ones, and a label shows while imagery loads.
- Privacy, Cookies and Terms pages, linked from the footer and from
  `?legal=privacy|cookies|terms`.

### Fixed
- An earlier version of the globe layers requested tiles that could not
  load (OpenWeatherMap URLs with no key, CIRA tiles without CORS) on every
  page load; it was replaced by the keyless sources above.
- Day-and-night shading, switched on by that version, darkened the imagery
  being analysed; it is off again.

## [0.2.0-alpha.16] - 2026-10-24

### Added
- **Ask in plain words.** A request typed in the search box ("floods in
  Layyah in August 2022", "how much has Lake Urmia shrunk since 2000", "is
  Lahore growing?") becomes an analysis: the kind, the place (geocoded, the
  area sized to the place up to 50 km), the years, months and season. The
  confirmation card shows what will run and every assumption made; a
  request that cannot be met gets a reason instead of a guess. It works by
  rules in the browser, not a language model, so it needs no server or key.
  A plain place name still searches as before.

## [0.2.0-alpha.15] - 2026-10-23

### Added
- **Air quality in the area overview.** US AQI with its EPA band, PM2.5,
  PM10, NO₂ and ozone from the CAMS model through Open-Meteo, and how many
  of the past seven days averaged above the WHO PM2.5 guideline.
- **Methods text.** Every result can copy a methods paragraph and a
  reference list written from its record, ready for a paper or report.
- Search and sharing: keyword-led title and description, canonical URL,
  Open Graph and Twitter card with a preview image, schema.org
  WebApplication data, and a crawlable description shown while the globe
  loads. The app is listed in the site's sitemap.

## [0.2.0-alpha.14] - 2026-10-22

### Fixed
- The sample-drawing tool stayed on after leaving Classify, so globe clicks
  elsewhere added hidden training points and stopped selecting markers.
- Classify froze on files with thousands of polygons: each polygon was
  masked against the whole grid; it is now masked only over its box.
- Classify trains on at most 20,000 sample pixels, sampled within each
  class, so very large sample files no longer take tens of minutes.
- Drawn training points now have the same colour as their class on the map.

## [0.2.0-alpha.13] - 2026-10-21

### Added
- **ForestEye: canopy loss since 1985.** Yearly Landsat NBR composites (5,
  8 or 12 years), and for each pixel the largest drop of at least 0.25 from
  dense canopy (NBR 0.4 or more), dated to the later year. Area per
  period, a map coloured by period, GeoTIFF of the year and CSV per period.
  On Rondonia (1988 to 2016) it found 4,323 ha of loss in 8,117 ha of 1988
  canopy, peaking in 1996 to 2000.
- Classify: draw training points on the globe. Type a class, press Draw
  points, click; switch class and click again. Drawn points join an
  uploaded file's samples or stand alone, each as its own feature in the
  train/test split, and show on the globe in their class colour.

### Removed
- The Urdu, Spanish and French screens and the language picker: the
  interface is English only.

### Verified
- Offline start: in headless Chrome, after one visit the service worker
  held the page, the build files and Cesium's files; with the network off,
  a reload still showed the opening card, the top bar and the globe.

## [0.2.0-alpha.12] - 2026-10-20

### Added
- **Classify** (Phase 3): land-cover classification with uploaded training
  samples (points or polygons, GeoJSON or zipped shapefile). Random forest
  (50 trees) on eight features from a Sentinel-2 or Landsat composite,
  samples split into training and test sets by feature, confusion matrix,
  overall accuracy, kappa, producer's and user's accuracy, F1, feature
  importance, class areas, GeoTIFF of the class map and CSV of the matrix.
  A built-in Lahore example (labels from ESA WorldCover 2021) to try it.
- **Error-adjusted areas** for classifications, with 95% confidence
  intervals (Olofsson et al. 2014), tested against the paper's worked
  example; labelled indicative when the test samples were not drawn at random.
- The service worker caches content-hashed build files and Cesium's files,
  so return visits load from the cache and the app opens offline.

## [0.2.0-alpha.11] - 2026-10-19

### Added
- **Watch my places**: with saved places, the app checks hazard news,
  USGS earthquakes and GDACS alerts near each one when it opens; the star
  button shows a count and My places lists what is near each place.
- **Rain lately** in the area overview: the last 3, 7 and 30 days of rain
  against the same days in 1991 to 2020, and a note on landslide
  conditions when an unusually wet week falls on steep ground (not a forecast).
- **Languages**: Urdu (right to left), Spanish and French for the top bar,
  opening card, Analyse menu and area overview, with a language picker.
  Place names come back in the chosen language.
- An error boundary around each panel, so one failing panel no longer
  blanks the page.

### Changed
- Accessibility: every main screen passes axe-core with no violations
  (landmarks, heading order, menu and dialog roles).
- Phones: the place search keeps its width in the top bar.
- Cesium and React load as separate cached files: after a release,
  returning visitors download 366 KB instead of 4.8 MB.
- The news scan is requested twice an hour, and the list shows how old the
  last scan is.
- Shared links accept only numbers, dates, short words and lists of years.

### Fixed
- Space activated the timeline instead of the focused button.
- A drawn or uploaded area kept the previous Analyse-here centre.
- Opening a new area left an old analysis running, whose result then
  replaced the new overview.
- Saving a second "Drawn area" replaced the first.

## [0.2.0-alpha.10] - 2026-10-16

### Added
- **HeatWatch** (Heat, and one-click analysis 6): hot-season land surface
  temperature from Landsat Collection 2, its spread, how much cooler
  vegetated ground is than bare or built ground, and change since an
  earlier year.
- **My places** (M, or the star button): saved areas and the last 15
  analyses, kept in this browser; Run again repeats an analysis after a
  reload. Shift+S saves the current area.
- **Terrain** in the area overview, from the AWS Terrain Tiles: elevation
  range, lowest and highest points, average slope and slope classes.
- **Measuring tool** (D): distance along the ground and enclosed area.
- **GeoTIFF export** for change, burn, flood and heat results run in the
  browser, georeferenced in their UTM zone, with a note on what the values mean.
- **Print report**: the area overview on white paper or as a PDF.
- Index series and heat results can be shared as links and re-run.

### Verified
- Traced region outlines on a real NDVI change in Lahore: 30 regions drawn
  as their shapes (up to 141 vertices) instead of boxes.

## [0.2.0-alpha.9] - 2026-10-16

### Added
- **Analyse here.** One click on the globe (or A) makes a square area of
  2, 5, 10 or 25 km around the spot, named from OpenStreetMap, and opens an
  overview: ESA WorldCover land-cover shares and map, the 1991-2020 climate
  with the last twelve months ranked against it (ERA5 via Open-Meteo), and
  hazard news, earthquakes and alerts nearby.
- **One-click analyses** in the overview, each with its defaults stated:
  vegetation change since 2000, an 8-year index series since 1990, surface
  water through time, built-up growth, tree cover, a flood check on the last
  14 days and a burn check on the last 30. Keys 1 to 7 start them.
- **ForestEye** (Forests): tree cover per year from the Impact Observatory
  maps, gains and losses, and what lost tree cover became.
- **Index series in the browser**, so Research works on the live site: up to
  12 years, per-decade trends from years with a clear view of most of the area.
- **Keyboard shortcuts** for navigation, area tools, the timeline and sharing;
  ? lists them.
- CSV export of browser results, and an Earth Engine script for change and
  burn analyses run in the browser.

### Changed
- Change and flood regions are drawn as traced outlines instead of bounding
  boxes, and are shown with the result.
- Drawing or uploading an area outside an analysis opens its overview; every
  analysis panel links back to the overview of its area.

### Fixed
- Clicking a news marker on the globe did nothing.

## [0.2.0-alpha.8] - 2026-10-15

### Added
- **Hazard news on the globe** (Live → In the news). Every hour a GitHub
  Actions job scans about 45 RSS feeds from more than 30 news outlets and UN services
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
