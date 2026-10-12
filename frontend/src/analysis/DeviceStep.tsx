/** The "your device" step shared by every analysis that runs in the browser. */
import { useMemo, useState } from "react";

import { useStore } from "../app/store";
import { type DeviceProfile, PIXEL_BUDGET, type Quality, deviceProfile } from "../engine/client";
import { buildGrid, projectAoi } from "../engine/geo";

const QUALITIES: { id: Quality; label: string }[] = [
  { id: "fast", label: "Fast" },
  { id: "balanced", label: "Balanced" },
  { id: "detailed", label: "Detailed" },
];

/** Device profile and the chosen quality, kept by the form that owns the run. */
export function useDevice(): { device: DeviceProfile; quality: Quality; setQuality: (q: Quality) => void } {
  const device = useMemo(deviceProfile, []);
  const [quality, setQuality] = useState<Quality>(device.recommended);
  return { device, quality, setQuality };
}

export function DeviceStep({ step, device, quality, setQuality, nativeRes, sensor }: {
  step: number;
  device: DeviceProfile;
  quality: Quality;
  setQuality: (q: Quality) => void;
  nativeRes: number;
  sensor: string;
}) {
  const aoi = useStore((s) => s.aoi);
  // The same grid the engine will build, so the figure shown is the one that will be used.
  const resolution = useMemo(
    () => (aoi ? buildGrid(projectAoi(aoi.geometry), nativeRes, PIXEL_BUDGET[quality]).res : null),
    [aoi, nativeRes, quality],
  );
  return (
    <section>
      <h3>{step}. Your device</h3>
      <p>
        This analysis runs in your browser, on this computer: {device.cores} processor threads
        {device.memoryGb ? `, about ${device.memoryGb} GB of memory reported` : ", memory not reported by this browser"}.
      </p>
      <div className="seg" role="radiogroup" aria-label="Quality">
        {QUALITIES.map((q) => (
          <button key={q.id} role="radio" aria-checked={quality === q.id} className={quality === q.id ? "on" : ""} onClick={() => setQuality(q.id)}>
            {q.label}{q.id === device.recommended ? " · suggested" : ""}
          </button>
        ))}
      </div>
      <p className="muted">
        {resolution ? `For this area, ${quality} works at ${resolution} m (${sensor}, ${nativeRes} m native). ` : ""}
        Higher quality downloads more data and needs more memory. Nothing is sent to an EarthPulse server.
      </p>
    </section>
  );
}
