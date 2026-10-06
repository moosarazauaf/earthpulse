/** Left panel: what is drawn on the globe, and where it comes from. */
import { useState } from "react";

import { LegendBar } from "../analysis/charts";
import { SENTINEL2_FIRST_YEAR, datasetForYear } from "../app/logic";
import { type OverlayKey, useStore } from "../app/store";
import type { RenderId } from "../app/types";
import { KindBadge } from "../ui/KindBadge";

const RENDER_OPTIONS: { id: RenderId; label: string; hint: string }[] = [
  { id: "truecolor", label: "True colour", hint: "Red, green, blue" },
  { id: "falsecolor", label: "False colour", hint: "Near-infrared, red, green. Vegetation appears red" },
  { id: "ndvi", label: "NDVI", hint: "Vegetation" },
  { id: "ndwi", label: "NDWI", hint: "Open water" },
  { id: "mndwi", label: "MNDWI", hint: "Open water, built-up suppressed" },
  { id: "ndbi", label: "NDBI", hint: "Built-up and bare surfaces" },
];
const OVERLAYS: { key: OverlayKey; label: string }[] = [
  { key: "change", label: "Change" },
  { key: "before", label: "Before" },
  { key: "after", label: "After" },
];

export function LayerPanel() {
  const s = useStore();
  const [open, setOpen] = useState(true);
  const dataset = datasetForYear(s.preferredDataset, s.year);
  const sentinelBlocked = s.preferredDataset === "sentinel2" && dataset === "landsat";
  const change = s.result?.type === "change" ? s.result : null;

  return (
    <aside className={`panel left${open ? "" : " collapsed"}`} aria-label="Layers">
      <button className="panel-toggle" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span>Layers</span><span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open && (
        <div className="panel-body">
          <section>
            <header className="row">
              <label className="check">
                <input type="checkbox" checked={s.imageryVisible}
                  onChange={(e) => s.set({ imageryVisible: e.target.checked })} />
                <span>Satellite year layer</span>
              </label>
              {s.layerInfo && <KindBadge kind={s.layerInfo.valueKind} />}
            </header>
            <div className="seg" role="radiogroup" aria-label="Satellite archive">
              {(["landsat", "sentinel2"] as const).map((id) => (
                <button key={id} role="radio" aria-checked={s.preferredDataset === id}
                  className={s.preferredDataset === id ? "on" : ""}
                  onClick={() => s.set({ preferredDataset: id })}>
                  {id === "landsat" ? "Landsat · 30 m" : "Sentinel-2 · 10 m"}
                </button>
              ))}
            </div>
            {sentinelBlocked && (
              <p className="note">
                Sentinel-2 starts in {SENTINEL2_FIRST_YEAR}. Showing Landsat for {s.year}.
              </p>
            )}
            <div className="options" role="radiogroup" aria-label="Rendering">
              {RENDER_OPTIONS.map((option) => (
                <button key={option.id} role="radio" aria-checked={s.render === option.id} title={option.hint}
                  className={s.render === option.id ? "on" : ""} onClick={() => s.set({ render: option.id })}>
                  {option.label}
                </button>
              ))}
            </div>
            <label className="slider">
              <span>Opacity</span>
              <input type="range" min={0} max={1} step={0.05} value={s.imageryOpacity}
                onChange={(e) => s.set({ imageryOpacity: Number(e.target.value) })} />
            </label>
            {s.layerInfo && (
              <div className="layer-meta">
                <strong>{s.layerInfo.title}</strong>
                <p>{s.layerInfo.description}</p>
                {s.layerInfo.legend && <LegendBar {...s.layerInfo.legend} label={s.layerInfo.render.toUpperCase()} />}
                <p className="muted">{s.layerInfo.compositing}</p>
                {s.layerInfo.note && <p className="note">{s.layerInfo.note}</p>}
                <p className="muted">
                  Visible from regional zoom (level {s.layerInfo.minZoom}) inward.{" "}
                  {s.layerInfo.dataset.provider}, {s.layerInfo.dataset.processing_level}.
                </p>
              </div>
            )}
          </section>

          {change && (
            <section>
              <header className="row"><h3>Analysis result</h3><KindBadge kind={change.valueKind} /></header>
              <div className="seg" role="radiogroup" aria-label="Result layer">
                {OVERLAYS.map((o) => (
                  <button key={o.key} role="radio" aria-checked={s.overlay.key === o.key}
                    className={s.overlay.key === o.key ? "on" : ""}
                    onClick={() => s.setOverlay({ key: s.overlay.key === o.key ? null : o.key })}>
                    {o.label}
                  </button>
                ))}
              </div>
              {s.overlay.key && (
                <>
                  <LegendBar {...change.overlays[s.overlay.key].legend} label={change.overlays[s.overlay.key].title} />
                  <label className="slider">
                    <span>Opacity</span>
                    <input type="range" min={0} max={1} step={0.05} value={s.overlay.opacity}
                      onChange={(e) => s.setOverlay({ opacity: Number(e.target.value) })} />
                  </label>
                </>
              )}
              <label className="check">
                <input type="checkbox" checked={s.overlay.detections}
                  onChange={(e) => s.setOverlay({ detections: e.target.checked })} />
                <span>Detected regions <i className="swatch loss" aria-hidden="true" /> decrease{" "}
                  <i className="swatch gain" aria-hidden="true" /> increase</span>
              </label>
            </section>
          )}

          <section>
            <label className="check">
              <input type="checkbox" checked={s.labelsVisible} onChange={(e) => s.set({ labelsVisible: e.target.checked })} />
              <span>Place names and boundaries</span>
            </label>
            <button className="link" onClick={() => s.set({ sourcesOpen: true })}>Data sources</button>
          </section>
        </div>
      )}
    </aside>
  );
}
