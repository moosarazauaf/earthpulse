/** How each hazard is named and drawn. */
import type { Hazard } from "./types";

export const HAZARD_INFO: Record<Hazard, { label: string; colour: string }> = {
  earthquake: { label: "Earthquake", colour: "#f0a73a" },
  tsunami: { label: "Tsunami", colour: "#3fa7d6" },
  volcano: { label: "Volcano", colour: "#ff5a36" },
  landslide: { label: "Landslide", colour: "#c08a57" },
  flood: { label: "Flood", colour: "#4aa3ff" },
  storm: { label: "Storm", colour: "#a394ff" },
  tornado: { label: "Tornado", colour: "#d08cff" },
  wildfire: { label: "Wildfire", colour: "#ff7a1a" },
  rain: { label: "Heavy rain", colour: "#5fd0c5" },
  heat: { label: "Heat", colour: "#ff4d6d" },
  drought: { label: "Drought", colour: "#d6b25e" },
  winter: { label: "Snow and cold", colour: "#cfe8ff" },
  dust: { label: "Dust storm", colour: "#c9a46a" },
};

/** "3 h ago", "2 days ago". */
export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
