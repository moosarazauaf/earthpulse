/** Pointer interaction on the globe: drawing an AOI and picking detections. */
import {
  CallbackProperty,
  Cartesian2,
  Cartesian3,
  Cartographic,
  Color,
  Entity,
  Math as CesiumMath,
  PolygonHierarchy,
  ScreenSpaceEventHandler,
  ScreenSpaceEventType,
  defined,
} from "cesium";

import { rectangleAoi } from "../app/logic";
import type { DrawTool } from "../app/store";
import type { AoiGeometry } from "../app/types";
import type { Globe } from "./Globe";

const DRAFT = Color.fromCssColorString("#f2b84b");
const MIN_POLYGON_VERTICES = 3;

type LonLat = [number, number];

export class Drawing {
  private handler: ScreenSpaceEventHandler;
  private tool: DrawTool = "none";
  private points: LonLat[] = [];
  private cursor: LonLat | null = null;
  private draft: Entity | null = null;

  constructor(
    private globe: Globe,
    private onComplete: (geometry: AoiGeometry) => void,
    private onPick: (detectionId: string | null) => void,
  ) {
    const { viewer } = globe;
    this.handler = new ScreenSpaceEventHandler(viewer.scene.canvas);
    this.handler.setInputAction((e: { position: Cartesian2 }) => this.click(e.position), ScreenSpaceEventType.LEFT_CLICK);
    this.handler.setInputAction((e: { endPosition: Cartesian2 }) => this.move(e.endPosition), ScreenSpaceEventType.MOUSE_MOVE);
    this.handler.setInputAction(() => this.finishPolygon(), ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
    this.handler.setInputAction(() => this.cancel(), ScreenSpaceEventType.RIGHT_CLICK);
    // Cesium's default double-click zooms to an entity, which fights polygon closing.
    viewer.screenSpaceEventHandler.removeInputAction(ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
  }

  destroy() {
    this.handler.destroy();
  }

  setTool(tool: DrawTool) {
    this.tool = tool;
    this.reset();
    this.globe.viewer.scene.canvas.style.cursor = tool === "none" ? "" : "crosshair";
  }

  /** Close the polygon from the keyboard (Enter), for users not using a mouse double-click. */
  finishPolygon() {
    if (this.tool !== "polygon") return;
    // A double-click also fires two single clicks on the same spot; drop the repeat.
    const unique = this.points.filter((p, i) => i === 0 || p[0] !== this.points[i - 1]?.[0] || p[1] !== this.points[i - 1]?.[1]);
    if (unique.length < MIN_POLYGON_VERTICES) return;
    const first = unique[0] as LonLat;
    this.onComplete({ type: "Polygon", coordinates: [[...unique, first]] });
    this.reset();
  }

  cancel() {
    this.reset();
  }

  private locate(position: Cartesian2): LonLat | null {
    const { scene, camera } = this.globe.viewer;
    const cartesian = camera.pickEllipsoid(position, scene.globe.ellipsoid);
    if (!defined(cartesian)) return null;
    const c = Cartographic.fromCartesian(cartesian);
    return [CesiumMath.toDegrees(c.longitude), CesiumMath.toDegrees(c.latitude)];
  }

  private click(position: Cartesian2) {
    if (this.tool === "none") {
      const picked = this.globe.viewer.scene.pick(position);
      const entity = picked?.id instanceof Entity ? picked.id : null;
      this.onPick(entity?.properties?.direction ? String(entity.id) : null);
      return;
    }
    const point = this.locate(position);
    if (!point) return;
    this.points.push(point);
    if (this.tool === "rectangle" && this.points.length === 2) {
      const [a, b] = this.points as [LonLat, LonLat];
      const west = Math.min(a[0], b[0]), east = Math.max(a[0], b[0]);
      const south = Math.min(a[1], b[1]), north = Math.max(a[1], b[1]);
      if (east > west && north > south) this.onComplete(rectangleAoi(west, south, east, north));
      this.reset();
      return;
    }
    this.ensureDraft();
  }

  private move(position: Cartesian2) {
    if (this.tool === "none" || this.points.length === 0) return;
    this.cursor = this.locate(position);
    this.globe.viewer.scene.requestRender();
  }

  private outline(): LonLat[] {
    const live = this.cursor ? [...this.points, this.cursor] : this.points;
    if (this.tool === "rectangle" && live.length === 2) {
      const [a, b] = live as [LonLat, LonLat];
      return [a, [b[0], a[1]], b, [a[0], b[1]]];
    }
    return live;
  }

  private ensureDraft() {
    if (this.draft) return;
    const positions = () => this.outline().map(([lon, lat]) => Cartesian3.fromDegrees(lon, lat));
    this.draft = this.globe.viewer.entities.add({
      polygon: {
        hierarchy: new CallbackProperty(() => new PolygonHierarchy(positions()), false),
        material: DRAFT.withAlpha(0.15),
      },
      polyline: {
        positions: new CallbackProperty(() => {
          const ring = positions();
          return ring.length > 2 ? [...ring, ring[0] as Cartesian3] : ring;
        }, false),
        width: 2,
        material: DRAFT,
        clampToGround: true,
      },
    });
  }

  private reset() {
    this.points = [];
    this.cursor = null;
    if (this.draft) this.globe.viewer.entities.remove(this.draft);
    this.draft = null;
    this.globe.viewer.scene.requestRender();
  }
}
