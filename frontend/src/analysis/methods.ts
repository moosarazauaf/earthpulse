/**
 * A methods paragraph and references for a result, written from its
 * provenance, so a researcher can paste what was done instead of
 * reconstructing it. Every sentence comes from the record; nothing is added.
 */
import type { AnalysisResult } from "../app/types";

const REPO = "https://github.com/moosarazauaf/earthpulse";
const sentence = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

export function methodsText(result: AnalysisResult, today = new Date().toISOString().slice(0, 10)): string {
  const p = result.provenance;
  const scenes = Object.values(p.scenes ?? {}).flat();
  const dates = scenes.map((s) => s.datetime.slice(0, 10)).sort();
  const platforms = [...new Set(scenes.map((s) => s.platform))].sort();
  const parts = [
    `The analysis was run with EarthPulse ${result.softwareVersion} (Raza, ${today.slice(0, 4)}), ${p.computedOn === "browser" ? "in the web browser, reading" : "using"} data from ${p.provider.name}.`,
    sentence(p.method),
    p.index && `${p.index.name} was computed as ${p.index.formula} (${p.index.reference}).`,
    p.cloudMask && `Cloud mask: ${sentence(p.cloudMask)}`,
    scenes.length > 0 && `${scenes.length} input${scenes.length === 1 ? "" : "s"} (${platforms.join(", ")}) dated ${dates[0]} to ${dates[dates.length - 1]} were used${p.maxCloudPercent !== undefined ? `, limited to ${p.maxCloudPercent}% scene cloud cover or less` : ""}; their identifiers are listed in the result record ${result.id}.`,
    `Processing was done in ${p.crs} at ${p.workingResolutionM} m (native resolution ${p.nativeResolutionM} m).`,
    p.landCover && `Land cover came from ${p.landCover.name} (${p.landCover.provider}, ${p.landCover.license}).`,
    p.uncertainty && sentence(p.uncertainty),
  ].filter(Boolean);

  const refs = [
    `Raza, M. M. (${today.slice(0, 4)}). EarthPulse: browser-based, reproducible satellite change analysis (Version ${result.softwareVersion}) [Computer software]. ${REPO}`,
    p.index && p.index.reference,
    platforms.some((x) => /landsat/i.test(x)) && "Landsat Collection 2 Level-2 data courtesy of the U.S. Geological Survey.",
    platforms.some((x) => /sentinel/i.test(x)) && `Contains modified Copernicus Sentinel data ${dates[0]?.slice(0, 4)}–${dates[dates.length - 1]?.slice(0, 4)}, processed by ESA.`,
    p.landCover && sentence(p.landCover.attribution),
    `${p.provider.name}, accessed ${today}.`,
  ].filter(Boolean);

  return `${parts.join(" ")}\n\nReferences\n${refs.map((r) => `- ${r}`).join("\n")}\n`;
}
