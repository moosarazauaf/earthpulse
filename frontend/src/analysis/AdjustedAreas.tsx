/** Error-adjusted class areas with 95% confidence intervals, from a classification's confusion matrix. */
import { formatArea } from "../app/logic";
import type { ClassifyResult } from "../app/types";
import { adjustedAreas } from "../engine/olofsson";

export function AdjustedAreas({ result }: { result: ClassifyResult }) {
  const a = result.summary.accuracy;
  if (!a) return null;
  const rows = adjustedAreas(a.matrix, result.summary.classes.map((c) => c.ha));
  return (
    <section>
      <h3>Error-adjusted areas</h3>
      <table className="table">
        <thead><tr><th scope="col">Class</th><th scope="col">Mapped</th><th scope="col">Adjusted, 95% CI</th></tr></thead>
        <tbody>
          {result.summary.classes.map((c, i) => (
            <tr key={c.name}>
              <th scope="row">{c.name}</th>
              <td>{formatArea(rows[i]!.mappedHa)}</td>
              <td>{formatArea(rows[i]!.estimateHa)} ± {Number.isFinite(rows[i]!.ciHa) ? formatArea(rows[i]!.ciHa) : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">
        Olofsson et al. (2014): the mapped areas corrected for the errors in the confusion matrix. The method assumes the test
        samples were drawn at random within each mapped class. Samples chosen by hand are not, so treat these figures as
        indicative; for formal reporting, collect a stratified random sample of reference points.
      </p>
    </section>
  );
}
