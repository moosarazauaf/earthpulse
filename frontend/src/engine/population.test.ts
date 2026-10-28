import { describe, expect, it } from "vitest";

import type { AoiGeometry } from "../app/types";
import { transformer } from "./geo";
import { affectedBy, countInside, formatPeople, levelFor } from "./population";

describe("population count", () => {
  it("reads full detail for small areas and coarser overviews for large ones", () => {
    expect(levelFor(240, 240, 11)).toBe(0);
    expect(levelFor(1300, 1000, 11)).toBe(1);
    expect(levelFor(20_000, 20_000, 11)).toBe(5);
    expect(levelFor(1e7, 1e7, 3)).toBe(2);
  });

  it("counts only cells whose centre is inside the outline, scaled for coarser cells", () => {
    // A 4 by 2 window of 1° cells from (0, 2); the area covers the left half.
    const left: AoiGeometry = { type: "Polygon", coordinates: [[[0, 0], [2, 0], [2, 2], [0, 2], [0, 0]]] };
    const values = [1, 2, 10, 10, 3, 4, 10, 10];
    expect(countInside(values, 4, 0, 2, 1, 1, left)).toBe(10);
    expect(countInside(values, 4, 0, 2, 1, 2, left)).toBe(40);
    // No-data cells (negative, NaN) count as nobody: only the two 1s on the left are summed.
    expect(countInside([-200, Number.NaN, 5, 0, 1, 1, 1, 1], 4, 0, 2, 1, 1, left)).toBe(2);
  });

  it("rounds to three significant figures", () => {
    expect(formatPeople(8_589_538)).toBe("about 8.59 million people");
    expect(formatPeople(12_345)).toBe("about 12,300 people");
    expect(formatPeople(0.2)).toBe("almost no one");
  });
});

describe("people on affected land", () => {
  // A two-cell UTM raster (zone 43 N) with its first cell centred on 74.3° E, 31.5° N.
  const [x, y] = transformer(4326, 32643)(74.3, 31.5);
  const raster = { data: [3, -0.5], epsg: 32643, west: x - 50, north: y + 50, res: 100, width: 2, height: 1 };

  it("finds the raster cell under a longitude and latitude", () => {
    const flooded = affectedBy(raster, 3);
    expect(flooded(74.3, 31.5)).toBe(true);
    expect(flooded(74.301, 31.5)).toBe(false); // about 95 m east: the second cell
    expect(flooded(74.4, 31.5)).toBe(false); // off the raster
  });

  it("can count values at or below a limit, as for a burn-ratio drop", () => {
    const burned = affectedBy(raster, undefined, -0.1);
    expect(burned(74.301, 31.5)).toBe(true);
    expect(burned(74.3, 31.5)).toBe(false);
  });
});
