import { describe, expect, it } from "vitest";

import { lastDomainTime, rainBlend, rainTileUrl, rainTimes } from "./rain";

describe("rain maps", () => {
  it("reads the newest time from a GIBS time-domain answer", () => {
    const xml = "<Domains><DimensionDomain><Domain>2026-10-24/2026-10-24T22:30:00Z/PT30M</Domain></DimensionDomain></Domains>";
    expect(lastDomainTime(xml)).toBe("2026-10-24T22:30:00Z");
    expect(lastDomainTime("<Domains/>")).toBeNull();
  });

  it("steps back half an hour at a time, oldest first", () => {
    const times = rainTimes("2026-10-24T22:30:00Z");
    expect(times).toEqual(["2026-10-24T20:00:00Z", "2026-10-24T20:30:00Z", "2026-10-24T21:00:00Z", "2026-10-24T21:30:00Z", "2026-10-24T22:00:00Z", "2026-10-24T22:30:00Z"]);
    expect(rainTileUrl(times[0]!)).toContain("/IMERG_Precipitation_Rate_30min/default/2026-10-24T20:00:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png");
  });
});

describe("rain loop", () => {
  const alphas = (s: number, n: number) => {
    const { a, b, f } = rainBlend(s, n);
    return Array.from({ length: n }, (_, i) => (i === a ? 0.8 * (1 - f) : i === b ? 0.8 * f : 0));
  };

  it("never jumps between frames: at 60 fps no layer changes by more than 0.06", () => {
    let worst = 0;
    let prev = alphas(0, 6);
    for (let s = 1 / 60; s < 20; s += 1 / 60) {
      const now = alphas(s, 6);
      worst = Math.max(worst, ...now.map((v, i) => Math.abs(v - prev[i]!)));
      prev = now;
    }
    expect(worst).toBeLessThan(0.06);
  });

  it("holds each frame, then the newest for longer, and loops back to the oldest", () => {
    expect(rainBlend(0.3, 6)).toEqual({ a: 0, b: 1, f: 0 });
    expect(rainBlend(5.5, 6)).toMatchObject({ a: 5, f: 0 });
    expect(rainBlend(7.99, 6)).toMatchObject({ a: 5, b: 0 });
    expect(rainBlend(7.99, 6).f).toBeGreaterThan(0.99);
    expect(rainBlend(8.2, 6)).toMatchObject({ a: 0, f: 0 });
    expect(rainBlend(3, 1)).toEqual({ a: 0, b: 0, f: 0 });
  });
});
