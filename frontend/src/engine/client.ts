/**
 * Main-thread side of the browser engine: what this device can handle, and
 * starting an analysis in the worker.
 */
import type { AnalysisResult, Overlay } from "../app/types";
import type { Progress } from "./common";
import type { EngineResult, WorkerMessage, WorkerRequest } from "./worker";

export const SOFTWARE_VERSION = "0.2.0-alpha.6";
export type Quality = "fast" | "balanced" | "detailed";

export interface DeviceProfile {
  cores: number;
  /** Approximate RAM in GB as reported by the browser; null when it does not say. */
  memoryGb: number | null;
  recommended: Quality;
  concurrency: number;
}

/**
 * Pixels per analysis grid for each quality. A composite holds about 60 bytes
 * per pixel per scene while it is being built, so "detailed" peaks near
 * 600 MB with six scenes.
 */
export const PIXEL_BUDGET: Record<Quality, number> = { fast: 250_000, balanced: 700_000, detailed: 1_600_000 };
/** Browsers that do not report memory are assumed to have this much. */
const ASSUMED_MEMORY_GB = 4;
const MAX_PARALLEL_DOWNLOADS = 12;

export function deviceProfile(): DeviceProfile {
  const cores = navigator.hardwareConcurrency || 4;
  const reported = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const memoryGb = typeof reported === "number" ? reported : null;
  const memory = memoryGb ?? ASSUMED_MEMORY_GB;
  const recommended: Quality = memory >= 8 && cores >= 8 ? "detailed" : memory >= 4 && cores >= 4 ? "balanced" : "fast";
  return { cores, memoryGb, recommended, concurrency: Math.min(MAX_PARALLEL_DOWNLOADS, Math.max(4, cores)) };
}

/**
 * Browser-run analyses are not stored on a server. Their IDs carry an "L" so
 * they cannot be mistaken for a shareable server analysis.
 */
function localId(label: string | null | undefined): string {
  const slug = (label ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 16) || "AOI";
  const random = crypto.getRandomValues(new Uint16Array(1))[0] as number;
  return `EP-${new Date().getUTCFullYear()}-${slug}-L${random.toString(16).toUpperCase().padStart(4, "0")}`;
}

const WATER_UNCERTAINTY =
  "No accuracy assessment has been made. A fixed MNDWI threshold misclassifies some dark built-up surfaces, shadow " +
  "and turbid or vegetated water. A yearly median shows water that was present in at least half of the clear looks, " +
  "so short-lived flooding is not counted. Areas are pixel counts in a UTM grid.";

/** Attach what only the main thread knows: an ID, image URLs, the device and the time taken. */
function finish(raw: EngineResult, job: WorkerRequest, device: DeviceProfile, seconds: number): AnalysisResult {
  const { overlays: blobs, grid, ...rest } = raw;
  const overlays: Record<string, Overlay> = {};
  for (const [key, overlay] of Object.entries(blobs)) {
    overlays[key] = { title: overlay.title, url: URL.createObjectURL(overlay.blob), geotiff: "", bounds: overlay.bounds, legend: overlay.legend };
  }
  const ran = { computedOn: "browser" as const, device: { cores: device.cores, memoryGb: device.memoryGb }, seconds };
  const provenance = "provenance" in rest
    ? { ...rest.provenance, ...ran }
    : {
        // WaterWatch builds its provenance here because its engine predates the shared shape.
        provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
        method:
          "For each year: per-pixel median of clear-sky surface reflectance from the clearest scenes, " +
          `MNDWI = (green - SWIR1) / (green + SWIR1) (Xu 2006), water where MNDWI > ${job.kind === "water" ? job.request.threshold : 0}.`,
        crs: `EPSG:${grid.epsg}`,
        nativeResolutionM: job.kind === "water" && job.request.dataset === "sentinel2" ? 10 : 30,
        workingResolutionM: grid.res,
        gridSize: [grid.width, grid.height],
        maxCloudPercent: job.kind === "water" ? job.request.maxCloud : undefined,
        uncertainty: WATER_UNCERTAINTY,
        ...ran,
      };
  return { ...rest, id: localId(raw.label), softwareVersion: SOFTWARE_VERSION, overlays, provenance } as unknown as AnalysisResult;
}

export interface RunHandle {
  promise: Promise<AnalysisResult>;
  cancel: () => void;
}

export function runInBrowser(job: WorkerRequest, device: DeviceProfile, onProgress: (p: Progress) => void): RunHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const started = performance.now();
  const promise = new Promise<AnalysisResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") {
        onProgress(message.progress);
        return;
      }
      worker.terminate();
      if (message.type === "error") reject(new Error(message.message));
      else resolve(finish(message.result, job, device, Math.round((performance.now() - started) / 1000)));
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The analysis stopped unexpectedly. Try a lower quality setting or a smaller area."));
    };
  });
  worker.postMessage(job);
  return { promise, cancel: () => worker.terminate() };
}
