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

export type RunKind = "change" | "flood" | "water";
export interface SharedRun {
  kind: RunKind;
  /** The request as the engine needs it, minus the device-specific download parallelism. */
  request: Record<string, unknown> & { aoi: AoiGeometry; label?: string | null };
  maxPixels: number;
}

const VERSION = 1;
/** Links longer than this stop working in some chat apps and mail clients. */
export const MAX_PARAM_LENGTH = 6000;
/** Decimal places kept in shared coordinates: 4 is about 11 m, finer than any pixel used. */
const COORDINATE_DECIMALS = 4;
const KINDS: RunKind[] = ["change", "flood", "water"];

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
  const years = Array.isArray(r.years) ? (r.years as number[]) : [];
  return `Surface water in ${years.join(", ")}`;
}
