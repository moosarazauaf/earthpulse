/**
 * The climate of a place: 1991-2020 monthly normals and how the last twelve
 * months compare, from ERA5 reanalysis through Open-Meteo. Both periods come
 * from the same model, so the comparison is like for like (unlike the news
 * weather, whose recent days must come from forecast models).
 */
import { BASELINE, type Daily, type WindowComparison, baselineUrl, compare, getJson, parseDaily, recentEra5Url } from "../news/weather";

/** ERA5 on Open-Meteo runs about five days behind; a week is a safe margin. */
const LAG_DAYS = 7;
const DAY_MS = 86_400_000;

export interface ClimateProfile {
  /** Mean monthly rain (mm) and mean daily high (°C), January first. */
  months: { rain: number; tmax: number }[];
  annualRain: number;
  /** The last 365 days to `end`, ranked against the same days in each baseline year. */
  lastYear: WindowComparison | null;
  end: string;
}

/** Monthly normals from a daily baseline series. */
export function monthlyNormals(daily: Daily): { rain: number; tmax: number }[] {
  const rain = Array.from({ length: 12 }, () => 0);
  const tmaxSum = Array.from({ length: 12 }, () => 0);
  const tmaxN = Array.from({ length: 12 }, () => 0);
  const years = new Set<string>();
  daily.time.forEach((day, i) => {
    const m = Number(day.slice(5, 7)) - 1;
    years.add(day.slice(0, 4));
    const r = daily.rain[i], t = daily.tmax[i];
    if (r != null) rain[m]! += r;
    if (t != null) { tmaxSum[m]! += t; tmaxN[m]! += 1; }
  });
  const n = Math.max(years.size, 1);
  return rain.map((total, m) => ({ rain: total / n, tmax: tmaxN[m] ? tmaxSum[m]! / tmaxN[m]! : NaN }));
}

const MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** Plain sentences describing the normals. */
export function describeNormals(months: ClimateProfile["months"]): string {
  const annual = months.reduce((a, m) => a + m.rain, 0);
  const wettest = months.reduce((best, m, i) => (m.rain > months[best]!.rain ? i : best), 0);
  const hottest = months.reduce((best, m, i) => (m.tmax > months[best]!.tmax ? i : best), 0);
  const coolest = months.reduce((best, m, i) => (m.tmax < months[best]!.tmax ? i : best), 0);
  const share = annual > 0 ? Math.round((months[wettest]!.rain / annual) * 100) : 0;
  return `An average year (${BASELINE.first} to ${BASELINE.last}) brings ${Math.round(annual)} mm of rain, ${share}% of it in ${MONTH[wettest]}, ` +
    `the wettest month. Daily highs average ${Math.round(months[coolest]!.tmax)} °C in ${MONTH[coolest]} and ${Math.round(months[hottest]!.tmax)} °C in ${MONTH[hottest]}.`;
}

export async function fetchClimate(lat: number, lon: number, signal?: AbortSignal, now = new Date()): Promise<ClimateProfile> {
  const endTime = now.getTime() - LAG_DAYS * DAY_MS;
  const end = new Date(endTime).toISOString().slice(0, 10);
  const start = new Date(endTime - 365 * DAY_MS).toISOString().slice(0, 10);
  const [baselineBody, recentBody] = await Promise.all([
    getJson(baselineUrl(lat, lon), signal),
    getJson(recentEra5Url(lat, lon, start, end), signal),
  ]);
  const baseline = parseDaily(baselineBody);
  const recent = parseDaily(recentBody);
  const months = monthlyNormals(baseline);
  return {
    months,
    annualRain: months.reduce((a, m) => a + m.rain, 0),
    lastYear: compare(recent, baseline, end, 365, "rain"),
    end,
  };
}

/**
 * Conditions in which landslides happen: a week wetter than nine in ten
 * baseline years (and at least 20 mm) on ground where a tenth or more is
 * steeper than 15 degrees. A description of conditions, not a forecast.
 */
export function landslideConditions(week: WindowComparison | undefined, steepShare: number | null): boolean {
  if (!week || steepShare === null) return false;
  return week.value >= 20 && week.below >= 0.9 * week.baseline.length && steepShare >= 0.1;
}
