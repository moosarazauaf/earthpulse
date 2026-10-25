import { describe, expect, it } from "vitest";

import { squareAround } from "../app/logic";
import { projectAoi } from "../engine/geo";
import { quickActions, spread } from "./actions";
import { aqiBand, dailyMeans, parseCityAir } from "./air";
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

describe("landslide conditions", () => {
  it("needs both an unusually wet week and steep ground", async () => {
    const { landslideConditions } = await import("./climate");
    const week = (value: number, below: number) => ({ days: 7, value, baseline: Array.from({ length: 30 }, () => 5), mean: 5, below, above: 30 - below });
    expect(landslideConditions(week(120, 29), 0.3)).toBe(true);
    expect(landslideConditions(week(120, 29), 0.05)).toBe(false);
    expect(landslideConditions(week(120, 20), 0.3)).toBe(false);
    expect(landslideConditions(week(10, 30), 0.3)).toBe(false);
    expect(landslideConditions(undefined, 0.3)).toBe(false);
  });
});

describe("air quality", () => {
  it("puts an AQI in its EPA band, upper bounds inclusive", () => {
    expect(aqiBand(50).label).toBe("Good");
    expect(aqiBand(51).label).toBe("Moderate");
    expect(aqiBand(179).label).toBe("Unhealthy");
    expect(aqiBand(500).label).toBe("Hazardous");
  });

  it("averages whole days and leaves out days with gaps", () => {
    const times = [...Array(24)].map((_, h) => `2026-10-20T${String(h).padStart(2, "0")}:00`).concat(["2026-10-21T00:00"]);
    const values: (number | null)[] = [...Array(24)].map((_, h): number | null => (h === 3 ? null : 20)).concat([99]);
    expect(dailyMeans(times, values)).toEqual([{ date: "2026-10-20", pm25: 20 }]);
  });
});

describe("air quality at cities", () => {
  it("pairs each city with its answer and leaves out cities with no value", () => {
    const now = { time: "2026-10-25T04:00", us_aqi: 159, pm2_5: 53.7, pm10: 0, nitrogen_dioxide: 0, ozone: 0 };
    const spots = parseCityAir(
      [["Lahore", "PK", 31.55, 74.34], ["Nowhere", "XX", 0, 0]],
      [{ current: now }, { current: { ...now, us_aqi: null as unknown as number } }],
    );
    expect(spots).toEqual([{ name: "Lahore", country: "PK", lat: 31.55, lon: 74.34, usAqi: 159, pm25: 53.7, time: "2026-10-25T04:00" }]);
  });
});
