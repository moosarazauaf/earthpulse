/**
 * Hosted mode: EarthPulse served as static files, with no analysis service.
 *
 * Imagery layers are requested from Planetary Computer by the browser, which
 * needs no key. New analyses cannot run here; analyses exported from the
 * backend (scripts/export_static.py) are served as stored results.
 *
 * The layer presets mirror backend/app/services/imagery.py. If one changes,
 * change the other.
 */
import type {
  AnalysisRecord,
  ApiErrorBody,
  Catalog,
  DatasetId,
  DatasetInfo,
  ImageryLayerInfo,
  IndexId,
  Legend,
  Place,
  RenderId,
} from "./types";

const BASE = import.meta.env.BASE_URL;
const PC = "https://planetarycomputer.microsoft.com/api/data/v1/mosaic";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const COLLECTION: Record<DatasetId, string> = { landsat: "landsat-c2-l2", sentinel2: "sentinel-2-l2a" };
const BANDS: Record<DatasetId, Record<string, string>> = {
  landsat: { blue: "blue", green: "green", red: "red", nir: "nir08", swir1: "swir16" },
  sentinel2: { blue: "B02", green: "B03", red: "B04", nir: "B08", swir1: "B11" },
};
const INDEX_BANDS: Record<IndexId, [string, string]> = {
  ndvi: ["nir", "red"],
  ndwi: ["green", "nir"],
  mndwi: ["green", "swir1"],
  ndbi: ["swir1", "nir"],
};
const INDEX_STYLE: Record<IndexId, { colormap: string; min: number; max: number; colors: string[] }> = {
  ndvi: { colormap: "rdylgn", min: -0.2, max: 0.8, colors: ["#a50026", "#f46d43", "#fee08b", "#ffffbf", "#a6d96a", "#1a9850", "#006837"] },
  ndwi: { colormap: "rdbu", min: -0.5, max: 0.5, colors: ["#67001f", "#d6604d", "#fddbc7", "#f7f7f7", "#92c5de", "#2166ac", "#053061"] },
  mndwi: { colormap: "rdbu", min: -0.5, max: 0.5, colors: ["#67001f", "#d6604d", "#fddbc7", "#f7f7f7", "#92c5de", "#2166ac", "#053061"] },
  ndbi: { colormap: "brbg_r", min: -0.4, max: 0.4, colors: ["#003c30", "#35978f", "#c7eae5", "#f5f5f5", "#dfc27d", "#8c510a", "#543005"] },
};
// Landsat Collection 2 Level-2: reflectance = DN * 0.0000275 - 0.2.
const LANDSAT_SCALE = 0.0000275;
const LANDSAT_OFFSET = -0.2;
// Sentinel-2 L2A carries a +1000 DN offset from processing baseline 04.00 (2022).
const S2_OFFSET_DN = 1000;
const S2_OFFSET_START_YEAR = 2022;
const LAYER_MAX_CLOUD = 20;
const MIN_ZOOM = 7;
const MAX_ZOOM: Record<DatasetId, number> = { landsat: 13, sentinel2: 14 };
const FIRST_YEAR: Record<DatasetId, number> = { landsat: 1982, sentinel2: 2016 };
const LANDSAT7_NOTE =
  "2012 is covered only by Landsat 7 after its scan-line corrector failed, so composites for this year contain striped data gaps.";

export const HOSTED_NOTICE: ApiErrorBody = {
  code: "hosted",
  message: "This hosted demo cannot run new analyses.",
  hint: "Analyses need the EarthPulse backend. Run the project locally to analyse your own area.",
};

class HostedError extends Error {
  body: ApiErrorBody;
  constructor(body: ApiErrorBody) {
    super(body.message);
    this.body = body;
  }
}
export const isHostedError = (e: unknown): e is HostedError => e instanceof HostedError;

function landsatPlatforms(year: number): string[] {
  if (year < 1999) return ["landsat-4", "landsat-5"];
  if (year <= 2002) return ["landsat-5", "landsat-7"];
  if (year <= 2011) return ["landsat-5"];
  if (year === 2012) return ["landsat-7"];
  return ["landsat-8", "landsat-9"];
}

const searches = new Map<string, Promise<string>>();

/** Register, once per dataset and year, the STAC search behind a mosaic. */
function searchId(dataset: DatasetId, year: number): Promise<string> {
  const key = `${dataset}-${year}`;
  let pending = searches.get(key);
  if (!pending) {
    const filters: unknown[] = [
      { op: "anyinteracts", args: [{ property: "datetime" }, { interval: [`${year}-01-01T00:00:00Z`, `${year}-12-31T23:59:59Z`] }] },
      { op: "<=", args: [{ property: "eo:cloud_cover" }, LAYER_MAX_CLOUD] },
    ];
    if (dataset === "landsat") filters.push({ op: "in", args: [{ property: "platform" }, landsatPlatforms(year)] });
    pending = fetch(`${PC}/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        collections: [COLLECTION[dataset]],
        "filter-lang": "cql2-json",
        filter: { op: "and", args: filters },
        sortby: [{ field: "eo:cloud_cover", direction: "asc" }],
      }),
    }).then(async (response) => {
      if (!response.ok) throw new Error("register failed");
      return ((await response.json()) as { searchid: string }).searchid;
    });
    pending.catch(() => searches.delete(key)); // allow a retry after a network failure
    searches.set(key, pending);
  }
  return pending;
}

const s2Offset = (year: number) => (year >= S2_OFFSET_START_YEAR ? S2_OFFSET_DN : 0);
const landsatDn = (reflectance: number) => Math.round((reflectance - LANDSAT_OFFSET) / LANDSAT_SCALE);

/** Query string for the mosaic tile endpoint. Exported for tests. */
export function tileQuery(dataset: DatasetId, year: number, render: RenderId): string {
  const params: [string, string][] = [["collection", COLLECTION[dataset]], ["nodata", "0"], ["format", "png"]];
  const bands = BANDS[dataset];
  if (render === "truecolor" || render === "falsecolor") {
    const names = render === "truecolor" ? ["red", "green", "blue"] : ["nir", "red", "green"];
    for (const name of names) params.push(["assets", bands[name] as string]);
    const top = render === "truecolor" ? 0.3 : 0.45; // reflectance mapped to white
    const [low, high] = dataset === "landsat"
      ? [landsatDn(0), landsatDn(top)]
      : [s2Offset(year), Math.round(top * 10_000) + s2Offset(year)];
    params.push(["rescale", `${low},${high}`], ["color_formula", "gamma RGB 1.6"]);
  } else {
    const [positive, negative] = INDEX_BANDS[render];
    const a = bands[positive] as string;
    const b = bands[negative] as string;
    // The reflectance offset cancels in the numerator but not in the sum.
    const correction = dataset === "landsat" ? (2 * LANDSAT_OFFSET) / LANDSAT_SCALE : -2 * s2Offset(year);
    const sum = correction ? `(${a}+${b}${correction.toFixed(4)})` : `(${a}+${b})`;
    const style = INDEX_STYLE[render];
    params.push(["expression", `(${a}-${b})/${sum}`], ["asset_as_band", "true"],
      ["rescale", `${style.min},${style.max}`], ["colormap_name", style.colormap]);
  }
  return params.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("&");
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${BASE}${path}`);
  if (!response.ok) throw new HostedError({ code: "not_found", message: "That stored analysis does not exist in this demo." });
  return (await response.json()) as T;
}

let catalog: Promise<Catalog> | null = null;

export const hosted = {
  catalog: () => (catalog ??= getJson<Catalog>("data/catalog.json")),

  async layer(dataset: DatasetId, year: number, render: RenderId): Promise<ImageryLayerInfo> {
    const info = (await hosted.catalog()).datasets.find((d) => d.id === dataset) as DatasetInfo;
    if (year < FIRST_YEAR[dataset]) {
      throw new HostedError({ code: "dataset_unavailable", message: `${info.name} does not cover ${year}.`, hint: `It starts in ${FIRST_YEAR[dataset]}.` });
    }
    let search: string;
    try {
      search = await searchId(dataset, year);
    } catch {
      throw new HostedError({ code: "imagery_unavailable", message: "Satellite imagery is temporarily unavailable." });
    }
    const isIndex = render !== "truecolor" && render !== "falsecolor";
    const style = isIndex ? INDEX_STYLE[render] : null;
    const legend: Legend | null = style ? { min: style.min, max: style.max, colors: style.colors } : null;
    const indexInfo = (await hosted.catalog()).indices.find((i) => i.id === render);
    return {
      id: `${dataset}-${year}-${render}`,
      dataset: info,
      year,
      render,
      tileUrl: `${PC}/${search}/tiles/WebMercatorQuad/{z}/{x}/{y}@1x?${tileQuery(dataset, year, render)}`,
      minZoom: MIN_ZOOM,
      maxZoom: MAX_ZOOM[dataset],
      compositing: `Mosaic of ${year} scenes with at most ${LAYER_MAX_CLOUD}% cloud, least cloudy scene on top. Scenes are not cloud-masked per pixel, so some cloud can remain.`,
      note: dataset === "landsat" && year === 2012 ? LANDSAT7_NOTE : null,
      valueKind: isIndex ? "DERIVED" : "OBSERVED",
      title: isIndex
        ? `${render.toUpperCase()} ${year}`
        : `${info.name.split(" ")[0]} ${year} ${render === "truecolor" ? "true" : "false"} colour`,
      description: indexInfo
        ? `${indexInfo.measures}. ${indexInfo.formula}; ${indexInfo.reference}.`
        : `Surface reflectance shown as ${render === "truecolor" ? "red, green, blue" : "near-infrared, red, green"}.`,
      legend,
    };
  },

  async geocode(q: string): Promise<{ results: Place[]; attribution: string }> {
    const response = await fetch(`${NOMINATIM}?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`);
    if (!response.ok) throw new HostedError({ code: "imagery_unavailable", message: "Place search is temporarily unavailable." });
    const items = (await response.json()) as { display_name: string; lat: string; lon: string; boundingbox: string[]; addresstype?: string; type?: string }[];
    return {
      attribution: "© OpenStreetMap contributors",
      results: items.map((item) => {
        const [south = 0, north = 0, west = 0, east = 0] = item.boundingbox.map(Number);
        return {
          name: item.display_name,
          lat: Number(item.lat),
          lon: Number(item.lon),
          bbox: [west, south, east, north],
          kind: item.addresstype ?? item.type ?? "",
        };
      }),
    };
  },

  analysis: (id: string) => getJson<AnalysisRecord>(`data/analyses/${id}/record.json`),
  async geeScript(id: string): Promise<{ script: string; codeEditorUrl: string }> {
    const response = await fetch(`${BASE}data/analyses/${id}/export.js`);
    if (!response.ok) throw new HostedError({ code: "not_found", message: "No script is stored for this analysis." });
    return { script: await response.text(), codeEditorUrl: "https://code.earthengine.google.com/" };
  },
  submit: (): Promise<never> => Promise.reject(new HostedError(HOSTED_NOTICE)),
  exportUrl: (id: string, format: string) =>
    `${BASE}data/analyses/${id}/export.${format === "gee" ? "js" : format}`,
  /** Map an API file path from a stored record to its static copy. */
  fileUrl(path: string): string {
    const match = /^\/api\/analysis\/([^/]+)\/files\/(.+)$/.exec(path);
    return match ? `${BASE}data/analyses/${match[1]}/${match[2]}` : path;
  },
};
