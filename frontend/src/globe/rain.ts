/**
 * Rain and snow rate from NASA IMERG (GPM satellites, half-hourly, global)
 * through NASA GIBS: keyless map tiles with CORS. The near-real-time run
 * arrives some hours late, so the newest time is asked of GIBS rather than
 * assumed.
 */
const LAYER = "IMERG_Precipitation_Rate_30min";
const BASE = `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best`;
const STEP_MS = 30 * 60_000;
export const RAIN_FRAMES = 6;

/** The end of the last time range in a GIBS DescribeDomains answer. */
export function lastDomainTime(xml: string): string | null {
  const ends = [...xml.matchAll(/\/(\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ)\/PT30M/g)].map((m) => m[1]!);
  return ends.length ? ends[ends.length - 1]! : null;
}

/** `count` half-hour times ending at `latest`, oldest first. */
export function rainTimes(latest: string, count = RAIN_FRAMES): string[] {
  const end = Date.parse(latest);
  return Array.from({ length: count }, (_, i) => new Date(end - (count - 1 - i) * STEP_MS).toISOString().replace(".000", ""));
}

export function rainTileUrl(time: string): string {
  return `${BASE}/${LAYER}/default/${time}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png`;
}

/** The newest half hour GIBS has, from its small time-domain endpoint. */
export async function latestRainTime(now = new Date()): Promise<string> {
  const day = (offset: number) => new Date(now.getTime() + offset * 86_400_000).toISOString().slice(0, 10);
  const response = await fetch(`${BASE}/1.0.0/${LAYER}/default/GoogleMapsCompatible_Level6/all/${day(-2)}--${day(1)}.xml`);
  if (!response.ok) throw new Error("NASA GIBS did not respond.");
  const latest = lastDomainTime(await response.text());
  if (!latest) throw new Error("No recent rain maps were listed.");
  return latest;
}
