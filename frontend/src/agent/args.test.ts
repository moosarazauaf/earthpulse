import { describe, expect, it } from "vitest";

import { askFromArgs, floodDates } from "./args";

const now = new Date("2026-11-05T00:00:00Z");

describe("assistant tool arguments", () => {
  it("keeps sane values and drops anything out of range", () => {
    const ask = askFromArgs({ kind: "flood", place: "  Layyah, Pakistan ", years: [2022, 1900, 2022.5, 2030], months: [8, 13, 9], size_km: 500, lat: 31, lon: 999 }, now);
    expect(ask).toEqual({ kind: "flood", place: "Layyah, Pakistan", point: null, years: [2022], since: false, months: [8, 9], sizeKm: null, index: null });
    expect(askFromArgs({ kind: "delete_everything" }, now)).toBe("Unknown analysis kind.");
  });

  it("accepts an exact flood window only when it is real, ordered and in the Sentinel-1 era", () => {
    expect(floodDates({ flood_start: "2022-08-25", flood_end: "2022-09-05" }, now)).toEqual({ start: "2022-08-25", end: "2022-09-05" });
    expect(floodDates({ flood_start: "2022-09-05", flood_end: "2022-08-25" }, now)).toBeNull();
    expect(floodDates({ flood_start: "2010-08-01", flood_end: "2010-08-20" }, now)).toBeNull();
    expect(floodDates({ flood_start: "2027-01-01", flood_end: "2027-01-10" }, now)).toBeNull();
    expect(floodDates({ flood_start: "2022-13-40", flood_end: "2022-14-01" }, now)).toBeNull();
  });
});
