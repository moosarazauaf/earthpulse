import { describe, expect, it } from "vitest";

import type { AoiGeometry } from "../app/types";
import type { RadarScene } from "../engine/flood";
import { checkScenes } from "./s1checks";

const aoi: AoiGeometry = { type: "Polygon", coordinates: [[[70, 30], [71, 30], [71, 31], [70, 31], [70, 30]]] };
const whole = [[[69, 29], [72, 29], [72, 32], [69, 32], [69, 29]]];
const westHalf = [[[69, 29], [70.3, 29], [70.3, 32], [69, 32], [69, 29]]];
const scene = (date: string, orbit: number, orbitState = "descending", footprint = whole): RadarScene =>
  ({ id: `${orbit}-${date}`, datetime: `${date}T01:00:00Z`, platform: "sentinel-1a", orbit, orbitState, epsg: 32643, footprint, href: "" });
const before = { start: "2022-06-01", end: "2022-07-15" }, flood = { start: "2022-08-25", end: "2022-09-05" };
const levels = (r: ReturnType<typeof checkScenes>) => r.findings.map((f) => f.level);

describe("Sentinel-1 plan checks", () => {
  it("passes a clean plan: one orbit, two passes before, one during", () => {
    const r = checkScenes([
      { name: "before", period: before, scenes: [scene("2022-06-20", 5), scene("2022-07-02", 5)] },
      { name: "flood", period: flood, scenes: [scene("2022-08-31", 5)] },
    ], aoi);
    expect(r.orbit).toBe(5);
    expect(levels(r)).toEqual(["ok", "ok", "ok"]);
  });

  it("flags mixed orbits and directions, and uses the one that covers the area", () => {
    const r = checkScenes([
      { name: "before", period: before, scenes: [scene("2022-06-20", 5), scene("2022-07-02", 5), scene("2022-07-05", 107, "ascending", westHalf)] },
      { name: "flood", period: flood, scenes: [scene("2022-08-31", 5), scene("2022-08-28", 107, "ascending", westHalf)] },
    ], aoi);
    expect(r.orbit).toBe(5);
    const mixed = r.findings[0]!;
    expect(mixed.level).toBe("warn");
    expect(mixed.text).toMatch(/^Mixed orbits: .*2 relative orbits, ascending and descending/);
    expect(mixed.text).toContain("Only orbit 5 is used");
  });

  it("is an error when no orbit covers the area in every window", () => {
    const r = checkScenes([
      { name: "before", period: before, scenes: [scene("2022-07-02", 5)] },
      { name: "flood", period: flood, scenes: [scene("2022-08-28", 107, "ascending")] },
    ], aoi);
    expect(r.orbit).toBeNull();
    expect(r.findings[0]!.level).toBe("error");
  });

  it("flags compositing in the flood window, a long window and a single baseline pass", () => {
    const r = checkScenes([
      { name: "before", period: { start: "2022-05-01", end: "2022-05-20" }, scenes: [scene("2022-05-15", 5)] },
      { name: "flood", period: { start: "2022-08-01", end: "2022-09-20" }, scenes: [scene("2022-08-19", 5), scene("2022-08-31", 5), scene("2022-09-12", 5)] },
    ], aoi);
    const texts = r.findings.map((f) => f.text).join("\n");
    expect(texts).toMatch(/Only one pass before the flood \(2022-05-15\)/);
    expect(texts).toMatch(/Compositing: the flood window combines 2 passes \(the latest 2 of 3\), 2022-08-31 and 2022-09-12/);
    expect(texts).toMatch(/The flood window is 50 days long/);
    expect(texts).toMatch(/96 days between/);
  });

  it("says which window is empty", () => {
    const r = checkScenes([{ name: "before", period: before, scenes: [] }, { name: "flood", period: flood, scenes: [scene("2022-08-31", 5)] }], aoi);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0]!.text).toMatch(/before window \(2022-06-01 to 2022-07-15\)/);
  });
});
