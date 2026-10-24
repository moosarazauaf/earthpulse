# EarthPulse Globe Enhancement Plan

## Overview
Transform EarthPulse's globe into a sophisticated, data-rich visualization platform with smart navigation, weather/cloud layers, air pollution, and smooth transitions.

---

## Goal 1: Smart Region-of-Interest Navigation with Progressive Data Loading
**Objective**: When user selects a region, zoom smoothly while progressively loading Landsat/Sentinel-2 data at appropriate resolutions.

### Sub-goals:
1.1 **Smart Fly-To with Data Preloading**
- Detect when AOI is set (via click, search, or saved place)
- Calculate optimal zoom level and resolution for the AOI
- Start loading imagery tiles for target zoom level during flight
- Show loading indicator during transition

1.2 **Multi-Resolution Imagery Pipeline**
- Implement LOD (Level of Detail) system: coarse global → regional → local
- Load lower-res tiles first for immediate feedback, then higher-res
- Use Cesium's `UrlTemplateImageryProvider` with `maximumLevel` per zoom

1.3 **Imagery Loading States**
- Add loading spinner/progress in TopBar during imagery fetch
- Graceful fallback if tiles fail (show basemap)
- Cache recently viewed regions

---

## Goal 2: Animated Cloud Layer with Toggle
**Objective**: Realistic animated cloud cover over the globe with on/off toggle and smooth transitions.

### Sub-goals:
2.1 **Cloud Data Source Integration**
- Integrate NOAA GOES / EUMETSAT / Himawari real-time cloud data
- Use WMS or tile service for cloud imagery (e.g., NOAA's cloud tiles)
- Cache cloud tiles locally for smooth animation

2.2 **Cloud Animation System**
- Time-based cloud movement using wind data (optional: static loop)
- Smooth cross-fade between cloud frames (30-min intervals)
- Respect `prefers-reduced-motion`

2.3 **Cloud Toggle UI**
- Add cloud toggle button in TopBar (next to measure/analyse)
- Keyboard shortcut (e.g., `C` for clouds)
- Show cloud opacity slider in Layer Panel

2.4 **Smooth Cloud Transition on Zoom**
- When zooming into AOI: fade out global clouds, fade in local high-res clouds
- Use Cesium's `ImageryLayer` alpha animation
- Maintain cloud continuity during flight

---

## Goal 3: Weather Layer Integration
**Objective**: Add weather visualization (temperature, precipitation, wind) as toggleable globe layers.

### Sub-goals:
3.1 **Weather Data Sources**
- Open-Meteo API (free, no key) for current + forecast
- ERA5 reanalysis for historical
- NOAA GFS for global forecast tiles

3.2 **Weather Layer Types**
- Temperature (2m, color ramp)
- Precipitation rate (radar-style)
- Wind vectors (animated particles or barbs)
- Pressure contours

3.3 **Weather UI**
- Weather tab in Layer Panel
- Time slider for forecast hours
- Unit toggle (°C/°F, mm/in, m/s/mph)

3.4 **Weather + Clouds Sync**
- Show clouds and precipitation together
- Cloud opacity adapts to precipitation intensity

---

## Goal 4: Air Pollution Hotspots
**Objective**: Visualize air quality (PM2.5, NO2, O3, CO, SO2) as interactive globe layer.

### Sub-goals:
4.1 **Air Quality Data Sources**
- CAMS (Copernicus Atmosphere Monitoring Service) - global reanalysis/forecast
- OpenAQ for ground station data
- Sentinel-5P TROPOMI for NO2, SO2, CO, HCHO, O3

4.2 **Pollution Visualization**
- Heatmap overlay for PM2.5 (AQI color scale)
- Animated NO2 plumes from Sentinel-5P
- Hotspot markers for exceedance areas
- Time series on click (last 7/30 days)

4.3 **Pollution UI**
- Air Quality tab in Layer Panel / Area Overview
- AQI legend with health categories
- Export pollution data as CSV

---

## Goal 5: Enhanced Globe Experience & Polish
**Objective**: Smooth transitions, performance, and delightful interactions.

### Sub-goals:
5.1 **Smooth Zoom Transitions**
- Flight easing curves optimized for data loading
- Cross-fade between imagery layers during zoom
- Maintain 60fps during transitions

5.2 **Performance Optimizations**
- Tile request prioritization (viewport-first)
- Memory management for imagery layers
- WebGL context loss recovery

5.3 **Atmosphere & Lighting Enhancements**
- Improved sky atmosphere with time-of-day
- Sun position based on current time
- Shadows on terrain (if Cesium ion token available)

5.4 **Keyboard Shortcuts**
- `C` - Toggle clouds
- `W` - Toggle weather
- `A` - Toggle air quality
- `Shift+C` - Cloud opacity slider

---

## Goal 6: Backend Enhancements (Python/Rust)
**Objective**: Add server-side processing for weather, clouds, and pollution data.

### Sub-goals:
6.1 **Python Weather Service**
- FastAPI service for Open-Meteo proxy + caching
- Cloud tile generation from GOES/EUMETSAT
- Sentinel-5P data preprocessing

6.2 **Rust High-Performance Tile Server** (optional)
- Serve pre-rendered weather/cloud tiles
- Vector tile support for pollution contours

---

## Implementation Order
1. **Goal 1** - Smart navigation (foundation for everything)
2. **Goal 2** - Cloud layer (visual enhancement)
3. **Goal 3** - Weather layers (data layers)
4. **Goal 4** - Air pollution (data layers)
5. **Goal 5** - Polish & performance
6. **Goal 6** - Backend services (if needed)

---

## Technical Notes

### Cloud Data Sources (Free)
- **NOAA GOES**: `https://cdn.star.nesdis.noaa.gov/GOES16/ABI/FD/GEOCOLOR/` (tiles)
- **EUMETSAT**: WMS for MSG satellites
- **Open-Meteo**: Cloud cover % as gridded data
- **NASA Worldview**: GIBS WMS for MODIS/VIIRS clouds

### Weather Data Sources (Free)
- **Open-Meteo**: `https://api.open-meteo.com/v1/forecast` - current + 7-day forecast
- **Open-Meteo Historical**: `https://archive-api.open-meteo.com/v1/archive`
- **NOAA GFS**: Tile service for global forecast

### Air Quality Sources (Free)
- **CAMS**: `https://atmosphere.copernicus.eu/api` (requires registration)
- **OpenAQ**: `https://api.openaq.org/v2/` - ground stations
- **Sentinel-5P**: Via Google Earth Engine or AWS (pre-processed)

### Cesium Integration Points
- `ImageryLayer` for all raster overlays
- `ImageryLayerCollection` for layer ordering
- `scene.globe.showGroundAtmosphere` for atmosphere
- `scene.skyAtmosphere` for sky
- `scene.fog` for distance fog
- Custom shaders for animated clouds/particles

---

## File Structure Changes

### New Files:
```
frontend/src/globe/
├── CloudLayer.ts          # Cloud imagery provider + animation
├── WeatherLayer.ts        # Weather data + visualization
├── PollutionLayer.ts      # Air quality visualization
├── GlobeEffects.ts        # Atmosphere, lighting, transitions
└── index.ts               # Exports

frontend/src/ui/
├── CloudToggle.tsx        # Cloud on/off + opacity
├── WeatherPanel.tsx       # Weather controls in Layer Panel
├── PollutionPanel.tsx     # Air quality controls
└── GlobeControls.tsx      # Unified globe controls

frontend/src/weather/      # Weather data fetching
├── openMeteo.ts
├── cloudTiles.ts
└── index.ts

frontend/src/pollution/    # Air quality data
├── cam.ts
├── openAq.ts
├── sentinel5p.ts
└── index.ts
```

### Modified Files:
- `Globe.ts` - Add cloud/weather/pollution layer management
- `GlobeViewer.tsx` - Wire up new layers
- `TopBar.tsx` - Add cloud/weather/pollution toggles
- `LayerPanel.tsx` - Add weather/pollution tabs
- `store.ts` - Add cloud/weather/pollution state
- `styles.css` - New UI styles