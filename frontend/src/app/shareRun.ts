/**
 * Shareable links for analyses that run in the browser.
 *
 * Browser results are not stored anywhere, so a link cannot point to a stored
 * result. It carries the recipe instead: the area, the dates and every
 * parameter. Opening it runs the same analysis on the recipient's device.
 * The satellite archive is fixed for past dates, so the result is the same
 * apart from scenes the provider has since reprocessed.
 */
import { areaFromGeoJson } from "../analysis/areaFile";
import type { AnalysisResult, AoiGeometry } from "./types";

export type RunKind = "change" | "flood" | "water" | "urban" | "timeseries" | "heat";
export interface SharedRun {
  kind: RunKind;
  /** The request as the engine needs it, minus the device-specific download parallelism. */
  request: Record<string, unknown> & { aoi: AoiGeometry; label?: string | null };
  maxPixels: number;
  /** Set when the run was proposed from a news story rather than opened from a link; never encoded. */
  fromNews?: string;
  /** Set when the run is repeated from My places. */
  fromRecent?: boolean;
}

const VERSION = 1;
/** Links longer than this stop working in some chat apps and mail clients. */
export const MAX_PARAM_LENGTH = 6000;
/** Decimal places kept in shared coordinates: 4 is about 11 m, finer than any pixel used. */
const COORDINATE_DECIMALS = 4;
const KINDS: RunKind[] = ["change", "flood", "water", "urban", "timeseries", "heat"];

function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): string {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((text.length + 3) % 4);
  const binary = atob(padded);
  return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
}

function roundGeometry(geometry: AoiGeometry, keepEvery = 1): AoiGeometry {
  const f = 10 ** COORDINATE_DECIMALS;
  const ring = (r: number[][]) => {
    const kept = r.filter((_, i) => i === 0 || i === r.length - 1 || i % keepEvery === 0);
    return kept.map(([x = 0, y = 0]) => [Math.round(x * f) / f, Math.round(y * f) / f]);
  };
  return geometry.type === "Polygon"
    ? { type: "Polygon", coordinates: geometry.coordinates.map(ring) }
    : { type: "MultiPolygon", coordinates: geometry.coordinates.map((p) => p.map(ring)) };
}

/**
 * The link parameter for a browser result, or null when it cannot be shared
 * (a server result, or an outline too detailed to fit in a link even after
 * thinning it to every fourth vertex).
 */
export function encodeRun(result: AnalysisResult): string | null {
  if (result.provenance.computedOn !== "browser" || !KINDS.includes(result.type as RunKind)) return null;
  const raw = { ...(result as unknown as { request: Record<string, unknown> }).request };
  const maxPixels = Number(raw.maxPixels ?? result.provenance.maxPixels);
  if (!Number.isFinite(maxPixels) || maxPixels <= 0) return null;
  delete raw.maxPixels;
  delete raw.concurrency;
  for (const keepEvery of [1, 2, 4]) {
    const request = { ...raw, aoi: roundGeometry(result.aoi, keepEvery) };
    const param = toBase64Url(JSON.stringify({ v: VERSION, k: result.type, m: maxPixels, r: request }));
    if (param.length <= MAX_PARAM_LENGTH) return param;
  }
  return null;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const WORD = /^[a-z0-9]{1,20}$/;

/**
 * Every field a link may carry has a known shape: numbers, ISO dates, short
 * lower-case words or lists of years. Anything else is refused, so link
 * content can never reach generated text (such as an Earth Engine script)
 * as anything but plain values.
 */
function fieldsAreSafe(r: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(r)) {
    if (key === "aoi" || key === "label" || value === null || value === undefined) continue;
    if (typeof value === "number") { if (!Number.isFinite(value)) return false; continue; }
    if (typeof value === "string") { if (!WORD.test(value) && !DATE.test(value)) return false; continue; }
    if (Array.isArray(value)) { if (!value.every((v) => Number.isInteger(v))) return false; continue; }
    if (typeof value === "object") {
      const p = value as Record<string, unknown>;
      if (Object.keys(p).some((k) => k !== "start" && k !== "end") || !DATE.test(String(p.start)) || !DATE.test(String(p.end))) return false;
      continue;
    }
    return false;
  }
  return true;
}

/** Parse a shared link parameter, validating everything that came from the URL. */
export function decodeRun(param: string | null): SharedRun | null {
  if (!param || param.length > MAX_PARAM_LENGTH * 2 || !/^[A-Za-z0-9_-]+$/.test(param)) return null;
  try {
    const body = JSON.parse(fromBase64Url(param)) as { v?: number; k?: string; m?: number; r?: Record<string, unknown> };
    if (body.v !== VERSION || !KINDS.includes(body.k as RunKind) || !body.r || typeof body.r !== "object") return null;
    const maxPixels = Number(body.m);
    if (!Number.isFinite(maxPixels) || maxPixels < 10_000 || maxPixels > 5_000_000) return null;
    const aoi = areaFromGeoJson(body.r.aoi); // throws on anything that is not a sane polygon
    const label = typeof body.r.label === "string" ? body.r.label.slice(0, 60) : null;
    if (!fieldsAreSafe(body.r)) return null;
    return { kind: body.k as RunKind, request: { ...body.r, aoi, label }, maxPixels };
  } catch {
    return null;
  }
}

/** A short description of what a shared link will run, for the confirmation card. */
export function describeRun(run: SharedRun): string {
  const r = run.request as Record<string, unknown>;
  const span = (p: unknown) => {
    const period = p as { start?: string; end?: string } | undefined;
    return period?.start ? `${period.start} to ${period.end}` : "";
  };
  if (run.kind === "change") return `${String(r.index ?? "ndvi").toUpperCase()} change, ${span(r.before)} against ${span(r.after)}`;
  if (run.kind === "flood") return `Flood mapping, ${span(r.before)} against ${span(r.flood)}`;
  if (run.kind === "urban") return `${r.focus === 2 ? "Tree cover" : "Built area"} from ${String(r.firstYear)} to ${String(r.lastYear)}`;
  if (run.kind === "heat") return `Surface temperature, ${String(r.year)}${r.compareYear ? ` against ${String(r.compareYear)}` : ""}`;
  if (run.kind === "timeseries") return `Index series for ${Array.isArray(r.years) ? (r.years as number[]).join(", ") : "several years"}`;
  const years = Array.isArray(r.years) ? (r.years as number[]) : [];
  return `Surface water in ${years.join(", ")}`;
}

/** The mode whose panel shows a run's progress and result. */
export function modeForRun(run: SharedRun): "floods" | "forests" | "cities" | "fires" | "change" | "water" | "research" | "heat" {
  const r = run.request as { focus?: number; index?: string };
  if (run.kind === "flood") return "floods";
  if (run.kind === "urban") return r.focus === 2 ? "forests" : "cities";
  if (run.kind === "timeseries") return "research";
  if (run.kind === "heat") return "heat";
  if (run.kind === "change") return r.index === "nbr" ? "fires" : "change";
  return "water";
}
