import { describe, expect, it } from "vitest";

import { translate } from "./index";

describe("interface text", () => {
  it("fills placeholders", () => {
    expect(translate("nav.analyseActive", { name: "Heat" })).toBe("Analyse: Heat");
    expect(translate("nav.live")).toBe("Live");
  });
});
