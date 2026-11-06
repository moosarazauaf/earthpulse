/**
 * Everything that touches Cesium lives behind this class. React components
 * describe what should be shown; the Globe makes the scene match.
 */
import {
  Cartesian2,
  Cartesian3,
  JulianDate,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantPositionProperty,
  ConstantProperty,
  Entity,
  GeoJsonDataSource,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  PolygonHierarchy,
  PointPrimitiveCollection,
  PostProcessStage,
  PolylineGraphics,
  Rectangle,
  SceneTransforms,
  EllipsoidalOccluder,
  Ellipsoid,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  SingleTileImageryProvider,
  SplitDirection,
  Terrain,
  UrlTemplateImageryProvider,
  VerticalOrigin,
  Viewer,
  WebMapServiceImageryProvider,
} from "cesium";

import { absolute } from "../app/api";
import type { AoiGeometry, Detection, ImageryLayerInfo, MappedResult, Overlay } from "../app/types";
import { CloudShell } from "./clouds";
import { rainBlend, rainTileUrl } from "./rain";
import { type Satellite, positionAt, track } from "./satellites";
import { SHADERS, type ViewMode } from "./viewModes";
import { type WindField, advect, speedColour } from "./wind";
import { EARTH_LAYERS } from "./earthToday";
import { BADGE_PX, GDACS_HAZARD, badge, spreadOffsets } from "./pixelMarkers";
import type { Hazard } from "../news/types";
import { WATER_TILES } from "../area/waterHistory";
import type { SatRec } from "satellite.js";

const WIND_PARTICLES = 4000;
/** Frames a particle lives before it starts again elsewhere, so the flow never bunches up in calm spots. */
const WIND_LIFE = 180;
const WIND_HEIGHT = 3000;
const scratchWind = new Cartesian3();
const windPalette = new Map<string, Color>();
const WIND_COLOURS = (speed: number) => {
  const css = speedColour(speed);
  if (!windPalette.has(css)) windPalette.set(css, Color.fromCssColorString(css).withAlpha(0.85));
  return windPalette.get(css)!;
};
/** A random place within the wind grid, even over the sphere's area, at a random point in its life. */
const windSpawn = () => {
  const lo = Math.sin((-60 * Math.PI) / 180), hi = Math.sin((70 * Math.PI) / 180);
  return { lon: Math.random() * 360 - 180, lat: (Math.asin(lo + Math.random() * (hi - lo)) * 180) / Math.PI, age: Math.floor(Math.random() * WIND_LIFE) };
};
import { type Alert, HAZARD_LAYERS, type Quake, wmsParameters } from "../hazards/sources";

const ESRI_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_CREDIT = "Basemap: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** Seconds for a new imagery layer to fade in over the one it replaces. */
const FADE_SECONDS = 0.6;
const HOME = { lon: 60, lat: 22, height: 2.2e7 };
const AOI_COLOR = Color.fromCssColorString("#a3b18a");
const DISTRICT_COLOR = Color.fromCssColorString("#d9a441");
const LOSS_COLOR = Color.fromCssColorString("#d0703f");
const GAIN_COLOR = Color.fromCssColorString("#8db85a");
const ALERT_RED = Color.fromCssColorString("#ff5a5a");
const ALERT_ORANGE = Color.fromCssColorString("#ffa53c");
/** The earthquake icon colour (news/hazards), so labels match their badges. */
const QUAKE_COLOR = Color.fromCssColorString("#f0a73a");

const BLANK_TILE = document.createElement("canvas");
BLANK_TILE.width = BLANK_TILE.height = 1;

const reducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function ringPositions(ring: number[][]): Cartesian3[] {
  return ring.map((c) => Cartesian3.fromDegrees(c[0] ?? 0, c[1] ?? 0));
}

function outerRings(geometry: AoiGeometry): number[][][] {
  return geometry.type === "Polygon"
    ? [geometry.coordinates[0] ?? []]
    : geometry.coordinates.map((p) => p[0] ?? []);
}

export function geometryBounds(geometry: AoiGeometry): [number, number, number, number] {
  let west = 180, south = 90, east = -180, north = -90;
  for (const ring of outerRings(geometry)) {
    for (const [lon = 0, lat = 0] of ring) {
      west = Math.min(west, lon);
      east = Math.max(east, lon);
      south = Math.min(south, lat);
      north = Math.max(north, lat);
    }
  }
  return [west, south, east, north];
}

export class Globe {
  readonly viewer: Viewer;
  private labels: ImageryLayer;
  private primary: ImageryLayer | null = null;
  private secondary: ImageryLayer | null = null;
  private fading: ImageryLayer[] = [];
  private overlay: ImageryLayer | null = null;
  private overlayUrl: string | null = null;
  private aoiEntities: Entity[] = [];
  private detections: GeoJsonDataSource | null = null;
  private detectionsFor: string | null = null;
  private primaryAlpha = 1;
  onDetectionPicked: ((id: number | null) => void) | null = null;

  constructor(container: HTMLElement) {
    const ionToken = import.meta.env.VITE_CESIUM_ION_TOKEN as string | undefined;
    if (ionToken) Ion.defaultAccessToken = ionToken;

    this.viewer = new Viewer(container, {
      baseLayer: new ImageryLayer(
        new UrlTemplateImageryProvider({ url: ESRI_IMAGERY, maximumLevel: 19, credit: ESRI_CREDIT }),
      ),
      terrain: ionToken ? Terrain.fromWorldTerrain() : undefined,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
      infoBox: false,
      selectionIndicator: false,
      // Render only when something changes; the globe is idle most of the time.
      requestRenderMode: true,
      maximumRenderTimeChange: Infinity,
    });
    const { scene } = this.viewer;
    scene.backgroundColor = Color.fromCssColorString("#14120e");
    scene.globe.baseColor = Color.fromCssColorString("#1c1915");
    scene.globe.showGroundAtmosphere = true;
    if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
    scene.fog.enabled = true;
    scene.screenSpaceCameraController.inertiaZoom = 0.85;
    scene.screenSpaceCameraController.minimumZoomDistance = 300;

    this.labels = this.viewer.imageryLayers.addImageryProvider(
      new UrlTemplateImageryProvider({ url: ESRI_LABELS, maximumLevel: 13 }),
    );
    this.viewer.camera.setView({
      destination: Cartesian3.fromDegrees(HOME.lon, HOME.lat, HOME.height),
    });
    this.clouds = new CloudShell(scene, !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
    this.watchHover();
    // Overlaps depend on the zoom, so markers are spread again whenever the camera stops.
    this.viewer.camera.moveEnd.addEventListener(() => this.spreadMarkers());
    scene.preUpdate.addEventListener(() => this.stepFades());
    scene.globe.tileLoadProgressEvent.addEventListener((queued: number) => {
      // In request-render mode nothing draws once a tile lands; keep frames coming until the queue is empty, so it is reported.
      if (queued > 0) this.render();
      this.onTilesQueued?.(queued);
    });
  }

  /** Called with the number of map tiles still to load, so the interface can say imagery is on its way. */
  onTilesQueued: ((queued: number) => void) | null = null;

  private clouds: CloudShell;

  setClouds(on: boolean, onTime: (time: string | null, loaded: number) => void) {
    this.clouds.onTime = (time, loaded) => { onTime(time, loaded); this.render(); };
    this.clouds.show(on);
    this.render();
  }

  destroy() {
    this.cursorHandler?.destroy();
    window.clearInterval(this.satTimer);
    this.setWind(null);
    this.clouds.destroy();
    if (!this.viewer.isDestroyed()) this.viewer.destroy();
  }

  private render() {
    this.viewer.scene.requestRender();
  }

  // ---- camera ----------------------------------------------------------------
  flyTo(lon: number, lat: number, height: number, seconds = 2.5): Promise<void> {
    return new Promise((resolve) => {
      const destination = Cartesian3.fromDegrees(lon, lat, height);
      if (reducedMotion()) {
        this.viewer.camera.setView({ destination });
        this.render();
        resolve();
        return;
      }
      this.viewer.camera.flyTo({ destination, duration: seconds, complete: resolve, cancel: resolve });
    });
  }

  flyToBounds([west, south, east, north]: [number, number, number, number], seconds = 2): Promise<void> {
    // Pad the rectangle so panels do not cover the area of interest.
    const padX = (east - west) * 0.35 + 0.002;
    const padY = (north - south) * 0.35 + 0.002;
    // Widen the view on the sides an open panel covers, so the area sits in the part of the globe that shows.
    const canvas = this.viewer.canvas.getBoundingClientRect();
    const covered = (side: "left" | "right") => {
      const panel = document.querySelector(`.panel.${side}:not(.collapsed)`)?.getBoundingClientRect();
      if (!panel || !canvas.width) return 0;
      return Math.max(0, side === "left" ? panel.right - canvas.left : canvas.right - panel.left) / canvas.width;
    };
    const left = covered("left"), right = covered("right");
    const card = document.querySelector(".district-card")?.getBoundingClientRect();
    const bottom = card && canvas.height ? Math.max(0, canvas.bottom - card.top) / canvas.height : 0;
    const total = (east - west + 2 * padX) / Math.max(0.3, 1 - left - right);
    const tall = (north - south + 2 * padY) / Math.max(0.3, 1 - bottom);
    const destination = Rectangle.fromDegrees(west - padX - total * left, south - padY - tall * bottom, east + padX + total * right, north + padY);
    return new Promise((resolve) => {
      if (reducedMotion()) {
        this.viewer.camera.setView({ destination });
        this.render();
        resolve();
        return;
      }
      this.viewer.camera.flyTo({ destination, duration: seconds, complete: resolve, cancel: resolve });
    });
  }

  /** Resolves when the visible imagery has loaded, or after maxSeconds if the network is slow. */
  whenTilesLoaded(maxSeconds: number): Promise<void> {
    return new Promise((resolve) => {
      const started = performance.now();
      const check = () => {
        this.render();
        const waited = (performance.now() - started) / 1000;
        // Give a newly added layer a moment to issue its first requests.
        if ((waited > 1.5 && this.viewer.scene.globe.tilesLoaded) || waited >= maxSeconds) resolve();
        else window.setTimeout(check, 250);
      };
      check();
    });
  }

  /**
   * The globe as drawn now, for a map figure: a PNG data URL, metres per image
   * pixel across the centre (null when the centre is off the globe), the
   * camera heading (radians) and the credits of the layers on show.
   */
  snapshot(scale = 2): {
    image: string; width: number; height: number; metresPerPixel: number | null; heading: number; credits: string[];
    edges: Record<"top" | "bottom" | "left" | "right", ({ lon: number; lat: number } | null)[]>;
  } {
    const { scene, camera, canvas } = this.viewer;
    // Drawn at `scale` times the screen's resolution for print, then put back.
    const previous = this.viewer.resolutionScale;
    this.viewer.resolutionScale = previous * scale;
    this.viewer.resize();
    // The drawing buffer is only readable in the same task as the frame that drew it.
    this.viewer.render();
    const image = canvas.toDataURL("image/png");
    const width = canvas.width, height = canvas.height;
    this.viewer.resolutionScale = previous;
    this.viewer.resize();
    this.render();
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const at = (x: number, y: number) => {
      const hit = camera.pickEllipsoid(new Cartesian2(x, y), scene.globe.ellipsoid);
      if (!hit) return null;
      const c = Cartographic.fromCartesian(hit);
      return { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) };
    };
    const a = at(w / 2 - 50, h / 2), b = at(w / 2 + 50, h / 2);
    const pa = a && Cartesian3.fromDegrees(a.lon, a.lat), pb = b && Cartesian3.fromDegrees(b.lon, b.lat);
    const metresPerCssPixel = pa && pb ? Cartesian3.distance(pa, pb) / 100 : null;
    // Positions along each edge of the view, for the coordinate ticks around a printed map.
    const N = 48;
    const along = (f: (t: number) => [number, number]) => Array.from({ length: N + 1 }, (_, i) => at(...f(i / N)));
    const edges = {
      top: along((t) => [t * w, 1]), bottom: along((t) => [t * w, h - 1]),
      left: along((t) => [1, t * h]), right: along((t) => [w - 1, t * h]),
    };
    const credits: string[] = [];
    for (let i = 0; i < this.viewer.imageryLayers.length; i += 1) {
      const layer = this.viewer.imageryLayers.get(i);
      const html = layer.show && layer.alpha > 0 ? layer.imageryProvider?.credit?.html : undefined;
      const text = html?.replace(/<[^>]*>/g, "").trim();
      if (text && !credits.includes(text)) credits.push(text);
    }
    if (this.wind) credits.push("Wind: Open-Meteo");
    if (this.quakeEntities.length) credits.push("Earthquakes: USGS");
    return { image, width, height, metresPerPixel: metresPerCssPixel && metresPerCssPixel * (w / width), heading: camera.heading, credits, edges };
  }

  cameraView(): { lon: number; lat: number; height: number } {
    const position = Cartographic.fromCartesian(this.viewer.camera.position);
    return {
      lon: CesiumMath.toDegrees(position.longitude),
      lat: CesiumMath.toDegrees(position.latitude),
      height: position.height,
    };
  }

  // ---- imagery ---------------------------------------------------------------
  private createLayer(info: ImageryLayerInfo): ImageryLayer {
    const provider = new UrlTemplateImageryProvider({
      url: absolute(info.tileUrl),
      maximumLevel: info.maxZoom,
      credit: info.dataset.attribution,
    });
    // Below the layer's first zoom level one tile would need dozens of scenes,
    // so nothing is requested there and the basemap shows through.
    const requestImage = provider.requestImage.bind(provider);
    provider.requestImage = (x, y, level, request) =>
      level < info.minZoom ? Promise.resolve(BLANK_TILE) : requestImage(x, y, level, request);
    // Insert under the labels layer so place names stay readable.
    const index = this.viewer.imageryLayers.indexOf(this.labels);
    return this.viewer.imageryLayers.addImageryProvider(provider, index);
  }

  /** Swap the year layer, cross-fading so the change in time reads as a change in place. */
  setPrimary(info: ImageryLayerInfo | null, alpha: number) {
    this.primaryAlpha = alpha;
    if (this.primary) {
      this.fading.push(this.primary);
      this.primary = null;
    }
    if (info) {
      this.primary = this.createLayer(info);
      this.primary.alpha = reducedMotion() ? alpha : 0;
      this.applySplit();
    }
    this.render();
  }

  setPrimaryAlpha(alpha: number) {
    this.primaryAlpha = alpha;
    this.render();
  }

  private stepFades() {
    const step = 1 / (FADE_SECONDS * 60);
    let busy = false;
    if (this.primary && this.primary.alpha !== this.primaryAlpha) {
      const delta = this.primaryAlpha - this.primary.alpha;
      this.primary.alpha = Math.abs(delta) <= step ? this.primaryAlpha : this.primary.alpha + Math.sign(delta) * step;
      busy = true;
    }
    // Old layers stay until the new one is fully in, then leave.
    if (this.fading.length && (!this.primary || this.primary.alpha >= this.primaryAlpha)) {
      for (const layer of this.fading) this.viewer.imageryLayers.remove(layer, true);
      this.fading = [];
      busy = true;
    }
    if (this.clouds.step()) busy = true;
    if (this.stepRain()) busy = true;
    if (this.stepWind()) busy = true;
    if (busy) this.render();
  }

  setSecondary(info: ImageryLayerInfo | null) {
    if (this.secondary) this.viewer.imageryLayers.remove(this.secondary, true);
    this.secondary = info ? this.createLayer(info) : null;
    this.applySplit();
    this.render();
  }

  private splitEnabled = false;

  /**
   * Comparison. In swipe mode the earlier year fills the left of the divider
   * and the later year the right; both stay registered to the globe, so pan
   * and zoom are synchronised by construction.
   */
  setCompare(mode: "off" | "swipe" | "blink" | "opacity", position: number, blinkOn: boolean, mix: number) {
    this.splitEnabled = mode === "swipe";
    this.viewer.scene.splitPosition = position;
    if (this.secondary) {
      this.secondary.show = mode !== "off";
      this.secondary.alpha = mode === "blink" ? (blinkOn ? 1 : 0) : mode === "opacity" ? mix : 1;
    }
    this.applySplit();
    this.render();
  }

  private applySplit() {
    if (this.primary) this.primary.splitDirection = this.splitEnabled ? SplitDirection.RIGHT : SplitDirection.NONE;
    if (this.secondary) {
      this.secondary.splitDirection = this.splitEnabled ? SplitDirection.LEFT : SplitDirection.NONE;
      // The comparison layer draws above the primary one.
      this.viewer.imageryLayers.raiseToTop(this.secondary);
      if (this.overlay) this.viewer.imageryLayers.raiseToTop(this.overlay);
      this.viewer.imageryLayers.raiseToTop(this.labels);
    }
  }

  private gibs = new Map<string, ImageryLayer>();

  private satEntities: Entity[] = [];
  private satTimer = 0;

  /**
   * Earth-observation satellites at their true height, each with the next
   * 90 minutes of its orbit, moved every two seconds; null removes them.
   */
  setSatellites(sats: { sat: Satellite; rec: SatRec }[] | null) {
    window.clearInterval(this.satTimer);
    for (const entity of this.satEntities) this.viewer.entities.remove(entity);
    this.satEntities = [];
    if (!sats?.length) { this.render(); return; }
    const place = (p: { lon: number; lat: number; heightKm?: number }) => Cartesian3.fromDegrees(p.lon, p.lat, (p.heightKm ?? 705) * 1000);
    const orbit = (rec: SatRec, now: Date) => track(rec, now, 90, 60).map((p) => place({ ...p, heightKm: positionAt(rec, now)?.heightKm }));
    // Entities are made once and then moved: Cesium builds line geometry in the background, so
    // remaking them every tick would delete each orbit before it was ever drawn.
    const start = new Date();
    const live = sats.map(({ sat, rec }) => {
      const colour = Color.fromCssColorString(sat.colour);
      const dot = this.viewer.entities.add({
        position: place(positionAt(rec, start) ?? { lon: 0, lat: 0 }),
        point: { pixelSize: 7, color: colour, outlineColor: Color.BLACK.withAlpha(0.6), outlineWidth: 1 },
        label: { text: sat.name, font: "11px Inter Variable, sans-serif", fillColor: colour, pixelOffset: new Cartesian2(0, -14), showBackground: true, backgroundColor: Color.fromCssColorString("#14120e").withAlpha(0.7) },
      });
      const line = this.viewer.entities.add({ polyline: { positions: orbit(rec, start), width: 1.8, material: colour.withAlpha(0.75), arcType: 0 } });
      this.satEntities.push(dot, line);
      return { rec, dot, line };
    });
    let ticks = 0;
    this.satTimer = window.setInterval(() => {
      const now = new Date();
      ticks += 1;
      for (const { rec, dot, line } of live) {
        const at = positionAt(rec, now);
        if (at) dot.position = new ConstantPositionProperty(place(at));
        if (ticks % 30 === 0 && line.polyline) line.polyline.positions = new ConstantProperty(orbit(rec, now));
      }
      this.render();
    }, 2000);
    this.render();
  }

  private wind: { field: WindField; points: PointPrimitiveCollection; parts: { lon: number; lat: number; age: number }[] } | null = null;
  private readonly windMoves = !window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  /** Particles drifting with the surface wind, coloured by speed; null removes them. */
  setWind(field: WindField | null) {
    if (this.wind) this.viewer.scene.primitives.remove(this.wind.points);
    this.wind = null;
    if (field) {
      const points = this.viewer.scene.primitives.add(new PointPrimitiveCollection()) as PointPrimitiveCollection;
      const parts = Array.from({ length: WIND_PARTICLES }, () => {
        const p = windSpawn();
        points.add({ position: Cartesian3.fromDegrees(p.lon, p.lat, WIND_HEIGHT), pixelSize: 2, color: Color.TRANSPARENT });
        return p;
      });
      this.wind = { field, points, parts };
    }
    this.render();
  }

  private stepWind(): boolean {
    if (!this.wind) return false;
    const { field, points, parts } = this.wind;
    parts.forEach((p, i) => {
      const next = this.windMoves && p.age < WIND_LIFE ? advect(field, p.lon, p.lat) : null;
      if (this.windMoves && !next) Object.assign(p, windSpawn());
      const point = points.get(i);
      if (next) { p.lon = next.lon; p.lat = next.lat; p.age += 1; point.color = WIND_COLOURS(next.speed); }
      else if (!this.windMoves) point.color = WIND_COLOURS(advect(field, p.lon, p.lat)?.speed ?? 0);
      point.position = Cartesian3.fromDegrees(p.lon, p.lat, WIND_HEIGHT, undefined, scratchWind);
    });
    return this.windMoves;
  }

  /** Real-time day and night shading from the sun's position. */
  private viewStage: PostProcessStage | null = null;

  /** A post-process look over the scene; "standard" removes it. */
  setViewMode(mode: ViewMode) {
    const stages = this.viewer.scene.postProcessStages;
    if (this.viewStage) stages.remove(this.viewStage);
    this.viewStage = mode === "standard" ? null : new PostProcessStage({ fragmentShader: SHADERS[mode] });
    if (this.viewStage) stages.add(this.viewStage);
    this.render();
  }

  private cursorHandler: ScreenSpaceEventHandler | null = null;

  /** Calls back with the longitude and latitude under the pointer (null off the globe) and the camera height; null stops. */
  onCursor(callback: ((at: { lon: number; lat: number } | null, heightM: number) => void) | null) {
    this.cursorHandler?.destroy();
    this.cursorHandler = null;
    if (!callback) return;
    const { scene, camera } = this.viewer;
    const report = (position?: Cartesian2) => {
      const hit = position ? camera.pickEllipsoid(position, scene.globe.ellipsoid) : undefined;
      const c = hit ? Cartographic.fromCartesian(hit) : null;
      callback(c ? { lon: CesiumMath.toDegrees(c.longitude), lat: CesiumMath.toDegrees(c.latitude) } : null, Cartographic.fromCartesian(camera.positionWC).height);
    };
    this.cursorHandler = new ScreenSpaceEventHandler(scene.canvas);
    this.cursorHandler.setInputAction((e: { endPosition: Cartesian2 }) => report(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.cursorHandler.setInputAction(() => report(), ScreenSpaceEventType.WHEEL);
    report();
  }

  setDayNight(on: boolean) {
    this.viewer.scene.globe.enableLighting = on;
    this.viewer.clock.currentTime = JulianDate.now();
    this.viewer.clock.shouldAnimate = on;
    this.render();
  }

  /** A NASA GIBS layer (latest date, 2 km tiles) under the place names, made on first use. */
  private setGibs(id: string, on: boolean, credit: string, alpha: number, level = 7) {
    if (on && !this.gibs.has(id)) {
      const layer = new ImageryLayer(new UrlTemplateImageryProvider({
        url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${id}/default/default/GoogleMapsCompatible_Level${level}/{z}/{y}/{x}.png`,
        maximumLevel: level,
        credit,
      }), { alpha });
      this.viewer.imageryLayers.add(layer, this.viewer.imageryLayers.indexOf(this.labels));
      this.gibs.set(id, layer);
    }
    const layer = this.gibs.get(id);
    if (layer) layer.show = on;
    this.render();
  }

  /** NASA SEDAC population density (GPWv4, 2020). */
  setPopulation(on: boolean) { this.setGibs("GPW_Population_Density_2020", on, "NASA SEDAC GPWv4 via GIBS", 0.7); }

  private waterHistory: ImageryLayer | null = null;

  /** Where surface water has been seen since 1984 (JRC Global Surface Water occurrence), under the place names. */
  setWaterHistory(on: boolean) {
    if (on && !this.waterHistory) {
      this.waterHistory = new ImageryLayer(new UrlTemplateImageryProvider({
        url: `${WATER_TILES}/{z}/{x}/{y}.png`,
        maximumLevel: 12,
        credit: "Surface water 1984-2021: EC JRC / Google",
      }));
      this.viewer.imageryLayers.add(this.waterHistory, this.viewer.imageryLayers.indexOf(this.labels));
    }
    if (this.waterHistory) this.waterHistory.show = on;
    this.render();
  }

  /** One of the daily NASA environment layers by id; null hides them all. */
  setEarthLayer(id: string | null) {
    for (const l of EARTH_LAYERS) this.setGibs(l.gibs, l.id === id, l.credit, 0.85, l.level);
  }

  private rainLayers: ImageryLayer[] = [];
  private rainTimes: string[] = [];
  private rainStart = 0;
  private rainShown = -1;
  private rainAnimate = true;
  private onRainFrame: ((time: string | null) => void) | null = null;

  /** Rain-rate maps for these half hours, looped under the place names; null removes them. */
  setRain(times: string[] | null, onFrame: (time: string | null) => void) {
    for (const layer of this.rainLayers) this.viewer.imageryLayers.remove(layer, true);
    // Every frame stays switched on so its tiles load ahead; the loop only changes their opacity.
    this.rainLayers = (times ?? []).map((time) => {
      const layer = new ImageryLayer(new UrlTemplateImageryProvider({ url: rainTileUrl(time), maximumLevel: 6, credit: "NASA GIBS / GPM IMERG" }), { alpha: 0 });
      this.viewer.imageryLayers.add(layer, this.viewer.imageryLayers.indexOf(this.labels));
      return layer;
    });
    this.rainTimes = times ?? [];
    this.onRainFrame = onFrame;
    this.rainStart = performance.now();
    this.rainShown = -1;
    this.rainAnimate = !reducedMotion();
    if (!this.rainLayers.length) onFrame(null);
    this.stepRain();
    this.render();
  }

  /** Called every frame to set the cross-fade (see rainBlend); returns true while it is moving. */
  private stepRain(): boolean {
    const n = this.rainLayers.length;
    if (!n) return false;
    const { a, b, f } = this.rainAnimate ? rainBlend((performance.now() - this.rainStart) / 1000, n) : { a: n - 1, b: n - 1, f: 0 };
    this.rainLayers.forEach((layer, i) => { layer.alpha = i === a ? 0.8 * (1 - f) : i === b ? 0.8 * f : 0; });
    const shown = f < 0.5 ? a : b;
    if (shown !== this.rainShown) {
      this.rainShown = shown;
      this.onRainFrame?.(this.rainTimes[shown] ?? null);
    }
    return this.rainAnimate && n > 1;
  }

  setLabels(visible: boolean) {
    this.labels.show = visible;
    this.render();
  }

  // ---- area of interest ------------------------------------------------------
  setAoi(geometry: AoiGeometry | null) {
    for (const entity of this.aoiEntities) this.viewer.entities.remove(entity);
    this.aoiEntities = [];
    if (geometry) {
      for (const ring of outerRings(geometry)) {
        this.aoiEntities.push(
          this.viewer.entities.add({
            polyline: {
              positions: ringPositions(ring),
              width: 2.5,
              material: AOI_COLOR,
              clampToGround: true,
            },
          }),
        );
      }
    }
    this.render();
  }

  private districtEntities: Entity[] = [];

  /** A district outline, drawn in amber so it reads apart from the chosen area. */
  setDistrict(geometry: AoiGeometry | null) {
    for (const entity of this.districtEntities) this.viewer.entities.remove(entity);
    this.districtEntities = geometry
      ? outerRings(geometry).map((ring) => this.viewer.entities.add({
        polyline: { positions: ringPositions(ring), width: 3, material: DISTRICT_COLOR, clampToGround: true },
      }))
      : [];
    this.render();
  }

  // ---- analysis results --------------------------------------------------------
  async setOverlay(overlay: Overlay | null, opacity: number) {
    const url = overlay ? absolute(overlay.url) : null;
    if (url !== this.overlayUrl) {
      if (this.overlay) this.viewer.imageryLayers.remove(this.overlay, true);
      this.overlay = null;
      this.overlayUrl = url;
      if (overlay && url) {
        const [west, south, east, north] = overlay.bounds;
        const provider = await SingleTileImageryProvider.fromUrl(url, {
          rectangle: Rectangle.fromDegrees(west, south, east, north),
        });
        if (this.overlayUrl !== url) return; // superseded while loading
        const index = this.viewer.imageryLayers.indexOf(this.labels);
        this.overlay = this.viewer.imageryLayers.addImageryProvider(provider, index);
      }
    }
    if (this.overlay) this.overlay.alpha = opacity;
    this.render();
  }

  async setDetections(result: MappedResult | null, visible: boolean) {
    const key = result && visible ? result.id : null;
    if (key === this.detectionsFor) return;
    this.detectionsFor = key;
    if (this.detections) {
      await this.viewer.dataSources.remove(this.detections, true);
      this.detections = null;
    }
    if (result && visible) {
      const source = await GeoJsonDataSource.load(result.detections, { clampToGround: true });
      if (this.detectionsFor !== key) return;
      for (const entity of source.entities.values) {
        const direction = entity.properties?.direction?.getValue();
        const color = direction === "decrease" ? LOSS_COLOR : GAIN_COLOR;
        if (entity.polygon) {
          entity.polygon.material = new ColorMaterialProperty(color.withAlpha(0.01));
          entity.polygon.outline = new ConstantProperty(false);
          const hierarchy = entity.polygon.hierarchy?.getValue() as PolygonHierarchy | undefined;
          if (hierarchy) {
            entity.polyline = new PolylineGraphics({
              positions: [...hierarchy.positions, hierarchy.positions[0] as Cartesian3],
              width: 1.5,
              material: color,
              clampToGround: true,
            });
          }
        }
      }
      this.detections = source;
      await this.viewer.dataSources.add(source);
    }
    this.render();
  }

  // ---- live hazards ------------------------------------------------------------
  private hazards = new Map<string, ImageryLayer>();
  private alertEntities: Entity[] = [];
  /** Names shown when the pointer rests on a marker, by entity id. */
  private markerNames = new Map<string, string>();
  private hoverLabel: Entity | null = null;

  /** Fans out news, earthquake and alert badges drawn on top of each other at the current zoom, so each can be seen and clicked. */
  private spreadMarkers() {
    const all = [...this.newsEntities, ...this.quakeEntities, ...this.alertEntities].filter((e) => e.billboard && e.position);
    const now = JulianDate.now();
    const scene = this.viewer.scene;
    const { clientWidth: w, clientHeight: h } = scene.canvas;
    // Only markers on screen and on the near side of the Earth can overlap what the user sees.
    const occluder = new EllipsoidalOccluder(Ellipsoid.WGS84, this.viewer.camera.positionWC);
    const at = all.map((e) => {
      const p = e.position!.getValue(now)!;
      const xy = occluder.isPointVisible(p) ? SceneTransforms.worldToWindowCoordinates(scene, p) : undefined;
      return xy && xy.x >= 0 && xy.y >= 0 && xy.x <= w && xy.y <= h ? xy : null;
    });
    spreadOffsets(at).forEach(([x, y], i) => {
      all[i]!.billboard!.pixelOffset = new ConstantProperty(new Cartesian2(x, y));
    });
    this.render();
  }

  /** A name beside the marker under the pointer, and a hand cursor, so markers can be read without clicking. */
  private watchHover() {
    const { scene } = this.viewer;
    this.hoverLabel = this.viewer.entities.add({
      position: Cartesian3.ZERO,
      label: {
        text: "", show: false, font: "12px Inter Variable, sans-serif", fillColor: Color.WHITE, showBackground: true,
        backgroundColor: Color.fromCssColorString("#14120e").withAlpha(0.9), pixelOffset: new Cartesian2(0, -26),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    const handler = new ScreenSpaceEventHandler(scene.canvas);
    let pending = false, last: Cartesian2 | null = null;
    handler.setInputAction((e: { endPosition: Cartesian2 }) => {
      last = e.endPosition;
      if (pending) return;
      pending = true;
      // At most one pick a frame: picking is not free, and the pointer moves faster than frames.
      requestAnimationFrame(() => {
        pending = false;
        if (!last || this.viewer.isDestroyed()) return;
        const picked = scene.pick(last) as { id?: Entity } | undefined;
        const entity = picked?.id;
        const name = entity ? this.markerNames.get(String(entity.id)) : undefined;
        const label = this.hoverLabel!.label!;
        scene.canvas.style.cursor = name ? "pointer" : this.drawCursor;
        if (name && entity?.position) {
          this.hoverLabel!.position = new ConstantPositionProperty(entity.position.getValue(JulianDate.now())!);
          label.text = new ConstantProperty(name);
          label.show = new ConstantProperty(true);
        } else if (label.show?.getValue(JulianDate.now())) {
          label.show = new ConstantProperty(false);
        } else return;
        this.render();
      });
    }, ScreenSpaceEventType.MOUSE_MOVE);
  }

  /** The cursor drawing tools set; restored when the pointer leaves a marker. */
  drawCursor = "";

  /** Show exactly the hazard layers whose ids are given. */
  setHazardLayers(ids: string[]) {
    for (const [id, layer] of this.hazards) {
      if (!ids.includes(id)) {
        this.viewer.imageryLayers.remove(layer, true);
        this.hazards.delete(id);
      }
    }
    for (const id of ids) {
      const definition = HAZARD_LAYERS.find((l) => l.id === id);
      if (!definition || this.hazards.has(id)) continue;
      const provider = new WebMapServiceImageryProvider({
        url: definition.url,
        layers: definition.layers,
        parameters: wmsParameters(definition),
        credit: definition.attribution,
      });
      const index = this.viewer.imageryLayers.indexOf(this.labels);
      const layer = this.viewer.imageryLayers.addImageryProvider(provider, index);
      layer.alpha = 0.85;
      this.hazards.set(id, layer);
    }
    this.render();
  }

  /** Markers for alerts. Level is shown by colour and by the letter inside the marker. */
  setAlerts(alerts: Alert[], selectedId: string | null) {
    for (const entity of this.alertEntities) this.viewer.entities.remove(entity);
    this.alertEntities = alerts.map((alert) => {
      const red = alert.level === "Red";
      const selected = alert.id === selectedId;
      // The GDACS type picks the icon; the border and corner flag carry the alert level, red or orange.
      const level = (red ? ALERT_RED : ALERT_ORANGE).toCssColorString();
      return this.viewer.entities.add({
        id: `alert:${alert.id}`,
        position: Cartesian3.fromDegrees(alert.lon, alert.lat),
        billboard: {
          image: badge(GDACS_HAZARD[alert.type] ?? "flood", level, level),
          pixelOffset: new Cartesian2(0, 0),
          scale: selected ? 0.62 : 0.48,
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
      });
    });
    for (const k of [...this.markerNames.keys()]) if (k.startsWith("alert:")) this.markerNames.delete(k);
    for (const a of alerts) this.markerNames.set(`alert:${a.id}`, `${a.level} alert: ${a.name}${a.country ? `, ${a.country}` : ""}`);
    this.spreadMarkers();
    this.render();
  }

  private quakeEntities: Entity[] = [];
  private airEntities: Entity[] = [];

  /** Air quality at cities: a dot per city in its AQI colour, larger where the air is worse. */
  setAirSpots(spots: { lon: number; lat: number; aqi: number; colour: string; name: string }[]) {
    for (const entity of this.airEntities) this.viewer.entities.remove(entity);
    this.airEntities = spots.map((spot, i) => this.viewer.entities.add({
      id: `air:${i}`,
      name: spot.name,
      // Slightly above the ground so the dot is not cut by the globe; depth-tested, so the far side stays hidden.
      position: Cartesian3.fromDegrees(spot.lon, spot.lat, 2000),
      point: {
        pixelSize: 5 + Math.min(spot.aqi, 300) / 30,
        color: Color.fromCssColorString(spot.colour).withAlpha(0.9),
        outlineColor: Color.BLACK.withAlpha(0.5),
        outlineWidth: 1,
      },
    }));
    this.render();
  }

  /** Earthquake markers; the ring grows with magnitude, which is also written beside it. */
  setQuakes(quakes: Quake[]) {
    for (const entity of this.quakeEntities) this.viewer.entities.remove(entity);
    this.quakeEntities = quakes.map((quake) => {
      // The badge grows with magnitude, which is also written above the strong ones.
      const scale = Math.min(0.62, 0.26 + Math.max(0, quake.magnitude - 4) * 0.09);
      return this.viewer.entities.add({
      id: `quake:${quake.id}`,
      position: Cartesian3.fromDegrees(quake.lon, quake.lat),
      billboard: {
        image: badge("earthquake"),
        scale,
        verticalOrigin: VerticalOrigin.CENTER,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: quake.magnitude >= 5.5 ? {
        text: `M${quake.magnitude.toFixed(1)}`,
        font: "11px sans-serif",
        fillColor: QUAKE_COLOR,
        pixelOffset: new Cartesian2(0, -(BADGE_PX * scale) / 2 - 9),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      } : undefined,
      });
    });
    for (const k of [...this.markerNames.keys()]) if (k.startsWith("quake:")) this.markerNames.delete(k);
    for (const q of quakes) this.markerNames.set(`quake:${q.id}`, `M${q.magnitude.toFixed(1)} earthquake: ${q.place}`);
    this.spreadMarkers();
    this.render();
  }

  private sampleEntities: Entity[] = [];

  /** Training points drawn for Classify, coloured by class. */
  setSamples(points: { lon: number; lat: number; colour: [number, number, number] }[]) {
    for (const entity of this.sampleEntities) this.viewer.entities.remove(entity);
    this.sampleEntities = points.map((p) => this.viewer.entities.add({
      position: Cartesian3.fromDegrees(p.lon, p.lat),
      point: { pixelSize: 9, color: Color.fromBytes(p.colour[0], p.colour[1], p.colour[2]), outlineColor: Color.WHITE, outlineWidth: 1.5, disableDepthTestDistance: Number.POSITIVE_INFINITY },
    }));
    this.render();
  }

  private measureEntity: Entity | null = null;

  /** The measuring line, with a closing segment drawn faintly when it encloses an area. */
  setMeasure(points: [number, number][]) {
    if (this.measureEntity) this.viewer.entities.remove(this.measureEntity);
    this.measureEntity = null;
    if (points.length >= 1) {
      const positions = points.map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
      this.measureEntity = this.viewer.entities.add({
        polyline: { positions: positions.length > 1 ? positions : [positions[0]!, positions[0]!], width: 3, material: Color.fromCssColorString("#5fd0c5"), clampToGround: true },
        polygon: points.length >= 3 ? { hierarchy: positions, material: Color.fromCssColorString("#5fd0c5").withAlpha(0.12) } : undefined,
      });
    }
    this.render();
  }

  private newsEntities: Entity[] = [];

  /**
   * News story markers: filled when the story names a town or region, a ring
   * when it is placed only to the country. Size grows with the number of outlets.
   */
  setNews(markers: { id: string; lat: number; lon: number; hazard: Hazard; colour: string; outlets: number; exact: boolean; label: string }[], selectedId: string | null) {
    for (const entity of this.newsEntities) this.viewer.entities.remove(entity);
    this.newsEntities = markers.map((m) => {
      const selected = m.id === selectedId;
      // Bigger the more outlets report it; faded when the story names only a country.
      const scale = 0.32 + Math.min(m.outlets, 5) * 0.03 + (selected ? 0.14 : 0);
      return this.viewer.entities.add({
        id: `news:${m.id}`,
        position: Cartesian3.fromDegrees(m.lon, m.lat),
        billboard: {
          image: badge(m.hazard, selected ? "#ffffff" : undefined),
          scale,
          color: Color.WHITE.withAlpha(m.exact ? 1 : 0.55),
          verticalOrigin: VerticalOrigin.CENTER,
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        },
        label: selected ? {
          text: m.label,
          font: "13px sans-serif",
          fillColor: Color.WHITE,
          showBackground: true,
          backgroundColor: Color.fromCssColorString("#0b1416").withAlpha(0.85),
          pixelOffset: new Cartesian2(0, -(BADGE_PX * scale) / 2 - 12),
          disableDepthTestDistance: Number.POSITIVE_INFINITY,
        } : undefined,
      });
    });
    for (const k of [...this.markerNames.keys()]) if (k.startsWith("news:")) this.markerNames.delete(k);
    for (const m of markers) this.markerNames.set(`news:${m.id}`, m.label);
    this.spreadMarkers();
    this.render();
  }

  /** Back to the whole Earth. */
  resetView(): Promise<void> {
    return this.flyTo(HOME.lon, HOME.lat, HOME.height, 2);
  }

  highlightDetection(detection: Detection | null) {
    if (!this.detections) return;
    for (const entity of this.detections.entities.values) {
      if (!entity.polyline) continue;
      const selected = detection !== null && String(entity.id) === String(detection.id);
      entity.polyline.width = new ConstantProperty(selected ? 4 : 1.5);
    }
    this.render();
  }
}
