# Globe enhancement goals

Worked through in order. A goal is ticked only when it runs on a production
build with no console errors, and each one is a separate commit.

Every source must be keyless and readable from a browser (CORS), because the
site is static: a key in the page would be public. That rules out
OpenWeatherMap, WAQI and OpenAQ v3.

## 1. Repair the first attempt
- [x] Remove the cloud, weather and pollution layers that could not load:
      OpenWeatherMap URLs with an unfilled `{key}`, and CIRA slider tiles
      that refuse cross-site requests and are not in map projection. The
      cloud layer fired those requests on every page load, even when off.
- [x] Day-and-night shading off by default: it darkened the imagery people
      analyse.
- [x] Top bar back to one row (legal pages stay in the footer).
- [x] Drop the cookie banner: nothing is stored without the visitor saving
      it, so there is nothing to consent to, and it covered the welcome card.
- [x] Legal pages: open from the footer and from `?legal=privacy|cookies|terms`
      (the dialog never opened before), real storage keys, every outside
      service listed.

## 2. Real clouds
- [x] EUMETSAT world cloud map (all geostationary satellites, every 3 h)
      as a cloud shell above the globe.
- [x] Toggle in the Layers panel and on a key.
- [x] The past 24 hours animated.
- [x] Clouds fade as the camera descends, so zooming to an area passes
      through them.

## 3. Fly in with imagery
- [x] When an area is chosen, use Sentinel-2 (10 m) for small areas and
      Landsat (30 m) for large ones.
- [x] Show that imagery is loading while tiles arrive.

## 4. Air pollution hotspots
- [ ] Current air quality (CAMS through Open-Meteo) at major cities, coloured
      by US AQI band, with values on click.

## 5. Weather
- [ ] NASA IMERG rain rate (global, every 30 minutes) as an animated layer.
