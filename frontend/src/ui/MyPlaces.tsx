/** My places: saved areas and recent analyses, kept in this browser. Opened with M or the star button. */
import { useEffect, useRef } from "react";

import { decodeRun, modeForRun } from "../app/shareRun";
import { useStore } from "../app/store";
import { clearRecent, isSaved } from "../area/saved";
import { type NearbyItem, WATCH_KM, useWatchedPlaces } from "../area/watch";
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
  const watched = useWatchedPlaces();
  const nearby = (id: string) => watched.find((w) => w.place.id === id)?.items ?? [];
  function openItem(item: NearbyItem) {
    if (item.kind === "news") set({ placesOpen: false, mode: "live", liveTab: "news", selectedStory: item.story, introOpen: false });
    else if (item.kind === "alert") set({ placesOpen: false, mode: "live", liveTab: "alerts", selectedAlert: item.alert, introOpen: false });
  }
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
      <div className="row">
        <h2 id="places-title">My places</h2>
        <button className="ghost" onClick={() => set({ placesOpen: false })}>Close</button>
      </div>
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
                {nearby(p.id).length > 0 && (
                  <ul className="nearby-list">
                    {nearby(p.id).slice(0, 4).map((item, i) => (
                      <li key={i}>
                        {item.kind === "quake"
                          ? <a href={item.url} target="_blank" rel="noopener noreferrer"><b>{item.label}</b> · {Math.round(item.km)} km · {item.title}</a>
                          : <button className="link" onClick={() => openItem(item)}><b>{item.label}</b> · {Math.round(item.km)} km · {item.title}</button>}
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {places.length > 0 && (
        <p className="muted">
          Each time EarthPulse opens it checks hazard news within {WATCH_KM.news} km of your places, and USGS earthquakes and
          GDACS alerts within {WATCH_KM.quake} km, here in your browser. It is not a warning service: follow your national
          authorities for safety decisions.
        </p>
      )}
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
