import { describe, expect, it } from "vitest";

import { distanceKm } from "../news/stories";
import { profileStats, profileZoom, samplePath } from "./profile";

describe("elevation profile", () => {
  it("spaces samples evenly along a bent path, ending at its last point", () => {
    const path: [number, number][] = [[74, 31], [74.1, 31], [74.1, 31.1]];
    const s = samplePath(path, 21);
    expect(s).toHaveLength(21);
    expect(s[0]).toMatchObject({ lon: 74, lat: 31, km: 0 });
    expect(s[20]!.lon).toBeCloseTo(74.1, 6);
    expect(s[20]!.lat).toBeCloseTo(31.1, 6);
    const steps = s.slice(1).map((p, i) => distanceKm(s[i]!, p));
    for (const step of steps) expect(step).toBeCloseTo(steps[0]!, 0);
  });

  it("adds up climb and descent separately", () => {
    expect(profileStats([100, 150, 120, 200, 180])).toEqual({ min: 100, max: 200, climb: 130, descent: 50 });
  });

  it("reads fine tiles for a short line and coarse ones for a long line", () => {
    const short = samplePath([[74.3, 31.5], [74.32, 31.5]], 128); // about 1.9 km
    const long = samplePath([[60, 25], [75, 35]], 128); // about 1,800 km
    const zShort = profileZoom(short, (short.at(-1)!.km * 1000) / 127);
    const zLong = profileZoom(long, (long.at(-1)!.km * 1000) / 127);
    expect(zShort).toBeGreaterThanOrEqual(13);
    expect(zLong).toBeLessThan(9);
  });
});
