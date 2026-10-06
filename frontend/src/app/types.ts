/** Shapes shared with the EarthPulse API. */
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

export type DatasetId = "landsat" | "sentinel2";
export type IndexId = "ndvi" | "ndwi" | "mndwi" | "ndbi";
export type RenderId = "truecolor" | "falsecolor" | IndexId;
/** How a value came to exist. Shown beside every result. */
export type ValueKind = "OBSERVED" | "DERIVED" | "MODELED" | "ESTIMATED" | "SIMULATED";
export type AoiGeometry = Polygon | MultiPolygon;

export interface Legend {
  min: number;
  max: number;
  colors: string[];
  unit?: string;
}

/** Legend of a categorical layer. */
export interface ClassLegend {
  classes: { label: string; color: string }[];
}

export interface DatasetInfo {
  id: DatasetId;
  name: string;
  provider: string;
  processing_level: string;
  resolution_m: number;
  temporal_coverage: string;
  license: string;
  attribution: string;
  reference_url: string;
  first_year: number;
  access_date: string;
  bands: string[];
}

export interface IndexInfo {
  id: IndexId;
  name: string;
  formula: string;
  measures: string;
  reference: string;
  defaultThreshold?: number;
}

export interface Catalog {
  datasets: DatasetInfo[];
  indices: IndexInfo[];
  renders: RenderId[];
  processing: { provider: string; url: string; note: string };
}

export interface ImageryLayerInfo {
  id: string;
  dataset: DatasetInfo;
  year: number;
  render: RenderId;
  tileUrl: string;
  minZoom: number;
  maxZoom: number;
  compositing: string;
  note: string | null;
  valueKind: ValueKind;
  title: string;
  description: string;
  legend: Legend | null;
}

export interface SceneInfo {
  id: string;
  datetime: string;
  platform: string;
  cloudCover: number | null;
  footprint: string;
}

export interface Period {
  start: string;
  end: string;
}

export interface ChangeRequest {
  aoi: AoiGeometry;
  label?: string;
  dataset: DatasetId;
  index: IndexId;
  before: Period;
  after: Period;
  threshold?: number;
  maxCloud: number;
  minAreaHa: number;
}

export interface FloodRequest {
  aoi: AoiGeometry;
  label?: string;
  before: Period;
  flood: Period;
  after?: Period;
  thresholdDb?: number;
  minAreaHa: number;
}

export interface TimeSeriesRequest {
  aoi: AoiGeometry;
  label?: string;
  dataset: DatasetId;
  years: number[];
  startMonth: number;
  endMonth: number;
  maxCloud: number;
}

export interface Overlay {
  title: string;
  url: string;
  geotiff: string;
  bounds: [number, number, number, number];
  legend: Legend | ClassLegend;
}

export interface DetectionProps {
  direction: "decrease" | "increase";
  areaHa: number;
  before: number | null;
  after: number | null;
  change: number | null;
  clearObservationsBefore: number | null;
  clearObservationsAfter: number | null;
  centroid: [number, number];
}

export interface Provenance {
  provider: { id: string; name: string; observed: boolean };
  dataset: DatasetInfo;
  index?: IndexInfo;
  indices?: IndexInfo[];
  method: string;
  cloudMask?: string;
  crs: string;
  nativeResolutionM: number;
  workingResolutionM: number;
  gridSize?: [number, number];
  maxCloudPercent?: number;
  scenes?: Record<string, SceneInfo[]>;
  uncertainty?: string;
  // Radar analyses
  polarisation?: string;
  relativeOrbit?: number;
  orbitState?: string | null;
  orbitCoverage?: Record<string, number>;
  threshold?: { valueDb: number; source: "otsu" | "user" | "fallback"; separability: number | null };
  speckleFilter?: string;
  landCover?: { name: string; provider: string; license: string; attribution: string } | null;
}

interface ResultBase {
  id: string;
  label: string | null;
  softwareVersion: string;
  aoi: AoiGeometry;
  valueKind: ValueKind;
  provenance: Provenance;
  warnings: string[];
}

export interface ChangeResult extends ResultBase {
  type: "change";
  request: ChangeRequest;
  summary: {
    aoiAreaHa: number;
    analysedAreaHa: number;
    validFraction: number;
    before: { mean: number | null; median: number | null };
    after: { mean: number | null; median: number | null };
    meanChange: number | null;
    threshold: number;
    lossAreaHa: number;
    gainAreaHa: number;
    lossPercent: number;
    gainPercent: number;
    thresholdSensitivity: { threshold: number; lossAreaHa: number; gainAreaHa: number }[];
    clearObservations: { before: number | null; after: number | null };
  };
  indices: Record<IndexId, { before: number | null; after: number | null; change: number | null }>;
  histogram: { binEdges: number[]; counts: number[] };
  detections: FeatureCollection<Polygon | MultiPolygon, DetectionProps> & {
    totalRegions: number;
    truncated: boolean;
  };
  overlays: Record<"change" | "before" | "after", Overlay>;
}

export interface SeriesEntry {
  year: number;
  period: [string, string];
  status: "OBSERVED" | "SIMULATED" | "NO_DATA";
  reason?: string;
  values: Record<IndexId, number | null> | null;
  validFraction?: number;
  platforms?: string[];
  scenes?: SceneInfo[];
}

export interface TimeSeriesResult extends ResultBase {
  type: "timeseries";
  request: TimeSeriesRequest;
  summary: { aoiAreaHa: number };
  series: SeriesEntry[];
}

export interface FloodResult extends ResultBase {
  type: "flood";
  request: FloodRequest;
  summary: {
    aoiAreaHa: number;
    analysedAreaHa: number;
    validFraction: number;
    floodedAreaHa: number;
    floodedPercent: number;
    preExistingWaterHa: number;
    waterExtentDuringFloodHa: number;
    thresholdDb: number;
    minDropDb: number;
    thresholdSensitivity: { thresholdDb: number; floodedAreaHa: number }[];
    passes: Record<string, number>;
    recession?: { stillWaterHa: number; recededHa: number; notObservedHa: number };
  };
  landCover: {
    croplandFloodedHa: number;
    builtUpFloodedHa: number;
    otherFloodedHa: number;
    permanentWaterMappedHa: number;
    preExistingWaterAlsoMappedHa: number;
    note: string;
  } | null;
  histogram: { binEdges: number[]; counts: number[] };
  detections: ChangeResult["detections"];
  overlays: Record<string, Overlay>;
}

export type AnalysisResult = ChangeResult | TimeSeriesResult | FloodResult;
/** Results that put rasters and regions on the globe. */
export type MappedResult = ChangeResult | FloodResult;
export const isMapped = (r: AnalysisResult | null): r is MappedResult =>
  r !== null && (r.type === "change" || r.type === "flood");
export type JobStatus = "QUEUED" | "RUNNING" | "COMPLETE" | "FAILED";

export interface AnalysisRecord {
  id: string;
  type: "change" | "timeseries" | "flood";
  status: JobStatus;
  stage: string;
  stages: string[];
  createdAt: string;
  updatedAt: string;
  result: AnalysisResult | null;
  error: ApiErrorBody | null;
}

export interface ApiErrorBody {
  code: string;
  message: string;
  hint?: string | null;
}

export interface Place {
  name: string;
  lat: number;
  lon: number;
  bbox: [number, number, number, number];
  kind: string;
}

export type Detection = Feature<Polygon | MultiPolygon, DetectionProps>;
