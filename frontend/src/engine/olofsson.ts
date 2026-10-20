/**
 * Error-adjusted area estimates with 95% confidence intervals, after
 * Olofsson et al. (2014), "Good practices for estimating area and assessing
 * accuracy of land change", Remote Sensing of Environment 148: 42-57.
 *
 * With map class proportions W_i and a confusion matrix whose rows are map
 * classes i and columns reference classes j:
 *   p_j = sum_i W_i n_ij / n_i                     (eq. 9)
 *   S(p_j) = sqrt( sum_i W_i^2 (n_ij/n_i)(1 - n_ij/n_i) / (n_i - 1) )   (eq. 10)
 *   area_j = A p_j,  95% CI = area_j +/- 1.96 A S(p_j)
 * The estimator assumes the test sample was drawn at random within each map
 * class (stratified random sampling).
 */

export interface AdjustedArea {
  /** Area mapped as the class. */
  mappedHa: number;
  /** Error-adjusted estimate of the class's true area. */
  estimateHa: number;
  /** Half-width of the 95% confidence interval. */
  ciHa: number;
}

/**
 * `matrix[reference][predicted]` (EarthPulse's layout) and the mapped area of
 * each class, in the same class order. Classes never mapped or never tested
 * contribute nothing; their estimate can still be non-zero from omission.
 */
export function adjustedAreas(matrix: number[][], mappedHa: number[]): AdjustedArea[] {
  const k = mappedHa.length;
  const total = mappedHa.reduce((a, b) => a + b, 0);
  if (total <= 0) return mappedHa.map((m) => ({ mappedHa: m, estimateHa: m, ciHa: NaN }));
  const W = mappedHa.map((m) => m / total);
  // n[i][j]: map class i (predicted), reference class j.
  const n = Array.from({ length: k }, (_, i) => Array.from({ length: k }, (_, j) => matrix[j]?.[i] ?? 0));
  const rowTotal = n.map((row) => row.reduce((a, b) => a + b, 0));
  return mappedHa.map((m, j) => {
    let p = 0, variance = 0;
    for (let i = 0; i < k; i += 1) {
      const ni = rowTotal[i]!;
      if (ni === 0) {
        // A mapped class with no test samples: its area cannot be redistributed, so it counts as itself.
        if (i === j) p += W[i]!;
        continue;
      }
      const share = n[i]![j]! / ni;
      p += W[i]! * share;
      if (ni > 1) variance += (W[i]! ** 2 * share * (1 - share)) / (ni - 1);
    }
    return { mappedHa: m, estimateHa: total * p, ciHa: 1.96 * total * Math.sqrt(variance) };
  });
}
