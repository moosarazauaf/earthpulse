/** Application state shared by the globe and every panel. */
import { create } from "zustand";

import { ApiError, api, pollAnalysis } from "./api";
import { type DeviceProfile, PIXEL_BUDGET, type Quality, type RunHandle, runInBrowser } from "../engine/client";
import type { WorkerRequest } from "../engine/worker";
import type { Progress } from "../engine/common";
import type { UrbanRequest } from "../engine/urban";
import type { WaterRequest } from "../engine/water";
import { type Alert, type Quake, fetchAlerts, fetchQuakes } from "../hazards/sources";
import { clampYear, currentYear, datasetForYear } from "./logic";
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
  RenderId,
  TimeSeriesRequest,
} from "./types";

export type CompareMode = "swipe" | "blink" | "opacity";
export type DrawTool = "none" | "rectangle" | "polygon";
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
  mode: "live" | "explore" | "change" | "floods" | "fires" | "water" | "cities" | "research";
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
  sourcesOpen: boolean;
  introOpen: boolean;
  story: { title: string; caption: string; done: boolean } | null;
  notice: string | null;

  set: (partial: Partial<State>) => void;
  setYear: (year: number) => void;
  setCompare: (partial: Partial<State["compare"]>) => void;
  setOverlay: (partial: Partial<State["overlay"]>) => void;
  setAoi: (aoi: Aoi | null) => void;
  loadCatalog: () => Promise<void>;
  runChange: (request: ChangeRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
  runTimeSeries: (request: TimeSeriesRequest) => Promise<void>;
  runFlood: (request: FloodRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
  runWater: (request: WaterRequest, device: DeviceProfile) => Promise<void>;
  runUrban: (request: UrbanRequest, device: DeviceProfile) => Promise<void>;
  runFire: (request: ChangeRequest, device: DeviceProfile, quality: Quality) => Promise<void>;
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
      // Browser results mark regions with bounding boxes, which crowd the map; they start hidden.
      set({ job: { status: "complete", record: null, error: null }, result, overlay: { ...get().overlay, key: layer, detections: false }, mode });
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
    introOpen: true,
    story: null,
    notice: null,

    set: (partial) => set(partial),
    alerts: null,
    alertsError: null,
    selectedAlert: null,
    hazardLayers: ["fires"],
    quakes: null,
    quakesOn: false,
    pendingRun: null,
    feedsAt: null,
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
    setAoi: (aoi) => set({ aoi, drawTool: "none" }),

    loadCatalog: async () => {
      try {
        set({ catalog: await api.catalog() });
      } catch (error) {
        set({ notice: error instanceof ApiError ? `${error.message} ${error.hint ?? ""}` : null });
      }
    },
    runChange: (request, device, quality) =>
      runLocal({ kind: "change", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "change", "change", request.dataset),
    runTimeSeries: (request) => follow(() => api.submitTimeSeries(request)),
    runFlood: (request, device, quality) =>
      runLocal({ kind: "flood", request: { ...request, maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency } }, device, "flood", "floods", "sentinel1"),
    runWater: (request, device) => runLocal({ kind: "water", request }, device, "persistence", "water", request.dataset),
    runUrban: (request, device) => runLocal({ kind: "urban", request }, device, "growth", "cities", "none"),
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

/** The dataset actually used for a year, after the Sentinel-2 coverage rule. */
export const activeDataset = (preferred: DatasetId, year: number) => datasetForYear(preferred, year);
