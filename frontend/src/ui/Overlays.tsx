/** Things that sit above the globe for a moment: the opening, story captions, notices, the sources sheet. */
import { ElevationProfile } from "../area/ElevationProfile";
import { useEffect, useRef, useState } from "react";

import { HOSTED } from "../app/api";
import { useStore } from "../app/store";
import { enclosedKm2, formatKm, formatKm2, pathKm } from "../area/measure";
import { STORED_ANALYSIS, STORED_FLOOD } from "../demo/stored";
import { exploreEvidence, startLahoreTour, stopTour } from "../demo/lahore";
import { AnalysisList } from "./TopBar";
import { useT } from "../i18n";

const NOTICE_SECONDS = 6;

/**
 * What people come with, in their words, and who they are. Each opens Sentri
 * with the question written out and "[place]" selected to type over, except
 * "what is happening now", which needs no place.
 */
const PROBLEMS: { icon: string; who: string; question: string; answer: string; draft?: string }[] = [
  { icon: "🏡", who: "Land buyers, farmers, builders", question: "Is this land safe to build on or buy?", answer: "Flooding since 1984, landslide-prone slopes, the week ahead and the nearest higher ground.", draft: "Is [place] safe? Risk check" },
  { icon: "🌊", who: "Disaster and aid teams", question: "Where did the flood reach, and who lives there?", answer: "A Sentinel-1 radar flood map that sees through cloud, with people affected.", draft: "Map the floods in [place] from [start date] to [end date]" },
  { icon: "🔴", who: "Everyone", question: "What is happening right now?", answer: "Today's floods, fires, storms and earthquakes, checked against the agencies." },
  { icon: "🌤️", who: "Families, farmers, health workers", question: "Is the coming week safe?", answer: "Heavy rain, heat, frost, gales and unhealthy air in the next 7 days, and the cleanest hours.", draft: "What is the weather outlook for [place]?" },
  { icon: "🌳", who: "Climate and forestry projects", question: "How much carbon does this land hold?", answer: "Carbon in plants and soil, with uncertainty, and a chart ready for a report.", draft: "Carbon stock of [place]" },
  { icon: "🏙️", who: "Planners and journalists", question: "How has this place changed?", answer: "A time-lapse video since 1985, city growth, lost trees and shrinking water.", draft: "Make a time-lapse of [place]" },
  { icon: "🗺️", who: "Students and researchers", question: "I need maps and figures for my report", answer: "Land cover, slope and terrain maps, with charts as SVG or 300 dpi PNG.", draft: "Land cover of [place]" },
  { icon: "📐", who: "GIS users", question: "Buffer, terrain, export to QGIS", answer: "Buffers, hillshade, slope and aspect, area and perimeter, GeoJSON and KML.", draft: "Buffer 5 km around [place]" },
];

export function Intro() {
  const open = useStore((s) => s.introOpen);
  const set = useStore((s) => s.set);
  const loadAnalysis = useStore((s) => s.loadAnalysis);
  const [step, setStep] = useState<"start" | "analyse">("start");
  const t = useT();
  if (!open) return null;
  const close = () => { setStep("start"); set({ introOpen: false, mode: "explore" }); };
  const askSentri = (text: string, send: boolean) => set({ introOpen: false, agentOpen: true, agentDraft: { text, send } });
  return (
    <div className="intro" role="dialog" aria-modal="false" aria-labelledby="intro-title">
      <button className="ghost intro-close" onClick={close} aria-label="Close and explore the globe">×</button>
      <p className="eyebrow">{t("intro.eyebrow")}</p>
      <h1 id="intro-title">{t("intro.title")}</h1>
      {step === "start" ? (
        <>
          <form className="intro-ask" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get("q"); if (typeof q === "string" && q.trim()) askSentri(q.trim(), true); }}>
            <input name="q" type="text" placeholder="Ask in plain words: has Nowshera flooded before?" aria-label="Ask a question about any place" autoComplete="off" />
            <button type="submit">Ask</button>
          </form>
          <p className="lede">Or start from what you need to know:</p>
          <div className="problems">
            {PROBLEMS.map((p) => (
              <button key={p.question} className={p.draft ? "" : "now"}
                onClick={() => (p.draft ? askSentri(p.draft, false) : set({ introOpen: false, mode: "live", liveTab: "news" }))}>
                <span className="who"><span aria-hidden="true">{p.icon}</span> {p.who}</span>
                <strong>{p.question}</strong>
                <span className="answer">{p.answer}</span>
              </button>
            ))}
          </div>
          <p className="examples">
            <button className="link" onClick={close}>Just explore the globe since 1984</button>
            {" · "}
            <button className="link" onClick={() => setStep("analyse")}>Choose an analysis yourself</button>
          </p>
          <p className="examples">
            {t("intro.examples")}{" "}
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
          <p className="lede">{t("intro.pick")}</p>
          <AnalysisList onPick={(id) => { setStep("start"); set({ introOpen: false, mode: id }); }} />
          <button className="link" onClick={() => setStep("start")}>{t("intro.back")}</button>
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
      <div className="row">
        <h2 id="sources-title">Data sources</h2>
        <button className="ghost" onClick={() => set({ sourcesOpen: false })}>Close</button>
      </div>
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
  const sampleClass = useStore((s) => s.sampleClass);
  const set = useStore((s) => s.set);
  const [profileOf, setProfileOf] = useState<[number, number][] | null>(null);
  if (tool === "measure" || measure.length > 0) {
    const area = enclosedKm2(measure);
    return (
      <div className="notice tool-hint measure" role="status">
        {measure.length < 2
          ? "Click points on the globe to measure. Double-click or Enter to finish, Esc to clear."
          : <>Distance <strong>{formatKm(pathKm(measure))}</strong>{area !== null && <> · enclosed area <strong>{formatKm2(area)}</strong></>}
            {tool === "measure" ? " · double-click or Enter to finish" : ""}</>}
        {" "}<button className="link" onClick={() => { set({ measure: [], drawTool: "none" }); setProfileOf(null); }}>Clear</button>
        {tool !== "measure" && measure.length >= 2 && (profileOf === measure
          ? <ElevationProfile points={measure} />
          : <>{" · "}<button className="link" onClick={() => setProfileOf(measure)}>Show elevation profile</button></>)}
      </div>
    );
  }
  if (tool === "sample") {
    return <div className="notice tool-hint" role="status">Click the globe to add a &quot;{sampleClass}&quot; training point. Esc stops.</div>;
  }
  if (tool !== "point") return null;
  return <div className="notice tool-hint" role="status">Click a spot on the globe to analyse the {size} km around it. Esc cancels.</div>;
}
