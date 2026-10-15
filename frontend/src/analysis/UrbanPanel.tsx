/** UrbanEye: where built-up land grew and what it replaced, from annual land-cover maps. */
import { useState } from "react";

import { formatArea, formatSigned } from "../app/logic";
import { useStore } from "../app/store";
import type { UrbanResult } from "../app/types";
import { PIXEL_BUDGET } from "../engine/client";
import { FIRST_YEAR, LAST_YEAR } from "../engine/urban";
import { AreaStep } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";
import { Exports, ResultHeader } from "./Results";
import { YearPlayer } from "./WaterPanel";

const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

export function UrbanForm() {
  const s = useStore();
  const { device, quality, setQuality } = useDevice();
  const [first, setFirst] = useState(FIRST_YEAR);
  const [last, setLast] = useState(LAST_YEAR);
  const running = s.job.status === "submitting" || s.job.status === "running";
  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (last <= first) problem = "The last year must come after the first year.";

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Years</h3>
        <div className="pair">
          <label className="field">
            <span>From</span>
            <select value={first} onChange={(e) => setFirst(Number(e.target.value))}>
              {YEARS.slice(0, -1).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={last} onChange={(e) => setLast(Number(e.target.value))}>
              {YEARS.slice(1).map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <p className="muted">
          Uses the Impact Observatory annual land-cover maps (10 m, {FIRST_YEAR} to {LAST_YEAR}), produced from
          Sentinel-2 by a machine-learning classifier. EarthPulse reads and counts them; it does not classify.
        </p>
      </section>
      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality} nativeRes={10} sensor="Land-cover maps" />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runUrban({
            aoi: s.aoi.geometry, label: s.aoi.label, firstYear: first, lastYear: last,
            maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency,
          }, device);
        }}>
          Map urban growth on this device
        </button>
      </div>
    </div>
  );
}

/** Built area per year as bars; the axis starts at zero so growth is not exaggerated. */
function BuiltChart({ series }: { series: UrbanResult["series"] }) {
  const top = Math.max(1, ...series.map((s) => s.builtHa));
  return (
    <figure className="chart">
      <div className="bars" role="img" aria-label="Built area for each year">
        {series.map((s) => (
          <div key={s.year} className="bar-col" title={`${s.year}: ${formatArea(s.builtHa)}`}>
            <span className="bar-fill" style={{ height: `${(s.builtHa / top) * 100}%` }} />
            <em>{String(s.year).slice(2)}</em>
          </div>
        ))}
      </div>
      <figcaption>Built area mapped in each year. The axis starts at zero.</figcaption>
    </figure>
  );
}

export function UrbanResults({ result }: { result: UrbanResult }) {
  const key = useStore((s) => s.overlay.key);
  const setOverlay = useStore((s) => s.setOverlay);
  const m = result.summary;
  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Built area, {m.firstYear} to {m.lastYear}</h3>
        <div className="stats">
          <div className="stat urban">
            <span>Built area in {m.firstYear}</span>
            <strong>{formatArea(m.builtFirstHa)}</strong>
            <em>of {formatArea(m.aoiAreaHa)}</em>
          </div>
          <div className="stat urban">
            <span>Built area in {m.lastYear}</span>
            <strong>{formatArea(m.builtLastHa)}</strong>
            <em>{m.growthPercent === null ? "none in the first year" : `${formatSigned(m.growthPercent, 1)}% against ${m.firstYear}`}</em>
          </div>
        </div>
        <BuiltChart series={result.series} />
        {m.trendHaPerYear !== null && (
          <p className="muted">Straight-line fit: {formatSigned(m.trendHaPerYear, 0)} ha of built area per year.</p>
        )}
      </section>
      <section>
        <h3>What the new built-up land was before</h3>
        {m.replaced.length === 0 ? <p className="muted">No new built-up land was mapped.</p> : (
          <table className="table">
            <tbody>
              {m.replaced.map((r) => (
                <tr key={r.class}><th scope="row">{r.class} in {m.firstYear}</th><td>{formatArea(r.ha)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="muted">{formatArea(m.newBuiltHa)} became built-up; {formatArea(m.lostBuiltHa)} went the other way.</p>
      </section>
      <section>
        <h3>See it on the globe</h3>
        <YearPlayer years={result.series.map((s) => s.year)} />
        <div className="seg" role="radiogroup" aria-label="Summary map">
          <button role="radio" aria-checked={key === "growth"} className={key === "growth" ? "on" : ""} onClick={() => setOverlay({ key: "growth" })}>
            Where it grew
          </button>
        </div>
        <p className="muted">Working at {result.provenance.workingResolutionM} m. Computed in {result.provenance.seconds} s on this device.</p>
      </section>
      <Exports result={result} />
    </div>
  );
}
