/** The only module components call to reach the network. */
import { hosted, isHostedError } from "./hosted";
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

/**
 * Address of the analysis service. When it is not set (the GitHub Pages
 * build), the application runs in hosted mode: see hosted.ts.
 */
export const API_BASE: string = import.meta.env.VITE_API_BASE ?? "";
export const HOSTED = API_BASE === "";
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

/** Hosted-mode calls raise their own error type; present it as an ApiError. */
async function local<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw isHostedError(error) ? new ApiError(error.body) : new ApiError(OFFLINE);
  }
}

/** Turn a path from an API response into something the browser can load. */
export const absolute = (path: string) =>
  path.startsWith("http") ? path : HOSTED ? hosted.fileUrl(path) : `${API_BASE}${path}`;

const live = {
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
  exportUrl: (id: string, format: ExportFormat) => `${API_BASE}/api/analysis/${id}/export?format=${format}`,
};

const offline: typeof live = {
  catalog: () => local(hosted.catalog()),
  layer: (dataset, year, render) => local(hosted.layer(dataset, year, render)),
  geocode: (q) => local(hosted.geocode(q)),
  submitChange: () => local(hosted.submit()),
  submitTimeSeries: () => local(hosted.submit()),
  analysis: (id) => local(hosted.analysis(id)),
  geeScript: (id) => local(hosted.geeScript(id)),
  exportUrl: (id, format) => hosted.exportUrl(id, format),
};

export type ExportFormat = "geojson" | "csv" | "json" | "gee";
export const api = HOSTED ? offline : live;

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
