/**
 * Main-thread side of the browser engine: what this device can handle, and
 * starting an analysis in the worker.
 */
import type { Overlay, WaterResult } from "../app/types";
import type { Progress, WaterRequest } from "./water";
import type { WorkerMessage, WorkerRequest } from "./worker";

export type Quality = "fast" | "balanced" | "detailed";

export interface DeviceProfile {
  cores: number;
  /** Approximate RAM in GB as reported by the browser; null when it does not say. */
  memoryGb: number | null;
  recommended: Quality;
  concurrency: number;
}

/**
 * Pixels per analysis grid for each quality. A yearly water composite holds
 * about 60 bytes per pixel per scene while it is being built, so "detailed"
 * peaks near 600 MB with six scenes.
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

/** Working resolution that a quality gives for an area, in metres. */
export function workingResolution(areaM2: number, nativeRes: number, quality: Quality): number {
  // The grid covers the area's bounding box, which is larger than the area; 1.5 is a typical ratio.
  const factor = Math.max(1, Math.ceil(Math.sqrt((areaM2 * 1.5) / PIXEL_BUDGET[quality]) / nativeRes));
  return nativeRes * factor;
}

/**
 * Browser-run analyses are not stored on a server. Their IDs carry an "L" so
 * they cannot be mistaken for a shareable server analysis.
 */
function localId(label: string): string {
  const slug = label.toUpperCase().replace(/[^A-Z0-9]+/g, "").slice(0, 16) || "AOI";
  const random = crypto.getRandomValues(new Uint16Array(1))[0] as number;
  return `EP-${new Date().getUTCFullYear()}-${slug}-L${random.toString(16).toUpperCase().padStart(4, "0")}`;
}

export interface RunHandle {
  promise: Promise<WaterResult>;
  cancel: () => void;
}

export function runWaterInBrowser(request: WaterRequest, device: DeviceProfile, onProgress: (p: Progress) => void): RunHandle {
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  const started = performance.now();
  const promise = new Promise<WaterResult>((resolve, reject) => {
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const message = event.data;
      if (message.type === "progress") onProgress(message.progress);
      else if (message.type === "error") {
        worker.terminate();
        reject(new Error(message.message));
      } else {
        worker.terminate();
        const { overlays: raw, grid, ...rest } = message.result;
        const overlays: Record<string, Overlay> = {};
        for (const [key, overlay] of Object.entries(raw)) {
          const url = URL.createObjectURL(overlay.blob);
          overlays[key] = { title: overlay.title, url, geotiff: "", bounds: overlay.bounds, legend: overlay.legend };
        }
        resolve({
          ...rest,
          id: localId(request.label),
          overlays,
          provenance: {
            provider: { id: "planetary-computer", name: "Microsoft Planetary Computer", observed: true },
            method:
              "For each year: per-pixel median of clear-sky surface reflectance from the clearest scenes, " +
              `MNDWI = (green - SWIR1) / (green + SWIR1) (Xu 2006), water where MNDWI > ${request.threshold}.`,
            crs: `EPSG:${grid.epsg}`,
            nativeResolutionM: request.dataset === "landsat" ? 30 : 10,
            workingResolutionM: grid.res,
            gridSize: [grid.width, grid.height],
            maxCloudPercent: request.maxCloud,
            computedOn: "browser",
            device: { cores: device.cores, memoryGb: device.memoryGb },
            seconds: Math.round((performance.now() - started) / 1000),
            uncertainty:
              "No accuracy assessment has been made. A fixed MNDWI threshold misclassifies some dark " +
              "built-up surfaces, shadow and turbid or vegetated water. A yearly median shows water that " +
              "was present in at least half of the clear looks, so short-lived flooding is not counted. " +
              "Areas are pixel counts in a UTM grid.",
          },
        } as WaterResult);
      }
    };
    worker.onerror = () => {
      worker.terminate();
      reject(new Error("The analysis stopped unexpectedly. Try a lower quality setting or a smaller area."));
    };
  });
  worker.postMessage({ kind: "water", request } satisfies WorkerRequest);
  return { promise, cancel: () => worker.terminate() };
}
