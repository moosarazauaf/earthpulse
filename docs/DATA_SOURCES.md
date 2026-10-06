# Data sources

Everything EarthPulse shows or computes comes from the sources below. The same
information is served by `GET /api/datasets` and shown in the application
under **Layers → Data sources**. Access date for this version: 2026-10-06.

## Satellite archives used for analysis

### Landsat Collection 2 Level-2

| | |
|---|---|
| Provider | USGS / NASA |
| Sensors used | Landsat 4-5 TM, Landsat 7 ETM+, Landsat 8-9 OLI |
| Processing level | Level-2 surface reflectance |
| Resolution | 30 m |
| Coverage | 1982 to present |
| License | Public domain |
| Attribution | Landsat imagery courtesy of the U.S. Geological Survey |
| Reference | https://www.usgs.gov/landsat-missions/landsat-collection-2-level-2-science-products |
| Scaling | reflectance = DN × 0.0000275 − 0.2; DN 0 is fill |
| Pixel mask | `QA_PIXEL` bits 0-5 rejected: fill, dilated cloud, cirrus, cloud, cloud shadow, snow |

Platform rule by year: 4/5 before 1999; 5 and 7 for 1999-2002; 5 only for
2003-2011 (Landsat 7 scenes after the 2003-05-31 scan-line corrector failure
are striped); 7 for 2012, with a warning; 8 and 9 from 2013.

### Sentinel-2 Level-2A

| | |
|---|---|
| Provider | ESA / Copernicus |
| Processing level | Level-2A surface reflectance |
| Resolution | 10 m (visible, NIR), 20 m (SWIR, scene classification) |
| Coverage | 2015 to present; EarthPulse offers it from 2016 |
| License | Copernicus Sentinel data terms (free, full and open) |
| Attribution | Contains modified Copernicus Sentinel data |
| Reference | https://sentinels.copernicus.eu/web/sentinel/user-guides/sentinel-2-msi |
| Scaling | reflectance = (DN + offset) / 10000; offset is −1000 from processing baseline 04.00 (2022-01-25), 0 before |
| Pixel mask | `SCL` classes 0, 1, 3, 8, 9, 10, 11 rejected |

## Access

**Microsoft Planetary Computer** (https://planetarycomputer.microsoft.com/).
Public STAC API and cloud-optimised GeoTIFFs in Azure storage. No account is
required. EarthPulse uses its STAC search, its token endpoint for read access
to the files, and its mosaic tile service for the annual map layers.

## Spectral indices

| Index | Formula | Reference |
|---|---|---|
| NDVI | (NIR − Red) / (NIR + Red) | Rouse et al. 1974; Tucker 1979 |
| NDWI | (Green − NIR) / (Green + NIR) | McFeeters 1996 |
| MNDWI | (Green − SWIR1) / (Green + SWIR1) | Xu 2006 |
| NDBI | (SWIR1 − NIR) / (SWIR1 + NIR) | Zha, Gao and Ni 2003 |

NDBI responds to bare soil as well as built-up surfaces. EarthPulse reports it
as an index and does not call a rise in it "urban expansion".

## Context layers (not used in any calculation)

| Layer | Source | Terms |
|---|---|---|
| Basemap imagery | Esri World Imagery | Esri Master License Agreement; attribution shown on the globe |
| Place names and boundaries | Esri World Boundaries and Places | as above |
| Place search | OpenStreetMap Nominatim | © OpenStreetMap contributors, ODbL; requests are cached and rate limited per the Nominatim usage policy |
| Lahore District boundary | geoBoundaries gbOpen, PAK ADM2 (simplified), release 9469f09 | Public domain; represents 2019 |

The basemap is a mosaic of many acquisition dates. It gives context and is
never presented as evidence for a date. The boundary used for international
borders in the label layer is Esri's and implies no position on any border.

## Synthetic data

The `demo` provider generates a uniform vegetated scene in which a central
block becomes built-up from 2010. It exists so tests have a known answer and
the application can run offline. Results from it carry the label `SIMULATED`
and cannot be exported as an Earth Engine script.
