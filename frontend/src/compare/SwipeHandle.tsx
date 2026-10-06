/** The draggable divider between two years of imagery. */
import { type KeyboardEvent, type PointerEvent, useRef } from "react";

import { useStore } from "../app/store";

const KEY_STEP = 0.02;

export function SwipeHandle() {
  const compare = useStore((s) => s.compare);
  const year = useStore((s) => s.year);
  const setCompare = useStore((s) => s.setCompare);
  const dragging = useRef(false);

  if (!compare.enabled || compare.mode !== "swipe") return null;

  const moveTo = (clientX: number) =>
    setCompare({ position: Math.min(0.98, Math.max(0.02, clientX / window.innerWidth)) });
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) moveTo(event.clientX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowLeft") setCompare({ position: Math.max(0.02, compare.position - KEY_STEP) });
    if (event.key === "ArrowRight") setCompare({ position: Math.min(0.98, compare.position + KEY_STEP) });
  };

  return (
    <div className="swipe" style={{ left: `${compare.position * 100}%` }} role="slider" tabIndex={0}
      aria-label={`Divider between ${compare.year} on the left and ${year} on the right`}
      aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(compare.position * 100)}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={() => { dragging.current = false; }} onKeyDown={onKeyDown}>
      <span className="swipe-label left">{compare.year}</span>
      <span className="swipe-grip" aria-hidden="true">⇆</span>
      <span className="swipe-label right">{year}</span>
    </div>
  );
}
