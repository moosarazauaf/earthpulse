/**
 * A small random forest (Breiman 2001) for land-cover classification in the
 * browser: CART trees grown on bootstrap samples with Gini impurity, each
 * split choosing among a random subset of features, majority vote. Seeded,
 * so the same samples and settings give the same forest.
 */

export interface ForestOptions {
  trees: number;
  maxDepth: number;
  minLeaf: number;
  /** Features tried at each split; defaults to the square root of the feature count. */
  mtry?: number;
  seed: number;
}

type Node =
  | { leaf: true; label: number }
  | { leaf: false; feature: number; threshold: number; left: Node; right: Node };

export interface Forest {
  trees: Node[];
  classes: number[];
  /** Mean decrease in Gini impurity per feature, normalised to sum to 1. */
  importance: number[];
}

/** Mulberry32: small, fast, good enough for sampling. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gini(counts: Map<number, number>, n: number): number {
  let sum = 0;
  for (const c of counts.values()) sum += (c / n) ** 2;
  return 1 - sum;
}

function majority(labels: number[], rows: number[]): number {
  const counts = new Map<number, number>();
  for (const r of rows) counts.set(labels[r]!, (counts.get(labels[r]!) ?? 0) + 1);
  let best = labels[rows[0]!]!, bestN = -1;
  for (const [label, n] of counts) if (n > bestN || (n === bestN && label < best)) { best = label; bestN = n; }
  return best;
}

function grow(
  x: Float32Array[], y: number[], rows: number[], depth: number, o: Required<ForestOptions>, random: () => number, importance: number[],
): Node {
  const first = y[rows[0]!]!;
  if (depth >= o.maxDepth || rows.length < 2 * o.minLeaf || rows.every((r) => y[r] === first)) return { leaf: true, label: majority(y, rows) };
  const nFeatures = x[0]!.length;
  const parentCounts = new Map<number, number>();
  for (const r of rows) parentCounts.set(y[r]!, (parentCounts.get(y[r]!) ?? 0) + 1);
  const parentGini = gini(parentCounts, rows.length);

  // A random subset of features, without replacement.
  const features = Array.from({ length: nFeatures }, (_, i) => i);
  for (let i = features.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [features[i], features[j]] = [features[j]!, features[i]!];
  }
  let best: { feature: number; threshold: number; gain: number } | null = null;
  for (const f of features.slice(0, o.mtry)) {
    const sorted = [...rows].sort((a, b) => x[a]![f]! - x[b]![f]!);
    const left = new Map<number, number>();
    const right = new Map(parentCounts);
    for (let i = 0; i < sorted.length - 1; i += 1) {
      const label = y[sorted[i]!]!;
      left.set(label, (left.get(label) ?? 0) + 1);
      right.set(label, right.get(label)! - 1);
      const v = x[sorted[i]!]![f]!, next = x[sorted[i + 1]!]![f]!;
      const nLeft = i + 1, nRight = sorted.length - nLeft;
      if (v === next || nLeft < o.minLeaf || nRight < o.minLeaf) continue;
      const gain = parentGini - (nLeft * gini(left, nLeft) + nRight * gini(right, nRight)) / sorted.length;
      if (!best || gain > best.gain) best = { feature: f, threshold: (v + next) / 2, gain };
    }
  }
  if (!best || best.gain <= 0) return { leaf: true, label: majority(y, rows) };
  importance[best.feature]! += best.gain * rows.length;
  const leftRows = rows.filter((r) => x[r]![best!.feature]! <= best!.threshold);
  const rightRows = rows.filter((r) => x[r]![best!.feature]! > best!.threshold);
  return {
    leaf: false, feature: best.feature, threshold: best.threshold,
    left: grow(x, y, leftRows, depth + 1, o, random, importance),
    right: grow(x, y, rightRows, depth + 1, o, random, importance),
  };
}

export function trainForest(x: Float32Array[], y: number[], options: ForestOptions): Forest {
  if (x.length === 0) throw new Error("No training samples.");
  const nFeatures = x[0]!.length;
  const o: Required<ForestOptions> = { mtry: Math.max(1, Math.round(Math.sqrt(nFeatures))), ...options };
  const random = rng(o.seed);
  const importance = Array.from({ length: nFeatures }, () => 0);
  const trees: Node[] = [];
  for (let t = 0; t < o.trees; t += 1) {
    const rows = Array.from({ length: x.length }, () => Math.floor(random() * x.length));
    trees.push(grow(x, y, rows, 0, o, random, importance));
  }
  const total = importance.reduce((a, b) => a + b, 0) || 1;
  return { trees, classes: [...new Set(y)].sort((a, b) => a - b), importance: importance.map((v) => v / total) };
}

function classifyOne(node: Node, row: ArrayLike<number>): number {
  let n = node;
  while (!n.leaf) n = (row[n.feature] as number) <= n.threshold ? n.left : n.right;
  return n.label;
}

/** Majority vote of the trees for one row of features. */
export function predict(forest: Forest, row: ArrayLike<number>): number {
  const votes = new Map<number, number>();
  for (const tree of forest.trees) {
    const label = classifyOne(tree, row);
    votes.set(label, (votes.get(label) ?? 0) + 1);
  }
  let best = forest.classes[0]!, bestN = -1;
  for (const [label, n] of votes) if (n > bestN || (n === bestN && label < best)) { best = label; bestN = n; }
  return best;
}

export interface Accuracy {
  classes: number[];
  /** matrix[reference][predicted], counts of test samples. */
  matrix: number[][];
  overall: number;
  kappa: number;
  producers: number[];
  users: number[];
  f1: number[];
  n: number;
}

/** Confusion matrix and the usual measures (Congalton and Green 2019) from reference and predicted labels. */
export function accuracy(reference: number[], predicted: number[], classes: number[]): Accuracy {
  const index = new Map(classes.map((c, i) => [c, i]));
  const k = classes.length;
  const matrix = Array.from({ length: k }, () => Array.from({ length: k }, () => 0));
  reference.forEach((r, i) => {
    const a = index.get(r), b = index.get(predicted[i]!);
    if (a !== undefined && b !== undefined) matrix[a]![b]! += 1;
  });
  const n = matrix.flat().reduce((a, b) => a + b, 0);
  const diag = classes.map((_, i) => matrix[i]![i]!);
  const rowSum = matrix.map((row) => row.reduce((a, b) => a + b, 0));
  const colSum = classes.map((_, j) => matrix.reduce((a, row) => a + row[j]!, 0));
  const overall = n ? diag.reduce((a, b) => a + b, 0) / n : 0;
  const expected = n ? rowSum.reduce((a, r, i) => a + r * colSum[i]!, 0) / (n * n) : 0;
  const kappa = expected < 1 ? (overall - expected) / (1 - expected) : 1;
  const producers = diag.map((d, i) => (rowSum[i] ? d / rowSum[i]! : NaN));
  const users = diag.map((d, i) => (colSum[i] ? d / colSum[i]! : NaN));
  const f1 = producers.map((p, i) => (p + users[i]! > 0 ? (2 * p * users[i]!) / (p + users[i]!) : NaN));
  return { classes, matrix, overall, kappa, producers, users, f1, n };
}
