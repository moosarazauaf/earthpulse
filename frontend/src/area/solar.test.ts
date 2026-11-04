import { describe, expect, it } from "vitest";

import { YIELD_FACTOR, solarProfile } from "./solar";

describe("solar potential", () => {
  it("averages each month and turns a year of sunshine into panel output", () => {
    const time: string[] = [], mj: number[] = [];
    for (let m = 1; m <= 12; m += 1) {
      for (const d of [1, 2]) { time.push(`2020-${String(m).padStart(2, "0")}-0${d}`); mj.push(m === 6 ? 25.2 : 18); }
    }
    const p = solarProfile(time, mj)!;
    expect(p.months[0]).toBeCloseTo(5, 6); // 18 MJ = 5 kWh
    expect(p.months[5]).toBeCloseTo(7, 6);
    expect(p.yearlyPerKw).toBeCloseTo((5 * 335.25 + 7 * 30) * YIELD_FACTOR, 3);
    expect(p.years).toBe("2020 to 2020");
  });

  it("refuses a record with a month missing", () => {
    expect(solarProfile(["2020-01-01"], [18])).toBeNull();
  });
});
