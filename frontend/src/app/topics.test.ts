import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SITE, TOPICS, sitemap, topicForPath, topicPage } from "./topics";

const index = readFileSync(new URL("../../index.html", import.meta.url), "utf8");

describe("topic pages", () => {
  it("finds the topic from the page path, with or without a trailing slash", () => {
    expect(topicForPath("/earthsift/wind-map/")?.slug).toBe("wind-map");
    expect(topicForPath("/wind-map")?.slug).toBe("wind-map");
    expect(topicForPath("/earthsift/")).toBeNull();
  });

  it("keeps titles and descriptions within what search results show, each unique", () => {
    for (const t of TOPICS) {
      expect(t.title.length, t.slug).toBeLessThanOrEqual(60);
      expect(t.description.length, t.slug).toBeLessThanOrEqual(160);
    }
    expect(new Set(TOPICS.map((t) => t.slug)).size).toBe(TOPICS.length);
  });

  it("rewrites the head and loading text of index.html for one topic", () => {
    const t = TOPICS[0]!;
    const page = topicPage(index, t);
    expect(page).toContain(`<title>${t.title}</title>`);
    expect(page).toContain(`<link rel="canonical" href="${SITE}${t.slug}/"`);
    expect(page).toContain(`<h1 style="color: #fff; font-size: 24px">${t.h1}</h1>`);
    expect(page).not.toContain(`href="${SITE}${t.slug}/">`); // no link to itself
    expect(page).toContain(`href="${SITE}${TOPICS[1]!.slug}/"`);
    expect(page).toContain('<script type="module"');
    expect(sitemap("2026-11-03")).toContain(`<loc>${SITE}${t.slug}/</loc>`);
  });
});
