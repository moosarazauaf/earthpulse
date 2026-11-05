import { describe, expect, it } from "vitest";

import { HAZARD_INFO } from "../news/hazards";
import { ICONS } from "./HazardIcon";

describe("pixel hazard icons", () => {
  it("has a 9 by 9 icon for every hazard, using only known pixels", () => {
    for (const hazard of Object.keys(HAZARD_INFO) as (keyof typeof ICONS)[]) {
      const rows = ICONS[hazard];
      expect(rows, hazard).toHaveLength(9);
      for (const row of rows) expect(row, `${hazard}: "${row}"`).toMatch(/^[.#+]{9}$/);
    }
  });
});
