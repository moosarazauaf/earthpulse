import { beforeEach, describe, expect, it, vi } from "vitest";

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
  it("shows the stage the server reports, then the result", async () => {
    const result = { id: "EP-2026-TEST-ABCDE", type: "change", aoi: AOI, label: "Test" } as unknown as ChangeResult;
    vi.spyOn(api, "submitChange").mockResolvedValue({ id: "EP-2026-TEST-ABCDE" });
    const stages: string[] = [];
    vi.spyOn(api, "analysis").mockImplementation(async () => {
      stages.push(useStore.getState().job.record?.stage ?? "none");
      return record("COMPLETE", "COMPLETE", result);
    });
    await useStore.getState().runChange(REQUEST);
    const state = useStore.getState();
    expect(state.job.status).toBe("complete");
    expect(state.result?.id).toBe("EP-2026-TEST-ABCDE");
    expect(state.overlay.key).toBe("change"); // the result layer is put on the globe
    expect(state.mode).toBe("change"); // and the panel opens on it
    expect(state.aoi?.label).toBe("Test"); // a shared analysis brings its own area
  });

  it("surfaces a failed analysis with the server's message", async () => {
    vi.spyOn(api, "submitChange").mockResolvedValue({ id: "EP-2026-TEST-ABCDE" });
    vi.spyOn(api, "analysis").mockResolvedValue(record("FAILED", "ACQUIRING_DATA"));
    await useStore.getState().runChange(REQUEST);
    expect(useStore.getState().job.status).toBe("failed");
    expect(useStore.getState().job.error?.message).toBe("No scene covers this area.");
    expect(useStore.getState().result).toBeNull();
  });
});
