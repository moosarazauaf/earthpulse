/** Application state shared by the globe and every panel. */
import { create } from "zustand";

import { ApiError, api, pollAnalysis } from "./api";
import { type DeviceProfile, PIXEL_BUDGET, type Quality, type RunHandle, runInBrowser } from "../engine/client";
import type { WorkerRequest } from "../engine/worker";
import type { Progress } from "../engine/common";
import type { UrbanRequest } from "../engine/urban";
import type { HeatRequest } from "../engine/heat";
import type { ClassifyRequest } from "../engine/classify";
import type { DisturbanceRequest } from "../engine/disturbance";
import type { WaterRequest } from "../engine/water";
import { type Alert, type Quake, fetchAlerts, fetchQuakes } from "../hazards/sources";
import type { NewsFile, NewsStory } from "../news/types";
import { clampYear, currentYear, datasetForYear, formatLatLon, squareAround } from "./logic";
import type { QuickActionInfo } from "../area/actions";
import { type RecentRun, type SavedPlace, addRecent, loadPlaces, loadRecent, removePlace, savePlace } from "../area/saved";
import type { SharedRun } from "./shareRun";
import type {
  AnalysisRecord,
  AnalysisResult,
  AoiGeometry,
  ApiErrorBody,
  Catalog,
  ChangeRequest,
  DatasetId,
  Detection,
  FloodRequest,
  ImageryLayerInfo,
  Overlay,
  RenderId,
  TimeSeriesRequest,
} from "./types";

export type CompareMode = "swipe" | "blink" | "opacity";
/** "point" is Analyse here: one click makes a square area around the spot. */
export type DrawTool = "none" | "rectangle" | "polygon" | "point" | "measure" | "sample";
/** Name of a result raster, as keyed in the result's `overlays`. */
export type OverlayKey = string;

export interface Aoi {
  geometry: AoiGeometry;
  label: string;
}

interface Job {
  /** Set while an analysis runs in this browser: real counts from the engine. */
  progress?: Progress;
  status: "idle" | "submitting" | "running" | "complete" | "failed";
  record: AnalysisRecord | null;
  error: ApiErrorBody | null;
}

interface State {
  catalog: Catalog | null;
  // imagery
  year: number;
  preferredDataset: DatasetId;
  render: RenderId;
  imageryVisible: boolean;
  imageryOpacity: number;
  labelsVisible: boolean;
  layerInfo: ImageryLayerInfo | null;
  compareInfo: ImageryLayerInfo | null;
  // comparison
  compare: { enabled: boolean; year: number; mode: CompareMode; position: number; blinkOn: boolean };
  // area of interest
  aoi: Aoi | null;
  drawTool: DrawTool;
  // analysis
  job: Job;
  result: AnalysisResult | null;
  overlay: { key: OverlayKey | null; opacity: number; detections: boolean };
  selectedDetection: Detection | null;
  // interface
  mode: "live" | "explore" | "change" | "floods" | "fires" | "water" | "cities" | "forests" | "heat" | "classify" | "research" | "area";
  // live hazards
  alerts: Alert[] | null;
  alertsError: string | null;
  selectedAlert: Alert | null;
  /** Ids of the hazard map layers switched on. */
  hazardLayers: string[];
  loadAlerts: () => Promise<void>;
  /** Earthquakes of the past week; null until loaded, shown when `quakesOn`. */
  quakes: Quake[] | null;
  quakesOn: boolean;
  /** A shared analysis link waiting for the visitor to confirm before it downloads anything. */
  pendingRun: SharedRun | null;
  /** When the live feeds were last read, so a stale view is visible as stale. */
  feedsAt: string | null;
  loadQuakes: () => Promise<void>;
  /** Hazard stories from the hourly news scan; null until loaded. */
  news: NewsFile | null;
  newsError: string | null;
  selectedStory: NewsStory | null;
  loadNews: () => Promise<void>;
  /** Which part of the Live panel is open. */
  liveTab: "news" | "alerts" | "layers";
  sourcesOpen: boolean;
  /** The keyboard shortcuts card. */
  shortcutsOpen: boolean;
  introOpen: boolean;
  story: { title: string; caption: string; done: boolean } | null;
  notice: string | null;
  /** Legal dialog open state. */
  legalOpen: "privacy" | "cookies" | "terms" | null;

  set: (partial: Partial<State>) => void;
  setYear: (year: number) => void;
  setCompare: (partial: Partial<State["compare"]>) => void;
  setOverlay: (partial: Partial<State["overlay"]>) => void;
  setAoi: (aoi: Aoi | null) => void;
  /** Side of the square made by Analyse here, in km, and the point it is centred on. */
  pickSizeKm: number;
  pickCentre: [number, number] | null;
  /** Make a square area around a point and open its overview. */
  analyseAt: (lon: number, lat: number, sizeKm?: number) => void;
  /** Land cover read for the area overview, shown on the globe while `showCover` is on. */
  areaCover: { overlay: Overlay; shares: { code: number; name: string; ha: number; share: number }[]; resolution: number } | null;
  showCover: boolean;
  /** Share of the current area steeper than 15 degrees, once terrain has been read. */
  areaSteepShare: number | null;
  /** Areas saved in this browser, and the last analyses run here (as recipes). */
  /** Points of the measuring line (D), longitude and latitude. */
  measure: [number, number][];
  /** Training points clicked on the globe for Classify, and the class the next click gets. */
  drawnSamples: { lon: number; lat: number; className: string }[];
  sampleClass: string;
  places: SavedPlace[];
  recent: RecentRun[];
  saveCurrentPlace: () => void;
  forgetPlace: (id: string) => void;
  openPlace: (place: SavedPlace) => void;
  placesOpen: boolean;
  /** Start a one-click analysis of the current area. */
  runQuick: (info: QuickActionInfo, device: DeviceProfile) => void;
  loadCatalog: () => Promise<void>;
  runChange: (request: ChangeRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
  runTimeSeries: (request: TimeSeriesRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
  runFlood: (request: FloodRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
  runWater: (request: WaterRequest, device: DeviceProfile) => Promise<void>;
  runUrban: (request: UrbanRequest, device: DeviceProfile) => Promise<void>;
  runFire: (request: ChangeRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
  runHeat: (request: Omit<HeatRequest, "maxPixels" | "concurrency">, device: DeviceProfile, quality: Quality) => Promise<void>;
  runClassify: (request: Omit<ClassifyRequest, "maxPixels" | "concurrency">, device: DeviceProfile, quality: Quality) => Promise<void>;
  runDisturbance: (request: Omit<DisturbanceRequest, "maxPixels" | "concurrency">, device: DeviceProfile, quality: Quality) => Promise<void>;
  loadAnalysis: (id: string) => Promise<void>;
  cancelJob: () => void;
}

const IDLE: Job = { status: "idle", record: null, error: null };
let abort: AbortController | null = null;
let localRun: RunHandle | null = null;

export const useStore = create<State>((set, get) => {
  /** Shared by both analysis types: submit, then follow the real job state. */
  async function follow(submit: () => Promise<{ id: string }>) {
    abort?.abort();
    const controller = new AbortController();
    abort = controller;
    set({ job: { status: "submitting", record: null, error: null }, selectedDetection: null });
    try {
      const { id } = await submit();
      const record = await pollAnalysis(
        id,
        (r) => set({ job: { status: "running", record: r, error: null } }),
        controller.signal,
      );
      finish(record);
    } catch (error) {
      if (controller.signal.aborted) return;
      const body =
        error instanceof ApiError
          ? { code: error.code, message: error.message, hint: error.hint }
          : { code: "error", message: "Analysis could not be completed." };
      set({ job: { status: "failed", record: null, error: body } });
    }
  }

  /**
   * Run an analysis in this browser. Progress comes from the engine's own
   * counts; the result is shown on the given layer and mode when it arrives.
   */
  async function runLocal(job: WorkerRequest, device: DeviceProfile, layer: string, mode: State["mode"], datasetId: string) {
    abort?.abort();
    localRun?.cancel();
    set({ job: { status: "running", record: null, error: null }, selectedDetection: null });
    const run = runInBrowser(job, device, (progress) => {
      if (localRun === run) set({ job: { status: "running", record: null, error: null, progress } });
    });
    localRun = run;
    try {
      const result = await run.promise;
      if (localRun !== run) return;
      const dataset = get().catalog?.datasets.find((d) => d.id === datasetId);
      if (dataset) result.provenance.dataset = dataset;
      result.provenance.maxPixels = (job.request as { maxPixels: number }).maxPixels;
      // Regions are traced outlines, so they are shown with the result.
      set({ job: { status: "complete", record: null, error: null }, result, overlay: { ...get().overlay, key: layer, detections: true }, mode, recent: remember(get().recent, result) });
    } catch (error) {
      if (localRun !== run) return;
      set({
        job: {
          status: "failed", record: null,
          error: { code: "browser_engine", message: error instanceof Error ? error.message : "Analysis could not be completed." },
        },
      });
    }
  }

  function finish(record: AnalysisRecord) {
    if (record.status === "COMPLETE" && record.result) {
      const result = record.result;
      set({
        job: { status: "complete", record, error: null },
        result,
        // Show the headline raster of the result: "change" or "flood".
        overlay: { ...get().overlay, key: result.type === "timeseries" ? null : result.type },
        mode: result.type === "flood" ? "floods" : get().mode === "research" ? "research" : "change",
        aoi: get().aoi ?? { geometry: result.aoi, label: result.label ?? "Analysed area" },
      });
    } else {
      set({ job: { status: "failed", record, error: record.error } });
    }
  }

  return {
    catalog: null,
    year: currentYear() - 1,
    preferredDataset: "landsat",
    render: "truecolor",
    imageryVisible: true,
    imageryOpacity: 1,
    labelsVisible: true,
    layerInfo: null,
    compareInfo: null,
    compare: { enabled: false, year: 1993, mode: "swipe", position: 0.5, blinkOn: true },
    aoi: null,
    drawTool: "none",
    job: IDLE,
    result: null,
    overlay: { key: null, opacity: 0.85, detections: true },
    selectedDetection: null,
    mode: "explore",
    sourcesOpen: false,
    shortcutsOpen: false,
    introOpen: true,
    story: null,
    notice: null,
    legalOpen: null as "privacy" | "cookies" | "terms" | null,

    set: (partial) => set(partial),
    alerts: null,
    alertsError: null,
    selectedAlert: null,
    // Fire detections cover the globe in crop-burning dots; they are one click away, not the default.
    hazardLayers: [],
    quakes: null,
    quakesOn: false,
    pendingRun: null,
    feedsAt: null,
    news: null,
    newsError: null,
    selectedStory: null,
    liveTab: "news",
    loadNews: async () => {
      set({ newsError: null });
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}data/news.json`, { cache: "no-cache" });
        if (!response.ok) throw new Error();
        const file = (await response.json()) as NewsFile;
        set({ news: { ...file, stories: Array.isArray(file.stories) ? file.stories : [] } });
      } catch {
        set({ newsError: "The news scan could not be loaded." });
      }
    },
    loadQuakes: async () => {
      try {
        set({ quakes: await fetchQuakes() });
      } catch {
        set({ quakes: [], notice: "Earthquakes could not be loaded from USGS." });
      }
    },
    loadAlerts: async () => {
      set({ alertsError: null });
      try {
        set({ alerts: await fetchAlerts(), feedsAt: new Date().toISOString() });
      } catch {
        set({ alertsError: "Live alerts could not be loaded. The alert service may be busy." });
      }
    },
    setYear: (year) => set({ year: clampYear(year) }),
    setCompare: (partial) => set({ compare: { ...get().compare, ...partial } }),
    setOverlay: (partial) => set({ overlay: { ...get().overlay, ...partial } }),
    // Any other way of setting the area is not "around a point", so the size chips and centre go.
    setAoi: (aoi) => set({ aoi, drawTool: "none", areaCover: null, areaSteepShare: null, pickCentre: null }),
    measure: [],
    drawnSamples: [],
    sampleClass: "",
    places: loadPlaces(),
    recent: loadRecent(),
    placesOpen: false,
    saveCurrentPlace: () => {
      const aoi = get().aoi;
      if (!aoi) return;
      const next = savePlace(get().places, aoi.label, aoi.geometry);
      set(next ? { places: next, notice: `Saved "${aoi.label}" in My places, in this browser.` } : { notice: "This area could not be saved: the outline is too detailed, or the browser is not allowing storage." });
    },
    forgetPlace: (id) => set({ places: removePlace(get().places, id) }),
    openPlace: (place) => {
      get().cancelJob(); // a run for the previous area must not land on this one
      set({ aoi: { geometry: place.geometry, label: place.label }, pickCentre: null, mode: "area", areaCover: null, areaSteepShare: null, result: null, placesOpen: false, introOpen: false, drawTool: "none" });
    },
    pickSizeKm: 5,
    pickCentre: null,
    areaCover: null,
    showCover: false,
    areaSteepShare: null,
    analyseAt: (lon, lat, sizeKm) => {
      const km = sizeKm ?? get().pickSizeKm;
      const label = `${km} km around ${formatLatLon(lat, lon)}`;
      get().cancelJob(); // a run for the previous area must not land on this one
      set({
        aoi: { geometry: squareAround(lon, lat, km), label }, pickCentre: [lon, lat], pickSizeKm: km,
        drawTool: "none", mode: "area", areaCover: null, areaSteepShare: null, introOpen: false, result: null,
      });
      // Name the place when OpenStreetMap knows it; the coordinates stay if it does not answer.
      void reverseGeocode(lat, lon).then((name) => {
        const aoi = get().aoi;
        if (name && aoi && aoi.label === label) set({ aoi: { ...aoi, label: `${km} km around ${name}` } });
      });
    },
    runQuick: (info, device) => {
      const s = get();
      const quality = device.recommended;
      const maxPixels = PIXEL_BUDGET[quality];
      const a = info.action;
      set({ mode: info.mode });
      if (a.kind === "change") void s.runChange(a.request, device, quality);
      else if (a.kind === "fire") void s.runFire(a.request, device, quality);
      else if (a.kind === "flood") void s.runFlood(a.request, device, quality);
      else if (a.kind === "series") void s.runTimeSeries(a.request, device, quality);
      else if (a.kind === "heat") void s.runHeat(a.request, device, quality);
      else if (a.kind === "water") void s.runWater({ ...a.request, maxPixels, concurrency: device.concurrency }, device);
      else void s.runUrban({ ...a.request, maxPixels, concurrency: device.concurrency }, device);
    },

    loadCatalog: async () => {
      try {
        set({ catalog: await api.catalog() });
      } catch (error) {
        set({ notice: error instanceof ApiError ? `${error.message} ${error.hint ?? ""}` : null });
      }
    },
    runChange: (request, device, quality) =>
      runLocal({ kind: "change", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "change", "change", request.dataset),
    runTimeSeries: (request, device, quality) =>
      runLocal({ kind: "series", request: { ...request, label: request.label ?? null, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "", "research", request.dataset),
    runFlood: (request, device, quality) =>
      runLocal({ kind: "flood", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "flood", "floods", "sentinel1"),
    runWater: (request, device) => runLocal({ kind: "water", request }, device, "persistence", "water", request.dataset),
    runUrban: (request, device) => runLocal({ kind: "urban", request }, device, "growth", request.focus === 2 ? "forests" : "cities", "none"),
    runDisturbance: (request, device, quality) =>
      runLocal({ kind: "disturbance", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "disturbance", "forests", "landsat"),
    runClassify: (request, device, quality) =>
      runLocal({ kind: "classify", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "classes", "classify", request.dataset),
    runHeat: (request, device, quality) =>
      runLocal({ kind: "heat", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "lst", "heat", "landsat"),
    runFire: (request, device, quality) =>
      runLocal({ kind: "change", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "severity", "fires", request.dataset),
    loadAnalysis: async (id) => {
      try {
        const record = await api.analysis(id);
        if (record.status === "COMPLETE" || record.status === "FAILED") finish(record);
        else await follow(async () => ({ id }));
      } catch (error) {
        set({ notice: error instanceof ApiError ? error.message : "That analysis could not be loaded." });
      }
    },
    cancelJob: () => {
      abort?.abort();
      localRun?.cancel();
      localRun = null;
      set({ job: IDLE });
    },
  };
});

/** Add a result to the recent list; recording history must never fail the analysis itself. */
function remember(recent: RecentRun[], result: AnalysisResult): RecentRun[] {
  try {
    return addRecent(recent, result);
  } catch {
    return recent;
  }
}

const NOMINATIM_REVERSE = "https://nominatim.openstreetmap.org/reverse";

/** The nearest named place to a point, from OpenStreetMap; null if none or the service is busy. */
async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  try {
    const response = await fetch(`${NOMINATIM_REVERSE}?format=jsonv2&zoom=10&accept-language=en&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`);
    if (!response.ok) return null;
    const body = (await response.json()) as { address?: Record<string, string>; name?: string };
    const a = body.address ?? {};
    const place = a.city ?? a.town ?? a.village ?? a.county ?? a.state_district ?? a.state ?? body.name;
    return place ? [place, a.country].filter(Boolean).join(", ") : null;
  } catch {
    return null;
  }
}

/** The dataset actually used for a year, after the Sentinel-2 coverage rule. */
export const activeDataset = (preferred: DatasetId, year: number) => datasetForYear(preferred, year);
