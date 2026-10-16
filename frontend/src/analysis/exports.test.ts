import { describe, expect, it } from "vitest";

import type { ChangeResult, TimeSeriesResult } from "../app/types";
import { resultCsv } from "./csv";
import { NotReproducible, changeScript, geeAssetId } from "./geeScript";

describe("Earth Engine script", () => {
  it("maps scene ids exactly as the backend generator does", () => {
    expect(geeAssetId("LT05_L2SP_148038_19931230_02_T1")).toEqual(["LANDSAT/LT05/C02/T1_L2/LT05_148038_19931230", "tm"]);
    expect(geeAssetId("LC09_L2SP_149038_20260110_02_T1")[1]).toBe("oli");
    expect(geeAssetId("S2C_MSIL2A_20261003T053651_R005_T43SDR_20261003T101308")).toEqual(["COPERNICUS/S2_SR_HARMONIZED/20261003T053651_20261003T101308_T43SDR", "s2"]);
    expect(() => geeAssetId("DEMO_landsat_2000_0")).toThrow(NotReproducible);
  });

  it("writes a script with the scenes, threshold and scale of a browser result", () => {
    const result = {
      type: "change", id: "EP-2026-TEST-L0001", softwareVersion: "test", label: "Test",
      aoi: { type: "Polygon", coordinates: [[[74, 31], [74.1, 31], [74.1, 31.1], [74, 31]]] },
      request: { dataset: "landsat", before: { start: "1993-10-01", end: "1993-12-31" }, after: { start: "2025-10-01", end: "2025-12-31" } },
      summary: { threshold: 0.15, lossAreaHa: 12.34, gainAreaHa: 5 },
      provenance: {
        provider: { observed: true }, computedOn: "browser", crs: "EPSG:32643", workingResolutionM: 60,
        index: { id: "ndvi", name: "NDVI", formula: "(NIR - Red) / (NIR + Red)", reference: "Tucker 1979" },
        scenes: { before: [{ id: "LT05_L2SP_148038_19931230_02_T1" }], after: [{ id: "LC09_L2SP_149038_20260110_02_T1" }] },
      },
    } as unknown as ChangeResult;
    const script = changeScript(result);
    expect(script).toContain("LANDSAT/LT05/C02/T1_L2/LT05_148038_19931230");
    expect(script).toContain("prep_oli(ee.Image('LANDSAT/LC09/C02/T1_L2/LC09_149038_20260110'))");
    expect(script).toContain("change.lte(-0.15)");
    expect(script).toContain("atScale(60)");
    expect(script).toContain("decrease 12.3 ha");
  });
});

describe("CSV export", () => {
  it("writes the index series with gaps left empty and quoting where needed", () => {
    const result = {
      type: "timeseries", id: "EP-1", softwareVersion: "t", label: "A, B", valueKind: "DERIVED",
      series: [
        { year: 2000, status: "OBSERVED", values: { ndvi: 0.5, ndwi: -0.2, mndwi: -0.1, ndbi: 0, nbr: null }, validFraction: 1, platforms: ["landsat-5"], scenes: [{}, {}] },
        { year: 2005, status: "NO_DATA", values: null },
      ],
    } as unknown as TimeSeriesResult;
    const lines = resultCsv(result)!.trim().split("\n");
    expect(lines[0]).toContain("A, B");
    expect(lines[1]).toBe("year,status,ndvi,ndwi,mndwi,ndbi,valid_fraction,sensors,scenes");
    expect(lines[2]).toBe("2000,OBSERVED,0.500000,-0.200000,-0.100000,0,1,landsat-5,2");
    expect(lines[3]).toBe("2005,NO_DATA,,,,,,,0");
  });
});
