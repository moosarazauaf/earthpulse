# EarthPulse

**See what is changing on Earth.**

EarthPulse is an open-source Earth-observation platform. It puts a 3D globe,
open satellite archives and a reproducible analysis engine in one browser
application, so that a question like *"what changed here?"* gets an answer
that comes with its evidence.

**Live demo: https://moosarazauaf.github.io/earthpulse/**

Developed by [Muhammad Moosa Raza](https://moosarazauaf.github.io/).

> Status: Phase 2 in progress. Exploration, comparison, index change analysis,
> flood mapping and surface-water tracking work on real data. Forests, cities, fire, carbon, classification, the
> assistant and story mode are not built yet. [CHANGELOG.md](CHANGELOG.md)
> lists what works; [docs/ROADMAP.md](docs/ROADMAP.md) lists what does not.

## What it does today

- **Explore.** A 3D globe with annual Landsat (1984 on, 30 m) and Sentinel-2
  (2016 on, 10 m) layers in true colour, false colour, NDVI, NDWI, MNDWI and
  NDBI. A timeline moves through the years.
- **Compare.** Put two years under a swipe divider, blink between them, or
  blend them.
- **Measure.** Draw an area, pick two years and a season, and run a change
  analysis. The backend selects the clearest scenes, masks cloud, builds
  median composites, and reports where the index moved past a threshold.
- **Map floods.** FloodLens maps flood extent from Sentinel-1 radar for a
  before and a flood window, separates water that was already there, and
  reports the cropland and built-up land under water.
- **Track water.** WaterWatch maps surface water year by year for a lake,
  reservoir or river reach, and shows its area through time, how persistent
  each water pixel is, and what was lost or gained. It runs entirely in the
  visitor's browser, on their own computer, so it works on the live site.
- **Start from your area.** Every analysis begins by asking for an area: draw
  a rectangle or polygon, or upload a zipped shapefile or GeoJSON file.
- **Prove.** Each result has an Analysis ID, the list of scenes used, the
  method, its limits, exports, and an Earth Engine script that names the same
  scenes.

Example: Lahore District, October to December 1993 against the same months of
2025 (analysis run on 2026-10-06, 9 Landsat 5 and 9 Landsat 8/9 scenes, 60 m
working resolution, threshold 0.15): NDVI decreased on 179 km² and increased
on 220 km² of 1,674 km² analysed. That is an index result. It mixes urban
growth with changes in cropping, and no accuracy assessment has been made.

## The live demo and the full application

The live demo is the frontend alone, served by GitHub Pages. It can do
everything that needs only imagery: the globe, the annual layers, the
timeline, comparison and the Lahore tour, with tiles requested from Planetary
Computer by the browser. Analyses come in two kinds:

- **WaterWatch runs on the live site.** It is computed in the visitor's
  browser, which reads the satellite files directly. No server is involved.
- **Change detection and FloodLens still need the Python service** in
  `backend/`. On the live site they show real analyses the backend computed
  earlier, labelled as stored results. Moving them into the browser engine is
  on the roadmap.

## Design rule

**No claim without evidence.** Every number EarthPulse shows is tied to the
scenes, bands, dates, method and parameters that produced it, and is labelled
as observed, derived, modelled or estimated. Where data is missing the
application says so instead of filling the gap.

## Repository layout

```
backend/    FastAPI service: imagery providers, analysis engine, exports
frontend/   React + TypeScript + CesiumJS client
docs/       Architecture, data sources, roadmap
```

## Quick start

Backend (Python 3.11+):

```bash
cd backend
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements-dev.txt   # Windows
# source .venv/bin/activate && pip install -r requirements-dev.txt   # macOS/Linux
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

Frontend (Node 20+):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. No API key is needed for the default
configuration: imagery and analysis use the public Microsoft Planetary
Computer STAC archive. See [.env.example](.env.example) for optional settings.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Service status and version |
| GET | `/api/datasets` | Datasets, indices and their provenance |
| GET | `/api/geocode?q=` | Place search |
| GET | `/api/imagery/layer?dataset=&year=&render=` | Metadata, legend and tile template for a year layer |
| GET | `/api/imagery/tiles/{dataset}/{year}/{render}/{z}/{x}/{y}.png` | Map tiles |
| POST | `/api/analysis/change` | Start a change analysis; returns an Analysis ID |
| POST | `/api/analysis/timeseries` | Start a multi-year index series |
| POST | `/api/analysis/flood` | Start a Sentinel-1 flood analysis |
| GET | `/api/analysis/{id}` | Status, current stage, and the result when complete |
| GET | `/api/analysis/{id}/export?format=geojson\|csv\|json\|gee` | Exports |
| GET | `/api/analysis/{id}/files/{change\|before\|after}.{png\|tif}` | Result rasters |
| POST | `/api/gee/generate` | Earth Engine script for a stored analysis |

Interactive documentation is served at http://localhost:8000/docs.

## Method in brief

For each of the two periods the engine takes the three clearest scenes per
path/row (or Sentinel-2 tile), converts them to surface reflectance, rejects
pixels flagged by the QA layer, and takes the per-pixel median. The chosen
index is computed on both composites and differenced. Pixels whose change
reaches the threshold are counted, and contiguous regions are vectorised.
Raster work is done in the UTM zone of the area; the area of the AOI itself is
geodesic. Details and limits are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest
cd frontend && npm test
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [docs/DEPLOY.md](docs/DEPLOY.md): hosting the frontend and the backend
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)

## Author

EarthPulse is developed by Muhammad Moosa Raza
([portfolio](https://moosarazauaf.github.io/),
[GitHub](https://github.com/moosarazauaf)). The project is under active
development; see the roadmap for what comes next.

## Responsible use

EarthPulse is an environmental science tool. It works at landscape scale on
public satellite data. It does not identify, track or profile people, and
contributions that move it in that direction will not be accepted.

## License

MIT. See [LICENSE](LICENSE). Satellite data keeps the license of its provider;
see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
