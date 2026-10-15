/** FireWatch: burn severity from Landsat or Sentinel-2, before and after a fire. */
import { useState } from "react";

import { formatArea } from "../app/logic";
import { useStore } from "../app/store";
import type { ChangeResult, Period } from "../app/types";
import { AreaStep } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";

const DEFAULT_MAX_CLOUD = 20;
/** An example: the August 2023 Maui (Lahaina) fire, Hawaii. */
const DEFAULTS = {
  before: { start: "2023-06-01", end: "2023-08-05" },
  after: { start: "2023-08-12", end: "2023-10-15" },
};

function Window({ legend, value, onChange }: { legend: string; value: Period; onChange: (p: Period) => void }) {
  return (
    <fieldset className="window">
      <legend>{legend}</legend>
      <input type="date" aria-label={`${legend}: from`} value={value.start} onChange={(e) => onChange({ ...value, start: e.target.value })} />
      <span aria-hidden="true">to</span>
      <input type="date" aria-label={`${legend}: to`} value={value.end} onChange={(e) => onChange({ ...value, end: e.target.value })} />
    </fieldset>
  );
}

export function FireForm() {
  const s = useStore();
  const { device, quality, setQuality } = useDevice();
  const [before, setBefore] = useState<Period>(DEFAULTS.before);
  const [after, setAfter] = useState<Period>(DEFAULTS.after);
  const [dataset, setDataset] = useState<"landsat" | "sentinel2">("sentinel2");
  const running = s.job.status === "submitting" || s.job.status === "running";

  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (before.end < before.start || after.end < after.start) problem = "Each window must end after it starts.";
  else if (after.start <= before.end) problem = "The after-fire window must start after the before-fire window ends.";
  else if (dataset === "sentinel2" && before.start < "2016-01-01") problem = "Sentinel-2 starts in 2016; use Landsat for earlier fires.";

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Before and after the fire</h3>
        <Window legend="Before the fire" value={before} onChange={setBefore} />
        <Window legend="After the fire" value={after} onChange={setAfter} />
        <div className="seg" role="radiogroup" aria-label="Satellite">
          {(["sentinel2", "landsat"] as const).map((id) => (
            <button key={id} role="radio" aria-checked={dataset === id} className={dataset === id ? "on" : ""} onClick={() => setDataset(id)}>
              {id === "sentinel2" ? "Sentinel-2 · 10 m" : "Landsat · 30 m"}
            </button>
          ))}
        </div>
        <p className="muted">
          Severity uses the dNBR classes of Key and Benson (2006), calibrated on Landsat; with Sentinel-2 treat them as a
          guide. Keep the after window short and close to the fire, before regrowth and seasonal change set in.
        </p>
      </section>
      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality}
        nativeRes={dataset === "landsat" ? 30 : 10} sensor={dataset === "landsat" ? "Landsat" : "Sentinel-2"} />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runFire({
            aoi: s.aoi.geometry, label: s.aoi.label, dataset, index: "nbr", before, after,
            threshold: 0.1, maxCloud: DEFAULT_MAX_CLOUD, minAreaHa: 1,
          }, device, quality);
        }}>
          Map burn severity on this device
        </button>
      </div>
    </div>
  );
}

/** Area in each dNBR severity class; shown inside the change results for NBR analyses. */
export function SeverityTable({ result }: { result: ChangeResult }) {
  const severity = result.summary.severity;
  if (!severity) return null;
  const burned = severity.filter((c) => (c.min ?? -Infinity) >= 0.1).reduce((a, c) => a + c.ha, 0);
  return (
    <section>
      <h3>Burn severity</h3>
      <div className="stats">
        <div className="stat fire">
          <span>Burned (low severity or worse)</span>
          <strong>{formatArea(burned)}</strong>
          <em>dNBR at least 0.10</em>
        </div>
      </div>
      <table className="table">
        <tbody>
          {severity.slice().reverse().map((c) => (
            <tr key={c.label}>
              <th scope="row"><i className="swatch" style={{ background: c.color }} aria-hidden="true" /> {c.label}</th>
              <td>{formatArea(c.ha)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        dNBR = NBR before minus NBR after, NBR = (NIR - SWIR2) / (NIR + SWIR2). Class limits from Key and Benson (2006).
        Not validated in the field here; cloud, smoke and harvests can also lower NBR.
      </p>
    </section>
  );
}
