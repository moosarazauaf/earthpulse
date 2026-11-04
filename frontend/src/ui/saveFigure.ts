/** Saves the current view as a map figure (see mapFigure.ts). */
import { downloadBlob } from "../analysis/download";
import { formatLatLon } from "../app/logic";
import { useStore } from "../app/store";
import { earthLayer } from "../globe/earthToday";
import { getGlobe } from "../globe/GlobeViewer";
import { composeFigure } from "./mapFigure";

const POPULATION = { title: "People per km², 2020", stops: "rgb(255,242,209), rgb(252,147,63) 33.3%, rgb(240,59,32) 66.7%, rgb(189,0,38)", scale: ["<1", "150", "500", "1,000+"] };

export async function saveFigure(): Promise<void> {
  const s = useStore.getState();
  const globe = getGlobe();
  if (!globe) return;
  try {
    const shot = globe.snapshot();
    const view = globe.cameraView();
    const title = s.aoi?.label ?? s.district?.name ?? "EarthPulse map";
    const date = new Date().toISOString().slice(0, 10);
    const layer = earthLayer(s.earthLayer);
    const legend = layer ? { title: layer.label, stops: layer.stops, scale: layer.scale } : s.populationOn ? POPULATION : null;
    const blob = await composeFigure(shot, title, `Centre ${formatLatLon(view.lat, view.lon)} · ${date}`, legend);
    downloadBlob(`earthpulse-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-${date}.png`, blob);
    s.set({ notice: "Map image saved, with scale, north arrow and data credits." });
  } catch {
    s.set({ notice: "The map image could not be made; one of the layers on show does not allow copying. Turn it off and try again." });
  }
}
