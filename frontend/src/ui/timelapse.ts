/**
 * A time-lapse video of the current view: the year layer is stepped through
 * the years, each frame is taken only once that year's imagery is complete,
 * stamped with the year and title, and recorded with the browser's own
 * MediaRecorder (MP4 where supported, else WebM). Recording is paused while
 * each year loads, so the video has no waiting in it.
 */
import { downloadBlob } from "../analysis/download";
import { datasetForYear, FIRST_YEAR, formatLatLon, pickYears, SENTINEL2_FIRST_YEAR } from "../app/logic";
import { useStore } from "../app/store";
import { getGlobe } from "../globe/GlobeViewer";

const HOLD_MS = 700;
const FPS = 30;

export function videoType(): { mime: string; ext: string } | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const [mime, ext] of [["video/mp4;codecs=avc1", "mp4"], ["video/mp4", "mp4"], ["video/webm;codecs=vp9", "webm"], ["video/webm", "webm"]] as const) {
    if (MediaRecorder.isTypeSupported(mime)) return { mime, ext };
  }
  return null;
}

let running: AbortController | null = null;
export const stopTimelapse = () => running?.abort();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("A frame could not be read."));
  img.src = src;
});

export async function startTimelapse(): Promise<void> {
  const s = useStore.getState();
  const globe = getGlobe();
  const type = videoType();
  if (!globe || running) return;
  if (!type) { s.set({ notice: "This browser cannot record video. Try Chrome, Edge or Firefox." }); return; }
  if (globe.cameraView().height > 1_500_000) { s.set({ notice: "Zoom in to a region first: the satellite year layer appears from regional zoom." }); return; }

  const sentinel = s.preferredDataset === "sentinel2";
  const lastYear = new Date().getUTCFullYear() - 1;
  const years = pickYears(sentinel ? SENTINEL2_FIRST_YEAR + 1 : FIRST_YEAR + 1, lastYear);
  const view = globe.cameraView();
  const title = s.aoi?.label ?? s.district?.name ?? formatLatLon(view.lat, view.lon);
  const startYear = s.year;
  const wasVisible = s.imageryVisible;
  running = new AbortController();
  const { signal } = running;
  s.set({ imageryVisible: true, timelapse: { done: 0, total: years.length, year: years[0]! } });

  const first = globe.snapshot(1);
  const scale = Math.min(1, 1280 / first.width);
  const out = Object.assign(document.createElement("canvas"), { width: Math.round((first.width * scale) / 2) * 2, height: Math.round((first.height * scale) / 2) * 2 });
  const ctx = out.getContext("2d")!;
  const k = out.width / 1280;
  const stream = out.captureStream(FPS);
  const recorder = new MediaRecorder(stream, { mimeType: type.mime, videoBitsPerSecond: 8_000_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const stopped = new Promise<void>((r) => { recorder.onstop = () => r(); });

  const draw = (img: HTMLImageElement, year: number, progress: number) => {
    ctx.drawImage(img, 0, 0, out.width, out.height);
    ctx.fillStyle = "rgba(20,18,14,0.78)";
    ctx.fillRect(18 * k, 18 * k, 300 * k, 104 * k);
    ctx.fillStyle = "#ede6d8";
    ctx.font = `700 ${56 * k}px Helvetica, Arial, sans-serif`;
    ctx.fillText(String(year), 34 * k, 78 * k);
    ctx.font = `${17 * k}px Helvetica, Arial, sans-serif`;
    ctx.fillStyle = "#c9c0ae";
    ctx.fillText(title.slice(0, 32), 36 * k, 106 * k);
    const credit = `${datasetForYear(s.preferredDataset, year) === "sentinel2" ? "Sentinel-2 (ESA)" : "Landsat (USGS, NASA)"} via Microsoft Planetary Computer · Made with EarthPulse`;
    ctx.font = `${14 * k}px Helvetica, Arial, sans-serif`;
    const w = ctx.measureText(credit).width;
    ctx.fillStyle = "rgba(20,18,14,0.78)";
    ctx.fillRect(18 * k, out.height - 44 * k, w + 24 * k, 28 * k);
    ctx.fillStyle = "#ede6d8";
    ctx.fillText(credit, 30 * k, out.height - 25 * k);
    // A thin bar for how far through the years the video is.
    ctx.fillStyle = "#a3b18a";
    ctx.fillRect(0, out.height - 5 * k, out.width * progress, 5 * k);
  };

  try {
    recorder.start();
    recorder.pause();
    for (const [i, year] of years.entries()) {
      if (signal.aborted) break;
      useStore.getState().set({ timelapse: { done: i, total: years.length, year } });
      const version = globe.primaryVersion;
      const changed = useStore.getState().year !== year;
      useStore.getState().setYear(year);
      // The year's mosaic is looked up before its layer appears; wait for that layer, then for its tiles.
      if (changed) await globe.newPrimary(version, 30_000, signal);
      await globe.settled(800, 25_000, signal);
      if (signal.aborted) break;
      const img = await loadImage(globe.snapshot(1).image);
      draw(img, year, i / Math.max(1, years.length - 1));
      recorder.resume();
      // Frames are only recorded when the picture changes, so it is redrawn throughout the hold.
      const until = performance.now() + (i === years.length - 1 ? HOLD_MS * 2.5 : HOLD_MS);
      while (performance.now() < until && !signal.aborted) {
        draw(img, year, (i + (1 - (until - performance.now()) / HOLD_MS) * 0.999) / Math.max(1, years.length - 1));
        await sleep(1000 / FPS);
      }
      recorder.pause();
    }
    recorder.stop();
    await stopped;
    if (!signal.aborted && chunks.length) {
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
      downloadBlob(`earthpulse-timelapse-${slug}-${years[0]}-${years.at(-1)}.${type.ext}`, new Blob(chunks, { type: type.mime.split(";")[0] }));
      useStore.getState().set({ notice: `Time-lapse saved: ${years.length} years, ${years[0]} to ${years.at(-1)}.` });
    }
  } catch {
    useStore.getState().set({ notice: "The time-lapse could not be recorded." });
  } finally {
    stream.getTracks().forEach((t) => t.stop());
    running = null;
    useStore.getState().set({ timelapse: null, imageryVisible: wasVisible });
    useStore.getState().setYear(startYear);
  }
}
