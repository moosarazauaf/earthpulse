import { describe, expect, it } from "vitest";

import { relief, terrainPixels } from "./terrainMap";

describe("slope, aspect and hillshade of a pixel", () => {
  it("gives flat ground no slope and the light of a 45° sun", () => {
    const r = relief(0, 0);
    expect(r.slope).toBe(0);
    expect(r.shade).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it("names the direction the ground faces downhill", () => {
    // Height rising to the east: the ground faces west, at 45° for a 1:1 gradient.
    expect(relief(1, 0).aspect).toBeCloseTo(270, 6);
    expect(relief(1, 0).slope).toBeCloseTo(45, 6);
    // Height rising to the north: the ground faces south.
    expect(relief(0, 1).aspect).toBeCloseTo(180, 6);
    expect(relief(-1, 0).aspect).toBeCloseTo(90, 6);
  });

  it("lights slopes facing the north-west sun and darkens those facing away", () => {
    const facingNW = relief(1, -1), facingSE = relief(-1, 1);
    expect(facingNW.aspect).toBeCloseTo(315, 6);
    expect(facingNW.shade).toBeGreaterThan(relief(0, 0).shade);
    expect(facingSE.shade).toBeLessThan(0.1);
  });
});

describe("terrain map pixels", () => {
  it("colours pixels inside the area and leaves the rest transparent", () => {
    // A 4 x 4 mosaic at zoom 10 sloping up to the east; the area covers only the left-centre pixels.
    const width = 4, height = 4, z = 10, x0 = 700, y0 = 400;
    const heights = Float32Array.from({ length: 16 }, (_, i) => (i % width) * 50);
    const lon = (col: number) => ((x0 + col / 256) / 2 ** z) * 360 - 180;
    const rings = [[[lon(0), -89], [lon(2), -89], [lon(2), 89], [lon(0), 89], [lon(0), -89]]];
    const px = terrainPixels("slope", { heights, width, height, x0, y0, z, rings });
    const alpha = (row: number, col: number) => px[(row * width + col) * 4 + 3];
    expect(alpha(1, 1)).toBe(255);
    expect(alpha(1, 2)).toBe(0); // outside the area
    expect(alpha(0, 1)).toBe(0); // edge row: no neighbours to take a slope from
  });
});
