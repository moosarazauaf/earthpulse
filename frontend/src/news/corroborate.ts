/**
 * Does an agency record back up a news story? Earthquake stories are matched
 * to the USGS catalogue, other hazards to GDACS alerts, by kind, distance and
 * date. A match is evidence that the event happened where the story is
 * placed; no match is not evidence that it did not.
 */
import type { Alert, AlertType, Quake } from "../hazards/sources";
import { HAZARD_INFO } from "./hazards";
import { distanceKm } from "./stories";
import type { Hazard, NewsPlace, NewsStory } from "./types";

const HOUR_MS = 3_600_000;
const ALERT_HAZARDS: Record<AlertType, Hazard[]> = {
  EQ: ["earthquake", "tsunami", "landslide"],
  TC: ["storm", "flood", "rain", "tornado"],
  FL: ["flood", "rain", "landslide", "storm"],
  WF: ["wildfire"],
  VO: ["volcano"],
  DR: ["drought", "heat"],
};
/** How far a record may be from a story's marker, by how exact the marker is. */
const RADIUS_KM: Record<NewsPlace["precision"], number> = { city: 300, region: 500, country: 1500 };

export interface Corroboration {
  quake: Quake | null;
  alert: Alert | null;
}

export function matchQuake(story: NewsStory, quakes: Quake[]): Quake | null {
  if (!story.hazards.includes("earthquake") && !story.hazards.includes("tsunami")) return null;
  const from = new Date(story.first).getTime() - 72 * HOUR_MS;
  const to = new Date(story.last).getTime() + 6 * HOUR_MS;
  const radius = RADIUS_KM[story.place.precision];
  const country = story.place.precision === "country" ? story.place.name : story.place.country;
  const near = quakes.filter((q) => {
    const t = new Date(q.time).getTime();
    if (t < from || t > to) return false;
    return distanceKm(story.place, q) <= radius || (!!country && q.place.endsWith(country));
  });
  return near.sort((a, b) => b.magnitude - a.magnitude)[0] ?? null;
}

export function matchAlert(story: NewsStory, alerts: Alert[]): Alert | null {
  const day = (iso: string) => iso.slice(0, 10);
  const radius = RADIUS_KM[story.place.precision];
  const country = story.place.precision === "country" ? story.place.name : story.place.country;
  const near = alerts.filter((a) =>
    ALERT_HAZARDS[a.type].some((h) => story.hazards.includes(h)) &&
    day(story.last) >= addDays(a.from, -2) && day(story.first) <= addDays(a.to, 2) &&
    (distanceKm(story.place, a) <= radius || (!!country && a.country.includes(country))));
  return near.sort((a, b) => Number(b.level === "Red") - Number(a.level === "Red"))[0] ?? null;
}

function addDays(day: string, n: number): string {
  if (!day) return day;
  return new Date(Date.parse(`${day}T00:00:00Z`) + n * 24 * HOUR_MS).toISOString().slice(0, 10);
}

export function corroborate(story: NewsStory, quakes: Quake[] | null, alerts: Alert[] | null): Corroboration {
  return { quake: matchQuake(story, quakes ?? []), alert: matchAlert(story, alerts ?? []) };
}

/**
 * Where to put the marker: the USGS epicentre when an earthquake story is
 * matched, since news places a quake at the city that felt it.
 */
export function markerPlace(story: NewsStory, c: Corroboration): { lat: number; lon: number } {
  return story.hazard === "earthquake" && c.quake ? { lat: c.quake.lat, lon: c.quake.lon } : story.place;
}

/** Globe markers for stories, at the epicentre when an earthquake story is matched. */
export function newsMarkers(stories: NewsStory[], quakes: Quake[] | null, alerts: Alert[] | null) {
  return stories.map((story) => {
    const at = markerPlace(story, corroborate(story, quakes, alerts));
    return {
      id: story.id,
      lat: at.lat,
      lon: at.lon,
      colour: HAZARD_INFO[story.hazard].colour,
      outlets: new Set(story.articles.map((a) => a.source)).size,
      exact: story.place.precision !== "country",
      label: `${HAZARD_INFO[story.hazard].label} · ${story.place.name}`,
    };
  });
}
