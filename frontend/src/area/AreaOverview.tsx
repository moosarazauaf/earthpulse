/**
 * The area overview: what a place is like, read in seconds, and one-click
 * analyses for it. Opened by Analyse here (a click on the globe), by drawing
 * or uploading an area outside an analysis, or from the Analyse menu.
 */
import { useEffect, useMemo, useState } from "react";

import { formatArea, formatLatLon } from "../app/logic";
import { useStore } from "../app/store";
import { deviceProfile, landCoverInBrowser, PIXEL_BUDGET } from "../engine/client";
import { WORLDCOVER } from "../engine/cover";
import { projectAoi } from "../engine/geo";
import { corroborate } from "../news/corroborate";
import { HAZARD_INFO, ago } from "../news/hazards";
import { distanceKm } from "../news/stories";
import { describe } from "../news/weather";
import { KindBadge } from "../ui/KindBadge";
import { type QuickActionInfo, quickActions } from "./actions";
import { isSaved } from "./saved";
import { type ClimateProfile, describeNormals, fetchClimate } from "./climate";
import { SLOPE_CLASSES, type Terrain, fetchTerrain } from "./elevation";
import { AreaChoices } from "../analysis/AreaPrompt";

const SIZES = [2, 5, 10, 25] as const;
const NEWS_KM = 150;
const QUAKE_KM = 300;
const MONTHS = "JFMAMJJASOND";

export function AreaOverview() {
  const aoi = useStore((s) => s.aoi);
  if (!aoi) {
    return (
      <section>
        <p>Press <strong>◎ Analyse here</strong> (or A on a keyboard) and then tap or click a spot on the globe, or choose an area below.</p>
        <AreaChoices />
      </section>
    );
  }
  return <Overview />;
}

function Overview() {
  const aoi = useStore((s) => s.aoi)!;
  const centre = useStore((s) => s.pickCentre);
  const size = useStore((s) => s.pickSizeKm);
  const analyseAt = useStore((s) => s.analyseAt);
  const setAoi = useStore((s) => s.setAoi);
  const saveCurrentPlace = useStore((s) => s.saveCurrentPlace);
  const saved = useStore((s) => isSaved(s.places, aoi.geometry));
  const projected = useMemo(() => projectAoi(aoi.geometry), [aoi.geometry]);
  const [lon, lat] = centre ?? [
    (projected.lonLatBounds[0] + projected.lonLatBounds[2]) / 2,
    (projected.lonLatBounds[1] + projected.lonLatBounds[3]) / 2,
  ];

  return (
    <>
      <section>
        <p className="eyebrow">Area overview</p>
        <h2 className="story-title">{aoi.label}</h2>
        <div className="row-actions">
          <button onClick={saveCurrentPlace} disabled={saved} title="Keep this area in My places, in this browser (Shift+S)">{saved ? "★ Saved" : "☆ Save"}</button>
          <button onClick={() => window.print()} title="Print this overview, or save it as a PDF">Print report</button>
        </div>
        <p className="muted">
          {formatArea(projected.areaM2 / 10_000)} · centre {formatLatLon(lat, lon)} ·{" "}
          <button className="link" onClick={() => setAoi(null)}>Choose another area</button>
        </p>
        {centre && (
          <div className="seg" role="radiogroup" aria-label="Size of the square">
            {SIZES.map((km) => (
              <button key={km} role="radio" aria-checked={size === km} className={size === km ? "on" : ""} onClick={() => analyseAt(centre[0], centre[1], km)}>
                {km} km
              </button>
            ))}
          </div>
        )}
      </section>
      <QuickRuns />
      <LandCover />
      <TerrainSection />
      <Climate lat={lat} lon={lon} />
      <Nearby lat={lat} lon={lon} />
    </>
  );
}

// ---- one-click analyses -------------------------------------------------------------------

function QuickRuns() {
  const aoi = useStore((s) => s.aoi)!;
  const runQuick = useStore((s) => s.runQuick);
  const running = useStore((s) => s.job.status === "running" || s.job.status === "submitting");
  const device = useMemo(deviceProfile, []);
  const actions = useMemo(() => quickActions(aoi.geometry, aoi.label), [aoi]);
  return (
    <section>
      <h3>Analyse this area</h3>
      <ul className="quick-runs">
        {actions.map((info, i) => (
          <li key={info.action.id}>
            <button disabled={running} onClick={() => runQuick(info, device)} title={info.explain}>
              <kbd aria-hidden="true">{i + 1}</kbd>
              <span><strong>{info.label}</strong><em>{info.explain}</em></span>
              <Weight w={info.weight} />
            </button>
          </li>
        ))}
      </ul>
      <p className="muted">
        One click runs with the defaults shown, on this computer, at the {device.recommended} setting. Each analysis keeps its
        full form for changing them. Keys 1 to {actions.length} start them too.
      </p>
    </section>
  );
}

function Weight({ w }: { w: QuickActionInfo["weight"] }) {
  const label = w === "light" ? "Quick" : w === "medium" ? "A minute or two" : "Several minutes";
  return <span className={`weight ${w}`} title={`${label} on a typical connection`}>{label}</span>;
}

// ---- land cover ------------------------------------------------------------------------------

function LandCover() {
  const aoi = useStore((s) => s.aoi)!;
  const cover = useStore((s) => s.areaCover);
  const show = useStore((s) => s.showCover);
  const set = useStore((s) => s.set);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cover) return;
    setError(null);
    const run = landCoverInBrowser({ aoi: aoi.geometry, maxPixels: PIXEL_BUDGET.fast });
    run.promise.then((c) => set({ areaCover: c }), (e: unknown) => setError(e instanceof Error ? e.message : "Land cover could not be read."));
    return () => run.cancel();
  }, [aoi, cover, set]);

  return (
    <section>
      <header className="row"><h3>Land cover</h3><KindBadge kind="MODELED" /></header>
      {error && <p className="note">{error}</p>}
      {!cover && !error && <p className="muted" role="status">Reading the ESA WorldCover map…</p>}
      {cover && (
        <>
          <ul className="cover-bars">
            {cover.shares.slice(0, 7).map((c) => {
              const rgb = WORLDCOVER[c.code]?.colour ?? [128, 128, 128];
              return (
                <li key={c.code}>
                  <span className="swatch" style={{ background: `rgb(${rgb.join(",")})` }} aria-hidden="true" />
                  <span className="name">{c.name}</span>
                  <span className="bar"><i style={{ width: `${Math.max(1, c.share * 100)}%` }} /></span>
                  <span className="pct">{Math.round(c.share * 100)}%</span>
                </li>
              );
            })}
          </ul>
          <label className="check">
            <input type="checkbox" checked={show} onChange={(e) => set({ showCover: e.target.checked })} />
            <span>Show the land-cover map on the globe</span>
          </label>
          <p className="muted">ESA WorldCover 2021, read at {cover.resolution} m. A classification with a reported overall accuracy of about 77%.</p>
        </>
      )}
    </section>
  );
}

// ---- terrain ---------------------------------------------------------------------------------

function TerrainSection() {
  const aoi = useStore((s) => s.aoi)!;
  const [terrain, setTerrain] = useState<Terrain | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setTerrain(undefined);
    setError(null);
    fetchTerrain(aoi.geometry, controller.signal).then(setTerrain, (e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Elevation could not be read.");
    });
    return () => controller.abort();
  }, [aoi]);
  const at = (p: [number, number]) => formatLatLon(p[1], p[0]);
  return (
    <section>
      <header className="row"><h3>Terrain</h3><KindBadge kind="DERIVED" /></header>
      {error && <p className="note">{error}</p>}
      {terrain === undefined && !error && <p className="muted" role="status">Reading elevation…</p>}
      {terrain === null && <p className="muted">No elevation inside this area.</p>}
      {terrain && (
        <>
          <p>
            From <strong>{metres(terrain.min)}</strong> to <strong>{metres(terrain.max)}</strong> above sea level
            (mean {metres(terrain.mean)}, relief {metres(terrain.max - terrain.min)}). Average slope {terrain.meanSlope.toFixed(1)}°.
          </p>
          <ul className="cover-bars">
            {SLOPE_CLASSES.map((c, i) => (
              <li key={c.label}>
                <span className="swatch" style={{ background: SLOPE_COLOURS[i] }} aria-hidden="true" />
                <span className="name">{c.label} {i === 0 ? `(under ${c.max}°)` : i === SLOPE_CLASSES.length - 1 ? `(over ${SLOPE_CLASSES[i - 1]!.max}°)` : `(${SLOPE_CLASSES[i - 1]!.max}–${c.max}°)`}</span>
                <span className="bar"><i style={{ width: `${Math.max(terrain.slopeShares[i]! > 0 ? 1 : 0, terrain.slopeShares[i]! * 100)}%` }} /></span>
                <span className="pct">{Math.round(terrain.slopeShares[i]! * 100)}%</span>
              </li>
            ))}
          </ul>
          <p className="muted">
            Lowest point {at(terrain.lowest)}, highest {at(terrain.highest)}.
            {terrain.slopeShares[3]! + terrain.slopeShares[4]! > 0.1 ? " Over a tenth of the area is steeper than 15°, where heavy rain can set off landslides." : ""}
            {" "}AWS Terrain Tiles (SRTM, GMTED2010 and national models), read at {Math.round(terrain.resolutionM)} m; the data beneath is about 30 m in most places, so slopes over short distances are smoothed. Heights in cities and forests include buildings and trees, and are good to a few metres.
          </p>
        </>
      )}
    </section>
  );
}

const metres = (m: number) => `${Math.round(m).toLocaleString("en")} m`;
const SLOPE_COLOURS = ["#2e7d32", "#9ccc65", "#fdd835", "#fb8c00", "#c62828"];

// ---- climate ------------------------------------------------------------------------------------

function Climate({ lat, lon }: { lat: number; lon: number }) {
  const [profile, setProfile] = useState<ClimateProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    setError(null);
    fetchClimate(lat, lon, controller.signal).then(setProfile, (e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Climate could not be loaded.");
    });
    return () => controller.abort();
  }, [lat, lon]);

  return (
    <section>
      <header className="row"><h3>Climate</h3><KindBadge kind="MODELED" /></header>
      {error && <p className="note">{error}</p>}
      {!profile && !error && <p className="muted" role="status">Reading 30 years of weather…</p>}
      {profile && (
        <>
          <ClimateChart months={profile.months} />
          <p>{describeNormals(profile.months)}</p>
          {profile.lastYear && <p>Last 12 months to {profile.end}: {describe(profile.lastYear, "rain").replace(" in the 365 days to the event", "")}</p>}
          <p className="muted">ERA5 reanalysis through Open-Meteo, one grid cell of about 25 km, so local rain and mountain effects are smoothed.</p>
        </>
      )}
    </section>
  );
}

function ClimateChart({ months }: { months: ClimateProfile["months"] }) {
  const maxRain = Math.max(10, ...months.map((m) => m.rain));
  const temps = months.map((m) => m.tmax).filter(Number.isFinite);
  const tLo = Math.min(...temps) - 2, tHi = Math.max(...temps) + 2;
  const W = 280, H = 70, step = W / 12;
  const y = (t: number) => H - ((t - tLo) / Math.max(tHi - tLo, 1)) * H;
  const line = months.map((m, i) => `${i === 0 ? "M" : "L"}${(i + 0.5) * step},${y(m.tmax)}`).join(" ");
  return (
    <svg className="climate-chart" viewBox={`0 0 ${W} ${H + 14}`} role="img"
      aria-label="Average monthly rain as bars and average daily high temperature as a line, January to December">
      {months.map((m, i) => (
        <rect key={i} x={i * step + 2} y={H - (m.rain / maxRain) * H} width={step - 4} height={(m.rain / maxRain) * H} />
      ))}
      <path d={line} />
      {[...MONTHS].map((ch, i) => <text key={i} x={(i + 0.5) * step} y={H + 12} textAnchor="middle">{ch}</text>)}
      <text x="2" y="9">{Math.round(maxRain)} mm</text>
    </svg>
  );
}

// ---- hazards nearby -------------------------------------------------------------------------------

function Nearby({ lat, lon }: { lat: number; lon: number }) {
  const news = useStore((s) => s.news);
  const quakes = useStore((s) => s.quakes);
  const alerts = useStore((s) => s.alerts);
  const set = useStore((s) => s.set);
  const loadNews = useStore((s) => s.loadNews);
  const loadQuakes = useStore((s) => s.loadQuakes);
  const loadAlerts = useStore((s) => s.loadAlerts);
  useEffect(() => {
    if (news === null) void loadNews();
    if (quakes === null) void loadQuakes();
    if (alerts === null) void loadAlerts();
  }, [news, quakes, alerts, loadNews, loadQuakes, loadAlerts]);

  const here = { lat, lon };
  const stories = (news?.stories ?? []).filter((s) => s.place.precision !== "country" && distanceKm(here, s.place) <= NEWS_KM);
  const nearQuakes = (quakes ?? []).filter((q) => distanceKm(here, q) <= QUAKE_KM);
  const nearAlerts = (alerts ?? []).filter((a) => distanceKm(here, a) <= QUAKE_KM);
  const nothing = !stories.length && !nearQuakes.length && !nearAlerts.length;

  return (
    <section>
      <h3>Happening nearby</h3>
      {nothing && <p className="muted">No hazard news within {NEWS_KM} km in the last 3 days, and no earthquake or GDACS alert within {QUAKE_KM} km in the past week.</p>}
      <ul className="stories">
        {stories.map((story) => (
          <li key={story.id}>
            <button className="story-row" onClick={() => set({ mode: "live", liveTab: "news", selectedStory: story })}>
              <span className="story-kind">{HAZARD_INFO[story.hazard].label} · {story.place.name} · {Math.round(distanceKm(here, story.place))} km</span>
              <strong>{story.articles[0]?.title}</strong>
              <em>{ago(story.last)}{corroborate(story, quakes, alerts).quake ? " · USGS match" : ""}</em>
            </button>
          </li>
        ))}
        {nearQuakes.map((q) => (
          <li key={q.id}>
            <a className="story-row" href={q.url} target="_blank" rel="noopener noreferrer">
              <span className="story-kind">Earthquake · {Math.round(distanceKm(here, q))} km</span>
              <strong>M{q.magnitude.toFixed(1)}, {q.place}</strong>
              <em>{ago(q.time)} · {Math.round(q.depthKm)} km deep · USGS</em>
            </a>
          </li>
        ))}
        {nearAlerts.map((a) => (
          <li key={a.id}>
            <button className="story-row" onClick={() => set({ mode: "live", liveTab: "alerts", selectedAlert: a })}>
              <span className="story-kind">GDACS {a.level} alert · {Math.round(distanceKm(here, a))} km</span>
              <strong>{a.name}</strong>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
