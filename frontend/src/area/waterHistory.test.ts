import { describe, expect, it } from "vitest";

import { occurrence, summarise } from "./waterHistory";

describe("water history", () => {
  it("reads occurrence from the tile's blue channel, transparent as never", () => {
    expect(occurrence(0, 0)).toBe(0);
    expect(occurrence(2, 3)).toBe(1);
    expect(occurrence(150, 150)).toBe(59);
    expect(occurrence(255, 255)).toBe(100);
  });

  it("splits the area into often, sometimes and never water", () => {
    const h = summarise([0, 0, 0, 0, 0, 0, 10, 30, 60, 100])!;
    expect(h.ever).toBeCloseTo(0.4);
    expect(h.often).toBeCloseTo(0.2);
    expect(h.sometimes).toBeCloseTo(0.2);
    expect(summarise([])).toBeNull();
  });
});
