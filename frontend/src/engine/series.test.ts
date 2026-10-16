import { describe, expect, it } from "vitest";

import { trendPerDecade } from "./series";

describe("index series", () => {
  it("reports change per decade from a straight line", () => {
    const t = trendPerDecade([[2000, 0.3], [2010, 0.4], [2020, 0.5]]);
    expect(t?.perDecade).toBeCloseTo(0.1);
    expect(t?.n).toBe(3);
  });

  it("gives no trend from fewer than three years", () => {
    expect(trendPerDecade([[2000, 0.3], [2020, 0.5]])).toBeNull();
  });
});
