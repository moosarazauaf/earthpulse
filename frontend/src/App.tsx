import { useEffect } from "react";

import { AreaPrompt } from "./analysis/AreaPrompt";
import { ContextPanel } from "./analysis/ContextPanel";
import { decodeView } from "./app/logic";
import { useStore } from "./app/store";
import { SwipeHandle } from "./compare/SwipeHandle";
import { GlobeViewer, getGlobe } from "./globe/GlobeViewer";
import { LayerPanel } from "./layers/LayerPanel";
import { Timeline } from "./timeline/Timeline";
import { DataSources, Intro, Notice, StoryCaption } from "./ui/Overlays";
import { TopBar } from "./ui/TopBar";

/** Restore a shared view or analysis from the address bar. */
function restoreFromUrl() {
  const view = decodeView(window.location.search);
  const store = useStore.getState();
  if (Object.keys(view).length === 0) return;
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
}

export function App() {
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
      <StoryCaption />
      <Notice />
      <div id="timeline"><Timeline /></div>
      <DataSources />
    </div>
  );
}
