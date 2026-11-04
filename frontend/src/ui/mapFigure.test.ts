import { describe, expect, it } from "vitest";

import { niceScale } from "./mapFigure";

describe("map figure scale bar", () => {
  it("picks the longest 1, 2 or 5 × 10ⁿ length that fits", () => {
    expect(niceScale(10, 300)).toEqual({ metres: 2000, px: 200, label: "2 km" }); // 3 km fits, 2 km is the round one
    expect(niceScale(1, 120)).toMatchObject({ metres: 100, label: "100 m" });
    expect(niceScale(2500, 260)).toMatchObject({ metres: 500_000, label: "500 km" });
  });
});
