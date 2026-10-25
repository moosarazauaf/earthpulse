/** Mounts the globe and keeps it in step with application state. */
import "cesium/Build/Cesium/Widgets/widgets.css";

import { useEffect, useMemo, useRef } from "react";

import { ApiError, api } from "../app/api";
import { datasetForYear } from "../app/logic";
import { useStore } from "../app/store";
import { type Detection, type ImageryLayerInfo, type LayeredResult, type MappedResult, type Overlay, hasLayers, isMapped } from "../app/types";
import { newsMarkers } from "../news/corroborate";
import { Drawing } from "./Drawing";
import { Globe, geometryBounds } from "./Globe";

/** Blink comparison rate. Slow enough to be comfortable, fast enough to compare. */
const BLINK_INTERVAL_MS = 900;

let instance: Globe | null = null;
/** Imperative access for actions such as "fly to this search result". */
export const getGlobe = () => instance;

async function fetchLayer(dataset: "landsat" | "sentinel2", year: number, render: ImageryLayerInfo["render"]) {
  try {
    return await api.layer(datasetForYear(dataset, year), year, render);
  } catch (error) {
    useStore.getState().set({
      notice: error instanceof ApiError ? [error.message, error.hint].filter(Boolean).join(" ") : null,
    });
    return null;
  }
}

export function GlobeViewer() {
  const container = useRef<HTMLDivElement>(null);
  const drawing = useRef<Drawing | null>(null);
  const s = useStore();

  useEffect(() => {
    if (!container.current) return;
    const globe = new Globe(container.current);
    instance = globe;
    // Development-only handle for inspecting the scene from the browser console.
    if (import.meta.env.DEV) (window as unknown as { __earthpulse?: Globe }).__earthpulse = globe;
    drawing.current = new Drawing(
      globe,
      (geometry) => {
        const state = useStore.getState();
        state.setAoi({ geometry, label: "Drawn area" });
        // Outside an analysis, a drawn area opens its overview.
        if (state.mode === "explore" || state.mode === "live" || state.mode === "area") state.set({ mode: "area", result: null });
      },
      (id) => {
        const state = useStore.getState();
        if (id?.startsWith("alert:")) {
          state.set({ selectedAlert: state.alerts?.find((a) => `alert:${a.id}` === id) ?? null, mode: "live", liveTab: "alerts" });
          return;
        }
        if (id?.startsWith("news:")) {
          state.set({ selectedStory: state.news?.stories.find((n) => `news:${n.id}` === id) ?? null, mode: "live", liveTab: "news" });
          return;
        }
        const features = isMapped(state.result) ? state.result.detections.features : [];
        const found = id === null ? null : features.find((f) => String(f.id) === id) ?? null;
        state.set({ selectedDetection: found as Detection | null });
      },
      (lon, lat) => {
        const state = useStore.getState();
        if (state.drawTool === "sample") {
          const className = state.sampleClass.trim();
          if (className) state.set({ drawnSamples: [...state.drawnSamples, { lon, lat, className }] });
        }
        else state.analyseAt(lon, lat);
      },
      (points, done) => useStore.getState().set(done ? { measure: points, drawTool: "none" } : { measure: points }),
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drawing.current?.cancel();
        useStore.getState().set({ drawTool: "none", measure: [] });
      }
      if (event.key === "Enter") drawing.current?.finishPolygon();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      drawing.current?.destroy();
      globe.destroy();
      instance = null;
    };
  }, []);

  // Year imagery.
  useEffect(() => {
    let stale = false;
    if (!s.imageryVisible) {
      instance?.setPrimary(null, 0);
      s.set({ layerInfo: null });
      return;
    }
    void fetchLayer(s.preferredDataset, s.year, s.render).then((info) => {
      if (stale) return;
      instance?.setPrimary(info, useStore.getState().imageryOpacity);
      s.set({ layerInfo: info });
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s.year, s.preferredDataset, s.render, s.imageryVisible]);

  useEffect(() => instance?.setPrimaryAlpha(s.imageryOpacity), [s.imageryOpacity]);
  useEffect(() => instance?.setLabels(s.labelsVisible), [s.labelsVisible]);

  // Comparison imagery.
  const { enabled, year: compareYear, mode, position, blinkOn } = s.compare;
  useEffect(() => {
    let stale = false;
    if (!enabled) {
      instance?.setSecondary(null);
      s.set({ compareInfo: null });
      return;
    }
    void fetchLayer(s.preferredDataset, compareYear, s.render).then((info) => {
      if (stale) return;
      instance?.setSecondary(info);
      s.set({ compareInfo: info });
      const c = useStore.getState().compare;
      instance?.setCompare(c.mode, c.position, c.blinkOn, c.position);
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, compareYear, s.preferredDataset, s.render]);

  useEffect(() => {
    instance?.setCompare(enabled ? mode : "off", position, blinkOn, position);
  }, [enabled, mode, position, blinkOn]);

  useEffect(() => {
    if (!enabled || mode !== "blink") return;
    const timer = window.setInterval(() => {
      const c = useStore.getState().compare;
      useStore.getState().setCompare({ blinkOn: !c.blinkOn });
    }, BLINK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [enabled, mode]);

  // Area of interest and drawing.
  useEffect(() => {
    instance?.setAoi(s.aoi?.geometry ?? null);
    if (s.aoi) void instance?.flyToBounds(geometryBounds(s.aoi.geometry));
  }, [s.aoi]);
  useEffect(() => drawing.current?.setTool(s.drawTool), [s.drawTool]);
  useEffect(() => instance?.setMeasure(s.measure), [s.measure]);

  // Live hazards: layers and alert markers are shown only in Live mode.
  const live = s.mode === "live";
  useEffect(() => instance?.setHazardLayers(live ? s.hazardLayers : []), [live, s.hazardLayers]);
  useEffect(() => instance?.setAlerts(live ? s.alerts ?? [] : [], s.selectedAlert?.id ?? null), [live, s.alerts, s.selectedAlert]);
  useEffect(() => instance?.setQuakes(live && s.quakesOn ? s.quakes ?? [] : []), [live, s.quakesOn, s.quakes]);
  useEffect(() => {
    // Far enough out to see the region the event affects.
    if (s.selectedAlert) void instance?.flyTo(s.selectedAlert.lon, s.selectedAlert.lat, 2_500_000, 2);
  }, [s.selectedAlert]);
  const markers = useMemo(() => newsMarkers(s.news?.stories ?? [], s.quakes, s.alerts), [s.news, s.quakes, s.alerts]);
  useEffect(() => instance?.setNews(live ? markers : [], s.selectedStory?.id ?? null), [live, markers, s.selectedStory]);
  const flownTo = useRef<string | null>(null);
  useEffect(() => {
    // Fly once per selection, not again when late-arriving feeds move the marker.
    const marker = markers.find((m) => m.id === s.selectedStory?.id);
    if (!marker || flownTo.current === marker.id) return;
    flownTo.current = marker.id;
    void instance?.flyTo(marker.lon, marker.lat, marker.exact ? 900_000 : 3_000_000, 2);
  }, [s.selectedStory, markers]);
  useEffect(() => { if (!s.selectedStory) flownTo.current = null; }, [s.selectedStory]);

  // Analysis outputs.
  const mapped: MappedResult | null = isMapped(s.result) ? s.result : null;
  const layered: LayeredResult | null = hasLayers(s.result) ? s.result : null;
  useEffect(() => {
    const overlays: Record<string, Overlay> | null = layered?.overlays ?? null;
    const coverShown = s.mode === "area" && s.showCover && s.areaCover ? s.areaCover.overlay : null;
    const overlay = coverShown ?? (overlays && s.overlay.key ? overlays[s.overlay.key] ?? null : null);
    void instance?.setOverlay(overlay, s.overlay.opacity);
  }, [layered, s.overlay.key, s.overlay.opacity, s.mode, s.showCover, s.areaCover]);
  useEffect(() => {
    void instance?.setDetections(mapped, s.overlay.detections);
  }, [mapped, s.overlay.detections]);
  useEffect(() => {
    instance?.highlightDetection(s.selectedDetection);
    if (s.selectedDetection) {
      const [lon, lat] = s.selectedDetection.properties.centroid;
      // Frame the region: height scales with its footprint.
      const height = Math.max(2500, Math.sqrt(s.selectedDetection.properties.areaHa * 10_000) * 6);
      void instance?.flyTo(lon, lat, height, 1.5);
    }
  }, [s.selectedDetection]);

  return (
    <div
      ref={container}
      className="globe"
      role="application"
      aria-label="Interactive 3D globe. Use the search box and layer controls for keyboard access."
    />
  );
}
