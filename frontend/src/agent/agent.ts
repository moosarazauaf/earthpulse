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
import { deviceProfile, PIXEL_BUDGET } from "../engine/client";
import { EARTH_LAYERS } from "../globe/earthToday";
import { geometryBounds } from "../globe/Globe";
import { getGlobe } from "../globe/GlobeViewer";
import { isS1Script, lintGeeScript } from "./geeLint";
import { type Finding, checkFloodPlan } from "./s1checks";
import { KINDS, askFromArgs, floodDates, num, str } from "./args";

const AGENT_URL = (import.meta.env.VITE_AGENT_URL as string | undefined) ?? "";
/** True when the site was built with the model proxy's address. */
export const agentOnline = AGENT_URL.startsWith("https://");
const MAX_ROUNDS = 5;

export interface ToolCall { id: string; type: "function"; function: { name: string; arguments: string } }
export interface Message { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: ToolCall[]; tool_call_id?: string }

/** What the chat shows besides text: a planned run, or a list of check results. */
export type Card =
  | { kind: "plan"; title: string; lines: string[]; findings: Finding[] }
  | { kind: "checks"; title: string; findings: Finding[] };


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
      name: "check_earth_engine_script",
      description: "Check a Google Earth Engine Sentinel-1 flood script for mixed orbits, compositing, double dB conversion and missing filters.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
    },
  },
];

const system = () => `You are the EarthPulse assistant inside a satellite map app. Today is ${new Date().toISOString().slice(0, 10)}.
Use the tools to act; never invent numbers, dates of satellite passes or results. Call one tool per request unless the user asks for several things.
For floods, give a flood window of 10 to 24 days around the peak when the date is known. Places: include the country.
After the tools return, answer in at most three short plain sentences. Repeat any warning or error from the checks in plain words. If something is outside what the tools do, say so briefly.`;

// ---- tool execution --------------------------------------------------------------

const addDays = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);

interface ToolResult { result: string; card?: Card }

async function planAnalysis(text: string, ask: Ask, dates: { start: string; end: string } | null): Promise<ToolResult> {
  const state = useStore.getState();
  const planned = await requestRun(text, ask, state.aoi, PIXEL_BUDGET[deviceProfile().recommended]);
  if ("error" in planned) return { result: JSON.stringify({ error: planned.error }) };
  const request = planned.run.request as Record<string, unknown> & { before?: Period; flood?: Period; after?: Period };
  const notes = [...(planned.run.fromAsk?.notes ?? [])];
  if (ask.kind === "flood" && dates) {
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
    result: JSON.stringify({ planned: title, windows, notes, checks: findings.map((f) => `${f.level}: ${f.text}`), next: "The plan is on screen; the user presses Run to start it." }),
    card: { kind: "plan", title, lines: [...windows, ...notes], findings },
  };
}

async function openArea(place: string, sizeKm: number | null): Promise<ToolResult> {
  const { results } = await api.geocode(place);
  const found = results[0];
  if (!found) return { result: JSON.stringify({ error: `No place called "${place}" was found.` }) };
  const label = found.name.split(",")[0]!.trim();
  const geometry = squareAround(found.lon, found.lat, sizeKm ?? 10);
  useStore.getState().setAoi({ geometry, label });
  useStore.getState().set({ mode: "area", introOpen: false, result: null });
  void getGlobe()?.flyToBounds(geometryBounds(geometry));
  return { result: JSON.stringify({ opened: `${label}, ${formatLatLon(found.lat, found.lon)}`, shows: "area overview with forecast, air, climate, solar, water history, terrain, people, satellite passes" }) };
}

function showLayers(a: Record<string, unknown>): ToolResult {
  const flags: [string, string][] = [["wind", "windOn"], ["clouds", "cloudsOn"], ["rain", "rainOn"], ["air_quality", "airOn"], ["satellites", "satellitesOn"], ["water_history", "waterHistoryOn"], ["population", "populationOn"]];
  const patch: Record<string, unknown> = {};
  for (const [arg, field] of flags) if (typeof a[arg] === "boolean") patch[field] = a[arg];
  if (typeof a.earthquakes === "boolean") Object.assign(patch, { quakesOn: a.earthquakes }, a.earthquakes ? { mode: "live" } : {});
  if (typeof a.earth_today === "string") patch.earthLayer = EARTH_LAYERS.some((l) => l.id === a.earth_today) ? a.earth_today : null;
  useStore.getState().set({ ...patch, introOpen: false });
  return { result: JSON.stringify({ set: Object.keys(patch) }) };
}

function checkScript(code: string): ToolResult {
  const findings = lintGeeScript(code);
  return { result: JSON.stringify(findings.map((f) => `${f.level}: ${f.text}`)), card: { kind: "checks", title: "Earth Engine script check", findings } };
}

export async function runTool(name: string, rawArgs: string, userText: string): Promise<ToolResult> {
  let a: Record<string, unknown>;
  try { a = JSON.parse(rawArgs || "{}") as Record<string, unknown>; } catch { return { result: JSON.stringify({ error: "Arguments were not valid JSON." }) }; }
  if (typeof a !== "object" || a === null) return { result: JSON.stringify({ error: "Arguments must be an object." }) };
  try {
    switch (name) {
      case "plan_analysis": {
        const ask = askFromArgs(a);
        if (typeof ask === "string") return { result: JSON.stringify({ error: ask }) };
        return await planAnalysis(userText, ask, floodDates(a));
      }
      case "open_area": {
        const place = str(a.place, 120);
        return place ? await openArea(place, num(a.size_km, 1, 50)) : { result: JSON.stringify({ error: "No place given." }) };
      }
      case "show_layers": return showLayers(a);
      case "check_earth_engine_script": return checkScript(str(a.code, 20_000) ?? "");
      default: return { result: JSON.stringify({ error: `No tool called ${name}.` }) };
    }
  } catch (e) {
    return { result: JSON.stringify({ error: e instanceof Error ? e.message : "The tool failed." }) };
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

export interface Turn { text: string; cards: Card[]; history: Message[] }

/** Rule-based answer: script check, the app's own request reader, or a place to open. */
async function offline(text: string): Promise<{ text: string; cards: Card[] }> {
  const ask = interpret(text);
  if (ask) {
    const r = await planAnalysis(text, ask, null);
    const body = JSON.parse(r.result) as { error?: string };
    return { text: body.error ?? "Here is the plan. Check the notes, then press Run.", cards: r.card ? [r.card] : [] };
  }
  const r = await openArea(text, null);
  const body = JSON.parse(r.result) as { error?: string; opened?: string };
  return {
    text: body.error ? `I could not read that as a request or a place. Try "floods in Layyah, Pakistan, August 2022" or paste an Earth Engine script.` : `Opened ${body.opened}.`,
    cards: [],
  };
}

/** One user message through the assistant. `history` excludes the system prompt. */
export async function ask(text: string, history: Message[], signal?: AbortSignal): Promise<Turn> {
  // Pasted scripts are checked by code alone: no need to send them to a model.
  if (isS1Script(text)) {
    const r = checkScript(text);
    const errors = r.card!.findings.filter((f) => f.level === "error").length;
    return { text: errors ? `Found ${errors} problem${errors === 1 ? " that changes" : "s that change"} the result; details below.` : "No errors found; warnings below.", cards: [r.card!], history };
  }
  if (!agentOnline) return { ...(await offline(text)), history };

  const messages: Message[] = [...history, { role: "user", content: text.slice(0, 4000) }];
  const cards: Card[] = [];
  try {
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const reply = await complete([{ role: "system", content: system() }, ...messages.slice(-16)], signal);
      messages.push(reply);
      if (!reply.tool_calls?.length) return { text: reply.content?.trim() || "Done.", cards, history: messages };
      for (const call of reply.tool_calls) {
        const r = await runTool(call.function.name, call.function.arguments, text);
        if (r.card) cards.push(r.card);
        messages.push({ role: "tool", tool_call_id: call.id, content: r.result });
      }
    }
    return { text: "Done.", cards, history: messages };
  } catch (e) {
    if (signal?.aborted) throw e;
    // The model being unavailable should not stop the request: fall back to the rule-based reader.
    const fallback = await offline(text);
    return { text: `${e instanceof Error ? e.message : "The assistant failed."} Using the built-in reader instead: ${fallback.text}`, cards: [...cards, ...fallback.cards], history };
  }
}
