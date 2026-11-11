/**
 * Is this place safe? A plain verdict on three questions people ask before
 * they build, buy, plant or travel: has the ground flooded before, is it
 * steep enough for landslides, and what does the coming week bring. For
 * flood-prone ground it also finds the nearest higher ground to head for.
 * Every rating comes from measured data, with fixed thresholds stated here.
 */
import type { AoiGeometry } from "../app/types";
import { type HeightGrid, fetchHeights, latToTileY, lonToTileX, terrainStats, tileYToLat } from "./elevation";
import { type Warning, fetchOutlook, warnings } from "./outlook";
import { type WaterHistory, fetchWaterHistory } from "./waterHistory";

const TILE = 256;
/** Higher ground means at least this much above the centre: more than the few metres of error in the height data. */
export const RISE_M = 10;

export type Level = "high" | "medium" | "low";
export interface RiskItem { hazard: "flood" | "landslide" | "week"; level: Level; title: string; text: string }
export interface HighGround { lon: number; lat: number; km: number; direction: string; aboveM: number }

const DIRECTIONS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

/**
 * The nearest spot at least `rise` metres above the ground at (lon, lat).
 * A spot counts only when its whole 3 × 3 neighbourhood is that high, so a
 * single building or tree in the height data is not taken for a hill.
 */
export function highGround(g: Pick<HeightGrid, "heights" | "width" | "height" | "x0" | "y0" | "z">, lon: number, lat: number, rise = RISE_M): HighGround | null {
  const col0 = Math.floor((lonToTileX(lon, g.z) - g.x0) * TILE), row0 = Math.floor((latToTileY(lat, g.z) - g.y0) * TILE);
  if (col0 < 1 || row0 < 1 || col0 >= g.width - 1 || row0 >= g.height - 1) return null;
  const at = (r: number, c: number) => g.heights[r * g.width + c]!;
  let base = 0;
  for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) base += at(row0 + dr, col0 + dc) / 9;
  const toLon = (c: number) => ((g.x0 + (c + 0.5) / TILE) / 2 ** g.z) * 360 - 180;
  const toLat = (r: number) => tileYToLat(g.y0 + (r + 0.5) / TILE, g.z);
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  let best: HighGround | null = null;
  for (let r = 1; r < g.height - 1; r += 1) {
    const dy = (toLat(r) - lat) * 110.57;
    if (best && Math.abs(dy) >= best.km) continue;
    for (let c = 1; c < g.width - 1; c += 1) {
      const dx = (toLon(c) - lon) * kx;
      const km = Math.hypot(dx, dy);
      if (best && km >= best.km) continue;
      let low = Infinity;
      for (let dr = -1; dr <= 1 && low >= base + rise; dr += 1) for (let dc = -1; dc <= 1; dc += 1) low = Math.min(low, at(r + dr, c + dc));
      if (low < base + rise) continue;
      const bearing = (Math.atan2(dx, dy) * 180) / Math.PI;
      best = { lon: toLon(c), lat: toLat(r), km, direction: DIRECTIONS[Math.round(((bearing + 360) % 360) / 45) % 8]!, aboveM: at(r, c) - base };
    }
  }
  return best;
}

const pct = (v: number) => (v > 0 && v < 0.005 ? "under 1%" : `${Math.round(v * 100)}%`);
const distance = (km: number) => (km < 1 ? `${Math.round(km * 1000)} m` : `${km.toFixed(1)} km`);

/** The verdicts, from whatever could be read; a missing input leaves its item out. */
export function rateRisks(input: { water?: WaterHistory | null; steep?: number | null; week?: Warning[]; ground?: HighGround | null; groundSearched?: boolean }): RiskItem[] {
  const out: RiskItem[] = [];
  const w = input.water;
  if (w !== undefined) {
    const level: Level = !w ? "low" : w.sometimes >= 0.05 ? "high" : w.sometimes >= 0.01 ? "medium" : "low";
    let text = !w || w.ever === 0 ? "No surface water was seen here in any Landsat image from 1984 to 2021."
      : level === "low" ? `Water covers ${pct(w.often)} of the area most of the time, but almost no ground here floods only now and then.`
      : `${pct(w.sometimes)} of the area has been under water some of the time since 1984: floodplain, seasonal wetland or a moving river. It has flooded before and can again.`;
    if (level !== "low" && input.groundSearched) {
      text += input.ground
        ? ` Nearest ground ${RISE_M} m or more above the centre: ${distance(input.ground.km)} ${input.ground.direction}.`
        : ` There is no ground ${RISE_M} m above the centre anywhere in this area.`;
    }
    out.push({ hazard: "flood", level, title: "Flooding", text });
  }
  if (typeof input.steep === "number") {
    const s = input.steep;
    const level: Level = s > 0.25 ? "high" : s > 0.1 ? "medium" : "low";
    out.push({ hazard: "landslide", level, title: "Landslides", text: level === "low" ? `Mostly gentle ground: ${pct(s)} is steeper than 15°.` : `${pct(s)} of the area is steeper than 15°, where heavy rain can set off landslides and rockfall.` });
  }
  if (input.week) {
    const level: Level = input.week.some((x) => x.kind === "rain" || x.kind === "heat") ? "high" : input.week.length ? "medium" : "low";
    out.push({ hazard: "week", level, title: "Next 7 days", text: input.week.length ? input.week.map((x) => x.text).join(" ") : "No heavy rain, dangerous heat, frost, gales or unhealthy air in the forecast." });
  }
  return out;
}

export interface RiskCheck { items: RiskItem[]; ground: HighGround | null; failed: string[] }

/** Reads water history, terrain and the forecast at once; each can fail alone. */
export async function riskCheck(aoi: AoiGeometry, lat: number, lon: number, signal?: AbortSignal): Promise<RiskCheck> {
  const [water, grid, outlook] = await Promise.allSettled([fetchWaterHistory(aoi, signal), fetchHeights(aoi, signal), fetchOutlook(lat, lon, signal)]);
  const g = grid.status === "fulfilled" ? grid.value : null;
  const stats = g ? terrainStats(g.heights, g.width, g.height, g.x0, g.y0, g.z, g.rings) : null;
  const ground = g ? highGround(g, lon, lat) : null;
  const items = rateRisks({
    water: water.status === "fulfilled" ? water.value : undefined,
    steep: stats ? stats.slopeShares[3]! + stats.slopeShares[4]! : null,
    week: outlook.status === "fulfilled" ? warnings(outlook.value.days) : undefined,
    ground, groundSearched: !!g,
  });
  const failed = [water.status === "rejected" && "water history", !stats && "elevation", outlook.status === "rejected" && "forecast"].filter((x): x is string => !!x);
  return { items, ground, failed };
}

export const RISK_SOURCES = "Flooding from JRC Global Surface Water (every Landsat image 1984 to 2021, 30 m), which misses floods that came and went between images or under cloud, and street flooding in towns. Slope and higher ground from AWS Terrain Tiles (about 30 m; heights include buildings and trees). Forecast from Open-Meteo. A first look, not a survey: check with local authorities before you build or buy.";
