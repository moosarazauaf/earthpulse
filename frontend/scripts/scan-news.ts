/**
 * Scan news feeds for natural-hazard stories and write public/data/news.json.
 *
 * Run hourly by .github/workflows/pages.yml before the site is built:
 *
 *   GAZETTEER_DIR=/path/to/geonames npx tsx scripts/scan-news.ts
 *
 * GAZETTEER_DIR holds GeoNames' cities15000.txt, admin1CodesASCII.txt,
 * countryInfo.txt and shapes_simplified_low.json. NEWS_PREVIOUS_URL, when set,
 * is the news.json currently published; its stories are carried forward so a
 * story keeps the headlines that have since dropped out of the feeds.
 */
import { execFile } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { XMLParser } from "fast-xml-parser";

import { FEEDS } from "../src/news/feeds";
import { buildGazetteer } from "../src/news/locate";
import { type FeedItem, type Located, mergeStories, previousStories, toLocated } from "../src/news/stories";
import type { FeedStatus, NewsFile } from "../src/news/types";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../public/data/news.json");
const WINDOW_HOURS = 72;
const TIMEOUT_MS = 20_000;
// Some sites refuse requests whose user agent does not look like a browser.
const USER_AGENT = "Mozilla/5.0 (compatible; EarthPulse hazard news scanner; +https://github.com/moosarazauaf/earthpulse)";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", htmlEntities: true, textNodeName: "#text" });

function text(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) return text(value[0]);
  if (typeof value === "object") {
    const v = value as Record<string, unknown>;
    return text(v["#text"] ?? v["@href"] ?? "");
  }
  return "";
}

/** RSS 2.0, RSS 1.0 (RDF) and Atom items, reduced to the four fields used. */
export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;
  const rawItems = doc.rss?.channel?.item ?? doc["rdf:RDF"]?.item ?? doc.feed?.entry ?? [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];
  return items.map((it: Record<string, unknown>) => {
    const links = Array.isArray(it.link) ? it.link : [it.link];
    const link = links.map(text).find((l) => /^https?:/.test(l)) ?? "";
    return {
      title: text(it.title),
      link,
      summary: text(it.description ?? it.summary ?? it.content),
      published: text(it.pubDate ?? it["dc:date"] ?? it.published ?? it.updated) || null,
    };
  });
}

async function get(url: string): Promise<Response> {
  return fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
}

const run = promisify(execFile);

/**
 * A feed's text. Some sites turn away Node's HTTP client by its connection
 * fingerprint but serve curl, so curl is the fallback.
 */
async function feedText(url: string): Promise<string> {
  try {
    const response = await get(url);
    if (response.ok) return await response.text();
  } catch {
    // fall through to curl
  }
  const { stdout } = await run("curl", ["-sSL", "--fail", "--max-time", String(TIMEOUT_MS / 1000), "-A", USER_AGENT, url], { maxBuffer: 20e6 });
  return stdout;
}

async function main() {
  const dir = process.env.GAZETTEER_DIR;
  if (!dir) throw new Error("Set GAZETTEER_DIR to the folder with the GeoNames files.");
  const read = (name: string) => readFileSync(join(dir, name), "utf8");
  const gazetteer = buildGazetteer(read("cities15000.txt"), read("admin1CodesASCII.txt"), read("countryInfo.txt"), JSON.parse(read("shapes_simplified_low.json")));
  const now = new Date();

  let previous: NewsFile["stories"] = [];
  if (process.env.NEWS_PREVIOUS_URL) {
    try {
      const response = await get(process.env.NEWS_PREVIOUS_URL);
      if (response.ok) previous = previousStories(await response.json());
    } catch {
      console.warn("No previous news.json; starting fresh.");
    }
  }

  const status: FeedStatus[] = [];
  const located: Located[] = [];
  const results = await Promise.allSettled(FEEDS.map(async (feed) => {
    return parseFeed(await feedText(feed.url));
  }));
  results.forEach((result, i) => {
    const feed = FEEDS[i]!;
    const items = result.status === "fulfilled" ? result.value : [];
    if (result.status === "rejected") console.warn(`${feed.name} (${feed.url}): ${String(result.reason)}`);
    let kept = 0;
    for (const item of items) {
      const hit = toLocated(item, feed.name, gazetteer, now, feed.home);
      if (hit) { located.push(hit); kept++; }
    }
    const existing = status.find((s) => s.name === feed.name);
    if (existing) { existing.ok ||= result.status === "fulfilled"; existing.items += kept; }
    else status.push({ name: feed.name, homepage: feed.homepage, ok: result.status === "fulfilled", items: kept });
  });

  const stories = mergeStories(previous, located, now);
  const file: NewsFile = { version: 1, generated: now.toISOString(), windowHours: WINDOW_HOURS, feeds: status, stories };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(file));
  console.log(`${located.length} hazard headlines placed; ${stories.length} stories (${previous.length} carried forward).`);
  for (const s of stories.slice(0, 40)) console.log(`  ${s.hazard.padEnd(10)} ${s.place.precision.padEnd(7)} ${`${s.place.name}, ${s.place.country}`.padEnd(34)} ${s.articles[0]!.title}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
