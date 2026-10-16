/**
 * A result's grid as a GeoTIFF, georeferenced in its UTM zone, so it opens
 * in QGIS, ArcGIS or GDAL at the right place with its nodata value set.
 */
import { writeArrayBuffer } from "geotiff";

import type { ResultRaster } from "../app/types";

export function rasterToGeoTiff(raster: ResultRaster): ArrayBuffer {
  const metadata: Record<string, unknown> = {
    width: raster.width,
    height: raster.height,
    ModelPixelScale: [raster.res, raster.res, 0],
    ModelTiepoint: [0, 0, 0, raster.west, raster.north, 0],
    // Projected CRS, pixels as areas, EPSG code of the UTM zone.
    GTModelTypeGeoKey: 1,
    GTRasterTypeGeoKey: 1,
    ProjectedCSTypeGeoKey: raster.epsg,
    GDAL_NODATA: raster.noData,
  };
  return writeArrayBuffer(raster.data, metadata as never);
}

/** A short text file to go with the GeoTIFF: what the values mean and where they came from. */
export function rasterReadme(raster: ResultRaster, resultId: string): string {
  const lines = [
    `EarthPulse result ${resultId}: ${raster.name}.tif`,
    raster.description,
    `CRS EPSG:${raster.epsg}, ${raster.res} m pixels, ${raster.width} x ${raster.height}, nodata ${raster.noData}.`,
  ];
  if (raster.codes) lines.push("Values:", ...Object.entries(raster.codes).map(([v, meaning]) => `  ${v} = ${meaning}`));
  return lines.join("\n") + "\n";
}
