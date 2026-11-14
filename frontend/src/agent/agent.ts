/**
 * The Earthsift assistant. A free model on OpenRouter (NVIDIA Nemotron,
 * through the Earthsift proxy that holds the key) reads the request and
 * calls tools; the tools do the work with the same code as the rest of the
 * app. Every number, date window and validity finding comes from code, not
 * from the model. Without the proxy, a rule-based reader handles the same
 * requests.
 */
import { api } from "../app/api";
import { formatLatLon, squareAround } from "../app/logic";
import { useStore } from "../app/store";
import type { AoiGeometry, Period } from "../app/types";
import { modeForRun } from "../app/shareRun";
import { type Ask, interpret } from "../ask/interpret";
import { STREET, requestRun } from "../ask/request";
import { carbonInBrowser, deviceProfile, landCoverInBrowser, PIXEL_BUDGET, populationInBrowser } from "../engine/client";
import { formatPeople } from "../engine/population";
import { saveFigure } from "../ui/saveFigure";
import { downloadText } from "../analysis/download";
import { SLOPE_CLASSES, fetchTerrain } from "../area/elevation";
import { bufferGeometry, geometryInfo, toGeoJson, toKml } from "../area/gis";
import { TERRAIN_KINDS, type TerrainKind, terrainOverlay } from "../area/terrainMap";
import { startTimelapse } from "../ui/timelapse";
import { CO2_PER_C } from "../engine/carbon";
import { WORLDCOVER } from "../engine/cover";
import type { BarChartSpec } from "../ui/Figure";
import { EARTH_LAYERS } from "../globe/earthToday";
import { geometryBounds } from "../globe/Globe";
import { getGlobe } from "../globe/GlobeViewer";
import { isS1Script, lintGeeScript } from "./geeLint";
import { fetchOutlook, warnings } from "../area/outlook";
import { RISK_SOURCES, riskCheck } from "../area/risk";
import { type Finding, checkFloodPlan } from "./s1checks";
import { KINDS, abilitiesText, toolNamesFor, askFromArgs, asksAbilities, floodDates, honest, num, offlineIntent, placeFromText, str, trimHistory } from "./args";

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "";
/** True when the site was built with the model proxy's address. */
export const agentOnline = AGENT_URL.startsWith("https://");

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface Message { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

/** What the chat shows besides text: a planned run, or a list of check results. */
export type Card =
  | { kind: "plan"; title: string; lines: string[]; findings: Finding[] }
  | { kind: "checks"; title: string; findings: Finding[] }
  | { kind: "facts"; title: string; lines: string[]; findings: Finding[]; chart?: BarChartSpec };


export const TOOLS = [
  {
    type: "function",
    function: {
      name: "plan_analysis",
      description: "Plan a satellite analysis over a place and show it for the user to confirm. flood: Sentinel-1 radar flood mapping (2014 on), checked for mixed orbits and compositing. burn: burn scar. vegetation: NDVI-style change between two years. water: surface water through years. urban: built-up growth. trees: canopy loss. heat: land surface temperature. series: an index year by year.",
      parameters: {
        type: "object",
        properties: {
          kind: { type: "string", enum: KINDS },
          place: { type: "string", description: "Town, district or feature with its country, e.g. 'Layyah, Pakistan'. Omit to use the area already chosen." },
          lat: { type: "number" }, lon: { type: "number" },
          size_km: { type: "number", description: "Side of the square analysed, 1 to 50 km. Omit to fit the place." },
          years: { type: "array", items: { type: "integer" }, description: "Years named, e.g. [2000, 2024]." },
          months: { type: "array", items: { type: "integer" }, description: "First and last month, 1 to 12, e.g. [8, 9]." },
          flood_start: { type: "string", description: "Flood window start, YYYY-MM-DD, when an exact date is known. Keep the window 10 to 24 days around the peak." },
          flood_end: { type: "string", description: "Flood window end, YYYY-MM-DD." },
          index: { type: "string", enum: ["ndvi", "ndwi", "mndwi", "ndbi"] },
        },
        required: ["kind"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "open_area",
      description: "Fly to a place and open its area overview: 7-day forecast and warnings, air quality, rain lately, climate, solar power, water since 1984, terrain, land cover, people, next satellite passes and hazards nearby.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } }, required: ["place"] },
    },
  },
  {
    type: "function",
    function: {
      name: "show_layers",
      description: "Turn live map layers on or off.",
      parameters: {
        type: "object",
        properties: {
          wind: { type: "boolean" }, clouds: { type: "boolean" }, rain: { type: "boolean" }, air_quality: { type: "boolean" },
          earthquakes: { type: "boolean" }, satellites: { type: "boolean" }, water_history: { type: "boolean" }, population: { type: "boolean" },
          earth_today: { type: "string", enum: [...EARTH_LAYERS.map((l) => l.id), "off"], description: "sst sea temperature, ndvi vegetation, soil moisture, aerosol smoke and dust, ozone." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "land_cover",
      description: "Land use and land cover (LULC) of an area from ESA WorldCover 2021 at 10 m: hectares and share of trees, cropland, built-up, water and the other classes, shown on the map. Omit place to use the area already open.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "carbon_stock",
      description: "Carbon stored in living plants (above- and below-ground biomass) over an area, in tonnes of carbon and CO2 equivalent, from the Harmonized Global Biomass map (2010, 300 m). Omit place to use the area already open.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "people_count",
      description: "How many people live in an area, from GHS-POP 2020 (European Commission JRC, about 100 m). Omit place to use the area already open.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "save_map",
      description: "Save the current map view as a publication-ready image: title, coordinate ticks, scale bar, north arrow, legend and credits.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "time_lapse",
      description: "Record a time-lapse video of a place through the years from Landsat (1985 on) or Sentinel-2 (2017 on): one frame a year. Omit place to use the area already open.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "buffer",
      description: "GIS buffer: grow the area outward by a distance on every side and make that the new area, e.g. everything within 5 km of a town or district. Omit place to buffer the area already open.",
      parameters: { type: "object", properties: { km: { type: "number", description: "Buffer distance in km, 0.1 to 100." }, place: { type: "string" }, size_km: { type: "number" } }, required: ["km"] },
    },
  },
  {
    type: "function",
    function: {
      name: "terrain",
      description: "Terrain analysis of an area (zonal statistics of elevation and slope): lowest, highest and mean height, mean slope and the share in each slope class. Optionally draw a hillshade, slope or aspect map on the globe. Omit place to use the area already open.",
      parameters: { type: "object", properties: { map: { type: "string", enum: ["hillshade", "slope", "aspect", "none"] }, place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "risk_check",
      description: "Is a place safe to build, buy, farm or visit? Rates flooding (water seen since 1984), landslides (slope) and the next 7 days (rain, heat, frost, gales, air), and finds the nearest higher ground for flood-prone places. Omit place to use the area already open.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "measure_area",
      description: "Geometry of the area: its area, perimeter, centre point and bounding box. Omit place to use the area already open.",
      parameters: { type: "object", properties: { place: { type: "string" }, size_km: { type: "number" } } },
    },
  },
  {
    type: "function",
    function: {
      name: "export_area",
      description: "Save the open area's outline as a file for QGIS, ArcGIS, Google Earth Engine (GeoJSON) or Google Earth (KML).",
      parameters: { type: "object", properties: { format: { type: "string", enum: ["geojson", "kml"] } } },
    },
  },
  {
    type: "function",
    function: {
      name: "check_earth_engine_script",
      description: "Check a Google Earth Engine Sentinel-1 flood script for mixed orbits, compositing, double dB conversion and missing filters.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
    },
  },
];

/** What is on screen now, so follow-ups ("there", "the same place", "now in 2010") resolve without repeating it. */
export function stateLine(): string {
  const s = useStore.getState();
  const parts: string[] = [];
  if (s.aoi) {
    const [w, so, e, n] = geometryBounds(s.aoi.geometry);
    parts.push(`Current area: ${s.aoi.label} (centre ${formatLatLon((so + n) / 2, (w + e) / 2)}).`);
  } else parts.push("No area open yet.");
  parts.push(`Screen: ${s.mode}.`);
  const run = s.pendingRun;
  if (run) {
    const r = run.request as Record<string, unknown> & { before?: Period; flood?: Period; after?: Period };
    const windows = (["before", "flood", "after"] as const).filter((k) => r[k]).map((k) => `${k} ${r[k]!.start} to ${r[k]!.end}`);
    parts.push(`Plan waiting to run: ${run.kind}${windows.length ? `, ${windows.join(", ")}` : ""}.`);
  }
  const on = [["wind", s.windOn], ["clouds", s.cloudsOn], ["rain", s.rainOn], ["air quality", s.airOn], ["satellites", s.satellitesOn], ["water since 1984", s.waterHistoryOn], ["population", s.populationOn]]
    .filter(([, v]) => v).map(([k]) => k);
  if (s.earthLayer) on.push(s.earthLayer);
  if (on.length) parts.push(`Layers on: ${on.join(", ")}.`);
  return parts.join(" ");
}

const system = () => `You are Sentri, the Earthsift assistant, inside a satellite map app. Today is ${new Date().toISOString().slice(0, 10)}.
State now: ${stateLine()}
When the user means the current area ("here", "there", "it", "this district", "the same place"), omit place so the tool uses it.
Use the tools to act; never invent numbers, dates of satellite passes or results.
plan_analysis only prepares a plan: never say a map, analysis or result has been made, generated or shows anything. Say the plan is ready and the user should check it and press Run. Call one tool per request unless the user asks for several things.
For floods, give a flood window of 10 to 24 days around the peak when the date is known. Places: include the country.
If the request is unclear, or outside what the tools do, do not call a tool: answer in one or two short sentences and say what you can do.`;

// ---- tool execution --------------------------------------------------------------

const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

/** `result` goes back to the model; `say` is the reply the user reads, written here from real results, never by the model. */
interface ToolResult { result: string; say: string; card?: Card; next?: string[] }
const failed = (error: string): ToolResult => ({ result: JSON.stringify({ error }), say: error });

async function planAnalysis(text: string, ask: Ask, dates: { start: string; end: string } | null): Promise<ToolResult> {
  const state = useStore.getState();
  const planned = await requestRun(text, ask, state.aoi, PIXEL_BUDGET[deviceProfile().recommended]);
  if ("error" in planned) return failed(planned.error);
  const request = planned.run.request as Record<string, unknown> & { before?: Period; flood?: Period; after?: Period };
  let notes = [...(planned.run.fromAsk?.notes ?? [])];
  if (ask.kind === "flood" && dates) {
    // The exact window replaces the default one, so the default's note no longer applies.
    notes = notes.filter((n) => !n.startsWith("No date given") && !n.startsWith("No year given") && !n.startsWith("No month given"));
    request.flood = dates;
    request.before = { start: addDays(dates.start, -75), end: addDays(dates.start, -15) };
    notes.push(`Flood window ${dates.start} to ${dates.end}; before it, 75 to 15 days earlier, from the same radar orbit.`);
  }
  state.setAoi(planned.aoi);
  state.set({ pendingRun: { ...planned.run, fromAsk: { text, notes } }, mode: modeForRun(planned.run), result: null, introOpen: false });
  void getGlobe()?.flyToBounds(geometryBounds(planned.aoi.geometry));

  let findings: Finding[] = [];
  if (ask.kind === "flood" && request.before && request.flood) {
    try {
      const b = geometryBounds(planned.aoi.geometry);
      findings = (await checkFloodPlan({ aoi: planned.aoi.geometry as AoiGeometry, before: request.before, flood: request.flood, after: request.after }, b)).findings;
    } catch {
      findings = [{ level: "warn", text: "The Sentinel-1 archive could not be searched just now, so the plan was not checked." }];
    }
  }
  const windows = ["before", "flood", "after"].filter((k) => request[k]).map((k) => `${k}: ${(request[k] as Period).start} to ${(request[k] as Period).end}`);
  const title = `${ask.kind === "flood" ? "Sentinel-1 flood mapping" : `${ask.kind[0]!.toUpperCase()}${ask.kind.slice(1)} analysis`}, ${planned.aoi.label}`;
  return {
    result: JSON.stringify({ planned: title, windows, notes, checks: findings.map((f) => `${f.level}: ${f.text}`), status: "PLANNED, NOT RUN: no map or result exists yet. The user must press Run on screen to start it." }),
    say: `Plan ready: ${title}.${findings.some((f) => f.level === "error") ? " The checks found a problem; read them before running." : findings.some((f) => f.level === "warn") ? " Read the checks below." : ""} Nothing has run yet: press Run in the side panel.`,
    card: { kind: "plan", title, lines: [...windows, ...notes], findings },
  };
}

async function openArea(place: string, sizeKm: number | null): Promise<ToolResult> {
  const { results } = await api.geocode(place);
  // Prefer the place itself over a street or building that shares its name.
  const found = results.find((r) => !STREET.test(r.kind)) ?? results[0];
  if (!found) return failed(`No place called "${place}" was found. Try adding the country.`);
  const label = found.name.split(",")[0]!.trim();
  const geometry = squareAround(found.lon, found.lat, sizeKm ?? 10);
  useStore.getState().setAoi({ geometry, label });
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  void getGlobe()?.flyToBounds(geometryBounds(geometry));
  // The reply quotes the same forecast the overview shows, so the two can never disagree.
  const outlook = await fetchOutlook(found.lat, found.lon).catch(() => null);
  const warned = outlook ? warnings(outlook.days) : [];
  const ahead = !outlook ? "" : warned.length ? ` Next 7 days: ${warned.map((w) => w.text.split(":")[0]).join(", ").toLowerCase()} (details in the overview).` : " Next 7 days: no heavy rain, dangerous heat, frost, gales or unhealthy air in the forecast.";
  return {
    result: JSON.stringify({ opened: `${label}, ${formatLatLon(found.lat, found.lon)}`, warnings: warned.map((w) => w.text) }),
    say: `Opened ${label}.${ahead} The full overview (forecast, air, climate, solar power, water history, terrain, people, satellite passes) is in the side panel.`,
    next: AREA_NEXT,
  };
}

function showLayers(a: Record<string, unknown>): ToolResult {
  const flags: [string, string][] = [["wind", "windOn"], ["clouds", "cloudsOn"], ["rain", "rainOn"], ["air_quality", "airOn"], ["satellites", "satellitesOn"], ["water_history", "waterHistoryOn"], ["population", "populationOn"]];
  const patch: Record<string, unknown> = {};
  for (const [arg, field] of flags) if (typeof a[arg] === "boolean") patch[field] = a[arg];
  if (typeof a.earthquakes === "boolean") Object.assign(patch, { quakesOn: a.earthquakes }, a.earthquakes ? { mode: "live" } : {});
  if (typeof a.earth_today === "string") patch.earthLayer = EARTH_LAYERS.some((l) => l.id === a.earth_today) ? a.earth_today : null;
  // Live layers are drawn in Explore and Live; from an analysis screen they would not show.
  if (Object.keys(patch).length && !("mode" in patch) && !["explore", "live"].includes(useStore.getState().mode)) patch.mode = "explore";
  useStore.getState().set({ ...patch, introOpen: false });
  const names: Record<string, string> = { windOn: "wind", cloudsOn: "clouds", rainOn: "rain", airOn: "air quality", satellitesOn: "satellites", waterHistoryOn: "water since 1984", populationOn: "population", quakesOn: "earthquakes" };
  const said = Object.entries(patch).filter(([k]) => k !== "mode").map(([k, v]) => k === "earthLayer" ? (v ? `${EARTH_LAYERS.find((l) => l.id === v)!.label.toLowerCase()} on` : "Earth today off") : `${names[k]} ${v ? "on" : "off"}`);
  return { result: JSON.stringify({ set: Object.keys(patch) }), say: said.length ? `Done: ${said.join(", ")}.` : "No layer named that I can change." };
}

const AREA_NEXT = ["Land cover here", "Carbon stock here", "Map recent floods here"];

/** The area a tool works on: the place named (opened as a square), or the area already open. */
async function areaFor(a: Record<string, unknown>): Promise<{ geometry: AoiGeometry; label: string } | string> {
  const place = str(a.place, 120);
  if (!place) return useStore.getState().aoi ?? "Which place? Name one, or open an area on the map first.";
  const { results } = await api.geocode(place);
  // Prefer the place itself over a street or building that shares its name.
  const found = results.find((r) => !STREET.test(r.kind)) ?? results[0];
  if (!found) return `No place called "${place}" was found. Try adding the country.`;
  const area = { geometry: squareAround(found.lon, found.lat, num(a.size_km, 1, 50) ?? 10), label: found.name.split(",")[0]!.trim() };
  useStore.getState().setAoi(area);
  void getGlobe()?.flyToBounds(geometryBounds(area.geometry));
  return area;
}

const ha = (v: number) => `${Math.round(v).toLocaleString("en")} ha`;
const tonnes = (v: number) => (v >= 1e6 ? `${(v / 1e6).toLocaleString("en", { maximumSignificantDigits: 3 })} million t` : `${Math.round(v).toLocaleString("en")} t`);

async function landCover(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  const cover = await landCoverInBrowser({ aoi: area.geometry, maxPixels: PIXEL_BUDGET.fast }).promise;
  // The overview reads the same store field, so it shows this result without reading the map again.
  useStore.getState().set({ areaCover: cover, showCover: true });
  const top = cover.shares.slice(0, 5);
  const lines = cover.shares.slice(0, 8).map((c) => `${c.name}: ${(c.share * 100).toFixed(1)}%, ${ha(c.ha)}`);
  return {
    result: JSON.stringify({ area: area.label, classes: lines }),
    say: `Land cover of ${area.label}: ${top.map((c) => `${c.name.toLowerCase()} ${Math.round(c.share * 100)}%`).join(", ")}. It is on the map and in the overview.`,
    card: {
      kind: "facts", title: `Land use and land cover, ${area.label}`, lines: [...lines, `ESA WorldCover 2021, read at ${cover.resolution} m; about 77% overall accuracy, so small classes are rough.`], findings: [],
      chart: {
        title: `Land use and land cover, ${area.label}`, unit: "% of area", horizontal: true,
        bars: cover.shares.filter((c) => c.share >= 0.005).map((c) => ({ label: c.name, value: c.share * 100, colour: `rgb(${(WORLDCOVER[c.code]?.colour ?? [128, 128, 128]).join(",")})` })),
        source: `ESA WorldCover 2021 v200, 10 m (read at ${cover.resolution} m). Made with Earthsift.`,
      },
    },
    next: ["Carbon stock here", "Urban growth here since 2000", "Tree cover loss here"],
  };
}

async function carbonStock(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  const { biomass: b, soil } = await carbonInBrowser({ aoi: area.geometry, maxPixels: PIXEL_BUDGET.fast }).promise;
  if (!b.hectares && !soil?.hectares) return failed(`Neither the biomass nor the soil map has data over ${area.label} (open water, ice or outside their coverage).`);
  const pm = (v: number, u: number) => `${tonnes(v)} ± ${tonnes(u)}`;
  const total = b.total + (soil?.total ?? 0);
  const lines = [
    `Plants: ${pm(b.total, b.uncertainty)} of carbon (${b.meanDensity.toFixed(1)} t C/ha): above ground ${tonnes(b.above)}, roots ${tonnes(b.below)}`,
    soil ? `Soil, top 30 cm: ${tonnes(soil.total)} of carbon (${soil.meanDensity.toFixed(1)} t C/ha), likely between ${tonnes(soil.low)} and ${tonnes(soil.high)}` : "Soil: SoilGrids could not be reached just now; ask again to add it",
    `Together: about ${tonnes(total)} of carbon, ${tonnes(total * CO2_PER_C)} of CO2 equivalent`,
  ];
  const findings: Finding[] = [
    { level: "ok", text: `Plant uncertainty ± ${tonnes(b.uncertainty)} adds every pixel's published uncertainty, as if all errors leaned the same way; if they were independent it would be ± ${tonnes(b.uncertaintyIndependent)}.` },
    { level: "warn", text: "Plants as in 2010 (Harmonized Global Biomass, Spawn et al. 2020, 300 m); soil is SoilGrids 2.0 (Poggio et al. 2021, 250 m), modelled from soil profiles, and covers only the top 30 cm. Clearing or planting since 2010 is not reflected." },
  ];
  return {
    result: JSON.stringify({ area: area.label, lines }),
    say: `${area.label} holds about ${tonnes(total)} of carbon (${tonnes(total * CO2_PER_C)} CO2 equivalent): ${tonnes(b.total)} in plants${soil ? ` and ${tonnes(soil.total)} in the top 30 cm of soil` : ""}. Ranges and a chart below.`,
    card: {
      kind: "facts", title: `Carbon stock, ${area.label}`, lines, findings,
      chart: {
        title: `Carbon stock, ${area.label}`, unit: "t C",
        bars: [
          { label: "Above ground", value: b.above, low: Math.max(0, b.above - b.uncertainty * (b.above / (b.total || 1))), high: b.above + b.uncertainty * (b.above / (b.total || 1)), colour: "#5a7d3a" },
          { label: "Roots", value: b.below, low: Math.max(0, b.below - b.uncertainty * (b.below / (b.total || 1))), high: b.below + b.uncertainty * (b.below / (b.total || 1)), colour: "#8a6a3b" },
          ...(soil ? [{ label: "Soil 0-30 cm", value: soil.total, low: soil.low, high: soil.high, colour: "#5b4636" }] : []),
        ],
        source: "Error bars: plants, published uncertainty added over pixels (shared between above ground and roots by their share); soil, 5% to 95% quantiles. Plants: Harmonized Global Biomass 2010 (Spawn et al. 2020). Soil: SoilGrids 2.0 (Poggio et al. 2021). Made with Earthsift.",
      },
    },
    next: ["Land cover here", "Tree cover loss here", "Vegetation change here 2010 to 2024"],
  };
}

const capitalise = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

async function peopleCount(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  const p = await populationInBrowser({ aoi: area.geometry }).promise;
  const density = p.areaKm2 ? Math.round(p.people / p.areaKm2) : 0;
  return {
    result: JSON.stringify({ area: area.label, people: Math.round(p.people), areaKm2: Math.round(p.areaKm2) }),
    say: `${capitalise(formatPeople(p.people))} ${p.people < 1 ? "lives" : "live"} in this ${Math.round(p.areaKm2).toLocaleString("en")} km² around ${area.label}, ${density.toLocaleString("en")} per km² (GHS-POP 2020, modelled; it can undercount scattered rural homes).`,
    next: ["Land cover here", "Has this area flooded before? Show water since 1984", "Air quality outlook here"],
  };
}

async function saveMap(): Promise<ToolResult> {
  await saveFigure();
  return {
    result: JSON.stringify({ saved: true }),
    say: "Saved the map as a print-ready PNG: title, coordinate ticks, scale bar, north arrow, legend and credits. Charts have their own SVG and PNG buttons.",
  };
}

async function timeLapse(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  await getGlobe()?.flyToBounds(geometryBounds(area.geometry), 1.5);
  // Recording takes a minute or two; it runs on while the chat stays free, with progress in the Layers panel.
  void startTimelapse();
  return {
    result: JSON.stringify({ started: true, area: area.label }),
    say: `Recording a time-lapse of ${area.label}: one frame a year, each taken once that year's imagery has loaded. Progress and a Stop button are in the Layers panel; the video downloads when it is done.`,
  };
}

const km2 = (v: number) => `${v.toLocaleString("en", { maximumSignificantDigits: 4 })} km²`;
const GIS_NEXT = ["Land cover here", "How many people live here?", "Slope map here"];

async function buffer(a: Record<string, unknown>): Promise<ToolResult> {
  const km = num(a.km, 0.1, 100);
  if (km === null) return failed("Say how far to buffer, between 0.1 and 100 km, for example \"buffer 5 km\".");
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  const before = geometryInfo(area.geometry).areaKm2;
  const geometry = bufferGeometry(area.geometry, km);
  const label = `${area.label.replace(/ \+ [\d.]+ km$/, "")} + ${km} km`;
  useStore.getState().setAoi({ geometry, label });
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  void getGlobe()?.flyToBounds(geometryBounds(geometry));
  return {
    result: JSON.stringify({ area: label, before_km2: before, after_km2: geometryInfo(geometry).areaKm2 }),
    say: `Buffered ${area.label} by ${km} km: the area went from ${km2(before)} to ${km2(geometryInfo(geometry).areaKm2)} and is now the area in use. The buffer follows the area's outer outline, so inlets of a winding shape are filled.`,
    next: GIS_NEXT,
  };
}

async function terrain(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  const t = await fetchTerrain(area.geometry);
  if (!t) return failed(`No elevation data inside ${area.label}.`);
  const kind = TERRAIN_KINDS.find((k) => k.id === a.map)?.id as TerrainKind | undefined;
  if (kind) useStore.getState().set({ terrainMap: { kind, overlay: await terrainOverlay(kind, area.geometry) } });
  const m = (v: number) => `${Math.round(v).toLocaleString("en")} m`;
  const steep = t.slopeShares[3]! + t.slopeShares[4]!;
  return {
    result: JSON.stringify({ area: area.label, min_m: t.min, max_m: t.max, mean_m: t.mean, mean_slope_deg: t.meanSlope }),
    say: `${area.label} lies between ${m(t.min)} and ${m(t.max)} above sea level (mean ${m(t.mean)}), with an average slope of ${t.meanSlope.toFixed(1)}°.${kind ? ` The ${kind} map is on the globe.` : ""}`,
    card: {
      kind: "facts", title: `Terrain, ${area.label}`,
      lines: [`Elevation: lowest ${m(t.min)}, highest ${m(t.max)}, mean ${m(t.mean)}, relief ${m(t.max - t.min)}`, `Mean slope ${t.meanSlope.toFixed(1)}°; ${Math.round(steep * 100)}% of the area is steeper than 15°`, `AWS Terrain Tiles (SRTM and others), read at ${Math.round(t.resolutionM)} m`],
      findings: steep > 0.1 ? [{ level: "warn", text: "Over a tenth of the area is steeper than 15°, where heavy rain can set off landslides." }] : [],
      chart: {
        title: `Slope classes, ${area.label}`, unit: "% of area", horizontal: true,
        bars: SLOPE_CLASSES.map((c, i) => ({ label: `${c.label} (${i === 0 ? "under " + c.max : i === SLOPE_CLASSES.length - 1 ? "over " + SLOPE_CLASSES[i - 1]!.max : SLOPE_CLASSES[i - 1]!.max + " to " + c.max}°)`, value: t.slopeShares[i]! * 100, colour: ["#2e7d32", "#9ccc65", "#fdd835", "#fb8c00", "#c62828"][i]! })),
        source: `Slope from AWS Terrain Tiles (SRTM, GMTED2010 and national models), read at ${Math.round(t.resolutionM)} m. Made with Earthsift.`,
      },
    },
    next: kind ? ["Aspect map here", "Hillshade here", "Land cover here"] : ["Slope map here", "Hillshade here", "Has this area flooded before? Show water since 1984"],
  };
}

async function riskCheckTool(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  const [w, s, e, n] = geometryBounds(area.geometry);
  const check = await riskCheck(area.geometry, (s + n) / 2, (w + e) / 2);
  if (!check.items.length) return failed(`The risk check could not read any data for ${area.label}. Try again in a moment.`);
  const word = { high: "high", medium: "some", low: "low" } as const;
  // For flood-prone ground, a straight line to the higher ground, with its distance and elevation profile.
  const showWay = check.ground && check.items.some((r) => r.hazard === "flood" && r.level !== "low");
  if (showWay) useStore.getState().set({ measure: [[(w + e) / 2, (s + n) / 2], [check.ground!.lon, check.ground!.lat]] });
  return {
    result: JSON.stringify({ area: area.label, ratings: check.items.map((r) => ({ hazard: r.hazard, level: r.level })) }),
    say: `Risk check for ${area.label}: ${check.items.map((r) => `${r.title.toLowerCase()} ${word[r.level]}`).join(", ")}. Details below and in the side panel.${showWay ? " The line on the map leads to the nearest higher ground." : ""}`,
    card: {
      kind: "facts", title: `Risk check, ${area.label}`,
      lines: [...(check.failed.length ? [`Could not read the ${check.failed.join(" or ")}.`] : []), RISK_SOURCES],
      findings: check.items.map((r) => ({ level: r.level === "low" ? "ok" : r.level === "high" ? "error" : "warn", text: `${r.title}: ${r.text}` })),
    },
    next: ["Show water since 1984 here", "Slope map here", "How many people live here?"],
  };
}

async function measureArea(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  const g = geometryInfo(area.geometry);
  const lines = [
    `Area: ${km2(g.areaKm2)} (${Math.round(g.areaKm2 * 100).toLocaleString("en")} ha)`,
    `Perimeter: ${g.perimeterKm.toLocaleString("en", { maximumSignificantDigits: 4 })} km`,
    `Centre: ${formatLatLon(g.centroid[1], g.centroid[0])}`,
    `Bounds: ${g.bbox[0].toFixed(4)}° to ${g.bbox[2].toFixed(4)}° E, ${g.bbox[1].toFixed(4)}° to ${g.bbox[3].toFixed(4)}° N`,
    `Outline: ${g.vertices.toLocaleString("en")} points`,
  ];
  return {
    result: JSON.stringify({ area: area.label, lines }),
    say: `${area.label} covers ${km2(g.areaKm2)} with a perimeter of ${g.perimeterKm.toLocaleString("en", { maximumSignificantDigits: 4 })} km, centred at ${formatLatLon(g.centroid[1], g.centroid[0])}.`,
    card: { kind: "facts", title: `Geometry, ${area.label}`, lines: [...lines, "Area measured in the local UTM zone; perimeter along the outline on the globe."], findings: [] },
    next: ["Export this area as GeoJSON", "Buffer 2 km", "Terrain here"],
  };
}

function exportArea(a: Record<string, unknown>): ToolResult {
  const area = useStore.getState().aoi;
  if (!area) return failed("Open an area first, then ask to export it.");
  const kml = a.format === "kml";
  const name = `earthsift-${area.label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "area"}.${kml ? "kml" : "geojson"}`;
  downloadText(name, kml ? "application/vnd.google-earth.kml+xml" : "application/geo+json", kml ? toKml(area.geometry, area.label) : toGeoJson(area.geometry, area.label));
  return {
    result: JSON.stringify({ saved: name }),
    say: `Saved ${name}. ${kml ? "Open it in Google Earth." : "Drag it into QGIS or ArcGIS, or upload it as an asset in Google Earth Engine. Coordinates are WGS 84 (EPSG:4326)."}`,
  };
}

function checkScript(code: string): ToolResult {
  const findings = lintGeeScript(code);
  const errors = findings.filter((f) => f.level === "error").length;
  return {
    result: JSON.stringify(findings.map((f) => `${f.level}: ${f.text}`)),
    say: errors ? `Found ${errors} problem${errors === 1 ? " that changes" : "s that change"} the result; details below.` : "No errors found; warnings below.",
    card: { kind: "checks", title: "Earth Engine script check", findings },
  };
}

export async function runTool(name: string, rawArgs: string, userText: string): Promise<ToolResult> {
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || "{}") as Record<string, unknown>; } catch { return failed("I could not read that request; try rewording it."); }
  if (typeof a !== "object" || a === null) return failed("I could not read that request; try rewording it.");
  try {
    switch (name) {
      case "plan_analysis": {
        const ask = askFromArgs(a);
        if (typeof ask === "string") return failed(ask);
        return await planAnalysis(userText, ask, floodDates(a));
      }
      case "open_area": {
        const place = str(a.place, 120);
        return place ? await openArea(place, num(a.size_km, 1, 50)) : failed("Which place?");
      }
      case "show_layers": return showLayers(a);
      case "land_cover": return await landCover(a);
      case "carbon_stock": return await carbonStock(a);
      case "people_count": return await peopleCount(a);
      case "save_map": return await saveMap();
      case "time_lapse": return await timeLapse(a);
      case "buffer": return await buffer(a);
      case "terrain": return await terrain(a);
      case "risk_check": return await riskCheckTool(a);
      case "measure_area": return await measureArea(a);
      case "export_area": return exportArea(a);
      case "check_earth_engine_script": return checkScript(str(a.code, 20_000) ?? "");
      default: return failed("I cannot do that here yet.");
    }
  } catch (e) {
    return failed(e instanceof Error ? e.message : "That did not work; try again.");
  }
}

// ---- the loop --------------------------------------------------------------------

async function complete(messages: Message[], signal?: AbortSignal): Promise<Message> {
  const recent = messages.filter((m) => m.role === "user").slice(-2).map((m) => m.content ?? "").join(" ");
  const response = await fetch(AGENT_URL, {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools: TOOLS.filter((tool) => toolNamesFor(recent).includes(tool.function.name)) }),
  });
  if (!response.ok) throw new Error(response.status === 429 ? "The assistant is busy; try again in a minute." : "The assistant could not be reached.");
  const body = (await response.json()) as { choices?: { message?: Message }[] };
  const message = body.choices?.[0]?.message;
  if (!message) throw new Error("The assistant gave no answer.");
  return { role: "assistant", content: message.content ?? null, tool_calls: message.tool_calls?.slice(0, 3) };
}

export interface Turn { text: string; cards: Card[]; history: Message[]; next?: string[] }



/** Rule-based answer: script check, the app's own request reader, or a place to open. */
async function offline(text: string): Promise<{ text: string; cards: Card[]; next?: string[] }> {
  const intent = offlineIntent(text);
  if (intent) {
    const r = await runTool(intent.tool, JSON.stringify({ ...(intent.place ? { place: intent.place } : {}), ...intent.args }), text);
    return { text: r.say, cards: r.card ? [r.card] : [], next: r.next };
  }
  const ask = interpret(text);
  if (ask) {
    const r = await planAnalysis(text, ask, null);
    return { text: r.say, cards: r.card ? [r.card] : [] };
  }
  const r = await openArea(placeFromText(text), null);
  const notFound = r.say.startsWith("No place");
  return { text: notFound ? `I could not read that as a request or a place. Try "floods in Layyah, Pakistan, August 2022" or paste an Earth Engine script.` : r.say, cards: [], next: notFound ? undefined : r.next };
}

/** One user message through the assistant. `history` excludes the system prompt. */
export async function ask(text: string, history: Message[], signal?: AbortSignal): Promise<Turn> {
  // Pasted scripts are checked by code alone: no need to send them to a model.
  if (isS1Script(text)) {
    const r = checkScript(text);
    return { text: r.say, cards: [r.card!], history };
  }
  if (asksAbilities(text)) return { text: abilitiesText(), cards: [], history };
  if (!agentOnline) return { ...(await offline(text)), history };
  // "Has Sukkur flooded before?" is a risk check, which the rules read exactly; the model tended to plan a radar flood map.
  if (offlineIntent(text)?.tool === "risk_check") return { ...(await offline(text)), history };

  const messages: Message[] = [...history, { role: "user", content: text.slice(0, 4000) }];
  const cards: Card[] = [];
  const says: string[] = [];
  let next: string[] | undefined;
  try {
    // One model call per turn: it picks the tools (up to three at once), code does and reports the rest.
    // The model's own prose is used only when it calls no tool, so it can never describe results it did not see.
    const reply = await complete([{ role: "system", content: system() }, ...trimHistory(messages)], signal);
    messages.push(reply);
    if (!reply.tool_calls?.length) {
      // The free model sometimes answers in words a request the rules can run ("buffer 2 km"): run it instead.
      if (offlineIntent(text)) return { ...(await offline(text)), history: messages };
      return { text: honest(reply.content?.trim() || "Sorry, I did not catch that.", cards), cards, history: messages };
    }
    for (const call of reply.tool_calls) {
      const r = await runTool(call.function.name, call.function.arguments, text);
      if (r.card) cards.push(r.card);
      if (r.next) next = r.next;
      says.push(r.say);
      messages.push({ role: "tool", tool_call_id: call.id, content: r.result });
    }
    return { text: says.join(" "), cards, history: trimHistory(messages), next };
  } catch (e) {
    if (signal?.aborted) throw e;
    // The model being unavailable should not stop the request: fall back to the rule-based reader.
    const fallback = await offline(text);
    // A network failure surfaces as the browser's own "Failed to fetch"; say it plainly.
    const why = e instanceof Error && !(e instanceof TypeError) ? e.message : "The assistant could not be reached.";
    return { text: `${why} Using the built-in reader instead: ${fallback.text}`, cards: [...cards, ...fallback.cards], history };
  }
}
