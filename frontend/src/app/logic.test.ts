import { describe, expect, it } from "vitest";

import {
  FIRST_YEAR,
  clampYear,
  currentYear,
  datasetForYear,
  decodeView,
  encodeView,
  formatArea,
  formatSigned,
  rectangleAoi,
  seasonNotStarted,
  seasonPeriod,
} from "./logic";

describe("timeline rules", () => {
  it("falls back to Landsat for years Sentinel-2 did not observe", () => {
    expect(datasetForYear("sentinel2", 1993)).toBe("landsat");
    expect(datasetForYear("sentinel2", 2016)).toBe("sentinel2");
    expect(datasetForYear("landsat", 2024)).toBe("landsat");
  });

  it("keeps the year inside the archive", () => {
    expect(clampYear(1900)).toBe(FIRST_YEAR);
    expect(clampYear(9999)).toBe(currentYear());
    expect(clampYear(2003.4)).toBe(2003);
  });
});

describe("analysis periods", () => {
  const today = new Date("2026-10-06T00:00:00Z");

  it("builds a season window with the right month lengths", () => {
    expect(seasonPeriod(1993, 10, 12, today)).toEqual({ start: "1993-10-01", end: "1993-12-31" });
    expect(seasonPeriod(2024, 1, 2, today)).toEqual({ start: "2024-01-01", end: "2024-02-29" }); // leap year
    expect(seasonPeriod(2023, 1, 2, today).end).toBe("2023-02-28");
  });

  it("never asks for dates in the future", () => {
    expect(seasonPeriod(2026, 10, 12, today).end).toBe("2026-10-06");
    expect(seasonNotStarted(2026, 10, today)).toBe(false);
    expect(seasonNotStarted(2026, 11, today)).toBe(true);
  });
});

describe("area of interest", () => {
  it("makes a closed, counter-clockwise rectangle", () => {
    const aoi = rectangleAoi(74.2, 31.4, 74.5, 31.6);
    if (aoi.type !== "Polygon") throw new Error("expected a polygon");
    const ring = aoi.coordinates[0] ?? [];
    expect(ring).toHaveLength(5);
    expect(ring[0]).toEqual(ring[4]);
    // Shoelace sum is positive for counter-clockwise rings (RFC 7946 exterior).
    let twiceArea = 0;
    for (let i = 0; i < 4; i += 1) {
      const [x1 = 0, y1 = 0] = ring[i] ?? [];
      const [x2 = 0, y2 = 0] = ring[i + 1] ?? [];
      twiceArea += x1 * y2 - x2 * y1;
    }
    expect(twiceArea).toBeGreaterThan(0);
  });
});

describe("share URLs", () => {
  const view = {
    lat: 31.5204,
    lon: 74.3587,
    height: 95_000,
    year: 2025,
    render: "ndvi" as const,
    dataset: "landsat" as const,
    compareYear: 1993,
    analysis: "EP-2026-LAHORE-8F72A",
  };

  it("round-trips a view", () => {
    expect(decodeView(encodeView(view))).toEqual(view);
  });

  it("omits comparison and analysis when absent", () => {
    const query = encodeView({ ...view, compareYear: null, analysis: null });
    expect(query).not.toContain("cmp=");
    expect(query).not.toContain("analysis=");
  });

  it("ignores malformed or hostile parameters", () => {
    const decoded = decodeView("lat=999&lon=abc&year=1700&layer=<script>&data=other&analysis=../../etc&cmp=x");
    expect(decoded.lat).toBeUndefined();
    expect(decoded.render).toBeUndefined();
    expect(decoded.dataset).toBeUndefined();
    expect(decoded.analysis).toBeUndefined();
    expect(decoded.compareYear).toBeUndefined();
    expect(decoded.year).toBe(FIRST_YEAR);
  });
});

describe("formatting", () => {
  it("chooses a readable area unit", () => {
    expect(formatArea(4.72)).toBe("4.7 ha");
    expect(formatArea(2284)).toBe("2,284 ha");
    expect(formatArea(147_432)).toBe("1,474 km²");
  });

  it("signs changes without producing a negative zero", () => {
    expect(formatSigned(0.123)).toBe("+0.12");
    expect(formatSigned(-0.5)).toBe("−0.50");
    expect(formatSigned(-0.001)).toBe("0.00");
    expect(formatSigned(null)).toBe("n/a");
  });
});

describe("hosted-mode tile presets", () => {
  it("match the backend's index expressions, including the reflectance offset", async () => {
    const { tileQuery } = await import("./hosted");
    const expression = (query: string) => new URLSearchParams(query).get("expression");
    expect(expression(tileQuery("landsat", 1993, "ndvi"))).toBe("(nir08-red)/(nir08+red-14545.4545)");
    expect(expression(tileQuery("sentinel2", 2018, "ndvi"))).toBe("(B08-B04)/(B08+B04)");
    expect(expression(tileQuery("sentinel2", 2026, "ndvi"))).toBe("(B08-B04)/(B08+B04-2000.0000)");
    expect(new URLSearchParams(tileQuery("landsat", 1993, "truecolor")).getAll("assets")).toEqual(["red", "green", "blue"]);
  });
});
