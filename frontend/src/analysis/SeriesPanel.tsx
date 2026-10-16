/** Research: an index series for the area, with control over years, sensor and season. */
import { useState } from "react";

import { FIRST_YEAR, SENTINEL2_FIRST_YEAR, currentYear, seasonNotStarted } from "../app/logic";
import { useStore } from "../app/store";
import { AreaStep, DEFAULT_MAX_CLOUD, SEASONS, seriesYears } from "./AnalysisForm";
import { DeviceStep, useDevice } from "./DeviceStep";

const POINTS = [5, 8, 12] as const;

export function SeriesForm() {
  const s = useStore();
  const thisYear = currentYear();
  const [first, setFirst] = useState(2000);
  const [last, setLast] = useState(thisYear - 1);
  const [points, setPoints] = useState<(typeof POINTS)[number]>(8);
  const [seasonId, setSeasonId] = useState<(typeof SEASONS)[number]["id"]>("q4");
  const [dataset, setDataset] = useState<"landsat" | "sentinel2">("landsat");
  const { device, quality, setQuality } = useDevice();
  const season = SEASONS.find((x) => x.id === seasonId) ?? SEASONS[0];
  const years = seriesYears(first, last, points);
  const running = s.job.status === "submitting" || s.job.status === "running";

  let problem: string | null = null;
  if (!s.aoi) problem = "Choose an area first.";
  else if (last <= first) problem = "The last year must come after the first.";
  else if (dataset === "sentinel2" && first < SENTINEL2_FIRST_YEAR) problem = `Sentinel-2 starts in ${SENTINEL2_FIRST_YEAR}; use Landsat for earlier years.`;
  else if (seasonNotStarted(last, season.start)) problem = `${season.label} ${last} has not happened yet.`;

  return (
    <div className="form">
      <AreaStep />
      <section>
        <h3>2. Years and season</h3>
        <div className="pair">
          <label className="field">
            <span>First year</span>
            <input type="number" min={FIRST_YEAR} max={thisYear - 1} value={first} onChange={(e) => setFirst(Number(e.target.value))} />
          </label>
          <label className="field">
            <span>Last year</span>
            <input type="number" min={FIRST_YEAR + 1} max={thisYear} value={last} onChange={(e) => setLast(Number(e.target.value))} />
          </label>
        </div>
        <div className="seg" role="radiogroup" aria-label="Number of years">
          {POINTS.map((p) => (
            <button key={p} role="radio" aria-checked={points === p} className={points === p ? "on" : ""} onClick={() => setPoints(p)}>
              {p} years
            </button>
          ))}
        </div>
        <label className="field">
          <span>Season, the same in every year</span>
          <select value={seasonId} onChange={(e) => setSeasonId(e.target.value as typeof seasonId)}>
            {SEASONS.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <div className="seg" role="radiogroup" aria-label="Satellite">
          {(["landsat", "sentinel2"] as const).map((id) => (
            <button key={id} role="radio" aria-checked={dataset === id} className={dataset === id ? "on" : ""} onClick={() => setDataset(id)}>
              {id === "landsat" ? "Landsat · 30 m · 1984 on" : "Sentinel-2 · 10 m · 2016 on"}
            </button>
          ))}
        </div>
        <p className="muted">Years: {years.join(", ")}. Each year is one cloud-free composite, so more years take longer.</p>
      </section>
      <DeviceStep step={3} device={device} quality={quality} setQuality={setQuality}
        nativeRes={dataset === "landsat" ? 30 : 10} sensor={dataset === "landsat" ? "Landsat" : "Sentinel-2"} />
      {problem && <p className="note" role="status">{problem}</p>}
      <div className="actions">
        <button className="primary" disabled={!!problem || running} onClick={() => {
          if (!s.aoi || problem) return;
          void s.runTimeSeries({
            aoi: s.aoi.geometry, label: s.aoi.label, dataset, years,
            startMonth: season.start, endMonth: season.end, maxCloud: DEFAULT_MAX_CLOUD,
          }, device, quality);
        }}>
          Compute the series on this device
        </button>
      </div>
    </div>
  );
}
