declare module "shpjs" {
  /** Parse a zipped shapefile into GeoJSON, reprojected to EPSG:4326 when a .prj is present. */
  export default function shp(input: ArrayBuffer | string): Promise<unknown>;
}
