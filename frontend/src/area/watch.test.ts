import { describe, expect, it } from "vitest";

import { rectangleAoi } from "../app/logic";
import type { Alert, Quake } from "../hazards/sources";
import type { NewsStory } from "../news/types";
import { centreOf, watchPlaces } from "./watch";

const now = Date.parse("2026-10-19T12:00:00Z");
const place = { id: "a", label: "Lahore", geometry: rectangleAoi(74.2, 31.4, 74.5, 31.7), savedAt: "" };
const story = (lat: number, lon: number, hoursAgo: number, precision: "city" | "country" = "city"): NewsStory => ({
  id: `s${lat}`, hazard: "flood", hazards: ["flood"],
  place: { name: "X", country: "Pakistan", cc: "PK", lat, lon, precision },
  first: new Date(now - hoursAgo * 3_600_000).toISOString(), last: new Date(now - hoursAgo * 3_600_000).toISOString(),
  articles: [{ title: "Floods", url: "https://a.example", source: "A", published: "" }],
});

describe("watching saved places", () => {
  it("finds the middle of a place", () => {
    const c = centreOf(place.geometry);
    expect(c.lon).toBeCloseTo(74.35);
    expect(c.lat).toBeCloseTo(31.55);
  });

  it("lists nearby news, quakes and alerts, nearest first, and ignores far, stale or country-only items", () => {
    const quakes = [{ id: "q", magnitude: 5.2, place: "near Lahore", time: "", lat: 32.5, lon: 74.3, depthKm: 10, url: "https://earthquake.usgs.gov/x", pager: null, tsunami: false }] as Quake[];
    const alerts = [{ id: "a", type: "FL", level: "Orange", name: "Flood in Punjab", country: "Pakistan", lat: 31.6, lon: 74.4, from: "", to: "", ongoing: true, severity: "", source: "", reportUrl: "" }] as Alert[];
    const news = [story(31.6, 74.3, 5), story(25, 67, 5), story(31.5, 74.3, 100), story(31.5, 74.3, 5, "country")];
    const watched = watchPlaces([place], news, quakes, alerts, now);
    expect(watched).toHaveLength(1);
    const kinds = watched[0]!.items.map((i) => i.kind);
    expect(kinds).toEqual(["news", "alert", "quake"]);
  });

  it("returns nothing when nothing is near", () => {
    expect(watchPlaces([place], [story(25, 67, 1)], [], [], now)).toEqual([]);
  });
});
