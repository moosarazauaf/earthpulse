/**
 * Satellite analyses that can test a news story, with dates and an area
 * worked out from the story. They are proposed, never started: the visitor
 * confirms first, because each one downloads imagery.
 */
import { rectangleAoi } from "../app/logic";
import type { SharedRun } from "../app/shareRun";
import type { NewsStory } from "./types";

const DAY_MS = 86_400_000;
/** Half the side of the analysis box, in degrees of latitude. */
const HALF_SIDE: Record<"city" | "region", number> = { city: 0.12, region: 0.3 };

export interface StoryAction {
  id: "flood" | "burn" | "scars";
  label: string;
  /** What the analysis will show, in one line. */
  explain: string;
  /** Why the result may be empty or early. */
  caution: string | null;
  mode: "floods" | "fires" | "change";
  /** Null when the story is placed only to a country: the visitor draws the area. */
  run: SharedRun | null;
}

function day(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/** A square of roughly equal sides on the ground around the story's place. */
export function storyArea(story: NewsStory) {
  if (story.place.precision === "country") return null;
  const h = HALF_SIDE[story.place.precision];
  const w = h / Math.max(Math.cos((story.place.lat * Math.PI) / 180), 0.2);
  const { lat, lon } = story.place;
  return rectangleAoi(lon - w, lat - h, lon + w, lat + h);
}

export function storyActions(story: NewsStory, maxPixels: number, now = new Date()): StoryAction[] {
  const event = Date.parse(`${story.first.slice(0, 10)}T00:00:00Z`);
  const today = Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`);
  const since = Math.round((today - event) / DAY_MS);
  const aoi = storyArea(story);
  const label = `${story.place.name}, news of ${day(event)}`;
  const make = (kind: SharedRun["kind"], request: Record<string, unknown>): SharedRun | null =>
    aoi ? { kind, maxPixels, request: { aoi, label, ...request } } : null;
  const actions: StoryAction[] = [];
  const h = story.hazards;

  if (h.some((x) => ["flood", "rain", "storm", "tsunami", "tornado"].includes(x))) {
    actions.push({
      id: "flood",
      label: "Map the flood water with radar",
      explain: "FloodLens compares Sentinel-1 radar before and after the event. Radar sees through cloud.",
      caution: since < 6 ? "Sentinel-1 passes every 6 to 12 days, so there may be no radar image since the event yet. FloodLens will say so." : null,
      mode: "floods",
      run: make("flood", {
        before: { start: day(event - 36 * DAY_MS), end: day(event - 8 * DAY_MS) },
        flood: { start: day(event - 2 * DAY_MS), end: day(Math.min(event + 10 * DAY_MS, today)) },
        minAreaHa: 1,
      }),
    });
  }
  if (h.includes("wildfire")) {
    actions.push({
      id: "burn",
      label: "Map the burn scar",
      explain: "FireWatch compares Sentinel-2 before and after and maps burn severity (dNBR).",
      caution: since < 5 ? "A clear Sentinel-2 image after the fire may not exist yet; smoke and cloud also hide the ground. Try again in a week if nothing is found." : null,
      mode: "fires",
      run: make("change", {
        dataset: "sentinel2", index: "nbr", threshold: 0.1, maxCloud: 20, minAreaHa: 1,
        before: { start: day(event - 40 * DAY_MS), end: day(event - 3 * DAY_MS) },
        after: { start: day(event), end: day(today) },
      }),
    });
  }
  if (h.includes("landslide") || h.includes("earthquake")) {
    actions.push({
      id: "scars",
      label: h.includes("landslide") ? "Look for landslide scars" : "Look for landslides the shaking set off",
      explain: "Fresh landslides strip vegetation, so they show as a sharp fall in NDVI between Sentinel-2 images before and after.",
      caution: "Cloud often follows heavy rain, so a clear image after the event can take weeks. Not every fall in NDVI is a landslide: harvests do the same.",
      mode: "change",
      run: make("change", {
        dataset: "sentinel2", index: "ndvi", maxCloud: 20, minAreaHa: 0.5,
        before: { start: day(event - 60 * DAY_MS), end: day(event - 3 * DAY_MS) },
        after: { start: day(event), end: day(today) },
      }),
    });
  }
  return actions;
}
