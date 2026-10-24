import { describe, expect, it } from "vitest";

import { squareAround } from "../app/logic";
import { interpret, planFor } from "./interpret";

const NOW = new Date("2026-10-24T09:00:00Z");
const aoi = squareAround(70.94, 30.96, 10);
const plan = (text: string) => planFor(interpret(text)!, aoi, "Layyah", 30.96, 700_000, NOW);

describe("reading a request", () => {
  it.each([
    ["floods in Layyah in August 2022", "flood", "Layyah", [2022], [8, 8]],
    ["How much has Lake Urmia shrunk since 2000?", "water", "Lake Urmia", [2000], null],
    ["show me tree cover loss around Islamabad in 2020", "trees", "Islamabad", [2020], null],
    ["Is Karachi growing?", "urban", "Karachi", [], null],
    ["urban growth of Lahore, Pakistan from 2017 to 2023", "urban", "Lahore, Pakistan", [2017, 2023], null],
    ["wildfire near Athens July to August 2023", "burn", "Athens", [2023], [7, 8]],
    ["how hot does Jacobabad get", "heat", "Jacobabad", [], null],
    ["NDBI change in Dubai 2000 vs 2024", "vegetation", "Dubai", [2000, 2024], null],
    ["Mangla reservoir water 1990 2000 2025", "water", "Mangla reservoir", [1990, 2000, 2025], null],
  ])("%s", (text, kind, place, years, months) => {
    const ask = interpret(text)!;
    expect(ask.kind).toBe(kind);
    expect(ask.place).toBe(place);
    expect(ask.years).toEqual(years);
    expect(ask.months).toEqual(months);
  });

  it("is a plain place search when no analysis is named", () => {
    expect(interpret("Lahore")).toBeNull();
    expect(interpret("Layyah, Pakistan")).toBeNull();
    expect(interpret("Lake Urmia")).toBeNull();
    expect(interpret("Black Forest")).toBeNull();
    expect(interpret("Lake Urmia 2000 2024")!.kind).toBe("water");
  });

  it("reads coordinates, an area size and 'since'", () => {
    const ask = interpret("floods at 30.96, 70.94 within 25 km since 2022")!;
    expect(ask.point).toEqual({ lat: 30.96, lon: 70.94 });
    expect(ask.place).toBeNull();
    expect(ask.sizeKm).toBe(25);
    expect(ask.since).toBe(true);
    expect(interpret("NDBI change in Dubai 2000 vs 2024")!.index).toBe("ndbi");
  });
});

describe("planning the analysis", () => {
  it("dates a past flood from the month named", () => {
    const p = plan("floods in Layyah in August 2022");
    if ("error" in p) throw new Error(p.error);
    expect(p.run.kind).toBe("flood");
    expect(p.run.request.flood).toEqual({ start: "2022-08-01", end: "2022-08-31" });
    expect(p.run.request.before).toEqual({ start: "2022-05-18", end: "2022-07-17" });
  });

  it("says when a request cannot be met instead of guessing", () => {
    expect(plan("floods in Layyah 2010")).toHaveProperty("error");
    expect(plan("fire in Layyah 2023")).toHaveProperty("error");
    expect(plan("floods in Layyah December 2026")).toHaveProperty("error");
  });

  it("writes every assumption down", () => {
    const p = plan("floods in Layyah 2022");
    if ("error" in p) throw new Error(p.error);
    expect(p.run.request.flood).toEqual({ start: "2022-08-01", end: "2022-09-30" });
    expect(p.notes.join(" ")).toContain("No month given");
  });

  it("uses the Landsat canopy record for tree loss before 2017", () => {
    const p = plan("deforestation in Layyah since 1990");
    if ("error" in p) throw new Error(p.error);
    expect(p.run.kind).toBe("disturbance");
    expect((p.run.request.years as number[])[0]).toBe(1990);
    expect((p.run.request.years as number[]).at(-1)).toBe(2025);
  });

  it("keeps land-cover years inside the maps' range", () => {
    const p = plan("urban growth in Layyah 2010 to 2025");
    if ("error" in p) throw new Error(p.error);
    expect([p.run.request.firstYear, p.run.request.lastYear]).toEqual([2017, 2023]);
    expect(p.notes.join(" ")).toContain("moved inside that range");
  });

  it("compares the two years named, in the months named", () => {
    const p = plan("vegetation change in Layyah March 2000 vs 2024");
    if ("error" in p) throw new Error(p.error);
    expect(p.run.request.before).toEqual({ start: "2000-03-01", end: "2000-03-31" });
    expect(p.run.request.after).toEqual({ start: "2024-03-01", end: "2024-03-31" });
  });
});
