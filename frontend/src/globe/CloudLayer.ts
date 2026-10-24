/**
 * Cloud Layer for Cesium Globe
 * Provides animated cloud cover using NOAA GOES / EUMETSAT tile services
 * with smooth transitions and toggle support.
 */

import {
  ImageryLayer,
  ImageryLayerCollection,
  Rectangle,
  UrlTemplateImageryProvider,
} from "cesium";

interface CloudLayerOptions {
  /** Cloud tile URL template with {time} placeholder */
  urlTemplate: string;
  /** Available timestamps (ISO strings) */
  timestamps: string[];
  /** Attribution text */
  attribution: string;
  /** Animation interval in ms (default: 30 min = 1800000) */
  animationIntervalMs?: number;
  /** Fade duration in seconds */
  fadeDuration?: number;
  /** Maximum zoom level */
  maximumLevel?: number;
}

/**
 * CloudLayer manages animated cloud cover on the globe.
 * Uses multiple ImageryLayers for smooth cross-fade transitions.
 */
export class CloudLayer {
  private viewer: any; // Cesium Viewer
  private layers: ImageryLayer[] = [];
  private currentFrameIndex = 0;
  private animationTimer: number | null = null;
  private isPlaying = false;
  private options: Required<CloudLayerOptions>;
  private imageryLayers: ImageryLayerCollection;
  private labelsLayer: ImageryLayer | null = null;

  constructor(viewer: any, options: CloudLayerOptions) {
    this.viewer = viewer;
    this.imageryLayers = viewer.imageryLayers;
    this.options = {
      urlTemplate: options.urlTemplate,
      timestamps: options.timestamps,
      attribution: options.attribution,
      animationIntervalMs: options.animationIntervalMs ?? 1800000, // 30 min
      fadeDuration: options.fadeDuration ?? 2.0,
      maximumLevel: options.maximumLevel ?? 8,
    };
  }

  /**
   * Initialize the cloud layer with the first frame
   */
  async initialize(labelsLayer?: ImageryLayer): Promise<void> {
    this.labelsLayer = labelsLayer ?? null;
    if (this.options.timestamps.length === 0) return;

    // Create first frame layer
    const layer = await this.createFrameLayer(0);
    if (layer) {
      this.layers.push(layer);
      this.currentFrameIndex = 0;
      this.setLayerVisibility(layer, true);
    }
  }

  /**
   * Create an ImageryLayer for a specific timestamp
   */
  private async createFrameLayer(frameIndex: number): Promise<ImageryLayer | null> {
    const timestamp = this.options.timestamps[frameIndex];
    if (!timestamp) return null;
    const url = this.options.urlTemplate.replace("{time}", timestamp);

    try {
      const provider = new UrlTemplateImageryProvider({
        url,
        maximumLevel: this.options.maximumLevel,
        credit: this.options.attribution,
        // Don't request tiles below zoom level 3 (global view)
        minimumLevel: 1,
        // Rectangle for full globe
        rectangle: Rectangle.fromDegrees(-180, -90, 180, 90),
      });

      // Wait for provider to be ready
      await (provider as any).readyPromise;

      const layer = new ImageryLayer(provider, {
        alpha: 0.0, // Start invisible for fade-in
        show: true,
      });

      // Insert below labels but above base imagery
      const insertIndex = this.labelsLayer
        ? this.imageryLayers.indexOf(this.labelsLayer)
        : this.imageryLayers.length - 1;

      this.imageryLayers.add(layer, insertIndex);
      return layer;
    } catch (error) {
      console.warn(`Failed to create cloud layer for ${timestamp}:`, error);
      return null;
    }
  }

  /**
   * Start cloud animation
   */
  startAnimation(): void {
    if (this.isPlaying || this.options.timestamps.length <= 1) return;
    this.isPlaying = true;
    this.scheduleNextFrame();
  }

  /**
   * Stop cloud animation
   */
  stopAnimation(): void {
    this.isPlaying = false;
    if (this.animationTimer !== null) {
      window.clearTimeout(this.animationTimer);
      this.animationTimer = null;
    }
  }

  /**
   * Schedule the next frame transition
   */
  private scheduleNextFrame(): void {
    if (!this.isPlaying) return;

    this.animationTimer = window.setTimeout(() => {
      this.transitionToNextFrame();
    }, this.options.animationIntervalMs);
  }

  /**
   * Cross-fade to the next cloud frame
   */
  private async transitionToNextFrame(): Promise<void> {
    if (!this.isPlaying) return;

    const nextIndex = (this.currentFrameIndex + 1) % this.options.timestamps.length;

    // Create next frame layer
    const nextLayer = await this.createFrameLayer(nextIndex);
    if (!nextLayer) {
      this.scheduleNextFrame();
      return;
    }

    this.layers.push(nextLayer);
    this.setLayerVisibility(nextLayer, true);

    // Fade out current layer
    const currentLayer = this.layers[this.currentFrameIndex];
    if (currentLayer) {
      await this.fadeLayer(currentLayer, 0.0, this.options.fadeDuration);
      this.imageryLayers.remove(currentLayer, true);
    }

    // Fade in new layer
    await this.fadeLayer(nextLayer, 0.7, this.options.fadeDuration);

    this.currentFrameIndex = nextIndex;

    // Clean up old layers (keep only current + 1 previous for smooth transition)
    if (this.layers.length > 2) {
      const oldLayer = this.layers.shift();
      if (oldLayer && oldLayer !== nextLayer && oldLayer !== currentLayer) {
        this.imageryLayers.remove(oldLayer, true);
      }
    }

    this.scheduleNextFrame();
  }

  /**
   * Fade a layer's alpha over duration seconds
   */
  private fadeLayer(layer: ImageryLayer, targetAlpha: number, durationSeconds: number): Promise<void> {
    return new Promise((resolve) => {
      const startAlpha = layer.alpha;
      const delta = targetAlpha - startAlpha;
      const startTime = performance.now();
      const durationMs = durationSeconds * 1000;

      const animate = () => {
        const elapsed = performance.now() - startTime;
        const progress = Math.min(elapsed / durationMs, 1);
        // Ease in-out
        const eased = progress < 0.5
          ? 2 * progress * progress
          : 1 - Math.pow(-2 * progress + 2, 2) / 2;

        layer.alpha = startAlpha + delta * eased;
        this.viewer.scene.requestRender();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          layer.alpha = targetAlpha;
          resolve();
        }
      };

      animate();
    });
  }

  /**
   * Set layer visibility immediately (no fade)
   */
  private setLayerVisibility(layer: ImageryLayer, visible: boolean): void {
    layer.show = visible;
    if (visible) layer.alpha = 0.7;
    this.viewer.scene.requestRender();
  }

  /**
   * Set cloud opacity (0-1)
   */
  setOpacity(opacity: number): void {
    const clamped = Math.max(0, Math.min(1, opacity));
    for (const layer of this.layers) {
      layer.alpha = clamped * 0.7; // Max 0.7 for clouds
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Set cloud visibility
   */
  setVisible(visible: boolean): void {
    for (const layer of this.layers) {
      layer.show = visible;
    }
    if (visible && this.isPlaying) {
      this.startAnimation();
    } else {
      this.stopAnimation();
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Get current visibility state
   */
  getVisible(): boolean {
    return this.layers.length > 0 && this.layers[0]?.show === true;
  }

  /**
   * Jump to specific timestamp (for time slider)
   */
  async jumpToTime(timestamp: string): Promise<void> {
    const index = this.options.timestamps.indexOf(timestamp);
    if (index === -1 || index === this.currentFrameIndex) return;

    const wasPlaying = this.isPlaying;
    this.stopAnimation();

    const nextLayer = await this.createFrameLayer(index);
    if (!nextLayer) return;

    this.layers.push(nextLayer);
    this.setLayerVisibility(nextLayer, true);

    const currentLayer = this.layers[this.currentFrameIndex];
    if (currentLayer) {
      await this.fadeLayer(currentLayer, 0.0, this.options.fadeDuration);
      this.imageryLayers.remove(currentLayer, true);
    }

    await this.fadeLayer(nextLayer, 0.7, this.options.fadeDuration);
    this.currentFrameIndex = index;

    if (wasPlaying) this.startAnimation();
  }

  /**
   * Get available timestamps for UI
   */
  getTimestamps(): string[] {
    return [...this.options.timestamps];
  }

  /**
   * Get current timestamp
   */
  getCurrentTimestamp(): string | null {
    if (this.layers.length === 0) return null;
    return this.options.timestamps[this.currentFrameIndex] ?? null;
  }

  /**
   * Clean up all layers
   */
  destroy(): void {
    this.stopAnimation();
    for (const layer of this.layers) {
      this.imageryLayers.remove(layer, true);
    }
    this.layers = [];
  }
}

/**
 * Generate cloud timestamps for the last 24 hours at 30-min intervals
 */
export function generateCloudTimestamps(hoursBack = 24, intervalMinutes = 30): string[] {
  const timestamps: string[] = [];
  const now = new Date();
  // Round down to nearest interval
  const roundedMinutes = Math.floor(now.getUTCMinutes() / intervalMinutes) * intervalMinutes;
  now.setUTCMinutes(roundedMinutes, 0, 0);

  const totalIntervals = (hoursBack * 60) / intervalMinutes;

  for (let i = 0; i < totalIntervals; i++) {
    const time = new Date(now.getTime() - i * intervalMinutes * 60 * 1000);
    timestamps.push(time.toISOString().replace(/[:.]/g, "").slice(0, 15) + "Z");
  }

  return timestamps.reverse(); // Oldest first for animation
}

/**
 * NOAA GOES-16/17 GEOCOLOR cloud tile URL template
 * Format: https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/GEOCOLOR/{YYYY}{MM}{DD}{HH}{MM}00.jpg
 * But we need tile service... using a simpler approach with pre-rendered tiles
 */
export const CLOUD_TILE_TEMPLATES = {
  // NOAA GOES-East (covers Americas) - using RAMMB/CIRA slider tiles
  goesEast: {
    urlTemplate: "https://rammb-slider.cira.colostate.edu/data/imagery/{time}/goes-16---full_disk/geocolor/{z}/{x}/{y}.png",
    attribution: "NOAA GOES-16 / CIRA",
    maxLevel: 6,
  },
  // EUMETSAT MSG (covers Europe/Africa)
  eumetsat: {
    urlTemplate: "https://api.sat.owm.io/map/clouds/{z}/{x}/{y}.png?time={time}&appid={key}",
    attribution: "EUMETSAT / OpenWeatherMap",
    maxLevel: 8,
  },
  // Himawari (covers Asia/Pacific)
  himawari: {
    urlTemplate: "https://rammb-slider.cira.colostate.edu/data/imagery/{time}/himawari-8---full_disk/geocolor/{z}/{x}/{y}.png",
    attribution: "JMA Himawari-8 / CIRA",
    maxLevel: 6,
  },
  // Global composite (OpenWeatherMap - requires API key)
  openWeather: {
    urlTemplate: "https://tile.openweathermap.org/map/clouds_new/{z}/{x}/{y}.png?time={time}&appid={key}",
    attribution: "OpenWeatherMap",
    maxLevel: 10,
  },
};