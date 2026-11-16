// 01_landsat_wetland_cooling.js
// Study 1 (fine scale): how much and how far each wetland patch in Northern
// Virginia cools its surroundings in summer daytime, from Landsat 8/9 surface
// temperature at 30 m, 2015-2025.
//
// Exports (Google Drive folder EXPORT_FOLDER), each as a Task you click "Run" on:
//   A. nova_patches.csv       one row per wetland patch: size, shape, class mix,
//                             mean LST inside the patch
//   B. nova_patch_rings.csv   one row per patch x distance ring (0-1200 m): mean
//                             LST, LST anomaly, NDVI, impervious, elevation, pixel
//                             count. Wetland and open-water pixels are excluded
//                             from rings so only dry land is measured.
//   C. nova_pixel_sample.csv  random sample of 30 m pixels with LST and
//                             covariates, for matched / regression analysis
//   D. nova_lst_summer.tif    the summer LST anomaly composite (for maps)
//
// Run 00_check_assets.js first. If it showed a different NWI field name than
// WETLAND_TYPE, or an Annual NLCD naming without the year, edit CONFIG below.

// ============================== CONFIG ========================================
var EXPORT_FOLDER = 'nova_wetland_cooling';
var YEAR_START = 2015, YEAR_END = 2025;   // summers included
var MONTH_START = 6, MONTH_END = 8;       // June-August
var MAX_CLOUD = 40;                       // scene-level cloud cover filter (%)
var MIN_CLEAR_FRACTION = 0.5;             // keep scenes with >= 50% clear land in AOI
var MIN_PATCH_HA = 1;                     // smallest wetland patch analysed
var NLCD_YEAR = '2021';                   // impervious-surface year (mid-period)
var PIXEL_SAMPLE_N = 300000;
var CRS = 'EPSG:32618';                   // UTM 18N, Landsat native grid
var SCALE = 30;
var NWI_TYPE_FIELD = 'WETLAND_TYPE';
var VEG_WETLAND = ['Freshwater Emergent Wetland', 'Freshwater Forested/Shrub Wetland',
                   'Estuarine and Marine Wetland'];
var OPEN_WATER = ['Freshwater Pond', 'Lake', 'Riverine', 'Estuarine and Marine Deepwater'];
// distance rings around each patch, metres: [inner, outer]
var RINGS = [];
for (var d = 0; d < 600; d += 30) RINGS.push([d, d + 30]);
for (var d2 = 600; d2 < 1200; d2 += 60) RINGS.push([d2, d2 + 60]);

// ============================== STUDY AREA ====================================
var NOVA_FIPS = ['107', '059', '153', '013', '510', '600', '610', '683', '685'];
var counties = ee.FeatureCollection('TIGER/2018/Counties')
  .filter(ee.Filter.eq('STATEFP', '51'))
  .filter(ee.Filter.inList('COUNTYFP', NOVA_FIPS));
var aoi = counties.geometry();
// rings near the AOI edge extend 1.2 km beyond it
var aoiPlus = aoi.buffer(1500, 100);

// ============================== WETLAND AND WATER MASKS =======================
var nwi = ee.FeatureCollection('projects/sat-io/open-datasets/NWI/wetlands/VA_Wetlands')
  .filterBounds(aoiPlus);
var classCode = function (f) {
  var t = ee.String(f.get(NWI_TYPE_FIELD));
  var code = ee.Algorithms.If(t.equals('Freshwater Emergent Wetland'), 1,
             ee.Algorithms.If(t.equals('Freshwater Forested/Shrub Wetland'), 2,
             ee.Algorithms.If(t.equals('Estuarine and Marine Wetland'), 3, 0)));
  return f.set('cls', code);
};
var vegFC = nwi.filter(ee.Filter.inList(NWI_TYPE_FIELD, VEG_WETLAND)).map(classCode);
var waterFC = nwi.filter(ee.Filter.inList(NWI_TYPE_FIELD, OPEN_WATER));

var nwiWater = ee.Image(0).byte().paint(waterFC, 1);
var jrcWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence')
  .unmask(0).gte(50);
var water = nwiWater.or(jrcWater).reproject(CRS, null, SCALE).rename('water');
var wetCls = ee.Image(0).byte().paint(vegFC, 'cls').reproject(CRS, null, SCALE);
var wet = wetCls.gt(0).and(water.not()).rename('wet');
var dryLand = wet.not().and(water.not());

// large water bodies (>= ~90 ha connected) and distance to them, 90 m grid
var largeWater = water.reproject(CRS, null, 90)
  .connectedPixelCount(1024, true).gte(110).and(water.reproject(CRS, null, 90));
var distLargeWater = largeWater.selfMask().fastDistanceTransform(512).sqrt()
  .multiply(90).reproject(CRS, null, 90).unmask(46080).rename('dist_large_water_m');

// distance from each pixel to the nearest vegetated wetland, capped at 3 km
var distWet = wet.selfMask().fastDistanceTransform(100).sqrt().multiply(SCALE)
  .reproject(CRS, null, SCALE).unmask(3000).min(3000).rename('dist_wet_m');

// ============================== COVARIATES ====================================
var imperv = ee.ImageCollection('projects/sat-io/open-datasets/USGS/ANNUAL_NLCD/FRACTIONAL_IMPERVIOUS_SURFACE')
  .filter(ee.Filter.stringContains('system:index', NLCD_YEAR)).first();
imperv = ee.Image(imperv).select(0).rename('imperv_pct');
var elev = ee.Image('USGS/3DEP/10m').select('elevation').rename('elev_m');

// ============================== LANDSAT SUMMER LST ============================
var maskAndScale = function (img) {
  var qa = img.select('QA_PIXEL');
  var clear = qa.bitwiseAnd(1 << 1).eq(0)          // dilated cloud
    .and(qa.bitwiseAnd(1 << 3).eq(0))              // cloud
    .and(qa.bitwiseAnd(1 << 4).eq(0))              // cloud shadow
    .and(qa.bitwiseAnd(1 << 5).eq(0));             // snow
  var lst = img.select('ST_B10').multiply(0.00341802).add(149.0).subtract(273.15)
    .rename('lst_c');
  var sr = img.select(['SR_B5', 'SR_B4']).multiply(0.0000275).add(-0.2);
  var ndvi = sr.normalizedDifference(['SR_B5', 'SR_B4']).rename('ndvi');
  var clearFrac = clear.updateMask(water.not()).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: aoi, scale: 300, maxPixels: 1e9, bestEffort: true
  }).values().get(0);
  return lst.addBands(ndvi).updateMask(clear)
    .set('clear_frac', clearFrac)
    .copyProperties(img, ['system:time_start', 'LANDSAT_PRODUCT_ID']);
};
// LST anomaly = pixel LST minus the scene's mean LST over dry land in the AOI.
// Removes day-to-day weather differences between scenes before compositing.
var addAnomaly = function (img) {
  var m = img.select('lst_c').updateMask(dryLand).reduceRegion({
    reducer: ee.Reducer.mean(), geometry: aoi, scale: 120, maxPixels: 1e9, bestEffort: true
  }).get('lst_c');
  return img.addBands(img.select('lst_c').subtract(ee.Number(m)).rename('lst_anom'))
    .set('aoi_mean_lst', m);
};
var scenes = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .merge(ee.ImageCollection('LANDSAT/LC09/C02/T1_L2'))
  .filterBounds(aoi)
  .filter(ee.Filter.calendarRange(YEAR_START, YEAR_END, 'year'))
  .filter(ee.Filter.calendarRange(MONTH_START, MONTH_END, 'month'))
  .filter(ee.Filter.lt('CLOUD_COVER', MAX_CLOUD))
  .map(maskAndScale)
  .filter(ee.Filter.gte('clear_frac', MIN_CLEAR_FRACTION))
  .map(addAnomaly);
print('Scenes used:', scenes.size());

var lstSummer = scenes.select(['lst_c', 'lst_anom', 'ndvi']).median()
  .addBands(scenes.select('lst_c').count().rename('n_obs'))
  .reproject(CRS, null, SCALE);

var stack = lstSummer.addBands(imperv).addBands(elev);
var stackDry = stack.updateMask(dryLand);              // rings: dry land only
var stackIn = stack.updateMask(water.not());           // inside patch: no open water

// ============================== WETLAND PATCHES ===============================
var patches = wet.selfMask().reduceToVectors({
  geometry: aoi, crs: CRS, scale: SCALE, geometryType: 'polygon',
  eightConnected: true, labelProperty: 'wet', maxPixels: 1e10, tileScale: 4
});
patches = patches.map(function (f) {
  var g = f.geometry();
  var a = g.area(1), p = g.perimeter(1);
  var c = g.centroid(1).coordinates();
  return f.set({
    patch_id: f.get('system:index'),
    area_ha: a.divide(1e4),
    perimeter_m: p,
    shape_index: p.divide(a.sqrt().multiply(4)),   // 1 = square, larger = more complex
    lon: c.get(0), lat: c.get(1)
  });
}).filter(ee.Filter.gte('area_ha', MIN_PATCH_HA));
print('Wetland patches >= ' + MIN_PATCH_HA + ' ha:', patches.size());

// class mix inside each patch
var clsFrac = ee.Image.cat(
  wetCls.eq(1).rename('frac_emergent'),
  wetCls.eq(2).rename('frac_forested'),
  wetCls.eq(3).rename('frac_estuarine'));
var patchStats = stackIn.addBands(clsFrac).addBands(distLargeWater).reduceRegions({
  collection: patches, reducer: ee.Reducer.mean(), crs: CRS, scale: SCALE, tileScale: 4
});
Export.table.toDrive({
  collection: patchStats.select(['.*'], null, false),
  description: 'A_nova_patches', folder: EXPORT_FOLDER, fileNamePrefix: 'nova_patches',
  fileFormat: 'CSV'
});

// ============================== DISTANCE RINGS ================================
var rings = patches.map(function (f) {
  var g = f.geometry().simplify(15);
  return ee.FeatureCollection(ee.List(RINGS).map(function (r) {
    r = ee.List(r);
    var inner = ee.Number(r.get(0)), outer = ee.Number(r.get(1));
    var outerG = g.buffer(outer, 5);
    var ringG = ee.Geometry(ee.Algorithms.If(inner.eq(0),
      outerG.difference(g, 5), outerG.difference(g.buffer(inner, 5), 5)));
    return ee.Feature(ringG, {
      patch_id: f.get('patch_id'), ring_inner_m: inner, ring_outer_m: outer,
      ring_mid_m: inner.add(outer).divide(2)
    });
  }));
}).flatten();
var ringReducer = ee.Reducer.mean().combine(ee.Reducer.count(), null, true);
var ringStats = stackDry.select(['lst_c', 'lst_anom', 'ndvi', 'imperv_pct', 'elev_m'])
  .reduceRegions({collection: rings, reducer: ringReducer, crs: CRS, scale: SCALE, tileScale: 8});
Export.table.toDrive({
  collection: ringStats.select(['.*'], null, false),
  description: 'B_nova_patch_rings', folder: EXPORT_FOLDER, fileNamePrefix: 'nova_patch_rings',
  fileFormat: 'CSV'
});

// ============================== PIXEL SAMPLE ==================================
var kernel = function (m) { return ee.Kernel.circle(m, 'meters'); };
var pixelStack = stack
  .addBands(distWet)
  .addBands(distLargeWater)
  .addBands(wet.reduceNeighborhood(ee.Reducer.mean(), kernel(300)).rename('wet_frac_300m'))
  .addBands(wet.reduceNeighborhood(ee.Reducer.mean(), kernel(1000)).rename('wet_frac_1000m'))
  .addBands(water.reduceNeighborhood(ee.Reducer.mean(), kernel(1000)).rename('water_frac_1000m'))
  .addBands(wet.rename('is_wet')).addBands(water.rename('is_water'))
  .addBands(ee.Image.pixelLonLat())
  .reproject(CRS, null, SCALE);
var sample = pixelStack.sample({
  region: aoi, scale: SCALE, projection: CRS, numPixels: PIXEL_SAMPLE_N, seed: 42,
  geometries: false, tileScale: 8
});
Export.table.toDrive({
  collection: sample, description: 'C_nova_pixel_sample', folder: EXPORT_FOLDER,
  fileNamePrefix: 'nova_pixel_sample', fileFormat: 'CSV'
});

// ============================== MAP + RASTER ==================================
Export.image.toDrive({
  image: lstSummer.select(['lst_anom', 'lst_c', 'n_obs']).toFloat(),
  description: 'D_nova_lst_summer', folder: EXPORT_FOLDER, fileNamePrefix: 'nova_lst_summer',
  region: aoi, crs: CRS, scale: SCALE, maxPixels: 1e10
});

Map.centerObject(counties, 10);
Map.addLayer(lstSummer.select('lst_anom').clip(aoi),
  {min: -6, max: 6, palette: ['2166ac', '67a9cf', 'f7f7f7', 'ef8a62', 'b2182b']},
  'Summer LST anomaly (C)');
Map.addLayer(wet.selfMask().clip(aoi), {palette: ['1b9e77']}, 'Vegetated wetland');
Map.addLayer(water.selfMask().clip(aoi), {palette: ['08519c']}, 'Open water');
