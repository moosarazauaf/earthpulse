import { describe, expect, it } from "vitest";

import { cloudAlpha, frameTimes, frameUrl, heightFade } from "./clouds";

describe("cloud map", () => {
  it("asks for the last eight 3-hourly maps, oldest first, allowing for the delay", () => {
    const times = frameTimes(Date.parse("2026-10-25T10:20:00Z"));
    expect(times).toHaveLength(8);
    expect(times.at(-1)).toBe("2026-10-25T09:00:00Z");
    expect(times[0]).toBe("2026-10-24T12:00:00Z");
    expect(frameUrl(times[0]!)).toContain("time=2026-10-24T12:00:00Z");
  });

  it("keeps warm ground clear and makes cold cloud tops opaque", () => {
    expect(cloudAlpha(70)).toBe(0);
    expect(cloudAlpha(100)).toBe(0);
    expect(cloudAlpha(160)).toBeGreaterThan(80);
    expect(cloudAlpha(255)).toBe(245);
  });

  it("fades the clouds out as the camera comes down", () => {
    expect(heightFade(20_000_000)).toBe(1);
    expect(heightFade(600_000)).toBe(0);
    expect(heightFade(50_000)).toBe(0);
    const mid = heightFade(2_000_000);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });
});
