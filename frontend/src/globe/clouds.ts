/**
 * Clouds from the EUMETSAT world cloud map: infrared from every geostationary
 * weather satellite (Meteosat, GOES, Himawari) merged into one global picture
 * every 3 hours. Keyless, and served with CORS, so the browser reads it
 * directly. Cold cloud tops are bright in infrared; the picture becomes
 * white cloud whose opacity rises with that brightness, on a shell just above
 * the globe that fades as the camera comes down to an area.
 */
import {
  Cartographic,
  EllipsoidGeometry,
  GeometryInstance,
  Material,
  MaterialAppearance,
  Primitive,
  type Scene,
  VertexFormat,
  Cartesian3,
} from "cesium";

const WMS = "https://view.eumetsat.int/geoserver/wms";
const STEP_MS = 3 * 3_600_000;
/** The map appears some hours after its nominal time; asking for a time not yet made returns the nearest one. */
const LAG_MS = 3_600_000;
export const FRAMES = 8;
const WIDTH = 1024;
/** Shell height above the ellipsoid: high enough to clear terrain, low enough to sit on the globe. */
const SHELL_M = 18_000;
/** Camera heights between which the clouds fade out, so flying to an area goes down through them. */
const FADE_TOP_M = 3_500_000;
const FADE_BOTTOM_M = 600_000;

/** The most recent `count` map times, oldest first, as ISO strings. */
export function frameTimes(now: number, count = FRAMES): string[] {
  const latest = Math.floor((now - LAG_MS) / STEP_MS) * STEP_MS;
  return Array.from({ length: count }, (_, i) => new Date(latest - (count - 1 - i) * STEP_MS).toISOString().replace(".000", ""));
}

export function frameUrl(time: string): string {
  return `${WMS}?service=WMS&request=GetMap&version=1.3.0&layers=mumi:worldcloudmap_ir108&styles=&crs=EPSG:4326` +
    `&bbox=-90,-180,90,180&width=${WIDTH}&height=${WIDTH / 2}&format=image/png&transparent=true&time=${time}`;
}

/** Opacity of a pixel with infrared brightness `grey`: warm ground and sea are clear, cold cloud tops opaque. */
export function cloudAlpha(grey: number): number {
  const t = Math.min(1, Math.max(0, (grey - 100) / 95));
  return Math.round(t * t * (3 - 2 * t) * 245);
}

/** How visible the clouds are at a camera height: fully above FADE_TOP_M, gone below FADE_BOTTOM_M. */
export function heightFade(heightM: number): number {
  const t = Math.min(1, Math.max(0, (heightM - FADE_BOTTOM_M) / (FADE_TOP_M - FADE_BOTTOM_M)));
  return t * t * (3 - 2 * t);
}

async function loadFrame(time: string, signal: AbortSignal): Promise<HTMLCanvasElement> {
  const response = await fetch(frameUrl(time), { signal });
  if (!response.ok) throw new Error("The cloud map did not respond.");
  const bitmap = await createImageBitmap(await response.blob());
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = pixels.data;
  for (let i = 0; i < d.length; i += 4) {
    // Outside the satellites' view (near the poles) the map is transparent: keep it clear.
    const a = d[i + 3]! === 0 ? 0 : cloudAlpha(d[i]!);
    d[i] = d[i + 1] = d[i + 2] = 255;
    d[i + 3] = a;
  }
  ctx.putImageData(pixels, 0, 0);
  return canvas;
}

const SOURCE = `
uniform sampler2D image1;
uniform sampler2D image2;
uniform float mixing;
uniform float opacity;
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material material = czm_getDefaultMaterial(materialInput);
  float a = mix(texture(image1, materialInput.st).a, texture(image2, materialInput.st).a, mixing);
  material.diffuse = vec3(0.96);
  material.alpha = a * opacity;
  return material;
}`;

/** The cloud shell: loads the frames, shows the newest at once, then loops through the past day. */
export class CloudShell {
  private primitive: Primitive | null = null;
  private material: Material | null = null;
  private frames: (HTMLCanvasElement | null)[] = [];
  private times: string[] = [];
  private controller: AbortController | null = null;
  private started = 0;
  private shown = -1;
  onTime: ((time: string | null, loaded: number) => void) | null = null;

  constructor(private scene: Scene, private animate: boolean) {}

  get visible() {
    return this.primitive !== null && this.primitive.show;
  }

  show(on: boolean) {
    if (!on) {
      this.controller?.abort();
      this.controller = null;
      if (this.primitive) this.primitive.show = false;
      this.onTime?.(null, 0);
      return;
    }
    if (this.primitive) {
      this.primitive.show = true;
      this.onTime?.(this.times[this.shown] ?? null, this.frames.filter(Boolean).length);
      return;
    }
    void this.load();
  }

  private async load() {
    this.controller = new AbortController();
    const { signal } = this.controller;
    this.times = frameTimes(Date.now());
    this.frames = this.times.map(() => null);
    // Newest first, so clouds appear as soon as one picture is in; the rest fill the loop behind it.
    for (let i = this.times.length - 1; i >= 0; i -= 1) {
      try {
        this.frames[i] = await loadFrame(this.times[i]!, signal);
      } catch {
        if (signal.aborted) return;
        continue;
      }
      if (!this.primitive) this.build(this.frames[i]!);
      this.onTime?.(this.times[this.shown] ?? null, this.frames.filter(Boolean).length);
      if (!this.animate) return;
    }
  }

  private build(first: HTMLCanvasElement) {
    const r = this.scene.globe.ellipsoid.radii;
    this.material = new Material({
      translucent: true,
      fabric: { uniforms: { image1: first, image2: first, mixing: 0, opacity: 0 }, source: SOURCE },
    });
    this.primitive = this.scene.primitives.add(new Primitive({
      geometryInstances: new GeometryInstance({
        geometry: new EllipsoidGeometry({
          radii: new Cartesian3(r.x + SHELL_M, r.y + SHELL_M, r.z + SHELL_M),
          stackPartitions: 64,
          slicePartitions: 128,
          vertexFormat: VertexFormat.POSITION_NORMAL_AND_ST,
        }),
      }),
      appearance: new MaterialAppearance({ material: this.material, translucent: true, closed: true, flat: true }),
      asynchronous: false,
    })) as Primitive;
    this.shown = this.frames.indexOf(first);
    this.started = performance.now();
  }

  /** Called every frame: fade with height, and step the loop. Returns true while something is moving. */
  step(): boolean {
    if (!this.primitive?.show || !this.material) return false;
    const height = Cartographic.fromCartesian(this.scene.camera.positionWC).height;
    this.material.uniforms.opacity = heightFade(height);
    const ready = this.frames.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
    if (!this.animate || ready.length < 2 || heightFade(height) === 0) return false;
    // Each frame holds for 1.2 s, then cross-fades to the next over 0.8 s.
    const t = (performance.now() - this.started) / 2000;
    const k = Math.floor(t) % ready.length;
    const a = ready[k]!, b = ready[(k + 1) % ready.length]!;
    this.material.uniforms.image1 = this.frames[a];
    this.material.uniforms.image2 = this.frames[b];
    this.material.uniforms.mixing = Math.max(0, (t % 1 - 0.6) / 0.4);
    const now = (t % 1) < 0.8 ? a : b;
    if (now !== this.shown) {
      this.shown = now;
      this.onTime?.(this.times[now] ?? null, ready.length);
    }
    return true;
  }

  destroy() {
    this.controller?.abort();
    if (this.primitive) this.scene.primitives.remove(this.primitive);
  }
}
