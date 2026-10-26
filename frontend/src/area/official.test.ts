import { describe, expect, it } from "vitest";

import { parseCountryFacts, parseFoodSecurity, parseRainAnomaly } from "./official";

describe("official figures", () => {
  it("takes the latest value of each World Bank indicator and skips empty ones", () => {
    const body = [{ page: 1 }, [
      { indicator: { id: "SP.POP.TOTL" }, country: { value: "Pakistan" }, date: "2025", value: 255219554 },
      { indicator: { id: "SP.URB.TOTL.IN.ZS" }, country: { value: "Pakistan" }, date: "2025", value: 39.5 },
      { indicator: { id: "SI.POV.DDAY" }, country: { value: "Pakistan" }, date: "2024", value: null },
    ]];
    expect(parseCountryFacts(body)).toEqual({ country: "Pakistan", population: { value: 255219554, year: "2025" }, urban: { value: 39.5, year: "2025" } });
    expect(parseCountryFacts([{ message: "Invalid value" }])).toBeNull();
  });

  it("finds the latest IPC Phase 3+ figure for the district, whatever the spelling of spaces and case", () => {
    const row = { admin2_name: "Dera Bugti", ipc_phase: "3+", ipc_type: "current", population_in_phase: 50000, population_fraction_in_phase: 0.2, reference_period_start: "2024-11-01T00:00:00", reference_period_end: "2025-03-31T23:59:59" };
    const later = { ...row, population_in_phase: 70000, population_fraction_in_phase: 0.3, reference_period_start: "2025-04-01T00:00:00", reference_period_end: "2025-07-31T23:59:59" };
    expect(parseFoodSecurity([row, later], "dera-bugti")).toEqual({ district: "Dera Bugti", crisis: 70000, share: 0.3, period: ["2025-04-01", "2025-07-31"] });
    expect(parseFoodSecurity([{ ...row, ipc_type: "projected" }], "Dera Bugti")).toBeNull();
    expect(parseFoodSecurity([row], "Leiah")).toBeNull();
  });

  it("takes the latest one-month rainfall anomaly", () => {
    const row = { admin2_name: "Chagai", aggregation_period: "1-month", rainfall_anomaly_pct: 99, reference_period_start: "2026-10-01T00:00:00", reference_period_end: "2026-10-10T23:59:59" };
    const older = { ...row, rainfall_anomaly_pct: 140, reference_period_start: "2026-09-01T00:00:00", reference_period_end: "2026-09-10T23:59:59" };
    expect(parseRainAnomaly([row, older, { ...row, aggregation_period: "dekad", rainfall_anomaly_pct: 5 }], "Chagai")).toEqual({ district: "Chagai", percent: 99, period: ["2026-10-01", "2026-10-10"] });
  });
});
