/** Application state shared by the globe and every panel. */
import { create } from "zustand";

import { ApiError, api, pollAnalysis } from "./api";
import { clampYear, currentYear, datasetForYear } from "./logic";
import type {
  AnalysisRecord,
  AnalysisResult,
  AoiGeometry,
  ApiErrorBody,
  Catalog,
  ChangeRequest,
  DatasetId,
  Detection,
  ImageryLayerInfo,
  RenderId,
  TimeSeriesRequest,
} from "./types";

export type CompareMode = "swipe" | "blink" | "opacity";
export type DrawTool = "none" | "rectangle" | "polygon";
export type OverlayKey = "change" | "before" | "after";

export interface Aoi {
  geometry: AoiGeometry;
  label: string;
}

interface Job {
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
  mode: "explore" | "change" | "research";
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
  runChange: (request: ChangeRequest) => Promise<void>;
  runTimeSeries: (request: TimeSeriesRequest) => Promise<void>;
  loadAnalysis: (id: string) => Promise<void>;
  cancelJob: () => void;
}

const IDLE: Job = { status: "idle", record: null, error: null };
let abort: AbortController | null = null;

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

  function finish(record: AnalysisRecord) {
    if (record.status === "COMPLETE" && record.result) {
      const result = record.result;
      set({
        job: { status: "complete", record, error: null },
        result,
        overlay: { ...get().overlay, key: result.type === "change" ? "change" : null },
        mode: get().mode === "explore" ? "change" : get().mode,
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
    runChange: (request) => follow(() => api.submitChange(request)),
    runTimeSeries: (request) => follow(() => api.submitTimeSeries(request)),
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
      set({ job: IDLE });
    },
  };
});

/** The dataset actually used for a year, after the Sentinel-2 coverage rule. */
export const activeDataset = (preferred: DatasetId, year: number) => datasetForYear(preferred, year);
