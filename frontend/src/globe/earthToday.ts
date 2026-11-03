/**
 * Daily global views of the environment from NASA GIBS, one at a time: each is
 * the latest date GIBS has, with a legend sampled from its published colour map.
 */
export interface EarthLayer {
  id: string;
  label: string;
  /** GIBS layer identifier and the finest GoogleMapsCompatible level it is published at. */
  gibs: string;
  level: number;
  credit: string;
  /** CSS gradient stops, placed by value, from GIBS's colour map. */
  stops: string;
  scale: string[];
  note: string;
}

export const EARTH_LAYERS: EarthLayer[] = [
  {
    id: "sst", label: "Sea temperature", gibs: "GHRSST_L4_MUR_Sea_Surface_Temperature", level: 7, credit: "NASA JPL MUR SST via GIBS",
    stops: "rgb(43,0,26), rgb(94,8,105) 16.7%, rgb(31,55,130) 33.3%, rgb(46,163,239) 50%, rgb(219,243,0) 66.7%, rgb(242,95,0) 83.3%, rgb(107,2,0)",
    scale: ["0", "8", "16", "24", "32+ °C"],
    note: "NASA JPL Multi-scale Ultra-high Resolution (MUR) analysis, a day or two behind: satellite and buoy readings blended into a gap-free map, so cloudy spots are filled in by the model.",
  },
  {
    id: "ndvi", label: "Vegetation", gibs: "MODIS_Terra_NDVI_8Day", level: 9, credit: "NASA MODIS Terra NDVI via GIBS",
    stops: "rgb(241,236,236), rgb(215,196,180) 11.5%, rgb(172,141,115) 23%, rgb(150,186,32) 37.5%, rgb(78,148,1) 55%, rgb(10,105,0) 76%, rgb(0,24,1)",
    scale: ["0 bare", "0.5", "1 dense"],
    note: "Normalized Difference Vegetation Index from MODIS on Terra, the best cloud-free reading over the past 8 days, about 250 m. Higher means more green leaf; water and cloud are left blank.",
  },
  {
    id: "soil", label: "Soil moisture", gibs: "SMAP_L4_Analyzed_Surface_Soil_Moisture", level: 6, credit: "NASA SMAP L4 via GIBS",
    stops: "rgb(255,162,0), rgb(255,254,0) 16.7%, rgb(0,130,0) 33.3%, rgb(0,255,255) 50%, rgb(0,12,255) 66.7%, rgb(0,0,107) 83.3%, rgb(80,80,80)",
    scale: ["0 dry", "0.35", "0.7 m³/m³ wet"],
    note: "Water in the top 5 cm of soil from NASA's SMAP Level 4 analysis, about 9 km: radiometer readings merged into a land model, so it is modelled where the satellite did not pass. A few days behind.",
  },
  {
    id: "aerosol", label: "Smoke and dust", gibs: "MODIS_Combined_Value_Added_AOD", level: 6, credit: "NASA MODIS Aqua and Terra AOD via GIBS",
    stops: "rgb(255,253,205), rgb(255,223,108) 16.7%, rgb(255,175,54) 33.3%, rgb(255,112,30) 50%, rgb(245,40,16) 66.7%, rgb(199,3,13) 83.3%, rgb(125,0,14)",
    scale: ["0 clear", "0.375", "0.75+ hazy"],
    note: "Aerosol optical depth from MODIS on Aqua and Terra, latest day: how much smoke, dust and haze dims sunlight through the whole air column. Not ground-level air quality; blank under cloud and over bright desert.",
  },
  {
    id: "ozone", label: "Ozone", gibs: "OMPS_Ozone_Total_Column", level: 6, credit: "NASA OMPS Suomi NPP via GIBS",
    stops: "rgb(94,79,162), rgb(107,196,164) 16.7%, rgb(182,226,161) 33.3%, rgb(237,238,147) 50%, rgb(253,203,121) 66.7%, rgb(247,138,80) 83.3%, rgb(158,1,66)",
    scale: ["100", "300", "500 DU"],
    note: "Total ozone in the air column from OMPS on Suomi NPP, latest day, in Dobson units. Below about 220 DU is what is called an ozone hole; the instrument needs sunlight, so polar night is blank.",
  },
];

export const earthLayer = (id: string | null) => EARTH_LAYERS.find((l) => l.id === id) ?? null;
