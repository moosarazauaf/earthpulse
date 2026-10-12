import { describe, expect, it } from "vitest";

import { areaFromGeoJson } from "../analysis/areaFile";
import { rectangleAoi } from "../app/logic";
import { buildGrid, gridBoundsIn, projectAoi, rasterMask, ringsArea, transformer, utmEpsg } from "./geo";
import { landsatPlatforms, selectScenes, type Scene } from "./pc";
import { medianComposite, normalizedDifference, toGeographicRgba, toReflectance } from "./raster";
import { LAND, NO_DATA, WATER, classifyWater, linearTrend, persistence } from "./water";

const LAHORE_SQUARE = rectangleAoi(74.3, 31.45, 74.4, 31.55);

describe("projection and grids", () => {
  it("finds UTM zones", () => {
    expect(utmEpsg(74.35, 31.52)).toBe(32643); // Lahore
    expect(utmEpsg(-58.4, -34.6)).toBe(32721); // Buenos Aires
  });

  it("projects to UTM with metre accuracy", () => {
    // Easting of the central meridian (75E in zone 43) is the 500 km false easting.
    const [x, y] = transformer(4326, 32643)(75, 31.5);
    expect(x).toBeCloseTo(500_000, 3);
    expect(y).toBeGreaterThan(3_480_000);
    expect(y).toBeLessThan(3_490_000);
  });

  it("measures area in metres, not degrees", () => {
    const aoi = projectAoi(LAHORE_SQUARE);
    // 0.1 deg of latitude is about 11.09 km and 0.1 deg of longitude about 9.49 km at 31.5N.
    expect(aoi.areaM2 / 1e6).toBeCloseTo(105.2, 0);
  });

  it("coarsens the grid in whole multiples to respect the pixel budget", () => {
    const aoi = projectAoi(LAHORE_SQUARE);
    const full = buildGrid(aoi, 30, 10_000_000);
    expect(full.res).toBe(30);
    const coarse = buildGrid(aoi, 30, 20_000);
    expect([60, 120, 240, 480]).toContain(coarse.res); // an overview level, not an arbitrary multiple
    expect(coarse.res).toBeGreaterThan(30);
    expect(coarse.width * coarse.height).toBeLessThanOrEqual(20_000);
  });

  it("rasterises the area so that pixel count times pixel area matches the polygon", () => {
    const aoi = projectAoi(LAHORE_SQUARE);
    const grid = buildGrid(aoi, 30, 10_000_000);
    const mask = rasterMask(aoi.rings, grid);
    const inside = mask.reduce((sum, v) => sum + v, 0);
    expect((inside * grid.res ** 2) / aoi.areaM2).toBeCloseTo(1, 2);
  });

  it("leaves the hole between two separate polygons empty", () => {
    const rings: [number, number][][] = [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[20, 0], [30, 0], [30, 10], [20, 10], [20, 0]],
    ];
    const grid = { epsg: 32643, res: 1, west: 0, north: 10, width: 30, height: 10 };
    const mask = rasterMask(rings, grid);
    expect(mask[5 * 30 + 5]).toBe(1);
    expect(mask[5 * 30 + 15]).toBe(0);
    expect(mask[5 * 30 + 25]).toBe(1);
    expect(mask.reduce((s, v) => s + v, 0)).toBe(ringsArea(rings));
  });

  it("returns geographic bounds that contain the area", () => {
    const aoi = projectAoi(LAHORE_SQUARE);
    const [west, south, east, north] = gridBoundsIn(buildGrid(aoi, 30, 1e7), 4326);
    expect(west).toBeLessThanOrEqual(74.3);
    expect(east).toBeGreaterThanOrEqual(74.4);
    expect(south).toBeLessThanOrEqual(31.45);
    expect(north).toBeGreaterThanOrEqual(31.55);
    expect(east - west).toBeLessThan(0.11);
  });
});

describe("pixel arithmetic", () => {
  it("scales Landsat digital numbers and rejects fill and cloud", () => {
    const dn = new Uint16Array([0, 7273, 43636, 20000]);
    const qa = new Uint16Array([1, 21824, 21824, 21824 | 8]); // fill, clear, clear, cloud
    const out = toReflectance("landsat", dn, qa, null);
    expect(out[0]).toBeNaN();
    expect(out[1]).toBeCloseTo(0, 3);
    expect(out[2]).toBeCloseTo(1, 3);
    expect(out[3]).toBeNaN();
  });

  it("applies the Sentinel-2 offset only from baseline 04.00", () => {
    const dn = new Uint16Array([2000]);
    const scl = new Uint8Array([4]);
    expect(toReflectance("sentinel2", dn, scl, 3.01)[0]).toBeCloseTo(0.2, 5);
    expect(toReflectance("sentinel2", dn, scl, 5.13)[0]).toBeCloseTo(0.1, 5);
    expect(toReflectance("sentinel2", dn, new Uint8Array([9]), 5.13)[0]).toBeNaN(); // cloud
  });

  it("takes the median of valid looks only", () => {
    const { median, count } = medianComposite([
      new Float32Array([0.1, NaN, NaN]),
      new Float32Array([0.9, 0.4, NaN]),
      new Float32Array([0.2, 0.6, NaN]),
    ]);
    expect(median[0]).toBeCloseTo(0.2);
    expect(median[1]).toBeCloseTo(0.5);
    expect(median[2]).toBeNaN();
    expect([...count]).toEqual([3, 2, 0]);
  });

  it("computes a normalised difference and refuses invalid sums", () => {
    const out = normalizedDifference(new Float32Array([0.3, 0.1, 0, NaN]), new Float32Array([0.1, 0.3, 0, 0.2]));
    expect(out[0]).toBeCloseTo(0.5);
    expect(out[1]).toBeCloseTo(-0.5);
    expect(out[2]).toBeNaN();
    expect(out[3]).toBeNaN();
  });

  it("keeps orientation when an image is put on a geographic grid", () => {
    const aoi = projectAoi(LAHORE_SQUARE);
    const grid = buildGrid(aoi, 30, 40_000);
    const rgba = new Uint8ClampedArray(grid.width * grid.height * 4);
    for (let row = 0; row < grid.height / 2; row += 1) {
      for (let col = 0; col < grid.width; col += 1) rgba[(row * grid.width + col) * 4 + 3] = 255; // northern half
    }
    const image = toGeographicRgba(rgba, grid);
    const alphaAt = (row: number) => image.data[(row * image.width + (image.width >> 1)) * 4 + 3];
    expect(alphaAt(Math.floor(image.height * 0.2))).toBe(255);
    expect(alphaAt(Math.floor(image.height * 0.8))).toBe(0);
  });
});

describe("WaterWatch rules", () => {
  it("classifies water inside the area and leaves the rest as no data", () => {
    const mndwi = new Float32Array([0.4, -0.3, NaN, 0.4]);
    const mask = new Uint8Array([1, 1, 1, 0]);
    expect([...classifyWater(mndwi, mask, 0)]).toEqual([WATER, LAND, NO_DATA, NO_DATA]);
    expect(classifyWater(mndwi, mask, 0.5)[0]).toBe(LAND); // a stricter threshold
  });

  it("counts persistence against the years each pixel was observed", () => {
    const { observed, water } = persistence([
      new Uint8Array([WATER, WATER, LAND, NO_DATA]),
      new Uint8Array([WATER, LAND, LAND, NO_DATA]),
      new Uint8Array([WATER, NO_DATA, LAND, NO_DATA]),
    ]);
    expect([...observed]).toEqual([3, 2, 3, 0]);
    expect([...water]).toEqual([3, 1, 0, 0]);
  });

  it("fits a trend only when there are enough years", () => {
    expect(linearTrend([[2000, 10], [2010, 20]])).toBeNull();
    const trend = linearTrend([[2000, 100], [2010, 80], [2020, 60]]);
    expect(trend?.slope).toBeCloseTo(-2);
    expect(trend?.n).toBe(3);
  });
});

describe("scene selection", () => {
  const scene = (id: string, footprint: string, cloud: number): Scene => ({
    id, footprint, cloudCover: cloud, datetime: "2020-01-01T00:00:00Z", platform: "landsat-8",
    epsg: 32643, baseline: null, collection: "landsat-c2-l2", assets: {},
  });

  it("covers every footprint before taking second looks", () => {
    const scenes = [scene("a0", "148/38", 0), scene("a1", "148/38", 1), scene("a2", "148/38", 2), scene("b0", "149/38", 9)];
    const chosen = selectScenes(scenes, 2, 3);
    expect(chosen.map((s) => s.id)).toEqual(["a0", "b0", "a1"]);
  });

  it("avoids striped Landsat 7 where another sensor exists", () => {
    expect(landsatPlatforms(2008).platforms).toEqual(["landsat-5"]);
    expect(landsatPlatforms(2012).note).toContain("striped");
    expect(landsatPlatforms(2024).platforms).toEqual(["landsat-8", "landsat-9"]);
  });
});

describe("uploaded areas", () => {
  const ring = [[74.3, 31.4], [74.4, 31.4], [74.4, 31.5], [74.3, 31.4]];

  it("accepts features, collections and shapefile layer arrays", () => {
    const feature = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } };
    expect(areaFromGeoJson(feature).type).toBe("Polygon");
    const collection = { type: "FeatureCollection", features: [feature, feature] };
    expect(areaFromGeoJson(collection).type).toBe("MultiPolygon");
    expect(areaFromGeoJson([collection]).type).toBe("MultiPolygon"); // shpjs multi-layer result
  });

  it("drops elevation values", () => {
    const area = areaFromGeoJson({ type: "Polygon", coordinates: [ring.map(([x, y]) => [x, y, 210])] });
    expect(area.type === "Polygon" && area.coordinates[0]?.[0]).toEqual([74.3, 31.4]);
  });

  it("explains what is wrong with unusable files", () => {
    expect(() => areaFromGeoJson({ type: "Point", coordinates: [74, 31] })).toThrow(/no polygons/);
    const projected = { type: "Polygon", coordinates: [[[400000, 3400000], [410000, 3400000], [410000, 3410000], [400000, 3400000]]] };
    expect(() => areaFromGeoJson(projected)).toThrow(/longitude and latitude/);
  });
});

describe("live hazards", () => {
  it("parses alerts, ranks ongoing events first, and drops malformed entries", async () => {
    const { parseAlerts } = await import("../hazards/sources");
    const feature = (type: string, level: string, current: string, to: string, coordinates: unknown = [70, 30]) => ({
      geometry: { type: "Point", coordinates },
      properties: {
        eventtype: type, alertlevel: level, iscurrent: current, eventid: to, episodeid: 1, name: `${type} ${to}`,
        country: "Testland", fromdate: "2026-10-01T00:00:00", todate: `${to}T00:00:00`, source: "TEST",
        severitydata: { severitytext: "severe" }, url: { report: "https://www.gdacs.org/report.aspx?x=1" },
      },
    });
    const alerts = parseAlerts({ features: [
      feature("FL", "Orange", "false", "2026-10-05"),
      feature("WF", "Red", "false", "2026-10-03"),
      feature("TC", "Orange", "true", "2026-10-09"),
      feature("EQ", "Green", "true", "2026-10-09"), // not red or orange
      feature("XX", "Red", "true", "2026-10-09"), // unknown type
      feature("FL", "Red", "true", "2026-10-09", [999, 30]), // impossible position
    ] });
    expect(alerts.map((a) => `${a.type}/${a.level}`)).toEqual(["TC/Orange", "WF/Red", "FL/Orange"]);
    expect(alerts[0]?.ongoing).toBe(true);
    expect(alerts[1]?.to).toBe("2026-10-03");
    expect(parseAlerts(null)).toEqual([]);
    expect(parseAlerts({ features: "nope" })).toEqual([]);
  });

  it("never links an alert to a site other than the agency's", async () => {
    const { parseAlerts } = await import("../hazards/sources");
    const [alert] = parseAlerts({ features: [{
      geometry: { coordinates: [1, 2] },
      properties: { eventtype: "FL", alertlevel: "Red", url: { report: "https://evil.example/x" } },
    }] });
    expect(alert?.reportUrl).toBe("https://www.gdacs.org/");
  });

  it("asks for the last full day of fire detections and the newest forecast", async () => {
    const { HAZARD_LAYERS, alertsUrl, wmsParameters } = await import("../hazards/sources");
    const now = new Date("2026-10-12T06:00:00Z");
    const fires = HAZARD_LAYERS.find((l) => l.id === "fires");
    const forecast = HAZARD_LAYERS.find((l) => l.id === "flood-forecast");
    expect(fires && wmsParameters(fires, now).time).toBe("2026-10-11");
    expect(forecast && wmsParameters(forecast, now).time).toBeUndefined();
    expect(alertsUrl(now)).toContain("fromDate=2026-09-28&toDate=2026-10-12");
    // Every layer states what it is and what it is not.
    for (const layer of HAZARD_LAYERS) expect(layer.caveat.length).toBeGreaterThan(40);
  });
});

describe("regions", () => {
  it("separates regions by class and by connectivity, largest first", async () => {
    const { findRegions, regionsToGeoJson } = await import("./common");
    // 6 x 4 grid: a 3-pixel class-1 region, a diagonal 2-pixel class-1 region, and one class-2 pixel.
    const classes = new Uint8Array([
      1, 1, 0, 0, 0, 2,
      1, 0, 0, 0, 0, 0,
      0, 0, 0, 1, 0, 0,
      0, 0, 0, 0, 1, 0,
    ]);
    const before = new Float32Array(24).fill(0.6);
    const after = new Float32Array(24).fill(0.2);
    const regions = findRegions(classes, 6, 4, 1, before, after);
    expect(regions.map((r) => [r.value, r.pixels])).toEqual([[1, 3], [1, 2], [2, 1]]);
    expect(regions[0]?.before).toBeCloseTo(0.6);
    expect(findRegions(classes, 6, 4, 2, before, after)).toHaveLength(2); // the minimum size drops the single pixel

    const grid = { epsg: 32643, res: 100, west: 400_000, north: 3_500_000, width: 6, height: 4 };
    const collection = regionsToGeoJson(regions, grid, (v) => (v === 1 ? "decrease" : "increase"));
    const first = collection.features[0];
    expect(first?.properties.areaHa).toBeCloseTo(3); // three 1 ha pixels, not the 4 ha bounding box
    expect(first?.properties.direction).toBe("decrease");
    expect(first?.properties.change).toBeCloseTo(-0.4);
    expect(first?.geometry.coordinates[0]).toHaveLength(5);
    expect(collection.totalRegions).toBe(3);
  });
});

describe("FloodLens rules", () => {
  it("converts power to decibels and rejects fill", async () => {
    const { toDb } = await import("./flood");
    const out = toDb(new Float32Array([1, 0.1, 0.01, 0, -32768, NaN]));
    expect(out[0]).toBeCloseTo(0);
    expect(out[1]).toBeCloseTo(-10);
    expect(out[2]).toBeCloseTo(-20);
    expect([...out.slice(3)].every(Number.isNaN)).toBe(true);
  });

  it("smooths speckle without filling gaps", async () => {
    const { boxMean } = await import("./flood");
    const out = boxMean(new Float32Array([1, 1, 1, 1, NaN, 1, 1, 1, 10]), 3, 3);
    expect(out[4]).toBeNaN();
    expect(out[0]).toBeCloseTo(1);
    expect(out[8]).toBeCloseTo((1 + 1 + 10) / 3);
  });

  it("finds a threshold between two populations and distrusts a single one", async () => {
    const { otsuThreshold } = await import("./flood");
    // Deterministic bell-shaped samples around a centre.
    const bell = (centre: number, spread: number, n: number) =>
      Array.from({ length: n }, (_, i) => centre + spread * Math.tan(((i + 0.5) / n - 0.5) * 2.2));
    const two = new Float32Array([...bell(-21, 0.8, 3000), ...bell(-8, 1.0, 7000)]);
    const all = new Uint8Array(two.length).fill(1);
    const mixed = otsuThreshold(two, all);
    // Any value in the empty gap between the two populations separates them equally well.
    expect(mixed.threshold).toBeGreaterThan(-19.5);
    expect(mixed.threshold).toBeLessThan(-10);
    expect(mixed.separability).toBeGreaterThan(0.8);
    const one = new Float32Array(bell(-8, 1.0, 10_000));
    expect(otsuThreshold(one, new Uint8Array(one.length).fill(1)).separability).toBeLessThan(0.7);
  });

  it("judges an orbit by the window where it covers the area least", async () => {
    const { orbitCoverage } = await import("./flood");
    const aoi = rectangleAoi(0, 0, 1, 1);
    const full = [[[-1, -1], [2, -1], [2, 2], [-1, 2], [-1, -1]]];
    const partial = [[[-1, -1], [0.21, -1], [0.21, 2], [-1, 2], [-1, -1]]]; // covers 21% of the area
    const coverage = orbitCoverage([
      [{ orbit: 5, footprint: full }, { orbit: 107, footprint: full }],
      [{ orbit: 5, footprint: full }, { orbit: 107, footprint: partial }],
    ], aoi);
    expect(coverage[5]).toBe(1);
    expect(coverage[107]).toBeCloseTo(0.21, 1);
  });
});

describe("ideas adapted from God's Eye View", () => {
  it("reads typed coordinates and leaves place names for search", async () => {
    const { parseCoordinates } = await import("../app/logic");
    expect(parseCoordinates("31.52, 74.35")).toEqual({ lat: 31.52, lon: 74.35 });
    expect(parseCoordinates(" -34.6 -58.4 ")).toEqual({ lat: -34.6, lon: -58.4 });
    expect(parseCoordinates("Lahore")).toBeNull();
    expect(parseCoordinates("95, 10")).toBeNull(); // not a latitude
    expect(parseCoordinates("31.5, 74.3, 12")).toBeNull();
  });

  it("parses earthquakes strongest first and ignores non-earthquake events", async () => {
    const { parseQuakes } = await import("../hazards/sources");
    const quake = (id: string, mag: unknown, type = "earthquake") => ({
      id, geometry: { coordinates: [112.2, -8.3, 121] },
      properties: { mag, place: "Somewhere", time: 1791782889720, type, url: "https://earthquake.usgs.gov/earthquakes/eventpage/" + id },
    });
    const quakes = parseQuakes({ features: [quake("a", 4.6), quake("b", 6.1), quake("c", 5, "quarry blast"), quake("d", null)] });
    expect(quakes.map((q) => q.id)).toEqual(["b", "a"]);
    expect(quakes[0]?.depthKm).toBe(121);
    expect(quakes[0]?.time.startsWith("2026-")).toBe(true);
    expect(parseQuakes({})).toEqual([]);
  });
});
