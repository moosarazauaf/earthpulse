/** HeatWatch: land surface temperature in the hot season, and how much cooler green ground is. */
import { useMemo, useState } from "react";

import { currentYear } from "../app/logic";
import { useStore } from "../app/store";
import type { HeatResult } from "../app/types";
import { projectAoi } from "../engine/geo";
import { hotSeason } from "../engine/heat";
import { AreaStep, DEFAULT_MAX_CLOUD } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";
import { Exports, ResultHeader } from "./Results";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const c = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${v.toFixed(1)} °C`);

export function HeatForm() {
  const s = useStore();
  const { device, quality, setQuality } = useDevice();
  const lat = useMemo(() => {
    if (!s.aoi) return 30;
    const b = projectAoi(s.aoi.geometry).lonLatBounds;
    return (b[1] + b[3]) / 2;
  }, [s.aoi]);
  const season = hotSeason(lat);
  const last = currentYear() - 1;
  const [year, setYear] = useState(last);
  const [compare, setCompare] = useState<number | "none">(2015);
  const [start, setStart] = useState<number | null>(null);
  const [end, setEnd] = useState<number | null>(null);
  const startMonth = start ?? season.startMonth, endMonth = end ?? season.endMonth;
  const running = s.job.status === "submitting" || s.job.status === "running";
  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (endMonth < startMonth) problem = "The season must end after it starts, within one year.";
  else if (compare !== "none" && compare >= year) problem = "The comparison year must be earlier.";

  const years = Array.from({ length: last - 1984 + 2 }, (_, i) => last + 1 - i).filter((y) => y <= currentYear());
  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Year and season</h3>
        <div className="pair">
          <label className="field">
            <span>Year</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}>{years.map((y) => <option key={y}>{y}</option>)}</select>
          </label>
          <label className="field">
            <span>Compare with</span>
            <select value={compare} onChange={(e) => setCompare(e.target.value === "none" ? "none" : Number(e.target.value))}>
              <option value="none">No comparison</option>
              {years.filter((y) => y < year).map((y) => <option key={y}>{y}</option>)}
            </select>
          </label>
        </div>
        <div className="pair">
          <label className="field">
            <span>From month</span>
            <select value={startMonth} onChange={(e) => setStart(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
          <label className="field">
            <span>To month</span>
            <select value={endMonth} onChange={(e) => setEnd(Number(e.target.value))}>{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
          </label>
        </div>
        <p className="muted">
          The hot season here is taken as {season.label}. Landsat passes at about 10:30 local time, so this is the ground
          temperature of a typical late morning, roofs and roads included; it is not air temperature and not the day&apos;s peak.
        </p>
      </section>
      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality} nativeRes={30} sensor="Landsat" />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runHeat({
            aoi: s.aoi.geometry, label: s.aoi.label, year, compareYear: compare === "none" ? null : compare,
            startMonth, endMonth, maxCloud: DEFAULT_MAX_CLOUD,
          }, device, quality);
        }}>
          Map surface temperature on this device
        </button>
      </div>
    </div>
  );
}

export function HeatResults({ result }: { result: HeatResult }) {
  const key = useStore((s) => s.overlay.key);
  const setOverlay = useStore((s) => s.setOverlay);
  const m = result.summary;
  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Surface temperature, {m.period[0]} to {m.period[1]}</h3>
        <div className="stats">
          <div className="stat heat"><span>Average</span><strong>{c(m.meanC)}</strong><em>median of clear scenes</em></div>
          <div className="stat heat"><span>Hottest tenth</span><strong>above {c(m.p90C)}</strong><em>coolest tenth below {c(m.p10C)}</em></div>
        </div>
        {m.contrast && (
          <p>
            Vegetated ground (NDVI 0.4 and above, {Math.round(m.contrast.greenShare * 100)}% of the area) averaged{" "}
            <strong>{c(m.contrast.green)}</strong>, bare or built ground ({Math.round(m.contrast.bareShare * 100)}%){" "}
            <strong>{c(m.contrast.bare)}</strong>: green ground was {(m.contrast.bare - m.contrast.green).toFixed(1)} °C cooler.
          </p>
        )}
        {m.comparison && (
          <p>
            Against {m.comparison.year}, the same season averaged {c(m.comparison.mean)}: {m.comparison.change >= 0 ? "+" : "−"}
            {Math.abs(m.comparison.change).toFixed(1)} °C.
          </p>
        )}
      </section>
      <section>
        <h3>See it on the globe</h3>
        <div className="seg" role="radiogroup" aria-label="Map">
          <button role="radio" aria-checked={key === "lst"} className={key === "lst" ? "on" : ""} onClick={() => setOverlay({ key: "lst" })}>Temperature {m.year}</button>
          {result.overlays.change && (
            <button role="radio" aria-checked={key === "change"} className={key === "change" ? "on" : ""} onClick={() => setOverlay({ key: "change" })}>
              Change since {m.comparison?.year}
            </button>
          )}
        </div>
        <p className="muted">Working at {result.provenance.workingResolutionM} m; the thermal band itself is 100 m. Computed in {result.provenance.seconds} s on this device.</p>
      </section>
      <Exports result={result} />
    </div>
  );
}
