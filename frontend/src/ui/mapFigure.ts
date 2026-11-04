/**
 * A map figure for reports: the globe as it is on screen, with a title, a
 * scale bar, a north arrow, the legend of the layer shown and every data
 * credit, saved as a PNG.
 */
export interface Snapshot { image: string; width: number; height: number; metresPerPixel: number | null; heading: number; credits: string[] }
export interface Legend { title: string; stops: string; scale: string[] }

/** The longest round length (1, 2 or 5 × 10ⁿ m) whose bar fits in `maxPx`. */
export function niceScale(metresPerPixel: number, maxPx: number): { metres: number; px: number; label: string } {
  const most = metresPerPixel * maxPx;
  const power = 10 ** Math.floor(Math.log10(most));
  const metres = [5, 2, 1].map((f) => f * power).find((m) => m <= most) ?? power;
  return { metres, px: metres / metresPerPixel, label: metres >= 1000 ? `${(metres / 1000).toLocaleString("en")} km` : `${metres} m` };
}

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = () => reject(new Error("The globe image could not be read."));
  img.src = src;
});

/** Draws `stops` ("rgb(…), rgb(…) 16%, …") as a horizontal gradient. */
function gradient(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, stops: string) {
  const g = ctx.createLinearGradient(x, 0, x + w, 0);
  const parts = stops.split(/,(?![^(]*\))/).map((p) => p.trim());
  parts.forEach((p, i) => {
    const m = /^(.*?\))\s*([\d.]+%)?$/.exec(p);
    if (m) g.addColorStop(m[2] ? parseFloat(m[2]) / 100 : i / (parts.length - 1), m[1]!);
  });
  ctx.fillStyle = g;
  ctx.fillRect(x, y, w, 10);
}

export async function composeFigure(shot: Snapshot, title: string, subtitle: string, legend: Legend | null): Promise<Blob> {
  const img = await loadImage(shot.image);
  const k = Math.max(1, shot.width / 1200); // text and marks grow with the picture
  const pad = 16 * k, band = 64 * k;
  const canvas = document.createElement("canvas");
  canvas.width = shot.width;
  canvas.height = shot.height + band;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#14120e";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0);
  const font = (px: number, weight = 400) => `${weight} ${px * k}px Inter Variable, system-ui, sans-serif`;
  const box = (x: number, y: number, w: number, h: number) => { ctx.fillStyle = "rgba(20,18,14,0.78)"; ctx.fillRect(x, y, w, h); };

  // Title, top left.
  ctx.font = font(22, 600);
  const tw = Math.max(ctx.measureText(title).width, (ctx.font = font(13), ctx.measureText(subtitle).width));
  box(pad, pad, tw + 24 * k, 58 * k);
  ctx.fillStyle = "#ede6d8";
  ctx.font = font(22, 600);
  ctx.fillText(title, pad + 12 * k, pad + 28 * k);
  ctx.font = font(13);
  ctx.fillStyle = "#c9c0ae";
  ctx.fillText(subtitle, pad + 12 * k, pad + 48 * k);

  // North arrow, top right, turned with the camera.
  const nx = shot.width - pad - 22 * k, ny = pad + 30 * k;
  box(nx - 22 * k, pad, 44 * k, 58 * k);
  ctx.save();
  ctx.translate(nx, ny);
  ctx.rotate(-shot.heading);
  ctx.fillStyle = "#ede6d8";
  ctx.beginPath();
  ctx.moveTo(0, -16 * k); ctx.lineTo(8 * k, 10 * k); ctx.lineTo(0, 5 * k); ctx.lineTo(-8 * k, 10 * k); ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.font = font(12, 600);
  ctx.textAlign = "center";
  ctx.fillText("N", nx, pad + 54 * k);
  ctx.textAlign = "left";

  // Scale bar, bottom left of the map; left out when the view is too wide for one scale to hold.
  if (shot.metresPerPixel) {
    const s = niceScale(shot.metresPerPixel, shot.width * 0.22);
    const sy = shot.height - pad - 34 * k;
    box(pad, sy, s.px + 24 * k, 34 * k);
    ctx.fillStyle = "#ede6d8";
    ctx.fillRect(pad + 12 * k, sy + 22 * k, s.px, 4 * k);
    ctx.fillRect(pad + 12 * k, sy + 16 * k, 2 * k, 10 * k);
    ctx.fillRect(pad + 12 * k + s.px - 2 * k, sy + 16 * k, 2 * k, 10 * k);
    ctx.font = font(12);
    ctx.fillText(`${s.label} (at the centre)`, pad + 12 * k, sy + 13 * k);
  }

  // Legend, bottom right of the map.
  if (legend) {
    const lw = 240 * k, lx = shot.width - pad - lw, ly = shot.height - pad - 58 * k;
    box(lx, ly, lw, 58 * k);
    ctx.fillStyle = "#ede6d8";
    ctx.font = font(12, 600);
    ctx.fillText(legend.title, lx + 12 * k, ly + 17 * k);
    gradient(ctx, lx + 12 * k, ly + 24 * k, lw - 24 * k, legend.stops);
    ctx.fillStyle = "#c9c0ae";
    ctx.font = font(11);
    legend.scale.forEach((label, i) => {
      const x = lx + 12 * k + ((lw - 24 * k) * i) / Math.max(legend.scale.length - 1, 1);
      ctx.textAlign = i === 0 ? "left" : i === legend.scale.length - 1 ? "right" : "center";
      ctx.fillText(label, x, ly + 50 * k);
    });
    ctx.textAlign = "left";
  }

  // Credits band under the map.
  ctx.fillStyle = "#c9c0ae";
  ctx.font = font(12);
  const credits = `Data: ${shot.credits.join("; ") || "see EarthPulse"}`;
  const words = credits.split(" ");
  let line = "", y = shot.height + 22 * k;
  for (const w of words) {
    if (ctx.measureText(`${line} ${w}`).width > shot.width - 2 * pad && line) { ctx.fillText(line, pad, y); line = w; y += 16 * k; }
    else line = line ? `${line} ${w}` : w;
  }
  if (y < shot.height + band - 8 * k) ctx.fillText(line, pad, y);
  ctx.fillStyle = "#a3b18a";
  ctx.textAlign = "right";
  ctx.fillText("Made with EarthPulse · moosarazauaf.github.io/earthpulse", shot.width - pad, shot.height + band - 12 * k);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("The figure could not be saved."))), "image/png"));
}
