/** Mounts the globe and keeps it in step with application state. */
import "cesium/Build/Cesium/Widgets/widgets.css";

import { useEffect, useRef } from "react";

import { ApiError, api } from "../app/api";
import { datasetForYear } from "../app/logic";
import { useStore } from "../app/store";
import type { ChangeResult, Detection, ImageryLayerInfo } from "../app/types";
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
      (geometry) => useStore.getState().setAoi({ geometry, label: "Drawn area" }),
      (id) => {
        const { result } = useStore.getState();
        const features = result?.type === "change" ? result.detections.features : [];
        const found = id === null ? null : features.find((f) => String(f.id) === id) ?? null;
        useStore.getState().set({ selectedDetection: found as Detection | null });
      },
    );
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        drawing.current?.cancel();
        useStore.getState().set({ drawTool: "none" });
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

  // Analysis outputs.
  const change: ChangeResult | null = s.result?.type === "change" ? s.result : null;
  useEffect(() => {
    const overlay = change && s.overlay.key ? change.overlays[s.overlay.key] : null;
    void instance?.setOverlay(overlay, s.overlay.opacity);
  }, [change, s.overlay.key, s.overlay.opacity]);
  useEffect(() => {
    void instance?.setDetections(change, s.overlay.detections);
  }, [change, s.overlay.detections]);
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
