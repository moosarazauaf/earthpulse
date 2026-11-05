/** Cross-section of the ground along the measuring line. */
import { useEffect, useState } from "react";

import { fetchProfile } from "./profile";
import { formatKm } from "./measure";
import { Figure } from "../ui/Figure";

type Profile = NonNullable<Awaited<ReturnType<typeof fetchProfile>>>;
const m = (v: number) => `${Math.round(v).toLocaleString("en")} m`;

export function ElevationProfile({ points }: { points: [number, number][] }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    setProfile(null);
    setError(false);
    fetchProfile(points, controller.signal).then(setProfile, () => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [points]);
  if (error) return <p className="muted">Elevation could not be read for this line.</p>;
  if (!profile) return <p className="muted" role="status">Reading the ground height…</p>;
  const { samples, heights, stats } = profile;
  const W = 320, H = 90, total = samples.at(-1)!.km;
  const span = Math.max(stats.max - stats.min, 1);
  const x = (km: number) => (km / total) * W;
  const y = (h: number) => H - ((h - stats.min) / span) * (H - 6) - 3;
  const line = samples.map((s, i) => `${i ? "L" : "M"}${x(s.km).toFixed(1)},${y(heights[i]!).toFixed(1)}`).join(" ");
  return (
    <Figure className="profile" title={`Ground height along a ${formatKm(total)} line`} source="AWS Terrain Tiles (SRTM and others, about 30 m at best; a surface model, so the tops of buildings and trees in cities and forests). Made with EarthPulse.">
      <svg viewBox={`0 0 ${W} ${H + 14}`} role="img"
        aria-label={`Ground height along the line: from ${m(heights[0]!)} to ${m(heights.at(-1)!)}, lowest ${m(stats.min)}, highest ${m(stats.max)}`}>
        <path className="area" d={`${line} L${W},${H} L0,${H} Z`} />
        <path className="line" d={line} />
        <text x="2" y="10">{m(stats.max)}</text>
        <text x="2" y={H - 4}>{m(stats.min)}</text>
        <text x={W} y={H + 12} textAnchor="end">{formatKm(total)}</text>
        <text x="0" y={H + 12}>0</text>
      </svg>
      <p className="muted">
        Lowest {m(stats.min)}, highest {m(stats.max)}; {m(stats.climb)} of climb and {m(stats.descent)} of descent along the way.
        AWS Terrain Tiles (SRTM and others, about 30 m at best; in cities and forests the tops of buildings and trees).
      </p>
    </Figure>
  );
}
