import { useEffect } from "react";

import { AreaPrompt } from "./analysis/AreaPrompt";
import { SharedRunCard } from "./analysis/SharedRun";
import { ContextPanel } from "./analysis/ContextPanel";
import { decodeView } from "./app/logic";
import { decodeRun } from "./app/shareRun";
import { useStore } from "./app/store";
import { SwipeHandle } from "./compare/SwipeHandle";
import { GlobeViewer, getGlobe } from "./globe/GlobeViewer";
import { LayerPanel } from "./layers/LayerPanel";
import { Timeline } from "./timeline/Timeline";
import { DataSources, Intro, Notice, StoryCaption, ToolHint } from "./ui/Overlays";
import { ShortcutsCard, useShortcuts } from "./ui/Shortcuts";
import { TopBar } from "./ui/TopBar";

/** Restore a shared view or analysis from the address bar. */
function restoreFromUrl() {
  const view = decodeView(window.location.search);
  const store = useStore.getState();
  const hasRun = new URLSearchParams(window.location.search).has("run");
  if (Object.keys(view).length === 0 && !hasRun) return;
  store.set({
    introOpen: false,
    ...(view.render ? { render: view.render } : {}),
    ...(view.dataset ? { preferredDataset: view.dataset } : {}),
  });
  if (view.year !== undefined) store.setYear(view.year);
  if (view.compareYear !== undefined && view.compareYear !== null) {
    store.setCompare({ enabled: true, year: view.compareYear });
  }
  if (view.lat !== undefined && view.lon !== undefined) {
    void getGlobe()?.flyTo(view.lon, view.lat, view.height ?? 150_000, 0);
  }
  if (view.analysis) void store.loadAnalysis(view.analysis);
  // A shared browser analysis is shown for confirmation; it never starts on its own.
  const run = decodeRun(new URLSearchParams(window.location.search).get("run"));
  if (run) store.set({ pendingRun: run, introOpen: false, mode: run.kind === "flood" ? "floods" : run.kind === "urban" ? ((run.request as { focus?: number }).focus === 2 ? "forests" : "cities") : (run.request as { index?: string }).index === "nbr" ? "fires" : run.kind });
}

export function App() {
  useShortcuts();
  useEffect(() => {
    void useStore.getState().loadCatalog();
    restoreFromUrl();
  }, []);

  return (
    <div className="app">
      <a className="skip" href="#timeline">Skip to timeline</a>
      <GlobeViewer />
      <div className="grid-overlay" aria-hidden="true" />
      <TopBar />
      <LayerPanel />
      <ContextPanel />
      <SwipeHandle />
      <Intro />
      <AreaPrompt />
      <SharedRunCard />
      <StoryCaption />
      <Notice />
      <ToolHint />
      <div id="timeline"><Timeline /></div>
      <DataSources />
      <ShortcutsCard />
    </div>
  );
}
