/** How many people live on the land an analysis marked as affected (GHS-POP 2020). */
import { useEffect, useState } from "react";

import type { AnalysisResult } from "../app/types";
import { exposureInBrowser } from "../engine/client";
import { type ExposureResult, formatPeople } from "../engine/population";
import { KindBadge } from "../ui/KindBadge";

export function PeopleAffected({ result, equals, atMost, what }: { result: AnalysisResult; equals?: number; atMost?: number; what: string }) {
  const [count, setCount] = useState<ExposureResult | null>(null);
  const [error, setError] = useState(false);
  const raster = result.raster;
  useEffect(() => {
    if (!raster) return;
    setCount(null);
    setError(false);
    const job = exposureInBrowser({ aoi: result.aoi, raster, equals, atMost });
    job.promise.then(setCount, () => setError(true));
    return job.cancel;
  }, [result, raster, equals, atMost]);
  if (!raster) return null;
  return (
    <section>
      <header className="row"><h3>People affected</h3><KindBadge kind="MODELED" /></header>
      {error && <p className="note">The population grid could not be read.</p>}
      {!count && !error && <p className="muted" role="status">Counting the people who live there…</p>}
      {count && (
        <>
          <p>
            <strong>{count.people >= 1 ? formatPeople(count.people).replace(/^a/, "A") : "Almost no one"}</strong> lived on {what}
            {count.total >= 1 ? `, out of ${formatPeople(count.total).replace("about ", "")} in the whole area (${Math.round((count.people / count.total) * 100)}%)` : ""}.
          </p>
          <p className="muted">
            GHS-POP 2020 (European Commission JRC), counted on a {count.cellM} m grid where each cell&apos;s centre falls on {what}. Where
            people live, not where they were at the time; homes at the edge of the mapped area may be counted in or out.
          </p>
        </>
      )}
    </section>
  );
}
