import { describe, expect, it } from "vitest";

import { type WindField, advect, components, speedColour, windAt } from "./wind";

const N = 14 * 36;
/** A uniform field blowing east at `u` and north at `v`. */
const uniform = (u: number, v: number): WindField => ({ u: new Float32Array(N).fill(u), v: new Float32Array(N).fill(v), time: "" });

describe("wind", () => {
  it("turns 'from' directions into the way the air moves", () => {
    const [u1, v1] = components(10, 270); // a westerly blows east
    expect(u1).toBeCloseTo(10, 6);
    expect(v1).toBeCloseTo(0, 6);
    const [u2, v2] = components(5, 0); // a northerly blows south
    expect(u2).toBeCloseTo(0, 6);
    expect(v2).toBeCloseTo(-5, 6);
  });

  it("interpolates between grid nodes and wraps across the date line", () => {
    const field = uniform(0, 0);
    // Node (lat 30, lon 170) is 3, its eastern neighbour across the date line (lon -180) is 7.
    const row = (30 + 60) / 10;
    field.u[row * 36 + 35] = 3;
    field.u[row * 36 + 0] = 7;
    expect(windAt(field, 175, 30)![0]).toBeCloseTo(5, 5);
    expect(windAt(field, 170, 30)![0]).toBeCloseTo(3, 5);
    expect(windAt(field, 0, 80)).toBeNull();
  });

  it("moves a particle downwind, faster in longitude near the poles, and wraps it", () => {
    const east = advect(uniform(10, 0), 0, 0)!;
    expect(east.lon).toBeGreaterThan(0);
    expect(east.lat).toBeCloseTo(0, 6);
    const highLat = advect(uniform(10, 0), 0, 60)!;
    expect(highLat.lon).toBeGreaterThan(east.lon);
    expect(advect(uniform(10, 0), 179.99, 0)!.lon).toBeLessThan(-179);
    expect(speedColour(2)).not.toBe(speedColour(20));
  });
});
