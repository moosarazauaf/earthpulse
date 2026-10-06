/** The only module that talks to the network. */
import type {
  AnalysisRecord,
  ApiErrorBody,
  Catalog,
  ChangeRequest,
  DatasetId,
  ImageryLayerInfo,
  Place,
  RenderId,
  TimeSeriesRequest,
} from "./types";

export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "http://localhost:8000";
/** How often a running analysis is polled for its stage. */
const POLL_INTERVAL_MS = 1500;

export class ApiError extends Error {
  code: string;
  hint: string | null;
  constructor(body: ApiErrorBody) {
    super(body.message);
    this.code = body.code;
    this.hint = body.hint ?? null;
  }
}

const OFFLINE: ApiErrorBody = {
  code: "offline",
  message: "The EarthPulse analysis service cannot be reached.",
  hint: "Check that the backend is running.",
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, init);
  } catch {
    throw new ApiError(OFFLINE);
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(body?.error ?? { code: "error", message: "Analysis could not be completed." });
  }
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

export const absolute = (path: string) => `${API_BASE}${path}`;

export const api = {
  catalog: () => request<Catalog>("/api/datasets"),
  layer: (dataset: DatasetId, year: number, render: RenderId) =>
    request<ImageryLayerInfo>(`/api/imagery/layer?dataset=${dataset}&year=${year}&render=${render}`),
  geocode: (q: string) =>
    request<{ results: Place[]; attribution: string }>(`/api/geocode?q=${encodeURIComponent(q)}`),
  submitChange: (body: ChangeRequest) => post<{ id: string }>("/api/analysis/change", body),
  submitTimeSeries: (body: TimeSeriesRequest) => post<{ id: string }>("/api/analysis/timeseries", body),
  analysis: (id: string) => request<AnalysisRecord>(`/api/analysis/${encodeURIComponent(id)}`),
  geeScript: (analysisId: string) =>
    post<{ script: string; codeEditorUrl: string }>("/api/gee/generate", { analysisId }),
  exportUrl: (id: string, format: "geojson" | "csv" | "json" | "gee") =>
    `${API_BASE}/api/analysis/${id}/export?format=${format}`,
};

/**
 * Poll an analysis until it finishes, reporting each record as it arrives so
 * the interface can show the stage the server is actually in.
 */
export async function pollAnalysis(
  id: string,
  onUpdate: (record: AnalysisRecord) => void,
  signal: AbortSignal,
): Promise<AnalysisRecord> {
  for (;;) {
    const record = await api.analysis(id);
    if (signal.aborted) throw new DOMException("aborted", "AbortError");
    onUpdate(record);
    if (record.status === "COMPLETE" || record.status === "FAILED") return record;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
}
