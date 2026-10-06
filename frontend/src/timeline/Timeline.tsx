/** Bottom bar: the year on the globe, playback, and before/after comparison. */
import { useEffect, useState } from "react";

import { FIRST_YEAR, currentYear } from "../app/logic";
import { type CompareMode, useStore } from "../app/store";
import { Credit } from "../ui/Credit";

/** Time each year stays on screen during playback; tiles need a moment to arrive. */
const PLAY_INTERVAL_MS = 2200;
const TICK_EVERY_YEARS = 5;
const MODES: { id: CompareMode; label: string }[] = [
  { id: "swipe", label: "Swipe" },
  { id: "blink", label: "Blink" },
  { id: "opacity", label: "Opacity" },
];

export function Timeline() {
  const year = useStore((s) => s.year);
  const compare = useStore((s) => s.compare);
  const setYear = useStore((s) => s.setYear);
  const setCompare = useStore((s) => s.setCompare);
  const [playing, setPlaying] = useState(false);
  const last = currentYear();

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const now = useStore.getState().year;
      if (now >= last) setPlaying(false);
      else setYear(now + 1);
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [playing, last, setYear]);

  const ticks: number[] = [];
  for (let y = Math.ceil(FIRST_YEAR / TICK_EVERY_YEARS) * TICK_EVERY_YEARS; y <= last; y += TICK_EVERY_YEARS) ticks.push(y);
  const percent = (y: number) => ((y - FIRST_YEAR) / (last - FIRST_YEAR)) * 100;

  return (
    <footer className="timeline" aria-label="Timeline">
      <div className="timeline-main">
        <button className="icon-btn" onClick={() => { if (!playing && year >= last) setYear(FIRST_YEAR); setPlaying(!playing); }}
          aria-label={playing ? "Pause playback" : "Play through the years"}>
          {playing ? "❚❚" : "▶"}
        </button>
        <output className="year" aria-live="polite">{year}</output>
        <div className="track">
          <input type="range" min={FIRST_YEAR} max={last} step={1} value={year}
            aria-label="Year shown on the globe"
            onChange={(e) => { setPlaying(false); setYear(Number(e.target.value)); }} />
          <div className="ticks" aria-hidden="true">
            {ticks.map((t) => <span key={t} style={{ left: `${percent(t)}%` }}>{t}</span>)}
            {compare.enabled && <i className="marker" style={{ left: `${percent(compare.year)}%` }} />}
          </div>
        </div>
      </div>

      <div className="timeline-compare">
        <label className="check">
          <input type="checkbox" checked={compare.enabled} onChange={(e) => setCompare({ enabled: e.target.checked })} />
          <span>Compare with</span>
        </label>
        <input type="number" min={FIRST_YEAR} max={last} value={compare.year} disabled={!compare.enabled}
          aria-label="Comparison year"
          onChange={(e) => {
            const value = Number(e.target.value);
            if (value >= FIRST_YEAR && value <= last) setCompare({ year: value });
          }} />
        <div className="seg" role="radiogroup" aria-label="Comparison mode">
          {MODES.map((m) => (
            <button key={m.id} role="radio" aria-checked={compare.mode === m.id} disabled={!compare.enabled}
              className={compare.enabled && compare.mode === m.id ? "on" : ""} onClick={() => setCompare({ mode: m.id })}>
              {m.label}
            </button>
          ))}
        </div>
        {compare.enabled && compare.mode === "opacity" && (
          <label className="slider inline">
            <span>{year}</span>
            <input type="range" min={0} max={1} step={0.02} value={compare.position}
              aria-label={`Blend between ${year} and ${compare.year}`}
              onChange={(e) => setCompare({ position: Number(e.target.value) })} />
            <span>{compare.year}</span>
          </label>
        )}
        <Credit />
      </div>
    </footer>
  );
}
