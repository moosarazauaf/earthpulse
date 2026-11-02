import { describe, expect, it } from "vitest";

import { SHADERS, VIEW_MODES, nextMode } from "./viewModes";

describe("view modes", () => {
  it("cycles through every mode and back to standard", () => {
    let mode = nextMode("standard");
    const seen = ["standard"];
    while (mode !== "standard") { seen.push(mode); mode = nextMode(mode); }
    expect(seen).toEqual(VIEW_MODES.map((m) => m.id));
  });

  it("has a shader writing the output colour for every filter", () => {
    for (const source of Object.values(SHADERS)) expect(source).toMatch(/out_FragColor\s*=/);
  });
});
