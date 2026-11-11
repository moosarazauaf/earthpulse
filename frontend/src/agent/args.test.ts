import { describe, expect, it } from "vitest";

import { askFromArgs, floodDates, honest } from "./args";

const now = new Date("2026-11-05T00:00:00Z");

describe("assistant tool arguments", () => {
  it("keeps sane values and drops anything out of range", () => {
    const ask = askFromArgs({ kind: "flood", place: "  Layyah, Pakistan ", years: [2022, 1900, 2022.5, 2030], months: [8, 13, 9], size_km: 500, lat: 31, lon: 999 }, now);
    expect(ask).toEqual({ kind: "flood", place: "Layyah, Pakistan", point: null, years: [2022], since: false, months: [8, 9], sizeKm: null, index: null });
    expect(askFromArgs({ kind: "delete_everything" }, now)).toBe("Unknown analysis kind.");
  });

  it("replaces a reply that claims a result when only a plan exists", () => {
    const plan = [{ kind: "plan", findings: [{ level: "warn" }] }];
    // What Nemotron actually replied on the live site before the guard.
    const claimed = "Flood mapping for Layyah, Pakistan from 25 August to 5 September 2022 has been generated using Sentinel-1 radar data. The resulting map shows the flooded area.";
    expect(honest(claimed, plan)).toBe("The plan is ready; read the checks below first. Nothing has run yet: press Run in the side panel to map it.");
    expect(honest("The plan for Layyah is ready; press Run to start it.", plan)).toBe("The plan for Layyah is ready; press Run to start it.");
    expect(honest(claimed, [])).toBe(claimed);
  });

  it("accepts an exact flood window only when it is real, ordered and in the Sentinel-1 era", () => {
    expect(floodDates({ flood_start: "2022-08-25", flood_end: "2022-09-05" }, now)).toEqual({ start: "2022-08-25", end: "2022-09-05" });
    expect(floodDates({ flood_start: "2022-09-05", flood_end: "2022-08-25" }, now)).toBeNull();
    expect(floodDates({ flood_start: "2010-08-01", flood_end: "2010-08-20" }, now)).toBeNull();
    expect(floodDates({ flood_start: "2027-01-01", flood_end: "2027-01-10" }, now)).toBeNull();
    expect(floodDates({ flood_start: "2022-13-40", flood_end: "2022-14-01" }, now)).toBeNull();
  });
});

describe("what the assistant says it can do", () => {
  it("answers ability questions from the fixed list, not the model", async () => {
    const { asksAbilities, abilitiesText, CAN_RUN } = await import("./args");
    expect(asksAbilities("What can you do?")).toBe(true);
    expect(asksAbilities("help")).toBe(true);
    expect(asksAbilities("which analyses are there")).toBe(true);
    expect(asksAbilities("floods in Layyah")).toBe(false);
    expect(abilitiesText()).toContain(CAN_RUN[0]);
    expect(abilitiesText()).toMatch(/Still in progress/);
  });
});

describe("chat memory and the built-in reader", () => {
  it("keeps the recent turns and never starts on a cut-off tool reply", async () => {
    const { trimHistory } = await import("./args");
    const turn = (i: number) => [
      { role: "user" as const, content: `q${i}` },
      { role: "assistant" as const, content: null, tool_calls: [{ id: `c${i}`, type: "function" as const, function: { name: "open_area", arguments: "{}" } }] },
      { role: "tool" as const, tool_call_id: `c${i}`, content: "{}" },
    ];
    const all = Array.from({ length: 12 }, (_, i) => turn(i)).flat(); // 36 messages
    const kept = trimHistory(all, 10);
    expect(kept[0]).toMatchObject({ role: "user" });
    expect(kept.length).toBeLessThanOrEqual(10);
    expect(kept.at(-1)).toMatchObject({ role: "tool", tool_call_id: "c11" });
    expect(trimHistory(all.slice(0, 6), 10)).toHaveLength(6);
  });

  it("routes land cover and carbon requests, keeping 'here' as the open area", async () => {
    const { offlineIntent } = await import("./args");
    expect(offlineIntent("Land cover here")).toEqual({ tool: "land_cover", place: null });
    expect(offlineIntent("carbon stock in Layyah, Pakistan?")).toEqual({ tool: "carbon_stock", place: "Layyah, Pakistan" });
    expect(offlineIntent("LULC of Lahore")).toEqual({ tool: "land_cover", place: "Lahore" });
    expect(offlineIntent("biomass for this area")).toEqual({ tool: "carbon_stock", place: null });
    expect(offlineIntent("floods in Pakistan")).toBeNull();
    expect(offlineIntent("How many people live in Peshawar?")).toEqual({ tool: "people_count", place: "Peshawar" });
    expect(offlineIntent("make a map of this view")).toEqual({ tool: "save_map", place: null });
    expect(offlineIntent("Make a time-lapse of Dubai")).toEqual({ tool: "time_lapse", place: "Dubai" });
    expect(offlineIntent("timelapse here")).toEqual({ tool: "time_lapse", place: null });
    expect(offlineIntent("Buffer 5 km around Layyah, Pakistan")).toEqual({ tool: "buffer", place: "Layyah, Pakistan", args: { km: 5 } });
    expect(offlineIntent("buffer 500 m")).toEqual({ tool: "buffer", place: null, args: { km: 0.5 } });
    expect(offlineIntent("Slope map of Murree, Pakistan")).toEqual({ tool: "terrain", place: "Murree, Pakistan", args: { map: "slope" } });
    expect(offlineIntent("terrain here")).toEqual({ tool: "terrain", place: null, args: {} });
    expect(offlineIntent("How big is this area? Area and perimeter")).toMatchObject({ tool: "measure_area" });
    expect(offlineIntent("export this area as KML")).toEqual({ tool: "export_area", place: null, args: { format: "kml" } });
    expect(offlineIntent("Is Nowshera, Pakistan safe? Risk check")).toEqual({ tool: "risk_check", place: "Nowshera, Pakistan" });
    expect(offlineIntent("Has Sukkur flooded before?")).toEqual({ tool: "risk_check", place: "Sukkur" });
    expect(offlineIntent("flood risk of Charsadda")).toEqual({ tool: "risk_check", place: "Charsadda" });
    expect(offlineIntent("Is this land safe to build on?")).toEqual({ tool: "risk_check", place: null });
    expect(offlineIntent("Is the coming week safe in Lahore?")).toBeNull();
  });
});

describe("the place in a request typed without a model", () => {
  it("drops command and question words, so the search finds the place, not a theatre", async () => {
    const { placeFromText } = await import("./args");
    expect(placeFromText("Open Lahore, Pakistan")).toBe("Lahore, Pakistan");
    expect(placeFromText("What is the weather outlook for Multan?")).toBe("Multan");
    expect(placeFromText("show me Karachi")).toBe("Karachi");
    expect(placeFromText("air quality outlook for Lahore")).toBe("Lahore");
    expect(placeFromText("Peshawar")).toBe("Peshawar");
  });
});

describe("example questions", () => {
  it("offers a different handful each time, all distinct, starting with what Sentri can do", async () => {
    const { EXAMPLE_POOL, pickExamples } = await import("./args");
    const a = pickExamples(4), b = pickExamples(4);
    expect(a[0]).toBe("What can you do?");
    expect(new Set(a).size).toBe(4);
    expect(a.slice(1).every((x) => EXAMPLE_POOL.includes(x))).toBe(true);
    // Shuffled with a fixed source of randomness the same way twice; with Math.random, almost never.
    let seed = 1;
    const fixed = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    expect(pickExamples(4, fixed)).not.toEqual(pickExamples(4, fixed));
    expect(EXAMPLE_POOL.length).toBeGreaterThan(30);
    void b;
  });
});
