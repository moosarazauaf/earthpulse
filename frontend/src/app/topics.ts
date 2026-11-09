/**
 * One page per thing people search for (a wind map, a soil moisture map…).
 * At build time each becomes /<slug>/index.html with its own title, description
 * and text for search engines (see vite.config.ts); in the browser the same
 * app opens with that layer already on.
 */
export const SITE = "https://moosarazauaf.github.io/earthpulse/";

export interface Topic {
  slug: string;
  /** Under 60 characters: the page title in search results. */
  title: string;
  /** Under 160 characters: the snippet under it. */
  description: string;
  h1: string;
  intro: string;
  points: string[];
  /** Store fields set when the page opens. */
  preset: Record<string, unknown>;
}

export const TOPICS: Topic[] = [
  {
    slug: "wind-map",
    title: "Live Wind Map of the World, Animated | EarthPulse",
    description: "Free animated wind map: surface wind speed and direction worldwide, updated from weather models, on a 3D globe in your browser. No account.",
    h1: "Live wind map of the world",
    intro: "Watch the wind blowing across the planet right now. Particles drift with the current 10 m wind from Open-Meteo's weather models and are coloured by speed, from calm to gale.",
    points: ["Wind speed and direction now, worldwide between 60° S and 70° N", "Animated flow on a 3D globe you can spin and zoom", "Combine with clouds, rain and air quality layers"],
    preset: { windOn: true },
  },
  {
    slug: "sea-surface-temperature-map",
    title: "Sea Surface Temperature Map, Daily | EarthPulse",
    description: "Free daily sea surface temperature map of the world's oceans from NASA JPL MUR satellite analysis, on an interactive 3D globe.",
    h1: "Sea surface temperature map",
    intro: "See how warm the oceans are today. The NASA JPL Multi-scale Ultra-high Resolution (MUR) analysis blends satellite and buoy readings into a gap-free daily map, shown from 0 to 32 °C.",
    points: ["Latest daily ocean temperature, about a day or two behind", "Spot marine heatwaves, warm currents and upwelling", "Legend and source notes alongside the map"],
    preset: { earthLayer: "sst" },
  },
  {
    slug: "vegetation-ndvi-map",
    title: "NDVI Vegetation Map of the World | EarthPulse",
    description: "Free global NDVI vegetation map from NASA MODIS, updated every 8 days, plus Landsat and Sentinel-2 NDVI for any place since 1984. In your browser.",
    h1: "Global NDVI vegetation map",
    intro: "How green is the land right now? The Normalized Difference Vegetation Index from NASA's MODIS shows leafy vegetation worldwide at about 250 m, from the best cloud-free view of the past 8 days.",
    points: ["Global NDVI, rolling 8-day composite from MODIS Terra", "Zoom into any place for Landsat (since 1984) and Sentinel-2 NDVI year by year", "Track drought, crop seasons and forest loss"],
    preset: { earthLayer: "ndvi" },
  },
  {
    slug: "soil-moisture-map",
    title: "Soil Moisture Map, Global and Daily | EarthPulse",
    description: "Free global soil moisture map from NASA SMAP: water in the top 5 cm of soil, updated daily, to follow drought and wet spells on a 3D globe.",
    h1: "Global soil moisture map",
    intro: "Where is the ground dry and where is it soaked? NASA's SMAP Level 4 analysis merges satellite radiometer readings into a land model to map water in the top 5 cm of soil at about 9 km.",
    points: ["Surface soil moisture worldwide, a few days behind", "Follow drought, irrigation and wet seasons", "Compare with rainfall against the 1991 to 2020 normal for any area"],
    preset: { earthLayer: "soil" },
  },
  {
    slug: "smoke-dust-aerosol-map",
    title: "Smoke and Dust Map: Aerosol Optical Depth | EarthPulse",
    description: "Free daily smoke, dust and haze map from NASA MODIS aerosol optical depth, with air quality at major cities, on a 3D globe.",
    h1: "Smoke and dust map",
    intro: "Follow wildfire smoke, desert dust storms and haze from space. Aerosol optical depth from NASA's MODIS on Aqua and Terra shows how much the air dims sunlight, every day.",
    points: ["Daily aerosol optical depth worldwide", "Air quality index at the 300 largest cities and every capital", "Clouds and wind layers to see where it is heading"],
    preset: { earthLayer: "aerosol", airOn: true },
  },
  {
    slug: "ozone-map",
    title: "Ozone Layer Map, Daily Total Ozone | EarthPulse",
    description: "Free daily map of total column ozone from NASA OMPS on Suomi NPP, in Dobson units, to watch the ozone hole on a 3D globe.",
    h1: "Ozone layer map",
    intro: "Watch the ozone layer day by day. NASA's OMPS instrument on Suomi NPP measures the total ozone above each point in Dobson units; below about 220 DU is called an ozone hole.",
    points: ["Total column ozone, latest day", "See the Antarctic ozone hole in southern spring", "Legend in Dobson units with source notes"],
    preset: { earthLayer: "ozone" },
  },
  {
    slug: "air-quality-map",
    title: "Air Quality Map of World Cities, Live | EarthPulse",
    description: "Free live air quality map: AQI, PM2.5 and PM10 for the world's largest cities and every capital, with smoke and dust from NASA satellites.",
    h1: "Live air quality map",
    intro: "Check the air in cities around the world. The US air quality index, PM2.5 and PM10 come from the Copernicus Atmosphere Monitoring Service through Open-Meteo, for the 300 largest cities and every national capital.",
    points: ["AQI, PM2.5 and PM10 now, ranked worst first", "Air quality for any area you open", "Satellite smoke and dust layer for context"],
    preset: { airOn: true },
  },
  {
    slug: "rain-map",
    title: "Live Rain Map of the World, Past 3 Hours | EarthPulse",
    description: "Free live global rain and snow map from NASA GPM IMERG satellite precipitation, animated over the past 3 hours on a 3D globe.",
    h1: "Live rain map of the world",
    intro: "See where it is raining or snowing now, anywhere on Earth, including over oceans and places without weather radar. NASA's GPM IMERG estimates precipitation every half hour from a fleet of satellites.",
    points: ["Rain and snow over the past 3 hours, animated", "Global coverage, about 10 km", "Combine with clouds and wind"],
    preset: { rainOn: true },
  },
  {
    slug: "cloud-map",
    title: "Live Cloud Map, Past 24 Hours Animated | EarthPulse",
    description: "Free animated cloud map of the whole Earth from EUMETSAT infrared satellite imagery, the past 24 hours on a 3D globe.",
    h1: "Live cloud map of the world",
    intro: "Watch clouds move across the planet over the past day. EUMETSAT's infrared world cloud map, built from geostationary weather satellites, plays as a smooth animation on the globe.",
    points: ["Clouds over the past 24 hours, animated", "Infrared, so it works day and night", "Add rain and wind to follow storms"],
    preset: { cloudsOn: true },
  },
  {
    slug: "earthquake-map",
    title: "Earthquake Map, Past 7 Days, Live | EarthPulse",
    description: "Free live earthquake map: every M4.5+ earthquake of the past week from USGS, replayed in order, with people living nearby and tsunami flags.",
    h1: "Live earthquake map",
    intro: "Where has the ground shaken this week? Every earthquake of magnitude 4.5 and above from the USGS, on a 3D globe. Replay the week in the order they struck, and click one for depth, PAGER alert and how many people live nearby.",
    points: ["M4.5+ earthquakes of the past 7 days from USGS", "Replay the week in about 15 seconds", "People within 100 km from GHS-POP population data"],
    preset: { mode: "live", quakesOn: true },
  },
  {
    slug: "wildfire-map",
    title: "Live Wildfire Map, Active Fires from NASA | EarthPulse",
    description: "Free live wildfire map: active fires detected by NASA FIRMS satellites, fire danger forecasts and people near each fire, on a 3D globe.",
    h1: "Live wildfire map",
    intro: "See where fires are burning now. NASA FIRMS detects active fires with the VIIRS instrument on NOAA-20 at 375 m; EarthPulse maps them with fire danger forecasts, smoke and the number of people nearby.",
    points: ["Active fires detected by satellite yesterday", "Fire danger forecast from GWIS", "Burn severity analysis for any area with Sentinel-2"],
    preset: { mode: "live", hazardLayers: ["fires"] },
  },
  {
    slug: "flood-map",
    title: "Free Flood Map from Sentinel-1 Radar | EarthPulse",
    description: "Map floods anywhere for free with Sentinel-1 radar that sees through cloud, plus river flood forecasts and people affected. In your browser, no account.",
    h1: "Free flood mapping with Sentinel-1 radar",
    intro: "Map where floodwater is, even under cloud. EarthPulse compares Sentinel-1 radar images before and during a flood, shows land cover under the water and estimates how many people live in the flooded area.",
    points: ["Flood extent from Sentinel-1 radar, before and after", "GloFAS river flood forecasts and observed floods", "People affected from GHS-POP population data"],
    preset: { mode: "floods" },
  },
  {
    slug: "satellite-tracker",
    title: "Landsat and Sentinel Satellite Tracker, Live | EarthPulse",
    description: "Track Landsat 8 and 9, Sentinel-1 and Sentinel-2 live with orbits, and see when each next passes over any place. Free, in your browser.",
    h1: "Live Landsat and Sentinel satellite tracker",
    intro: "Where are the Earth-observation satellites right now? Landsat 8 and 9, Sentinel-2A, 2B and 2C and Sentinel-1A and 1C at their true height, with the next 90 minutes of orbit, from CelesTrak.",
    points: ["Live positions and orbits", "Next passes over any area you open", "Day and night shading"],
    preset: { satellitesOn: true },
  },
  {
    slug: "population-density-map",
    title: "Population Density Map of the World | EarthPulse",
    description: "Free world population density map from NASA SEDAC, and a people count for any area you draw from GHS-POP, checked against World Bank figures.",
    h1: "World population density map",
    intro: "How many people live here? The population density map from NASA SEDAC's Gridded Population of the World, and a count of people inside any area you draw, from the European Commission's GHS-POP.",
    points: ["Population density worldwide, about 1 km", "People count for any area or district", "Checked against World Bank country totals"],
    preset: { populationOn: true },
  },
  {
    slug: "carbon-stock-calculator",
    title: "Free Carbon Stock Calculator: Biomass and Soil | EarthPulse",
    description: "Estimate carbon stored in plants and soil for any area, with uncertainty ranges and a chart, from Harmonized Global Biomass and SoilGrids. Free, no account.",
    h1: "Free carbon stock calculator for any area",
    intro: "How much carbon does this land hold? Ask Sentri, the EarthPulse assistant, for any place: carbon in plants above and below ground from Harmonized Global Biomass, and in the top 30 cm of soil from SoilGrids 2.0, each with its uncertainty and the CO2 equivalent.",
    points: ["Biomass carbon with the published uncertainty", "Soil organic carbon to 30 cm with its 5% to 95% range", "Chart with error bars, ready for a paper as SVG or 300 dpi PNG"],
    preset: { agentOpen: true },
  },
  {
    slug: "land-cover-map",
    title: "Land Use and Land Cover (LULC) Map, Free | EarthPulse",
    description: "Free land use and land cover statistics for any area: hectares of trees, cropland, built-up and water from ESA WorldCover at 10 m, on a 3D globe.",
    h1: "Land use and land cover (LULC) for any area",
    intro: "What is this land used for? EarthPulse reads ESA WorldCover 2021 at 10 m for any area and gives the hectares and share of each class, drawn on the map, with a chart you can save for a report.",
    points: ["Hectares and share of trees, cropland, built-up, water and more", "Map overlay and a publication-ready chart", "Classify your own land cover with training samples and an accuracy assessment"],
    preset: { agentOpen: true },
  },
  {
    slug: "satellite-time-lapse",
    title: "Satellite Time-Lapse Maker, Landsat Since 1985 | EarthPulse",
    description: "Make a free satellite time-lapse video of any place from Landsat (1985 on) or Sentinel-2 imagery, in your browser, with years and sources stamped on each frame.",
    h1: "Make a satellite time-lapse of any place",
    intro: "Watch a city grow, a lake shrink or a river move. EarthPulse steps through up to 21 years of Landsat or Sentinel-2 imagery for the view you choose and records a video in your browser, each frame stamped with its year and source.",
    points: ["Landsat from 1985, Sentinel-2 from 2017", "Each frame taken only once its imagery has fully loaded", "MP4 recorded on your own computer, nothing uploaded"],
    preset: { agentOpen: true },
  },
];

/** The topic a page path ends in, if any: "/earthpulse/wind-map/" gives the wind map. */
export function topicForPath(path: string): Topic | null {
  const slug = path.replace(/\/+$/, "").split("/").pop();
  return TOPICS.find((t) => t.slug === slug) ?? null;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Links to every topic page, so search engines can follow them from the loading text. */
export function topicLinks(current?: string): string {
  const items = TOPICS.filter((t) => t.slug !== current).map((t) => `<li><a style="color: #a3b18a" href="${SITE}${t.slug}/">${esc(t.h1)}</a></li>`);
  return `<h2 style="color: #fff; font-size: 17px">More free maps</h2><ul>${items.join("")}</ul>`;
}

/** The built index.html rewritten for one topic: its own title, description, canonical URL and loading text. */
export function topicPage(html: string, t: Topic): string {
  const url = `${SITE}${t.slug}/`;
  const replace = (s: string, pattern: RegExp, value: string) => {
    if (!pattern.test(s)) throw new Error(`topic page: ${pattern} not found in index.html`);
    return s.replace(pattern, value);
  };
  let out = html;
  out = replace(out, /<title>[^<]*<\/title>/, `<title>${esc(t.title)}</title>`);
  out = replace(out, /(<meta name="description" content=")[^"]*/, `$1${esc(t.description)}`);
  out = replace(out, /(<link rel="canonical" href=")[^"]*/, `$1${url}`);
  out = replace(out, /(<meta property="og:title" content=")[^"]*/, `$1${esc(t.title)}`);
  out = replace(out, /(<meta property="og:description" content=")[^"]*/, `$1${esc(t.description)}`);
  out = replace(out, /(<meta property="og:url" content=")[^"]*/, `$1${url}`);
  out = replace(out, /(<main[^>]*>)[\s\S]*?(<\/main>)/, `$1<h1 style="color: #fff; font-size: 24px">${esc(t.h1)}</h1><p>${esc(t.intro)}</p><ul>${t.points.map((p) => `<li>${esc(p)}</li>`).join("")}</ul><p>Free and open source, from EarthPulse. Loading the globe… it needs JavaScript and WebGL. <a style="color: #a3b18a" href="${SITE}">EarthPulse home</a></p>${topicLinks(t.slug)}$2`);
  return out;
}

/** sitemap.xml for the home page and every topic page. */
export function sitemap(date: string): string {
  const urls = [SITE, ...TOPICS.map((t) => `${SITE}${t.slug}/`)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url><loc>${u}</loc><lastmod>${date}</lastmod></url>`).join("\n")}\n</urlset>\n`;
}
