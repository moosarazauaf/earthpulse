/**
 * Validity checks for a Sentinel-1 flood-mapping plan, run on the passes the
 * archive actually holds for each window, before anything is downloaded.
 *
 * The two mistakes they catch most often:
 * - Mixed orbits. Each relative orbit sees the ground from its own angle and
 *   direction. Comparing a pass from one orbit with a pass from another turns
 *   geometry into apparent change, which a threshold then calls flooding.
 * - Compositing. Combining several passes into one image hides when water was
 *   there: the darkest-pass image used for the flood window shows water seen on
 *   any of those days, and a long window blends rising and falling water.
 */
import type { AoiGeometry, Period } from "../app/types";
import { MAX_PASSES, MIN_COVERAGE, type RadarScene, chooseOrbit, orbitCoverage, searchRadar } from "../engine/flood";

export interface Finding {
  level: "ok" | "warn" | "error";
  text: string;
}

export interface ScenesCheck {
  findings: Finding[];
  /** The orbit the engine would use, or null when none covers the area in every window. */
  orbit: number | null;
}

export interface CheckWindow {
  name: "before" | "flood" | "after";
  period: Period;
  scenes: RadarScene[];
}

const DAY = 86_400_000;
const days = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / DAY);
const passDates = (scenes: RadarScene[], orbit: number) => [...new Set(scenes.filter((s) => s.orbit === orbit).map((s) => s.datetime.slice(0, 10)))].sort();
const direction = (s: string) => (s.toLowerCase().startsWith("asc") ? "ascending" : s.toLowerCase().startsWith("desc") ? "descending" : s || "unknown direction");

export function checkScenes(windows: CheckWindow[], aoi: AoiGeometry): ScenesCheck {
  const findings: Finding[] = [];
  for (const w of windows) {
    if (!w.scenes.length) findings.push({ level: "error", text: `No Sentinel-1 pass over the area in the ${w.name} window (${w.period.start} to ${w.period.end}). Each orbit repeats every 12 days or so: make the window at least 12 days long.` });
  }
  if (findings.length) return { findings, orbit: null };

  const all = windows.flatMap((w) => w.scenes);
  const orbitsSeen = [...new Set(all.map((s) => s.orbit))].sort((a, b) => a - b);
  const states = new Map(all.map((s) => [s.orbit, direction(s.orbitState)]));
  const coverage = orbitCoverage(windows.map((w) => w.scenes), aoi);
  const orbit = chooseOrbit(coverage);
  const describe = (o: number) => `${o} (${states.get(o)}, ${Math.round((coverage[o] ?? 0) * 100)}% of the area in its worst window)`;

  if (orbitsSeen.length > 1) {
    const directions = new Set(orbitsSeen.map((o) => states.get(o)));
    findings.push({
      level: orbit === null ? "error" : "warn",
      text: `Mixed orbits: the windows hold passes from ${orbitsSeen.length} relative orbits${directions.size > 1 ? ", ascending and descending" : ""}: ${orbitsSeen.map(describe).join("; ")}. `
        + "Passes from different orbits see the ground from different angles, so comparing them makes false change. "
        + (orbit === null ? "No single orbit covers the area in every window: widen the windows." : `Only orbit ${orbit} is used, in every window.`),
    });
  } else if (orbit !== null) {
    findings.push({ level: "ok", text: `One orbit throughout: relative orbit ${orbit}, ${states.get(orbit)}.` });
  }
  if (orbit === null) {
    if (orbitsSeen.length <= 1) findings.push({ level: "error", text: `The only orbit found covers less than ${MIN_COVERAGE * 100}% of the area in at least one window. Widen the windows or choose a smaller area.` });
    return { findings, orbit };
  }
  const cover = coverage[orbit] ?? 0;
  if (cover < 0.98) findings.push({ level: "warn", text: `Orbit ${orbit} covers ${Math.round(cover * 100)}% of the area in its worst window; results describe that part only.` });

  const dates = Object.fromEntries(windows.map((w) => [w.name, passDates(w.scenes, orbit)]));
  const used = Object.fromEntries(windows.map((w) => [w.name, dates[w.name]!.slice(-MAX_PASSES)]));
  for (const w of windows) {
    const all = dates[w.name]!, take = used[w.name]!;
    if (!take.length) {
      findings.push({ level: "error", text: `Orbit ${orbit} has no pass in the ${w.name} window. Widen it to at least 12 days.` });
      continue;
    }
    const note = all.length > take.length ? ` (the latest ${take.length} of ${all.length})` : "";
    if (w.name === "flood" && take.length > 1) {
      findings.push({ level: "warn", text: `Compositing: the flood window combines ${take.length} passes${note}, ${take.join(" and ")}, into one image by keeping the darkest value. The map shows water seen on either day, not one moment, so it can overstate the extent if the water moved.` });
    } else if (w.name === "before" && take.length === 1) {
      findings.push({ level: "warn", text: `Only one pass before the flood (${take[0]}): a wet day or speckle in it shifts the baseline. Lengthen the before window to get two.` });
    } else {
      findings.push({ level: "ok", text: `${w.name[0]!.toUpperCase()}${w.name.slice(1)}: ${take.length === 1 ? `one pass, ${take[0]}` : `${take.length} passes${note}, ${take.join(" and ")}, median`}.` });
    }
    const span = days(w.period.start, w.period.end);
    if (w.name === "flood" && span > 31) findings.push({ level: "warn", text: `The flood window is ${span} days long. Rising and falling water blend in a long window; a window of 12 to 24 days around the peak is cleaner.` });
  }
  const lastBefore = used.before?.at(-1), firstFlood = dates.flood?.[0];
  if (lastBefore && firstFlood) {
    const gap = days(lastBefore, firstFlood);
    if (gap > 60) findings.push({ level: "warn", text: `${gap} days between the last pass before and the first flood pass. Crops, soil moisture and harvests change over that time and can look like flooding; a before window closer to the event is safer.` });
  }
  return { findings, orbit };
}

/** Searches the archive for each window and checks the result. */
export async function checkFloodPlan(request: { aoi: AoiGeometry; before: Period; flood: Period; after?: Period }, bbox: number[], signal?: AbortSignal): Promise<ScenesCheck> {
  const named: [CheckWindow["name"], Period | undefined][] = [["before", request.before], ["flood", request.flood], ["after", request.after]];
  const windows = await Promise.all(named.filter((n): n is [CheckWindow["name"], Period] => !!n[1]).map(async ([name, period]) => {
    if (period.start < "2014-10-01") return { name, period, scenes: [] };
    return { name, period, scenes: await searchRadar(bbox, period.start, period.end, signal) };
  }));
  return checkScenes(windows, request.aoi);
}
