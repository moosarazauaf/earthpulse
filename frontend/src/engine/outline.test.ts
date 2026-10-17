import { describe, expect, it } from "vitest";

import { ringArea, traceOutline } from "./outline";

function grid(rows: string[]) {
  const height = rows.length, width = rows[0]!.length;
  const labels = new Int32Array(width * height);
  rows.forEach((row, r) => [...row].forEach((ch, c) => { labels[r * width + c] = ch === "#" ? 1 : 0; }));
  return { labels, width, height };
}
const box = (g: { width: number; height: number }) => ({ minCol: 0, maxCol: g.width - 1, minRow: 0, maxRow: g.height - 1 });

describe("traceOutline", () => {
  it("traces a square as four corners", () => {
    const g = grid(["....", ".##.", ".##.", "...."]);
    const ring = traceOutline(g.labels, g.width, g.height, 1, box(g))!;
    expect(ring).toHaveLength(5);
    expect(Math.abs(ringArea(ring))).toBe(4);
  });

  it("follows an L shape and encloses its true area", () => {
    const g = grid(["#...", "#...", "###."]);
    const ring = traceOutline(g.labels, g.width, g.height, 1, box(g))!;
    expect(Math.abs(ringArea(ring))).toBe(5);
    expect(ring).toHaveLength(7);
  });

  it("keeps diagonally touching pixels in one outline", () => {
    const g = grid(["#.", ".#"]);
    const ring = traceOutline(g.labels, g.width, g.height, 1, box(g))!;
    expect(Math.abs(ringArea(ring))).toBe(2);
  });

  it("draws the outer boundary of a ring-shaped region", () => {
    const g = grid(["###", "#.#", "###"]);
    const ring = traceOutline(g.labels, g.width, g.height, 1, box(g))!;
    expect(Math.abs(ringArea(ring))).toBe(9);
  });
});

describe("traceOutlines", () => {
  it("traces several regions in one pass with the same rings as one at a time", async () => {
    const { traceOutlines } = await import("./outline");
    const rows = ["11.22", "11.22", "....2", "33..."];
    const width = 5, height = 4;
    const labels = new Int32Array(width * height);
    rows.forEach((row, r) => [...row].forEach((ch, c) => { labels[r * width + c] = ch === "." ? 0 : Number(ch); }));
    const rings = traceOutlines(labels, width, height, new Set([1, 2, 3]));
    expect(Math.abs(ringArea(rings.get(1)!))).toBe(4);
    expect(Math.abs(ringArea(rings.get(2)!))).toBe(5);
    expect(Math.abs(ringArea(rings.get(3)!))).toBe(2);
    expect(rings.get(2)).toEqual(traceOutline(labels, width, height, 2, { minCol: 0, maxCol: 4, minRow: 0, maxRow: 3 }));
  });
});
