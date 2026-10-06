/** Pure rules, kept free of React and Cesium so they can be unit tested. */
import type { AoiGeometry, DatasetId, Period, RenderId } from "./types";

export const FIRST_YEAR = 1984; // first full year of Landsat 5 TM
export const SENTINEL2_FIRST_YEAR = 2016;
export const RENDERS: RenderId[] = ["truecolor", "falsecolor", "ndvi", "ndwi", "mndwi", "ndbi"];

export const currentYear = () => new Date().getUTCFullYear();

/** Sentinel-2 cannot show a year it did not observe; fall back to Landsat. */
export function datasetForYear(preferred: DatasetId, year: number): DatasetId {
  return preferred === "sentinel2" && year < SENTINEL2_FIRST_YEAR ? "landsat" : preferred;
}

export function clampYear(year: number): number {
  return Math.min(currentYear(), Math.max(FIRST_YEAR, Math.round(year)));
}

const pad = (n: number) => String(n).padStart(2, "0");

/** A compositing window inside one year, cut off at today for the current year. */
export function seasonPeriod(year: number, startMonth: number, endMonth: number, today = new Date()): Period {
  const lastDay = new Date(Date.UTC(year, endMonth, 0)).getUTCDate();
  let end = `${year}-${pad(endMonth)}-${pad(lastDay)}`;
  const todayIso = today.toISOString().slice(0, 10);
  if (end > todayIso) end = todayIso;
  return { start: `${year}-${pad(startMonth)}-01`, end };
}

/** True when a season window in this year has not started yet. */
export function seasonNotStarted(year: number, startMonth: number, today = new Date()): boolean {
  return `${year}-${pad(startMonth)}-01` > today.toISOString().slice(0, 10);
}

export function rectangleAoi(west: number, south: number, east: number, north: number): AoiGeometry {
  return {
    type: "Polygon",
    coordinates: [[[west, south], [east, south], [east, north], [west, north], [west, south]]],
  };
}

// ---- shareable view state --------------------------------------------------
export interface ViewState {
  lat: number;
  lon: number;
  height: number;
  year: number;
  render: RenderId;
  dataset: DatasetId;
  compareYear: number | null;
  analysis: string | null;
}

const ANALYSIS_ID = /^EP-\d{4}-[A-Z0-9]{1,16}-[0-9A-F]{5}$/;

export function encodeView(view: ViewState): string {
  const params = new URLSearchParams({
    lat: view.lat.toFixed(4),
    lon: view.lon.toFixed(4),
    h: Math.round(view.height).toString(),
    year: String(view.year),
    layer: view.render,
    data: view.dataset,
  });
  if (view.compareYear !== null) params.set("cmp", String(view.compareYear));
  if (view.analysis) params.set("analysis", view.analysis);
  return params.toString();
}

/** Parse a query string, ignoring anything malformed rather than trusting it. */
export function decodeView(query: string): Partial<ViewState> {
  const params = new URLSearchParams(query);
  const out: Partial<ViewState> = {};
  const num = (key: string) => {
    const raw = params.get(key);
    const value = raw === null ? NaN : Number(raw);
    return Number.isFinite(value) ? value : null;
  };
  const lat = num("lat");
  const lon = num("lon");
  const height = num("h");
  if (lat !== null && lon !== null && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
    out.lat = lat;
    out.lon = lon;
    if (height !== null && height > 100 && height < 5e7) out.height = height;
  }
  const year = num("year");
  if (year !== null) out.year = clampYear(year);
  const render = params.get("layer") as RenderId | null;
  if (render && RENDERS.includes(render)) out.render = render;
  const dataset = params.get("data");
  if (dataset === "landsat" || dataset === "sentinel2") out.dataset = dataset;
  const compare = num("cmp");
  if (compare !== null) out.compareYear = clampYear(compare);
  const analysis = params.get("analysis");
  if (analysis && ANALYSIS_ID.test(analysis)) out.analysis = analysis;
  return out;
}

// ---- number formatting -----------------------------------------------------
export function formatArea(hectares: number): string {
  if (hectares >= 10_000) return `${(hectares / 100).toLocaleString("en", { maximumFractionDigits: 0 })} km²`;
  if (hectares >= 100) return `${hectares.toLocaleString("en", { maximumFractionDigits: 0 })} ha`;
  return `${hectares.toLocaleString("en", { maximumFractionDigits: 1 })} ha`;
}

export function formatIndex(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : value.toFixed(2);
}

export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return "n/a";
  const text = Math.abs(value).toFixed(digits);
  if (Number(text) === 0) return text;
  return `${value > 0 ? "+" : "−"}${text}`;
}
