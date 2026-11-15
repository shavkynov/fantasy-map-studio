(function (root) {
'use strict';
// Converts a height raster given in METRES into a terrain-editor base field {w,h,land,height} in the field's relative units.
// Raster layout = grid layout: row-major, first row = north, first column = longitude -180 (cell centre at 2*pi*((x+.5)/w-.5)).
// Datum: metres above the external water level 0 (shifted by options.seaLevelMeters). Cells at or below the datum become ocean;
// ocean depths are discarded because the editor base carries no bathymetry.
// Reduction to a coarser grid (integer factors only) is an area-weighted mean over the LAND sub-cells of each block; a block is land
// if its land-area fraction is >= 0.5. This keeps "cell value = mean height", the rule parent maps rely on.

const MIN_REL = 1e-6, MAX_REL = 10, MAX_ABS_METERS = 1e6;   // MIN_REL/MAX_REL mirror the editor core's height limits

function create(Scale) {
  if (!Scale || typeof Scale.create !== 'function') throw Error('ElevationScale required');

  function convert(raster, scale, options = {}) {
    if (!raster || typeof raster !== 'object' || !raster.meters || !Number.isInteger(raster.w) || !Number.isInteger(raster.h)) throw Error('Invalid raster');
    if (!scale || !scale.record || typeof scale.toRelative !== 'function') throw Error('Scale required');
    if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['targetW', 'targetH', 'seaLevelMeters'].includes(k))) throw Error('Invalid import options');
    const { w: sw, h: sh, meters } = raster, sn = sw * sh;
    if (sw < 4 || sw % 2 || sh < 2 || meters.length !== sn) throw Error('Invalid raster size');
    const tw = options.targetW === undefined ? sw : options.targetW, th = options.targetH === undefined ? sh : options.targetH;
    if (!Number.isInteger(tw) || !Number.isInteger(th) || tw < 4 || tw > 720 || tw % 2 || th < 2 || th > 360 || sw % tw || sh % th) throw Error('Target grid must divide the raster by integer factors (width 4..720 even, height 2..360)');
    const level = options.seaLevelMeters === undefined ? 0 : options.seaLevelMeters;
    if (!Number.isFinite(level)) throw Error('Invalid seaLevelMeters');
    const fx = sw / tw, fy = sh / th;
    // source cell area on the unit sphere, by row (equal-area in longitude)
    const rowArea = new Float64Array(sh);
    for (let y = 0; y < sh; y++) rowArea[y] = (2 * Math.PI / sw) * (Math.sin(Math.PI * (.5 - y / sh)) - Math.sin(Math.PI * (.5 - (y + 1) / sh)));
    const land = new Uint8Array(tw * th), height = new Float64Array(tw * th).fill(NaN);
    let clamped = 0, landArea = 0, totalArea = 0, sumMetersArea = 0, maxMeters = -Infinity;
    for (let ty = 0; ty < th; ty++) for (let tx = 0; tx < tw; tx++) {
      let blockArea = 0, blockLand = 0, blockSum = 0;
      for (let y = ty * fy; y < (ty + 1) * fy; y++) for (let x = tx * fx; x < (tx + 1) * fx; x++) {
        const m = meters[y * sw + x];
        if (!Number.isFinite(m) || Math.abs(m) > MAX_ABS_METERS) throw Error('Raster value at cell ' + (y * sw + x) + ' is not a finite height within +-' + MAX_ABS_METERS + ' m');
        const a = rowArea[y], above = m - level;
        blockArea += a;
        if (above > 0) { blockLand += a; blockSum += above * a; }
      }
      totalArea += blockArea;
      if (blockLand * 2 >= blockArea && blockLand > 0) {
        const i = ty * tw + tx, mean = blockSum / blockLand;
        let rel = scale.toRelative(mean);
        if (rel < MIN_REL) { rel = MIN_REL; clamped++; }
        if (rel > MAX_REL) throw Error('Height ' + mean + ' m exceeds the editor limit for this scale');
        land[i] = 1; height[i] = rel; landArea += blockArea; sumMetersArea += mean * blockArea; if (mean > maxMeters) maxMeters = mean;
      }
    }
    const landCells = land.reduce((a, v) => a + v, 0);
    return {
      base: { w: tw, h: th, land, height },
      report: {
        sourceW: sw, sourceH: sh, targetW: tw, targetH: th, factorX: fx, factorY: fy, landCells, landFraction: totalArea ? landArea / totalArea : 0,
        meanLandMeters: landArea ? sumMetersArea / landArea : null, maxLandMeters: landCells ? maxMeters : null, clampedToMinimum: clamped, seaLevelMeters: level,
        scale: scale.record,
        resampling: 'area-weighted mean over land sub-cells; block is land if land-area fraction >= 0.5; ocean depths discarded; no interpolation'
      }
    };
  }
  return Object.freeze({ convert });
}

const api = { create };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ElevationImport = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
