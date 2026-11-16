// 02_modis_day_night_panel.js
// Study 1 (regional scale, full diurnal cycle): monthly land surface temperature
// for every ~1 km MODIS cell in Northern Virginia, four overpasses per day
// (Terra ~10:30 and ~22:30, Aqua ~13:30 and ~01:30), 2015 to the latest month,
// joined to each cell's wetland, water, impervious and elevation share.
//
// This answers the reviewer question "do wetlands also cool at night, and in the
// afternoon peak?" with a panel model: LST ~ wetland share + controls + month FE.
//
// Exports (Google Drive folder EXPORT_FOLDER):
//   E. nova_modis_cells.csv   one row per MODIS cell: covariates (time-invariant)
//   F. nova_modis_monthly.csv one row per cell x month: day/night LST, Terra and Aqua

// ============================== CONFIG ========================================
var EXPORT_FOLDER = 'nova_wetland_cooling';
var START = '2015-01-01';
var END = '2026-01-01';                    // exclusive; extend once 2026 is complete
var NLCD_YEAR = '2021';
var NWI_TYPE_FIELD = 'WETLAND_TYPE';
var VEG_WETLAND = ['Freshwater Emergent Wetland', 'Freshwater Forested/Shrub Wetland',
                   'Estuarine and Marine Wetland'];
var OPEN_WATER = ['Freshwater Pond', 'Lake', 'Riverine', 'Estuarine and Marine Deepwater'];

// ============================== STUDY AREA ====================================
var NOVA_FIPS = ['107', '059', '153', '013', '510', '600', '610', '683', '685'];
var counties = ee.FeatureCollection('TIGER/2018/Counties')
  .filter(ee.Filter.eq('STATEFP', '51'))
  .filter(ee.Filter.inList('COUNTYFP', NOVA_FIPS));
var aoi = counties.geometry();

// ============================== 30 m MASKS -> 1 km SHARES =====================
var CRS30 = 'EPSG:32618';
var nwi = ee.FeatureCollection('projects/sat-io/open-datasets/NWI/wetlands/VA_Wetlands')
  .filterBounds(aoi.buffer(2000));
var nwiWater = ee.Image(0).byte().paint(nwi.filter(ee.Filter.inList(NWI_TYPE_FIELD, OPEN_WATER)), 1);
var jrcWater = ee.Image('JRC/GSW1_4/GlobalSurfaceWater').select('occurrence').unmask(0).gte(50);
var water = nwiWater.or(jrcWater).reproject(CRS30, null, 30);
var wet = ee.Image(0).byte().paint(nwi.filter(ee.Filter.inList(NWI_TYPE_FIELD, VEG_WETLAND)), 1)
  .reproject(CRS30, null, 30).and(water.not());
var imperv = ee.Image(ee.ImageCollection('projects/sat-io/open-datasets/USGS/ANNUAL_NLCD/FRACTIONAL_IMPERVIOUS_SURFACE')
  .filter(ee.Filter.stringContains('system:index', NLCD_YEAR)).first()).select(0);
var elev = ee.Image('USGS/3DEP/10m').select('elevation');

var modisProj = ee.Image(ee.ImageCollection('MODIS/061/MOD11A2').first())
  .select('LST_Day_1km').projection();
var toModis = function (img30, name) {
  return img30.toFloat().reproject(CRS30, null, 30)
    .reduceResolution({reducer: ee.Reducer.mean(), maxPixels: 2048})
    .reproject(modisProj).rename(name);
};
var covariates = ee.Image.cat(
  toModis(wet, 'wet_frac'),
  toModis(water, 'water_frac'),
  toModis(imperv, 'imperv_pct'),
  toModis(elev, 'elev_m'),
  ee.Image.pixelLonLat().reproject(modisProj)
);
// one point per MODIS cell centre inside the AOI
var cells = covariates.sample({
  region: aoi, projection: modisProj, geometries: true, tileScale: 4
}).map(function (f) { return f.set('cell_id', f.get('system:index')); });
print('MODIS cells:', cells.size());
Export.table.toDrive({
  collection: cells.select(['.*'], null, false),
  description: 'E_nova_modis_cells', folder: EXPORT_FOLDER,
  fileNamePrefix: 'nova_modis_cells', fileFormat: 'CSV'
});

// ============================== LST QUALITY + SCALING =========================
// QC bits 0-1: 0 good, 1 other quality (both accepted); bits 6-7: LST error
// 0 (<=1 K) or 1 (<=2 K) accepted.
var lstBand = function (img, band, qcBand, name) {
  var qc = img.select(qcBand);
  var ok = qc.bitwiseAnd(3).lte(1).and(qc.rightShift(6).bitwiseAnd(3).lte(1));
  return img.select(band).multiply(0.02).subtract(273.15).updateMask(ok).rename(name);
};
var prep = function (prefix) {
  return function (img) {
    return lstBand(img, 'LST_Day_1km', 'QC_Day', prefix + '_day')
      .addBands(lstBand(img, 'LST_Night_1km', 'QC_Night', prefix + '_night'))
      .copyProperties(img, ['system:time_start']);
  };
};
var terra = ee.ImageCollection('MODIS/061/MOD11A2').filterDate(START, END).map(prep('terra'));
var aqua = ee.ImageCollection('MODIS/061/MYD11A2').filterDate(START, END).map(prep('aqua'));

// ============================== MONTHLY PANEL =================================
var start = ee.Date(START);
var nMonths = ee.Date(END).difference(start, 'month').round();
var months = ee.List.sequence(0, nMonths.subtract(1));
var monthly = ee.FeatureCollection(months.map(function (i) {
  var m0 = start.advance(ee.Number(i), 'month');
  var m1 = m0.advance(1, 'month');
  var t = terra.filterDate(m0, m1);
  var a = aqua.filterDate(m0, m1);
  var img = t.mean().addBands(a.mean())
    .addBands(t.select('terra_day').count().rename('n_terra_day'))
    .addBands(t.select('terra_night').count().rename('n_terra_night'));
  // the band list is fixed so a month with no valid data still has every column
  img = ee.Image.constant([0, 0, 0, 0, 0, 0]).rename(
      ['terra_day', 'terra_night', 'aqua_day', 'aqua_night', 'n_terra_day', 'n_terra_night'])
    .updateMask(0).addBands(img, null, true);
  return img.reduceRegions({
    collection: cells.select(['cell_id']), reducer: ee.Reducer.first(),
    crs: modisProj, scale: modisProj.nominalScale(), tileScale: 4
  }).map(function (f) {
    return f.set({ym: m0.format('YYYY-MM'), year: m0.get('year'), month: m0.get('month')});
  });
})).flatten();
Export.table.toDrive({
  collection: monthly.select(['.*'], null, false),
  description: 'F_nova_modis_monthly', folder: EXPORT_FOLDER,
  fileNamePrefix: 'nova_modis_monthly', fileFormat: 'CSV'
});

Map.centerObject(counties, 9);
Map.addLayer(covariates.select('wet_frac').clip(aoi), {min: 0, max: 0.3, palette: ['ffffff', '1b9e77']}, 'Wetland share per 1 km cell');
