/** Results of a finished analysis: numbers, charts, regions, exports. */
import { useState } from "react";

import { HOSTED, absolute, api } from "../app/api";
import { formatArea, formatIndex, formatSigned } from "../app/logic";
import { useStore } from "../app/store";
import { type AnalysisResult, type ChangeResult, type IndexId, type TimeSeriesResult, hasLayers, isMapped } from "../app/types";
import { KindBadge } from "../ui/KindBadge";
import { shareUrl } from "../ui/TopBar";
import { downloadBlob, downloadText } from "./download";
import { rasterReadme, rasterToGeoTiff } from "./geotiffExport";
import { SeverityTable } from "./FirePanel";
import { PeopleAffected } from "./PeopleAffected";
import { ShareRunButton } from "./SharedRun";
import { ChangeHistogram, SeriesChart } from "./charts";
import { resultCsv } from "./csv";
import { methodsText } from "./methods";
import { NotReproducible, changeScript } from "./geeScript";

const MAX_LISTED_REGIONS = 8;
const INDEX_ROWS: { id: IndexId; label: string }[] = [
  { id: "ndvi", label: "NDVI · vegetation" },
  { id: "mndwi", label: "MNDWI · water" },
  { id: "ndbi", label: "NDBI · built-up / bare" },
];

export function ResultHeader({ result }: { result: AnalysisResult }) {
  const set = useStore((s) => s.set);
  const created = useStore((s) => s.job.record?.createdAt);
  return (
    <>
      <div className="result-head">
        <div>
          <span className="eyebrow">Analysis {result.id}</span>
          <h2>{result.label ?? "Analysed area"}</h2>
        </div>
        <KindBadge kind={result.valueKind} />
      </div>
      {HOSTED && result.provenance.computedOn !== "browser" && (
        <p className="muted">
          Stored result{created ? `, computed by the EarthPulse backend on ${created.slice(0, 10)}` : ""}. This hosted
          demo displays it; it did not compute it in your browser.
        </p>
      )}
      {result.valueKind === "SIMULATED" && (
        <p className="note">This result was computed on synthetic demo data. It is not a satellite observation.</p>
      )}
      {result.warnings.map((w) => <p key={w} className="note">{w}</p>)}
      <div className="actions">
        <button onClick={() => set({ mode: "research" })}>View evidence</button>
        {result.provenance.computedOn !== "browser" && <button onClick={() => {
          const url = shareUrl();
          window.history.replaceState(null, "", url);
          void navigator.clipboard?.writeText(url).then(
            () => set({ notice: "Link to this analysis copied to the clipboard." }),
            () => set({ notice: "The link to this analysis is now in the address bar." }),
          );
        }}>Share analysis</button>}
      </div>
    </>
  );
}

/** Results computed in this tab are saved from the browser; there is no server copy to link to. */
/** Copies a methods paragraph and references written from the result's provenance; downloads it if copying is refused. */
export function MethodsButton({ result }: { result: AnalysisResult }) {
  const [copied, setCopied] = useState(false);
  return (
    <button className="link" title="A methods paragraph and references for a paper or report, written from this result's record" onClick={() => {
      const text = methodsText(result);
      navigator.clipboard.writeText(text).then(() => setCopied(true), () => downloadText(`${result.id}-methods.txt`, "text/plain", text));
    }}>{copied ? "Methods copied" : "Methods text"}</button>
  );
}

function BrowserExports({ result }: { result: AnalysisResult }) {
  const key = useStore((s) => s.overlay.key);
  const overlays: Record<string, { url: string; title: string; bounds: number[]; legend: unknown }> = hasLayers(result) ? result.overlays : {};
  const shown = key ? overlays[key] : undefined;
  const { raster, ...plain } = result;
  const record = () => JSON.stringify({
    ...plain,
    // Image data stays in the tab; the record keeps where each image belongs.
    overlays: Object.fromEntries(Object.entries(overlays).map(([k, o]) => [k, { title: o.title, bounds: o.bounds, legend: o.legend }])),
  }, null, 1);
  const regions = () => JSON.stringify({
    ...(isMapped(result) ? result.detections : {}),
    earthpulse: { id: result.id, softwareVersion: result.softwareVersion, valueKind: result.valueKind, provenance: result.provenance, warnings: result.warnings },
  });
  const table = resultCsv(result);
  let script: string | null = null;
  try {
    if (result.type === "change") script = changeScript(result);
  } catch (error) {
    if (!(error instanceof NotReproducible)) throw error;
  }
  return (
    <section>
      <h3>Export</h3>
      <div className="exports">
        {isMapped(result) && <button className="link" onClick={() => downloadText(`${result.id}.geojson`, "application/geo+json", regions())}>Regions (GeoJSON)</button>}
        {table && <button className="link" onClick={() => downloadText(`${result.id}.csv`, "text/csv", table)}>Table (CSV)</button>}
        {raster && (
          <button className="link" title={`${raster.description} Opens in QGIS, ArcGIS or GDAL.`} onClick={() => {
            downloadBlob(`${result.id}-${raster.name}.tif`, new Blob([rasterToGeoTiff(raster)], { type: "image/tiff" }));
            downloadText(`${result.id}-${raster.name}.txt`, "text/plain", rasterReadme(raster, result.id));
          }}>Raster (GeoTIFF)</button>
        )}
        <button className="link" onClick={() => downloadText(`${result.id}.json`, "application/json", record())}>Full record (JSON)</button>
        {script && <button className="link" onClick={() => downloadText(`${result.id}.js`, "text/javascript", script)} title="Repeats this analysis in Google Earth Engine with the same scenes">Earth Engine script</button>}
        {shown && key && <a href={shown.url} download={`${result.id}-${key}.png`}>Map shown (PNG)</a>}
        <MethodsButton result={result} />
        <ShareRunButton result={result} />
      </div>
      <p className="muted">
        Computed in {result.provenance.seconds} s on this device. The result exists only in this browser tab; export it to keep it.
        {isMapped(result) ? "Regions are saved as traced outlines with their true areas." : ""}
      </p>
    </section>
  );
}

export function Exports({ result }: { result: AnalysisResult }) {
  if (result.type === "water") return null; // WaterWatch has its own export section
  if (result.provenance.computedOn === "browser") return <BrowserExports result={result} />;
  const observed = result.provenance.provider.observed;
  return (
    <section>
      <h3>Export</h3>
      <div className="exports">
        {isMapped(result) && <a href={api.exportUrl(result.id, "geojson")}>GeoJSON</a>}
        <a href={api.exportUrl(result.id, "csv")}>CSV</a>
        <a href={api.exportUrl(result.id, "json")}>Full record (JSON)</a>
        {result.type === "change" && <a href={absolute(result.overlays.change.geotiff)}>GeoTIFF</a>}
        {result.type === "flood" && result.overlays.flood && (
          <a href={absolute(result.overlays.flood.geotiff)}>GeoTIFF</a>
        )}
        {result.type === "change" && observed && <a href={api.exportUrl(result.id, "gee")}>Earth Engine script</a>}
      </div>
    </section>
  );
}

export function ChangeResults({ result }: { result: ChangeResult }) {
  const selected = useStore((s) => s.selectedDetection);
  const set = useStore((s) => s.set);
  const { summary, provenance } = result;
  const name = provenance.index?.name ?? "Index";
  const period = (p: { start: string; end: string }) => `${p.start.slice(0, 7)} to ${p.end.slice(0, 7)}`;
  const regions = result.detections.features;

  return (
    <div className="results">
      <ResultHeader result={result} />
      <SeverityTable result={result} />
      {result.summary.severity && <PeopleAffected result={result} atMost={-0.1} what="land that burned" />}
      <section>
        <h3>What changed here</h3>
        <p className="muted">{period(result.request.before)} compared with {period(result.request.after)}</p>
        <div className="stats">
          <div className="stat loss">
            <span>{name} decreased on</span>
            <strong>{formatArea(summary.lossAreaHa)}</strong>
            <em>{summary.lossPercent.toFixed(1)}% of the analysed area</em>
          </div>
          <div className="stat gain">
            <span>{name} increased on</span>
            <strong>{formatArea(summary.gainAreaHa)}</strong>
            <em>{summary.gainPercent.toFixed(1)}% of the analysed area</em>
          </div>
        </div>
        <p className="muted">
          A pixel counts when its {name} moved by at least {summary.threshold.toFixed(2)}. At{" "}
          {summary.thresholdSensitivity.map((t) => t.threshold.toFixed(2)).join(" and ")} the decrease area would be{" "}
          {summary.thresholdSensitivity.map((t) => formatArea(t.lossAreaHa)).join(" and ")}.
        </p>
        <table className="table">
          <thead><tr><th scope="col">Mean over area</th><th scope="col">Before</th><th scope="col">After</th><th scope="col">Change</th></tr></thead>
          <tbody>
            {INDEX_ROWS.map((row) => {
              const v = result.indices[row.id];
              return (
                <tr key={row.id}>
                  <th scope="row">{row.label}</th>
                  <td>{formatIndex(v.before)}</td><td>{formatIndex(v.after)}</td><td>{formatSigned(v.change)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ChangeHistogram edges={result.histogram.binEdges} counts={result.histogram.counts}
          threshold={summary.threshold} indexName={name} />
        <p className="muted">
          Analysed {formatArea(summary.analysedAreaHa)} of {formatArea(summary.aoiAreaHa)} ({(summary.validFraction * 100).toFixed(0)}%
          had clear observations in both periods) at {provenance.workingResolutionM} m.
          An index change is not a land-cover class and does not by itself show a cause.
        </p>
      </section>

      <section>
        <h3>Largest regions</h3>
        {regions.length === 0 ? (
          <p className="muted">No contiguous region reached the minimum size.</p>
        ) : (
          <>
            <ul className="regions">
              {regions.slice(0, MAX_LISTED_REGIONS).map((f) => (
                <li key={f.id}>
                  <button className={selected?.id === f.id ? "on" : ""} onClick={() => set({ selectedDetection: f })}>
                    <i className={`swatch ${f.properties.direction === "decrease" ? "loss" : "gain"}`} aria-hidden="true" />
                    <span>{f.properties.direction === "decrease" ? "Decrease" : "Increase"} · {formatArea(f.properties.areaHa)}</span>
                    <em>{name} {formatIndex(f.properties.before)} → {formatIndex(f.properties.after)}</em>
                  </button>
                </li>
              ))}
            </ul>
            <p className="muted">
              {result.detections.totalRegions.toLocaleString("en")} regions of at least {result.request.minAreaHa} ha.
              {result.detections.truncated ? ` The ${regions.length} largest are drawn on the globe.` : ""} Select one to fly to it.
            </p>
          </>
        )}
      </section>
      <Exports result={result} />
    </div>
  );
}

export function SeriesResults({ result }: { result: TimeSeriesResult }) {
  const observed = result.series.filter((e) => e.values);
  const gaps = result.series.filter((e) => !e.values);
  return (
    <div className="results">
      <ResultHeader result={result} />
      <section>
        <h3>Index series</h3>
        <SeriesChart series={result.series} />
        <table className="table">
          <thead><tr><th scope="col">Year</th><th scope="col">NDVI</th><th scope="col">NDWI</th><th scope="col">MNDWI</th><th scope="col">NDBI</th><th scope="col">Sensor</th></tr></thead>
          <tbody>
            {result.series.map((e) => (
              <tr key={e.year}>
                <th scope="row">{e.year}</th>
                {e.values ? (
                  <>
                    <td>{formatIndex(e.values.ndvi)}</td><td>{formatIndex(e.values.ndwi)}</td><td>{formatIndex(e.values.mndwi)}</td><td>{formatIndex(e.values.ndbi)}</td>
                    <td>{(e.platforms ?? []).map((p) => p.replace("landsat-", "L").replace("Sentinel-", "S")).join(", ")}</td>
                  </>
                ) : <td colSpan={5}>No usable imagery</td>}
              </tr>
            ))}
          </tbody>
          {result.summary.trends && (
            <tfoot>
              <tr>
                <th scope="row" title="Least-squares change per decade, years with a clear view of most of the area">Trend / 10 yr</th>
                {(["ndvi", "ndwi", "mndwi", "ndbi"] as const).map((id) => {
                  const t = result.summary.trends?.[id];
                  return <td key={id}>{t ? `${t.perDecade >= 0 ? "+" : "−"}${Math.abs(t.perDecade).toFixed(3)}` : "–"}</td>;
                })}
                <td />
              </tr>
            </tfoot>
          )}
        </table>
        <p className="muted">
          {observed.length} of {result.series.length} years have a composite.
          {gaps.length > 0 ? " Missing years are left empty, not interpolated." : ""} Values are means over{" "}
          {formatArea(result.summary.aoiAreaHa)} at {result.provenance.workingResolutionM} m.
        </p>
      </section>
      <Exports result={result} />
    </div>
  );
}
