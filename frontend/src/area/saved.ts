/**
 * My places and recent analyses, kept in this browser (localStorage). Nothing
 * leaves the device. A recent analysis is kept as its recipe, the same one a
 * shared link carries, so it can be run again; the result itself is not
 * stored, because its images live only in the tab that made them.
 */
import { formatArea } from "../app/logic";
import { encodeRun } from "../app/shareRun";
import type { AnalysisResult, AoiGeometry } from "../app/types";

export interface SavedPlace {
  id: string;
  label: string;
  geometry: AoiGeometry;
  savedAt: string;
}

export interface RecentRun {
  id: string;
  label: string;
  type: AnalysisResult["type"];
  at: string;
  headline: string;
  /** The shared-link parameter that re-runs it; null if it cannot be re-run from a link. */
  run: string | null;
}

const PLACES_KEY = "earthpulse.places.v1";
const RECENT_KEY = "earthpulse.recent.v1";
const MAX_PLACES = 30;
const MAX_RECENT = 15;
/** Uploaded outlines can be large; one place may use at most this much storage. */
const MAX_PLACE_CHARS = 200_000;

function read<T>(key: string): T[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(value) ? (value as T[]) : [];
  } catch {
    return [];
  }
}

function write(key: string, items: unknown[]): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(items));
    return true;
  } catch {
    return false; // private mode, storage full or blocked
  }
}

export const loadPlaces = () => read<SavedPlace>(PLACES_KEY).filter((p) => p && typeof p.label === "string" && p.geometry);
export const loadRecent = () => read<RecentRun>(RECENT_KEY).filter((r) => r && typeof r.headline === "string");

/** Add a place (replacing one with the same label); returns the new list, or null if it could not be stored. */
export function savePlace(places: SavedPlace[], label: string, geometry: AoiGeometry): SavedPlace[] | null {
  if (JSON.stringify(geometry).length > MAX_PLACE_CHARS) return null;
  const place: SavedPlace = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, label, geometry, savedAt: new Date().toISOString() };
  const next = [place, ...places.filter((p) => p.label !== label)].slice(0, MAX_PLACES);
  return write(PLACES_KEY, next) ? next : null;
}

export function removePlace(places: SavedPlace[], id: string): SavedPlace[] {
  const next = places.filter((p) => p.id !== id);
  write(PLACES_KEY, next);
  return next;
}

/** One line saying what a result found. */
export function headline(result: AnalysisResult): string {
  switch (result.type) {
    case "change": {
      const s = result.summary;
      const name = result.request.index === "nbr" ? "Burn severity" : `${result.request.index.toUpperCase()} change`;
      return `${name}: ${formatArea(s.lossAreaHa)} down, ${formatArea(s.gainAreaHa)} up`;
    }
    case "flood":
      return `${formatArea(result.summary.floodedAreaHa)} newly flooded`;
    case "water":
      return `Water ${formatArea(result.summary.firstHa)} in ${result.summary.firstYear}, ${formatArea(result.summary.lastHa)} in ${result.summary.lastYear}`;
    case "urban":
      return `${result.summary.focusName} ${formatArea(result.summary.firstHa)} to ${formatArea(result.summary.lastHa)}, ${result.summary.firstYear}–${result.summary.lastYear}`;
    case "timeseries":
      return `Index series, ${result.series.filter((e) => e.values).length} years`;
  }
}

export function addRecent(recent: RecentRun[], result: AnalysisResult): RecentRun[] {
  const entry: RecentRun = {
    id: result.id,
    label: result.label ?? "Area",
    type: result.type,
    at: new Date().toISOString(),
    headline: headline(result),
    run: encodeRun(result),
  };
  const next = [entry, ...recent.filter((r) => r.id !== entry.id)].slice(0, MAX_RECENT);
  write(RECENT_KEY, next);
  return next;
}

export function clearRecent(): RecentRun[] {
  write(RECENT_KEY, []);
  return [];
}
