/** My places: saved areas and recent analyses, kept in this browser. Opened with M or the star button. */
import { useEffect, useRef } from "react";

import { decodeRun, modeForRun } from "../app/shareRun";
import { useStore } from "../app/store";
import { clearRecent, isSaved } from "../area/saved";
import { ago } from "../news/hazards";

export function MyPlaces() {
  const open = useStore((s) => s.placesOpen);
  const places = useStore((s) => s.places);
  const recent = useStore((s) => s.recent);
  const aoi = useStore((s) => s.aoi);
  const set = useStore((s) => s.set);
  const openPlace = useStore((s) => s.openPlace);
  const forgetPlace = useStore((s) => s.forgetPlace);
  const saveCurrentPlace = useStore((s) => s.saveCurrentPlace);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);

  function rerun(param: string) {
    const run = decodeRun(param);
    if (!run) return;
    set({ placesOpen: false, introOpen: false, pendingRun: { ...run, fromRecent: true }, mode: modeForRun(run) });
  }

  return (
    <dialog ref={dialog} className="sheet places" aria-labelledby="places-title" onClose={() => set({ placesOpen: false })}>
      <header className="row">
        <h2 id="places-title">My places</h2>
        <button className="ghost" onClick={() => set({ placesOpen: false })}>Close</button>
      </header>
      <section>
        <h3>Saved areas</h3>
        {aoi && !isSaved(places, aoi.geometry) && (
          <button onClick={saveCurrentPlace}>☆ Save the current area: {aoi.label}</button>
        )}
        {places.length === 0 ? (
          <p className="muted">No saved areas yet. Open any area and press ☆ Save, or S with Shift.</p>
        ) : (
          <ul className="place-list">
            {places.map((p) => (
              <li key={p.id}>
                <button className="place-open" onClick={() => openPlace(p)}>
                  <strong>{p.label}</strong>
                  <em>saved {ago(p.savedAt)}</em>
                </button>
                <button className="ghost" aria-label={`Remove ${p.label}`} title="Remove" onClick={() => forgetPlace(p.id)}>×</button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section>
        <header className="row">
          <h3>Recent analyses</h3>
          {recent.length > 0 && <button className="link" onClick={() => set({ recent: clearRecent() })}>Clear</button>}
        </header>
        {recent.length === 0 ? (
          <p className="muted">Analyses you run appear here, so you can run them again later.</p>
        ) : (
          <ul className="place-list">
            {recent.map((r) => (
              <li key={r.id}>
                <div className="place-open">
                  <strong>{r.headline}</strong>
                  <em>{r.label} · {ago(r.at)}</em>
                </div>
                {r.run
                  ? <button onClick={() => rerun(r.run!)} title="Run the same analysis again on this device">Run again</button>
                  : <span className="muted">outline too large to keep</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
      <p className="muted">
        Kept only in this browser on this device. Results themselves are not stored, because their maps exist only in
        the tab that made them; Run again repeats the analysis with the same recipe.
      </p>
    </dialog>
  );
}
