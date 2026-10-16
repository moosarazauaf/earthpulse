/**
 * Weather before an event, compared with the same days in 1991 to 2020.
 *
 * Recent days come from Open-Meteo's forecast service (its weather models'
 * analyses), the 30-year baseline from its ERA5 reanalysis archive. Both are
 * model estimates for one grid cell, not station measurements, and the two
 * models differ in resolution, so the comparison is indicative.
 */
const FORECAST = "https://api.open-meteo.com/v1/forecast";
const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
export const BASELINE = { first: 1991, last: 2020 } as const;
/** The forecast service keeps this many past days. */
const PAST_DAYS = 92;
const DAY_MS = 86_400_000;

export interface Daily {
  time: string[];
  rain: (number | null)[];
  tmax: (number | null)[];
}

export interface WindowComparison {
  days: number;
  /** Total rain (mm) or mean daily maximum (°C) in the window ending on the event day. */
  value: number;
  /** The same quantity for each baseline year, missing years left out. */
  baseline: number[];
  mean: number;
  /** Baseline years with a lower value than now. */
  below: number;
  /** Baseline years with a higher value than now; the rest are equal. */
  above: number;
}

export interface WeatherContext {
  lat: number;
  lon: number;
  eventDay: string;
  recent: Daily;
  rain: WindowComparison[];
  heat: WindowComparison | null;
}

export function parseDaily(body: unknown): Daily {
  const daily = (body as { daily?: { time?: unknown; precipitation_sum?: unknown; temperature_2m_max?: unknown } } | null)?.daily;
  const time = Array.isArray(daily?.time) ? (daily!.time as unknown[]).map(String) : [];
  const nums = (v: unknown) => (Array.isArray(v) ? v.map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null)) : time.map(() => null));
  return { time, rain: nums(daily?.precipitation_sum), tmax: nums(daily?.temperature_2m_max) };
}

/** The ISO dates of the `days` days ending on `end`, inclusive. */
export function windowDates(end: string, days: number): string[] {
  const last = Date.parse(`${end}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => new Date(last - (days - 1 - i) * DAY_MS).toISOString().slice(0, 10));
}

/** Sum or mean of a daily series over given dates; null if more than a fifth of the days are missing. */
export function aggregate(daily: Daily, field: "rain" | "tmax", dates: string[], how: "sum" | "mean"): number | null {
  const index = new Map(daily.time.map((t, i) => [t, i]));
  const values = dates.map((d) => {
    const i = index.get(d);
    return i === undefined ? null : daily[field][i] ?? null;
  }).filter((v): v is number => v !== null);
  if (values.length < dates.length * 0.8) return null;
  const sum = values.reduce((a, b) => a + b, 0);
  return how === "sum" ? sum * (dates.length / values.length) : sum / values.length;
}

/** The same calendar window in another year; 29 February becomes the 28th. */
function shiftYear(day: string, year: number): string {
  const md = day.slice(5) === "02-29" ? "02-28" : day.slice(5);
  return `${year}-${md}`;
}

export function compare(recent: Daily, baseline: Daily, eventDay: string, days: number, field: "rain" | "tmax"): WindowComparison | null {
  const how = field === "rain" ? "sum" : "mean";
  const value = aggregate(recent, field, windowDates(eventDay, days), how);
  if (value === null) return null;
  const years: number[] = [];
  for (let y = BASELINE.first; y <= BASELINE.last; y++) {
    const v = aggregate(baseline, field, windowDates(shiftYear(eventDay, y), days), how);
    if (v !== null) years.push(v);
  }
  if (years.length < 20) return null;
  return {
    days,
    value,
    baseline: years,
    mean: years.reduce((a, b) => a + b, 0) / years.length,
    below: years.filter((v) => v < value).length,
    above: years.filter((v) => v > value).length,
  };
}

/** Rain totals this close count as equal: model output is not precise to the millimetre. */
const RAIN_TIE_MM = 1;

/** One sentence comparing a window with its baseline. Equal years are never counted as beaten. */
export function describe(c: WindowComparison, field: "rain" | "tmax"): string {
  const n = c.baseline.length;
  const span = `${BASELINE.first} to ${BASELINE.last}`;
  if (field === "rain") {
    const below = c.baseline.filter((v) => v < c.value - RAIN_TIE_MM).length;
    const above = c.baseline.filter((v) => v > c.value + RAIN_TIE_MM).length;
    const total = `${Math.round(c.value)} mm of rain in the ${c.days} days to the event`;
    if (c.value < RAIN_TIE_MM && above < n / 2) return `${total}: little or no rain, as in most years of ${span} at this time of year.`;
    const rank = below === n ? `wetter than in every year of ${span}`
      : above === n ? `drier than in every year of ${span}`
      : below >= above ? `wetter than in ${below} of ${n} years of ${span}`
      : `drier than in ${above} of ${n} years of ${span}`;
    const ratio = c.mean > 0.5 ? ` (${(c.value / c.mean).toFixed(1)} times the average of ${Math.round(c.mean)} mm)` : ` (the average is ${c.mean.toFixed(1)} mm)`;
    return `${total}: ${rank}${ratio}.`;
  }
  const diff = c.value - c.mean;
  const rank = c.below === n ? `hotter than in every year of ${span}` : c.above === n ? `cooler than in every year of ${span}` : `hotter than in ${c.below} of ${n} years`;
  return `Daily highs averaged ${c.value.toFixed(1)} °C in the ${c.days} days to the event, ${diff >= 0 ? "+" : "−"}${Math.abs(diff).toFixed(1)} °C against the ${span} average: ${rank}.`;
}

/** The 1991-2020 daily ERA5 series for a point. Built the same way everywhere so the browser can reuse a cached copy. */
export function baselineUrl(lat: number, lon: number): string {
  return `${ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum,temperature_2m_max&timezone=UTC&models=era5&start_date=${BASELINE.first}-01-01&end_date=${BASELINE.last}-12-31`;
}

/** ERA5 daily values for a recent period, for comparisons on the same model as the baseline. */
export function recentEra5Url(lat: number, lon: number, start: string, end: string): string {
  return `${ARCHIVE}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum,temperature_2m_max&timezone=UTC&models=era5&start_date=${start}&end_date=${end}`;
}

export async function getJson(url: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error("The weather service did not respond.");
  return response.json();
}

export async function fetchWeatherContext(lat: number, lon: number, eventDay: string, signal?: AbortSignal): Promise<WeatherContext> {
  const where = `latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&daily=precipitation_sum,temperature_2m_max&timezone=UTC`;
  const [recentBody, baselineBody] = await Promise.all([
    getJson(`${FORECAST}?${where}&past_days=${PAST_DAYS}&forecast_days=1`, signal),
    getJson(baselineUrl(lat, lon), signal),
  ]);
  const recent = parseDaily(recentBody);
  const baseline = parseDaily(baselineBody);
  const rain = [3, 7, 30, 90].map((d) => compare(recent, baseline, eventDay, d, "rain")).filter((c): c is WindowComparison => c !== null);
  return { lat, lon, eventDay, recent, rain, heat: compare(recent, baseline, eventDay, 7, "tmax") };
}
