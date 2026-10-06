/**
 * The first question of every analysis: which area?
 * Shown over the globe until an area exists; the same choices stay available
 * in the side panel afterwards.
 */
import { type ChangeEvent, useRef, useState } from "react";

import { rectangleAoi } from "../app/logic";
import { useStore } from "../app/store";
import type { AoiGeometry } from "../app/types";
import { readAreaFile } from "./areaFile";

/** Indus floodplain between Taunsa and Layyah. */
const INDUS_AT_LAYYAH = { geometry: rectangleAoi(70.7, 30.75, 71.1, 31.25), label: "Indus at Layyah" };
/** Mangla reservoir on the Jhelum, a water body whose extent varies strongly. */
const MANGLA = { geometry: rectangleAoi(73.55, 33.02, 73.85, 33.3), label: "Mangla Reservoir" };

export async function loadLahore(): Promise<{ geometry: AoiGeometry; label: string }> {
  const response = await fetch(`${import.meta.env.BASE_URL}data/lahore-district.geojson`);
  const feature = await response.json();
  return { geometry: feature.geometry as AoiGeometry, label: "Lahore District" };
}

/** Draw, upload and preset controls. Used by the prompt and by the side panel. */
export function AreaChoices({ large = false }: { large?: boolean }) {
  const s = useStore();
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow choosing the same file again
    if (!file) return;
    setError(null);
    try {
      s.setAoi(await readAreaFile(file));
    } catch (problem) {
      setError(problem instanceof Error ? problem.message : "That file could not be read.");
    }
  }
  const toggle = (tool: "rectangle" | "polygon") => s.set({ drawTool: s.drawTool === tool ? "none" : tool });

  return (
    <div className={large ? "area-choices large" : "area-choices"}>
      <div className="seg">
        <button className={s.drawTool === "rectangle" ? "on" : ""} aria-pressed={s.drawTool === "rectangle"} onClick={() => toggle("rectangle")}>
          Draw a rectangle
        </button>
        <button className={s.drawTool === "polygon" ? "on" : ""} aria-pressed={s.drawTool === "polygon"} onClick={() => toggle("polygon")}>
          Draw a polygon
        </button>
        <button onClick={() => input.current?.click()}>Upload a file</button>
      </div>
      <input ref={input} type="file" hidden accept=".zip,.geojson,.json,application/zip,application/geo+json"
        aria-label="Upload a zipped shapefile or a GeoJSON file" onChange={onFile} />
      <p className="muted">Upload a zipped shapefile (.zip with .shp, .dbf, .prj) or a GeoJSON file. It is read in your browser and not sent anywhere.</p>
      {error && <p className="note" role="alert">{error}</p>}
      <div className="seg" aria-label="Example areas">
        <button onClick={() => void loadLahore().then(s.setAoi)}>Lahore District</button>
        <button onClick={() => s.setAoi(INDUS_AT_LAYYAH)}>Indus at Layyah</button>
        <button onClick={() => s.setAoi(MANGLA)}>Mangla Reservoir</button>
      </div>
      {s.drawTool === "rectangle" && <p className="note">Click two opposite corners on the globe. Esc cancels.</p>}
      {s.drawTool === "polygon" && <p className="note">Click each corner, then double-click or press Enter to close. Esc cancels.</p>}
    </div>
  );
}

const QUESTIONS: Record<string, string> = {
  change: "Where do you want to look for change?",
  floods: "Where do you want to map flooding?",
  water: "Which water body or region do you want to track?",
};

export function AreaPrompt() {
  const mode = useStore((s) => s.mode);
  const aoi = useStore((s) => s.aoi);
  const result = useStore((s) => s.result);
  const idle = useStore((s) => s.job.status === "idle" || s.job.status === "failed");
  const drawing = useStore((s) => s.drawTool !== "none");
  const intro = useStore((s) => s.introOpen);
  const story = useStore((s) => s.story);
  const question = QUESTIONS[mode];
  if (!question || aoi || result || !idle || intro || story) return null;
  // While the visitor is drawing, step aside so the globe is clear.
  if (drawing) {
    return <div className="notice" role="status">Drawing on the globe. Press Esc to cancel.</div>;
  }
  return (
    <div className="area-prompt" role="dialog" aria-modal="false" aria-labelledby="area-prompt-title">
      <p className="eyebrow">Step 1 · Area of interest</p>
      <h2 id="area-prompt-title">{question}</h2>
      <p className="muted">Every analysis is made for an area you choose. Move the globe to your region first, then pick one.</p>
      <AreaChoices large />
    </div>
  );
}
