/** The district of the place picked in search: its name, and analysing or downloading its outline. */
import { downloadText } from "../analysis/download";
import { useStore } from "../app/store";

export function DistrictCard() {
  const district = useStore((s) => s.district);
  const set = useStore((s) => s.set);
  const setAoi = useStore((s) => s.setAoi);
  if (!district) return null;
  const label = `${district.name}, ${district.admin1}`;

  function download() {
    const feature = {
      type: "Feature",
      properties: { name: district!.name, admin1: district!.admin1, country: district!.country, gaul2_code: district!.code, source: "FAO GAUL 2024 (CC BY 4.0), simplified to about 500 m by EarthPulse" },
      geometry: district!.geometry,
    };
    downloadText(`${district!.name.replace(/[^\w-]+/g, "_")}-district.geojson`, "application/geo+json", JSON.stringify({ type: "FeatureCollection", features: [feature] }));
  }

  return (
    <section className="district-card" aria-label="District">
      <div className="row">
        <p><strong>{district.name} district</strong> · {district.admin1}, {district.country}</p>
        <button className="ghost" aria-label="Hide the district outline" onClick={() => set({ district: null })}>×</button>
      </div>
      <div className="row-actions">
        <button className="primary" onClick={() => {
          setAoi({ geometry: district.geometry, label });
          set({ district: null, mode: "area", result: null, introOpen: false });
        }}>Analyse this district</button>
        <button onClick={download}>Download outline (GeoJSON)</button>
      </div>
      <p className="muted">Boundary from FAO GAUL 2024 (CC BY 4.0), simplified to about 500 m. Not an official depiction of borders.</p>
    </section>
  );
}
