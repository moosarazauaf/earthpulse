import { describe, expect, it } from "vitest";

import { largestDrop } from "./disturbance";

describe("forest disturbance", () => {
  it("finds the largest drop from dense canopy and dates it to the later year", () => {
    expect(largestDrop([0.6, 0.62, 0.2, 0.3], 0.25, 0.4)).toEqual({ after: 2, drop: expect.closeTo(0.42, 5) });
  });

  it("skips unobserved years and compares across the gap", () => {
    expect(largestDrop([0.6, NaN, 0.3], 0.25, 0.4)?.after).toBe(2);
  });

  it("ignores drops from sparse vegetation (crop cycles) and small drops", () => {
    expect(largestDrop([0.35, 0.05], 0.25, 0.4)).toBeNull();
    expect(largestDrop([0.6, 0.5], 0.25, 0.4)).toBeNull();
  });
});
