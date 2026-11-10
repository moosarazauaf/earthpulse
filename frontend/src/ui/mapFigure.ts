/**
 * A map figure for publication: a white page with the title above, the view
 * drawn at twice screen resolution inside a neat line with latitude and
 * longitude ticks around it, a scale bar and north arrow on the map, and the
 * legend and every data credit below. Saved as PNG.
 */
type LonLat = { lon: number; lat: number } | null;
export interface Snapshot {
  image: string; width: number; height: number; metresPerPixel: number | null; heading: number; credits: string[];
  edges?: Record<"top" | "bottom" | "left" | "right", LonLat[]>;
}
export interface Legend { title: string; stops: string; scale: string[] }

/** The longest round length (1, 2 or 5 × 10ⁿ m) whose bar fits in `maxPx`. */
export function niceScale(metresPerPixel: number, maxPx: number): { metres: number; px: number; label: string } {
  const most = metresPerPixel * maxPx;
  const power = 10 ** Math.floor(Math.log10(most));
  const metres = [5, 2, 1].map((f) => f * power).find((m) => m <= most) ?? power;
  return { metres, px: metres / metresPerPixel, label: metres >= 1000 ? `${(metres / 1000).toLocaleString("en")} km` : `${metres} m` };
}

const STEPS = [0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 15, 30];

/**
 * Where round degree values cross one edge of the map: `values` are the
 * longitudes (or latitudes) at even steps along it. Returns each tick's
 * position from 0 to 1 and its value; none when part of the edge is off the
 * globe, where degrees would mislead.
 */
export function edgeTicks(values: (number | null)[], target = 4): { at: number; value: number; step: number }[] {
  if (values.length < 2 || values.some((v) => v === null)) return [];
  const v = values as number[];
  const span = Math.abs(v[v.length - 1]! - v[0]!);
  if (!span) return [];
  const step = STEPS.find((s) => span / s <= target + 1) ?? 30;
  const out: { at: number; value: number; step: number }[] = [];
  for (let i = 1; i < v.length; i += 1) {
    const a = v[i - 1]!, b = v[i]!;
    // Across the date line one step jumps by nearly 360°; no tick is placed there.
    if (Math.abs(b - a) > 180) continue;
    const lo = Math.min(a, b), hi = Math.max(a, b);
    for (let k = Math.ceil(lo / step); k * step <= hi; k += 1) {
      const value = Number((k * step).toFixed(6));
      if (out.some((o) => o.value === value)) continue;
      const t = (i - 1 + (b === a ? 0 : (value - a) / (b - a))) / (v.length - 1);
      if (t > 0.02 && t < 0.98) out.push({ at: t, value, step });
    }
  }
  return out;
}

export const degreeLabel = (value: number, step: number, axis: "lon" | "lat") => {
  // As many decimals as the step needs, so 0.25° ticks read 70.75, not a rounded 70.8.
  let d = 0;
  while (d < 4 && Math.abs(Math.round(step * 10 ** d) - step * 10 ** d) > 1e-9) d += 1;
  const hemi = axis === "lon" ? (value < 0 ? "W" : value > 0 ? "E" : "") : (value < 0 ? "S" : value > 0 ? "N" : "");
  return `${Math.abs(value).toFixed(d)}°${hemi}`;
};

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("The globe image could not be read."));
  img.src = src;
});

/** Draws `stops` ("rgb(…), rgb(…) 16%, …") as a horizontal gradient. */
function gradient(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, stops: string) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  const parts = stops.split(/,(?![^(]*\))/).map((p) => p.trim());
  parts.forEach((p, i) => {
    const m = /^(.*?\))\s*([\d.]+%)?$/.exec(p);
    if (m) g.addColorStop(m[2] ? parseFloat(m[2]) / 100 : i / (parts.length - 1), m[1]!);
  });
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, h);
}

export async function composeFigure(shot: Snapshot, title: string, subtitle: string, legend: Legend | null): Promise<Blob> {
  const img = await loadImage(shot.image);
  const k = shot.width / 1200; // marks and text grow with the picture
  const font = (px: number, weight = 400) => `${weight} ${px * k}px Helvetica, Arial, sans-serif`;
  const side = 64 * k, head = 92 * k, foot = (legend ? 116 : 74) * k;
  const W = shot.width + 2 * side, H = head + shot.height + foot;
  const canvas = Object.assign(document.createElement("canvas"), { width: Math.round(W), height: Math.round(H) });
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, H);

  // Title and subtitle.
  ctx.fillStyle = "#111";
  ctx.font = font(26, 700);
  ctx.fillText(title, side, 40 * k);
  ctx.fillStyle = "#444";
  ctx.font = font(15);
  ctx.fillText(subtitle, side, 64 * k);

  // The map inside its neat line.
  const mx = side, my = head;
  ctx.drawImage(img, mx, my);
  ctx.strokeStyle = "#111";
  ctx.lineWidth = 2 * k;
  ctx.strokeRect(mx, my, shot.width, shot.height);

  // Latitude and longitude ticks around the frame.
  if (shot.edges) {
    ctx.fillStyle = "#222";
    ctx.font = font(12);
    const tick = 8 * k;
    const lonTicks = (pts: LonLat[], y: number, dir: 1 | -1) => {
      for (const t of edgeTicks(pts.map((p) => p?.lon ?? null))) {
        const x = mx + t.at * shot.width;
        ctx.fillRect(x - k, y, 2 * k, dir * tick);
        ctx.textAlign = "center";
        ctx.fillText(degreeLabel(t.value, t.step, "lon"), x, dir < 0 ? y - tick - 4 * k : y + tick + 13 * k);
      }
    };
    const latTicks = (pts: LonLat[], x: number, dir: 1 | -1) => {
      for (const t of edgeTicks(pts.map((p) => p?.lat ?? null))) {
        const y = my + t.at * shot.height;
        ctx.fillRect(x, y - k, dir * tick, 2 * k);
        ctx.save();
        ctx.translate(dir < 0 ? x - tick - 5 * k : x + tick + 5 * k, y);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "center";
        ctx.fillText(degreeLabel(t.value, t.step, "lat"), 0, dir < 0 ? 0 : 10 * k);
        ctx.restore();
      }
    };
    lonTicks(shot.edges.top, my, -1);
    lonTicks(shot.edges.bottom, my + shot.height, 1);
    latTicks(shot.edges.left, mx, -1);
    latTicks(shot.edges.right, mx + shot.width, 1);
    ctx.textAlign = "left";
  }

  const box = (x: number, y: number, w: number, h: number) => {
    ctx.fillStyle = "rgba(255,255,255,0.88)";
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = "#333";
    ctx.lineWidth = k;
    ctx.strokeRect(x, y, w, h);
  };
  const pad = 14 * k;

  // North arrow, top right of the map, turned with the camera.
  const nx = mx + shot.width - pad - 20 * k, ny = my + pad + 26 * k;
  box(nx - 20 * k, my + pad, 40 * k, 58 * k);
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(-shot.heading);
  ctx.fillStyle = "#111";
  ctx.beginPath();
  ctx.moveTo(0, -16 * k); ctx.lineTo(8 * k, 10 * k); ctx.lineTo(0, 5 * k); ctx.lineTo(-8 * k, 10 * k); ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#111";
  ctx.font = font(12, 700);
  ctx.textAlign = "center";
  ctx.fillText("N", nx, my + pad + 52 * k);
  ctx.textAlign = "left";

  // Scale bar, bottom left of the map, with alternating segments; left out when the view is too wide for one scale.
  if (shot.metresPerPixel) {
    const s = niceScale(shot.metresPerPixel, shot.width * 0.22);
    const sx = mx + pad + 10 * k, sy = my + shot.height - pad - 16 * k;
    box(mx + pad, sy - 24 * k, s.px + 20 * k, 36 * k);
    for (let i = 0; i < 4; i += 1) {
      ctx.fillStyle = i % 2 ? "#fff" : "#111";
      ctx.fillRect(sx + (i * s.px) / 4, sy, s.px / 4, 6 * k);
    }
    ctx.strokeStyle = "#111";
    ctx.strokeRect(sx, sy, s.px, 6 * k);
    ctx.fillStyle = "#111";
    ctx.font = font(12);
    ctx.fillText("0", sx - 3 * k, sy - 6 * k);
    ctx.textAlign = "right";
    ctx.fillText(s.label, sx + s.px + 4 * k, sy - 6 * k);
    ctx.textAlign = "left";
  }

  // Legend and credits under the map.
  // Below the bottom tick labels.
  let y = my + shot.height + 50 * k;
  if (legend) {
    ctx.fillStyle = "#111";
    ctx.font = font(13, 700);
    ctx.fillText(legend.title, mx, y);
    const lw = Math.min(360 * k, shot.width * 0.45);
    gradient(ctx, mx, y + 8 * k, lw, 12 * k, legend.stops);
    ctx.strokeStyle = "#333";
    ctx.strokeRect(mx, y + 8 * k, lw, 12 * k);
    ctx.font = font(11);
    ctx.fillStyle = "#222";
    legend.scale.forEach((label, i) => {
      const x = mx + (lw * i) / Math.max(legend.scale.length - 1, 1);
      ctx.textAlign = i === 0 ? "left" : i === legend.scale.length - 1 ? "right" : "center";
      ctx.fillText(label, x, y + 34 * k);
    });
    ctx.textAlign = "left";
    y += 54 * k;
  }
  ctx.fillStyle = "#444";
  ctx.font = font(11);
  const credits = `Data: ${shot.credits.join("; ") || "see Earthsift"}. Made with Earthsift (moosarazauaf.github.io/earthsift).`;
  let line = "";
  for (const w of credits.split(" ")) {
    if (ctx.measureText(`${line} ${w}`).width > shot.width && line) { ctx.fillText(line, mx, y); line = w; y += 15 * k; }
    else line = line ? `${line} ${w}` : w;
  }
  ctx.fillText(line, mx, y);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The figure could not be saved."))), "image/png"));
}
