/** Tables from browser results as CSV, for spreadsheets and statistics software. */
import type { AnalysisResult } from "../app/types";

function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  const text = typeof v === "number" ? (Number.isInteger(v) ? String(v) : v.toFixed(6)) : String(v);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

const rows = (header: string[], body: unknown[][]) => [header, ...body].map((r) => r.map(cell).join(",")).join("\n") + "\n";

/** The result's main table, or null when it has none. Header lines start with # and carry the provenance. */
export function resultCsv(result: AnalysisResult): string | null {
  const head = `# EarthPulse ${result.softwareVersion} · ${result.id} · ${result.label ?? ""} · ${result.valueKind}\n`;
  if (result.type === "timeseries") {
    return head + rows(
      ["year", "status", "ndvi", "ndwi", "mndwi", "ndbi", "valid_fraction", "sensors", "scenes"],
      result.series.map((e) => [e.year, e.status, e.values?.ndvi, e.values?.ndwi, e.values?.mndwi, e.values?.ndbi, e.validFraction, (e.platforms ?? []).join(" "), e.scenes?.length ?? 0]),
    );
  }
  if (result.type === "urban") {
    const classes = [...new Set(result.series.flatMap((s) => Object.keys(s.classes)))].sort((a, b) => Number(a) - Number(b));
    return head + rows(
      ["year", `${result.summary.focusName.toLowerCase().replace(/\s+/g, "_")}_ha`, ...classes.map((c) => `class_${c}_ha`)],
      result.series.map((s) => [s.year, s.focusHa, ...classes.map((c) => s.classes[c] ?? 0)]),
    );
  }
  if (result.type === "disturbance") {
    return head + rows(["from_year", "to_year", "canopy_loss_ha"], result.summary.periods.map((p) => [p.from, p.to, p.ha]));
  }
  if (result.type === "classify") {
    const s = result.summary;
    const names = result.request.classes;
    const areas = rows(["class", "area_ha", "share"], s.classes.map((c) => [c.name, c.ha, c.share]));
    if (!s.accuracy) return head + areas;
    const a = s.accuracy;
    const matrix = rows(["reference \\ predicted", ...names, "producers_accuracy"], names.map((n, i) => [n, ...a.matrix[i]!, a.producers[i]]));
    const users = rows(["users_accuracy", ...a.users.map((u) => (Number.isFinite(u) ? u.toFixed(6) : "")), ""], []);
    return `${head}${areas}
# confusion matrix of held-back test pixels; overall accuracy ${a.overall.toFixed(4)}, kappa ${a.kappa.toFixed(4)}, n ${a.n}
${matrix}${users}`;
  }
  if (result.type === "change" || result.type === "flood") {
    return head + rows(
      ["region", "direction", "area_ha", "before", "after", "change", "centroid_lon", "centroid_lat"],
      result.detections.features.map((f) => [f.id, f.properties.direction, f.properties.areaHa, f.properties.before, f.properties.after, f.properties.change, f.properties.centroid[0], f.properties.centroid[1]]),
    );
  }
  return null;
}
