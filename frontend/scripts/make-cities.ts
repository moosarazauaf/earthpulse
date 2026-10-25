/**
 * Writes public/data/cities.json: the cities whose air quality the globe
 * shows. The 300 most populous cities, plus every national capital so each
 * country has at least one point. From GeoNames cities15000 (CC BY 4.0).
 *
 *   GAZETTEER_DIR=/path/to/geonames npx tsx scripts/make-cities.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.env.GAZETTEER_DIR;
if (!dir) throw new Error("Set GAZETTEER_DIR to a folder holding GeoNames' cities15000.txt.");

const rows = readFileSync(join(dir, "cities15000.txt"), "utf8").split("\n").filter(Boolean).map((line) => {
  const f = line.split("\t");
  return { name: f[2]!, lat: Number(f[4]), lon: Number(f[5]), code: f[7]!, country: f[8]!, population: Number(f[14]) };
});
const largest = [...rows].sort((a, b) => b.population - a.population).slice(0, 300);
const capitals = rows.filter((r) => r.code === "PPLC");
const chosen = [...new Map([...largest, ...capitals].map((r) => [`${r.name}|${r.country}`, r])).values()];
const round = (v: number) => Math.round(v * 100) / 100;
writeFileSync(
  join(import.meta.dirname, "..", "public", "data", "cities.json"),
  JSON.stringify(chosen.map((r) => [r.name, r.country, round(r.lat), round(r.lon)])),
);
console.log(`${chosen.length} cities written`);
