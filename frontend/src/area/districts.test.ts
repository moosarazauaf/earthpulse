import { describe, expect, it } from "vitest";

import type { AoiGeometry } from "../app/types";
import { contains, filesCovering } from "./districts";

const square = (w: number, s: number, e: number, n: number) => [[w, s], [e, s], [e, n], [w, n], [w, s]];

describe("finding a district by position", () => {
  it("counts a point inside a polygon but not inside its hole", () => {
    const withHole: AoiGeometry = { type: "Polygon", coordinates: [square(0, 0, 10, 10), square(4, 4, 6, 6)] };
    expect(contains(withHole, 2, 2)).toBe(true);
    expect(contains(withHole, 5, 5)).toBe(false);
    expect(contains(withHole, 11, 5)).toBe(false);
  });

  it("checks every part of a multipolygon", () => {
    const islands: AoiGeometry = { type: "MultiPolygon", coordinates: [[square(0, 0, 1, 1)], [square(5, 5, 6, 6)]] };
    expect(contains(islands, 5.5, 5.5)).toBe(true);
    expect(contains(islands, 3, 3)).toBe(false);
  });

  it("opens only the country files whose box holds the point, the searched country first", () => {
    const index: Record<string, [number, number, number, number, string]> = {
      AFG: [60.5, 29.4, 74.9, 38.5, "Afghanistan"],
      IND: [68.1, 6.7, 97.4, 35.7, "India"],
      PAK: [60.9, 23.7, 77.8, 37.1, "Pakistan"],
    };
    expect(filesCovering(index, 70.94, 30.96, "Pakistan")).toEqual(["PAK", "AFG", "IND"]);
    expect(filesCovering(index, 70.94, 30.96)).toEqual(["AFG", "PAK", "IND"]);
    expect(filesCovering(index, 64, 25)).toEqual(["PAK"]);
    expect(filesCovering(index, 0, 0)).toEqual([]);
    // GAUL's "United States of America" still matches the geocoder's "United States".
    expect(filesCovering({ USA: [-180, 18, 180, 72, "United States of America"], CAN: [-141, 41, -52, 84, "Canada"] }, -105.3, 45, "United States")[0]).toBe("USA");
  });
});
