/**
 * The EarthPulse assistant. A free model on OpenRouter (NVIDIA Nemotron,
 * through the EarthPulse proxy that holds the key) reads the request and
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
import { requestRun } from "../ask/request";
import { carbonInBrowser, deviceProfile, landCoverInBrowser, PIXEL_BUDGET } from "../engine/client";
import { CO2_PER_C } from "../engine/carbon";
import { EARTH_LAYERS } from "../globe/earthToday";
import { geometryBounds } from "../globe/Globe";
import { getGlobe } from "../globe/GlobeViewer";
import { isS1Script, lintGeeScript } from "./geeLint";
import { fetchOutlook, warnings } from "../area/outlook";
import { type Finding, checkFloodPlan } from "./s1checks";
import { KINDS, abilitiesText, askFromArgs, asksAbilities, floodDates, honest, num, offlineIntent, str, trimHistory } from "./args";

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "";
/** True when the site was built with the model proxy's address. */
export const agentOnline = AGENT_URL.startsWith("https://");

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface Message { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

/** What the chat shows besides text: a planned run, or a list of check results. */
export type Card =
  | { kind: "plan"; title: string; lines: string[]; findings: Finding[] }
  | { kind: "checks"; title: string; findings: Finding[] }
  | { kind: "facts"; title: string; lines: string[]; findings: Finding[] };


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

const system = () => `You are Sentri, the EarthPulse assistant, inside a satellite map app. Today is ${new Date().toISOString().slice(0, 10)}.
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
  const found = results[0];
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
  const found = results[0];
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
    card: { kind: "facts", title: `Land use and land cover, ${area.label}`, lines: [...lines, `ESA WorldCover 2021, read at ${cover.resolution} m; about 77% overall accuracy, so small classes are rough.`], findings: [] },
    next: ["Carbon stock here", "Urban growth here since 2000", "Tree cover loss here"],
  };
}

async function carbonStock(a: Record<string, unknown>): Promise<ToolResult> {
  const area = await areaFor(a);
  if (typeof area === "string") return failed(area);
  const c = await carbonInBrowser({ aoi: area.geometry, maxPixels: PIXEL_BUDGET.fast }).promise;
  if (!c.hectares) return failed(`The biomass map has no data over ${area.label} (open water, ice or outside its coverage).`);
  const lines = [
    `Total: ${tonnes(c.total)} of carbon, about ${tonnes(c.total * CO2_PER_C)} of CO2 equivalent`,
    `Above ground: ${tonnes(c.above)}; below ground (roots): ${tonnes(c.below)}`,
    `Average ${c.meanDensity.toFixed(1)} t of carbon per hectare over ${ha(c.hectares)}`,
  ];
  return {
    result: JSON.stringify({ area: area.label, lines }),
    say: `${area.label} holds about ${tonnes(c.total)} of carbon in living plants (${tonnes(c.total * CO2_PER_C)} CO2 equivalent), ${c.meanDensity.toFixed(1)} t C per hectare on average.`,
    card: {
      kind: "facts", title: `Carbon stock in plants, ${area.label}`, lines,
      findings: [{ level: "warn", text: "Biomass only, as it was in 2010: soil carbon is not included, and clearing or planting since then is not reflected. Harmonized Global Biomass (Spawn et al. 2020), 300 m." }],
    },
    next: ["Land cover here", "Tree cover loss here", "Vegetation change here 2010 to 2024"],
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
      case "check_earth_engine_script": return checkScript(str(a.code, 20_000) ?? "");
      default: return failed("I cannot do that here yet.");
    }
  } catch (e) {
    return failed(e instanceof Error ? e.message : "That did not work; try again.");
  }
}

// ---- the loop --------------------------------------------------------------------

async function complete(messages: Message[], signal?: AbortSignal): Promise<Message> {
  const response = await fetch(AGENT_URL, {
    method: "POST", signal, headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, tools: TOOLS }),
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
    const r = await runTool(intent.tool, JSON.stringify(intent.place ? { place: intent.place } : {}), text);
    return { text: r.say, cards: r.card ? [r.card] : [], next: r.next };
  }
  const ask = interpret(text);
  if (ask) {
    const r = await planAnalysis(text, ask, null);
    return { text: r.say, cards: r.card ? [r.card] : [] };
  }
  const r = await openArea(text, null);
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

  const messages: Message[] = [...history, { role: "user", content: text.slice(0, 4000) }];
  const cards: Card[] = [];
  const says: string[] = [];
  let next: string[] | undefined;
  try {
    // One model call per turn: it picks the tools (up to three at once), code does and reports the rest.
    // The model's own prose is used only when it calls no tool, so it can never describe results it did not see.
    const reply = await complete([{ role: "system", content: system() }, ...trimHistory(messages)], signal);
    messages.push(reply);
    if (!reply.tool_calls?.length) return { text: honest(reply.content?.trim() || "Sorry, I did not catch that.", cards), cards, history: messages };
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
    return { text: `${e instanceof Error ? e.message : "The assistant failed."} Using the built-in reader instead: ${fallback.text}`, cards: [...cards, ...fallback.cards], history };
  }
}
