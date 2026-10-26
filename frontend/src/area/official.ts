/**
 * Official figures to set beside EarthPulse's own estimates: national
 * statistics from the World Bank, and, where the UN tracks a place, IPC
 * food-insecurity analyses and WFP rainfall anomalies through UN OCHA's
 * Humanitarian API (HDX HAPI). All keyless and readable from the browser.
 */
const WB = "https://api.worldbank.org/v2/country";
const HAPI = "https://hapi.humdata.org/api/v2";
// HAPI asks every caller to identify itself as base64("app:email"); this is an identification, not a secret.
const APP = btoa("EarthPulse:moosarazauaf@users.noreply.github.com");

export const INDICATORS = {
  population: "SP.POP.TOTL",
  urban: "SP.URB.TOTL.IN.ZS",
  gdpPerPerson: "NY.GDP.PCAP.CD",
  poverty: "SI.POV.DDAY",
} as const;
type Indicator = keyof typeof INDICATORS;
export type CountryFacts = Partial<Record<Indicator, { value: number; year: string }>> & { country: string };

type WbRow = { indicator: { id: string }; country: { value: string }; date: string; value: number | null };

/** The latest value of each indicator from a World Bank answer ([paging, rows]). */
export function parseCountryFacts(body: unknown): CountryFacts | null {
  const rows = Array.isArray(body) && Array.isArray(body[1]) ? (body[1] as WbRow[]) : [];
  if (!rows.length) return null;
  const facts: CountryFacts = { country: rows[0]!.country.value };
  for (const [key, id] of Object.entries(INDICATORS) as [Indicator, string][]) {
    const row = rows.find((r) => r.indicator.id === id && r.value !== null);
    if (row) facts[key] = { value: row.value!, year: row.date };
  }
  return facts;
}

export async function fetchCountryFacts(iso3: string, signal?: AbortSignal): Promise<CountryFacts | null> {
  const ids = Object.values(INDICATORS).join(";");
  const response = await fetch(`${WB}/${iso3}/indicator/${ids}?source=2&format=json&mrnev=1&per_page=20`, { signal });
  if (!response.ok) return null;
  return parseCountryFacts(await response.json());
}

/** Lower case, letters only, so "Dera Ghazi Khan" and "D.G. Khan" style differences do not stop a match. */
const key = (s: string) => s.toLowerCase().normalize("NFD").replace(/[^a-z]/g, "");

export interface FoodSecurity {
  district: string;
  /** People in IPC Phase 3 (Crisis) or worse, and their share of the district. */
  crisis: number;
  share: number;
  period: [string, string];
}

type HapiFood = { admin2_name: string | null; ipc_phase: string; ipc_type: string; population_in_phase: number; population_fraction_in_phase: number; reference_period_start: string; reference_period_end: string };

/** The latest current-situation IPC figure for Phase 3+ in the district named, if the UN has one. */
export function parseFoodSecurity(rows: HapiFood[], district: string): FoodSecurity | null {
  const mine = rows.filter((r) => r.admin2_name && key(r.admin2_name) === key(district) && r.ipc_phase === "3+" && r.ipc_type === "current");
  if (!mine.length) return null;
  const latest = mine.reduce((a, b) => (b.reference_period_end > a.reference_period_end ? b : a));
  return { district: latest.admin2_name!, crisis: latest.population_in_phase, share: latest.population_fraction_in_phase, period: [latest.reference_period_start.slice(0, 10), latest.reference_period_end.slice(0, 10)] };
}

export interface RainAnomaly {
  district: string;
  /** Rain in the month as a percentage of its long-term average (CHIRPS). */
  percent: number;
  period: [string, string];
}

type HapiRain = { admin2_name: string | null; aggregation_period: string; rainfall_anomaly_pct: number; reference_period_start: string; reference_period_end: string };

/** The latest one-month rainfall anomaly for the district named. */
export function parseRainAnomaly(rows: HapiRain[], district: string): RainAnomaly | null {
  const mine = rows.filter((r) => r.admin2_name && key(r.admin2_name) === key(district) && r.aggregation_period === "1-month" && Number.isFinite(r.rainfall_anomaly_pct));
  if (!mine.length) return null;
  const latest = mine.reduce((a, b) => (b.reference_period_end > a.reference_period_end ? b : a));
  return { district: latest.admin2_name!, percent: latest.rainfall_anomaly_pct, period: [latest.reference_period_start.slice(0, 10), latest.reference_period_end.slice(0, 10)] };
}

async function hapi<T>(path: string, query: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(`${HAPI}/${path}?${query}&output_format=json&limit=1000&app_identifier=${APP}`, { signal });
  if (!response.ok) return [];
  return ((await response.json()) as { data?: T[] }).data ?? [];
}

export async function fetchFoodSecurity(iso3: string, district: string, signal?: AbortSignal): Promise<FoodSecurity | null> {
  return parseFoodSecurity(await hapi<HapiFood>("food-security-nutrition-poverty/food-security", `location_code=${iso3}&ipc_phase=3%2B&ipc_type=current`, signal), district);
}

export async function fetchRainAnomaly(iso3: string, district: string, now = new Date(), signal?: AbortSignal): Promise<RainAnomaly | null> {
  // A whole country's records overflow one page, so ask for this district (HAPI matches part of the name, any case).
  const since = new Date(now.getTime() - 120 * 86_400_000).toISOString().slice(0, 10);
  const query = `location_code=${iso3}&admin2_name=${encodeURIComponent(district)}&aggregation_period=1-month&reference_period_start_min=${since}`;
  return parseRainAnomaly(await hapi<HapiRain>("climate/rainfall", query, signal), district);
}
