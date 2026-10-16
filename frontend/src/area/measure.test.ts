import { describe, expect, it } from "vitest";

import { enclosedKm2, formatKm, formatKm2, pathKm } from "./measure";

describe("measuring tool", () => {
  it("measures distance along the ground", () => {
    // One degree of latitude is about 111.2 km.
    expect(pathKm([[74, 31], [74, 32]])).toBeCloseTo(111.2, 0);
    expect(pathKm([[74, 31]])).toBe(0);
  });

  it("measures the enclosed area of three or more points", () => {
    const d = 0.045; // about 5 km of latitude
    const km2 = enclosedKm2([[74, 31], [74 + d / Math.cos((31 * Math.PI) / 180), 31], [74 + d / Math.cos((31 * Math.PI) / 180), 31 + d], [74, 31 + d]])!;
    expect(km2).toBeGreaterThan(24);
    expect(km2).toBeLessThan(26);
    expect(enclosedKm2([[74, 31], [75, 31]])).toBeNull();
  });

  it("formats lengths and areas at a sensible precision", () => {
    expect(formatKm(0.42)).toBe("420 m");
    expect(formatKm(3.14159)).toBe("3.14 km");
    expect(formatKm2(0.5)).toBe("50 ha");
    expect(formatKm2(1234.5)).toBe("1,234.5 km²");
  });
});
