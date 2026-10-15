/** Brand, mode navigation, place search and sharing. */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError, api } from "../app/api";
import { encodeView, parseCoordinates } from "../app/logic";
import { useStore } from "../app/store";
import type { Place } from "../app/types";
import { getGlobe } from "../globe/GlobeViewer";
import { ANALYSES, type AnalysisMode } from "./modes";

/** Three entries for a newcomer: what is happening, look around, measure something. */
const MODES = [
  { id: "live", label: "Live" },
  { id: "explore", label: "Explore" },
] as const;
/** Camera height after flying to typed coordinates: a district-sized view. */
const COORDINATE_VIEW_HEIGHT_M = 120_000;

/** The analyses, chosen by the question they answer. */
export function AnalysisList({ onPick }: { onPick: (id: AnalysisMode) => void }) {
  const mode = useStore((s) => s.mode);
  return (
    <ul className="analysis-list" role="menu">
      {ANALYSES.map((a) => (
        <li key={a.id} role="none">
          <button role="menuitem" className={mode === a.id ? "on" : ""} onClick={() => onPick(a.id)}>
            <strong>{a.question}</strong>
            <span>{a.label} · {a.detail}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AnalyseMenu() {
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const [left, setLeft] = useState(0);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const active = ANALYSES.find((a) => a.id === mode);

  useEffect(() => {
    if (!open) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.current?.contains(event.target as Node) && !button.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", close); };
  }, [open]);

  return (
    <>
      <button ref={button} className={active ? "on" : ""} aria-haspopup="menu" aria-expanded={open}
        onClick={() => { setLeft(button.current?.getBoundingClientRect().left ?? 0); setOpen(!open); }}>
        {active ? `Analyse: ${active.label}` : "Analyse"} <span aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div ref={menu} className="analyse-menu" style={{ left }}>
          <p className="eyebrow">What do you want to measure?</p>
          <AnalysisList onPick={(id) => { set({ mode: id }); setOpen(false); }} />
          <p className="muted">Each analysis asks for an area, then runs on your own computer.</p>
        </div>,
        document.body,
      )}
    </>
  );
}

export function shareUrl(): string {
  const s = useStore.getState();
  const view = getGlobe()?.cameraView() ?? { lat: 0, lon: 0, height: 2e7 };
  const query = encodeView({
    ...view,
    year: s.year,
    render: s.render,
    dataset: s.preferredDataset,
    compareYear: s.compare.enabled ? s.compare.year : null,
    analysis: s.result?.id ?? null,
  });
  return `${window.location.origin}${window.location.pathname}?${query}`;
}

export function TopBar() {
  const mode = useStore((s) => s.mode);
  const set = useStore((s) => s.set);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function search(event: FormEvent) {
    event.preventDefault();
    if (query.trim().length < 2) return;
    // Coordinates need no lookup: fly straight there.
    const point = parseCoordinates(query);
    if (point) {
      setPlaces(null);
      setMessage(null);
      void getGlobe()?.flyTo(point.lon, point.lat, COORDINATE_VIEW_HEIGHT_M);
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const { results } = await api.geocode(query.trim());
      setPlaces(results);
      if (results.length === 0) setMessage("No place found with that name.");
    } catch (error) {
      setMessage(error instanceof ApiError ? error.message : "Place search failed.");
    } finally {
      setBusy(false);
    }
  }

  function go(place: Place) {
    setPlaces(null);
    setQuery(place.name.split(",")[0] ?? place.name);
    void getGlobe()?.flyToBounds(place.bbox);
  }

  async function share() {
    const url = shareUrl();
    window.history.replaceState(null, "", url);
    try {
      await navigator.clipboard.writeText(url);
      set({ notice: "Link to this view copied to the clipboard." });
    } catch {
      set({ notice: "The link to this view is now in the address bar." });
    }
  }

  return (
    <header className="topbar">
      <button className="brand" onClick={() => set({ introOpen: true })} aria-label="EarthPulse home">
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <circle cx="16" cy="16" r="13" />
          <path d="M4 16h7l3-7 4 14 3-7h7" />
        </svg>
        <span><strong>EARTHPULSE</strong><em>See what is changing on Earth.</em></span>
      </button>

      <nav aria-label="Modes">
        {MODES.map((m) => (
          <button key={m.id} className={mode === m.id ? "on" : ""} aria-current={mode === m.id ? "page" : undefined}
            onClick={() => set({ mode: m.id })}>
            {m.label}
          </button>
        ))}
        <AnalyseMenu />
      </nav>

      <form className="search" role="search" onSubmit={search}>
        <input type="search" value={query} placeholder="Place, or lat, lon" aria-label="Search a place or type latitude, longitude"
          onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "…" : "Go"}</button>
        {(places?.length || message) && (
          <ul className="results" role="listbox" aria-label="Search results">
            {places?.map((place) => (
              <li key={`${place.lat},${place.lon}`}>
                <button type="button" role="option" aria-selected="false" onClick={() => go(place)}>
                  <span>{place.name}</span><em>{place.kind}</em>
                </button>
              </li>
            ))}
            {message && <li className="muted">{message}</li>}
            <li className="credit">Search © OpenStreetMap contributors</li>
          </ul>
        )}
      </form>

      <button className="ghost reset" onClick={() => void getGlobe()?.resetView()} title="Back to the whole Earth" aria-label="Reset view">
        <span aria-hidden="true">⟲</span><span className="label"> Reset view</span>
      </button>
      <button className="ghost" onClick={share}>Share</button>
    </header>
  );
}
