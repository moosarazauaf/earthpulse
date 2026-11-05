import { describe, expect, it } from "vitest";

import { isS1Script, lintGeeScript } from "./geeLint";

const naive = `
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD').filterBounds(aoi);
var before = s1.filterDate('2022-05-01', '2022-07-15').mosaic();
var after = s1.filterDate('2022-08-01', '2022-09-30').mean();
var db = after.log10().multiply(10);
var flood = db.select('VV').lt(-18);
`;

const careful = `
var s1 = ee.ImageCollection('COPERNICUS/S1_GRD')
  .filter(ee.Filter.eq('instrumentMode', 'IW'))
  .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))
  .filter(ee.Filter.eq('orbitProperties_pass', 'DESCENDING'))
  .filter(ee.Filter.eq('relativeOrbitNumber_start', 5))
  .filterBounds(aoi);
var before = s1.filterDate('2022-06-20', '2022-07-10').median().focal_mean(30, 'square', 'meters');
var after = s1.filterDate('2022-08-25', '2022-09-05').min().focal_mean(30, 'square', 'meters');
var flood = after.subtract(before).lt(-3).and(after.lt(-18));
`;

describe("Earth Engine script checks", () => {
  it("catches the classic mistakes in a naive script", () => {
    const f = lintGeeScript(naive);
    const text = f.map((x) => `${x.level}: ${x.text}`).join("\n");
    expect(text).toMatch(/error: Mixed orbits/);
    expect(text).toMatch(/warn: Compositing with \.mosaic\(\)/);
    expect(text).toMatch(/2022-05-01 to 2022-07-15 \(75 days\)/);
    expect(text).toMatch(/A \.mean\(\) over the flood period \(from 2022-08-01\)/);
    expect(text).toMatch(/error: COPERNICUS\/S1_GRD is already in decibels/);
    expect(text).toMatch(/No speckle filtering/);
    expect(text).toMatch(/No before-after comparison/);
  });

  it("has no errors on a careful script", () => {
    const f = lintGeeScript(careful);
    expect(f.filter((x) => x.level === "error")).toEqual([]);
    expect(f.map((x) => x.text).join(" ")).not.toMatch(/speckle|polarisation filter|instrumentMode|over the flood period/);
  });

  it("flags two different orbits and says when the text is not a Sentinel-1 script", () => {
    const two = careful.replace("var after = s1", "var after = s1.filter(ee.Filter.eq('relativeOrbitNumber_start', 107))");
    expect(lintGeeScript(two).some((x) => x.level === "error" && /Different relative orbits in one script \(5, 107\)/.test(x.text))).toBe(true);
    expect(isS1Script("print('hello')")).toBe(false);
    expect(lintGeeScript("print('hello')")[0]!.level).toBe("error");
  });
});
