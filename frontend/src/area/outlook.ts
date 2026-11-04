/**
 * The next 7 days for an area: what to plan around. Daily forecasts from
 * Open-Meteo's weather models (best model for the place) and the CAMS air
 * quality forecast, checked against fixed thresholds so each warning says
 * which line was crossed.
 */
import { getJson } from "../news/weather";

const FORECAST = "https://api.open-meteo.com/v1/forecast";
const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";

/** Daily rain of 50 mm or more is heavy enough to flood low ground and small rivers; 100 mm is severe. */
export const HEAVY_RAIN_MM = 50;
export const SEVERE_RAIN_MM = 100;
/** "Feels like" of 39 °C or more: the US Weather Service's danger band for heat illness. */
export const HEAT_FEELS_C = 39;
/** Gusts of 62 km/h or more: gale force (Beaufort 8), when branches break and walking is hard. */
export const GALE_KMH = 62;
/** US AQI above 150: unhealthy for everyone, not only sensitive groups. */
export const UNHEALTHY_AQI = 150;

export interface OutlookDay {
  date: string;
  rain: number;
  tmax: number;
  tmin: number;
  feels: number;
  gust: number;
  /** FAO reference evapotranspiration (mm): water a well-watered grass field would lose. */
  et0: number;
  /** Highest hourly US AQI of the day, when the air forecast reaches it. */
  aqi: number | null;
}

export interface Warning {
  kind: "rain" | "heat" | "frost" | "wind" | "air";
  /** The days it applies to, in order. */
  dates: string[];
  text: string;
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Days from the two Open-Meteo replies; days with a missing weather value are left out. */
export function parseOutlook(weather: unknown, air: unknown): OutlookDay[] {
  const d = (weather as { daily?: Record<string, unknown[]> }).daily ?? {};
  const aqiByDay = new Map<string, number>();
  const h = (air as { hourly?: { time?: string[]; us_aqi?: unknown[] } } | null)?.hourly;
  h?.time?.forEach((t, i) => {
    const v = num(h.us_aqi?.[i]);
    if (v !== null) aqiByDay.set(t.slice(0, 10), Math.max(v, aqiByDay.get(t.slice(0, 10)) ?? 0));
  });
  const days: OutlookDay[] = [];
  ((d.time as string[] | undefined) ?? []).forEach((date, i) => {
    const v = ["precipitation_sum", "temperature_2m_max", "temperature_2m_min", "apparent_temperature_max", "wind_gusts_10m_max", "et0_fao_evapotranspiration"].map((k) => num(d[k]?.[i]));
    if (v.some((x) => x === null)) return;
    const [rain, tmax, tmin, feels, gust, et0] = v as number[];
    days.push({ date, rain: rain!, tmax: tmax!, tmin: tmin!, feels: feels!, gust: gust!, et0: et0!, aqi: aqiByDay.get(date) ?? null });
  });
  return days;
}

export const dayName = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
/** "Wed, Nov 4 to Sun, Nov 8" for a run of consecutive days, commas between runs. */
export function list(dates: string[]): string {
  const runs: string[][] = [];
  for (const d of dates) {
    const run = runs.at(-1);
    if (run && Date.parse(d) - Date.parse(run.at(-1)!) === 86_400_000) run.push(d); else runs.push([d]);
  }
  return runs.map((r) => (r.length > 2 ? `${dayName(r[0]!)} to ${dayName(r.at(-1)!)}` : r.map(dayName).join(", "))).join(", ");
}

/** What crosses a threshold in the coming days, most dangerous kinds first. */
export function warnings(days: OutlookDay[]): Warning[] {
  const out: Warning[] = [];
  const pick = (test: (d: OutlookDay) => boolean) => days.filter(test);
  const heavy = pick((d) => d.rain >= HEAVY_RAIN_MM);
  if (heavy.length) {
    const max = Math.max(...heavy.map((d) => d.rain));
    out.push({ kind: "rain", dates: heavy.map((d) => d.date), text: `${max >= SEVERE_RAIN_MM ? "Severe" : "Heavy"} rain: up to ${Math.round(max)} mm in a day (${list(heavy.map((d) => d.date))}). Low ground, streets and small rivers can flood.` });
  }
  const hot = pick((d) => d.feels >= HEAT_FEELS_C);
  if (hot.length) out.push({ kind: "heat", dates: hot.map((d) => d.date), text: `Dangerous heat: feels like up to ${Math.round(Math.max(...hot.map((d) => d.feels)))} °C (${list(hot.map((d) => d.date))}). Heat illness is likely with long exposure or hard work outdoors.` });
  const frost = pick((d) => d.tmin <= 0);
  if (frost.length) out.push({ kind: "frost", dates: frost.map((d) => d.date), text: `Frost: down to ${Math.round(Math.min(...frost.map((d) => d.tmin)))} °C at night (${list(frost.map((d) => d.date))}). Protect seedlings and tender crops, and pipes.` });
  const gale = pick((d) => d.gust >= GALE_KMH);
  if (gale.length) out.push({ kind: "wind", dates: gale.map((d) => d.date), text: `Gales: gusts up to ${Math.round(Math.max(...gale.map((d) => d.gust)))} km/h (${list(gale.map((d) => d.date))}). Secure loose objects; avoid spraying.` });
  const bad = pick((d) => d.aqi !== null && d.aqi > UNHEALTHY_AQI);
  if (bad.length) out.push({ kind: "air", dates: bad.map((d) => d.date), text: `Unhealthy air: US AQI up to ${Math.max(...bad.map((d) => d.aqi!))} (${list(bad.map((d) => d.date))}). Limit time outdoors, especially for children, older people and anyone with asthma.` });
  return out;
}

/** Rain minus reference evaporation over the period (mm): negative means the ground dries out. */
export const waterBalance = (days: OutlookDay[]) => days.reduce((s, d) => s + d.rain - d.et0, 0);

export async function fetchOutlook(lat: number, lon: number, signal?: AbortSignal): Promise<OutlookDay[]> {
  const where = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&timezone=auto`;
  const [weather, air] = await Promise.all([
    getJson(`${FORECAST}?${where}&daily=precipitation_sum,temperature_2m_max,temperature_2m_min,apparent_temperature_max,wind_gusts_10m_max,et0_fao_evapotranspiration&forecast_days=7`, signal),
    // The air forecast is a bonus: the outlook still stands without it.
    getJson(`${AIR}?${where}&hourly=us_aqi&forecast_days=5`, signal).catch(() => null),
  ]);
  const days = parseOutlook(weather, air);
  if (!days.length) throw new Error("No forecast for this place.");
  return days;
}
