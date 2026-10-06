/** Things that sit above the globe for a moment: the opening, story captions, notices, the sources sheet. */
import { useEffect, useRef } from "react";

import { HOSTED } from "../app/api";
import { useStore } from "../app/store";
import { STORED_ANALYSIS, STORED_FLOOD } from "../demo/stored";
import { exploreEvidence, startLahoreTour, stopTour } from "../demo/lahore";

const NOTICE_SECONDS = 6;

export function Intro() {
  const open = useStore((s) => s.introOpen);
  const set = useStore((s) => s.set);
  const loadAnalysis = useStore((s) => s.loadAnalysis);
  if (!open) return null;
  return (
    <div className="intro" role="dialog" aria-modal="false" aria-labelledby="intro-title">
      <p className="eyebrow">Open satellite archives · reproducible analysis</p>
      <h1 id="intro-title">See what is changing on Earth.</h1>
      <p className="lede">
        Pick a place and two dates. EarthPulse reads the Landsat and Sentinel-2 scenes, measures the
        change, and shows the evidence behind every number.
      </p>
      <div className="cards">
        <button onClick={() => void startLahoreTour()}>
          <strong>Lahore, 1993 to today</strong>
          <span>A guided look at three decades of Landsat imagery over one district.</span>
        </button>
        <button onClick={() => set({ introOpen: false, mode: "explore" })}>
          <strong>Explore Earth</strong>
          <span>Move through 40 years of imagery with the timeline. Zoom to a region to load it.</span>
        </button>
        <button onClick={() => {
          set({ introOpen: false, mode: "floods" });
          if (HOSTED) void loadAnalysis(STORED_FLOOD.id);
        }}>
          <strong>Map a flood</strong>
          <span>
            {HOSTED
              ? `${STORED_FLOOD.title}: flood extent from Sentinel-1 radar, which sees through cloud.`
              : "Flood extent from Sentinel-1 radar, which sees through cloud, with the land it covered."}
          </span>
        </button>
        <button onClick={() => set({ introOpen: false, mode: "water" })}>
          <strong>Track surface water</strong>
          <span>Choose a lake, reservoir or river reach and map its water year by year. Runs on your own computer.</span>
        </button>
        {HOSTED ? (
          <button onClick={() => { set({ introOpen: false, mode: "change" }); void loadAnalysis(STORED_ANALYSIS.id); }}>
            <strong>See a real analysis</strong>
            <span>{STORED_ANALYSIS.title}: where the vegetation index fell and rose, with the scenes behind it.</span>
          </button>
        ) : (
          <button onClick={() => set({ introOpen: false, mode: "change" })}>
            <strong>Analyse an area</strong>
            <span>Draw an area and measure vegetation, water or built-up change between two years.</span>
          </button>
        )}
      </div>
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
