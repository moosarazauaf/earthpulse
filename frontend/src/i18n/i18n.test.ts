import { describe, expect, it } from "vitest";

import { initialLang, translate } from "./index";
import { ENGLISH, STRINGS } from "./strings";

describe("languages", () => {
  it("uses a remembered choice, else the browser's language, else English", () => {
    expect(initialLang("fr", ["ur-PK"])).toBe("fr");
    expect(initialLang(null, ["ur-PK", "en"])).toBe("ur");
    expect(initialLang(null, ["de-DE", "es-MX"])).toBe("es");
    expect(initialLang("xx", ["de"])).toBe("en");
  });

  it("fills placeholders and falls back to English", () => {
    expect(translate("es", "nav.analyseActive", { name: "Calor" })).toBe("Analizar: Calor");
    expect(translate("en", "nav.live")).toBe("Live");
  });

  it("translates every key in every language", () => {
    for (const [lang, table] of Object.entries(STRINGS)) {
      const missing = Object.keys(ENGLISH).filter((k) => !(k in table));
      expect(missing, lang).toEqual([]);
    }
  });
});
