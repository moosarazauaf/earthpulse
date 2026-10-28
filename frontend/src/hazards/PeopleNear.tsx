/** How many people live within a distance of a hazard (GHS-POP 2020). */
import { useEffect, useState } from "react";

import { circleAround } from "../app/logic";
import { populationInBrowser } from "../engine/client";
import { formatPeople } from "../engine/population";

export function PeopleNear({ lon, lat, km }: { lon: number; lat: number; km: number }) {
  const [people, setPeople] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setPeople(null);
    setError(null);
    const job = populationInBrowser({ aoi: circleAround(lon, lat, km) });
    job.promise.then((r) => setPeople(r.people), (e: unknown) => setError(e instanceof Error ? e.message : "The population grid could not be read."));
    return job.cancel;
  }, [lon, lat, km]);
  if (error) return <p className="muted">People nearby could not be counted: {error}</p>;
  return people === null
    ? <p className="muted" role="status">Counting the people nearby…</p>
    : <p><strong>{people >= 1 ? formatPeople(people).replace(/^a/, "A") : "Almost no one"}</strong> live within {km} km of the reported location <span className="muted">(GHS-POP 2020; GDACS places an event at one point, so the people affected can lie elsewhere).</span></p>;
}
