/** Sharing a browser analysis as a link, and opening such a link. */
import { useMemo } from "react";

import { type SharedRun, describeRun, encodeRun } from "../app/shareRun";
import { useStore } from "../app/store";
import type { AnalysisResult } from "../app/types";
import { PIXEL_BUDGET, type Quality, deviceProfile } from "../engine/client";
import { getGlobe } from "../globe/GlobeViewer";

/** The quality whose pixel budget a shared link asks for. */
function qualityFor(maxPixels: number): Quality {
  const match = (Object.entries(PIXEL_BUDGET) as [Quality, number][]).find(([, budget]) => budget === maxPixels);
  return match ? match[0] : "balanced";
}

export function shareRunUrl(result: AnalysisResult): string | null {
  const param = encodeRun(result);
  if (!param) return null;
  const view = getGlobe()?.cameraView();
  const camera = view ? `&lat=${view.lat.toFixed(4)}&lon=${view.lon.toFixed(4)}&h=${Math.round(view.height)}` : "";
  return `${window.location.origin}${window.location.pathname}?run=${param}${camera}`;
}

export function ShareRunButton({ result }: { result: AnalysisResult }) {
  const set = useStore((s) => s.set);
  const url = useMemo(() => shareRunUrl(result), [result]);
  if (!url) {
    return <span className="muted">{result.type === "classify"
      ? "A classification needs your sample file, so it cannot travel in a link; export the record instead."
      : "This outline is too detailed to fit in a link; export the record instead."}</span>;
  }
  return (
    <button className="link" onClick={() => {
      window.history.replaceState(null, "", url);
      void navigator.clipboard?.writeText(url).then(
        () => set({ notice: "Link copied. Opening it runs the same analysis on the other person's device." }),
        () => set({ notice: "The link is now in the address bar. Opening it runs the same analysis again." }),
      );
    }}>
      Share as a link
    </button>
  );
}

/** Confirmation before a shared link starts downloading imagery on this device. */
export function SharedRunCard() {
  const run = useStore((s) => s.pendingRun);
  const set = useStore((s) => s.set);
  const device = useMemo(deviceProfile, []);
  if (!run) return null;

  function start(shared: SharedRun) {
    const store = useStore.getState();
    const quality = qualityFor(shared.maxPixels);
    store.set({ pendingRun: null, introOpen: false });
    store.setAoi({ geometry: shared.request.aoi, label: shared.request.label ?? "Shared area" });
    const request = shared.request as never;
    const burn = (shared.request as { index?: string }).index === "nbr";
    if (shared.kind === "change" && burn) void store.runFire(request, device, quality);
    else if (shared.kind === "change") void store.runChange(request, device, quality);
    else if (shared.kind === "flood") void store.runFlood(request, device, quality);
    else if (shared.kind === "timeseries") void store.runTimeSeries(request, device, quality);
    else if (shared.kind === "heat") void store.runHeat(request, device, quality);
    else if (shared.kind === "disturbance") void store.runDisturbance(request, device, quality);
    else if (shared.kind === "urban") void store.runUrban({ ...(shared.request as object), maxPixels: shared.maxPixels, concurrency: device.concurrency } as never, device);
    else void store.runWater({ ...(shared.request as object), maxPixels: shared.maxPixels, concurrency: device.concurrency } as never, device);
  }

  return (
    <div className="area-prompt" role="dialog" aria-modal="false" aria-labelledby="shared-run-title">
      <p className="eyebrow">{run.fromNews !== undefined ? "Check the news from space" : run.fromRecent ? "Run again" : "Shared analysis"}</p>
      <h2 id="shared-run-title">{run.request.label ?? "Shared area"}</h2>
      <p>{describeRun(run)}.</p>
      <p className="muted">
        {run.fromNews !== undefined
          ? `Proposed from the story "${run.fromNews}". The area outlined on the globe is a box around the place the story names; draw your own in the panel if the event was elsewhere. `
          : run.fromRecent ? "From your recent analyses, with the same area, dates and settings. " : "Someone shared the recipe for this analysis. "}
        Running it downloads the satellite scenes to this device and computes the result here, at the{" "}
        {qualityFor(run.maxPixels)} setting. Nothing is sent to EarthPulse.
      </p>
      <div className="actions">
        <button className="primary" onClick={() => start(run)}>Run it on this device</button>
        <button onClick={() => set({ pendingRun: null })}>Not now</button>
      </div>
    </div>
  );
}
