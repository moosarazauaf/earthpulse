import { describe, expect, it } from "vitest";

import { toolNamesFor } from "./args";

describe("tools sent to the model", () => {
  const names = toolNamesFor;
  it("never sends more than the deployed proxy accepts", () => {
    for (const text of ["", "buffer 3 km and export kml with a time-lapse, slope and carbon, people and land cover", "hi"]) expect(names(text).length).toBeLessThanOrEqual(8);
  });
  it("includes the tool the words ask for", () => {
    expect(names("buffer 3 km")).toContain("buffer");
    expect(names("export this as KML")).toContain("export_area");
    expect(names("make a time-lapse of Dubai")).toContain("time_lapse");
    expect(names("is Sukkur safe?")).toContain("risk_check");
  });
});
