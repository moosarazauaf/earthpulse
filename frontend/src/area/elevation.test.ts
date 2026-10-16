import { describe, expect, it } from "vitest";

import { chooseZoom, decodeTerrarium, latToTileY, lonToTileX, terrainStats } from "./elevation";

describe("terrain", () => {
  it("decodes Terrarium heights", () => {
    expect(decodeTerrarium(128, 0, 0)).toBe(0);
    expect(decodeTerrarium(128, 100, 128)).toBe(100.5);
    expect(decodeTerrarium(127, 255, 0)).toBe(-1);
  });

  it("places points in the right tile", () => {
    expect(lonToTileX(0, 1)).toBe(1);
    expect(latToTileY(0, 1)).toBeCloseTo(1);
    expect(Math.floor(lonToTileX(74.35, 10))).toBe(723);
    expect(Math.floor(latToTileY(31.52, 10))).toBe(417);
  });

  it("keeps a 5 km area to a few tiles at a fine zoom", () => {
    const z = chooseZoom([74.32, 31.49, 74.37, 31.54]);
    expect(z).toBeGreaterThanOrEqual(12);
    expect(z).toBeLessThanOrEqual(14);
  });

  it("measures the slope of a tilted plane and finds its lowest and highest points", () => {
    const z = 12, size = 64, x0 = 2 ** z / 2, y0 = 2 ** z / 2 - size / 512;
    const res = 40_075_016.686 / (256 * 2 ** z);
    const rise = Math.tan((10 * Math.PI) / 180) * res;
    const heights = new Float32Array(size * size);
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) heights[r * size + c] = 100 + c * rise;
    const ring = [[-1, -1], [1, -1], [1, 1], [-1, 1], [-1, -1]];
    const t = terrainStats(heights, size, size, x0, y0, z, [ring])!;
    expect(t.meanSlope).toBeCloseTo(10, 0);
    expect(t.slopeShares[2]).toBe(1); // all "moderate" (8 to 15 degrees)
    expect(t.lowest[0]).toBeLessThan(t.highest[0]);
    expect(t.max - t.min).toBeCloseTo(rise * (size - 3), 0);
  });
});
