import { describe, expect, it } from "vitest";

import { adjustedAreas } from "./olofsson";

describe("error-adjusted areas (Olofsson et al. 2014)", () => {
  it("reproduces the worked example of section 5 of the paper", () => {
    // Olofsson et al. (2014), Table 8: map classes deforestation, forest gain, stable forest, stable non-forest.
    // Mapped areas in pixels (30 m): 200 000, 150 000, 3 200 000, 6 450 000; their matrix has rows = map, columns = reference:
    const mapRows = [
      [66, 0, 5, 4],
      [0, 55, 8, 12],
      [1, 0, 153, 11],
      [2, 1, 9, 313],
    ];
    // EarthPulse stores [reference][predicted], the transpose.
    const matrix = mapRows[0]!.map((_, j) => mapRows.map((row) => row[j]!));
    const pixelHa = 0.09;
    const mapped = [200000, 150000, 3200000, 6450000].map((px) => px * pixelHa);
    const a = adjustedAreas(matrix, mapped);
    // Paper: deforestation 235 086 ± 68 418 pixels, i.e. about 21 158 ± 6 158 ha.
    expect(a[0]!.estimateHa / pixelHa).toBeCloseTo(235086, -3);
    expect(a[0]!.ciHa / pixelHa).toBeCloseTo(68418, -3);
    // Redistributing area between classes keeps the total.
    expect(a.reduce((sum, x) => sum + x.estimateHa, 0)).toBeCloseTo(mapped.reduce((x, y) => x + y, 0), 3);
  });

  it("keeps the total area and returns the map when the matrix is perfect", () => {
    const a = adjustedAreas([[10, 0], [0, 10]], [300, 700]);
    expect(a.map((x) => x.estimateHa)).toEqual([300, 700]);
    expect(a.map((x) => x.ciHa)).toEqual([0, 0]);
  });
});
