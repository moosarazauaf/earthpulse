# EarthPulse

**See what is changing on Earth.**

EarthPulse is an open-source Earth-observation platform. It puts a 3D globe,
open satellite archives and a reproducible analysis engine in one browser
application, so that a question like *"what changed here?"* gets an answer
that comes with its evidence.

> Status: early development. See [CHANGELOG.md](CHANGELOG.md) for what works
> today and [docs/ROADMAP.md](docs/ROADMAP.md) for what does not exist yet.

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

## Tests

```bash
cd backend && .venv/Scripts/python -m pytest
cd frontend && npm test
```

## Documentation

- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md)
- [docs/ROADMAP.md](docs/ROADMAP.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)
- [SECURITY.md](SECURITY.md)

## Responsible use

EarthPulse is an environmental science tool. It works at landscape scale on
public satellite data. It does not identify, track or profile people, and
contributions that move it in that direction will not be accepted.

## License

MIT. See [LICENSE](LICENSE). Satellite data keeps the license of its provider;
see [docs/DATA_SOURCES.md](docs/DATA_SOURCES.md).
