import { describe, expect, it } from "vitest";

import { CO2_PER_C, sumCarbon } from "./carbon";

describe("biomass carbon", () => {
  it("sums density times area inside the mask, scaling the stored tenths", () => {
    // Two forest pixels (148.9 + 33.9 t C/ha) and one bare pixel, each 9 ha; the fourth is outside the area.
    const above = [1489, 1489, 1, 1489], below = [339, 339, 6, 339], mask = [1, 1, 1, 0];
    const s = sumCarbon(above, below, mask, 9);
    expect(s.above).toBeCloseTo((148.9 * 2 + 0.1) * 9, 6);
    expect(s.below).toBeCloseTo((33.9 * 2 + 0.6) * 9, 6);
    expect(s.total).toBeCloseTo(s.above + s.below, 6);
    expect(s.hectares).toBe(27);
    expect(s.meanDensity).toBeCloseTo(s.total / 27, 6);
  });

  it("treats zero above and below as no data, and converts to CO2", () => {
    const s = sumCarbon([0, 100], [0, 20], [1, 1], 1);
    expect(s.hectares).toBe(1);
    expect(s.total).toBeCloseTo(12, 6);
    expect(CO2_PER_C).toBeCloseTo(3.667, 3);
  });
});
