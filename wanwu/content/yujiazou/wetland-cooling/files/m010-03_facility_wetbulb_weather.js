// 03_facility_wetbulb_weather.js
// Study 2: monthly weather at each data center, including WET-BULB temperature,
// which is what governs evaporative cooling-tower water use. Built from
// ERA5-Land hourly 2 m temperature and dew point (about 9 km grid), 2015 onward.
//
// Export (Google Drive folder EXPORT_FOLDER):
//   G. nova_facility_weather_monthly.csv  one row per facility x month:
//      mean dry-bulb and wet-bulb (C), mean relative humidity (%), monthly max
//      wet-bulb, and cooling degree-hours above WB_BASE / DB_BASE (C-hours).
//
// FACILITIES: start with the points below. When the DEQ facility list is ready,
// upload it as a table asset with columns facility_id, lat, lon and set
// FACILITY_ASSET to its path; the inline list is then ignored.

// ============================== CONFIG ========================================
var EXPORT_FOLDER = 'nova_wetland_cooling';
var START = '2015-01-01';
var END = '2026-01-01';          // exclusive
var WB_BASE = 18;                // wet-bulb base for degree-hours (C)
var DB_BASE = 18;                // dry-bulb base for degree-hours (C)
var FACILITY_ASSET = '';         // e.g. 'projects/<your-project>/assets/nova_facilities'

var inline = ee.FeatureCollection([
  ee.Feature(ee.Geometry.Point([-77.5312, 38.7461]), {facility_id: 'COPT_DC6_Manassas'}),
  ee.Feature(ee.Geometry.Point([-77.4596, 39.0303]), {facility_id: 'DataCenterAlley_Ashburn_center'}),
  ee.Feature(ee.Geometry.Point([-77.4473, 38.9349]), {facility_id: 'Dulles_airport_station'}),
  ee.Feature(ee.Geometry.Point([-77.2367, 38.6446]), {facility_id: 'Occoquan_Bay_NWR'})
]);
var facilities = FACILITY_ASSET === '' ? inline :
  ee.FeatureCollection(FACILITY_ASSET).map(function (f) {
    return ee.Feature(ee.Geometry.Point([ee.Number(f.get('lon')), ee.Number(f.get('lat'))]),
                      {facility_id: f.get('facility_id')});
  });

// ============================== HOURLY WET-BULB ===============================
// Relative humidity from T and dew point (Magnus, Alduchov & Eskridge 1996),
// wet-bulb from T and RH (Stull 2011, valid for RH 5-99%, T -20 to 50 C).
var addWetBulb = function (img) {
  var t = img.select('temperature_2m').subtract(273.15);
  var td = img.select('dewpoint_temperature_2m').subtract(273.15);
  var es = t.multiply(17.625).divide(t.add(243.04)).exp();
  var e = td.multiply(17.625).divide(td.add(243.04)).exp();
  var rh = e.divide(es).multiply(100).min(100).rename('rh');
  var tw = img.expression(
    'T*atan(0.151977*sqrt(RH+8.313659)) + atan(T+RH) - atan(RH-1.676331)' +
    ' + 0.00391838*pow(RH,1.5)*atan(0.023101*RH) - 4.686035',
    {T: t, RH: rh}).rename('wb');
  return t.rename('db').addBands(rh).addBands(tw)
    .addBands(tw.subtract(WB_BASE).max(0).rename('wb_dh'))
    .addBands(t.subtract(DB_BASE).max(0).rename('db_dh'))
    .copyProperties(img, ['system:time_start']);
};
var era = ee.ImageCollection('ECMWF/ERA5_LAND/HOURLY')
  .filterDate(START, END)
  .select(['temperature_2m', 'dewpoint_temperature_2m']);

// ============================== MONTHLY TABLE =================================
var start = ee.Date(START);
var nMonths = ee.Date(END).difference(start, 'month').round();
var table = ee.FeatureCollection(ee.List.sequence(0, nMonths.subtract(1)).map(function (i) {
  var m0 = start.advance(ee.Number(i), 'month');
  var hourly = era.filterDate(m0, m0.advance(1, 'month')).map(addWetBulb);
  var img = hourly.select(['db', 'wb', 'rh']).mean()
    .addBands(hourly.select('wb').max().rename('wb_max'))
    .addBands(hourly.select(['wb_dh', 'db_dh']).sum())
    .addBands(hourly.select('db').count().rename('n_hours'));
  return img.reduceRegions({
    collection: facilities, reducer: ee.Reducer.first(), scale: 11132, tileScale: 2
  }).map(function (f) {
    return f.set({ym: m0.format('YYYY-MM'), year: m0.get('year'), month: m0.get('month')});
  });
})).flatten();
Export.table.toDrive({
  collection: table.select(['.*'], null, false),
  description: 'G_nova_facility_weather_monthly', folder: EXPORT_FOLDER,
  fileNamePrefix: 'nova_facility_weather_monthly', fileFormat: 'CSV'
});
