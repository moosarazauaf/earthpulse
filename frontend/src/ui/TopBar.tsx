/** Brand, mode navigation, place search and sharing. */
import { type FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { ApiError, api } from "../app/api";
import { encodeView, parseCoordinates } from "../app/logic";
import { useStore } from "../app/store";
import type { Place } from "../app/types";
import { getGlobe } from "../globe/GlobeViewer";
import { ANALYSES, type AnalysisMode } from "./modes";
import { useT } from "../i18n";
import { useWatchedPlaces } from "../area/watch";
import { modeForRun } from "../app/shareRun";
import { interpret } from "../ask/interpret";
import { requestRun } from "../ask/request";
import { PIXEL_BUDGET, deviceProfile } from "../engine/client";
import { openLegal } from "./Legal";

/** Three entries for a newcomer: what is happening, look around, measure something. */
const MODES = [
  { id: "live", label: "nav.live" },
  { id: "explore", label: "nav.explore" },
] as const;
/** Camera height after flying to typed coordinates: a district-sized view. */
const COORDINATE_VIEW_HEIGHT_M = 120_000;

/** The analyses, chosen by the question they answer. */
export function AnalysisList({ onPick }: { onPick: (id: AnalysisMode) => void }) {
  const mode = useStore((s) => s.mode);
  const t = useT();
  return (
    <ul className="analysis-list" role="menu">
      {ANALYSES.map((a, i) => (
        <li key={a.id} role="none">
          <button role="menuitem" className={mode === a.id ? "on" : ""} onClick={() => onPick(a.id)}>
            <strong>{t(`q.${a.id}`)}</strong>
            <span>{t(`label.${a.id}`)} · {a.detail} <kbd>Shift {i + 1}</kbd></span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function AnalyseMenu() {
  const mode = useStore((s) => s.mode);
  const t = useT();
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
        {active ? t("nav.analyseActive", { name: t(`label.${active.id}`) }) : t("nav.analyse")} <span aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div ref={menu} className="analyse-menu" style={{ left }} role="dialog" aria-label={t("menu.title")}>
          <p className="eyebrow">{t("menu.title")}</p>
          <button className="overview-item" onClick={() => { set({ mode: "area" }); setOpen(false); }}>
            <strong>{t("menu.overview")}</strong>
            <span>{t("menu.overviewDetail")} <kbd>O</kbd></span>
          </button>
          <AnalysisList onPick={(id) => { set({ mode: id }); setOpen(false); }} />
          <p className="muted">{t("menu.footer")}</p>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Legal links menu. */
function LegalMenu() {
  const t = useT();
  const set = useStore((s) => s.set);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

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
      <button ref={button} className="ghost" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)} title={t("top.legalTitle")}>
        <span aria-hidden="true">⚖</span><span className="label"> {t("top.legal")}</span>
      </button>
      {open && createPortal(
        <div ref={menu} className="analyse-menu legal-menu" style={{ left: button.current?.getBoundingClientRect().left ?? 0 }} role="dialog" aria-label={t("top.legalTitle")}>
          <button className="overview-item" onClick={() => { openLegal("privacy"); setOpen(false); }}>
            <strong>{t("legal.privacy.title")}</strong>
            <span>{t("legal.privacy.sections.controller.text").slice(0, 80)}…</span>
          </button>
          <button className="overview-item" onClick={() => { openLegal("cookies"); setOpen(false); }}>
            <strong>{t("legal.cookies.title")}</strong>
            <span>{t("legal.cookies.sections.what.text").slice(0, 80)}…</span>
          </button>
          <button className="overview-item" onClick={() => { openLegal("terms"); setOpen(false); }}>
            <strong>{t("legal.terms.title")}</strong>
            <span>{t("legal.terms.sections.acceptance.text").slice(0, 80)}…</span>
          </button>
          <button className="overview-item" onClick={() => { set({ cookieCustomizeOpen: true }); setOpen(false); }}>
            <strong>{t("cookie.customizeTitle")}</strong>
            <span>{t("cookie.customizeDescription").slice(0, 80)}…</span>
          </button>
        </div>,
        document.body,
      )}
    </>
  );
}

/** Globe layers menu (clouds, weather, pollution, effects). */
function GlobeLayersMenu() {
  const t = useT();
  const set = useStore((s) => s.set);
  const cloudsEnabled = useStore((s) => s.cloudsEnabled);
  const weatherEnabled = useStore((s) => s.weatherEnabled);
  const weatherLayer = useStore((s) => s.weatherLayer);
  const pollutionEnabled = useStore((s) => s.pollutionEnabled);
  const pollutionLayer = useStore((s) => s.pollutionLayer);
  const dynamicLighting = useStore((s) => s.dynamicLighting);
  const fogEnabled = useStore((s) => s.fogEnabled);
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

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
      <button ref={button} className="ghost" aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(!open)} title={t("top.effectsTitle")}>
        <span aria-hidden="true">🌐</span><span className="label"> {t("top.effects")}</span>
      </button>
      {open && createPortal(
        <div ref={menu} className="analyse-menu globe-layers-menu" style={{ left: button.current?.getBoundingClientRect().left ?? 0 }} role="dialog" aria-label={t("top.effectsTitle")}>
          <p className="eyebrow">{t("globe.effects")}</p>

          {/* Clouds */}
          <fieldset>
            <legend>{t("globe.clouds")}</legend>
            <label className="check">
              <input type="checkbox" checked={cloudsEnabled} onChange={(e) => set({ cloudsEnabled: e.target.checked })} />
              <span>{t("globe.cloudsDesc")}</span>
            </label>
            <div className="slider inline">
              <span>{t("globe.cloudOpacity")}</span>
              <input type="range" min={0} max={1} step={0.05} value={useStore.getState().cloudOpacity}
                onChange={(e) => set({ cloudOpacity: Number(e.target.value) })} />
              <span>{(useStore.getState().cloudOpacity * 100).toFixed(0)}%</span>
            </div>
          </fieldset>

          {/* Weather */}
          <fieldset>
            <legend>{t("globe.weather")}</legend>
            <label className="check">
              <input type="checkbox" checked={weatherEnabled} onChange={(e) => set({ weatherEnabled: e.target.checked })} />
              <span>{weatherEnabled ? t("globe.weatherCurrent") : "Click to enable weather layers"}</span>
            </label>
            {weatherEnabled && (
              <div className="seg">
                <button className={weatherLayer === "temperature" ? "on" : ""} onClick={() => set({ weatherLayer: "temperature" })}>
                  {t("globe.weatherTemp")}
                </button>
                <button className={weatherLayer === "precipitation" ? "on" : ""} onClick={() => set({ weatherLayer: "precipitation" })}>
                  {t("globe.weatherPrecip")}
                </button>
                <button className={weatherLayer === "wind" ? "on" : ""} onClick={() => set({ weatherLayer: "wind" })}>
                  {t("globe.weatherWind")}
                </button>
                <button className={weatherLayer === "pressure" ? "on" : ""} onClick={() => set({ weatherLayer: "pressure" })}>
                  {t("globe.weatherPressure")}
                </button>
                <button className={weatherLayer === "clouds" ? "on" : ""} onClick={() => set({ weatherLayer: "clouds" })}>
                  {t("globe.weatherClouds")}
                </button>
              </div>
            )}
            <div className="slider inline">
              <span>{t("globe.weatherOpacity")}</span>
              <input type="range" min={0} max={1} step={0.05} value={useStore.getState().weatherOpacity}
                onChange={(e) => set({ weatherOpacity: Number(e.target.value) })} disabled={!weatherEnabled} />
              <span>{(useStore.getState().weatherOpacity * 100).toFixed(0)}%</span>
            </div>
          </fieldset>

          {/* Pollution */}
          <fieldset>
            <legend>{t("globe.pollution")}</legend>
            <label className="check">
              <input type="checkbox" checked={pollutionEnabled} onChange={(e) => set({ pollutionEnabled: e.target.checked })} />
              <span>{pollutionEnabled ? t("globe.pollutionForecast") : "Click to enable air quality layers"}</span>
            </label>
            {pollutionEnabled && (
              <div className="seg">
                <button className={pollutionLayer === "aqi" ? "on" : ""} onClick={() => set({ pollutionLayer: "aqi" })} title={t("globe.pollutionAQI")}>AQI</button>
                <button className={pollutionLayer === "pm25" ? "on" : ""} onClick={() => set({ pollutionLayer: "pm25" })} title={t("globe.pollutionPM25")}>PM₂.₅</button>
                <button className={pollutionLayer === "no2" ? "on" : ""} onClick={() => set({ pollutionLayer: "no2" })} title={t("globe.pollutionNO2")}>NO₂</button>
                <button className={pollutionLayer === "o3" ? "on" : ""} onClick={() => set({ pollutionLayer: "o3" })} title={t("globe.pollutionO3")}>O₃</button>
                <button className={pollutionLayer === "co" ? "on" : ""} onClick={() => set({ pollutionLayer: "co" })} title={t("globe.pollutionCO")}>CO</button>
                <button className={pollutionLayer === "so2" ? "on" : ""} onClick={() => set({ pollutionLayer: "so2" })} title={t("globe.pollutionSO2")}>SO₂</button>
              </div>
            )}
            <div className="slider inline">
              <span>{t("globe.pollutionOpacity")}</span>
              <input type="range" min={0} max={1} step={0.05} value={useStore.getState().pollutionOpacity}
                onChange={(e) => set({ pollutionOpacity: Number(e.target.value) })} disabled={!pollutionEnabled} />
              <span>{(useStore.getState().pollutionOpacity * 100).toFixed(0)}%</span>
            </div>
          </fieldset>

          {/* Globe Effects */}
          <fieldset>
            <legend>{t("globe.effectsLighting")}</legend>
            <label className="check">
              <input type="checkbox" checked={dynamicLighting} onChange={(e) => set({ dynamicLighting: e.target.checked })} />
              <span>{t("globe.effectsLightingDesc")}</span>
            </label>
            <label className="check">
              <input type="checkbox" checked={fogEnabled} onChange={(e) => set({ fogEnabled: e.target.checked })} />
              <span>{t("globe.effectsFog")}</span>
            </label>
            <div className="slider inline">
              <span>{t("globe.effectsFogDensity")}</span>
              <input type="range" min={0} max={0.001} step={0.00005} value={useStore.getState().fogDensity}
                onChange={(e) => set({ fogDensity: Number(e.target.value) })} disabled={!fogEnabled} />
              <span>{useStore.getState().fogDensity.toFixed(5)}</span>
            </div>
            <label className="check">
              <input type="checkbox" checked={useStore.getState().groundAtmosphere} onChange={(e) => set({ groundAtmosphere: e.target.checked })} />
              <span>{t("globe.effectsGroundAtmosphere")}</span>
            </label>
            <div className="slider inline">
              <span>{t("globe.effectsTimeLapseDesc")}</span>
              <select value={useStore.getState().timeMultiplier} onChange={(e) => set({ timeMultiplier: Number(e.target.value) })}>
                <option value={1}>1× (Real-time)</option>
                <option value={60}>60× (1 min/sec)</option>
                <option value={3600}>3600× (1 hr/sec)</option>
                <option value={86400}>86400× (1 day/sec)</option>
              </select>
            </div>
          </fieldset>
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
  const t = useT();
  const watchedCount = useWatchedPlaces().length;
  const drawTool = useStore((s) => s.drawTool);
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
    // A request that names an analysis ("floods in Layyah in August 2022") is planned and shown for confirmation.
    const ask = interpret(query.trim());
    if (ask) {
      try {
        const state = useStore.getState();
        const planned = await requestRun(query.trim(), ask, state.aoi, PIXEL_BUDGET[deviceProfile().recommended]);
        if ("error" in planned) {
          setPlaces(null);
          setMessage(planned.error);
        } else {
          setPlaces(null);
          state.setAoi(planned.aoi);
          state.set({ pendingRun: planned.run, mode: modeForRun(planned.run), result: null, introOpen: false });
        }
      } catch {
        setMessage("Place search failed.");
      } finally {
        setBusy(false);
      }
      return;
    }
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
            {t(m.label)}
          </button>
        ))}
        <AnalyseMenu />
      </nav>

      <form className="search" role="search" onSubmit={search}>
        <input type="search" value={query} placeholder={t("top.search")} aria-label="Search a place, type latitude, longitude, or ask for an analysis"
          onChange={(e) => setQuery(e.target.value)} />
        <button type="submit" disabled={busy}>{busy ? "…" : t("top.go")}</button>
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

      <button className={drawTool === "point" ? "ghost pick on" : "ghost pick"} aria-pressed={drawTool === "point"}
        onClick={() => set({ drawTool: drawTool === "point" ? "none" : "point", introOpen: false })}
        title={t("top.analyseHereTitle")}>
        <span aria-hidden="true">◎</span><span className="label"> {t("top.analyseHere")}</span>
      </button>
      <button className={drawTool === "measure" ? "ghost measure-btn on" : "ghost measure-btn"} aria-pressed={drawTool === "measure"}
        onClick={() => set(drawTool === "measure" ? { drawTool: "none" } : { drawTool: "measure", measure: [], introOpen: false })}
        title="Measure a distance or an area (D)" aria-label="Measure">
        <span aria-hidden="true">📏</span>
      </button>
      <button className="ghost reset" onClick={() => void getGlobe()?.resetView()} title="Back to the whole Earth" aria-label="Reset view">
        <span aria-hidden="true">⟲</span><span className="label"> Reset view</span>
      </button>
      <button className="ghost places-btn" onClick={() => set({ placesOpen: true })} title="My places: saved areas and recent analyses (M)" aria-label="My places">
        <span aria-hidden="true">★</span><span className="label"> {t("top.places")}</span>
        {watchedCount > 0 && <span className="badge" aria-label={`${watchedCount} of your places have hazards nearby`}>{watchedCount}</span>}
      </button>
      <button className="ghost" onClick={share} title="Copy a link to this view (S)">{t("top.share")}</button>
      <GlobeLayersMenu />
      <LegalMenu />
      <button className="ghost keys" onClick={() => set({ shortcutsOpen: true })} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts">?</button>
    </header>
  );
}