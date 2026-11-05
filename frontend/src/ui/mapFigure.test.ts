import { describe, expect, it } from "vitest";

import { degreeLabel, edgeTicks, niceScale } from "./mapFigure";

describe("map figure scale bar", () => {
  it("picks the longest 1, 2 or 5 × 10ⁿ length that fits", () => {
    expect(niceScale(10, 300)).toEqual({ metres: 2000, px: 200, label: "2 km" });
    expect(niceScale(1, 120)).toMatchObject({ metres: 100, label: "100 m" });
    expect(niceScale(2500, 260)).toMatchObject({ metres: 500_000, label: "500 km" });
  });
});

describe("map figure coordinate ticks", () => {
  it("places round degree values where they cross the edge", () => {
    // Longitude from 70.8 to 71.3 along the edge, evenly: 0.1° ticks at 70.9 ... 71.2.
    const lons = Array.from({ length: 11 }, (_, i) => 70.8 + i * 0.05);
    const ticks = edgeTicks(lons);
    expect(ticks.map((t) => t.value)).toEqual([70.9, 71, 71.1, 71.2]);
    expect(ticks[0]!.at).toBeCloseTo(0.2, 6);
    expect(degreeLabel(71, ticks[0]!.step, "lon")).toBe("71.0°E");
    expect(degreeLabel(-30.25, 0.05, "lat")).toBe("30.25°S");
    // A 0.25° step needs two decimals: 70.75 must not print as 70.8.
    expect(degreeLabel(70.75, 0.25, "lon")).toBe("70.75°E");
    expect(degreeLabel(71, 1, "lon")).toBe("71°E");
  });

  it("leaves an edge bare when part of it is off the globe, or across the date line", () => {
    expect(edgeTicks([70, 71, null, 73])).toEqual([]);
    expect(edgeTicks([179.5, 179.9, -179.9, -179.5]).map((t) => t.value)).not.toContain(0);
  });
});
