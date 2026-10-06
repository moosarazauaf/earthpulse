/**
 * Guided opening: Lahore, 1993 to today.
 *
 * The tour only moves the camera and the timeline over real imagery. It
 * states no statistics; those come from an analysis the user runs afterwards.
 */
import { loadLahore } from "../analysis/AreaPrompt";
import { currentYear } from "../app/logic";
import { useStore } from "../app/store";
import { getGlobe } from "../globe/GlobeViewer";

export const TOUR_START_YEAR = 1993;
/** Seconds each year stays on screen once its imagery has arrived. */
const HOLD_SECONDS = 3;
/** Longest wait for a year's imagery before moving on regardless. */
const MAX_LOAD_SECONDS = 25;
const STOPS: { caption: string; lon: number; lat: number; height: number; seconds: number }[] = [
  { caption: "South Asia", lon: 76, lat: 26, height: 6.5e6, seconds: 3 },
  { caption: "Pakistan", lon: 70.5, lat: 30, height: 2.6e6, seconds: 2.5 },
  { caption: "Punjab", lon: 73, lat: 31, height: 9e5, seconds: 2.5 },
];

export interface Story {
  title: string;
  caption: string;
  done: boolean;
}

let run = 0;
const wait = (seconds: number) => new Promise((resolve) => setTimeout(resolve, seconds * 1000));

export function stopTour() {
  run += 1;
  useStore.getState().set({ story: null });
}

export async function startLahoreTour() {
  const mine = ++run;
  const alive = () => mine === run;
  const store = useStore.getState();
  const globe = getGlobe();
  if (!globe) return;
  const say = (caption: string, done = false) =>
    useStore.getState().set({ story: { title: `Lahore · ${TOUR_START_YEAR} → ${currentYear()}`, caption, done } });

  store.set({ introOpen: false, mode: "explore", render: "truecolor", preferredDataset: "landsat", imageryVisible: true });
  store.setCompare({ enabled: false });
  store.setYear(TOUR_START_YEAR);

  for (const stop of STOPS) {
    say(stop.caption);
    await globe.flyTo(stop.lon, stop.lat, stop.height, stop.seconds);
    if (!alive()) return;
  }
  say("Lahore District");
  store.setAoi(await loadLahore()); // also frames the district
  await wait(2);

  const last = currentYear();
  const years = [TOUR_START_YEAR, 2003, 2013, 2023, last].filter((y, i, all) => y <= last && all.indexOf(y) === i);
  for (const year of years) {
    if (!alive()) return;
    useStore.getState().setYear(year);
    say(`Thirty years of land change · Landsat, ${year}`);
    await globe.whenTilesLoaded(MAX_LOAD_SECONDS);
    await wait(HOLD_SECONDS);
  }
  if (alive()) say("Compare the two ends of the record, then measure the change.", true);
}

/** "Explore the evidence": put 1993 and the latest year side by side under a swipe. */
export function exploreEvidence() {
  stopTour();
  const store = useStore.getState();
  store.setYear(currentYear());
  store.setCompare({ enabled: true, year: TOUR_START_YEAR, mode: "swipe", position: 0.5 });
  store.set({ mode: "change" });
}
