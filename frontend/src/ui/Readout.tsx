/** Time, the position under the pointer and the camera height, while the readout is on. */
import { useEffect, useState } from "react";

import { useStore } from "../app/store";
import { getGlobe } from "../globe/GlobeViewer";

const fmt = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
const height = (m: number) => (m >= 10_000 ? `${Math.round(m / 1000).toLocaleString("en")} km` : `${Math.round(m).toLocaleString("en")} m`);

export function Readout() {
  const on = useStore((s) => s.readoutOn);
  const [at, setAt] = useState<{ lon: number; lat: number } | null>(null);
  const [h, setH] = useState(0);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    if (!on) return;
    let frame = 0;
    getGlobe()?.onCursor((p, m) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => { setAt(p); setH(m); });
    });
    const clock = window.setInterval(() => setNow(new Date()), 1000);
    return () => { getGlobe()?.onCursor(null); window.clearInterval(clock); cancelAnimationFrame(frame); };
  }, [on]);
  if (!on) return null;
  return (
    <p className="readout" aria-live="off">
      <span>{now.toISOString().slice(11, 19)} UTC</span>
      <span>{at ? `${fmt(at.lat, "N", "S")}, ${fmt(at.lon, "E", "W")}` : "pointer off the globe"}</span>
      <span>camera {height(h)}</span>
    </p>
  );
}
