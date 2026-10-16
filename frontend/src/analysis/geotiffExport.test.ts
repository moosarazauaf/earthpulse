import { fromArrayBuffer } from "geotiff";
import { describe, expect, it } from "vitest";

import { rasterToGeoTiff } from "./geotiffExport";

describe("GeoTIFF export", () => {
  it("writes a grid that reads back with its values, size, position and CRS", async () => {
    const data = new Float32Array([0.1, -0.2, NaN, 0.4, 0.5, 0.6]);
    const buffer = rasterToGeoTiff({
      name: "ndvi-change", description: "", data, epsg: 32643, west: 400000, north: 3500000, res: 30, width: 3, height: 2, noData: "nan",
    });
    const tiff = await fromArrayBuffer(buffer);
    const image = await tiff.getImage();
    expect([image.getWidth(), image.getHeight()]).toEqual([3, 2]);
    expect(image.getOrigin().slice(0, 2)).toEqual([400000, 3500000]);
    expect(image.getResolution().slice(0, 2)).toEqual([30, -30]);
    expect(image.getGeoKeys()?.ProjectedCSTypeGeoKey).toBe(32643);
    const [band] = (await image.readRasters()) as unknown as Float32Array[];
    expect(band![0]).toBeCloseTo(0.1);
    expect(Number.isNaN(band![2])).toBe(true);
  });
});
