import { describe, expect, it } from "vitest";

import { squareAround } from "../app/logic";
import type { AoiGeometry } from "../app/types";
import { bufferGeometry, geometryInfo, toGeoJson, toKml } from "./gis";

const square = squareAround(74.3, 31.5, 10); // 10 km square at Lahore

describe("geometry of an area", () => {
  it("measures area, perimeter, centre and bounds", () => {
    const g = geometryInfo(square);
    expect(g.areaKm2).toBeCloseTo(100, 0);
    expect(g.perimeterKm).toBeCloseTo(40, 0);
    expect(g.centroid[0]).toBeCloseTo(74.3, 3);
    expect(g.centroid[1]).toBeCloseTo(31.5, 3);
    expect(g.vertices).toBe(4);
    expect(g.bbox[0]).toBeLessThan(74.3);
    expect(g.bbox[3]).toBeGreaterThan(31.5);
  });
});

describe("buffer", () => {
  it("grows a square by the distance on every side, with rounded corners", () => {
    const b = geometryInfo(bufferGeometry(square, 2));
    // Square 100 + four 10 x 2 strips 80 + a 2 km circle from the corners 12.57.
    expect(b.areaKm2).toBeGreaterThan(190);
    expect(b.areaKm2).toBeLessThan(193);
    expect(b.centroid[0]).toBeCloseTo(74.3, 2);
  });

  it("turns a point-sized area into a circle and fills the inlets of a concave shape", () => {
    const dot: AoiGeometry = { type: "Polygon", coordinates: [[[74.3, 31.5], [74.3, 31.5], [74.3, 31.5], [74.3, 31.5]]] };
    expect(geometryInfo(bufferGeometry(dot, 5)).areaKm2).toBeCloseTo(Math.PI * 25, 0);
    // An L shape: its buffer covers the notch as well (convex hull).
    const L: AoiGeometry = { type: "Polygon", coordinates: [[[0, 0], [0.2, 0], [0.2, 0.1], [0.1, 0.1], [0.1, 0.2], [0, 0.2], [0, 0]]] };
    expect(geometryInfo(bufferGeometry(L, 1)).areaKm2).toBeGreaterThan(geometryInfo(L).areaKm2);
  });
});

describe("saving the area for other GIS software", () => {
  it("writes GeoJSON with the name and measurements, and KML", () => {
    const fc = JSON.parse(toGeoJson(square, "Lahore")) as { features: { properties: Record<string, unknown>; geometry: { type: string; coordinates: number[][][] } }[] };
    expect(fc.features[0]!.properties).toMatchObject({ name: "Lahore" });
    expect(fc.features[0]!.geometry.type).toBe("Polygon");
    expect(fc.features[0]!.geometry.coordinates[0]).toHaveLength(5);
    const kml = toKml(square, "A & B");
    expect(kml).toContain("<name>A &amp; B</name>");
    expect(kml).toMatch(/<coordinates>[\d.,\s-]+<\/coordinates>/);
  });
});
