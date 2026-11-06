import { describe, expect, it } from "vitest";

import { spreadOffsets } from "./pixelMarkers";

describe("spreading markers drawn on top of each other", () => {
  it("leaves lone and off-screen markers in place and fans out an overlapping group in a ring", () => {
    const o = spreadOffsets([{ x: 300, y: 200 }, { x: 304, y: 203 }, { x: 600, y: 400 }, null]);
    expect(o[2]).toEqual([0, 0]);
    expect(o[3]).toEqual([0, 0]);
    expect(o[0]).not.toEqual(o[1]);
    expect(Math.hypot(...o[0]!)).toBeCloseTo(16, 0);
  });

  it("widens the ring for bigger groups", () => {
    const many = Array.from({ length: 8 }, () => ({ x: 100, y: 100 }));
    expect(Math.hypot(...spreadOffsets(many)[0]!)).toBeCloseTo(40, 0);
  });
});
