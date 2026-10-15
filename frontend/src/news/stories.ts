/**
 * Turning feed items into stories: keep the hazard items, place them, and
 * group headlines about the same hazard near the same place.
 */
import { RULES, classify } from "./classify";
import { type Gazetteer, locate } from "./locate";
import type { Hazard, NewsArticle, NewsFile, NewsPlace, NewsStory } from "./types";

export interface FeedItem {
  title: string;
  link: string;
  summary: string;
  published: string | null;
}

export interface Located {
  article: NewsArticle;
  hazards: Hazard[];
  place: NewsPlace;
}

const HOUR_MS = 3_600_000;
/** Headlines further apart than this are separate stories. */
const SAME_STORY_KM = 400;
const SAME_STORY_HOURS = 72;
const MAX_ARTICLES = 12;
const MAX_STORIES = 400;
/** Hazards that are often reported as one event: heavy rain floods a valley and sets off landslides. */
const WET: Hazard[] = ["flood", "rain", "landslide", "storm", "tornado"];
const PRIORITY: Hazard[] = [...RULES.map((r) => r.hazard)];

export function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Strip markup and collapse whitespace; feeds put HTML in their summaries. */
export function plainText(html: string): string {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

/** Only web links; anything else in a feed is dropped. */
function safeUrl(link: string): string | null {
  try {
    const url = new URL(link.trim());
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

/** Classify and place one item; null when it is not hazard news or cannot be placed. */
export function toLocated(item: FeedItem, source: string, gazetteer: Gazetteer, now: Date, home?: string): Located | null {
  const title = plainText(item.title);
  const summary = plainText(item.summary).slice(0, 600);
  const url = safeUrl(item.link);
  // Some feeds give no date; an item seen for the first time is then dated to the scan.
  const time = item.published ? new Date(item.published) : now;
  if (!title || !url || Number.isNaN(time.getTime())) return null;
  if (now.getTime() - time.getTime() > SAME_STORY_HOURS * HOUR_MS || time.getTime() - now.getTime() > HOUR_MS) return null;
  // The headline decides whether this is hazard news; the summary only helps place it.
  const hazards = classify(title);
  if (hazards.length === 0) return null;
  // A national outlet's hazard story with no recognisable place is most likely about its own country.
  const place = locate(title, summary, gazetteer, home) ?? (home ? countryPlace(gazetteer, home) : null);
  if (!place) return null;
  return { article: { title, url, source, published: time.toISOString(), place }, hazards, place };
}

function countryPlace(gazetteer: Gazetteer, cc: string): NewsPlace | null {
  const c = gazetteer.countries.get(cc);
  return c ? { name: c.name, country: "", cc, lat: Math.round(c.lat * 1000) / 1000, lon: Math.round(c.lon * 1000) / 1000, precision: "country" } : null;
}

function compatible(a: Hazard[], b: Hazard[]): boolean {
  return a.some((h) => b.includes(h)) || (a.some((h) => WET.includes(h)) && b.some((h) => WET.includes(h)));
}

function near(a: NewsPlace, b: NewsPlace): boolean {
  // A country-level marker joins any story in the same country.
  if (a.precision === "country" || b.precision === "country") return a.cc === b.cc;
  return distanceKm(a, b) <= SAME_STORY_KM;
}

const RANK = { city: 2, region: 1, country: 0 } as const;

/**
 * The place most of a story's headlines point to; between equally common
 * places, the more exact one.
 */
export function votePlace(articles: NewsArticle[], current: NewsPlace): NewsPlace {
  const votes = new Map<string, { place: NewsPlace; n: number }>();
  for (const a of articles) {
    if (!a.place) continue;
    const key = `${a.place.cc}|${a.place.name}`;
    const v = votes.get(key) ?? { place: a.place, n: 0 };
    v.n++;
    votes.set(key, v);
  }
  let best: { place: NewsPlace; score: number } | null = null;
  for (const { place, n } of votes.values()) {
    const score = n * 10 + RANK[place.precision] * 3;
    if (!best || score > best.score) best = { place, score };
  }
  return best?.place ?? current;
}

function storyId(hazard: Hazard, place: NewsPlace, first: string): string {
  const text = `${hazard}|${place.cc}|${Math.round(place.lat)}|${Math.round(place.lon)}|${first.slice(0, 10)}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return `${hazard}-${(h >>> 0).toString(36)}`;
}

/**
 * Group located items into stories, adding to the stories already known.
 * Articles are matched by URL, so re-reading a feed adds nothing twice.
 */
export function mergeStories(previous: NewsStory[], items: Located[], now: Date): NewsStory[] {
  const cutoff = now.getTime() - SAME_STORY_HOURS * HOUR_MS;
  const stories = previous
    .filter((s) => new Date(s.last).getTime() >= cutoff)
    .map((s) => ({ ...s, articles: [...s.articles], hazards: [...s.hazards] }));
  const seen = new Set(stories.flatMap((s) => s.articles.map((a) => a.url)));

  for (const item of [...items].sort((a, b) => a.article.published.localeCompare(b.article.published))) {
    if (seen.has(item.article.url)) continue;
    seen.add(item.article.url);
    const t = new Date(item.article.published).getTime();
    const story = stories.find((s) =>
      compatible(s.hazards, item.hazards) && near(s.place, item.place) &&
      t - new Date(s.last).getTime() <= SAME_STORY_HOURS * HOUR_MS);
    if (!story) {
      stories.push({
        id: storyId(item.hazards[0]!, item.place, item.article.published),
        hazard: item.hazards[0]!,
        hazards: item.hazards,
        place: item.place,
        first: item.article.published,
        last: item.article.published,
        articles: [item.article],
      });
      continue;
    }
    story.articles.unshift(item.article);
    story.articles.sort((a, b) => b.published.localeCompare(a.published));
    story.articles = story.articles.slice(0, MAX_ARTICLES);
    for (const h of item.hazards) if (!story.hazards.includes(h)) story.hazards.push(h);
    story.hazards.sort((x, y) => PRIORITY.indexOf(x) - PRIORITY.indexOf(y));
    story.hazard = story.hazards[0]!;
    if (item.article.published > story.last) story.last = item.article.published;
    if (item.article.published < story.first) story.first = item.article.published;
    story.place = votePlace(story.articles, story.place);
  }
  return stories
    .sort((a, b) => b.last.localeCompare(a.last))
    .slice(0, MAX_STORIES);
}

/** Read a previous news.json defensively: it came over the network. */
export function previousStories(body: unknown): NewsStory[] {
  const stories = (body as Partial<NewsFile> | null)?.stories;
  if (!Array.isArray(stories)) return [];
  return stories.filter((s): s is NewsStory =>
    !!s && typeof s.id === "string" && typeof s.hazard === "string" && Array.isArray(s.hazards) &&
    Array.isArray(s.articles) && typeof s.last === "string" && typeof s.first === "string" &&
    !!s.place && Number.isFinite(s.place.lat) && Number.isFinite(s.place.lon));
}
