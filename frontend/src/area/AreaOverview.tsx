/**
 * The area overview: what a place is like, read in seconds, and one-click
 * analyses for it. Opened by Analyse here (a click on the globe), by drawing
 * or uploading an area outside an analysis, or from the Analyse menu.
 */
import { useEffect, useMemo, useState } from "react";

import { formatArea, formatLatLon } from "../app/logic";
import { useStore } from "../app/store";
import { deviceProfile, landCoverInBrowser, PIXEL_BUDGET, populationInBrowser } from "../engine/client";
import { type PopulationResult, formatPeople } from "../engine/population";
import { type CountryFacts, type FoodSecurity, type RainAnomaly, fetchCountryFacts, fetchFoodSecurity, fetchRainAnomaly } from "./official";
import { type District, districtAt } from "./districts";
import { WORLDCOVER } from "../engine/cover";
import { projectAoi } from "../engine/geo";
import { corroborate } from "../news/corroborate";
import { HAZARD_INFO, ago } from "../news/hazards";
import { distanceKm } from "../news/stories";
import { type WeatherContext, describe, fetchWeatherContext } from "../news/weather";
import { KindBadge } from "../ui/KindBadge";
import { type QuickActionInfo, quickActions } from "./actions";
import { isSaved } from "./saved";
import { useT } from "../i18n";
import { type AirQuality, WHO_PM25_DAY, aqiBand, fetchAir } from "./air";
import { type ClimateProfile, describeNormals, fetchClimate, landslideConditions } from "./climate";
import { SLOPE_CLASSES, type Terrain, fetchTerrain } from "./elevation";
import { AreaChoices } from "../analysis/AreaPrompt";

const SIZES = [2, 5, 10, 25] as const;
const NEWS_KM = 150;
const QUAKE_KM = 300;
const MONTHS = "JFMAMJJASOND";

export function AreaOverview() {
  const aoi = useStore((s) => s.aoi);
  const t = useT();
  if (!aoi) {
    return (
      <section>
        <p>{t("area.empty")}</p>
        <AreaChoices />
      </section>
    );
  }
  return <Overview />;
}

function Overview() {
  const aoi = useStore((s) => s.aoi)!;
  const t = useT();
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
        <p className="eyebrow">{t("area.eyebrow")}</p>
        <h2 className="story-title">{aoi.label}</h2>
        <div className="row-actions">
          <button onClick={saveCurrentPlace} disabled={saved} title="Keep this area in My places, in this browser (Shift+S)">{saved ? t("area.saved") : t("area.save")}</button>
          <button onClick={() => window.print()} title="Print this overview, or save it as a PDF">{t("area.print")}</button>
        </div>
        <p className="muted">
          {formatArea(projected.areaM2 / 10_000)} · centre {formatLatLon(lat, lon)} ·{" "}
          <button className="link" onClick={() => setAoi(null)}>{t("area.another")}</button>
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
      <People />
      <Official lat={lat} lon={lon} />
      <RecentRain lat={lat} lon={lon} />
      <Air lat={lat} lon={lon} />
      <Climate lat={lat} lon={lon} />
      <Nearby lat={lat} lon={lon} />
    </>
  );
}

// ---- one-click analyses -------------------------------------------------------------------

function QuickRuns() {
  const aoi = useStore((s) => s.aoi)!;
  const t = useT();
  const runQuick = useStore((s) => s.runQuick);
  const running = useStore((s) => s.job.status === "running" || s.job.status === "submitting");
  const device = useMemo(deviceProfile, []);
  const actions = useMemo(() => quickActions(aoi.geometry, aoi.label), [aoi]);
  return (
    <section>
      <h3>{t("area.analyse")}</h3>
      <ul className="quick-runs">
        {actions.map((info, i) => (
          <li key={info.action.id}>
            <button disabled={running} onClick={() => runQuick(info, device)} title={info.explain}>
              <kbd aria-hidden="true">{i + 1}</kbd>
              <span><strong>{t(`quick.${info.action.id}`)}</strong><em>{info.explain}</em></span>
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
  const t = useT();
  const label = t(`weight.${w}`);
  return <span className={`weight ${w}`} title={`${label} on a typical connection`}>{label}</span>;
}

// ---- land cover ------------------------------------------------------------------------------

function LandCover() {
  const t = useT();
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
      <header className="row"><h3>{t("area.landCover")}</h3><KindBadge kind="MODELED" /></header>
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
  const t = useT();
  const aoi = useStore((s) => s.aoi)!;
  const [terrain, setTerrain] = useState<Terrain | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setTerrain(undefined);
    setError(null);
    fetchTerrain(aoi.geometry, controller.signal).then((found) => {
      setTerrain(found);
      useStore.getState().set({ areaSteepShare: found ? found.slopeShares[3]! + found.slopeShares[4]! : null });
    }, (e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Elevation could not be read.");
    });
    return () => controller.abort();
  }, [aoi]);
  const at = (p: [number, number]) => formatLatLon(p[1], p[0]);
  return (
    <section>
      <header className="row"><h3>{t("area.terrain")}</h3><KindBadge kind="DERIVED" /></header>
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

// ---- people ---------------------------------------------------------------------------------------

/** How many people live in the area (GHS-POP 2020), counted in a worker. */
function People() {
  const aoi = useStore((s) => s.aoi)!;
  const t = useT();
  const [count, setCount] = useState<PopulationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setCount(null);
    setError(null);
    const job = populationInBrowser({ aoi: aoi.geometry });
    job.promise.then((c) => { setCount(c); useStore.getState().set({ areaPeople: c.people }); }, (e: unknown) => setError(e instanceof Error ? e.message : "The population grid could not be read."));
    return job.cancel;
  }, [aoi]);
  return (
    <section>
      <header className="row"><h3>{t("area.people")}</h3><KindBadge kind="MODELED" /></header>
      {error && <p className="note">{error}</p>}
      {!count && !error && <p className="muted" role="status">Counting people…</p>}
      {count && (
        <>
          <p><strong>{formatPeople(count.people)}</strong> lived here in 2020, {Math.round(count.people / Math.max(count.areaKm2, 0.01)).toLocaleString("en")} per km².</p>
          <p className="muted">
            GHS-POP 2020 (European Commission JRC, CC BY 4.0), counted on a {count.cellM} m grid. A model that spreads census counts
            over built-up land, so it is a good estimate for an area, not a head count.
          </p>
        </>
      )}
    </section>
  );
}

// ---- official figures --------------------------------------------------------------------------

/** National statistics and UN records for the district at the area's centre, beside EarthPulse's own estimates. */
function Official({ lat, lon }: { lat: number; lon: number }) {
  const t = useT();
  const people = useStore((s) => s.areaPeople);
  const aoi = useStore((s) => s.aoi);
  const [district, setDistrict] = useState<District | null>(null);
  const [facts, setFacts] = useState<CountryFacts | null>(null);
  const [food, setFood] = useState<FoodSecurity | null>(null);
  const [rain, setRain] = useState<RainAnomaly | null>(null);
  const [done, setDone] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setDistrict(null); setFacts(null); setFood(null); setRain(null); setDone(false);
    void (async () => {
      const d = await districtAt(lon, lat).catch(() => null);
      if (signal.aborted) return;
      setDistrict(d);
      if (!d) { setDone(true); return; }
      const [f, ipc, r] = await Promise.all([
        fetchCountryFacts(d.iso3, signal).catch(() => null),
        fetchFoodSecurity(d.iso3, d.name, signal).catch(() => null),
        fetchRainAnomaly(d.iso3, d.name, new Date(), signal).catch(() => null),
      ]);
      if (signal.aborted) return;
      setFacts(f); setFood(ipc); setRain(r); setDone(true);
    })();
    return () => controller.abort();
  }, [lat, lon]);
  const n = (v: number) => v >= 1e6 ? `${(v / 1e6).toLocaleString("en", { maximumSignificantDigits: 3 })} million` : v.toLocaleString("en", { maximumSignificantDigits: 3 });
  return (
    <section>
      <h3>{t("area.official")}</h3>
      {!done && <p className="muted" role="status">Reading World Bank and UN records…</p>}
      {done && !district && <p className="muted">No district found here (over the sea, or outside the GAUL map).</p>}
      {facts && (
        <p>
          {facts.country}
          {facts.population && `: ${n(facts.population.value)} people (${facts.population.year})`}
          {facts.urban && `, ${Math.round(facts.urban.value)}% in towns and cities`}
          {facts.gdpPerPerson && `, GDP US$${n(facts.gdpPerPerson.value)} per person`}
          {facts.poverty && `, ${facts.poverty.value}% living on less than US$2.15 a day (${facts.poverty.year})`}. <span className="muted">World Bank.</span>
        </p>
      )}
      {facts?.population && people !== null && people >= 1 && (
        <p>This area&apos;s {formatPeople(people).replace("about ", "")} are {((people / facts.population.value) * 100).toPrecision(2)}% of the national population.</p>
      )}
      {food && (
        <p>
          <strong>{n(food.crisis)} people ({Math.round(food.share * 100)}%)</strong> in {food.district} were in IPC Phase 3 (Crisis) or
          worse, {food.period[0]} to {food.period[1]}. <span className="muted">IPC, through UN OCHA&apos;s Humanitarian API.</span>
        </p>
      )}
      {food && food.share > 0 && people !== null && district && aoi && JSON.stringify(aoi.geometry) === JSON.stringify(district.geometry) && (
        <p>
          Cross-check: the IPC analysis implies about {n(food.crisis / food.share)} people in {food.district}; the GHS-POP count above is{" "}
          {Math.abs(Math.round((people / (food.crisis / food.share) - 1) * 100))}% {people < food.crisis / food.share ? "lower" : "higher"}.{" "}
          <span className="muted">Population grids can miss scattered rural homes, and the IPC share is rounded, so treat both as estimates.</span>
        </p>
      )}
      {rain && (
        <p>
          Rain in {rain.district}, month to {rain.period[1]}: <strong>{Math.round(rain.percent)}%</strong> of the long-term average.{" "}
          <span className="muted">WFP, from CHIRPS satellite rainfall: a separate record to set beside &quot;Rain lately&quot;.</span>
        </p>
      )}
      {done && district && !food && !rain && (
        <p className="muted">
          No IPC food-security analysis or WFP rainfall record for {district.name} in the UN&apos;s Humanitarian API; these cover places
          with humanitarian concerns, and district names can differ between map sources.
        </p>
      )}
    </section>
  );
}

// ---- climate ------------------------------------------------------------------------------------

function Climate({ lat, lon }: { lat: number; lon: number }) {
  const t = useT();
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
      <header className="row"><h3>{t("area.climate")}</h3><KindBadge kind="MODELED" /></header>
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

/** The last 3, 7 and 30 days of rain against the same days in 1991 to 2020, and landslide conditions where the ground is steep. */
function RecentRain({ lat, lon }: { lat: number; lon: number }) {
  const t = useT();
  const steep = useStore((s) => s.areaSteepShare);
  const [context, setContext] = useState<WeatherContext | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    setContext(null);
    setError(null);
    fetchWeatherContext(lat, lon, new Date().toISOString().slice(0, 10), controller.signal).then(setContext, (e: unknown) => {
      if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Recent weather could not be loaded.");
    });
    return () => controller.abort();
  }, [lat, lon]);
  const windows = context?.rain.filter((w) => w.days !== 90) ?? [];
  const week = windows.find((w) => w.days === 7);
  const landslide = landslideConditions(week, steep);
  return (
    <section>
      <header className="row"><h3>{t("area.recent")}</h3><KindBadge kind="MODELED" /></header>
      {error && <p className="note">{error}</p>}
      {!context && !error && <p className="muted" role="status">Reading the last month of weather…</p>}
      {context && (
        <>
          <ul className="facts-list">
            {windows.map((w) => <li key={w.days}>{describe(w, "rain").replace(" to the event", " to today")}</li>)}
          </ul>
          {landslide && steep !== null && (
            <p className="note">
              An unusually wet week on ground where {Math.round(steep * 100)}% is steeper than 15°: these are the conditions in which
              landslides happen. This is not a forecast; follow local warnings.
            </p>
          )}
          <p className="muted">Recent days from Open-Meteo's weather models, the baseline from ERA5; one grid cell, so local storms can be missed.</p>
        </>
      )}
    </section>
  );
}

/** Air now (US AQI and pollutants) and how many of the past days were above the WHO PM2.5 guideline. */
function Air({ lat, lon }: { lat: number; lon: number }) {
  const t = useT();
  const [air, setAir] = useState<AirQuality | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setAir(null);
    setError(false);
    fetchAir(lat, lon, controller.signal).then(setAir, () => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [lat, lon]);
  const band = air ? aqiBand(air.usAqi) : null;
  const above = air?.days.filter((d) => d.pm25 > WHO_PM25_DAY).length ?? 0;
  return (
    <section>
      <header className="row"><h3>{t("area.air")}</h3><KindBadge kind="MODELED" /></header>
      {error && <p className="note">Air quality could not be loaded.</p>}
      {!air && !error && <p className="muted" role="status">Reading the air…</p>}
      {air && band && (
        <>
          <div className="stat" style={{ borderTopColor: band.colour }}>
            <span>US AQI at {air.time.slice(11, 16)} local time</span>
            <strong>{air.usAqi} · {band.label}</strong>
            <em>PM2.5 {air.pm25.toFixed(0)} · PM10 {air.pm10.toFixed(0)} · NO₂ {air.no2.toFixed(0)} · ozone {air.ozone.toFixed(0)} µg/m³</em>
          </div>
          {air.days.length > 0 && (
            <p>
              On {above} of the past {air.days.length} days the average PM2.5 was above the WHO guideline of {WHO_PM25_DAY} µg/m³
              {above > 0 ? ` (highest ${Math.max(...air.days.map((d) => d.pm25)).toFixed(0)})` : ""}.
            </p>
          )}
          <p className="muted">CAMS atmosphere model through Open-Meteo, about 40 km across (11 km in Europe): the air of the region, not of one street. Not a health warning; follow local advice.</p>
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
  const t = useT();
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
      <h3>{t("area.nearby")}</h3>
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
