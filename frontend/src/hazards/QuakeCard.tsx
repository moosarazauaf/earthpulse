/** The earthquake clicked on the globe: what USGS reports, and how many people live near it. */
import { useStore } from "../app/store";
import { ago } from "../news/hazards";
import { PeopleNear } from "./PeopleNear";

const PAGER = { green: "little or no", yellow: "some", orange: "significant", red: "extensive" } as const;

export function QuakeCard() {
  const quake = useStore((s) => s.selectedQuake);
  const set = useStore((s) => s.set);
  if (!quake) return null;
  return (
    <section className="district-card quake-card" aria-label="Earthquake">
      <div className="row">
        <p><strong>M{quake.magnitude.toFixed(1)}</strong> · {quake.place}</p>
        <button className="ghost" aria-label="Close" onClick={() => set({ selectedQuake: null })}>×</button>
      </div>
      <p className="muted">
        {ago(quake.time)}, {Math.round(quake.depthKm)} km deep
        {quake.pager ? ` · USGS expects ${PAGER[quake.pager]} damage (PAGER ${quake.pager})` : ""}
        {quake.tsunami ? " · flagged for possible tsunami" : ""}.
      </p>
      <PeopleNear lon={quake.lon} lat={quake.lat} km={100} source="USGS" />
      <a className="button" href={quake.url} target="_blank" rel="noopener noreferrer">Event page on USGS</a>
    </section>
  );
}
