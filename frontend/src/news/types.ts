/**
 * Natural-hazard stories found in news feeds.
 *
 * The scanner (scripts/scan-news.ts) runs every hour on GitHub Actions and
 * writes public/data/news.json; the app only reads that file. A story is a
 * group of headlines about the same kind of hazard near the same place.
 */

export type Hazard =
  | "earthquake"
  | "tsunami"
  | "volcano"
  | "landslide"
  | "flood"
  | "storm"
  | "tornado"
  | "wildfire"
  | "rain"
  | "heat"
  | "drought"
  | "winter"
  | "dust";

export interface NewsArticle {
  title: string;
  url: string;
  /** Outlet name, as listed in FEEDS. */
  source: string;
  /** ISO time the outlet gives for the item. */
  published: string;
  /** Where this headline alone was placed. */
  place?: NewsPlace;
}

export interface NewsPlace {
  name: string;
  /** Country name, empty when the place is itself a country. */
  country: string;
  /** ISO 3166 alpha-2. */
  cc: string;
  lat: number;
  lon: number;
  /** How exact the marker is: a town, a province or state, or only the country. */
  precision: "city" | "region" | "country";
}

export interface NewsStory {
  id: string;
  /** The hazard the story is filed under. */
  hazard: Hazard;
  /** Every hazard named in its headlines, e.g. rain and landslide. */
  hazards: Hazard[];
  place: NewsPlace;
  first: string;
  last: string;
  /** Newest first. */
  articles: NewsArticle[];
}

export interface FeedStatus {
  name: string;
  homepage: string;
  ok: boolean;
  items: number;
}

export interface NewsFile {
  version: 1;
  generated: string;
  /** Stories whose newest headline is older than this are dropped. */
  windowHours: number;
  feeds: FeedStatus[];
  stories: NewsStory[];
}
