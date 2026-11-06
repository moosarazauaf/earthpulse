import { describe, expect, it } from "vitest";

import { pickYears } from "../app/logic";

describe("time-lapse years", () => {
  it("spreads at most 21 years evenly, keeping the first and last", () => {
    const y = pickYears(1985, 2025);
    expect(y).toHaveLength(21);
    expect(y[0]).toBe(1985);
    expect(y.at(-1)).toBe(2025);
    expect(y[1]).toBe(1987);
  });

  it("uses every year when there are few, and copes with one", () => {
    expect(pickYears(2017, 2025)).toEqual([2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025]);
    expect(pickYears(2025, 2025)).toEqual([2025]);
  });
});
