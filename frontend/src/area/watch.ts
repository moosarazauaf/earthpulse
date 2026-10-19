/**
 * Hazards near saved places: news stories, earthquakes and alerts that are
 * close enough to matter, checked in the browser each time the app opens.
 * Nothing is sent anywhere; the places never leave this browser.
 */
import { useEffect, useMemo, useRef } from "react";

import { useStore } from "../app/store";
import type { AoiGeometry } from "../app/types";
import type { Alert, Quake } from "../hazards/sources";
import { HAZARD_INFO } from "../news/hazards";
import { distanceKm } from "../news/stories";
import type { NewsStory } from "../news/types";
import type { SavedPlace } from "./saved";

/** News is placed to a town at best; earthquakes and alerts affect wide areas. */
export const WATCH_KM = { news: 150, quake: 300, alert: 300 } as const;
const NEWS_HOURS = 72;

export type NearbyItem =
  | { kind: "news"; km: number; title: string; label: string; story: NewsStory }
  | { kind: "quake"; km: number; title: string; label: string; url: string }
  | { kind: "alert"; km: number; title: string; label: string; alert: Alert };

/** The middle of a place's bounding box, close enough for distances of tens of km. */
export function centreOf(geometry: AoiGeometry): { lat: number; lon: number } {
  const points = geometry.type === "Polygon" ? geometry.coordinates.flat() : geometry.coordinates.flat(2);
  const lons = points.map((p) => p[0]!), lats = points.map((p) => p[1]!);
  return { lon: (Math.min(...lons) + Math.max(...lons)) / 2, lat: (Math.min(...lats) + Math.max(...lats)) / 2 };
}

export function nearbyHazards(
  place: SavedPlace, news: NewsStory[], quakes: Quake[], alerts: Alert[], now = Date.now(),
): NearbyItem[] {
  const here = centreOf(place.geometry);
  const items: NearbyItem[] = [];
  for (const story of news) {
    if (story.place.precision === "country" || now - new Date(story.last).getTime() > NEWS_HOURS * 3_600_000) continue;
    const km = distanceKm(here, story.place);
    if (km <= WATCH_KM.news) items.push({ kind: "news", km, title: story.articles[0]?.title ?? "", label: HAZARD_INFO[story.hazard].label, story });
  }
  for (const q of quakes) {
    const km = distanceKm(here, q);
    if (km <= WATCH_KM.quake) items.push({ kind: "quake", km, title: `M${q.magnitude.toFixed(1)}, ${q.place}`, label: "Earthquake", url: q.url });
  }
  for (const a of alerts) {
    const km = distanceKm(here, a);
    if (km <= WATCH_KM.alert) items.push({ kind: "alert", km, title: a.name, label: `GDACS ${a.level.toLowerCase()} alert`, alert: a });
  }
  return items.sort((x, y) => x.km - y.km);
}

/** Every saved place with something nearby, nearest first within each place. */
export function watchPlaces(places: SavedPlace[], news: NewsStory[], quakes: Quake[], alerts: Alert[], now = Date.now()) {
  return places
    .map((place) => ({ place, items: nearbyHazards(place, news, quakes, alerts, now) }))
    .filter((w) => w.items.length > 0);
}

/** Saved places with hazards nearby, from whatever feeds are loaded. */
export function useWatchedPlaces() {
  const places = useStore((s) => s.places);
  const news = useStore((s) => s.news);
  const quakes = useStore((s) => s.quakes);
  const alerts = useStore((s) => s.alerts);
  return useMemo(() => watchPlaces(places, news?.stories ?? [], quakes ?? [], alerts ?? []), [places, news, quakes, alerts]);
}

/**
 * With saved places, read the three feeds once at start and say, once per
 * visit, if anything is near one of them. Without saved places nothing loads.
 */
export function useWatchOnStart() {
  const hasPlaces = useStore((s) => s.places.length > 0);
  const watched = useWatchedPlaces();
  const told = useRef(false);
  useEffect(() => {
    if (!hasPlaces) return;
    const s = useStore.getState();
    if (s.news === null) void s.loadNews();
    if (s.quakes === null) void s.loadQuakes();
    if (s.alerts === null) void s.loadAlerts();
  }, [hasPlaces]);
  useEffect(() => {
    if (told.current || watched.length === 0) return;
    told.current = true;
    const first = watched[0]!;
    const more = watched.length > 1 ? ` and ${watched.length - 1} more of your places` : "";
    useStore.getState().set({ notice: `${first.items[0]!.label} ${Math.round(first.items[0]!.km)} km from ${first.place.label}${more}. Open My places (M) to see it.` });
  }, [watched]);
}
