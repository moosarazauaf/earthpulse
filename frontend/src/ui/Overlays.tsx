/** Things that sit above the globe for a moment: the opening, story captions, notices, the sources sheet. */
import { useEffect, useRef, useState } from "react";

import { HOSTED } from "../app/api";
import { useStore } from "../app/store";
import { enclosedKm2, formatKm, formatKm2, pathKm } from "../area/measure";
import { STORED_ANALYSIS, STORED_FLOOD } from "../demo/stored";
import { exploreEvidence, startLahoreTour, stopTour } from "../demo/lahore";
import { AnalysisList } from "./TopBar";

const NOTICE_SECONDS = 6;

export function Intro() {
  const open = useStore((s) => s.introOpen);
  const set = useStore((s) => s.set);
  const loadAnalysis = useStore((s) => s.loadAnalysis);
  const [step, setStep] = useState<"start" | "analyse">("start");
  if (!open) return null;
  const close = () => { setStep("start"); set({ introOpen: false, mode: "explore" }); };
  return (
    <div className="intro" role="dialog" aria-modal="false" aria-labelledby="intro-title">
      <button className="ghost intro-close" onClick={close} aria-label="Close and explore the globe">×</button>
      <p className="eyebrow">Open satellite archives · live hazards · reproducible analysis</p>
      <h1 id="intro-title">See what is changing on Earth.</h1>
      {step === "start" ? (
        <>
          <div className="cards three">
            <button className="lead" onClick={() => set({ introOpen: false, mode: "live", liveTab: "news" })}>
              <strong>What is happening now</strong>
              <span>Earthquakes, floods, storms and fires in today&apos;s news, on the globe, with how each one happened.</span>
            </button>
            <button onClick={close}>
              <strong>Explore 40 years of Earth</strong>
              <span>Move through Landsat and Sentinel-2 imagery since 1984 and compare any two years.</span>
            </button>
            <button onClick={() => setStep("analyse")}>
              <strong>Measure a place</strong>
              <span>Floods, burn scars, lakes, city growth or vegetation change for an area you choose.</span>
            </button>
          </div>
          <p className="examples">
            Or start from an example:{" "}
            <button className="link" onClick={() => void startLahoreTour()}>Lahore, 1993 to today</button>
            {HOSTED && (
              <>
                {" · "}
                <button className="link" onClick={() => { set({ introOpen: false, mode: "floods" }); void loadAnalysis(STORED_FLOOD.id); }}>{STORED_FLOOD.title}</button>
                {" · "}
                <button className="link" onClick={() => { set({ introOpen: false, mode: "change" }); void loadAnalysis(STORED_ANALYSIS.id); }}>{STORED_ANALYSIS.title}</button>
              </>
            )}
          </p>
        </>
      ) : (
        <>
          <p className="lede">What do you want to measure? You will choose the area next; the analysis runs on your computer.</p>
          <AnalysisList onPick={(id) => { setStep("start"); set({ introOpen: false, mode: id }); }} />
          <button className="link" onClick={() => setStep("start")}>← Back</button>
        </>
      )}
    </div>
  );
}

export function StoryCaption() {
  const story = useStore((s) => s.story);
  if (!story) return null;
  return (
    <div className="story" role="status" aria-live="polite">
      <span className="eyebrow">{story.title}</span>
      <p>{story.caption}</p>
      <div className="actions">
        {story.done && <button className="primary" onClick={exploreEvidence}>Explore the evidence</button>}
        <button onClick={stopTour}>{story.done ? "Close" : "Skip tour"}</button>
      </div>
    </div>
  );
}

export function Notice() {
  const notice = useStore((s) => s.notice);
  const set = useStore((s) => s.set);
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => set({ notice: null }), NOTICE_SECONDS * 1000);
    return () => window.clearTimeout(timer);
  }, [notice, set]);
  if (!notice) return null;
  return <div className="notice" role="status">{notice}</div>;
}

export function DataSources() {
  const open = useStore((s) => s.sourcesOpen);
  const catalog = useStore((s) => s.catalog);
  const set = useStore((s) => s.set);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  return (
    <dialog ref={dialog} className="sheet" aria-labelledby="sources-title" onClose={() => set({ sourcesOpen: false })}>
      <header className="row">
        <h2 id="sources-title">Data sources</h2>
        <button className="ghost" onClick={() => set({ sourcesOpen: false })}>Close</button>
      </header>
      {!catalog && <p className="note">The catalogue could not be loaded from the analysis service.</p>}
      {catalog?.datasets.map((d) => (
        <section key={d.id}>
          <h3>{d.name}</h3>
          <dl className="facts">
            <div><dt>Provider</dt><dd>{d.provider}</dd></div>
            <div><dt>Processing level</dt><dd>{d.processing_level}</dd></div>
            <div><dt>Resolution</dt><dd>{d.resolution_m} m</dd></div>
            <div><dt>Temporal coverage</dt><dd>{d.temporal_coverage}</dd></div>
            <div><dt>License</dt><dd>{d.license}</dd></div>
            <div><dt>Attribution</dt><dd>{d.attribution}</dd></div>
            <div><dt>Accessed</dt><dd>{d.access_date}</dd></div>
            <div><dt>Reference</dt><dd><a href={d.reference_url} target="_blank" rel="noreferrer">{d.reference_url}</a></dd></div>
          </dl>
        </section>
      ))}
      {catalog && (
        <section>
          <h3>Access and processing</h3>
          <p>{catalog.processing.provider}. {catalog.processing.note}</p>
        </section>
      )}
      <section>
        <h3>Other layers</h3>
        <dl className="facts">
          <div><dt>Basemap and labels</dt><dd>Esri World Imagery and World Boundaries and Places. A mosaic of many dates; it is context, not evidence.</dd></div>
          <div><dt>Place search</dt><dd>OpenStreetMap Nominatim, © OpenStreetMap contributors (ODbL).</dd></div>
          <div><dt>Lahore District boundary</dt><dd>geoBoundaries gbOpen, PAK ADM2 (simplified), public domain, representing 2019.</dd></div>
        </dl>
      </section>
    </dialog>
  );
}

/** What to do while a globe tool is active, wherever the visitor is in the app. */
export function ToolHint() {
  const tool = useStore((s) => s.drawTool);
  const size = useStore((s) => s.pickSizeKm);
  const measure = useStore((s) => s.measure);
  const set = useStore((s) => s.set);
  if (tool === "measure" || measure.length > 0) {
    const area = enclosedKm2(measure);
    return (
      <div className="notice tool-hint measure" role="status">
        {measure.length < 2
          ? "Click points on the globe to measure. Double-click or Enter to finish, Esc to clear."
          : <>Distance <strong>{formatKm(pathKm(measure))}</strong>{area !== null && <> · enclosed area <strong>{formatKm2(area)}</strong></>}
            {tool === "measure" ? " · double-click or Enter to finish" : ""}</>}
        {" "}<button className="link" onClick={() => set({ measure: [], drawTool: "none" })}>Clear</button>
      </div>
    );
  }
  if (tool !== "point") return null;
  return <div className="notice tool-hint" role="status">Click a spot on the globe to analyse the {size} km around it. Esc cancels.</div>;
}
