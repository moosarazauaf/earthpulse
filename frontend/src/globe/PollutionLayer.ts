/**
 * Pollution Layer for Cesium Globe
 * Provides air quality visualization using CAMS, OpenAQ, and Sentinel-5P data
 * Supports PM2.5, NO2, O3, CO, SO2, AQI layers with hotspot detection.
 */

import {
  ImageryLayer,
  ImageryLayerCollection,
  Rectangle,
  WebMapServiceImageryProvider,
} from "cesium";

export interface PollutionLayerOptions {
  /** CAMS API endpoint (requires registration) */
  camsApiBase?: string;
  /** OpenAQ API base */
  openAqApiBase?: string;
  /** Sentinel-5P tile service */
  sentinel5pTileTemplate?: string;
  /** Maximum zoom level */
  maximumLevel?: number;
  /** Attribution */
  attribution?: string;
}

export interface AirQualityData {
  location: { lat: number; lon: number; name?: string };
  timestamp: string;
  aqi: number;
  aqiCategory: AQICategory;
  pollutants: {
    pm25?: number;
    pm10?: number;
    no2?: number;
    o3?: number;
    co?: number;
    so2?: number;
  };
  source: "cams" | "openaq" | "sentinel5p" | "combined";
}

export interface AQICategory {
  level: number;
  label: string;
  color: string;
  healthMessage: string;
}

export interface PollutionHotspot {
  id: string;
  lat: number;
  lon: number;
  pollutant: string;
  value: number;
  unit: string;
  threshold: number;
  severity: "moderate" | "high" | "very-high" | "extreme";
  timestamp: string;
  areaKm2?: number;
}

export interface ForecastPoint {
  time: string;
  aqi: number;
  pollutants: Record<string, number>;
}

/**
 * PollutionLayer manages air quality visualization on the globe.
 */
export class PollutionLayer {
  private viewer: any;
  private imageryLayers: ImageryLayerCollection;
  private layers: Map<string, ImageryLayer> = new Map();
  private labelsLayer: ImageryLayer | null = null;
  private options: Required<PollutionLayerOptions>;
  private currentLayerType: string | null = null;
  private currentPollutant: string = "aqi";
  private forecastData: ForecastPoint[] = [];

  constructor(viewer: any, options: PollutionLayerOptions = {}) {
    this.viewer = viewer;
    this.imageryLayers = viewer.imageryLayers;
    this.options = {
      camsApiBase: options.camsApiBase ?? "https://atmosphere.copernicus.eu/api",
      openAqApiBase: options.openAqApiBase ?? "https://api.openaq.org/v2",
      sentinel5pTileTemplate: options.sentinel5pTileTemplate ?? "",
      maximumLevel: options.maximumLevel ?? 8,
      attribution: options.attribution ?? "CAMS / OpenAQ / ESA Sentinel-5P",
    };
  }

  /**
   * Initialize with labels layer reference
   */
  initialize(labelsLayer?: ImageryLayer): void {
    this.labelsLayer = labelsLayer ?? null;
  }

  /**
   * Show AQI (Air Quality Index) layer
   */
  async showAQILayer(): Promise<void> {
    await this.showWmsLayer("aqi", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/AQI/{z}/{x}/{y}?appid={key}",
      layers: "aqi",
      styles: "default",
    });
    this.currentPollutant = "aqi";
  }

  /**
   * Show PM2.5 layer
   */
  async showPM25Layer(): Promise<void> {
    await this.showWmsLayer("pm25", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/PM25/{z}/{x}/{y}?appid={key}",
      layers: "pm25",
      styles: "default",
    });
    this.currentPollutant = "pm25";
  }

  /**
   * Show NO2 layer
   */
  async showNO2Layer(): Promise<void> {
    await this.showWmsLayer("no2", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/NO2/{z}/{x}/{y}?appid={key}",
      layers: "no2",
      styles: "default",
    });
    this.currentPollutant = "no2";
  }

  /**
   * Show O3 layer
   */
  async showO3Layer(): Promise<void> {
    await this.showWmsLayer("o3", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/O3/{z}/{x}/{y}?appid={key}",
      layers: "o3",
      styles: "default",
    });
    this.currentPollutant = "o3";
  }

  /**
   * Show CO layer
   */
  async showCOLayer(): Promise<void> {
    await this.showWmsLayer("co", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/CO/{z}/{x}/{y}?appid={key}",
      layers: "co",
      styles: "default",
    });
    this.currentPollutant = "co";
  }

  /**
   * Show SO2 layer
   */
  async showSO2Layer(): Promise<void> {
    await this.showWmsLayer("so2", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/SO2/{z}/{x}/{y}?appid={key}",
      layers: "so2",
      styles: "default",
    });
    this.currentPollutant = "so2";
  }

  /**
   * Generic WMS layer display
   */
  private async showWmsLayer(id: string, wmsParams: any): Promise<void> {
    this.hideAllLayers();

    try {
      const provider = new WebMapServiceImageryProvider({
        url: wmsParams.url,
        layers: wmsParams.layers,
        parameters: {
          Service: "WMS",
          Version: "1.3.0",
          Request: "GetMap",
          Format: "image/png",
          Transparent: true,
          Styles: wmsParams.styles,
          CRS: "EPSG:3857",
        },
        credit: this.options.attribution,
        rectangle: Rectangle.fromDegrees(-180, -90, 180, 90),
      });

      await (provider as any).readyPromise;

      const layer = new ImageryLayer(provider, {
        alpha: 0.7,
        show: true,
      });

      const insertIndex = this.labelsLayer
        ? this.imageryLayers.indexOf(this.labelsLayer)
        : this.imageryLayers.length - 1;

      this.imageryLayers.add(layer, insertIndex);
      this.layers.set(id, layer);
      this.currentLayerType = id;
    } catch (error) {
      console.warn(`Failed to load ${id} pollution layer:`, error);
    }
  }

  /**
   * Hide all pollution layers
   */
  hideAllLayers(): void {
    for (const [, layer] of this.layers) {
      this.imageryLayers.remove(layer, true);
    }
    this.layers.clear();
    this.currentLayerType = null;
  }

  /**
   * Set pollution layer opacity
   */
  setOpacity(opacity: number): void {
    for (const layer of this.layers.values()) {
      layer.alpha = opacity;
    }
    this.viewer.scene.requestRender();
  }

  /**
   * Get current active layer type
   */
  getCurrentLayer(): string | null {
    return this.currentLayerType;
  }

  /**
   * Get current pollutant
   */
  getCurrentPollutant(): string {
    return this.currentPollutant;
  }

  /**
   * Fetch air quality from OpenAQ for a location
   */
  async fetchOpenAQData(lat: number, lon: number, radiusKm = 50): Promise<any[]> {
    try {
      const url = `${this.options.openAqApiBase}/latest?coordinates=${lat},${lon}&radius=${radiusKm * 1000}&limit=100&order_by=lastUpdated&sort=desc`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`OpenAQ API error: ${response.status}`);
      const data = await response.json();

      return data.results?.map((result: any) => this.parseOpenAQResult(result)) ?? [];
    } catch (error) {
      console.warn("Failed to fetch OpenAQ data:", error);
      return [];
    }
  }

  /**
   * Parse OpenAQ result
   */
  private parseOpenAQResult(result: any): any {
    const pollutants: Record<string, number> = {};
    for (const measurement of result.measurements ?? []) {
      pollutants[measurement.parameter.toLowerCase()] = measurement.value;
    }

    // Calculate AQI from pollutants (simplified US AQI)
    const aqi = this.calculateAQI(pollutants);

    return {
      location: { lat: result.coordinates.latitude, lon: result.coordinates.longitude, name: result.location },
      timestamp: result.lastUpdated,
      aqi,
      aqiCategory: this.getAQICategory(aqi),
      pollutants: {
        pm25: pollutants.pm25,
        pm10: pollutants.pm10,
        no2: pollutants.no2,
        o3: pollutants.o3,
        co: pollutants.co,
        so2: pollutants.so2,
      },
      source: "openaq",
    };
  }

  /**
   * Calculate US AQI from pollutant concentrations
   */
  private calculateAQI(pollutants: Record<string, number>): number {
    let maxAQI = 0;

    // PM2.5 breakpoints (µg/m³)
    if (pollutants.pm25 !== undefined) {
      maxAQI = Math.max(maxAQI, this.aqiFromBreakpoints(pollutants.pm25, [
        [0, 12.0, 0, 50],
        [12.1, 35.4, 51, 100],
        [35.5, 55.4, 101, 150],
        [55.5, 150.4, 151, 200],
        [150.5, 250.4, 201, 300],
        [250.5, 500.4, 301, 500],
      ]));
    }

    // PM10 breakpoints
    if (pollutants.pm10 !== undefined) {
      maxAQI = Math.max(maxAQI, this.aqiFromBreakpoints(pollutants.pm10, [
        [0, 54, 0, 50],
        [55, 154, 51, 100],
        [155, 254, 101, 150],
        [255, 354, 151, 200],
        [355, 424, 201, 300],
        [425, 604, 301, 500],
      ]));
    }

    // NO2 breakpoints (ppb)
    if (pollutants.no2 !== undefined) {
      maxAQI = Math.max(maxAQI, this.aqiFromBreakpoints(pollutants.no2, [
        [0, 53, 0, 50],
        [54, 100, 51, 100],
        [101, 360, 101, 150],
        [361, 649, 151, 200],
        [650, 1249, 201, 300],
        [1250, 2049, 301, 500],
      ]));
    }

    // O3 breakpoints (ppb, 8-hour)
    if (pollutants.o3 !== undefined) {
      maxAQI = Math.max(maxAQI, this.aqiFromBreakpoints(pollutants.o3, [
        [0, 54, 0, 50],
        [55, 70, 51, 100],
        [71, 85, 101, 150],
        [86, 105, 151, 200],
        [106, 200, 201, 300],
      ]));
    }

    // CO breakpoints (ppm)
    if (pollutants.co !== undefined) {
      maxAQI = Math.max(maxAQI, this.aqiFromBreakpoints(pollutants.co, [
        [0, 4.4, 0, 50],
        [4.5, 9.4, 51, 100],
        [9.5, 12.4, 101, 150],
        [12.5, 15.4, 151, 200],
        [15.5, 30.4, 201, 300],
        [30.5, 50.4, 301, 500],
      ]));
    }

    // SO2 breakpoints (ppb)
    if (pollutants.so2 !== undefined) {
      maxAQI = Math.max(maxAQI, this.aqiFromBreakpoints(pollutants.so2, [
        [0, 35, 0, 50],
        [36, 75, 51, 100],
        [76, 185, 101, 150],
        [186, 304, 151, 200],
        [305, 604, 201, 300],
        [605, 1004, 301, 500],
      ]));
    }

    return Math.round(maxAQI);
  }

  /**
   * Calculate AQI from concentration using breakpoints
   */
  private aqiFromBreakpoints(conc: number, breakpoints: number[][]): number {
    for (const bp of breakpoints) {
      const cLow = bp[0] ?? 0;
      const cHigh = bp[1] ?? 0;
      const iLow = bp[2] ?? 0;
      const iHigh = bp[3] ?? 0;
      if (conc >= cLow && conc <= cHigh) {
        return ((iHigh - iLow) / (cHigh - cLow)) * (conc - cLow) + iLow;
      }
    }
    // Above highest breakpoint
    const last = breakpoints[breakpoints.length - 1];
    return last?.[3] ?? 0;
  }

  /**
   * Get AQI category from value
   */
  getAQICategory(aqi: number): AQICategory {
    if (aqi <= 50) return { level: 1, label: "Good", color: "#00e400", healthMessage: "Air quality is satisfactory." };
    if (aqi <= 100) return { level: 2, label: "Moderate", color: "#ffff00", healthMessage: "Acceptable; sensitive people may experience effects." };
    if (aqi <= 150) return { level: 3, label: "Unhealthy for Sensitive Groups", color: "#ff7e00", healthMessage: "Sensitive groups may experience health effects." };
    if (aqi <= 200) return { level: 4, label: "Unhealthy", color: "#ff0000", healthMessage: "Everyone may experience health effects." };
    if (aqi <= 300) return { level: 5, label: "Very Unhealthy", color: "#8f3f97", healthMessage: "Health alert: everyone may experience serious effects." };
    return { level: 6, label: "Hazardous", color: "#7e0023", healthMessage: "Health emergency: everyone avoid outdoor exertion." };
  }

  /**
   * Fetch pollution hotspots (areas exceeding thresholds)
   */
  async fetchHotspots(pollutant: string = "pm25", threshold?: number): Promise<PollutionHotspot[]> {
    // This would typically query a pre-processed dataset or API
    // For now, return mock data structure
    const defaultThresholds: Record<string, number> = {
      pm25: 35,   // µg/m³ (WHO 24h guideline: 15, but moderate threshold)
      pm10: 50,
      no2: 25,    // ppb
      o3: 100,
      co: 9,
      so2: 20,
      aqi: 100,
    };

    const thresh = threshold ?? defaultThresholds[pollutant] ?? 100;
    void thresh; // suppress unused warning

    // In production, this would query CAMS or processed Sentinel-5P data
    // Returning empty array for now - would be populated from backend
    return [];
  }

  /**
   * Display hotspots on globe
   */
  showHotspots(hotspots: PollutionHotspot[]): void {
    // In a full implementation, this would create Cesium entities for hotspots
    // For now, this is a placeholder
    console.log("Showing hotspots:", hotspots.length);
  }

  /**
   * Clear hotspot display
   */
  clearHotspots(): void {
    // Placeholder for clearing hotspot entities
  }

  /**
   * Get forecast data
   */
  getForecast(): ForecastPoint[] {
    return [...this.forecastData];
  }

  /**
   * Set forecast data (from backend)
   */
  setForecast(data: ForecastPoint[]): void {
    this.forecastData = data;
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.hideAllLayers();
    this.forecastData = [];
  }
}

/**
 * AQI Color scale for legends
 */
export const AQI_COLOR_SCALE = [
  { min: 0, max: 50, color: "#00e400", label: "Good" },
  { min: 51, max: 100, color: "#ffff00", label: "Moderate" },
  { min: 101, max: 150, color: "#ff7e00", label: "Unhealthy for Sensitive Groups" },
  { min: 151, max: 200, color: "#ff0000", label: "Unhealthy" },
  { min: 201, max: 300, color: "#8f3f97", label: "Very Unhealthy" },
  { min: 301, max: 500, color: "#7e0023", label: "Hazardous" },
];

/**
 * Pollutant units and display names
 */
export const POLLUTANT_INFO: Record<string, { unit: string; name: string; whoGuideline?: number }> = {
  aqi: { unit: "AQI", name: "Air Quality Index" },
  pm25: { unit: "µg/m³", name: "PM₂.₅", whoGuideline: 15 },
  pm10: { unit: "µg/m³", name: "PM₁₀", whoGuideline: 45 },
  no2: { unit: "ppb", name: "NO₂", whoGuideline: 25 },
  o3: { unit: "ppb", name: "O₃", whoGuideline: 100 },
  co: { unit: "ppm", name: "CO", whoGuideline: 4 },
  so2: { unit: "ppb", name: "SO₂", whoGuideline: 40 },
};

/**
 * Get pollutant display info
 */
export function getPollutantInfo(pollutant: string) {
  return POLLUTANT_INFO[pollutant] ?? { unit: "", name: pollutant.toUpperCase() };
}