import { describe, expect, it } from "vitest";

import { distanceKm } from "../news/stories";
import { nextPass, parseTles, positionAt, sunElevation } from "./satellites";

// Landsat 8 as CelesTrak gave it on 2026-11-01, plus a satellite Earthsift does not use.
const TLE = `LANDSAT 8
1 39084U 13008A   26305.15842436  .00000205  00000+0  55472-4 0  9998
2 39084  98.2162  13.5586 0001306  91.0221 269.1127 14.57102893717842
NOT USED
1 99999U 00000A   26305.00000000  .00000000  00000+0  00000-0 0  9990
2 99999  98.0000  10.0000 0001000  90.0000 270.0000 14.50000000000000`;
const at = new Date("2026-11-01T06:00:00Z");

describe("satellites", () => {
  it("keeps only the satellites Earthsift reads", () => {
    const sats = parseTles(TLE);
    expect(sats.map((s) => s.sat.name)).toEqual(["Landsat 8"]);
  });

  it("puts Landsat 8 at its orbit height", () => {
    const p = positionAt(parseTles(TLE)[0]!.rec, at)!;
    expect(p.heightKm).toBeGreaterThan(690);
    expect(p.heightKm).toBeLessThan(720);
    expect(Math.abs(p.lat)).toBeLessThanOrEqual(82);
  });

  it("knows when the sun is up", () => {
    expect(sunElevation(new Date("2026-03-20T12:00:00Z"), 0, 0)).toBeGreaterThan(85);
    expect(sunElevation(new Date("2026-03-20T00:00:00Z"), 0, 0)).toBeLessThan(-85);
    // Lahore, 10:30 local (05:30 UTC) in November: the sun is well up.
    expect(sunElevation(new Date("2026-11-01T05:30:00Z"), 74.3, 31.5)).toBeGreaterThan(25);
  });

  it("finds a daylight pass over Lahore with Lahore inside the swath", () => {
    const { sat, rec } = parseTles(TLE)[0]!;
    const when = nextPass(sat, rec, 74.3, 31.5, at)!;
    expect(when).not.toBeNull();
    expect(when.getTime() - at.getTime()).toBeLessThan(16 * 86_400_000);
    expect(distanceKm(positionAt(rec, when)!, { lon: 74.3, lat: 31.5 })).toBeLessThanOrEqual(sat.swathKm / 2);
    expect(sunElevation(when, 74.3, 31.5)).toBeGreaterThanOrEqual(5);
  });
});
