/**
 * Sentri, the Earthsift assistant: a small pixel-art satellite with solar
 * panels, a radar dish and an antenna light, drawn from character grids as
 * crisp SVG squares. Moods change the face and the animation; all motion is
 * CSS (styles.css, "Sentri") and stops for visitors who ask for reduced motion.
 */
export type Mood = "idle" | "thinking" | "happy" | "warn";

// 16 x 12 grid, one character per pixel ("." is empty).
// o outline, b body, h highlight, p panel cell, q panel seam, a strut/antenna/mount, l light, d radar dish.
const BODY = [
  ".......ll.......",
  ".......aa.......",
  "....oooooooo....",
  "....ohhbbbbo....",
  "ppp.obbbbbbo.ppp",
  "qqqaobbbbbboaqqq",
  "pppaobbbbbboappp",
  "qqq.obbbbbbo.qqq",
  "ppp.obbbbbbo.ppp",
  "....oooooooo....",
  ".......aa.......",
  ".....dddddd.....",
];

// Faces sit on top of the body: e eye, c cheek, m mouth.
const FACES: Record<"open" | "blink" | "happy" | "up", string[]> = {
  open: ["......e..e......", "......e..e......", ".....c....c.....", ".......mm......."],
  /** Eyelids: body-coloured squares over the top of each eye, shown for a moment to blink. */
  blink: ["......b..b......"],
  happy: ["................", ".....ee..ee.....", ".....c....c.....", "......mmmm......"],
  up: ["......e..e......", "................", ".....c....c.....", "........m......."],
};
const FACE_TOP = 4;

const COLOURS: Record<string, string> = {
  o: "#4f5d3b", b: "#a3b18a", h: "#d6dcc4", p: "#6a9ab0", q: "#3d5a68", a: "#8a8576",
  l: "#d9a441", d: "#c9c0ae", e: "#14120e", c: "#d0703f", m: "#14120e",
};

function Pixels({ rows, top = 0, className }: { rows: string[]; top?: number; className?: string }) {
  return (
    <g className={className}>
      {rows.flatMap((row, y) => [...row].map((ch, x) => (ch === "." ? null : <rect key={`${x}-${y}`} x={x} y={y + top} width={1} height={1} fill={COLOURS[ch]} />)))}
    </g>
  );
}

const panels = (side: "left" | "right") => BODY.map((row) => (side === "left" ? row.slice(0, 4) + ".".repeat(12) : ".".repeat(12) + row.slice(12)));
const core = BODY.map((row) => `....${row.slice(4, 12)}....`);

export function Sentri({ mood = "idle", size = 48, title }: { mood?: Mood; size?: number; title?: string }) {
  const face = mood === "happy" ? FACES.happy : mood === "thinking" ? FACES.up : FACES.open;
  return (
    <svg className={`sentri sentri-${mood}`} width={size} height={size} viewBox="-2 -4 20 20" shapeRendering="crispEdges"
      role={title ? "img" : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <g className="sentri-body">
        <Pixels rows={panels("left")} className="sentri-panel left" />
        <Pixels rows={panels("right")} className="sentri-panel right" />
        <Pixels rows={core} />
        {/* The light is drawn again on its own so it can blink. */}
        <rect className="sentri-light" x={7} y={0} width={2} height={1} fill="#ffd27a" />
        <Pixels rows={face} top={FACE_TOP} className="sentri-face" />
        {mood === "idle" && <Pixels rows={FACES.blink} top={FACE_TOP} className="sentri-blink" />}
      </g>
      {mood === "thinking" && (
        <g className="sentri-waves" fill="#d9a441">
          <rect x={6} y={13} width={4} height={0.6} />
          <rect x={4.5} y={14.4} width={7} height={0.6} />
          <rect x={3} y={15.8} width={10} height={0.6} />
        </g>
      )}
      {mood === "warn" && (
        <g className="sentri-alert" fill="#d9a441">
          <rect x={14} y={-4} width={2} height={3} />
          <rect x={14} y={0} width={2} height={1} />
        </g>
      )}
    </svg>
  );
}
