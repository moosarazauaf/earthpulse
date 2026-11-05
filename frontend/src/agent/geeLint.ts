/**
 * Checks a pasted Google Earth Engine script (JavaScript or Python) that maps
 * floods with Sentinel-1 for the mistakes that quietly make a wrong map:
 * mixed orbits, compositing across dates, double dB conversion and missing
 * mode or polarisation filters. Pattern checks on the text, not a parser, so
 * each finding names what it looked for.
 */
import type { Finding } from "./s1checks";

const S1 = /COPERNICUS\/S1_GRD(_FLOAT)?/;
const DATE = /filterDate\(\s*['"](\d{4}-\d{2}-\d{2})['"]\s*,\s*['"](\d{4}-\d{2}-\d{2})['"]/g;
const DAY = 86_400_000;

/** True when the text looks like an Earth Engine Sentinel-1 script. */
export const isS1Script = (text: string) => S1.test(text) || (/ee\.ImageCollection|ImageCollection\(/.test(text) && /S1_GRD|sentinel-?1/i.test(text));

export function lintGeeScript(code: string): Finding[] {
  const f: Finding[] = [];
  if (!isS1Script(code)) return [{ level: "error", text: "This does not look like an Earth Engine Sentinel-1 script: no COPERNICUS/S1_GRD collection found." }];
  const has = (re: RegExp) => re.test(code);
  const relOrbit = has(/relativeOrbitNumber_(start|stop)/);
  const pass = has(/orbitProperties_pass/);
  const composite = [...code.matchAll(/\.(median|mean|min|max|mosaic|reduce|qualityMosaic)\s*\(/g)].map((m) => m[1]!);

  if (!relOrbit) {
    f.push({
      level: "error",
      text: "Mixed orbits: no filter on 'relativeOrbitNumber_start'. The collection holds every orbit that crosses the area, each seeing the ground from its own angle, so before and after images built from it differ even where nothing changed. Add .filter(ee.Filter.eq('relativeOrbitNumber_start', N)) with one orbit that covers the whole area, the same N in every period.",
    });
    if (!pass) f.push({ level: "warn", text: "No filter on 'orbitProperties_pass' either: ascending and descending passes are mixed too, with opposite look directions." });
  } else {
    f.push({ level: "ok", text: "A relative orbit filter is set. Check that the same orbit number is used for before and after." });
    const nums = new Set([...code.matchAll(/relativeOrbitNumber_start['"]\s*,\s*(\d+)/g)].map((m) => m[1]));
    if (nums.size > 1) f.push({ level: "error", text: `Different relative orbits in one script (${[...nums].join(", ")}): before and after must come from the same orbit.` });
  }

  if (composite.includes("mosaic")) {
    f.push({ level: "warn", text: "Compositing with .mosaic(): each pixel takes the last image in the collection's order, so one map stitches different dates (and orbits, without an orbit filter) with no record of which is which. Prefer one date, or .min() over a short flood window with the dates listed." });
  }
  const spans = [...code.matchAll(DATE)].map((m) => ({ start: m[1]!, end: m[2]!, days: Math.round((Date.parse(m[2]!) - Date.parse(m[1]!)) / DAY) }));
  const reducers = composite.filter((c) => c !== "mosaic");
  if (reducers.length) {
    const long = spans.filter((s) => s.days > 31);
    f.push(long.length
      ? { level: "warn", text: `Compositing over long periods: ${long.map((s) => `${s.start} to ${s.end} (${s.days} days)`).join(", ")}. A flood-period composite this long blends rising and falling water; keep the flood window to 12 to 24 days and say which passes it holds.` }
      : { level: "ok", text: `Composites with .${reducers.join("(), .")}() over periods of a month or less.` });
    // The statement with the latest filterDate is taken as the flood period.
    const statements = code.split(/;|\n\s*\n/).map((t) => ({ start: /filterDate\(\s*['"](\d{4}-\d{2}-\d{2})/.exec(t)?.[1], reducer: /\.(mean|median)\s*\(/.exec(t)?.[1] })).filter((t) => t.start);
    const latest = statements.sort((a, b) => b.start!.localeCompare(a.start!))[0];
    if (latest?.reducer) {
      f.push({ level: "warn", text: `A .${latest.reducer}() over the flood period (from ${latest.start}) averages a short-lived flood away. Use .min() (darkest pass) for the flood period, or a single date.` });
    }
  }
  if (!spans.length) f.push({ level: "warn", text: "No filterDate(...) with two dates found, so the periods compared could not be checked." });

  if (!has(/instrumentMode/)) f.push({ level: "warn", text: "No filter on 'instrumentMode' = 'IW': other modes have different resolution and calibration." });
  if (!has(/transmitterReceiverPolarisation/)) f.push({ level: "warn", text: "No polarisation filter: not every scene has VV. Add .filter(ee.Filter.listContains('transmitterReceiverPolarisation', 'VV'))." });
  if (has(/S1_GRD(?!_FLOAT)/) && has(/log10|\.log\(/)) {
    f.push({ level: "error", text: "COPERNICUS/S1_GRD is already in decibels, but the script takes a logarithm. That converts twice and breaks any threshold; use S1_GRD_FLOAT for linear values, or drop the log." });
  }
  if (!has(/focal_(mean|median)|speckle|refined_?lee|lee\b/i)) f.push({ level: "warn", text: "No speckle filtering found: single-pass radar is grainy, and a threshold on it scatters false flood pixels. A 3x3 focal mean or median before thresholding helps." });
  if (!has(/\.(subtract|divide)\s*\(|difference|ratio/i)) f.push({ level: "warn", text: "No before-after comparison found: a threshold on the flood image alone also marks rivers, lakes, shadows and smooth tarmac as flooded. Compare with the before image." });
  return f;
}
