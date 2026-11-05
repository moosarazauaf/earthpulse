import { describe, expect, it } from "vitest";

import { CO2_PER_C, sumCarbon, sumSoil } from "./carbon";

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

  it("adds pixel uncertainties directly for the cautious range, and as independent for the narrow one", () => {
    // Two pixels, each 1 ha, each with 10 + 5 t C/ha of uncertainty (stored as tenths).
    const s = sumCarbon([100, 100], [20, 20], [1, 1], 1, [100, 100], [50, 50]);
    expect(s.uncertainty).toBeCloseTo(30, 6);
    expect(s.uncertaintyIndependent).toBeCloseTo(Math.sqrt(15 ** 2 * 2), 6);
    expect(s.uncertaintyIndependent).toBeLessThan(s.uncertainty);
  });

  it("counts a map pixel's repeated copies on a finer grid as one error, not many independent ones", () => {
    // One 300 m pixel read as nine 100 m pixels: all nine share one error, so nothing cancels.
    const nine = Array(9).fill(1);
    const s = sumCarbon(nine.map(() => 100), nine.map(() => 0), nine, 1, nine.map(() => 100), nine.map(() => 0), 9);
    expect(s.uncertaintyIndependent).toBeCloseTo(s.uncertainty, 6);
  });

  it("treats zero above and below as no data, and converts to CO2", () => {
    const s = sumCarbon([0, 100], [0, 20], [1, 1], 1);
    expect(s.hectares).toBe(1);
    expect(s.total).toBeCloseTo(12, 6);
    expect(s.uncertainty).toBe(0);
    expect(CO2_PER_C).toBeCloseTo(3.667, 3);
  });
});

describe("soil carbon", () => {
  it("sums the mean and the 5% to 95% range over pixels inside, by each pixel's area", () => {
    const s = sumSoil([20, 30, 0, 40], [5, 8, 0, 9], [45, 60, 0, 80], [1, 1, 1, 0], [10, 10, 10, 10]);
    expect(s.total).toBe(500);
    expect(s.low).toBe(130);
    expect(s.high).toBe(1050);
    expect(s.hectares).toBe(20); // the zero pixel (water) and the pixel outside are left out
    expect(s.meanDensity).toBe(25);
  });
});
