/**
 * The analyses, described by the question each one answers. The top bar's
 * Analyse menu and the opening card both list them, so a newcomer chooses
 * by question rather than by method name.
 */
export const ANALYSES = [
  { id: "floods", label: "Floods", question: "Where did flood water spread?", detail: "Sentinel-1 radar, which sees through cloud" },
  { id: "fires", label: "Fires", question: "How badly did the land burn?", detail: "Burn severity from Sentinel-2 or Landsat" },
  { id: "water", label: "Water", question: "How have lakes and rivers changed?", detail: "Yearly water maps, back to 1984" },
  { id: "cities", label: "Cities", question: "Where did a city grow, and onto what?", detail: "Built-up land from 2017 to 2023" },
  { id: "forests", label: "Forests", question: "Where was tree cover lost or gained?", detail: "Tree cover 2017 to 2023, and canopy loss since 1985 from Landsat" },
  { id: "heat", label: "Heat", question: "How hot does the ground get in summer?", detail: "Landsat surface temperature, and how much cooler green areas are" },
  { id: "change", label: "Change", question: "Where did vegetation, water or building change?", detail: "Spectral indices between two years" },
  { id: "classify", label: "Classify", question: "Can I map land cover with my own training samples?", detail: "Random forest on Sentinel-2 or Landsat, with an accuracy assessment" },
  { id: "research", label: "Research", question: "How have vegetation and water indices moved over the years?", detail: "Index series over up to 12 years, and the evidence behind any result" },
] as const;

export type AnalysisMode = (typeof ANALYSES)[number]["id"];
