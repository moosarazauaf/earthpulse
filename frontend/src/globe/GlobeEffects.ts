/**
 * Globe Effects - Enhanced atmosphere, lighting, and visual effects
 * Provides time-of-day lighting, improved atmosphere, smooth transitions
 */

import {
  Viewer,
  Scene,
  Globe as CesiumGlobe,
  Color,
  Cartesian3,
  JulianDate,
  Rectangle,
} from "cesium";

export interface GlobeEffectsOptions {
  /** Enable dynamic time-of-day lighting */
  dynamicLighting?: boolean;
  /** Enable enhanced atmosphere */
  enhancedAtmosphere?: boolean;
  /** Enable ground atmosphere (globe haze) */
  groundAtmosphere?: boolean;
  /** Enable fog */
  fogEnabled?: boolean;
  /** Fog density */
  fogDensity?: number;
  /** Fog minimum brightness */
  fogMinimumBrightness?: number;
}

/**
 * GlobeEffects manages enhanced visual effects on the Cesium globe.
 */
export class GlobeEffects {
  private viewer: Viewer;
  private scene: Scene;
  private globe: CesiumGlobe;
  private options: Required<GlobeEffectsOptions>;
  private animationFrame: number | null = null;
  private lastTime: number = 0;
  private timeMultiplier: number = 1; // For time-lapse

  constructor(viewer: Viewer, options: GlobeEffectsOptions = {}) {
    this.viewer = viewer;
    this.scene = viewer.scene;
    this.globe = viewer.scene.globe;
    this.options = {
      dynamicLighting: options.dynamicLighting ?? true,
      enhancedAtmosphere: options.enhancedAtmosphere ?? true,
      groundAtmosphere: options.groundAtmosphere ?? true,
      fogEnabled: options.fogEnabled ?? true,
      fogDensity: options.fogDensity ?? 0.0003,
      fogMinimumBrightness: options.fogMinimumBrightness ?? 0.01,
    };
  }

  /**
   * Initialize enhanced effects
   */
  initialize(): void {
    this.setupAtmosphere();
    this.setupLighting();
    this.setupFog();

    if (this.options.dynamicLighting) {
      this.startTimeSimulation();
    }
  }

  /**
   * Configure sky atmosphere
   */
  private setupAtmosphere(): void {
    if (!this.options.enhancedAtmosphere) return;

    const atmosphere = this.scene.skyAtmosphere;
    if (!atmosphere) return;

    atmosphere.show = true;

    // Enhanced atmosphere parameters for more realistic look
    // These are approximate Rayleigh scattering coefficients
    (atmosphere as any).hueShift = 0.0;
    (atmosphere as any).saturationShift = 0.0;
    (atmosphere as any).brightnessShift = 0.0;

    // Ground atmosphere (haze at horizon)
    if (this.options.groundAtmosphere) {
      this.globe.showGroundAtmosphere = true;
    }
  }

  /**
   * Configure lighting (sun/moon)
   */
  private setupLighting(): void {
    this.scene.globe.enableLighting = this.options.dynamicLighting;
    // Sun position is automatically computed from simulationTime when enableLighting is true
  }

  /**
   * Configure fog
   */
  private setupFog(): void {
    if (!this.options.fogEnabled) {
      this.scene.fog.enabled = false;
      return;
    }

    this.scene.fog.enabled = true;
    this.scene.fog.density = this.options.fogDensity;
    this.scene.fog.minimumBrightness = this.options.fogMinimumBrightness;
    this.scene.fog.screenSpaceErrorFactor = 2.0;
  }

  /**
   * Start real-time simulation
   */
  startTimeSimulation(multiplier: number = 1): void {
    this.timeMultiplier = multiplier;
    this.lastTime = performance.now();
    this.animateTime();
  }

  /**
   * Stop time simulation
   */
  stopTimeSimulation(): void {
    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }
  }

  /**
   * Animation loop for time simulation
   */
  private animateTime(): void {
    const now = performance.now();
    const delta = (now - this.lastTime) / 1000; // seconds
    this.lastTime = now;

    // Advance simulation time
    const currentTime = (this.scene as any).simulationTime;
    if (currentTime) {
      const newTime = JulianDate.addSeconds(
        currentTime,
        delta * this.timeMultiplier,
        new JulianDate()
      );
      (this.scene as any).simulationTime = newTime;
    }

    this.viewer.scene.requestRender();
    this.animationFrame = requestAnimationFrame(() => this.animateTime());
  }

  /**
   * Set time multiplier (for time-lapse)
   * 1 = real-time, 3600 = 1 hour per second, 86400 = 1 day per second
   */
  setTimeMultiplier(multiplier: number): void {
    this.timeMultiplier = multiplier;
  }

  /**
   * Set specific date/time
   */
  setDateTime(date: Date): void {
    (this.scene as any).simulationTime = JulianDate.fromDate(date);
    this.viewer.scene.requestRender();
  }

  /**
   * Get current simulation date
   */
  getDateTime(): Date {
    const simTime = (this.scene as any).simulationTime;
    return simTime ? JulianDate.toDate(simTime) : new Date();
  }

  /**
   * Set fog density
   */
  setFogDensity(density: number): void {
    this.options.fogDensity = density;
    this.scene.fog.density = density;
    this.viewer.scene.requestRender();
  }

  /**
   * Set fog minimum brightness
   */
  setFogMinimumBrightness(brightness: number): void {
    this.options.fogMinimumBrightness = brightness;
    this.scene.fog.minimumBrightness = brightness;
    this.viewer.scene.requestRender();
  }

  /**
   * Enable/disable fog
   */
  setFogEnabled(enabled: boolean): void {
    this.options.fogEnabled = enabled;
    this.scene.fog.enabled = enabled;
    this.viewer.scene.requestRender();
  }

  /**
   * Enable/disable ground atmosphere
   */
  setGroundAtmosphere(enabled: boolean): void {
    this.options.groundAtmosphere = enabled;
    this.globe.showGroundAtmosphere = enabled;
    this.viewer.scene.requestRender();
  }

  /**
   * Enable/disable dynamic lighting
   */
  setDynamicLighting(enabled: boolean): void {
    this.options.dynamicLighting = enabled;
    this.globe.enableLighting = enabled;
    if (enabled) {
      this.startTimeSimulation(this.timeMultiplier);
    } else {
      this.stopTimeSimulation();
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Smooth transition to a target camera view with effects
   */
  async flyToWithEffects(
    destination: Cartesian3 | Rectangle,
    options: {
      duration?: number;
      fadeInDuration?: number;
      fadeOutDuration?: number;
      onProgress?: (progress: number) => void;
    } = {}
  ): Promise<void> {
    const {
      duration = 2.5,
      fadeInDuration = 0.5,
      fadeOutDuration = 0.5,
      onProgress,
    } = options;

    // Fade out current view
    await this.fadeGlobe(1.0, 0.0, fadeOutDuration);

    // Fly to destination
    const cameraPromise = new Promise<void>((resolve) => {
      const camera = this.viewer.camera;
      const flyOptions: any = {
        duration,
        complete: resolve,
        cancel: resolve,
      };

      if (destination instanceof Cartesian3) {
        flyOptions.destination = destination;
      } else {
        flyOptions.destination = destination;
      }

      camera.flyTo(flyOptions);
    });

    // Monitor flight progress
    const startTime = performance.now();
    const monitorProgress = () => {
      const elapsed = (performance.now() - startTime) / 1000;
      const progress = Math.min(elapsed / duration, 1);
      if (onProgress) onProgress(progress);
      if (progress < 1) {
        requestAnimationFrame(monitorProgress);
      }
    };
    monitorProgress();

    await cameraPromise;

    // Fade in new view
    await this.fadeGlobe(0.0, 1.0, fadeInDuration);
  }

  /**
   * Fade globe opacity
   */
  private fadeGlobe(from: number, to: number, duration: number): Promise<void> {
    return new Promise((resolve) => {
      const startTime = performance.now();
      const durationMs = duration * 1000;

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        const alpha = from + (to - from) * eased;
        this.globe.baseColor = new Color(
          this.globe.baseColor.red,
          this.globe.baseColor.green,
          this.globe.baseColor.blue,
          alpha
        );
        this.viewer.scene.requestRender();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Cross-fade between two imagery layers
   */
  async crossFadeLayers(
    fromLayer: any,
    toLayer: any,
    duration: number = 1.0
  ): Promise<void> {
    return new Promise((resolve) => {
      const startTime = performance.now();
      const durationMs = duration * 1000;

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        if (fromLayer) fromLayer.alpha = 1 - eased;
        if (toLayer) toLayer.alpha = eased * 0.7; // Max 0.7 for overlay layers

        this.viewer.scene.requestRender();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          if (fromLayer) fromLayer.alpha = 0;
          if (toLayer) toLayer.alpha = 0.7;
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Set atmosphere color shifts (for artistic effects)
   */
  setAtmosphereShift(hue: number, saturation: number, brightness: number): void {
    const atmosphere = this.scene.skyAtmosphere;
    if (atmosphere) {
      (atmosphere as any).hueShift = hue;
      (atmosphere as any).saturationShift = saturation;
      (atmosphere as any).brightnessShift = brightness;
      this.viewer.scene.requestRender();
    }
  }

  /**
   * Reset atmosphere to defaults
   */
  resetAtmosphere(): void {
    this.setAtmosphereShift(0, 0, 0);
  }

  /**
   * Clean up
   */
  destroy(): void {
    this.stopTimeSimulation();
  }
}

/**
 * Camera flight utilities for smooth transitions
 */
export class CameraFlight {
  private viewer: Viewer;

  constructor(viewer: Viewer) {
    this.viewer = viewer;
  }

  /**
   * Fly to a location with smooth easing and data loading awareness
   */
  async flyToRegion(
    west: number,
    south: number,
    east: number,
    north: number,
    options: {
      duration?: number;
      padding?: number;
      waitForTiles?: boolean;
      maxWaitSeconds?: number;
      onTileProgress?: (loaded: boolean) => void;
    } = {}
  ): Promise<void> {
    const {
      duration = 2.0,
      padding = 0.35,
      waitForTiles = true,
      maxWaitSeconds = 10,
      onTileProgress,
    } = options;

    const padX = (east - west) * padding + 0.002;
    const padY = (north - south) * padding + 0.002;
    const rectangle = Rectangle.fromDegrees(west - padX, south - padY, east + padX, north + padY);

    return new Promise((resolve) => {
      const camera = this.viewer.camera;

      camera.flyTo({
        destination: rectangle,
        duration,
        complete: async () => {
          if (waitForTiles) {
            await this.waitForTilesLoaded(maxWaitSeconds, onTileProgress);
          }
          resolve();
        },
        cancel: resolve,
      });
    });
  }

  /**
   * Fly to a point with specific height
   */
  async flyToPoint(
    lon: number,
    lat: number,
    height: number,
    options: {
      duration?: number;
      waitForTiles?: boolean;
      maxWaitSeconds?: number;
    } = {}
  ): Promise<void> {
    const { duration = 2.5, waitForTiles = true, maxWaitSeconds = 10 } = options;

    return new Promise((resolve) => {
      const destination = Cartesian3.fromDegrees(lon, lat, height);
      this.viewer.camera.flyTo({
        destination,
        duration,
        complete: async () => {
          if (waitForTiles) {
            await this.waitForTilesLoaded(maxWaitSeconds);
          }
          resolve();
        },
        cancel: resolve,
      });
    });
  }

  /**
   * Wait for terrain/imagery tiles to load
   */
  private async waitForTilesLoaded(
    maxSeconds: number,
    onProgress?: (loaded: boolean) => void
  ): Promise<void> {
    return new Promise((resolve) => {
      const startTime = performance.now();

      const check = () => {
        const elapsed = (performance.now() - startTime) / 1000;
        const tilesLoaded = this.viewer.scene.globe.tilesLoaded;

        if (onProgress) onProgress(tilesLoaded);

        if ((elapsed > 1.5 && tilesLoaded) || elapsed >= maxSeconds) {
          resolve();
        } else {
          setTimeout(check, 250);
        }
      };

      check();
    });
  }

  /**
   * Smooth zoom to level
   */
  async zoomToLevel(level: number, duration: number = 1.0): Promise<void> {
    const camera = this.viewer.camera;
    const targetHeight = this.heightForLevel(level);

    return new Promise((resolve) => {
      camera.flyTo({
        destination: Cartesian3.fromRadians(
          camera.positionCartographic.longitude,
          camera.positionCartographic.latitude,
          targetHeight
        ),
        duration,
        complete: resolve,
        cancel: resolve,
      });
    });
  }

  /**
   * Approximate camera height for imagery level
   */
  private heightForLevel(level: number): number {
    // Rough approximation: level 0 ~ 2.2e7m, each level halves
    return 2.2e7 / Math.pow(2, level);
  }
}

/**
 * Enhanced globe initialization with all effects
 */
export function createEnhancedGlobe(container: HTMLElement, options: {
  ionToken?: string;
  effectsOptions?: GlobeEffectsOptions;
} = {}) {
  const { Viewer, Ion, Terrain, UrlTemplateImageryProvider, ImageryLayer, Color } = require("cesium");

  const ionToken = options.ionToken ?? import.meta.env.VITE_CESIUM_ION_TOKEN;

  if (ionToken) Ion.defaultAccessToken = ionToken;

  const viewer = new Viewer(container, {
    baseLayer: new ImageryLayer(
      new UrlTemplateImageryProvider({
        url: "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        maximumLevel: 19,
        credit: "Basemap: Esri, Maxar, Earthstar Geographics, and the GIS User Community",
      })
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
    requestRenderMode: true,
    maximumRenderTimeChange: Infinity,
  });

  const scene = viewer.scene;
  scene.backgroundColor = Color.fromCssColorString("#080c0f");
  scene.globe.baseColor = Color.fromCssColorString("#0d1418");
  scene.globe.showGroundAtmosphere = true;
  if (scene.skyAtmosphere) scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.screenSpaceCameraController.inertiaZoom = 0.85;
  scene.screenSpaceCameraController.minimumZoomDistance = 300;

  // Initialize effects
  const effects = new GlobeEffects(viewer, options.effectsOptions);
  effects.initialize();

  const flight = new CameraFlight(viewer);

  return { viewer, effects, flight };
}