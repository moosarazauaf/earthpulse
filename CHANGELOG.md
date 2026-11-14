# Changelog

All notable changes are recorded here. Versions follow
[Semantic Versioning](https://semver.org/); each released version is a git tag.

## [Unreleased]

## [0.2.0-alpha.39] - 2026-11-13

A user walkthrough of the live site: every opening card, Sentri prompt,
analysis, layer, Live tab, topic page and shortcut, on desktop and phone.

### Fixed
- **Sentri's model never answered** since the GIS tools: the app sent 15
  tools and the proxy refused more than 8 (HTTP 400), so every reply came
  from the built-in reader. Requests now carry the 8 tools that fit the
  message; the proxy accepts 24 once redeployed.
- The free model sometimes answered "Sorry, I did not catch that." to
  requests the rules understand ("buffer 2 km"); those now run. A network
  failure no longer shows the browser's raw "Failed to fetch".
- Built-in reader: "show wind", "show earthquakes" and "turn off clouds"
  switch layers instead of flying to a place named Wind.
- Wind layer hit Open-Meteo's free limit (HTTP 429) when switched on twice,
  which also broke the area forecast; the field is kept for 15 minutes.
- Live news: a story is labelled by what most of its headlines are about
  (eleven forest-fire headlines read as Flood).
- Agency alerts: empty entries in GDACS place lists are dropped
  ("Drought in Aruba, , Brazil").
- Charts: at most one decimal, "<0.1" for slivers (was "0.00107").
- Official figures: a UN API that does not answer says so, instead of
  reporting that the district has no record.
- Terrain and water-history tiles get one retry, so one timed-out tile no
  longer empties the terrain, slope map and risk check.

## [0.2.0-alpha.38] - 2026-11-11

### Added
- **Risk check** for anyone deciding whether to build, buy, farm or stay
  somewhere. At the top of every area overview, and from Sentri ("Is
  Nowshera safe?", "flood risk of Charsadda"), it rates in one word each:
  flooding (share of ground under water only some of the time since 1984,
  JRC Global Surface Water), landslides (share steeper than 15 degrees) and
  the next 7 days (forecast warnings). Each part is read on its own, so one
  slow source does not hold up the others. The first opening card now asks
  "Is this land safe to build on or buy?".
- **Nearest higher ground** for flood-prone places: the closest spot at least
  10 m above the centre (a whole 3 x 3 block of the height data, so a single
  building or tree is not taken for a hill), drawn on the map as a line with
  its distance and elevation profile. Nowshera: 1.5 km north, 15 m higher.

### Fixed
- The top-bar logo still read EARTHPULSE after the rename.

## [0.2.0-alpha.37] - 2026-11-10

### Changed
- **Renamed to Earthsift (formerly EarthPulse).** Other sites already rank
  for "EarthPulse". The app now lives at moosarazauaf.github.io/earthsift/ and
  github.com/moosarazauaf/earthsift; the old /earthpulse/ address and its
  topic pages forward to the new ones. Saved places, recent searches and Sentri
  history are kept (their storage keys did not change).
- **Problem-first opening screen.** It asks "What do you need to know about a
  place?" and offers eight common questions (is this land flooded, who is
  affected, is the coming week safe, how much carbon, how has it changed,
  maps for a report, buffer and terrain). Each opens Sentri with the question
  ready, or a typed question goes straight to Sentri.

### Added
- **GIS tools, also through Sentri:** measure area and perimeter, buffer an
  area by a distance, hillshade, slope and aspect maps on the globe (with a
  slope-class chart), and export the area as GeoJSON or KML. Short prompts
  work, for example "buffer 3 km", "slope map of Murree", "export kml".

## [0.2.0-alpha.36] - 2026-11-06

### Added
- **Time-lapse videos** (Layers panel, Save time-lapse video; or ask Sentri):
  the year layer steps through up to 21 evenly spread years (Landsat from
  1985, Sentinel-2 from 2017), each frame taken only once that year's
  mosaic has arrived and its tiles have loaded, stamped with the year, title
  and source, and recorded with the browser's MediaRecorder (MP4 where
  supported, else WebM). Recording pauses while each year loads, so the video
  has no waiting. Dubai, Sentinel-2, 2017 to 2025: 9 frames, 7.5 s, about 3
  minutes to record.

### Fixed
- Waiting for a complete view now waits for the new year's layer to arrive,
  for frames to be drawn and for Cesium to report its tiles loaded, and
  accepts a nearly complete view that has stopped changing.

## [0.2.0-alpha.35] - 2026-11-06

### Added
- **Hazard markers as pixel badges** on the globe: news stories by hazard
  (bigger with more outlets), earthquakes (bigger with magnitude) and GDACS
  alerts (border and corner flag in the alert level's colour).
- **Hover names**: resting the pointer on a marker shows what it is, with a
  hand cursor, without clicking.
- **Overlapping markers fan out** in a ring at the current zoom and settle back
  when zoomed in; only markers on screen and on the near side count.
- **Sentri**: "how many people live here" (GHS-POP 2020) and "make a map of
  this view" (the print-layout map). Lahore, central 100 km2: about 2.73
  million people, 27,370 per km2.

## [0.2.0-alpha.34] - 2026-11-06

### Added
- **Soil carbon** in the carbon stock: organic carbon in the top 30 cm from
  SoilGrids 2.0 (ISRIC, 250 m), with its 5% to 95% range, read from ISRIC's
  coverage service for the area. Layyah (20 km square): 827,188 t, 21.9 t
  C/ha, 192,000 t to 1.83 million t; identical to an independent rasterio
  sum.
- **Uncertainty** for plant carbon from the uncertainty layers published with
  Harmonized Global Biomass: the cautious range adds pixel errors (Layyah
  +/- 15,885 t; rasterio 15,743 t), with the range if errors were
  independent beside it, counting each 300 m map pixel once.
- **Publication figures**: every chart (change and backscatter histograms,
  index and water series, climate, elevation profile, and Sentri's carbon and
  land cover charts) saves as SVG or 300 dpi PNG at 160 mm, in a print style
  with title and data source. Sentri's carbon chart has error bars.
- **Publication maps**: Save map image (I) now makes a print layout: white
  page, title, the view at twice screen resolution inside a neat line, latitude
  and longitude ticks, a segmented scale bar, north arrow, legend and credits.

## [0.2.0-alpha.33] - 2026-11-06

### Added
- **Land use and land cover** through Sentri: hectares and share of each
  ESA WorldCover 2021 class for any area, shown on the map and in the
  overview. Layyah (20 km square): cropland 81%, trees 5%, built-up 5%.
- **Carbon stock**: carbon in living plants, above and below ground, and
  its CO2 equivalent, from the Harmonized Global Biomass map (Spawn et al.
  2020, 2010, 300 m) read in the browser. Layyah: 95,331 t C, 2.5 t C/ha;
  an independent rasterio sum of the same square gives 94,892 t (0.5%
  apart). Biomass only; soil carbon is not included.
- Sentri remembers the chat's context: each message tells the model the
  open area, screen, waiting plan and layers, so "there" and "the same
  place" work; history is trimmed by whole turns.
- The chat is kept in this browser and survives a reload; the bin button
  clears it. Suggested next steps appear as chips after an answer.

## [0.2.0-alpha.32] - 2026-11-06

### Added
- **Sentri**, the assistant's new face: an original pixel-art satellite
  (solar panels, radar dish, antenna light) drawn as crisp SVG squares in
  the earth palette. It bobs and blinks when idle, flaps its panels and
  sends radar waves while working, hops when an answer lands, and raises a
  "!" when a check finds a problem. Motion is stepped for a pixel feel and
  stops for visitors who ask for reduced motion.
- A redesigned chat: Sentri and a live status in the header, avatars on
  replies, example questions as chips, the runnable list folded away, a
  pixel typing indicator, and an "Ask Sentri" button in the corner.

### Fixed
- Long code in check results no longer makes the chat scroll sideways.

## [0.2.0-alpha.31] - 2026-11-05

### Changed
- The assistant is live, through the EarthPulse proxy on Cloudflare.
- Its replies are now written by code from what the tools actually did and
  found; the model only chooses the tools, and its own words are used only
  when it calls none. One model request per message instead of two or three.

### Fixed
- On the live site the model reported a planned flood map as already
  "generated", and invented a forecast for Multan ("air quality is
  moderate") while the overview it had opened showed unhealthy air (US AQI
  221). Both came from letting the model write about results it never saw.
- An exact flood window no longer carries the "No date given" note of the
  default window.

## [0.2.0-alpha.30] - 2026-11-05

### Added
- **Assistant** (Analyse, Ask the assistant): plain-language requests
  become analyses, area overviews or map layers. A free NVIDIA Nemotron
  model on OpenRouter chooses the tool; the app's own code builds the plan,
  so dates, windows and numbers never come from the model. Its arguments
  are range-checked before use. Without the proxy, a built-in reader
  handles the same requests.
- **Sentinel-1 plan checks** on the real archive before anything is
  downloaded: mixed relative orbits and directions (with each orbit's
  coverage), passes combined in the flood window, long flood windows, a
  single baseline pass and long gaps. Layyah, August 2022: orbits 5, 71 and
  173 found, orbit 5 used.
- **Earth Engine script checker**: paste a Sentinel-1 flood script to have
  it checked, in the browser, for a missing relative-orbit filter, mixed
  orbit numbers, .mosaic() and long composites, a mean or median over the
  flood period, a logarithm on data already in dB, and missing mode,
  polarisation, speckle and before-after steps.
- **agent-proxy/**: a Cloudflare Worker that holds the OpenRouter key,
  answers only the EarthPulse origins, forwards to free models only and
  limits each visitor to 20 requests a minute. Deploy steps in
  docs/DEPLOY.md.

### Fixed
- The flood engine's orbit choice is now one shared function, so the checks
  and the run always agree.

## [0.2.0-alpha.29] - 2026-11-04

### Added
- **Water since 1984** in the area overview: the share of the area that has
  been under water at least once, most of the time, or only sometimes, read
  from JRC Global Surface Water; floodplain ground is flagged before
  building or buying. Also a map layer in the Layers panel.
- **Solar power**: kWh a year per kW of panels from ten years of ERA5
  sunshine, by month, with the weakest month to size batteries for.
- **Cleanest air hours**: in the 7-day outlook, the cleanest 3 waking hours
  of the next day and the worst hour when the air is poor, or a plain
  statement when there is no clean window.

## [0.2.0-alpha.28] - 2026-11-04

### Added
- **Next 7 days** in the area overview: warnings when the forecast crosses
  heavy rain (50 mm a day), dangerous heat (feels like 39 °C), frost, gales
  (62 km/h) or unhealthy air (US AQI 150), a day-by-day table, and the
  week's rain against FAO reference evaporation, for planning irrigation.
- **Cloud forecast at each satellite pass**: whether the next Landsat or
  Sentinel-2 image is likely to be clear, within 7 days; Sentinel-1 radar
  marked as seeing through cloud.
- **Save map image** (I): the view as a PNG with title, scale bar, north
  arrow, legend and data credits, ready for a report.

### Fixed
- "in 1 days" in the satellite passes.

## [0.2.0-alpha.27] - 2026-11-03

### Added
- **Earth today, from NASA** (Layers panel): vegetation (MODIS NDVI, 8-day),
  soil moisture (SMAP Level 4), smoke and dust (MODIS aerosol optical depth)
  and ozone (OMPS total column), alongside sea temperature, one at a time,
  each with a legend sampled from NASA's colour map.
- **A page per map** for search engines: /wind-map/, /soil-moisture-map/,
  /earthquake-map/ and eleven more, each with its own title, description and
  text, opening the app with that layer on; all listed in sitemap.xml.

### Changed
- Sea surface temperature moved into Earth today.

## [0.2.0-alpha.26] - 2026-11-03

### Added
- **Surface wind now** (B): particles drifting with the 10 m wind from
  Open-Meteo's forecast models on a 10° grid between 60° S and 70° N,
  coloured by speed.
- **Sea surface temperature**: the latest daily NASA JPL MUR analysis
  through NASA GIBS, with a 0 to 32 °C legend.
- **Replay the week** of earthquakes (Live, Map layers): the past seven days
  of M4.5+ events appear on the globe in the order they struck, over about
  15 seconds.

## [0.2.0-alpha.25] - 2026-11-02

### Added
- **Elevation profile** along the measuring line (D): a cross-section of
  ground height from AWS Terrain Tiles, with lowest and highest point and
  total climb and descent. Islamabad to Murree: 518 m to 2,093 m over
  40.3 km.

## [0.2.0-alpha.24] - 2026-11-02

### Added
- **Views** (V): night vision, a thermal look and mono as filters over the
  globe, by brightness only and labelled as not a measurement.
- **Readout**: UTC time, the latitude and longitude under the pointer, and
  camera height.

## [0.2.0-alpha.23] - 2026-11-01

### Added
- **Satellites, live** (G): Landsat 8 and 9, Sentinel-2A, 2B and 2C and
  Sentinel-1A and 1C at their true height with the next 90 minutes of
  orbit, from CelesTrak elements propagated in the browser (satellite.js).
- **Next satellite passes** in the area overview: when each satellite next
  has the area inside its swath, in daylight for the optical ones. Lahore:
  Sentinel-2 at about 10:47 local solar time, Landsat at about 10:33.
- **Day and night now**: real-time night shading, off by default.

## [0.2.0-alpha.22] - 2026-11-01

### Added
- Earthquakes in Live can be clicked: magnitude, place, depth, age, the
  USGS PAGER damage estimate, tsunami flag, people within 100 km and a link
  to the USGS event page.

### Changed
- Golden-ratio proportions (Fibonacci sizes), Inter with tabular figures,
  and an earth-tone palette across the page and the globe.

### Fixed
- On phones the timeline pushed the page wider than the screen and the
  footer links fell below it; the opening card now fits with the globe in
  view.

## [0.2.0-alpha.21] - 2026-10-28

### Added
- **People affected** in flood and fire results: how many people live on
  the land mapped as newly flooded or burned, out of everyone in the area
  (GHS-POP 2020 sampled against the result's own map). Layyah, August 2022:
  about 6,170 people on newly flooded land.
- **People near an alert** in Live: how many live within 100 km of an
  earthquake or cyclone alert (50 km for other kinds). Cyclone Arnab:
  about 11.2 million.
- Visit counting with Umami Cloud (cookie-free, Do Not Track respected,
  live site only), switched on by setting the repository variable
  `UMAMI_WEBSITE_ID`. The privacy and cookie pages describe it only when
  it is on.

## [0.2.0-alpha.20] - 2026-10-26

### Added
- **People in the area**: GHS-POP 2020 (JRC, about 90 m) read from a public
  COG, summed inside the area's outline. Leiah district: 1.88 million in
  2020, against census counts of 1.82 million (2017) and 2.10 million (2023).
- **Official figures** in the area overview: World Bank country statistics
  and the area's share of the national population; IPC Phase 3+ food
  insecurity and WFP rainfall anomalies from UN OCHA's Humanitarian API where
  the UN tracks the district; and a stated cross-check between the GHS-POP
  count and the population the IPC analysis implies.

### Fixed
- Cloud and rain animations stuttered: clouds re-uploaded whole images at
  every step (now one atlas texture), and rain switched frames instantly
  (now an eased cross-fade every frame).

## [0.2.0-alpha.19] - 2026-10-26

### Added
- **Population density layer**: NASA SEDAC Gridded Population of the World
  v4 (2020, about 1 km) through NASA GIBS, under the place names, with a
  legend in people per km² taken from GIBS's own colour map.

## [0.2.0-alpha.18] - 2026-10-26

### Added
- **District outlines.** Picking a search result outlines the district
  around it, from FAO GAUL 2024 second-level units (CC BY 4.0), simplified
  to about 500 m and served with the site, one file per country. The card
  offers to analyse the whole district or download its outline as GeoJSON.
  The district is found by position, so spelling differences do not matter,
  and the searched country's file is tried first.

### Changed
- Flying to an area now leaves room for the open side panels and the
  district card, so the area is not hidden behind them.

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
