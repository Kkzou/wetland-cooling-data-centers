// 00_check_assets.js
// Run this first in the Earth Engine Code Editor (code.earthengine.google.com).
// It does not export anything. It prints what the later scripts depend on, so we
// can fix asset paths or field names before running the long exports.
// Copy everything printed in the Console and send it back.

// ---- Study area: Northern Virginia core jurisdictions ------------------------
// Loudoun 107, Fairfax 059, Prince William 153, Arlington 013,
// Alexandria 510, Fairfax city 600, Falls Church 610, Manassas 683, Manassas Park 685
var NOVA_FIPS = ['107', '059', '153', '013', '510', '600', '610', '683', '685'];
var counties = ee.FeatureCollection('TIGER/2018/Counties')
  .filter(ee.Filter.eq('STATEFP', '51'))
  .filter(ee.Filter.inList('COUNTYFP', NOVA_FIPS));
var aoi = counties.geometry();
print('1. Jurisdictions found (expect 9):', counties.size());
print('   AOI area (km2):', aoi.area(100).divide(1e6));
Map.centerObject(counties, 9);
Map.addLayer(counties, {color: 'black'}, 'Northern Virginia');

// ---- NWI wetlands (GEE community catalog) ------------------------------------
var nwi = ee.FeatureCollection('projects/sat-io/open-datasets/NWI/wetlands/VA_Wetlands')
  .filterBounds(aoi);
print('2. NWI polygons in AOI:', nwi.size());
print('   NWI property names:', nwi.first().propertyNames());
print('   NWI first feature:', nwi.first());
print('   WETLAND_TYPE histogram:', nwi.aggregate_histogram('WETLAND_TYPE'));
Map.addLayer(nwi, {color: '2c7fb8'}, 'NWI wetlands');

// ---- Annual NLCD (GEE community catalog) -------------------------------------
var lc = ee.ImageCollection('projects/sat-io/open-datasets/USGS/ANNUAL_NLCD/LANDCOVER');
var imp = ee.ImageCollection('projects/sat-io/open-datasets/USGS/ANNUAL_NLCD/FRACTIONAL_IMPERVIOUS_SURFACE');
print('3. Annual NLCD land cover images:', lc.size());
print('   first land cover image:', lc.first());
print('   land cover years:', lc.aggregate_array('system:index'));
print('   impervious images:', imp.size());
print('   first impervious image:', imp.first());

// ---- Landsat 8/9 Collection 2 Level 2 summer scenes ------------------------
var l8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2');
var l9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2');
var summer = l8.merge(l9).filterBounds(aoi)
  .filter(ee.Filter.calendarRange(6, 8, 'month'))
  .filter(ee.Filter.calendarRange(2015, 2025, 'year'))
  .filter(ee.Filter.lt('CLOUD_COVER', 40));
print('4. Landsat 8/9 summer scenes 2015-2025, cloud < 40%:', summer.size());
print('   scenes per WRS path/row:', summer.aggregate_histogram('WRS_ROW'));

// ---- MODIS LST ------------------------------------------------------------------
var mod = ee.ImageCollection('MODIS/061/MOD11A2').filterDate('2015-01-01', '2027-01-01');
var myd = ee.ImageCollection('MODIS/061/MYD11A2').filterDate('2015-01-01', '2027-01-01');
print('5. MODIS Terra / Aqua 8-day images:', mod.size(), myd.size());
print('   last MODIS Terra date:', ee.Date(mod.aggregate_max('system:time_start')));

// ---- ERA5-Land hourly -------------------------------------------------------------
var era = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY').filterDate('2025-01-01', '2027-01-01');
print('6. ERA5-Land last hour available:', ee.Date(era.aggregate_max('system:time_start')));

// ---- Other layers -------------------------------------------------------------------
print('7. 3DEP 10 m bands:', ee.Image('USGS/3DEP/10m').bandNames());
print('8. JRC surface water bands:', ee.Image('JRC/GSW1_4/GlobalSurfaceWater').bandNames());
