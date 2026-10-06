/** FloodLens: set up a Sentinel-1 flood analysis and read its result. */
import { useState } from "react";

import { HOSTED } from "../app/api";
import { formatArea } from "../app/logic";
import { useStore } from "../app/store";
import type { FloodResult, Period } from "../app/types";
import { STORED_FLOOD } from "../demo/stored";
import { REPOSITORY_URL } from "../ui/Credit";
import { AreaStep } from "./AnalysisForm";
import { BackscatterHistogram } from "./charts";
import { Exports, ResultHeader } from "./Results";

const MAX_LISTED_REGIONS = 8;
const SENTINEL1_START = "2014-10-01";
/** Example windows: the 2022 monsoon flood on the Indus. */
const DEFAULTS = {
  before: { start: "2022-05-15", end: "2022-06-15" },
  flood: { start: "2022-08-25", end: "2022-09-10" },
  after: { start: "2022-11-01", end: "2022-11-30" },
};

function Window({ legend, value, onChange }: { legend: string; value: Period; onChange: (p: Period) => void }) {
  return (
    <fieldset className="window">
      <legend>{legend}</legend>
      <input type="date" aria-label={`${legend}: from`} min={SENTINEL1_START} value={value.start}
        onChange={(e) => onChange({ ...value, start: e.target.value })} />
      <span aria-hidden="true">to</span>
      <input type="date" aria-label={`${legend}: to`} min={SENTINEL1_START} value={value.end}
        onChange={(e) => onChange({ ...value, end: e.target.value })} />
    </fieldset>
  );
}

export function FloodForm() {
  const s = useStore();
  const [before, setBefore] = useState<Period>(DEFAULTS.before);
  const [flood, setFlood] = useState<Period>(DEFAULTS.flood);
  const [after, setAfter] = useState<Period>(DEFAULTS.after);
  const [useAfter, setUseAfter] = useState(true);
  const [threshold, setThreshold] = useState("");
  const running = s.job.status === "submitting" || s.job.status === "running";

  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (before.end < before.start || flood.end < flood.start || (useAfter && after.end < after.start)) {
    problem = "Each window must end after it starts.";
  } else if (flood.start <= before.end) problem = "The flood window must start after the 'before' window ends.";
  else if (useAfter && after.start <= flood.end) problem = "The 'after' window must start after the flood window ends.";

  function run() {
    if (!s.aoi || problem) return;
    const parsed = Number(threshold);
    void s.runFlood({
      aoi: s.aoi.geometry,
      label: s.aoi.label,
      before,
      flood,
      after: useAfter ? after : undefined,
      thresholdDb: threshold && parsed <= -5 && parsed >= -30 ? parsed : undefined,
      minAreaHa: 1,
    });
  }

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Dates</h3>
        <Window legend="Before the flood" value={before} onChange={setBefore} />
        <Window legend="During the flood" value={flood} onChange={setFlood} />
        <label className="check">
          <input type="checkbox" checked={useAfter} onChange={(e) => setUseAfter(e.target.checked)} />
          <span>Also check how much had receded</span>
        </label>
        {useAfter && <Window legend="After the flood" value={after} onChange={setAfter} />}
        <label className="field">
          <span>Water threshold (VV, dB)</span>
          <input type="number" min={-30} max={-5} step={0.5} value={threshold} placeholder="Chosen from the data (Otsu)"
            onChange={(e) => setThreshold(e.target.value)} />
        </label>
        <p className="muted">
          Uses Sentinel-1 radar, which sees through cloud. Each window should span at least 12 days so
          the same orbit passes over. Water under crops or between buildings is not detected.
        </p>
      </section>
      {HOSTED ? (
        <section>
          <p className="note">
            This hosted demo has no analysis service, so it cannot run a new flood analysis. Run EarthPulse
            locally for your own area, or open a stored result that the backend computed.
          </p>
          <div className="actions">
            <button className="primary" onClick={() => void s.loadAnalysis(STORED_FLOOD.id)}>
              Open stored analysis: {STORED_FLOOD.title}
            </button>
            <a className="button" href={REPOSITORY_URL} target="_blank" rel="noreferrer">Run it locally</a>
          </div>
        </section>
      ) : (
        <>
          {problem && <p className="note" role="status">{problem}</p>}
          <div className="actions">
            <button className="primary" disabled={!!problem || running} onClick={run}>Map the flood</button>
          </div>
        </>
      )}
    </div>
  );
}

export function FloodResults({ result }: { result: FloodResult }) {
  const selected = useStore((s) => s.selectedDetection);
  const set = useStore((s) => s.set);
  const { summary, provenance, landCover } = result;
  const span = (p: Period) => `${p.start} to ${p.end}`;
  const regions = result.detections.features;
  const [low, high] = summary.thresholdSensitivity;
  const SOURCES = { otsu: "chosen by Otsu's method", user: "set by you", fallback: "a fixed fallback" };
  const source = SOURCES[provenance.threshold?.source ?? "fallback"];

  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Flood extent</h3>
        <p className="muted">{span(result.request.before)} compared with {span(result.request.flood)}</p>
        <div className="stats">
          <div className="stat flood">
            <span>Newly flooded</span>
            <strong>{formatArea(summary.floodedAreaHa)}</strong>
            <em>{summary.floodedPercent.toFixed(1)}% of the analysed area</em>
          </div>
          <div className="stat water">
            <span>Water already present before</span>
            <strong>{formatArea(summary.preExistingWaterHa)}</strong>
            <em>not counted as flood</em>
          </div>
        </div>
        <p className="muted">
          Water is VV backscatter below {summary.thresholdDb.toFixed(1)} dB ({source}); a flooded pixel must
          also have fallen by {summary.minDropDb} dB. One decibel either way gives{" "}
          {low ? formatArea(low.floodedAreaHa) : "n/a"} to {high ? formatArea(high.floodedAreaHa) : "n/a"}.
        </p>
        <BackscatterHistogram edges={result.histogram.binEdges} counts={result.histogram.counts}
          threshold={summary.thresholdDb} />
      </section>

      {landCover && (
        <section>
          <h3>Land flooded, by cover</h3>
          <table className="table">
            <tbody>
              <tr><th scope="row">Cropland</th><td>{formatArea(landCover.croplandFloodedHa)}</td></tr>
              <tr><th scope="row">Built-up</th><td>{formatArea(landCover.builtUpFloodedHa)}</td></tr>
              <tr><th scope="row">Other cover</th><td>{formatArea(landCover.otherFloodedHa)}</td></tr>
            </tbody>
          </table>
          <p className="muted">{landCover.note}</p>
        </section>
      )}

      {summary.recession && (
        <section>
          <h3>Recession by {result.request.after?.end}</h3>
          <table className="table">
            <tbody>
              <tr><th scope="row">Still water</th><td>{formatArea(summary.recession.stillWaterHa)}</td></tr>
              <tr><th scope="row">No longer water</th><td>{formatArea(summary.recession.recededHa)}</td></tr>
              {summary.recession.notObservedHa > 0 && (
                <tr><th scope="row">Not observed</th><td>{formatArea(summary.recession.notObservedHa)}</td></tr>
              )}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h3>Largest flooded areas</h3>
        {regions.length === 0 ? (
          <p className="muted">No contiguous flooded area reached the minimum size.</p>
        ) : (
          <>
            <ul className="regions">
              {regions.slice(0, MAX_LISTED_REGIONS).map((f) => (
                <li key={f.id}>
                  <button className={selected?.id === f.id ? "on" : ""} onClick={() => set({ selectedDetection: f })}>
                    <i className="swatch flood" aria-hidden="true" />
                    <span>{formatArea(f.properties.areaHa)}</span>
                    <em>VV {f.properties.before?.toFixed(1)} → {f.properties.after?.toFixed(1)} dB</em>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted">
              {result.detections.totalRegions.toLocaleString("en")} areas of at least {result.request.minAreaHa} ha.
              Orbit {provenance.relativeOrbit} ({provenance.orbitState}), {provenance.workingResolutionM} m.
              Select one to fly to it.
            </p>
          </>
        )}
      </section>
      <Exports result={result} />
    </div>
  );
}
