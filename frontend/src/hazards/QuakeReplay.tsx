/** Plays the past week of earthquakes onto the globe in about 15 seconds, in the order they struck. */
import { useEffect } from "react";

import { useStore } from "../app/store";

const WEEK_MS = 7 * 24 * 3600_000;
const TICK_MS = 50;
const STEP_MS = (WEEK_MS * TICK_MS) / 15_000;

export function QuakeReplay() {
  const replay = useStore((s) => s.quakeReplay);
  const set = useStore((s) => s.set);
  const playing = replay !== null;
  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => {
      const t = useStore.getState().quakeReplay;
      set({ quakeReplay: t === null || t + STEP_MS >= Date.now() ? null : t + STEP_MS });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [playing, set]);
  // Leaving the panel ends the replay, so the globe goes back to showing the whole week.
  useEffect(() => () => set({ quakeReplay: null }), [set]);
  return (
    <span className="row">
      <button className="link" onClick={() => set({ quakeReplay: playing ? null : Date.now() - WEEK_MS })}>
        {playing ? "Stop" : "Replay the week"}
      </button>
      {playing && (
        <span className="mono" role="status">
          {new Date(replay).toLocaleString("en", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC", hour12: false })} UTC
        </span>
      )}
    </span>
  );
}
