import { beforeEach, describe, expect, it, vi } from "vitest";

import * as engine from "../engine/client";
import { api } from "./api";
import { useStore } from "./store";
import type { AnalysisRecord, ChangeRequest, ChangeResult } from "./types";

const AOI = {
  type: "Polygon" as const,
  coordinates: [[[74.3, 31.45], [74.4, 31.45], [74.4, 31.55], [74.3, 31.55], [74.3, 31.45]]],
};
const REQUEST: ChangeRequest = {
  aoi: AOI,
  dataset: "landsat",
  index: "ndvi",
  before: { start: "1993-10-01", end: "1993-12-31" },
  after: { start: "2025-10-01", end: "2025-12-31" },
  maxCloud: 20,
  minAreaHa: 0.5,
};

function record(status: AnalysisRecord["status"], stage: string, result: ChangeResult | null = null): AnalysisRecord {
  return {
    id: "EP-2026-TEST-ABCDE", type: "change", status, stage, stages: [], createdAt: "", updatedAt: "",
    result, error: status === "FAILED" ? { code: "no_imagery", message: "No scene covers this area." } : null,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
  useStore.setState({ result: null, aoi: null, mode: "explore", job: { status: "idle", record: null, error: null } });
});

describe("layers and timeline", () => {
  it("clamps the timeline year", () => {
    useStore.getState().setYear(1800);
    expect(useStore.getState().year).toBe(1984);
  });

  it("merges comparison and overlay settings instead of replacing them", () => {
    useStore.getState().setCompare({ enabled: true });
    useStore.getState().setCompare({ year: 2003 });
    expect(useStore.getState().compare).toMatchObject({ enabled: true, year: 2003, mode: "swipe" });
    useStore.getState().setOverlay({ opacity: 0.4 });
    expect(useStore.getState().overlay).toMatchObject({ opacity: 0.4, detections: true });
  });

  it("leaves drawing mode when an area is set", () => {
    useStore.setState({ drawTool: "polygon" });
    useStore.getState().setAoi({ geometry: AOI, label: "Drawn area" });
    expect(useStore.getState().drawTool).toBe("none");
    expect(useStore.getState().aoi?.label).toBe("Drawn area");
  });
});

describe("analysis panel state", () => {
  const DEVICE = { cores: 8, memoryGb: 8, recommended: "balanced" as const, concurrency: 8 };

  it("shows the engine's own progress, then the result", async () => {
    const result = { id: "EP-2026-TEST-L0001", type: "change", aoi: AOI, label: "Test", provenance: {} } as unknown as ChangeResult;
    const seen: (string | undefined)[] = [];
    vi.spyOn(engine, "runInBrowser").mockImplementation((job, _device, onProgress) => {
      expect(job.kind).toBe("change");
      // The pixel budget for the chosen quality reaches the engine.
      expect((job.request as { maxPixels: number }).maxPixels).toBe(engine.PIXEL_BUDGET.fast);
      return {
        cancel: () => undefined,
        promise: Promise.resolve().then(() => {
          onProgress({ stage: "PROCESSING_IMAGERY", done: 3, total: 10, detail: "Reading file 3 of 10" });
          seen.push(useStore.getState().job.progress?.detail);
          return result;
        }),
      };
    });
    await useStore.getState().runChange(REQUEST, DEVICE, "fast");
    const state = useStore.getState();
    expect(seen).toEqual(["Reading file 3 of 10"]);
    expect(state.job.status).toBe("complete");
    expect(state.result?.id).toBe("EP-2026-TEST-L0001");
    expect(state.overlay.key).toBe("change"); // the result layer is put on the globe
    expect(state.mode).toBe("change");
  });

  it("surfaces a failed analysis with the engine's message", async () => {
    vi.spyOn(engine, "runInBrowser").mockReturnValue({
      cancel: () => undefined,
      promise: Promise.reject(new Error("No scene covers this area.")),
    });
    await useStore.getState().runChange(REQUEST, DEVICE, "fast");
    expect(useStore.getState().job.status).toBe("failed");
    expect(useStore.getState().job.error?.message).toBe("No scene covers this area.");
    expect(useStore.getState().result).toBeNull();
  });

  it("loads a stored server analysis and opens it in the right mode", async () => {
    const stored = { id: "EP-2026-TEST-ABCDE", type: "flood", aoi: AOI, label: "Stored", provenance: {} } as unknown as ChangeResult;
    vi.spyOn(api, "analysis").mockResolvedValue(record("COMPLETE", "COMPLETE", stored));
    await useStore.getState().loadAnalysis("EP-2026-TEST-ABCDE");
    expect(useStore.getState().mode).toBe("floods");
    expect(useStore.getState().aoi?.label).toBe("Stored"); // a stored analysis brings its own area
  });
});
