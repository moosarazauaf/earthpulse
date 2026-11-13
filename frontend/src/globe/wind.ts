/**
 * Surface wind now, as particles drifting with it. Wind speed and direction
 * at 10 m come from Open-Meteo's forecast models (keyless, CORS) on a 10°
 * grid from 60° S to 70° N; between grid points the wind is interpolated, so
 * the flow shows the large weather systems, not local gusts.
 */
import { getJson } from "../news/weather";

const LATS = Array.from({ length: 14 }, (_, i) => -60 + i * 10); // -60 … 70
const LONS = Array.from({ length: 36 }, (_, i) => -180 + i * 10); // -180 … 170

export interface WindField {
  /** East and north components (m/s) at each grid node, row by row from LATS[0]. */
  u: Float32Array;
  v: Float32Array;
  time: string;
}

/** Meteorological direction is where the wind comes from; the components point where it goes. */
export function components(speed: number, fromDeg: number): [number, number] {
  const a = (fromDeg * Math.PI) / 180;
  return [-speed * Math.sin(a), -speed * Math.cos(a)];
}

type Body = { current?: { time: string; wind_speed_10m: number; wind_direction_10m: number } };

/** Open-Meteo's current values change every 15 minutes, and one field costs 504 of a visitor's 600 free calls a minute. */
const KEEP_MS = 15 * 60_000;
let kept: { at: number; field: Promise<WindField> } | null = null;

export function fetchWind(now = Date.now()): Promise<WindField> {
  if (kept && now - kept.at < KEEP_MS) return kept.field;
  const field = loadWind();
  kept = { at: now, field };
  // A failed load is not kept, so the next switch-on tries again.
  field.catch(() => { if (kept?.field === field) kept = null; });
  return field;
}

async function loadWind(): Promise<WindField> {
  const nodes = LATS.flatMap((lat) => LONS.map((lon) => [lat, lon] as const));
  const u = new Float32Array(nodes.length), v = new Float32Array(nodes.length);
  let time = "";
  await Promise.all(Array.from({ length: Math.ceil(nodes.length / 100) }, async (_, b) => {
    const batch = nodes.slice(b * 100, b * 100 + 100);
    const body = await getJson(`https://api.open-meteo.com/v1/forecast?latitude=${batch.map((n) => n[0]).join(",")}&longitude=${batch.map((n) => n[1]).join(",")}&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=ms`);
    (Array.isArray(body) ? (body as Body[]) : [body as Body]).forEach((r, i) => {
      if (!r.current) return;
      [u[b * 100 + i], v[b * 100 + i]] = components(r.current.wind_speed_10m, r.current.wind_direction_10m);
      time = r.current.time;
    });
  }));
  return { u, v, time };
}

/** Wind (u, v) at a point by bilinear interpolation, wrapping in longitude; null outside the grid's latitudes. */
export function windAt(field: WindField, lon: number, lat: number): [number, number] | null {
  if (lat < LATS[0]! || lat > LATS[LATS.length - 1]!) return null;
  const fy = (lat - LATS[0]!) / 10, fx = (((lon + 180) % 360) + 360) % 360 / 10;
  const y0 = Math.min(Math.floor(fy), LATS.length - 2), x0 = Math.floor(fx) % LONS.length, x1 = (x0 + 1) % LONS.length;
  const ty = fy - y0, tx = fx - Math.floor(fx);
  const at = (arr: Float32Array, y: number, x: number) => arr[y * LONS.length + x]!;
  const mix = (arr: Float32Array) =>
    (at(arr, y0, x0) * (1 - tx) + at(arr, y0, x1) * tx) * (1 - ty) + (at(arr, y0 + 1, x0) * (1 - tx) + at(arr, y0 + 1, x1) * tx) * ty;
  return [mix(field.u), mix(field.v)];
}

/** Degrees moved per frame for each m/s of wind: 10 m/s crosses about 2.4° a second at 60 frames a second. */
export const STEP_DEG = 0.004;

/** One step of a particle along the wind; null when it leaves the grid. */
export function advect(field: WindField, lon: number, lat: number): { lon: number; lat: number; speed: number } | null {
  const w = windAt(field, lon, lat);
  if (!w) return null;
  const [u, v] = w;
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  const next = { lon: lon + (u * STEP_DEG) / cos, lat: lat + v * STEP_DEG, speed: Math.hypot(u, v) };
  if (next.lon > 180) next.lon -= 360;
  if (next.lon < -180) next.lon += 360;
  return next;
}

/** Particle colour by speed: slate when calm, sage, ochre, terracotta in a gale. */
export function speedColour(speed: number): string {
  return speed < 4 ? "#6a9ab0" : speed < 8 ? "#a3b18a" : speed < 13 ? "#d9a441" : "#d0703f";
}
