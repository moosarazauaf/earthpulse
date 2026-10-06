/**
 * Everything that touches Cesium lives behind this class. React components
 * describe what should be shown; the Globe makes the scene match.
 */
import {
  Cartesian3,
  Cartographic,
  Color,
  ColorMaterialProperty,
  ConstantProperty,
  Entity,
  GeoJsonDataSource,
  ImageryLayer,
  Ion,
  Math as CesiumMath,
  PolygonHierarchy,
  PolylineGraphics,
  Rectangle,
  SingleTileImageryProvider,
  SplitDirection,
  Terrain,
  UrlTemplateImageryProvider,
  Viewer,
} from "cesium";

import { absolute } from "../app/api";
import type { AoiGeometry, Detection, ImageryLayerInfo, MappedResult, Overlay } from "../app/types";

const ESRI_IMAGERY =
  "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const ESRI_LABELS =
  "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}";
const ESRI_CREDIT = "Basemap: Esri, Maxar, Earthstar Geographics, and the GIS User Community";

/** Seconds for a new imagery layer to fade in over the one it replaces. */
const FADE_SECONDS = 0.6;
const HOME = { lon: 60, lat: 22, height: 2.2e7 };
const AOI_COLOR = Color.fromCssColorString("#5fd0c5");
const LOSS_COLOR = Color.fromCssColorString("#ff8a5c");
const GAIN_COLOR = Color.fromCssColorString("#7bd88f");

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
    scene.backgroundColor = Color.fromCssColorString("#080c0f");
    scene.globe.baseColor = Color.fromCssColorString("#0d1418");
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
    scene.preUpdate.addEventListener(() => this.stepFades());
  }

  destroy() {
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
    const destination = Rectangle.fromDegrees(west - padX, south - padY, east + padX, north + padY);
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
