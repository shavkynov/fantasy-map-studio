(function (root) {
'use strict';
// Physical scale of a spherical height field: converts the field's relative height units, steradians and radians
// into metres, km2 and km for a stated planet radius. It does not change any height or water value.
// The metres-per-unit factor is a stored CONVENTION (the generator's heights are relative), not a derived fact.

const VERSION = 'elevation-scale-v1';
const DEFAULT_METERS_PER_UNIT = 10000;   // convention: relative height 1.0 = 10 000 m; review with the owner
const MIN_RADIUS_KM = 500, MAX_RADIUS_KM = 50000;

function positive(v, name) {
  if (!Number.isFinite(v) || v <= 0) throw Error('Invalid ' + name);
  return v;
}

function create(options) {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('Scale options required');
  const allowed = ['radiusKm', 'metersPerUnit'];
  if (Object.keys(options).some(k => !allowed.includes(k))) throw Error('Unknown scale option');
  const radiusKm = positive(options.radiusKm, 'radiusKm');
  if (radiusKm < MIN_RADIUS_KM || radiusKm > MAX_RADIUS_KM) throw Error('radiusKm must be within ' + MIN_RADIUS_KM + '..' + MAX_RADIUS_KM);
  const metersPerUnit = options.metersPerUnit === undefined ? DEFAULT_METERS_PER_UNIT : positive(options.metersPerUnit, 'metersPerUnit');
  const km2PerSteradian = radiusKm * radiusKm, kmPerRadian = radiusKm;

  const toMeters = relative => { if (!Number.isFinite(relative)) throw Error('Height must be finite'); return relative * metersPerUnit; };
  const toRelative = meters => { if (!Number.isFinite(meters)) throw Error('Height must be finite'); return meters / metersPerUnit; };
  const areaKm2 = steradians => { if (!Number.isFinite(steradians) || steradians < 0) throw Error('Invalid area'); return steradians * km2PerSteradian; };
  const distanceKm = radians => { if (!Number.isFinite(radians) || radians < 0) throw Error('Invalid angle'); return radians * kmPerRadian; };
  // relative height per radian -> metres per km of ground distance (dimensionless slope x 1000)
  const slopeMetersPerKm = relativePerRadian => { if (!Number.isFinite(relativePerRadian)) throw Error('Invalid gradient'); return relativePerRadian * metersPerUnit / kmPerRadian; };

  // Physical summary of a field {w,h,land,height,area}; ocean cells carry no height and are not counted as land height.
  function describe(field) {
    const { w, h, land, height, area } = field || {}, n = w * h;
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || !land || !height || !area || land.length !== n || height.length !== n || area.length !== n) throw Error('Invalid field');
    let landSr = 0, totalSr = 0, minRel = Infinity, maxRel = -Infinity, sumRelArea = 0;
    for (let i = 0; i < n; i++) {
      totalSr += area[i];
      if (!land[i]) continue;
      const v = height[i]; if (!Number.isFinite(v)) throw Error('Land cell without finite height');
      landSr += area[i]; sumRelArea += v * area[i]; if (v < minRel) minRel = v; if (v > maxRel) maxRel = v;
    }
    return {
      gridCells: n, equatorCellWidthKm: distanceKm(2 * Math.PI / w), meridianCellHeightKm: distanceKm(Math.PI / h),
      totalAreaKm2: areaKm2(totalSr), landAreaKm2: areaKm2(landSr), landFraction: totalSr ? landSr / totalSr : 0,
      landCells: land.reduce((a, v) => a + (v ? 1 : 0), 0),
      minLandHeightM: landSr ? toMeters(minRel) : null, maxLandHeightM: landSr ? toMeters(maxRel) : null,
      meanLandHeightM: landSr ? toMeters(sumRelArea / landSr) : null   // area-weighted
    };
  }

  const record = Object.freeze({ version: VERSION, radiusKm, metersPerUnit, datum: 'external water level 0 m',
    scope: 'mean height per grid cell, not peaks; ocean cells carry no depth in the current raster; metersPerUnit is a convention' });
  return Object.freeze({ record, toMeters, toRelative, areaKm2, distanceKm, slopeMetersPerKm, describe });
}

function fromRecord(record) {
  if (!record || record.version !== VERSION) throw Error('Unsupported scale record');
  return create({ radiusKm: record.radiusKm, metersPerUnit: record.metersPerUnit });
}

const api = { create, fromRecord, VERSION, DEFAULT_METERS_PER_UNIT };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ElevationScale = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
