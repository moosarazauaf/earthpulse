/** Brand, mode navigation, place search and sharing. */
import { type FormEvent, useState } from "react";

import { ApiError, api } from "../app/api";
import { encodeView } from "../app/logic";
import { useStore } from "../app/store";
import type { Place } from "../app/types";
import { getGlobe } from "../globe/GlobeViewer";

const MODES = [
  { id: "explore", label: "Explore" },
  { id: "change", label: "Change" },
  { id: "research", label: "Research" },
] as const;
/** Modules on the roadmap. Listed so the plan is visible, disabled so nothing is faked. */
const PLANNED = ["Floods", "Cities", "Forests", "Water", "Carbon"];

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
        {PLANNED.map((name) => (
          <button key={name} disabled title="Planned. See the roadmap.">{name}</button>
        ))}
      </nav>

      <form className="search" role="search" onSubmit={search}>
        <input type="search" value={query} placeholder="Search a place" aria-label="Search a place"
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

      <button className="ghost" onClick={share}>Share</button>
    </header>
  );
}
