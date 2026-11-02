/**
 * Ways of looking at the globe: post-process filters over the rendered
 * scene (the panels and figures are untouched). They recolour by
 * brightness only, so they are a way of seeing, not a measurement:
 * "thermal" here is not surface temperature (HeatWatch measures that).
 */
export const VIEW_MODES = [
  { id: "standard", label: "Standard" },
  { id: "night", label: "Night vision" },
  { id: "thermal", label: "Thermal look" },
  { id: "mono", label: "Mono" },
] as const;
export type ViewMode = (typeof VIEW_MODES)[number]["id"];

const HEAD = `
uniform sampler2D colorTexture;
in vec2 v_textureCoordinates;
float luminance(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
float vignette(vec2 uv) { vec2 d = uv - 0.5; return smoothstep(0.85, 0.35, length(d)); }
`;

export const SHADERS: Record<Exclude<ViewMode, "standard">, string> = {
  // Green phosphor, lifted shadows, faint scan lines and a dark rim, as in an image intensifier.
  night: `${HEAD}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = pow(luminance(c), 0.75) * 1.35;
  float lines = 0.92 + 0.08 * sin(v_textureCoordinates.y * 900.0);
  out_FragColor = vec4(vec3(0.12, 1.0, 0.28) * l * lines * vignette(v_textureCoordinates), 1.0);
}`,
  // Brightness through an iron palette: black, violet, red, orange, yellow, white.
  thermal: `${HEAD}
vec3 iron(float t) {
  vec3 a = mix(vec3(0.0), vec3(0.35, 0.0, 0.55), smoothstep(0.0, 0.25, t));
  a = mix(a, vec3(0.85, 0.1, 0.2), smoothstep(0.25, 0.5, t));
  a = mix(a, vec3(1.0, 0.55, 0.0), smoothstep(0.5, 0.75, t));
  return mix(a, vec3(1.0, 1.0, 0.85), smoothstep(0.75, 1.0, t));
}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  out_FragColor = vec4(iron(clamp(luminance(c) * 1.15, 0.0, 1.0)), 1.0);
}`,
  mono: `${HEAD}
void main() {
  vec3 c = texture(colorTexture, v_textureCoordinates).rgb;
  float l = luminance(c);
  out_FragColor = vec4(vec3(smoothstep(0.02, 0.95, l)), 1.0);
}`,
};

/** The next mode in the list, for the keyboard shortcut. */
export const nextMode = (mode: ViewMode): ViewMode => VIEW_MODES[(VIEW_MODES.findIndex((m) => m.id === mode) + 1) % VIEW_MODES.length]!.id;
