/**
 * Weather Layer for Cesium Globe
 * Provides weather visualization using Open-Meteo API and tile services
 * Supports temperature, precipitation, wind, pressure layers.
 */

import {
  ImageryLayer,
  ImageryLayerCollection,
  Rectangle,
  WebMapServiceImageryProvider,
  Color,
  Cartesian3,
  Cartesian2,
  Entity,
  VerticalOrigin,
} from "cesium";

export interface WeatherLayerOptions {
  /** Open-Meteo API base URL */
  apiBase?: string;
  /** Tile server URL template */
  tileTemplate?: string;
  /** Maximum zoom level */
  maximumLevel?: number;
  /** Attribution */
  attribution?: string;
}

export interface WeatherData {
  temperature?: {
    current: number;
    unit: "celsius" | "fahrenheit";
    min: number;
    max: number;
  };
  precipitation?: {
    current: number;
    unit: "mm" | "inch";
    probability: number;
  };
  wind?: {
    speed: number;
    direction: number;
    unit: "ms" | "kmh" | "mph" | "kn";
  };
  pressure?: {
    current: number;
    unit: "hPa" | "inHg";
  };
  cloudCover?: number;
  timestamp: string;
  location: { lat: number; lon: number };
}

export interface ForecastPoint {
  time: string;
  temperature: number;
  precipitation: number;
  precipitationProbability: number;
  windSpeed: number;
  windDirection: number;
  cloudCover: number;
  pressure: number;
}

/**
 * WeatherLayer manages weather visualization on the globe.
 * Supports raster tiles (WMS/WMTS) and point data from APIs.
 */
export class WeatherLayer {
  private viewer: any;
  private imageryLayers: ImageryLayerCollection;
  private layers: Map<string, ImageryLayer> = new Map();
  private pointEntities: Entity[] = [];
  private labelsLayer: ImageryLayer | null = null;
  private options: Required<WeatherLayerOptions>;
  private currentLayerType: string | null = null;
  private forecastData: ForecastPoint[] = [];
  private selectedLocation: { lat: number; lon: number } | null = null;

  constructor(viewer: any, options: WeatherLayerOptions = {}) {
    this.viewer = viewer;
    this.imageryLayers = viewer.imageryLayers;
    this.options = {
      apiBase: options.apiBase ?? "https://api.open-meteo.com/v1",
      tileTemplate: options.tileTemplate ?? "",
      maximumLevel: options.maximumLevel ?? 8,
      attribution: options.attribution ?? "Open-Meteo / NOAA / ECMWF",
    };
  }

  /**
   * Initialize with labels layer reference
   */
  initialize(labelsLayer?: ImageryLayer): void {
    this.labelsLayer = labelsLayer ?? null;
  }

  /**
   * Fetch current weather for a location
   */
  async fetchCurrentWeather(lat: number, lon: number): Promise<WeatherData | null> {
    try {
      const url = `${this.options.apiBase}/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,precipitation,rain,showers,snowfall,weather_code,cloud_cover,pressure_msl,surface_pressure,wind_speed_10m,wind_direction_10m&timezone=auto`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Weather API error: ${response.status}`);
      const data = await response.json();
      return this.parseCurrentWeather(data, lat, lon);
    } catch (error) {
      console.warn("Failed to fetch current weather:", error);
      return null;
    }
  }

  /**
   * Fetch forecast for a location
   */
  async fetchForecast(lat: number, lon: number, days = 7): Promise<ForecastPoint[]> {
    try {
      const url = `${this.options.apiBase}/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,precipitation_probability,cloud_cover,pressure_msl,wind_speed_10m,wind_direction_10m&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=${days}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Forecast API error: ${response.status}`);
      const data = await response.json();
      return this.parseForecast(data);
    } catch (error) {
      console.warn("Failed to fetch forecast:", error);
      return [];
    }
  }

  /**
   * Parse current weather from Open-Meteo response
   */
  private parseCurrentWeather(data: any, lat: number, lon: number): WeatherData {
    const c = data.current;
    return {
      temperature: {
        current: c.temperature_2m,
        unit: "celsius",
        min: c.temperature_2m,
        max: c.temperature_2m,
      },
      precipitation: {
        current: c.precipitation,
        unit: "mm",
        probability: c.precipitation_probability ?? 0,
      },
      wind: {
        speed: c.wind_speed_10m,
        direction: c.wind_direction_10m,
        unit: "kmh",
      },
      pressure: {
        current: c.pressure_msl,
        unit: "hPa",
      },
      cloudCover: c.cloud_cover,
      timestamp: c.time,
      location: { lat, lon },
    };
  }

  /**
   * Parse forecast from Open-Meteo response
   */
  private parseForecast(data: any): ForecastPoint[] {
    const hourly = data.hourly;
    const points: ForecastPoint[] = [];

    for (let i = 0; i < hourly.time.length; i++) {
      points.push({
        time: hourly.time[i],
        temperature: hourly.temperature_2m[i],
        precipitation: hourly.precipitation[i],
        precipitationProbability: hourly.precipitation_probability[i],
        windSpeed: hourly.wind_speed_10m[i],
        windDirection: hourly.wind_direction_10m[i],
        cloudCover: hourly.cloud_cover[i],
        pressure: hourly.pressure_msl[i],
      });
    }

    this.forecastData = points;
    return points;
  }

  /**
   * Show temperature layer as WMS
   */
  async showTemperatureLayer(): Promise<void> {
    await this.showWmsLayer("temperature", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/TA2/{z}/{x}/{y}?appid={key}",
      layers: "temperature",
      styles: "default",
      format: "image/png",
      transparent: true,
    });
  }

  /**
   * Show precipitation layer as WMS
   */
  async showPrecipitationLayer(): Promise<void> {
    await this.showWmsLayer("precipitation", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/PR0/{z}/{x}/{y}?appid={key}",
      layers: "precipitation",
      styles: "default",
      format: "image/png",
      transparent: true,
    });
  }

  /**
   * Show wind layer as WMS
   */
  async showWindLayer(): Promise<void> {
    await this.showWmsLayer("wind", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/WND/{z}/{x}/{y}?appid={key}",
      layers: "wind",
      styles: "default",
      format: "image/png",
      transparent: true,
    });
  }

  /**
   * Show pressure layer as WMS
   */
  async showPressureLayer(): Promise<void> {
    await this.showWmsLayer("pressure", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/PM0/{z}/{x}/{y}?appid={key}",
      layers: "pressure",
      styles: "default",
      format: "image/png",
      transparent: true,
    });
  }

  /**
   * Show cloud cover layer as WMS
   */
  async showCloudCoverLayer(): Promise<void> {
    await this.showWmsLayer("clouds", {
      url: "https://maps.openweathermap.org/maps/2.0/weather/CL/{z}/{x}/{y}?appid={key}",
      layers: "clouds",
      styles: "default",
      format: "image/png",
      transparent: true,
    });
  }

  /**
   * Generic WMS layer display
   */
  private async showWmsLayer(id: string, wmsParams: any): Promise<void> {
    // Hide existing weather layers
    this.hideAllLayers();

    try {
      const provider = new WebMapServiceImageryProvider({
        url: wmsParams.url,
        layers: wmsParams.layers,
        parameters: {
          Service: "WMS",
          Version: "1.3.0",
          Request: "GetMap",
          Format: wmsParams.format,
          Transparent: wmsParams.transparent,
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
      console.warn(`Failed to load ${id} weather layer:`, error);
    }
  }

  /**
   * Hide all weather layers
   */
  hideAllLayers(): void {
    for (const [, layer] of this.layers) {
      this.imageryLayers.remove(layer, true);
    }
    this.layers.clear();
    this.currentLayerType = null;
  }

  /**
   * Set weather layer opacity
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
   * Get forecast data for UI
   */
  getForecast(): ForecastPoint[] {
    return [...this.forecastData];
  }

  /**
   * Set selected location for point weather display
   */
  setSelectedLocation(lat: number, lon: number): void {
    this.selectedLocation = { lat, lon };
    this.updatePointDisplay();
  }

  /**
   * Update point weather markers on globe
   */
  private updatePointDisplay(): void {
    // Clear existing point entities
    for (const entity of this.pointEntities) {
      this.viewer.entities.remove(entity);
    }
    this.pointEntities = [];

    if (!this.selectedLocation) return;

    // Add a marker at the selected location with weather info
    const entity = this.viewer.entities.add({
      position: Cartesian3.fromDegrees(this.selectedLocation.lon, this.selectedLocation.lat, 100000),
      point: {
        pixelSize: 12,
        color: Color.CYAN.withAlpha(0.9),
        outlineColor: Color.WHITE,
        outlineWidth: 2,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "Weather",
        font: "12px sans-serif",
        fillColor: Color.WHITE,
        backgroundColor: Color.fromCssColorString("#0b1416").withAlpha(0.85),
        showBackground: true,
        verticalOrigin: VerticalOrigin.BOTTOM,
        pixelOffset: new Cartesian2(0, -20),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    this.pointEntities.push(entity);
  }

  /**
   * Clear point entities
   */
  clearPointDisplay(): void {
    for (const entity of this.pointEntities) {
      this.viewer.entities.remove(entity);
    }
    this.pointEntities = [];
    this.selectedLocation = null;
  }

  /**
   * Clean up all resources
   */
  destroy(): void {
    this.hideAllLayers();
    this.clearPointDisplay();
    this.forecastData = [];
  }
}

/**
 * Weather code to human-readable description (WMO codes)
 */
export const WEATHER_CODES: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

/**
 * Get weather description from code
 */
export function getWeatherDescription(code: number): string {
  return WEATHER_CODES[code] ?? "Unknown";
}

/**
 * Temperature color scale for visualization
 */
export const TEMPERATURE_COLORS = [
  { value: -40, color: "#000080" }, // Dark blue
  { value: -20, color: "#0000ff" }, // Blue
  { value: -10, color: "#00ffff" }, // Cyan
  { value: 0, color: "#00ff00" },   // Green
  { value: 10, color: "#ffff00" },  // Yellow
  { value: 20, color: "#ff8000" },  // Orange
  { value: 30, color: "#ff0000" },  // Red
  { value: 40, color: "#800000" },  // Dark red
  { value: 50, color: "#ffffff" },  // White
];

/**
 * Precipitation color scale
 */
export const PRECIPITATION_COLORS = [
  { value: 0, color: "rgba(255,255,255,0)" },     // Transparent
  { value: 0.1, color: "#00ffff" },               // Light blue
  { value: 1, color: "#0080ff" },                 // Blue
  { value: 5, color: "#0000ff" },                 // Dark blue
  { value: 10, color: "#ff00ff" },                // Magenta
  { value: 25, color: "#ff0000" },                // Red
  { value: 50, color: "#800000" },                // Dark red
  { value: 100, color: "#ffffff" },               // White
];