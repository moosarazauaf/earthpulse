import { describe, expect, it } from "vitest";

import { accuracy, predict, rng, trainForest } from "./forest";

describe("random forest", () => {
  it("separates classes that differ in one feature and ignores a noise feature", () => {
    const random = rng(1);
    const x: Float32Array[] = [], y: number[] = [];
    for (let i = 0; i < 200; i += 1) {
      const label = i % 2 ? 10 : 20;
      x.push(new Float32Array([label === 10 ? 0.2 + random() * 0.2 : 0.6 + random() * 0.2, random()]));
      y.push(label);
    }
    const forest = trainForest(x, y, { trees: 15, maxDepth: 6, minLeaf: 1, seed: 7 });
    expect(predict(forest, [0.25, 0.9])).toBe(10);
    expect(predict(forest, [0.7, 0.1])).toBe(20);
    expect(forest.importance[0]!).toBeGreaterThan(forest.importance[1]!);
  });

  it("gives the same forest for the same seed", () => {
    const x = [new Float32Array([0]), new Float32Array([1]), new Float32Array([2]), new Float32Array([3])];
    const y = [1, 1, 2, 2];
    const a = trainForest(x, y, { trees: 5, maxDepth: 3, minLeaf: 1, seed: 3 });
    const b = trainForest(x, y, { trees: 5, maxDepth: 3, minLeaf: 1, seed: 3 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});

describe("accuracy assessment", () => {
  it("computes overall accuracy, kappa, producer's and user's accuracy", () => {
    // Congalton-style example: 2 classes, 10 samples.
    const reference = [1, 1, 1, 1, 1, 2, 2, 2, 2, 2];
    const predicted = [1, 1, 1, 1, 2, 2, 2, 2, 1, 1];
    const a = accuracy(reference, predicted, [1, 2]);
    expect(a.matrix).toEqual([[4, 1], [2, 3]]);
    expect(a.overall).toBeCloseTo(0.7);
    expect(a.kappa).toBeCloseTo(0.4);
    expect(a.producers[0]).toBeCloseTo(0.8);
    expect(a.users[0]).toBeCloseTo(4 / 6);
  });
});
