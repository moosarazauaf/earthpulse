import { describe, expect, it } from "vitest";

import { type OutlookDay, cleanestWindow, cloudAt, list, parseAirHours, parseOutlook, warnings, waterBalance } from "./outlook";

const day = (date: string, o: Partial<OutlookDay> = {}): OutlookDay => ({ date, rain: 0, tmax: 25, tmin: 12, feels: 25, gust: 20, et0: 3, aqi: 50, ...o });

describe("7-day outlook", () => {
  it("pairs daily weather with the worst hour of air, skipping days with gaps", () => {
    const weather = { daily: {
      time: ["2026-11-04", "2026-11-05"], precipitation_sum: [1, null], temperature_2m_max: [30, 31], temperature_2m_min: [18, 19],
      apparent_temperature_max: [31, 32], wind_gusts_10m_max: [15, 16], et0_fao_evapotranspiration: [3, 3],
    } };
    const air = { hourly: { time: ["2026-11-04T01:00", "2026-11-04T14:00"], us_aqi: [90, 172] } };
    const days = parseOutlook(weather, air);
    expect(days).toHaveLength(1);
    expect(days[0]).toMatchObject({ date: "2026-11-04", rain: 1, aqi: 172 });
    expect(parseOutlook(weather, null)[0]!.aqi).toBeNull();
  });

  it("warns only when a threshold is crossed, and says by how much", () => {
    expect(warnings([day("2026-11-04"), day("2026-11-05")])).toEqual([]);
    const w = warnings([day("2026-11-04", { rain: 120 }), day("2026-11-05", { feels: 44, tmin: -3, gust: 80, aqi: 210 })]);
    expect(w.map((x) => x.kind)).toEqual(["rain", "heat", "frost", "wind", "air"]);
    expect(w[0]!.text).toMatch(/^Severe rain: up to 120 mm/);
    expect(w[1]!.dates).toEqual(["2026-11-05"]);
    expect(w[2]!.text).toContain("-3 °C");
  });

  it("writes runs of three or more days as a range", () => {
    expect(list(["2026-11-04", "2026-11-05", "2026-11-06", "2026-11-09"])).toBe("Wed, Nov 4 to Fri, Nov 6, Mon, Nov 9");
    expect(list(["2026-11-04", "2026-11-05"])).toBe("Wed, Nov 4, Thu, Nov 5");
  });

  it("reads the cloud forecast in the hour nearest a pass", () => {
    const hours = { time: ["2026-11-04T05:00", "2026-11-04T06:00"], cover: [10, 80] };
    expect(cloudAt(hours, new Date("2026-11-04T05:20:00Z"))).toBe(10);
    expect(cloudAt(hours, new Date("2026-11-04T05:40:00Z"))).toBe(80);
    expect(cloudAt(hours, new Date("2026-11-20T05:00:00Z"))).toBeNull();
  });

  it("finds the cleanest 3 waking hours in the next day, and the worst hour", () => {
    const hours = Array.from({ length: 30 }, (_, i) => {
      const h = (i + 4) % 24, d = i + 4 < 24 ? "04" : "05";
      return { time: `2026-11-${d}T${String(h).padStart(2, "0")}:00`, aqi: h >= 13 && h <= 15 ? 90 : h === 2 ? 40 : h === 20 ? 250 : 180 };
    });
    const w = cleanestWindow(hours, "2026-11-04T05")!;
    expect(w).toMatchObject({ start: "2026-11-04T13:00", end: "16:00", aqi: 90 });
    expect(w.worst).toEqual({ time: "2026-11-04T20:00", aqi: 250 });
    expect(cleanestWindow([], "2026-11-04T05")).toBeNull();
    expect(parseAirHours({ utc_offset_seconds: 18000, hourly: { time: ["a"], us_aqi: [null] } }, Date.UTC(2026, 10, 4, 0)).now).toBe("2026-11-04T05");
  });

  it("adds rain and subtracts evaporation", () => {
    expect(waterBalance([day("a", { rain: 10, et0: 4 }), day("b", { rain: 0, et0: 5 })])).toBe(1);
  });
});
