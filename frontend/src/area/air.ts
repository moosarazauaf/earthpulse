/**
 * Air quality now and over the past week, from the CAMS atmosphere model
 * through Open-Meteo (keyless). Modelled at about 40 km (11 km over Europe),
 * so it describes the regional air, not one street.
 */
import { getJson } from "../news/weather";

const AIR = "https://air-quality-api.open-meteo.com/v1/air-quality";
/** WHO 2021 guideline for the 24-hour mean of PM2.5, µg/m³. */
export const WHO_PM25_DAY = 15;

/** US EPA AQI bands; the upper bound of each is inclusive. */
const BANDS = [
  { max: 50, label: "Good", colour: "#43a047" },
  { max: 100, label: "Moderate", colour: "#fdd835" },
  { max: 150, label: "Unhealthy for sensitive groups", colour: "#fb8c00" },
  { max: 200, label: "Unhealthy", colour: "#e53935" },
  { max: 300, label: "Very unhealthy", colour: "#8e24aa" },
  { max: Infinity, label: "Hazardous", colour: "#6d1b1b" },
] as const;

export const aqiBand = (aqi: number) => BANDS.find((b) => aqi <= b.max)!;

export interface AirQuality {
  time: string;
  usAqi: number;
  pm25: number;
  pm10: number;
  no2: number;
  ozone: number;
  /** Mean PM2.5 of each past day with at least 18 hourly values, oldest first. */
  days: { date: string; pm25: number }[];
}

/** Daily means from hourly values in local time; days with gaps are left out. */
export function dailyMeans(times: string[], values: (number | null)[]): { date: string; pm25: number }[] {
  const byDay = new Map<string, number[]>();
  times.forEach((t, i) => {
    const v = values[i];
    if (v === null || v === undefined || !Number.isFinite(v)) return;
    const day = t.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), v]);
  });
  return [...byDay].filter(([, v]) => v.length >= 18).map(([date, v]) => ({ date, pm25: v.reduce((a, b) => a + b, 0) / v.length }));
}

interface Body {
  current?: { time: string; us_aqi: number; pm2_5: number; pm10: number; nitrogen_dioxide: number; ozone: number };
  hourly?: { time: string[]; pm2_5: (number | null)[] };
}

export async function fetchAir(lat: number, lon: number, signal?: AbortSignal): Promise<AirQuality> {
  const url = `${AIR}?latitude=${lat.toFixed(3)}&longitude=${lon.toFixed(3)}&current=us_aqi,pm2_5,pm10,nitrogen_dioxide,ozone&hourly=pm2_5&past_days=7&forecast_days=1&timezone=auto`;
  const body = (await getJson(url, signal)) as Body;
  const c = body.current;
  if (!c || c.us_aqi === null || c.us_aqi === undefined) throw new Error("No air-quality values for this place.");
  const today = c.time.slice(0, 10);
  const days = body.hourly ? dailyMeans(body.hourly.time, body.hourly.pm2_5).filter((d) => d.date < today) : [];
  return { time: c.time, usAqi: c.us_aqi, pm25: c.pm2_5, pm10: c.pm10, no2: c.nitrogen_dioxide, ozone: c.ozone, days };
}
