import { describe, expect, it } from "vitest";

import { rng } from "../engine/forest";
import { splitFeatures } from "../engine/classify";
import { classFields, parseSamples, samplesFor } from "./samples";

const point = (lon: number, lat: number, props: Record<string, unknown>) => ({ type: "Feature", properties: props, geometry: { type: "Point", coordinates: [lon, lat] } });

describe("training samples", () => {
  it("finds attributes that look like classes and reads the samples", () => {
    const fc = { type: "FeatureCollection", features: [point(74, 31, { id: 1, cls: "Water" }), point(74.1, 31, { id: 2, cls: "Built" }), point(74.2, 31, { id: 3, cls: "" })] };
    const file = parseSamples(fc, "s.geojson");
    expect(file.fields).toEqual(["id", "cls"]);
    const samples = samplesFor(file, "cls");
    expect(samples.map((s) => s.className)).toEqual(["Water", "Built"]);
  });

  it("rejects files without a usable class attribute or with projected coordinates", () => {
    expect(() => parseSamples({ type: "FeatureCollection", features: [point(74, 31, { a: "x" }), point(74, 31, { a: "x" })] }, "f")).toThrow(/classes/);
    expect(() => parseSamples({ type: "FeatureCollection", features: [point(450000, 3500000, { a: "x" })] }, "f")).toThrow(/longitude/);
    expect(classFields([])).toEqual([]);
  });
});

describe("train/test split by feature", () => {
  it("holds back about 30% of each class's features and never splits a feature", () => {
    const samples = Array.from({ length: 20 }, (_, i) => ({ feature: i, classIndex: i % 2 }));
    const test = splitFeatures([...samples, ...samples], 0.3, rng(1));
    expect(test.size).toBe(6);
    expect([...test].filter((f) => f % 2 === 0)).toHaveLength(3);
  });

  it("keeps a class with a single feature entirely in training", () => {
    const test = splitFeatures([{ feature: 0, classIndex: 0 }, { feature: 1, classIndex: 1 }, { feature: 2, classIndex: 1 }], 0.3, rng(1));
    expect(test.has(0)).toBe(false);
    expect(test.size).toBe(1);
  });
});
