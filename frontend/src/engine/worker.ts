/**
 * Runs analyses off the main thread so the globe stays responsive while the
 * visitor's machine does the work.
 */
import { type Progress, type WaterRequest, runWater } from "./water";

export type WorkerRequest = { kind: "water"; request: WaterRequest };
export type WorkerMessage =
  | { type: "progress"; progress: Progress }
  | { type: "done"; result: Awaited<ReturnType<typeof runWater>> }
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
  try {
    const result = await runWater(event.data.request, {
      progress: (progress) => post({ type: "progress", progress }),
      encode,
    });
    post({ type: "done", result });
  } catch (error) {
    const offline = error instanceof TypeError; // fetch reports network failure this way
    post({
      type: "error",
      message: offline
        ? "Satellite imagery could not be reached. Check your connection and try again."
        : error instanceof Error ? error.message : "Analysis could not be completed.",
    });
  }
};
