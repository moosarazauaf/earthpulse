/**
 * Planetary Computer access from the browser: scene search, read tokens and
 * scene selection. No key is involved; these are the same public endpoints
 * the Python backend uses.
 */
const STAC_SEARCH = "https://planetarycomputer.microsoft.com/api/stac/v1/search";
const SAS_TOKEN = "https://planetarycomputer.microsoft.com/api/sas/v1/token/";
/** Renew a token this long before it expires. */
const TOKEN_MARGIN_MS = 5 * 60 * 1000;
/** Results are sorted least cloudy first, and only a few scenes per footprint are kept. */
const SEARCH_LIMIT = 60;

export type OpticalDataset = "landsat" | "sentinel2";

export interface Scene {
  id: string;
  datetime: string;
  platform: string;
  cloudCover: number | null;
  /** Path/row or MGRS tile: scenes sharing it overlap fully. */
  footprint: string;
  epsg: number;
  /** Processing baseline (Sentinel-2), which decides the reflectance offset. */
  baseline: number | null;
  collection: string;
  assets: Record<string, string>;
}

export const COLLECTION: Record<OpticalDataset, string> = {
  landsat: "landsat-c2-l2",
  sentinel2: "sentinel-2-l2a",
};
/** Common band name -> asset key, plus the per-pixel quality layer. */
export const BANDS: Record<OpticalDataset, Record<string, string>> = {
  landsat: { green: "green", red: "red", nir: "nir08", swir1: "swir16", qa: "qa_pixel" },
  sentinel2: { green: "B03", red: "B04", nir: "B08", swir1: "B11", qa: "SCL" },
};
export const NATIVE_RES: Record<OpticalDataset, number> = { landsat: 30, sentinel2: 10 };
export const FIRST_YEAR: Record<OpticalDataset, number> = { landsat: 1984, sentinel2: 2016 };

/** Landsat platforms to use for a year, avoiding striped Landsat 7 where another sensor exists. */
export function landsatPlatforms(year: number): { platforms: string[]; note: string | null } {
  if (year < 1999) return { platforms: ["landsat-4", "landsat-5"], note: null };
  if (year <= 2002) return { platforms: ["landsat-5", "landsat-7"], note: null };
  if (year <= 2011) return { platforms: ["landsat-5"], note: null };
  if (year === 2012) {
    return {
      platforms: ["landsat-7"],
      note: "2012 is covered only by Landsat 7 after its scan-line corrector failed, so that year has striped data gaps.",
    };
  }
  return { platforms: ["landsat-8", "landsat-9"], note: null };
}

function sceneEpsg(properties: Record<string, unknown>): number {
  const code = properties["proj:epsg"] ?? String(properties["proj:code"] ?? "").replace("EPSG:", "");
  return Number(code);
}

export async function searchScenes(
  dataset: OpticalDataset,
  bbox: [number, number, number, number],
  start: string,
  end: string,
  maxCloud: number,
  signal?: AbortSignal,
): Promise<Scene[]> {
  const query: Record<string, unknown> = { "eo:cloud_cover": { lte: maxCloud } };
  if (dataset === "landsat") query.platform = { in: landsatPlatforms(Number(start.slice(0, 4))).platforms };
  const response = await fetch(STAC_SEARCH, {
    method: "POST",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      collections: [COLLECTION[dataset]],
      bbox,
      datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
      query,
      sortby: [{ field: "properties.eo:cloud_cover", direction: "asc" }],
      limit: SEARCH_LIMIT,
    }),
  });
  if (!response.ok) throw new Error("Satellite imagery is temporarily unavailable.");
  const body = (await response.json()) as { features: { id: string; properties: Record<string, unknown>; assets: Record<string, { href: string }> }[] };
  const wanted = Object.values(BANDS[dataset]);
  return body.features.map((feature) => {
    const p = feature.properties;
    const assets: Record<string, string> = {};
    for (const key of wanted) if (feature.assets[key]) assets[key] = feature.assets[key].href;
    return {
      id: feature.id,
      datetime: String(p.datetime),
      platform: String(p.platform ?? ""),
      cloudCover: typeof p["eo:cloud_cover"] === "number" ? (p["eo:cloud_cover"] as number) : null,
      footprint: dataset === "landsat" ? `${p["landsat:wrs_path"]}/${p["landsat:wrs_row"]}` : String(p["s2:mgrs_tile"]),
      epsg: sceneEpsg(p),
      baseline: p["s2:processing_baseline"] ? Number(p["s2:processing_baseline"]) : null,
      collection: COLLECTION[dataset],
      assets,
    };
  });
}

/** Keep the clearest few scenes from each footprint so the whole area is covered. */
export function selectScenes(scenes: Scene[], perFootprint: number, maxScenes: number): Scene[] {
  const groups = new Map<string, Scene[]>();
  for (const scene of scenes) {
    const group = groups.get(scene.footprint) ?? [];
    if (group.length < perFootprint) group.push(scene);
    groups.set(scene.footprint, group);
  }
  const chosen: Scene[] = [];
  for (let rank = 0; rank < perFootprint && chosen.length < maxScenes; rank += 1) {
    for (const group of groups.values()) {
      const scene = group[rank];
      if (scene && chosen.length < maxScenes) chosen.push(scene);
    }
  }
  return chosen;
}

const tokens = new Map<string, Promise<{ token: string; expires: number }>>();

/** Read token for a collection's storage, fetched once and shared by all readers. */
export async function readToken(collection: string): Promise<string> {
  const cached = tokens.get(collection);
  if (cached) {
    const value = await cached.catch(() => null);
    if (value && value.expires - Date.now() > TOKEN_MARGIN_MS) return value.token;
  }
  const pending = fetch(SAS_TOKEN + collection).then(async (response) => {
    if (!response.ok) throw new Error("Satellite imagery is temporarily unavailable.");
    const body = (await response.json()) as { token: string; "msft:expiry": string };
    return { token: body.token, expires: Date.parse(body["msft:expiry"]) };
  });
  tokens.set(collection, pending);
  try {
    return (await pending).token;
  } catch (error) {
    tokens.delete(collection);
    throw error;
  }
}
