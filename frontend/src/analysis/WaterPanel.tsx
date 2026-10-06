/** WaterWatch: track surface water through time, computed on the visitor's device. */
import { useEffect, useMemo, useState } from "react";

import { FIRST_YEAR, SENTINEL2_FIRST_YEAR, currentYear, formatArea, formatSigned } from "../app/logic";
import { useStore } from "../app/store";
import type { WaterResult } from "../app/types";
import { PIXEL_BUDGET, type Quality, deviceProfile, workingResolution } from "../engine/client";
import { projectAoi } from "../engine/geo";
import { AreaStep } from "./AnalysisForm";
import { downloadText } from "./download";
import { ResultHeader } from "./Results";
import { WaterSeriesChart } from "./charts";

const SEASONS = [
  { id: "year", label: "Whole year", start: 1, end: 12 },
  { id: "q1", label: "Jan to Mar", start: 1, end: 3 },
  { id: "q2", label: "Apr to Jun", start: 4, end: 6 },
  { id: "q3", label: "Jul to Sep", start: 7, end: 9 },
  { id: "q4", label: "Oct to Dec", start: 10, end: 12 },
] as const;
const QUALITIES: { id: Quality; label: string }[] = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];
const STEP_CHOICES = [3, 5, 7, 9];
const DEFAULT_MAX_CLOUD = 20;
/** Time each year stays on the globe during playback. */
const PLAY_INTERVAL_MS = 1400;

function spreadYears(first: number, last: number, count: number): number[] {
  const n = Math.max(2, Math.min(count, last - first + 1));
  return [...new Set(Array.from({ length: n }, (_, i) => Math.round(first + ((last - first) * i) / (n - 1))))];
}

export function WaterForm() {
  const s = useStore();
  const device = useMemo(deviceProfile, []);
  const thisYear = currentYear();
  const [first, setFirst] = useState(2000);
  const [last, setLast] = useState(thisYear - 1);
  const [steps, setSteps] = useState(5);
  const [seasonId, setSeasonId] = useState<(typeof SEASONS)[number]["id"]>("q4");
  const [quality, setQuality] = useState<Quality>(device.recommended);
  const [threshold, setThreshold] = useState("0");

  const season = SEASONS.find((x) => x.id === seasonId) ?? SEASONS[0];
  const dataset = s.preferredDataset === "sentinel2" && first >= SENTINEL2_FIRST_YEAR ? "sentinel2" : "landsat";
  const native = dataset === "landsat" ? 30 : 10;
  const years = spreadYears(first, last, steps);
  const running = s.job.status === "submitting" || s.job.status === "running";
  const area = useMemo(() => (s.aoi ? projectAoi(s.aoi.geometry).areaM2 : 0), [s.aoi]);
  const parsedThreshold = Number(threshold);

  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (last <= first) problem = "The last year must come after the first year.";
  else if (!Number.isFinite(parsedThreshold) || Math.abs(parsedThreshold) > 0.8) problem = "The threshold must be between -0.8 and 0.8.";

  function run() {
    if (!s.aoi || problem) return;
    void s.runWater({
      aoi: s.aoi.geometry,
      label: s.aoi.label,
      dataset,
      years,
      startMonth: season.start,
      endMonth: season.end,
      threshold: parsedThreshold,
      maxCloud: DEFAULT_MAX_CLOUD,
      maxPixels: PIXEL_BUDGET[quality],
      concurrency: device.concurrency,
    }, device);
  }

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Period</h3>
        <div className="pair">
          <label className="field">
            <span>First year</span>
            <input type="number" min={FIRST_YEAR} max={thisYear - 1} value={first} onChange={(e) => setFirst(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Last year</span>
            <input type="number" min={FIRST_YEAR + 1} max={thisYear} value={last} onChange={(e) => setLast(Number(e.target.value))} />
          </label>
        </div>
        <div className="pair">
          <label className="field">
            <span>Years mapped</span>
            <select value={steps} onChange={(e) => setSteps(Number(e.target.value))}>
              {STEP_CHOICES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Season</span>
            <select value={seasonId} onChange={(e) => setSeasonId(e.target.value as typeof seasonId)}>
              {SEASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
        <p className="muted">Maps {years.join(", ")}. Use one season so that seasonal water is compared like with like.</p>
        <label className="field">
          <span>Water threshold (MNDWI)</span>
          <input type="number" min={-0.8} max={0.8} step={0.05} value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </label>
      </section>

      <section>
        <h3>3. Your device</h3>
        <p>
          This analysis runs in your browser, on this computer: {device.cores} processor threads
          {device.memoryGb ? `, about ${device.memoryGb} GB of memory reported` : ", memory not reported by this browser"}.
        </p>
        <div className="seg" role="radiogroup" aria-label="Quality">
          {QUALITIES.map((q) => (
            <button key={q.id} role="radio" aria-checked={quality === q.id} className={quality === q.id ? "on" : ""} onClick={() => setQuality(q.id)}>
              {q.label}{q.id === device.recommended ? " ·  suggested" : ""}
            </button>
          ))}
        </div>
        <p className="muted">
          {area > 0
            ? `For this area, ${quality} works at about ${workingResolution(area, native, quality)} m (${dataset === "landsat" ? "Landsat, 30 m" : "Sentinel-2, 10 m"} native). `
            : ""}
          Higher quality downloads more data and needs more memory. Nothing is sent to an EarthPulse server.
        </p>
      </section>

      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={run}>Track water on this device</button>
      </div>
    </div>
  );
}

function YearPlayer({ result }: { result: WaterResult }) {
  const key = useStore((s) => s.overlay.key);
  const setOverlay = useStore((s) => s.setOverlay);
  const [playing, setPlaying] = useState(false);
  const years = result.series.filter((e) => e.status === "OBSERVED").map((e) => e.year);
  const index = years.findIndex((y) => `y${y}` === key);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const current = useStore.getState().overlay.key;
      const at = years.findIndex((y) => `y${y}` === current);
      if (at >= years.length - 1) setPlaying(false);
      else setOverlay({ key: `y${years[at + 1]}` });
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing]);

  return (
    <div className="player">
      <button className="icon-btn" aria-label={playing ? "Pause" : "Play through the years"}
        onClick={() => { if (!playing) setOverlay({ key: `y${years[index >= 0 && index < years.length - 1 ? index : 0]}` }); setPlaying(!playing); }}>
        {playing ? "❚❚" : "▶"}
      </button>
      <div className="seg" role="radiogroup" aria-label="Year shown on the globe">
        {years.map((y) => (
          <button key={y} role="radio" aria-checked={key === `y${y}`} className={key === `y${y}` ? "on" : ""}
            onClick={() => { setPlaying(false); setOverlay({ key: `y${y}` }); }}>{y}</button>
        ))}
      </div>
    </div>
  );
}

export function WaterResults({ result }: { result: WaterResult }) {
  const key = useStore((s) => s.overlay.key);
  const setOverlay = useStore((s) => s.setOverlay);
  const { summary: m, provenance: p } = result;
  const observed = result.series.filter((e) => e.status === "OBSERVED");
  const csv = () => downloadText(`${result.id}.csv`, "text/csv",
    ["year,period_start,period_end,status,water_ha,valid_fraction,platforms,scene_count",
      ...result.series.map((e) => [e.year, e.period[0], e.period[1], e.status, e.waterHa ?? "", e.validFraction.toFixed(3), e.platforms.join(" "), e.scenes.length].join(","))].join("\n"));

  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Surface water, {m.firstYear} to {m.lastYear}</h3>
        <div className="stats">
          <div className="stat water">
            <span>Water in {m.firstYear}</span>
            <strong>{formatArea(m.firstHa)}</strong>
            <em>of {formatArea(m.aoiAreaHa)}</em>
          </div>
          <div className="stat water">
            <span>Water in {m.lastYear}</span>
            <strong>{formatArea(m.lastHa)}</strong>
            <em>{m.changePercent === null ? "no water in the first year" : `${formatSigned(m.changePercent, 1)}% against ${m.firstYear}`}</em>
          </div>
        </div>
        <WaterSeriesChart series={result.series} />
        <p className="muted">
          {m.trendHaPerYear === null
            ? `A trend needs at least three well-observed years; ${m.trendYears} qualified.`
            : `Straight-line fit through ${m.trendYears} years: ${formatSigned(m.trendHaPerYear, 1)} ha per year. With this few points it describes these years and is not a forecast.`}
        </p>
      </section>

      <section>
        <h3>See it on the globe</h3>
        <YearPlayer result={result} />
        <div className="seg" role="radiogroup" aria-label="Summary maps">
          <button role="radio" aria-checked={key === "persistence"} className={key === "persistence" ? "on" : ""} onClick={() => setOverlay({ key: "persistence" })}>Persistence</button>
          <button role="radio" aria-checked={key === "change"} className={key === "change" ? "on" : ""} onClick={() => setOverlay({ key: "change" })}>Lost and gained</button>
        </div>
        <table className="table">
          <tbody>
            <tr><th scope="row"><i className="swatch" style={{ background: "#ff8a5c" }} aria-hidden="true" /> Water in {m.firstYear}, land in {m.lastYear}</th><td>{formatArea(m.lostHa)}</td></tr>
            <tr><th scope="row"><i className="swatch" style={{ background: "#5fd0c5" }} aria-hidden="true" /> Land in {m.firstYear}, water in {m.lastYear}</th><td>{formatArea(m.gainedHa)}</td></tr>
            <tr><th scope="row">Water in every observed year</th><td>{formatArea(m.permanentHa)}</td></tr>
            <tr><th scope="row">Water in some years only</th><td>{formatArea(m.occasionalHa)}</td></tr>
          </tbody>
        </table>
        <p className="muted">
          Water is MNDWI above {m.threshold}. {observed.length} of {result.series.length} years have a map; missing years are left empty.
          Computed in {p.seconds} s on this device at {p.workingResolutionM} m.
        </p>
      </section>

      <section>
        <h3>Export</h3>
        <div className="exports">
          <button className="link" onClick={csv}>CSV</button>
          <button className="link" onClick={() => downloadText(`${result.id}.json`, "application/json",
            JSON.stringify({ ...result, overlays: Object.fromEntries(Object.entries(result.overlays).map(([k, o]) => [k, { title: o.title, bounds: o.bounds, legend: o.legend }])) }, null, 1))}>
            Full record (JSON)
          </button>
          {key && result.overlays[key] && <a href={result.overlays[key].url} download={`${result.id}-${key}.png`}>Map shown (PNG)</a>}
        </div>
        <p className="muted">This result exists only in this browser tab. Export it to keep it.</p>
      </section>
    </div>
  );
}
