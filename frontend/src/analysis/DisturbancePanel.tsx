/** ForestEye before 2017: canopy loss from the Landsat record, and the choice between the two forest methods. */
import { useMemo, useState } from "react";

import { formatArea } from "../app/logic";
import { useStore } from "../app/store";
import type { DisturbanceResult } from "../app/types";
import { projectAoi } from "../engine/geo";
import { hotSeason } from "../engine/heat";
import { TREES } from "../engine/urban";
import { AreaStep, DEFAULT_MAX_CLOUD, seriesYears } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";
import { Exports, ResultHeader } from "./Results";
import { UrbanForm } from "./UrbanPanel";

/** Forests offers two methods: the recent land-cover maps, and the long Landsat record. */
export function ForestForms() {
  const [method, setMethod] = useState<"maps" | "landsat">("maps");
  return (
    <>
      <div className="seg" role="radiogroup" aria-label="Method">
        <button role="radio" aria-checked={method === "maps"} className={method === "maps" ? "on" : ""} onClick={() => setMethod("maps")}>Tree cover 2017–2023</button>
        <button role="radio" aria-checked={method === "landsat"} className={method === "landsat" ? "on" : ""} onClick={() => setMethod("landsat")}>Canopy loss since 1985</button>
      </div>
      {method === "maps" ? <UrbanForm focus={TREES} /> : <DisturbanceForm />}
    </>
  );
}

export function DisturbanceForm() {
  const s = useStore();
  const { device, quality, setQuality } = useDevice();
  const [first, setFirst] = useState(1988);
  const [last, setLast] = useState(2016);
  const [points, setPoints] = useState(8);
  const lat = useMemo(() => {
    if (!s.aoi) return 30;
    const b = projectAoi(s.aoi.geometry).lonLatBounds;
    return (b[1] + b[3]) / 2;
  }, [s.aoi]);
  const season = hotSeason(lat);
  const years = seriesYears(first, last, points);
  const running = s.job.status === "submitting" || s.job.status === "running";
  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (first < 1984 || last <= first) problem = "Choose years from 1984 on, the last after the first.";

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Years</h3>
        <div className="pair">
          <label className="field"><span>First year</span><input type="number" min={1984} max={last - 1} value={first} onChange={(e) => setFirst(Number(e.target.value))} /></label>
          <label className="field"><span>Last year</span><input type="number" min={first + 1} max={new Date().getUTCFullYear() - 1} value={last} onChange={(e) => setLast(Number(e.target.value))} /></label>
        </div>
        <div className="seg" role="radiogroup" aria-label="Number of composites">
          {[5, 8, 12].map((p) => (
            <button key={p} role="radio" aria-checked={points === p} className={points === p ? "on" : ""} onClick={() => setPoints(p)}>{p} years</button>
          ))}
        </div>
        <p className="muted">
          Years: {years.join(", ")}, each a Landsat composite of {season.label}. A drop in the burn ratio (NBR) of at least 0.25 on
          dense canopy counts as canopy loss and is dated to the later year. More years catch more short-lived clearing but take longer.
        </p>
      </section>
      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality} nativeRes={30} sensor="Landsat" />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runDisturbance({
            aoi: s.aoi.geometry, label: s.aoi.label, years, startMonth: season.startMonth, endMonth: season.endMonth,
            threshold: 0.25, forestNbr: 0.4, maxCloud: DEFAULT_MAX_CLOUD + 10,
          }, device, quality);
        }}>
          Map canopy loss on this device
        </button>
      </div>
    </div>
  );
}

export function DisturbanceResults({ result }: { result: DisturbanceResult }) {
  const m = result.summary;
  const top = Math.max(1, ...m.periods.map((p) => p.ha));
  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Canopy loss, {m.years[0]} to {m.years[m.years.length - 1]}</h3>
        <div className="stats">
          <div className="stat forest"><span>Dense canopy in {m.years[0]}</span><strong>{formatArea(m.forestHa)}</strong><em>of {formatArea(m.aoiAreaHa)}</em></div>
          <div className="stat forest"><span>Canopy loss detected</span><strong>{formatArea(m.disturbedHa)}</strong><em>{m.forestHa > 0 ? `${Math.round((m.disturbedHa / m.forestHa) * 100)}% of that canopy` : ""}</em></div>
        </div>
        <figure className="chart">
          <div className="bars" role="img" aria-label="Canopy loss in each period">
            {m.periods.map((p) => (
              <div key={p.to} className="bar-col" title={`${p.from} to ${p.to}: ${formatArea(p.ha)}`}>
                <span className="bar-fill" style={{ height: `${(p.ha / top) * 100}%` }} />
                <em>{String(p.to).slice(2)}</em>
              </div>
            ))}
          </div>
          <figcaption>Canopy loss dated to the end of each gap between composites.</figcaption>
        </figure>
        <p className="muted">Working at {result.provenance.workingResolutionM} m. Computed in {result.provenance.seconds} s on this device.</p>
      </section>
      <Exports result={result} />
    </div>
  );
}
