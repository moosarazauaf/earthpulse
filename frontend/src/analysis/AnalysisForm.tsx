/** Choose an area and a question, then run a real analysis. */
import { useState } from "react";

import { HOSTED } from "../app/api";
import { FIRST_YEAR, SENTINEL2_FIRST_YEAR, currentYear, seasonNotStarted, seasonPeriod } from "../app/logic";
import { useStore } from "../app/store";
import type { IndexId } from "../app/types";
import { STORED_ANALYSIS } from "../demo/stored";
import { AreaChoices } from "./AreaPrompt";
import { DeviceStep, useDevice } from "./DeviceStep";

export const SEASONS = [
  { id: "year", label: "Whole year", start: 1, end: 12 },
  { id: "q1", label: "Jan to Mar", start: 1, end: 3 },
  { id: "q2", label: "Apr to Jun", start: 4, end: 6 },
  { id: "q3", label: "Jul to Sep", start: 7, end: 9 },
  { id: "q4", label: "Oct to Dec", start: 10, end: 12 },
] as const;
const QUESTIONS: { index: IndexId; label: string }[] = [
  { index: "ndvi", label: "Vegetation (NDVI)" },
  { index: "mndwi", label: "Surface water (MNDWI)" },
  { index: "ndwi", label: "Surface water (NDWI)" },
  { index: "ndbi", label: "Built-up and bare surfaces (NDBI)" },
];
/** Points in an index series; each one is a full composite, so more is slower. */
const SERIES_POINTS = 5;
export const DEFAULT_MAX_CLOUD = 20;

/** `points` years spread evenly from first to last, both included. */
export function seriesYears(first: number, last: number, points = SERIES_POINTS): number[] {
  const count = Math.min(points, last - first + 1);
  if (count <= 1) return [first];
  const years = Array.from({ length: count }, (_, i) => Math.round(first + ((last - first) * i) / (count - 1)));
  return [...new Set(years)];
}

/** Step 1 of every analysis: the area, with the same choices as the opening prompt. */
export function AreaStep() {
  const s = useStore();
  return (
    <section>
      <h3>1. Area</h3>
      {s.aoi ? (
        <>
          <p className="aoi-line">
            <span>{s.aoi.label}</span>
            <button className="link" onClick={() => s.setAoi(null)}>Change area</button>
          </p>
        </>
      ) : (
        <AreaChoices />
      )}
    </section>
  );
}

export function AnalysisForm() {
  const s = useStore();
  const thisYear = currentYear();
  const [index, setIndex] = useState<IndexId>("ndvi");
  const [beforeYear, setBeforeYear] = useState(1993);
  const [afterYear, setAfterYear] = useState(thisYear - 1);
  const [seasonId, setSeasonId] = useState<(typeof SEASONS)[number]["id"]>("q4");
  const [threshold, setThreshold] = useState("");
  const { device, quality, setQuality } = useDevice();

  const season = SEASONS.find((x) => x.id === seasonId) ?? SEASONS[0];
  const dataset = s.preferredDataset === "sentinel2" && beforeYear >= SENTINEL2_FIRST_YEAR ? "sentinel2" : "landsat";
  const running = s.job.status === "submitting" || s.job.status === "running";
  const defaultThreshold = s.catalog?.indices.find((i) => i.id === index)?.defaultThreshold ?? 0.15;

  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (afterYear <= beforeYear) problem = "The later year must come after the earlier year.";
  else if (seasonNotStarted(afterYear, season.start)) problem = `${season.label} ${afterYear} has not happened yet.`;

  function run(kind: "change" | "series") {
    if (!s.aoi || problem) return;
    const common = { aoi: s.aoi.geometry, label: s.aoi.label, dataset, maxCloud: DEFAULT_MAX_CLOUD } as const;
    if (kind === "change") {
      const parsed = Number(threshold);
      void s.runChange({
        ...common,
        index,
        before: seasonPeriod(beforeYear, season.start, season.end),
        after: seasonPeriod(afterYear, season.start, season.end),
        threshold: threshold && parsed >= 0.02 && parsed <= 1 ? parsed : undefined,
        minAreaHa: 0.5,
      }, device, quality);
    } else {
      void s.runTimeSeries({
        ...common,
        years: seriesYears(beforeYear, afterYear),
        startMonth: season.start,
        endMonth: season.end,
      }, device, quality);
    }
  }

  return (
    <div className="form">
      <AreaStep />

      <section>
        <h3>2. Question</h3>
        <label className="field">
          <span>What to measure</span>
          <select value={index} onChange={(e) => setIndex(e.target.value as IndexId)}>
            {QUESTIONS.map((q) => <option key={q.index} value={q.index}>{q.label}</option>)}
          </select>
        </label>
        <div className="pair">
          <label className="field">
            <span>Earlier year</span>
            <input type="number" min={FIRST_YEAR} max={thisYear - 1} value={beforeYear}
              onChange={(e) => setBeforeYear(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Later year</span>
            <input type="number" min={FIRST_YEAR + 1} max={thisYear} value={afterYear}
              onChange={(e) => setAfterYear(Number(e.target.value))} />
          </label>
        </div>
        <label className="field">
          <span>Season compared in both years</span>
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value as typeof seasonId)}>
            {SEASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Change threshold (index units)</span>
          <input type="number" min={0.02} max={1} step={0.01} value={threshold} placeholder={`${defaultThreshold} (default)`}
            onChange={(e) => setThreshold(e.target.value)} />
        </label>
        <p className="muted">
          Uses {dataset === "landsat" ? "Landsat (30 m)" : "Sentinel-2 (10 m)"}, scenes with at most {DEFAULT_MAX_CLOUD}% cloud.
          Comparing the same season keeps crop and leaf cycles from being read as change.
        </p>
      </section>

      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality}
        nativeRes={dataset === "landsat" ? 30 : 10} sensor={dataset === "landsat" ? "Landsat" : "Sentinel-2"} />

      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => run("change")}>
          Detect change on this device
        </button>
        <button disabled={!!problem || running} onClick={() => run("series")}
          title={`Mean of four indices for ${SERIES_POINTS} years from ${beforeYear} to ${afterYear}`}>
          Index series, {SERIES_POINTS} years
        </button>
        {HOSTED && (
          <button className="link" onClick={() => void s.loadAnalysis(STORED_ANALYSIS.id)} title="A district-wide result computed earlier by the backend">
            Open stored example
          </button>
        )}
      </div>
    </div>
  );
}
