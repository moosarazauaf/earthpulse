/**
 * Keyboard shortcuts for everything a regular user does often, and the card
 * that lists them (press ?). Keys are ignored while typing in a field.
 */
import { useEffect, useMemo, useRef } from "react";

import { useStore } from "../app/store";
import { quickActions } from "../area/actions";
import { deviceProfile } from "../engine/client";
import { getGlobe } from "../globe/GlobeViewer";
import { ANALYSES } from "./modes";
import { shareUrl } from "./TopBar";

export const SHORTCUTS: { group: string; keys: [string, string][] }[] = [
  {
    group: "Go to",
    keys: [["L", "Live: hazards in the news, alerts, map layers"], ["N", "The news list"], ["E", "Explore imagery"], ["O", "Overview of the current area"], ["Shift 1–9", "An analysis, in the order of the Analyse menu"]],
  },
  {
    group: "Choose an area",
    keys: [["A", "Analyse here: click a spot on the globe"], ["M", "My places: saved areas and recent analyses"], ["Shift S", "Save the current area"], ["R", "Draw a rectangle"], ["P", "Draw a polygon (Enter closes it)"], ["U", "Upload a shapefile or GeoJSON"], ["X", "Clear the area"], ["D", "Measure a distance or an area"], ["Esc", "Cancel drawing, close a card"]],
  },
  {
    group: "In the area overview",
    keys: [["1–8", "Run one of the one-click analyses"]],
  },
  {
    group: "Globe and time",
    keys: [["/", "Search for a place or coordinates"], ["H", "Back to the whole Earth"], ["← →", "Previous or next year"], ["Space", "Play or pause the years"], ["C", "Compare with another year"], ["S", "Copy a link to this view"], ["?", "This list"]],
  },
];

function typing(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return el.isContentEditable || tag === "TEXTAREA" || tag === "SELECT" || (tag === "INPUT" && !["checkbox", "radio", "button", "range"].includes((el as HTMLInputElement).type));
}

export function useShortcuts() {
  const device = useMemo(deviceProfile, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || typing(event.target)) return;
      const s = useStore.getState();
      const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
      const digit = /^Digit([1-9])$/.exec(event.code)?.[1];
      // Arrow keys on the year slider already move it; do not move it twice.
      if ((key === "ArrowLeft" || key === "ArrowRight") && (event.target as HTMLElement)?.getAttribute?.("type") === "range") return;
      let handled = true;
      if (digit && event.shiftKey) {
        const analysis = ANALYSES[Number(digit) - 1];
        if (analysis) s.set({ mode: analysis.id, introOpen: false }); else handled = false;
      } else if (digit) {
        const running = s.job.status === "running" || s.job.status === "submitting";
        const info = s.mode === "area" && s.aoi && !running ? quickActions(s.aoi.geometry, s.aoi.label)[Number(digit) - 1] : undefined;
        if (info) s.runQuick(info, device); else handled = false;
      } else if (key === "?") s.set({ shortcutsOpen: !s.shortcutsOpen });
      else if (key === "Escape" && s.shortcutsOpen) s.set({ shortcutsOpen: false });
      else if (key === "/") document.querySelector<HTMLInputElement>(".search input")?.focus();
      else if (key === "l") s.set({ mode: "live", introOpen: false });
      else if (key === "n") s.set({ mode: "live", liveTab: "news", selectedStory: null, introOpen: false });
      else if (key === "e") s.set({ mode: "explore", introOpen: false });
      else if (key === "o") s.set({ mode: "area", introOpen: false });
      else if (key === "a") s.set({ drawTool: s.drawTool === "point" ? "none" : "point", introOpen: false });
      else if (key === "r") s.set({ drawTool: s.drawTool === "rectangle" ? "none" : "rectangle", introOpen: false });
      else if (key === "p") s.set({ drawTool: s.drawTool === "polygon" ? "none" : "polygon", introOpen: false });
      else if (key === "u") {
        const input = document.querySelector<HTMLInputElement>('input[type="file"]');
        if (input) input.click(); else s.set({ mode: s.mode === "explore" || s.mode === "live" ? "area" : s.mode, introOpen: false, notice: "Press U again to choose the file." });
      } else if (key === "x") s.setAoi(null);
      else if (key === "m") s.set({ placesOpen: !s.placesOpen });
      else if (key === "d") s.set(s.drawTool === "measure" ? { drawTool: "none" } : { drawTool: "measure", measure: [], introOpen: false });
      else if (key === "h") void getGlobe()?.resetView();
      else if (key === "ArrowLeft") s.setYear(s.year - 1);
      else if (key === "ArrowRight") s.setYear(s.year + 1);
      else if (key === " ") document.querySelector<HTMLButtonElement>(".timeline .icon-btn")?.click();
      else if (key === "c") s.setCompare({ enabled: !s.compare.enabled });
      else if (key === "s" && event.shiftKey) s.saveCurrentPlace();
      else if (key === "s") {
        const url = shareUrl();
        window.history.replaceState(null, "", url);
        void navigator.clipboard?.writeText(url).then(
          () => s.set({ notice: "Link to this view copied." }),
          () => s.set({ notice: "The link to this view is in the address bar." }),
        );
      } else handled = false;
      if (handled) event.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [device]);
}

export function ShortcutsCard() {
  const open = useStore((s) => s.shortcutsOpen);
  const set = useStore((s) => s.set);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  return (
    <dialog ref={dialog} className="sheet shortcuts" aria-labelledby="shortcuts-title" onClose={() => set({ shortcutsOpen: false })}>
      <header className="row">
        <h2 id="shortcuts-title">Keyboard shortcuts</h2>
        <button className="ghost" onClick={() => set({ shortcutsOpen: false })}>Close</button>
      </header>
      {SHORTCUTS.map((g) => (
        <section key={g.group}>
          <h3>{g.group}</h3>
          <dl className="keys">
            {g.keys.map(([k, what]) => (
              <div key={k}><dt><kbd>{k}</kbd></dt><dd>{what}</dd></div>
            ))}
          </dl>
        </section>
      ))}
    </dialog>
  );
}
