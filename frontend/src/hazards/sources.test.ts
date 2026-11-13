import { describe, expect, it } from "vitest";

import { tidyList } from "./sources";

describe("GDACS place lists", () => {
  it("drops the empty entries GDACS sends", () => {
    expect(tidyList("Drought in Aruba, , Brazil, Colombia, , Panama")).toBe("Drought in Aruba, Brazil, Colombia, Panama");
    expect(tidyList("India")).toBe("India");
    expect(tidyList("")).toBe("");
  });
});
