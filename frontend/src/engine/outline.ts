/**
 * Outlines of pixel regions, traced along pixel edges.
 *
 * Every edge between a region pixel and a pixel outside it is a boundary
 * edge, oriented so the region lies on its right. Linking edges end to end
 * gives closed rings; the ring with the largest area is the outer boundary.
 * Holes are not cut out, so a ring around a lake inside a flood is drawn as
 * one shape; the reported area is still the true pixel count.
 */

/** A ring of pixel-corner coordinates [col, row], closed (first point repeated). */
export type PixelRing = [number, number][];

/**
 * Outer boundary of the pixels whose label equals `label`, searched inside
 * the given bounding box (inclusive pixel indices).
 */
export function traceOutline(
  labels: Int32Array, width: number, height: number, label: number,
  box: { minCol: number; maxCol: number; minRow: number; maxRow: number },
): PixelRing | null {
  const inside = (c: number, r: number) => c >= 0 && r >= 0 && c < width && r < height && labels[r * width + c] === label;
  const W = width + 1;
  const key = (c: number, r: number) => r * W + c;
  // Outgoing boundary edges per corner; a corner touched diagonally has two.
  const out = new Map<number, number[]>();
  const add = (fc: number, fr: number, tc: number, tr: number) => {
    const from = key(fc, fr);
    const list = out.get(from);
    if (list) list.push(key(tc, tr));
    else out.set(from, [key(tc, tr)]);
  };
  for (let r = box.minRow; r <= box.maxRow; r += 1) {
    for (let c = box.minCol; c <= box.maxCol; c += 1) {
      if (!inside(c, r)) continue;
      if (!inside(c, r - 1)) add(c, r, c + 1, r); // top, left to right
      if (!inside(c + 1, r)) add(c + 1, r, c + 1, r + 1); // right, downward
      if (!inside(c, r + 1)) add(c + 1, r + 1, c, r + 1); // bottom, right to left
      if (!inside(c - 1, r)) add(c, r + 1, c, r); // left, upward
    }
  }
  if (out.size === 0) return null;

  const decode = (k: number): [number, number] => [k % W, Math.floor(k / W)];
  let best: PixelRing | null = null;
  let bestArea = 0;
  for (const startKey of [...out.keys()]) {
    while ((out.get(startKey)?.length ?? 0) > 0) {
      const ring: [number, number][] = [decode(startKey)];
      let prev = startKey;
      let current = out.get(startKey)!.pop()!;
      let guard = 0;
      while (current !== startKey && guard++ < 4 * labels.length) {
        ring.push(decode(current));
        const choices = out.get(current);
        if (!choices || choices.length === 0) break;
        // At a corner where two pixels touch diagonally, turn left: that joins them, as 8-neighbour regions are.
        let pick = choices.length - 1;
        if (choices.length > 1) {
          const [pc, pr] = decode(prev), [cc, cr] = decode(current);
          const dx = cc - pc, dy = cr - pr;
          pick = choices.findIndex((k) => { const [nc, nr] = decode(k); return (nc - cc) === dy && (nr - cr) === -dx; });
          if (pick < 0) pick = choices.length - 1;
        }
        const next = choices.splice(pick, 1)[0]!;
        prev = current;
        current = next;
      }
      if (current !== startKey || ring.length < 4) continue;
      ring.push(ring[0]!);
      const area = Math.abs(ringArea(ring));
      if (area > bestArea) { bestArea = area; best = ring; }
    }
  }
  return best ? simplify(best) : null;
}

/** Shoelace area in pixel units (positive or negative by orientation). */
export function ringArea(ring: PixelRing): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [x0, y0] = ring[i]!, [x1, y1] = ring[i + 1]!;
    a += x0 * y1 - x1 * y0;
  }
  return a / 2;
}

/** Drop vertices that lie on a straight line between their neighbours. */
export function simplify(ring: PixelRing): PixelRing {
  const open = ring.slice(0, -1);
  const kept: [number, number][] = [];
  for (let i = 0; i < open.length; i += 1) {
    const a = open[(i - 1 + open.length) % open.length]!, b = open[i]!, c = open[(i + 1) % open.length]!;
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (cross !== 0) kept.push(b);
  }
  return kept.length >= 3 ? [...kept, kept[0]!] : ring;
}
