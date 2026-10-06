# Deploying EarthPulse

EarthPulse has two parts that are hosted separately.

| Part | What it is | Where it runs |
|---|---|---|
| Frontend | Static files (React, CesiumJS) | GitHub Pages, deployed by `.github/workflows/pages.yml` on every push to `main` that touches `frontend/` |
| Backend | Python service (FastAPI, rasterio) | Any host that runs a container. Not deployed yet. |

Until a backend is deployed the public site runs in hosted mode: imagery,
timeline and comparison work, and analyses computed elsewhere are shown as
stored results. See the "Hosted mode" section of ARCHITECTURE.md.

## What needs a server and what does not

| Feature | Where it computes | Needs the backend? |
|---|---|---|
| Globe, layers, timeline, comparison | Visitor's browser | No |
| WaterWatch | Visitor's browser | No |
| Change detection, FloodLens | Python backend | Yes, until they are ported to the browser engine |

Analyses that run in the browser use the visitor's own processor, memory and
connection. The site then costs the same to run for one visitor or for a
thousand: GitHub Pages only serves the application's files.

### Why not Streamlit

Streamlit was considered for hosting and not chosen, for three reasons.

1. A Streamlit app runs every visitor's work on the server. That is the
   opposite of using the visitor's computer, and on a free tier (about 1 GB
   of memory shared by all visitors) a few simultaneous analyses would
   exhaust it.
2. It would replace the interface. The 3D globe, swipe comparison, drawing
   tools and timeline are browser code; Streamlit can only embed them in a
   frame, with clumsy communication between the frame and Python.
3. It does not remove the need for a host. It is a host with tighter limits
   than the one recommended below.

### Growing beyond free hosting

Signs that it is time to pay for hosting: GitHub Pages' soft limits (100 GB
of traffic a month, 1 GB site size) are approached, or the imagery provider
starts throttling requests from the site, or backend analyses queue for
minutes. The frontend can move to any static host unchanged, and the backend
is a container, so neither move requires code changes.

## Choosing a free host for the backend

An analysis holds several hundred megabytes of rasters in memory and spends
one to four minutes reading scenes. That rules out hosts with small memory.
Free tiers change often. The figures below are the ones the author knew when
this was written and have not been re-checked against the providers' current
pages, so confirm them before relying on them.

| Host | Free allowance | Fit |
|---|---|---|
| **Hugging Face Spaces (Docker)** | 2 vCPU, 16 GB RAM, sleeps after about 48 h without visits, temporary disk | **Recommended.** Enough memory for district-sized analyses; no payment card required. |
| Render (free web service) | 0.1 CPU, 512 MB RAM, sleeps after 15 min idle | Too little memory: a twelve-scene composite is likely to be killed. |
| Koyeb (free instance) | 0.1 vCPU, 512 MB RAM | Same memory problem as Render. |
| Google Cloud Run | Free monthly quota, several GB RAM per instance | Works, but needs a billing account and a card, and can cost money if misconfigured. |

What every free host shares: the service sleeps when idle, so the first
request after a pause is slow, and the disk is wiped on restart, so analysis
IDs created there stop resolving after a restart. Results worth keeping
should be exported with `backend/scripts/export_static.py`.

## Deploying the backend to Hugging Face Spaces

You need a free Hugging Face account. These steps have not been run by the
project yet, and the Dockerfile has not been built on Spaces.

1. Create a Space at https://huggingface.co/new-space with **SDK: Docker**
   (blank template), visibility public. Call it, for example,
   `earthpulse-api`.
2. Clone the Space and copy the backend into it:

   ```bash
   git clone https://huggingface.co/spaces/<your-username>/earthpulse-api
   cp -r backend/app backend/requirements.txt backend/Dockerfile earthpulse-api/
   ```

3. Put this at the top of the Space's `README.md`, then commit and push:

   ```yaml
   ---
   title: EarthPulse API
   emoji: 🌍
   colorFrom: green
   colorTo: blue
   sdk: docker
   app_port: 7860
   ---
   ```

4. When the build finishes, open
   `https://<your-username>-earthpulse-api.hf.space/api/health`. It should
   return `{"status": "ok", ...}`.

## Pointing the public site at the backend

In the GitHub repository: Settings → Secrets and variables → Actions →
Variables → New repository variable.

- Name: `EARTHPULSE_API_BASE`
- Value: the backend address without a trailing slash, for example
  `https://<your-username>-earthpulse-api.hf.space`

Then re-run the "Deploy to GitHub Pages" workflow. The site now sends
analyses to the backend. Delete the variable and redeploy to return to hosted
mode.

The backend only accepts browser requests from the origins listed in
`EARTHPULSE_CORS_ORIGINS`. The Dockerfile sets it to
`https://moosarazauaf.github.io`; change it there if the site moves.

## Limits to expect on a free host

- Rate limiting is per client address and held in memory.
- Two analyses run at a time; others queue.
- There are no accounts, so anyone with the address can start analyses. If
  that becomes a problem, lower `EARTHPULSE_RATE_LIMIT_PER_MINUTE` or
  `EARTHPULSE_MAX_AOI_KM2` in the Space's settings.
