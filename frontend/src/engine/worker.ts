/**
 * Runs analyses off the main thread so the globe stays responsive while the
 * visitor's machine does the work.
 */
import { type BrowserChangeRequest, runChange } from "./change";
import type { EngineHooks, Progress } from "./common";
import { type BrowserFloodRequest, runFlood } from "./flood";
import { type WaterRequest, runWater } from "./water";

export type WorkerRequest =
  | { kind: "water"; request: WaterRequest }
  | { kind: "change"; request: BrowserChangeRequest }
  | { kind: "flood"; request: BrowserFloodRequest };

export type EngineResult =
  | Awaited<ReturnType<typeof runWater>>
  | Awaited<ReturnType<typeof runChange>>
  | Awaited<ReturnType<typeof runFlood>>;

export type WorkerMessage =
  | { type: "progress"; progress: Progress }
  | { type: "done"; result: EngineResult }
  | { type: "error"; message: string };

async function encode(rgba: Uint8ClampedArray, width: number, height: number): Promise<Blob> {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("This browser cannot draw result maps.");
  const image = new ImageData(width, height);
  image.data.set(rgba);
  context.putImageData(image, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

const post = (message: WorkerMessage) => (self as unknown as Worker).postMessage(message);

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const hooks: EngineHooks = { progress: (progress) => post({ type: "progress", progress }), encode };
  try {
    const job = event.data;
    const result =
      job.kind === "water" ? await runWater(job.request, hooks)
      : job.kind === "change" ? await runChange(job.request, hooks)
      : await runFlood(job.request, hooks);
    post({ type: "done", result });
  } catch (error) {
    const offline = error instanceof TypeError; // fetch reports a network failure this way
    post({
      type: "error",
      message: offline
        ? "Satellite imagery could not be reached. Check your connection and try again."
        : error instanceof Error ? error.message : "Analysis could not be completed.",
    });
  }
};
