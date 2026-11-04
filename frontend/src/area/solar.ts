/**
 * How much electricity solar panels would make here, from ten years of
 * sunshine at the ground (ERA5 daily shortwave radiation through Open-Meteo).
 *
 * Panel output is estimated as sunshine on flat ground × 0.85 per kW of
 * panels: tilting panels towards the equator gains roughly 10 to 15%, and
 * heat, dust, wiring and inverter losses take back roughly 20 to 25%. A rule
 * of thumb for planning, not a design: shading and local dust change it.
 */
import { getJson } from "../news/weather";

const ARCHIVE = "https://archive-api.open-meteo.com/v1/archive";
export const YIELD_FACTOR = 0.85;

export interface SolarProfile {
  /** Average sunshine on flat ground, kWh per m² per day, January to December. */
  months: number[];
  /** kWh a year from each kW of panels. */
  yearlyPerKw: number;
  years: string;
}

/** Monthly means of daily sunshine (MJ/m² in, kWh/m² out) and the yearly panel output. */
export function solarProfile(time: string[], mj: (number | null)[]): SolarProfile | null {
  const sum = Array(12).fill(0), n = Array(12).fill(0);
  time.forEach((t, i) => {
    const v = mj[i];
    if (v === null || v === undefined) return;
    const m = Number(t.slice(5, 7)) - 1;
    sum[m] += v / 3.6;
    n[m] += 1;
  });
  if (n.some((c) => c === 0)) return null;
  const months = sum.map((s, m) => s / n[m]);
  const days = [31, 28.25, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const yearly = months.reduce((s, v, m) => s + v * days[m]!, 0);
  return { months, yearlyPerKw: yearly * YIELD_FACTOR, years: `${time[0]!.slice(0, 4)} to ${time.at(-1)!.slice(0, 4)}` };
}

export async function fetchSolar(lat: number, lon: number, signal?: AbortSignal, now = new Date()): Promise<SolarProfile> {
  const last = now.getUTCFullYear() - 1;
  const body = (await getJson(`${ARCHIVE}?latitude=${lat.toFixed(2)}&longitude=${lon.toFixed(2)}&start_date=${last - 9}-01-01&end_date=${last}-12-31&daily=shortwave_radiation_sum`, signal)) as { daily?: { time?: string[]; shortwave_radiation_sum?: (number | null)[] } };
  const profile = solarProfile(body.daily?.time ?? [], body.daily?.shortwave_radiation_sum ?? []);
  if (!profile) throw new Error("No sunshine record for this place.");
  return profile;
}
