import { describe, expect, it } from "vitest";

import { lastDomainTime, rainTileUrl, rainTimes } from "./rain";

describe("rain maps", () => {
  it("reads the newest time from a GIBS time-domain answer", () => {
    const xml = "<Domains><DimensionDomain><Domain>2026-10-24/2026-10-24T22:30:00Z/PT30M</Domain></DimensionDomain></Domains>";
    expect(lastDomainTime(xml)).toBe("2026-10-24T22:30:00Z");
    expect(lastDomainTime("<Domains/>")).toBeNull();
  });

  it("steps back half an hour at a time, oldest first", () => {
    const times = rainTimes("2026-10-24T22:30:00Z");
    expect(times).toEqual(["2026-10-24T20:00:00Z", "2026-10-24T20:30:00Z", "2026-10-24T21:00:00Z", "2026-10-24T21:30:00Z", "2026-10-24T22:00:00Z", "2026-10-24T22:30:00Z"]);
    expect(rainTileUrl(times[0]!)).toContain("/IMERG_Precipitation_Rate_30min/default/2026-10-24T20:00:00Z/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png");
  });
});
