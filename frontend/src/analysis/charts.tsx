/** Small SVG charts. Hand-drawn so they inherit the interface's type and colour. */
import { useState } from "react";

import { formatIndex } from "../app/logic";
import type { IndexId, SeriesEntry } from "../app/types";

const W = 320;
const H = 150;
const PAD = { left: 34, right: 10, top: 10, bottom: 22 };
const PLOT_W = W - PAD.left - PAD.right;
const PLOT_H = H - PAD.top - PAD.bottom;

/** Distribution of per-pixel change, with the detection threshold marked. */
export function ChangeHistogram({ edges, counts, threshold, indexName }: {
  edges: number[];
  counts: number[];
  threshold: number;
  indexName: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const total = counts.reduce((a, b) => a + b, 0) || 1;
  const peak = Math.max(...counts, 1);
  const x = (value: number) => PAD.left + ((value + 1) / 2) * PLOT_W;
  const barWidth = PLOT_W / counts.length;
  const hovered = hover === null ? null : { lo: edges[hover] ?? 0, hi: edges[hover + 1] ?? 0, n: counts[hover] ?? 0 };

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label={`Histogram of ${indexName} change per pixel. Threshold at plus and minus ${threshold.toFixed(2)}.`}>
        <line x1={PAD.left} x2={W - PAD.right} y1={H - PAD.bottom} y2={H - PAD.bottom} className="axis" />
        {counts.map((count, i) => {
          const centre = ((edges[i] ?? 0) + (edges[i + 1] ?? 0)) / 2;
          const kind = centre <= -threshold ? "loss" : centre >= threshold ? "gain" : "neutral";
          const height = (count / peak) * PLOT_H;
          return (
            <rect key={i} x={PAD.left + i * barWidth + 0.5} y={H - PAD.bottom - height}
              width={Math.max(1, barWidth - 1)} height={height} className={`bar ${kind}${hover === i ? " hot" : ""}`}
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          );
        })}
        {[-threshold, threshold].map((t) => (
          <line key={t} x1={x(t)} x2={x(t)} y1={PAD.top} y2={H - PAD.bottom} className="threshold" />
        ))}
        {[-1, -0.5, 0, 0.5, 1].map((tick) => (
          <text key={tick} x={x(tick)} y={H - 6} textAnchor="middle" className="tick">{tick}</text>
        ))}
      </svg>
      <figcaption>
        {hovered
          ? `${hovered.lo.toFixed(2)} to ${hovered.hi.toFixed(2)}: ${((hovered.n / total) * 100).toFixed(1)}% of pixels`
          : `${indexName} change per pixel (after minus before). Dashed lines mark the threshold.`}
      </figcaption>
    </figure>
  );
}

const SERIES: { id: IndexId; label: string; className: string }[] = [
  { id: "ndvi", label: "NDVI", className: "s-ndvi" },
  { id: "ndbi", label: "NDBI", className: "s-ndbi" },
  { id: "mndwi", label: "MNDWI", className: "s-mndwi" },
];

/** AOI-mean index per year. Years without data are drawn as gaps, never joined. */
export function SeriesChart({ series }: { series: SeriesEntry[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const years = series.map((e) => e.year);
  const first = years[0] ?? 0;
  const last = years[years.length - 1] ?? 1;
  const values = series.flatMap((e) => (e.values ? SERIES.map((s) => e.values?.[s.id] ?? null) : []))
    .filter((v): v is number => v !== null);
  const lo = Math.min(-0.1, ...values);
  const hi = Math.max(0.5, ...values);
  const x = (year: number) => PAD.left + ((year - first) / Math.max(1, last - first)) * PLOT_W;
  const y = (value: number) => PAD.top + (1 - (value - lo) / (hi - lo)) * PLOT_H;
  const hovered = hover === null ? null : series[hover];

  /** Break the line wherever a year has no observation. */
  const segments = (id: IndexId) => {
    const parts: string[] = [];
    let open = false;
    for (const entry of series) {
      const value = entry.values?.[id];
      if (value === null || value === undefined) {
        open = false;
        continue;
      }
      parts.push(`${open ? "L" : "M"}${x(entry.year).toFixed(1)},${y(value).toFixed(1)}`);
      open = true;
    }
    return parts.join(" ");
  };

  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Mean spectral index over the area for each analysed year.">
        <line x1={PAD.left} x2={W - PAD.right} y1={y(0)} y2={y(0)} className="axis" />
        {[lo, 0, hi].map((tick) => (
          <text key={tick} x={PAD.left - 5} y={y(tick) + 3} textAnchor="end" className="tick">{tick.toFixed(1)}</text>
        ))}
        {series.map((entry, i) => (
          <g key={entry.year}>
            <text x={x(entry.year)} y={H - 6} textAnchor="middle" className="tick">{entry.year}</text>
            {entry.status === "NO_DATA" && (
              <text x={x(entry.year)} y={PAD.top + 10} textAnchor="middle" className="tick gap">no data</text>
            )}
            <rect x={x(entry.year) - 14} y={PAD.top} width={28} height={PLOT_H} fill="transparent"
              onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
          </g>
        ))}
        {SERIES.map((s) => (
          <g key={s.id} className={s.className}>
            <path d={segments(s.id)} className="line" />
            {series.map((entry) => {
              const value = entry.values?.[s.id];
              return value === null || value === undefined ? null : (
                <circle key={entry.year} cx={x(entry.year)} cy={y(value)} r={3} className="dot" />
              );
            })}
          </g>
        ))}
      </svg>
      <figcaption>
        {hovered ? (
          hovered.values
            ? `${hovered.year}: ${SERIES.map((s) => `${s.label} ${formatIndex(hovered.values?.[s.id])}`).join(", ")}`
            : `${hovered.year}: ${hovered.reason ?? "no data"}`
        ) : (
          <span className="legend-inline">
            {SERIES.map((s) => (
              <span key={s.id} className={s.className}><i aria-hidden="true" />{s.label}</span>
            ))}
            <span>Mean over the area, one composite per year</span>
          </span>
        )}
      </figcaption>
    </figure>
  );
}

/** Colour ramp with its numeric range. */
export function LegendBar({ min, max, colors, label }: { min: number; max: number; colors: string[]; label: string }) {
  return (
    <div className="legend" aria-label={`${label}: colour scale from ${min} to ${max}`}>
      <div className="ramp" style={{ background: `linear-gradient(90deg, ${colors.join(",")})` }} />
      <div className="ramp-labels"><span>{min}</span><span>{label}</span><span>{max}</span></div>
    </div>
  );
}
