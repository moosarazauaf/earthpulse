/**
 * UrbanEye and ForestEye: one land-cover class through the annual maps.
 * UrbanEye follows built area, ForestEye follows trees.
 */
import { useState } from "react";

import { formatArea, formatSigned } from "../app/logic";
import { useStore } from "../app/store";
import type { UrbanResult } from "../app/types";
import { PIXEL_BUDGET } from "../engine/client";
import { BUILT, FIRST_YEAR, type FocusClass, LAST_YEAR, TREES } from "../engine/urban";
import { AreaStep } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";
import { Exports, ResultHeader } from "./Results";
import { YearPlayer } from "./WaterPanel";

const YEARS = Array.from({ length: LAST_YEAR - FIRST_YEAR + 1 }, (_, i) => FIRST_YEAR + i);

/** Words for each class, so the two tools read naturally and claim no more than the maps show. */
const WORDS: Record<number, { thing: string; run: string; gained: string; lost: string; gainedFrom: string; lostTo: string; map: string }> = {
  [BUILT]: {
    thing: "Built area", run: "Map urban growth on this device", gained: "became built-up", lost: "went the other way",
    gainedFrom: "What the new built-up land was before", lostTo: "What former built-up land is mapped as now", map: "Where it grew",
  },
  [TREES]: {
    thing: "Tree cover", run: "Map tree cover change on this device", gained: "was gained", lost: "was lost",
    gainedFrom: "What new tree cover was before", lostTo: "What the lost tree cover became", map: "Gains and losses",
  },
};

export function UrbanForm({ focus = BUILT }: { focus?: FocusClass }) {
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
          {focus === TREES ? " The Trees class is tall, dense vegetation; leaving it is not the same as deforestation." : ""}
        </p>
      </section>
      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality} nativeRes={10} sensor="Land-cover maps" />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runUrban({
            aoi: s.aoi.geometry, label: s.aoi.label, firstYear: first, lastYear: last, focus,
            maxPixels: PIXEL_BUDGET[quality], concurrency: device.concurrency,
          }, device);
        }}>
          {WORDS[focus]!.run}
        </button>
      </div>
    </div>
  );
}

/** Area of the class per year as bars; the axis starts at zero so change is not exaggerated. */
function ClassChart({ series, thing }: { series: UrbanResult["series"]; thing: string }) {
  const top = Math.max(1, ...series.map((s) => s.focusHa));
  return (
    <figure className="chart">
      <div className="bars" role="img" aria-label={`${thing} for each year`}>
        {series.map((s) => (
          <div key={s.year} className="bar-col" title={`${s.year}: ${formatArea(s.focusHa)}`}>
            <span className="bar-fill" style={{ height: `${(s.focusHa / top) * 100}%` }} />
            <em>{String(s.year).slice(2)}</em>
          </div>
        ))}
      </div>
      <figcaption>{thing} mapped in each year. The axis starts at zero.</figcaption>
    </figure>
  );
}

function ClassTable({ rows, firstYear, empty, when }: { rows: { class: string; ha: number }[]; firstYear: number; empty: string; when: string }) {
  if (rows.length === 0) return <p className="muted">{empty}</p>;
  return (
    <table className="table">
      <tbody>
        {rows.slice(0, 6).map((r) => (
          <tr key={r.class}><th scope="row">{r.class} {when === "before" ? `in ${firstYear}` : "now"}</th><td>{formatArea(r.ha)}</td></tr>
        ))}
      </tbody>
    </table>
  );
}

export function UrbanResults({ result }: { result: UrbanResult }) {
  const key = useStore((s) => s.overlay.key);
  const setOverlay = useStore((s) => s.setOverlay);
  const m = result.summary;
  const w = WORDS[m.focus] ?? WORDS[BUILT]!;
  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>{w.thing}, {m.firstYear} to {m.lastYear}</h3>
        <div className="stats">
          <div className={`stat ${m.focus === TREES ? "forest" : "urban"}`}>
            <span>{w.thing} in {m.firstYear}</span>
            <strong>{formatArea(m.firstHa)}</strong>
            <em>of {formatArea(m.aoiAreaHa)}</em>
          </div>
          <div className={`stat ${m.focus === TREES ? "forest" : "urban"}`}>
            <span>{w.thing} in {m.lastYear}</span>
            <strong>{formatArea(m.lastHa)}</strong>
            <em>{m.changePercent === null ? "none in the first year" : `${formatSigned(m.changePercent, 1)}% against ${m.firstYear}`}</em>
          </div>
        </div>
        <ClassChart series={result.series} thing={w.thing} />
        {m.trendHaPerYear !== null && (
          <p className="muted">Straight-line fit: {formatSigned(m.trendHaPerYear, 0)} ha a year.</p>
        )}
        <p className="muted">{formatArea(m.gainedHa)} {w.gained}; {formatArea(m.lostHa)} {w.lost}.</p>
      </section>
      <section>
        <h3>{m.focus === TREES ? w.lostTo : w.gainedFrom}</h3>
        {m.focus === TREES
          ? <ClassTable rows={m.lostTo} firstYear={m.firstYear} when="now" empty="No tree cover left the Trees class." />
          : <ClassTable rows={m.gainedFrom} firstYear={m.firstYear} when="before" empty="No new built-up land was mapped." />}
        {m.focus === TREES && m.gainedFrom.length > 0 && (
          <>
            <h3>{w.gainedFrom}</h3>
            <ClassTable rows={m.gainedFrom} firstYear={m.firstYear} when="before" empty="" />
          </>
        )}
      </section>
      <section>
        <h3>See it on the globe</h3>
        <YearPlayer years={result.series.map((s) => s.year)} />
        <div className="seg" role="radiogroup" aria-label="Summary map">
          <button role="radio" aria-checked={key === "growth"} className={key === "growth" ? "on" : ""} onClick={() => setOverlay({ key: "growth" })}>
            {w.map}
          </button>
        </div>
        <p className="muted">Working at {result.provenance.workingResolutionM} m. Computed in {result.provenance.seconds} s on this device.</p>
      </section>
      <Exports result={result} />
    </div>
  );
}
