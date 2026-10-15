import { describe, expect, it } from "vitest";

import { classify } from "./classify";
import { buildGazetteer, locate, outlineCentre } from "./locate";
import { mergeStories, previousStories, toLocated } from "./stories";

describe("classify", () => {
  it("finds the hazard a headline is about", () => {
    expect(classify("Magnitude 6.1 earthquake strikes off Japan")).toEqual(["earthquake"]);
    expect(classify("Heavy rain triggers landslides in Nepal, 12 dead")).toEqual(["landslide", "rain"]);
    expect(classify("Flash floods sweep through Valencia")).toEqual(["flood"]);
    expect(classify("Typhoon Ragasa makes landfall in Luzon")).toEqual(["storm"]);
    expect(classify("Storm Amy brings gales to Scotland")).toEqual(["storm"]);
    expect(classify("Wildfires force thousands to flee in Greece")).toEqual(["wildfire"]);
    expect(classify("Lava fountains as Kilauea erupts again")).toEqual(["volcano"]);
  });

  it("ignores figurative uses", () => {
    expect(classify("Opposition wins by a landslide in local elections")).toEqual([]);
    expect(classify("A landslide victory for the ruling party")).toEqual([]);
    expect(classify("Ministry hit by flood of complaints over new rules")).toEqual([]);
    expect(classify("Protests erupted in the capital overnight")).toEqual([]);
    expect(classify("A political earthquake in Berlin")).toEqual([]);
    expect(classify("Carolina Hurricanes beat the Rangers")).toEqual([]);
    expect(classify("UK to send more Storm Shadow missiles")).toEqual([]);
  });

  it("ignores retrospectives", () => {
    expect(classify("Ten years after the Gorkha earthquake, villages rebuild")).toEqual([]);
  });
});

// A tiny gazetteer in GeoNames' own file formats.
const row = (id: number, name: string, lat: number, lon: number, cc: string, admin1: string, pop: number) =>
  [id, name, name, "", lat, lon, "P", "PPL", cc, "", admin1, "", "", "", pop].join("\t");
const CITIES = [
  row(1, "Lahore", 31.55, 74.34, "PK", "04", 6_300_000),
  row(2, "Hyderabad", 25.39, 68.37, "PK", "05", 1_400_000),
  row(3, "Hyderabad", 17.38, 78.46, "IN", "40", 6_800_000),
  row(4, "Swat", 35.2, 72.4, "PK", "03", 20_000),
  row(5, "Mingora", 34.77, 72.36, "PK", "03", 330_000),
].join("\n");
const ADMIN1 = ["PK.04\tPunjab\tPunjab\t1", "PK.05\tSindh\tSindh\t2", "PK.03\tKhyber Pakhtunkhwa\tKhyber Pakhtunkhwa\t3", "IN.40\tTelangana\tTelangana\t4"].join("\n");
const COUNTRY = (cc: string, name: string, id: number) => [cc, "", "", "", name, "", "", "1000000", "", "", "", "", "", "", "", "", id].join("\t");
const COUNTRIES = ["#comment", COUNTRY("PK", "Pakistan", 100), COUNTRY("IN", "India", 101)].join("\n");
const square = (x: number, y: number) => ({ type: "Polygon", coordinates: [[[x - 1, y - 1], [x + 1, y - 1], [x + 1, y + 1], [x - 1, y + 1], [x - 1, y - 1]]] });
const SHAPES = { features: [{ properties: { geoNameId: "100" }, geometry: square(70, 30) }, { properties: { geoNameId: "101" }, geometry: square(79, 22) }] };
const gazetteer = buildGazetteer(CITIES, ADMIN1, COUNTRIES, SHAPES);

describe("locate", () => {
  it("places a headline at the most exact place it names", () => {
    expect(locate("Floods in Lahore after record rain", "", gazetteer)).toMatchObject({ name: "Lahore", precision: "city", cc: "PK" });
    expect(locate("Monsoon floods across Punjab", "", gazetteer)).toMatchObject({ name: "Punjab", precision: "region" });
    expect(locate("Pakistan floods: thousands displaced", "", gazetteer)).toMatchObject({ name: "Pakistan", precision: "country", lat: 30, lon: 70 });
  });

  it("uses the named country to choose between homonyms", () => {
    expect(locate("Hyderabad streets flooded", "Heavy rain across Pakistan's Sindh province", gazetteer)).toMatchObject({ cc: "PK", name: "Hyderabad" });
    expect(locate("Hyderabad streets flooded", "", gazetteer)).toMatchObject({ cc: "IN" });
  });

  it("trusts a small town only when its country is named or the outlet is national", () => {
    expect(locate("Landslide blocks road in Swat", "", gazetteer)).toBeNull();
    expect(locate("Landslide blocks road in Swat, Pakistan", "", gazetteer)).toMatchObject({ name: "Swat" });
    expect(locate("Landslide blocks road in Swat", "", gazetteer, "PK")).toMatchObject({ name: "Swat" });
  });

  it("lets the summary refine the headline but not move it elsewhere", () => {
    expect(locate("Floods in Khyber Pakhtunkhwa", "Rescue teams reached Mingora on Tuesday.", gazetteer)).toMatchObject({ name: "Mingora" });
    expect(locate("Floods in Khyber Pakhtunkhwa", "Aid was flown from Lahore.", gazetteer)).toMatchObject({ name: "Khyber Pakhtunkhwa" });
  });

  it("does not read a storm's name as a place", () => {
    expect(locate("Cyclone Lahore approaches the coast", "", gazetteer)).toBeNull();
  });

  it("finds the centre of a country outline", () => {
    expect(outlineCentre(square(10, 20))).toEqual([10, 20]);
  });
});

describe("stories", () => {
  const now = new Date("2026-10-15T12:00:00Z");
  const item = (title: string, link: string, hoursAgo: number) => ({
    title, link, summary: "", published: new Date(now.getTime() - hoursAgo * 3_600_000).toISOString(),
  });

  it("drops items that are not hazard news, cannot be placed, are stale or have unsafe links", () => {
    expect(toLocated(item("Election results in Lahore", "https://a.example/1", 1), "A", gazetteer, now)).toBeNull();
    expect(toLocated(item("Floods somewhere", "https://a.example/2", 1), "A", gazetteer, now)).toBeNull();
    expect(toLocated(item("Floods in Lahore", "https://a.example/3", 100), "A", gazetteer, now)).toBeNull();
    expect(toLocated(item("Floods in Lahore", "javascript:alert(1)", 1), "A", gazetteer, now)).toBeNull();
    expect(toLocated(item("Floods in <b>Lahore</b>", "https://a.example/4", 1), "A", gazetteer, now)?.article.title).toBe("Floods in Lahore");
  });

  it("groups headlines about the same hazard nearby and keeps unrelated ones apart", () => {
    const located = [
      toLocated(item("Floods in Lahore", "https://a.example/1", 5), "A", gazetteer, now)!,
      toLocated(item("Heavy rain lashes Punjab", "https://b.example/1", 3), "B", gazetteer, now)!,
      toLocated(item("Earthquake felt in Lahore", "https://c.example/1", 2), "C", gazetteer, now)!,
      toLocated(item("Hyderabad flooding worsens, India", "https://d.example/1", 1), "D", gazetteer, now)!,
    ];
    const stories = mergeStories([], located, now);
    expect(stories).toHaveLength(3);
    const wet = stories.find((s) => s.articles.length === 2)!;
    expect(wet.hazards).toEqual(["flood", "rain"]);
    expect(wet.place.name).toBe("Lahore");
    expect(wet.articles[0]!.source).toBe("B");
  });

  it("adds to earlier stories without duplicating articles, and forgets stale ones", () => {
    const first = mergeStories([], [toLocated(item("Floods in Lahore", "https://a.example/1", 5), "A", gazetteer, now)!], now);
    const again = mergeStories(first, [toLocated(item("Floods in Lahore", "https://a.example/1", 5), "A", gazetteer, now)!], now);
    expect(again[0]!.articles).toHaveLength(1);
    const later = new Date(now.getTime() + 80 * 3_600_000);
    expect(mergeStories(again, [], later)).toHaveLength(0);
  });

  it("reads a previous file defensively", () => {
    expect(previousStories(null)).toEqual([]);
    expect(previousStories({ stories: [{ id: 1 }] })).toEqual([]);
  });
});
