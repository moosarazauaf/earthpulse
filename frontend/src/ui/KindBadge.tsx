import type { ValueKind } from "../app/types";

const MEANING: Record<ValueKind, string> = {
  OBSERVED: "Measured by the satellite sensor",
  DERIVED: "Computed from observations by a stated method",
  MODELED: "Output of a model, not a measurement",
  ESTIMATED: "An estimate with stated assumptions",
  SIMULATED: "Synthetic demo data, not satellite observations",
};

/** Says what kind of value this is. Text, not colour alone, carries the meaning. */
export function KindBadge({ kind }: { kind: ValueKind }) {
  return (
    <span className={`kind kind-${kind.toLowerCase()}`} title={MEANING[kind]}>
      {kind}
    </span>
  );
}
