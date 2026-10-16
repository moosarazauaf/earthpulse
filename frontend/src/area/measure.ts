/** Lengths and areas for the measuring tool, on the ground rather than on the screen. */
import { projectAoi } from "../engine/geo";
import { distanceKm } from "../news/stories";

/** Length of a path along the Earth's surface, in km. */
export function pathKm(points: [number, number][]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [lon0, lat0] = points[i - 1]!, [lon1, lat1] = points[i]!;
    total += distanceKm({ lat: lat0, lon: lon0 }, { lat: lat1, lon: lon1 });
  }
  return total;
}

/** Area enclosed by the points (closed back to the first), in km², measured in the local UTM zone. */
export function enclosedKm2(points: [number, number][]): number | null {
  if (points.length < 3) return null;
  return projectAoi({ type: "Polygon", coordinates: [[...points, points[0]!]] }).areaM2 / 1e6;
}

export function formatKm(km: number): string {
  return km < 1 ? `${Math.round(km * 1000)} m` : `${km.toLocaleString("en", { maximumFractionDigits: km < 10 ? 2 : 1 })} km`;
}

export function formatKm2(km2: number): string {
  return km2 < 1 ? `${Math.round(km2 * 100).toLocaleString("en")} ha` : `${km2.toLocaleString("en", { maximumFractionDigits: km2 < 10 ? 2 : 1 })} km²`;
}
