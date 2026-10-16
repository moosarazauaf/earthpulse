import { describe, expect, it } from "vitest";

import { squareAround } from "../app/logic";
import { projectAoi } from "../engine/geo";
import { quickActions, spread } from "./actions";
import { describeNormals, monthlyNormals } from "./climate";

describe("Analyse here", () => {
  it("makes a square of the requested size on the ground, at any latitude", () => {
    for (const lat of [0, 31.5, 60]) {
      const km2 = projectAoi(squareAround(74, lat, 10)).areaM2 / 1e6;
      expect(km2).toBeGreaterThan(95);
      expect(km2).toBeLessThan(105);
    }
  });

  it("proposes analyses with windows that end today and never in the future", () => {
    const aoi = squareAround(74, 31.5, 5);
    const actions = quickActions(aoi, "Test", new Date("2026-10-16T08:00:00Z"));
    const flood = actions.find((a) => a.action.id === "flood")!.action;
    expect(flood.kind === "flood" && flood.request.flood.end).toBe("2026-10-16");
    const burn = actions.find((a) => a.action.id === "burn")!.action;
    expect(burn.kind === "fire" && burn.request.before.end < burn.request.after.start).toBe(true);
    const water = actions.find((a) => a.action.id === "water")!.action;
    expect(water.kind === "water" && water.request.years.at(-1)).toBe(2025);
    expect(actions).toHaveLength(8);
    const heat = actions.find((a) => a.action.id === "heat")!.action;
    expect(heat.kind === "heat" && [heat.request.startMonth, heat.request.endMonth]).toEqual([5, 8]);
  });

  it("spreads years evenly and keeps both ends", () => {
    expect(spread(1990, 2025, 8)).toEqual([1990, 1995, 2000, 2005, 2010, 2015, 2020, 2025]);
    expect(spread(2020, 2020, 5)).toEqual([2020]);
  });
});

describe("climate normals", () => {
  it("averages monthly totals over the years and names the wettest month", () => {
    const time: string[] = [], rain: number[] = [], tmax: number[] = [];
    for (const y of [1991, 1992]) for (let m = 1; m <= 12; m++) for (let d = 1; d <= 28; d++) {
      time.push(`${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
      rain.push(m === 8 ? 10 : 1);
      tmax.push(20 + m);
    }
    const months = monthlyNormals({ time, rain, tmax });
    expect(months[7]!.rain).toBe(280);
    expect(months[0]!.rain).toBe(28);
    expect(describeNormals(months)).toContain("August, the wettest month");
    expect(describeNormals(months)).toContain("21 °C in January and 32 °C in December");
  });
});
