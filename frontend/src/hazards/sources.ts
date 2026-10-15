/**
 * Live hazard information from public services.
 *
 * EarthPulse does not produce any of this itself: it shows what the named
 * agency publishes, with that agency's own wording of what the product is.
 * Each layer says whether it is an observation or a forecast.
 */
import type { ValueKind } from "../app/types";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Alerts that ended longer ago than this are not "now". */
export const ALERT_WINDOW_DAYS = 14;

// ---- map layers -----------------------------------------------------------------
export interface HazardLayer {
  id: string;
  title: string;
  /** What question the layer answers, in plain words. */
  answers: string;
  kind: ValueKind;
  url: string;
  layers: string;
  /** Which date to request: the latest full UTC day, or whatever the service has newest. */
  time: "yesterday" | "latest";
  provider: string;
  attribution: string;
  /** What the layer is not. Shown next to it. */
  caveat: string;
}

const GLOFAS = "https://ows.globalfloods.eu/glofas-ows/ows.py";

export const HAZARD_LAYERS: HazardLayer[] = [
  {
    id: "fires",
    title: "Active fire detections",
    answers: "Where is fire being detected?",
    kind: "OBSERVED",
    url: "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi",
    layers: "VIIRS_NOAA20_Thermal_Anomalies_375m_All",
    time: "yesterday",
    provider: "NASA FIRMS / GIBS (VIIRS on NOAA-20, 375 m)",
    attribution: "NASA EOSDIS GIBS, FIRMS",
    caveat: "Each point is a hot spot the satellite saw, including gas flares and crop burning. It is not a confirmed wildfire or a fire perimeter, and cloud hides fires.",
  },
  {
    id: "fire-danger",
    title: "Fire danger forecast",
    answers: "Where could fire spread easily?",
    kind: "MODELED",
    url: "https://maps.effis.emergency.copernicus.eu/gwis",
    layers: "ecmwf.fwi",
    time: "latest",
    provider: "Copernicus GWIS (Fire Weather Index from ECMWF forecasts)",
    attribution: "Copernicus Emergency Management Service, GWIS",
    caveat: "This is weather-driven fire danger: how easily a fire would spread if one started. It does not predict that a fire will start.",
  },
  {
    id: "flood-forecast",
    title: "Flood forecast, next 3 days",
    answers: "Where are rivers forecast to flood?",
    kind: "MODELED",
    url: GLOFAS,
    layers: "sumAL41EGE",
    time: "latest",
    provider: "Copernicus GloFAS (flood summary, days 1 to 3)",
    attribution: "Copernicus Emergency Management Service, GloFAS",
    caveat: "A model forecast of river flow exceeding 2, 5 and 20 year return levels. It covers large rivers only, not flash floods or urban flooding, and forecasts can be wrong.",
  },
  {
    id: "flood-forecast-10",
    title: "Flood forecast, days 4 to 10",
    answers: "Where might rivers flood later this week?",
    kind: "MODELED",
    url: GLOFAS,
    layers: "sumAL42EGE",
    time: "latest",
    provider: "Copernicus GloFAS (flood summary, days 4 to 10)",
    attribution: "Copernicus Emergency Management Service, GloFAS",
    caveat: "Less certain than the 3 day forecast. Large rivers only.",
  },
  {
    id: "flood-observed",
    title: "Observed flood extent",
    answers: "Where has flooding been seen from space?",
    kind: "DERIVED",
    url: GLOFAS,
    layers: "gfm_observed_flood_extent_group_layer",
    time: "latest",
    provider: "Copernicus Global Flood Monitoring (Sentinel-1 radar)",
    attribution: "Copernicus Emergency Management Service, GFM",
    caveat: "Mapped automatically from radar passes, so it shows only places a satellite has passed over recently. Water under vegetation or in cities is missed.",
  },
];

/** Latest full UTC day: today's satellite passes are still arriving. */
export function yesterdayUtc(now = new Date()): string {
  return new Date(now.getTime() - DAY_MS).toISOString().slice(0, 10);
}

/** WMS parameters for a layer on a given day. */
export function wmsParameters(layer: HazardLayer, now = new Date()): Record<string, string> {
  const parameters: Record<string, string> = { transparent: "true", format: "image/png" };
  if (layer.time === "yesterday") parameters.time = yesterdayUtc(now);
  return parameters;
}

// ---- alerts -----------------------------------------------------------------------
export type AlertType = "FL" | "WF" | "TC" | "EQ" | "DR" | "VO";
export const ALERT_TYPES: Record<AlertType, string> = {
  FL: "Flood",
  WF: "Wildfire",
  TC: "Tropical cyclone",
  EQ: "Earthquake",
  DR: "Drought",
  VO: "Volcano",
};

export interface Alert {
  id: string;
  type: AlertType;
  level: "Red" | "Orange";
  name: string;
  country: string;
  lon: number;
  lat: number;
  from: string;
  to: string;
  /** True when the agency marks the event as still in progress. */
  ongoing: boolean;
  severity: string;
  source: string;
  reportUrl: string;
}

const GDACS = "https://www.gdacs.org/gdacsapi/api/events/geteventlist/SEARCH";

export function alertsUrl(now = new Date()): string {
  const from = new Date(now.getTime() - ALERT_WINDOW_DAYS * DAY_MS).toISOString().slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  return `${GDACS}?eventlist=${Object.keys(ALERT_TYPES).join(";")}&alertlevel=red;orange&fromDate=${from}&toDate=${to}`;
}

interface GdacsFeature {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: Record<string, unknown>;
}

/** Turn the GDACS GeoJSON into alerts, dropping anything malformed. Ongoing events first, then red before orange, then most recent. */
export function parseAlerts(body: unknown): Alert[] {
  const features = (body as { features?: GdacsFeature[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const alerts: Alert[] = [];
  for (const feature of features) {
    const p = feature.properties ?? {};
    const coordinates = feature.geometry?.coordinates;
    const type = String(p.eventtype ?? "") as AlertType;
    const level = String(p.alertlevel ?? "");
    if (!Array.isArray(coordinates) || !(type in ALERT_TYPES) || (level !== "Red" && level !== "Orange")) continue;
    const [lon, lat] = coordinates as number[];
    if (typeof lon !== "number" || typeof lat !== "number" || Math.abs(lon) > 180 || Math.abs(lat) > 90) continue;
    const report = String((p.url as { report?: string } | undefined)?.report ?? "");
    alerts.push({
      id: `${type}-${p.eventid}-${p.episodeid}`,
      type,
      level,
      name: String(p.name ?? ALERT_TYPES[type]),
      country: String(p.country ?? ""),
      lon,
      lat,
      from: String(p.fromdate ?? "").slice(0, 10),
      to: String(p.todate ?? "").slice(0, 10),
      ongoing: String(p.iscurrent) === "true",
      severity: String((p.severitydata as { severitytext?: string } | undefined)?.severitytext ?? ""),
      source: String(p.source ?? ""),
      // Only link to the agency's own site.
      reportUrl: report.startsWith("https://www.gdacs.org/") ? report : "https://www.gdacs.org/",
    });
  }
  // "Now" matters more than severity: an ended red alert ranks below an ongoing orange one.
  const rank = (a: Alert) => (a.ongoing ? 0 : 1) * 2 + (a.level === "Red" ? 0 : 1);
  return alerts.sort((a, b) => rank(a) - rank(b) || b.to.localeCompare(a.to));
}

// ---- earthquakes -------------------------------------------------------------------
const USGS_QUAKES = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_week.geojson";

export interface Quake {
  id: string;
  magnitude: number;
  place: string;
  time: string;
  lon: number;
  lat: number;
  depthKm: number;
  url: string;
  /** USGS PAGER estimate of losses: green, yellow, orange or red; null when none was issued. */
  pager: "green" | "yellow" | "orange" | "red" | null;
  /** True when the USGS flags the event for possible tsunami. */
  tsunami: boolean;
}

/** Earthquakes from the USGS feed, strongest first; malformed entries are dropped. */
export function parseQuakes(body: unknown): Quake[] {
  const features = (body as { features?: { id?: string; geometry?: { coordinates?: number[] }; properties?: Record<string, unknown> }[] } | null)?.features;
  if (!Array.isArray(features)) return [];
  const quakes: Quake[] = [];
  for (const feature of features) {
    const p = feature.properties ?? {};
    const [lon, lat, depth] = feature.geometry?.coordinates ?? [];
    if (typeof lon !== "number" || typeof lat !== "number" || typeof p.mag !== "number" || p.type !== "earthquake") continue;
    const url = String(p.url ?? "");
    quakes.push({
      id: String(feature.id),
      magnitude: p.mag,
      place: String(p.place ?? "Unnamed location"),
      time: new Date(Number(p.time)).toISOString(),
      lon,
      lat,
      depthKm: typeof depth === "number" ? depth : 0,
      url: url.startsWith("https://earthquake.usgs.gov/") ? url : "https://earthquake.usgs.gov/",
      pager: ["green", "yellow", "orange", "red"].includes(String(p.alert)) ? (p.alert as Quake["pager"]) : null,
      tsunami: p.tsunami === 1,
    });
  }
  return quakes.sort((a, b) => b.magnitude - a.magnitude);
}

export async function fetchQuakes(): Promise<Quake[]> {
  const response = await fetch(USGS_QUAKES);
  if (!response.ok) throw new Error("The earthquake service did not respond.");
  return parseQuakes(await response.json());
}

export async function fetchAlerts(): Promise<Alert[]> {
  const response = await fetch(alertsUrl());
  if (!response.ok) throw new Error("The alert service did not respond.");
  return parseAlerts(await response.json());
}
