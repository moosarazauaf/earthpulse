/**
 * Map markers drawn as pixel-art badges: the hazard's icon (ui/HazardIcon) on
 * a dark tile with a border in the hazard's colour, or in the alert level's
 * colour for GDACS alerts. Drawn at twice size and shown at half, so they stay
 * crisp on high-density screens; each kind is drawn once and reused.
 */
import { HAZARD_INFO } from "../news/hazards";
import type { Hazard } from "../news/types";
import { ICONS } from "../ui/HazardIcon";

/** Pixels per icon pixel in the drawn badge (shown at half). */
const CELL = 6;
const PAD = 8;
export const BADGE_PX = 9 * CELL + 2 * PAD; // drawn size; shown at BADGE_PX / 2

const cache = new Map<string, HTMLCanvasElement>();

/** A badge for a hazard; `border` overrides the hazard colour, `flag` adds a corner mark in that colour. */
export function badge(hazard: Hazard, border?: string, flag?: string): HTMLCanvasElement {
  const key = `${hazard}|${border ?? ""}|${flag ?? ""}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const colour = HAZARD_INFO[hazard].colour;
  const canvas = Object.assign(document.createElement("canvas"), { width: BADGE_PX, height: BADGE_PX });
  const ctx = canvas.getContext("2d")!;
  // Tile with stepped corners, so it reads as pixel art rather than a rounded button.
  const edge = border ?? colour, b = 4;
  ctx.fillStyle = edge;
  ctx.fillRect(b, 0, BADGE_PX - 2 * b, BADGE_PX);
  ctx.fillRect(0, b, BADGE_PX, BADGE_PX - 2 * b);
  ctx.fillStyle = "#14120e";
  ctx.fillRect(b + 4, 4, BADGE_PX - 2 * b - 8, BADGE_PX - 8);
  ctx.fillRect(4, b + 4, BADGE_PX - 8, BADGE_PX - 2 * b - 8);
  ICONS[hazard].forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch === ".") return;
    ctx.fillStyle = ch === "+" ? "#fff6dc" : colour;
    ctx.fillRect(PAD + x * CELL, PAD + y * CELL, CELL, CELL);
  }));
  if (flag) {
    ctx.fillStyle = "#14120e";
    ctx.fillRect(BADGE_PX - 20, 0, 20, 20);
    ctx.fillStyle = flag;
    ctx.fillRect(BADGE_PX - 16, 4, 12, 12);
  }
  cache.set(key, canvas);
  return canvas;
}

/** GDACS event types as the hazards whose icons they use. */
export const GDACS_HAZARD: Record<string, Hazard> = { FL: "flood", WF: "wildfire", TC: "storm", EQ: "earthquake", DR: "drought", VO: "volcano" };

/**
 * Pixel offsets that fan out markers drawn on top of each other: points (in
 * screen pixels) falling in the same `cell` form a ring, wider for bigger
 * groups, so each badge can be seen and clicked; lone markers stay put.
 */
export function spreadOffsets(points: ({ x: number; y: number } | null)[], cell = 24, radiusPx = 16): [number, number][] {
  const groups = new Map<string, number[]>();
  points.forEach((p, i) => {
    if (!p) return;
    const key = `${Math.round(p.x / cell)},${Math.round(p.y / cell)}`;
    groups.set(key, [...(groups.get(key) ?? []), i]);
  });
  const out: [number, number][] = points.map(() => [0, 0]);
  for (const members of groups.values()) {
    if (members.length < 2) continue;
    const r = Math.max(radiusPx, members.length * 5);
    members.forEach((i, k) => {
      const angle = (2 * Math.PI * k) / members.length - Math.PI / 2;
      out[i] = [Math.round(Math.cos(angle) * r), Math.round(Math.sin(angle) * r)];
    });
  }
  return out;
}
