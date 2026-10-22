/** Classify: land cover from the visitor's own training samples, with an accuracy assessment. */
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

import { currentYear, formatArea } from "../app/logic";
import { useStore } from "../app/store";
import type { ClassifyResult } from "../app/types";
import { AreaStep, DEFAULT_MAX_CLOUD, SEASONS } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";
import { AdjustedAreas } from "./AdjustedAreas";
import { Exports, ResultHeader } from "./Results";
import { rectangleAoi } from "../app/logic";
import { CLASS_COLOURS } from "../engine/palette";
import { getGlobe } from "../globe/GlobeViewer";
import { type SampleFile, parseSamples, readSampleFile, samplesFor } from "./samples";

const pct = (v: number | undefined) => (v === undefined || !Number.isFinite(v) ? "–" : `${Math.round(v * 100)}%`);

export function ClassifyForm() {
  const s = useStore();
  const { device, quality, setQuality } = useDevice();
  // Leaving Classify must give globe clicks back to markers and Analyse here.
  useEffect(() => () => {
    if (useStore.getState().drawTool === "sample") useStore.getState().set({ drawTool: "none" });
  }, []);
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<SampleFile | null>(null);
  const [field, setField] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [year, setYear] = useState(currentYear() - 1);
  const [seasonId, setSeasonId] = useState<(typeof SEASONS)[number]["id"]>("q4");
  const [dataset, setDataset] = useState<"sentinel2" | "landsat">("sentinel2");
  const season = SEASONS.find((x) => x.id === seasonId) ?? SEASONS[0];
  const running = s.job.status === "submitting" || s.job.status === "running";

  const drawn = s.drawnSamples;
  // Points clicked on the globe join the file's samples; each is its own feature, numbered after the file's.
  const samples = useMemo(() => {
    const fromFile = file && field ? samplesFor(file, field) : [];
    const offset = file ? file.features.length : 0;
    return [...fromFile, ...drawn.map((p, i) => ({ feature: offset + i, className: p.className, geometry: { type: "Point" as const, coordinates: [p.lon, p.lat] as [number, number] } }))];
  }, [file, field, drawn]);
  const classes = useMemo(() => [...new Set(samples.map((x) => x.className))].sort(), [samples]);
  // Drawn points take their colour from the same class order the map will use, file classes included.
  useEffect(() => {
    getGlobe()?.setSamples(drawn.map((p) => ({ ...p, colour: CLASS_COLOURS[classes.indexOf(p.className) % CLASS_COLOURS.length]! })));
  }, [drawn, classes]);
  useEffect(() => () => getGlobe()?.setSamples([]), []);
  const perClass = useMemo(() => classes.map((c) => ({ name: c, features: new Set(samples.filter((x) => x.className === c).map((x) => x.feature)).size })), [classes, samples]);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const chosen = event.target.files?.[0];
    event.target.value = "";
    if (!chosen) return;
    setError(null);
    try {
      const parsed = await readSampleFile(chosen);
      setFile(parsed);
      setField(parsed.fields.find((f) => /class|type|lulc|land|label|cover/i.test(f)) ?? parsed.fields[0]!);
    } catch (problem) {
      setFile(null);
      setError(problem instanceof Error ? problem.message : "The file could not be read.");
    }
  }

  async function loadExample() {
    setError(null);
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}data/examples/lahore-samples.geojson`);
      const parsed = parseSamples(await response.json(), "Lahore example (labels from ESA WorldCover 2021)");
      s.setAoi({ geometry: rectangleAoi(74.24, 31.49, 74.36, 31.61), label: "Lahore classification example" });
      setFile(parsed);
      setField("class");
      setYear(2021);
      setSeasonId("q4");
      setDataset("sentinel2");
    } catch {
      setError("The example could not be loaded.");
    }
  }

  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (samples.length === 0) problem = "Upload training samples, or draw them on the globe.";
  else if (classes.length < 2) problem = "The chosen attribute needs at least two classes.";
  else if (dataset === "sentinel2" && year < 2016) problem = "Sentinel-2 starts in 2016; use Landsat for earlier years.";

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Training samples</h3>
        <p className="muted">
          Points or polygons in a GeoJSON file or zipped shapefile, with the class of each in one attribute (for example
          &quot;Water&quot;, &quot;Built-up&quot;, &quot;Crops&quot;). Up to 12 classes. Read in your browser; never uploaded.
        </p>
        <div className="row-actions">
          <button onClick={() => input.current?.click()}>{file ? `Replace ${file.name}` : "Upload samples"}</button>
          <button className="link" onClick={() => void loadExample()}>Try the Lahore example</button>
        </div>
        <input ref={input} type="file" hidden accept=".zip,.geojson,.json" aria-label="Upload training samples" onChange={onFile} />
        {error && <p className="note" role="alert">{error}</p>}
        <div className="draw-samples">
          <label className="field">
            <span>Or draw them: class for the next clicks</span>
            <input type="text" list="sample-classes" maxLength={30} value={s.sampleClass} placeholder="e.g. Water"
              onChange={(e) => s.set({ sampleClass: e.target.value })} />
            <datalist id="sample-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist>
          </label>
          <div className="row-actions">
            <button className={s.drawTool === "sample" ? "on" : ""} aria-pressed={s.drawTool === "sample"} disabled={!s.sampleClass.trim()}
              onClick={() => s.set({ drawTool: s.drawTool === "sample" ? "none" : "sample", sampleClass: s.sampleClass.trim() })}>
              {s.drawTool === "sample" ? "Stop drawing" : "Draw points on the globe"}
            </button>
            {drawn.length > 0 && <button className="link" onClick={() => s.set({ drawnSamples: drawn.slice(0, -1) })}>Undo last</button>}
            {drawn.length > 0 && <button className="link" onClick={() => s.set({ drawnSamples: [] })}>Clear drawn ({drawn.length})</button>}
          </div>
        </div>
        {samples.length > 0 && (
          <>
            {file && <label className="field">
              <span>Attribute holding the class</span>
              <select value={field} onChange={(e) => setField(e.target.value)}>
                {file.fields.map((f) => <option key={f}>{f}</option>)}
              </select>
            </label>}
            <ul className="class-list">
              {perClass.map((c) => (
                <li key={c.name}><strong>{c.name}</strong> · {c.features} {c.features === 1 ? "feature" : "features"}{c.features < 2 ? " (too few to test)" : ""}</li>
              ))}
            </ul>
            <p className="muted">30% of each class&apos;s features are held back to test the map; pixels from one polygon never sit on both sides.</p>
          </>
        )}
      </section>
      <section>
        <h3>3. Imagery</h3>
        <div className="pair">
          <label className="field">
            <span>Year</span>
            <input type="number" min={dataset === "landsat" ? 1984 : 2016} max={currentYear()} value={year} onChange={(e) => setYear(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Season</span>
            <select value={seasonId} onChange={(e) => setSeasonId(e.target.value as typeof seasonId)}>
              {SEASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </select>
          </label>
        </div>
        <div className="seg" role="radiogroup" aria-label="Satellite">
          {(["sentinel2", "landsat"] as const).map((id) => (
            <button key={id} role="radio" aria-checked={dataset === id} className={dataset === id ? "on" : ""} onClick={() => setDataset(id)}>
              {id === "sentinel2" ? "Sentinel-2 · 10 m" : "Landsat · 30 m"}
            </button>
          ))}
        </div>
        <p className="muted">Pick the season your samples describe: crops and water look different in each.</p>
      </section>
      <DeviceStep step={4} device={device} quality={quality} setQuality={setQuality} nativeRes={dataset === "landsat" ? 30 : 10} sensor={dataset === "landsat" ? "Landsat" : "Sentinel-2"} />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runClassify({
            aoi: s.aoi.geometry, label: s.aoi.label, dataset, year, startMonth: season.start, endMonth: season.end,
            maxCloud: DEFAULT_MAX_CLOUD, classes, samples: samples.map((x) => ({ ...x, classIndex: classes.indexOf(x.className) })),
            testShare: 0.3, seed: 1,
          }, device, quality);
        }}>
          Classify on this device
        </button>
      </div>
    </div>
  );
}

export function ClassifyResults({ result }: { result: ClassifyResult }) {
  const m = result.summary;
  const a = m.accuracy;
  const names = result.request.classes;
  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Land cover, {result.request.year}</h3>
        <ul className="cover-bars">
          {m.classes.map((c) => (
            <li key={c.name}>
              <span className="swatch" style={{ background: c.colour }} aria-hidden="true" />
              <span className="name">{c.name}</span>
              <span className="bar"><i style={{ width: `${Math.max(c.share > 0 ? 1 : 0, c.share * 100)}%` }} /></span>
              <span className="pct">{formatArea(c.ha)}</span>
            </li>
          ))}
        </ul>
        <p className="muted">Mapped areas are pixel counts; with a confusion matrix like the one below, error-adjusted areas (Olofsson et al. 2014) are the ones to report.</p>
      </section>
      <section>
        <h3>Accuracy on held-back samples</h3>
        {!a ? <p className="note">No test samples: each class needs at least two features for one to be held back.</p> : (
          <>
            <div className="stats">
              <div className="stat"><span>Overall accuracy</span><strong>{pct(a.overall)}</strong><em>{a.n} test pixels</em></div>
              <div className="stat"><span>Kappa</span><strong>{a.kappa.toFixed(2)}</strong><em>agreement beyond chance</em></div>
            </div>
            <div className="matrix-wrap">
              <table className="table matrix">
                <caption className="muted">Rows: your test samples. Columns: what the map says.</caption>
                <thead><tr><th scope="col" /><>{names.map((n) => <th key={n} scope="col">{n}</th>)}</><th scope="col">Producer&apos;s</th></tr></thead>
                <tbody>
                  {names.map((n, i) => (
                    <tr key={n}>
                      <th scope="row">{n}</th>
                      {a.matrix[i]!.map((v, j) => <td key={j} className={i === j ? "diag" : v ? "off" : ""}>{v}</td>)}
                      <td>{pct(a.producers[i])}</td>
                    </tr>
                  ))}
                  <tr><th scope="row">User&apos;s</th>{a.users.map((u, j) => <td key={j}>{pct(u)}</td>)}<td /></tr>
                </tbody>
              </table>
            </div>
            <p className="muted">
              Producer&apos;s accuracy: how much of each class on the ground the map found. User&apos;s accuracy: how often the
              map is right when it shows that class.
            </p>
          </>
        )}
      </section>
      <AdjustedAreas result={result} />
      <section>
        <h3>What the classifier relied on</h3>
        <ul className="cover-bars">
          {m.importance.slice(0, 5).map((f) => (
            <li key={f.name}>
              <span className="swatch" aria-hidden="true" />
              <span className="name">{f.name}</span>
              <span className="bar"><i style={{ width: `${f.value * 100}%` }} /></span>
              <span className="pct">{Math.round(f.value * 100)}%</span>
            </li>
          ))}
        </ul>
        <p className="muted">
          Mean decrease in Gini impurity. Trained on {m.trainPixels} pixels; working at {result.provenance.workingResolutionM} m;
          computed in {result.provenance.seconds} s on this device.
        </p>
      </section>
      <Exports result={result} />
    </div>
  );
}
