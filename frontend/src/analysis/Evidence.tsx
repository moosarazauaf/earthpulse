/** The evidence behind a result: inputs, method, limits, and code to repeat it. */
import { useState } from "react";

import { ApiError, api } from "../app/api";
import { formatArea } from "../app/logic";
import { useStore } from "../app/store";
import type { AnalysisResult, SceneInfo } from "../app/types";
import { KindBadge } from "../ui/KindBadge";

function claim(result: AnalysisResult): string {
  if (result.type === "timeseries") {
    const years = result.series.filter((e) => e.values).map((e) => e.year);
    return `Mean spectral indices over the area were measured for ${years.length} years between ${years[0]} and ${years[years.length - 1]}.`;
  }
  if (result.type === "water") {
    const m = result.summary;
    return `Surface water covered ${formatArea(m.firstHa)} in ${m.firstYear} and ${formatArea(m.lastHa)} in ${m.lastYear}.`;
  }
  if (result.type === "flood") {
    return `${formatArea(result.summary.floodedAreaHa)} that was not water before ${result.request.before.end} was mapped as water between ${result.request.flood.start} and ${result.request.flood.end}.`;
  }
  const name = result.provenance.index?.name ?? "The index";
  return `${name} decreased by at least ${result.summary.threshold.toFixed(2)} on ${formatArea(result.summary.lossAreaHa)} and increased by at least that much on ${formatArea(result.summary.gainAreaHa)}.`;
}

const PERIOD_TITLES: Record<string, string> = { before: "Before", after: "After", flood: "During the flood" };

function Scenes({ title, scenes }: { title: string; scenes: SceneInfo[] }) {
  return (
    <details>
      <summary>{title}: {scenes.length} scenes</summary>
      <ul className="scenes">
        {scenes.map((s) => (
          <li key={s.id}>
            <code>{s.id}</code>
            <span>{s.datetime.slice(0, 10)} · {s.platform}{s.cloudCover === null || s.cloudCover === undefined ? "" : ` · ${s.cloudCover.toFixed(1)}% cloud`}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function GeeScript({ analysisId }: { analysisId: string }) {
  const set = useStore((s) => s.set);
  const [script, setScript] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setError(null);
    try {
      setScript((await api.geeScript(analysisId)).script);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "The script could not be generated.");
    }
  }

  return (
    <section>
      <h3>Reproduce in Earth Engine</h3>
      {!script && <button onClick={generate}>Generate GEE script</button>}
      {error && <p className="note">{error}</p>}
      {script && (
        <>
          <pre className="code" tabIndex={0} aria-label="Generated Earth Engine script">{script}</pre>
          <div className="actions">
            <button onClick={() => void navigator.clipboard.writeText(script).then(() => set({ notice: "Script copied." }))}>Copy code</button>
            <a className="button" href="https://code.earthengine.google.com/" target="_blank" rel="noreferrer">Open Code Editor</a>
          </div>
          <p className="muted">
            The script names the same scenes, masks, scaling, threshold and scale. Earth Engine resamples
            differently, so expect close but not identical numbers.
          </p>
        </>
      )}
    </section>
  );
}

export function Evidence({ result }: { result: AnalysisResult }) {
  const p = result.provenance;
  const rows: [string, string][] = [
    ["Dataset", p.dataset ? `${p.dataset.name} (${p.dataset.provider})` : "n/a"],
    ["Processing level", p.dataset?.processing_level ?? "n/a"],
    ["Accessed through", p.provider.name],
    ["Native resolution", `${p.nativeResolutionM} m`],
    ["Working resolution", `${p.workingResolutionM} m, ${p.crs}`],
  ];
  if (p.maxCloudPercent !== undefined) rows.push(["Cloud limit", `Scenes with at most ${p.maxCloudPercent}% cloud`]);
  if (p.cloudMask) rows.push(["Pixel mask", p.cloudMask]);
  if (p.index) rows.push(["Index", `${p.index.name} = ${p.index.formula} (${p.index.reference})`]);
  if (result.type === "change") {
    rows.push(["Before", `${result.request.before.start} to ${result.request.before.end}`]);
    rows.push(["After", `${result.request.after.start} to ${result.request.after.end}`]);
    rows.push(["Clear looks per pixel", `median ${result.summary.clearObservations.before} before, ${result.summary.clearObservations.after} after`]);
  }
  if (result.type === "flood") {
    rows.push(["Before", `${result.request.before.start} to ${result.request.before.end}`]);
    rows.push(["Flood", `${result.request.flood.start} to ${result.request.flood.end}`]);
    rows.push(["Polarisation", p.polarisation ?? "VV"]);
    rows.push(["Orbit", `Relative orbit ${p.relativeOrbit} (${p.orbitState}); coverage of the area by orbit: ${Object.entries(p.orbitCoverage ?? {}).map(([o, c]) => `${o}: ${(c * 100).toFixed(0)}%`).join(", ")}`]);
    if (p.threshold) rows.push(["Water threshold", `${p.threshold.valueDb} dB (${p.threshold.source}${p.threshold.separability !== null ? `, Otsu separability ${p.threshold.separability}` : ""})`]);
    if (p.speckleFilter) rows.push(["Speckle filter", p.speckleFilter]);
    if (p.landCover) rows.push(["Land cover", `${p.landCover.name} (${p.landCover.provider}), ${p.landCover.license}`]);
  }
  if (p.computedOn === "browser") {
    rows.push(["Computed", `In the visitor's browser (${p.device?.cores} threads${p.device?.memoryGb ? `, about ${p.device.memoryGb} GB` : ""}) in ${p.seconds} s`]);
  }
  rows.push(["Software", `EarthPulse ${result.softwareVersion}`]);
  rows.push(["License", p.dataset?.license ?? "n/a"]);

  return (
    <div className="results">
      <div className="result-head">
        <div><span className="eyebrow">Evidence · {result.id}</span><h2>{result.label ?? "Analysed area"}</h2></div>
        <KindBadge kind={result.valueKind} />
      </div>
      <section>
        <h3>Claim</h3>
        <blockquote>{claim(result)}</blockquote>
      </section>
      <section>
        <h3>Method</h3>
        <p>{p.method}</p>
        <dl className="facts">
          {rows.map(([k, v]) => (<div key={k}><dt>{k}</dt><dd>{v}</dd></div>))}
        </dl>
      </section>
      {p.scenes && (
        <section>
          <h3>Satellite scenes used</h3>
          {Object.entries(p.scenes).map(([period, scenes]) => (
            <Scenes key={period} title={PERIOD_TITLES[period] ?? period} scenes={scenes} />
          ))}
        </section>
      )}
      {(result.type === "timeseries" || result.type === "water") && (
        <section>
          <h3>Satellite scenes used</h3>
          {result.series.map((e) => e.scenes
            ? <Scenes key={e.year} title={String(e.year)} scenes={e.scenes} />
            : <p key={e.year} className="muted">{e.year}: {e.reason}</p>)}
        </section>
      )}
      <section>
        <h3>Uncertainty and limits</h3>
        <p>{p.uncertainty ?? "No formal accuracy assessment has been made for this result."}</p>
        {result.warnings.map((w) => <p key={w} className="note">{w}</p>)}
        {p.dataset && <p className="muted">{p.dataset.attribution}.</p>}
      </section>
      {result.type === "change" && p.provider.observed && <GeeScript analysisId={result.id} />}
    </div>
  );
}
