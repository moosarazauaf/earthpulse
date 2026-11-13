/**
 * Publication figures. Any chart wrapped in <Figure> gets "SVG" and "PNG"
 * buttons that save it in a print style (white page, dark text, a portable
 * font) with its title above and its data source below; on screen it keeps
 * the app's dark theme. PNG is 300 dpi at a journal single-page width.
 */
import { type ReactNode, useRef, useState } from "react";

import { downloadBlob } from "../analysis/download";

/** 160 mm, a common journal text width; at 300 dpi that is 1890 pixels. */
const WIDTH_MM = 160;
const DPI = 300;
const FONT = "Helvetica, Arial, sans-serif";
const STYLE_PROPS = ["fill", "fill-opacity", "stroke", "stroke-width", "stroke-dasharray", "stroke-opacity", "opacity", "font-size", "font-weight", "text-anchor", "dominant-baseline", "display", "visibility"];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Breaks text into lines of at most `chars` characters, at spaces. */
export function wrapText(text: string, chars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    if (line && (line + " " + word).length > chars) { lines.push(line); line = word; }
    else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** The chart as a standalone print-style SVG document, with title and source. */
export function paperSvg(svg: SVGSVGElement, title: string, source: string): { markup: string; width: number; height: number } {
  // Computed styles are read while the figure wears the print theme, then copied inline into a clone.
  const host = svg.closest("figure") ?? svg.parentElement!;
  host.classList.add("paper");
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const from = [svg, ...svg.querySelectorAll("*")], to = [clone, ...clone.querySelectorAll("*")];
  from.forEach((el, i) => {
    const cs = getComputedStyle(el);
    const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(";");
    to[i]!.setAttribute("style", `${style};font-family:${FONT}`);
  });
  host.classList.remove("paper");
  const box = svg.viewBox.baseVal;
  const w = box && box.width ? box.width : svg.clientWidth, h = box && box.height ? box.height : svg.clientHeight;
  const titleSize = w / 26, sourceSize = w / 46, pad = w / 32;
  const sourceLines = wrapText(source, Math.floor((w - 2 * pad) / (sourceSize * 0.52)));
  const titleLines = wrapText(title, Math.floor((w - 2 * pad) / (titleSize * 0.58)));
  const top = pad + titleSize * 1.25 * titleLines.length + titleSize * 0.3;
  const height = top + h + pad * 0.6 + sourceLines.length * sourceSize * 1.35 + pad * 0.6;
  clone.setAttribute("x", "0"); clone.setAttribute("y", String(top)); clone.setAttribute("width", String(w)); clone.setAttribute("height", String(h));
  clone.removeAttribute("class");
  const inner = new XMLSerializer().serializeToString(clone);
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH_MM}mm" height="${(WIDTH_MM * height) / w}mm" viewBox="0 0 ${w} ${height}">`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + titleLines.map((l, i) => `<text x="${pad}" y="${pad + titleSize * (1 + 1.25 * i)}" font-family="${FONT}" font-size="${titleSize}" font-weight="700" fill="#111">${esc(l)}</text>`).join("")
    + inner
    + sourceLines.map((l, i) => `<text x="${pad}" y="${top + h + pad * 0.6 + (i + 1) * sourceSize * 1.35}" font-family="${FONT}" font-size="${sourceSize}" fill="#444">${esc(l)}</text>`).join("")
    + `</svg>`;
  return { markup, width: w, height };
}

export async function exportFigure(svg: SVGSVGElement, format: "svg" | "png", title: string, source: string): Promise<void> {
  const { markup, width, height } = paperSvg(svg, title, source);
  const name = `earthsift-${slug(title)}`;
  if (format === "svg") { downloadBlob(`${name}.svg`, new Blob([markup], { type: "image/svg+xml" })); return; }
  const px = Math.round((WIDTH_MM / 25.4) * DPI);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("The figure could not be drawn.")); img.src = url; });
    const canvas = Object.assign(document.createElement("canvas"), { width: px, height: Math.round((px * height) / width) });
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (blob) downloadBlob(`${name}-300dpi.png`, blob);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A chart with print-quality export buttons. */
export function Figure({ title, source = "Made with Earthsift.", className = "chart", children }: { title: string; source?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);
  const [busy, setBusy] = useState(false);
  const save = async (format: "svg" | "png") => {
    const svg = ref.current?.querySelector("svg");
    if (!svg || busy) return;
    setBusy(true);
    try { await exportFigure(svg, format, title, source); } finally { setBusy(false); }
  };
  return (
    <figure ref={ref} className={`${className} figure`}>
      {children}
      <div className="figure-tools" aria-label={`Save "${title}" for a publication`}>
        <button className="link" onClick={() => void save("svg")} disabled={busy} title="Vector, for journals and editing">SVG</button>
        <button className="link" onClick={() => void save("png")} disabled={busy} title="300 dpi at 160 mm wide">PNG 300 dpi</button>
      </div>
    </figure>
  );
}

export interface BarChartSpec {
  title: string;
  unit: string;
  bars: { label: string; value: number; low?: number; high?: number; colour: string }[];
  source: string;
  /** Long labels read better as horizontal bars. */
  horizontal?: boolean;
}

const nice = (v: number) => {
  const p = 10 ** Math.floor(Math.log10(Math.max(v, 1e-9)));
  return [1, 2, 2.5, 5, 10].map((f) => f * p).find((n) => n >= v) ?? v;
};
const fmt = (v: number) => (v > 0 && v < 0.1 ? "<0.1" : v >= 1e6 ? `${(v / 1e6).toLocaleString("en", { maximumSignificantDigits: 3 })}M` : v >= 1e3 ? `${(v / 1e3).toLocaleString("en", { maximumSignificantDigits: 3 })}k` : v.toLocaleString("en", { maximumFractionDigits: 1 }));

/** Bars with optional error bars, in print colours, so the screen shows exactly what is saved. */
export function BarChart({ spec }: { spec: BarChartSpec }) {
  const top = nice(Math.max(...spec.bars.map((b) => b.high ?? b.value)) * 1.05);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * top);
  if (spec.horizontal) {
    const W = 360, labelW = 130, rowH = 18, H = 26 + spec.bars.length * rowH;
    const x = (v: number) => labelW + (v / top) * (W - labelW - 16);
    return (
      <Figure title={spec.title} source={spec.source} className="chart bar-chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.title}: ${spec.bars.map((b) => `${b.label} ${fmt(b.value)} ${spec.unit}`).join(", ")}`}>
          {ticks.map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={6} y2={H - 16} stroke="#d8d8d8" strokeWidth={0.6} />)}
          {spec.bars.map((b, i) => (
            <g key={b.label}>
              <text x={labelW - 6} y={14 + i * rowH + 7} textAnchor="end" fontSize={9} fill="#222">{b.label}</text>
              <rect x={labelW} y={8 + i * rowH} width={Math.max(0.5, x(b.value) - labelW)} height={rowH - 6} fill={b.colour} stroke="#333" strokeWidth={0.4} />
              <text x={x(b.value) + 3} y={14 + i * rowH + 7} fontSize={8} fill="#222">{fmt(b.value)}</text>
            </g>
          ))}
          {ticks.map((t) => <text key={`l${t}`} x={x(t)} y={H - 5} textAnchor="middle" fontSize={8} fill="#333">{fmt(t)}</text>)}
          <text x={W - 4} y={H - 5} textAnchor="end" fontSize={8} fill="#333" fontStyle="italic">{spec.unit}</text>
        </svg>
      </Figure>
    );
  }
  const W = 360, H = 200, left = 46, bottom = 30, slot = (W - left - 10) / spec.bars.length;
  const y = (v: number) => H - bottom - (v / top) * (H - bottom - 12);
  return (
    <Figure title={spec.title} source={spec.source} className="chart bar-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${spec.title}: ${spec.bars.map((b) => `${b.label} ${fmt(b.value)} ${spec.unit}${b.low !== undefined ? ` (${fmt(b.low)} to ${fmt(b.high!)})` : ""}`).join(", ")}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={W - 10} y1={y(t)} y2={y(t)} stroke="#d8d8d8" strokeWidth={0.6} />
            <text x={left - 5} y={y(t) + 3} textAnchor="end" fontSize={8} fill="#333">{fmt(t)}</text>
          </g>
        ))}
        <text x={10} y={(H - bottom) / 2} fontSize={8} fill="#333" transform={`rotate(-90 10 ${(H - bottom) / 2})`} textAnchor="middle">{spec.unit}</text>
        <line x1={left} x2={W - 10} y1={y(0)} y2={y(0)} stroke="#333" strokeWidth={0.8} />
        {spec.bars.map((b, i) => {
          const cx = left + slot * (i + 0.5), bw = slot * 0.55;
          return (
            <g key={b.label}>
              <rect x={cx - bw / 2} y={y(b.value)} width={bw} height={y(0) - y(b.value)} fill={b.colour} stroke="#333" strokeWidth={0.5} />
              {b.low !== undefined && b.high !== undefined && (
                <g stroke="#111" strokeWidth={1}>
                  <line x1={cx} x2={cx} y1={y(b.high)} y2={y(b.low)} />
                  <line x1={cx - 6} x2={cx + 6} y1={y(b.high)} y2={y(b.high)} />
                  <line x1={cx - 6} x2={cx + 6} y1={y(b.low)} y2={y(b.low)} />
                </g>
              )}
              <text x={cx} y={H - bottom + 13} textAnchor="middle" fontSize={9} fill="#222">{b.label}</text>
              <text x={cx} y={H - bottom + 24} textAnchor="middle" fontSize={8} fill="#555">{fmt(b.value)}</text>
            </g>
          );
        })}
      </svg>
    </Figure>
  );
}
