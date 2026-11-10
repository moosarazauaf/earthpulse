/**
 * The Earth-observation satellites Earthsift reads, where they are now and
 * when they next pass over a place. Orbits are CelesTrak's two-line elements
 * (keyless, CORS), propagated in the browser with satellite.js (SGP4).
 * A pass means the place lies inside the satellite's imaging swath, and, for
 * the optical satellites, that the sun is up; whether it actually takes a
 * picture depends on the mission's acquisition plan.
 */
import { degreesLat, degreesLong, eciToGeodetic, gstime, propagate, type SatRec, twoline2satrec } from "satellite.js";

import { distanceKm } from "../news/stories";

export interface Satellite {
  name: string;
  norad: number;
  /** Width of the imaging swath, km. */
  swathKm: number;
  optical: boolean;
  colour: string;
}

export const SATELLITES: Satellite[] = [
  { name: "Landsat 8", norad: 39084, swathKm: 185, optical: true, colour: "#8db85a" },
  { name: "Landsat 9", norad: 49260, swathKm: 185, optical: true, colour: "#8db85a" },
  { name: "Sentinel-2A", norad: 40697, swathKm: 290, optical: true, colour: "#d9a441" },
  { name: "Sentinel-2B", norad: 42063, swathKm: 290, optical: true, colour: "#d9a441" },
  { name: "Sentinel-2C", norad: 60989, swathKm: 290, optical: true, colour: "#d9a441" },
  { name: "Sentinel-1A", norad: 39634, swathKm: 250, optical: false, colour: "#6a9ab0" },
  { name: "Sentinel-1C", norad: 62261, swathKm: 250, optical: false, colour: "#6a9ab0" },
];

// The Earth-resources group, plus Sentinel-1C, which CelesTrak has not put in that group.
const TLE_URLS = [
  "https://celestrak.org/NORAD/elements/gp.php?GROUP=resource&FORMAT=TLE",
  "https://celestrak.org/NORAD/elements/gp.php?CATNR=62261&FORMAT=TLE",
];

/** The satellites above whose elements appear in a TLE file (name line, line 1, line 2). */
export function parseTles(text: string): { sat: Satellite; rec: SatRec }[] {
  const lines = text.split(/\r?\n/).map((l) => l.trimEnd());
  const out: { sat: Satellite; rec: SatRec }[] = [];
  for (let i = 0; i + 2 < lines.length; i += 1) {
    const l1 = lines[i + 1]!, l2 = lines[i + 2]!;
    if (!l1.startsWith("1 ") || !l2.startsWith("2 ")) continue;
    const sat = SATELLITES.find((s) => s.norad === Number(l1.slice(2, 7)));
    if (sat) out.push({ sat, rec: twoline2satrec(l1, l2) });
    i += 2;
  }
  return out;
}

let tles: Promise<{ sat: Satellite; rec: SatRec }[]> | null = null;

export function fetchSatellites(): Promise<{ sat: Satellite; rec: SatRec }[]> {
  tles ??= Promise.all(TLE_URLS.map((url) => fetch(url).then((r) => { if (!r.ok) throw new Error("CelesTrak did not respond."); return r.text(); })))
    .then((texts) => parseTles(texts.join("\n")))
    .catch((e: unknown) => { tles = null; throw e; });
  return tles;
}

/** Sub-satellite point and height at a time, or null when SGP4 cannot propagate. */
export function positionAt(rec: SatRec, date: Date): { lon: number; lat: number; heightKm: number } | null {
  const pv = propagate(rec, date);
  if (!pv || typeof pv.position !== "object" || !pv.position) return null;
  const geo = eciToGeodetic(pv.position, gstime(date));
  return { lon: degreesLong(geo.longitude), lat: degreesLat(geo.latitude), heightKm: geo.height };
}

/** Positions every `stepS` seconds from `from` for `minutes`, for drawing a ground track. */
export function track(rec: SatRec, from: Date, minutes: number, stepS = 30) {
  const points: { lon: number; lat: number }[] = [];
  for (let t = 0; t <= minutes * 60; t += stepS) {
    const p = positionAt(rec, new Date(from.getTime() + t * 1000));
    if (p) points.push(p);
  }
  return points;
}

/** Sun elevation in degrees (NOAA's low-precision solar position, good to a fraction of a degree). */
export function sunElevation(date: Date, lon: number, lat: number): number {
  const d = date.getTime() / 86_400_000 - 10_957.5; // days since 2000-01-01 12:00 UTC
  const g = ((357.529 + 0.98560028 * d) * Math.PI) / 180;
  const q = 280.459 + 0.98564736 * d;
  const L = ((q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * Math.PI) / 180;
  const e = ((23.439 - 0.00000036 * d) * Math.PI) / 180;
  const dec = Math.asin(Math.sin(e) * Math.sin(L));
  const ra = Math.atan2(Math.cos(e) * Math.sin(L), Math.cos(L));
  const gmst = ((18.697374558 + 24.06570982441908 * d) % 24) * 15;
  const hour = ((gmst + lon) * Math.PI) / 180 - ra;
  const phi = (lat * Math.PI) / 180;
  return (Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(hour)) * 180) / Math.PI;
}

/** Next passes of every satellite over a place, one satellite at a time so the page stays responsive. */
export async function nextPasses(sats: { sat: Satellite; rec: SatRec }[], lon: number, lat: number, signal?: AbortSignal): Promise<{ sat: Satellite; when: Date | null }[]> {
  const out: { sat: Satellite; when: Date | null }[] = [];
  for (const { sat, rec } of sats) {
    await new Promise((r) => setTimeout(r, 0));
    if (signal?.aborted) break;
    out.push({ sat, when: nextPass(sat, rec, lon, lat) });
  }
  return out;
}

/**
 * The next time the place lies within half the swath of the satellite's
 * ground point (and in daylight, for optical satellites), searching `days`
 * ahead in `stepS`-second steps; null if none.
 */
export function nextPass(sat: Satellite, rec: SatRec, lon: number, lat: number, from = new Date(), days = 16, stepS = 20): Date | null {
  const end = from.getTime() + days * 86_400_000;
  for (let t = from.getTime(); t < end; t += stepS * 1000) {
    const date = new Date(t);
    const p = positionAt(rec, date);
    if (!p || distanceKm(p, { lat, lon }) > sat.swathKm / 2) continue;
    if (sat.optical && sunElevation(date, lon, lat) < 5) continue;
    return date;
  }
  return null;
}
