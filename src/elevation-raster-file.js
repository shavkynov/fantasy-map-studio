(function (root) {
'use strict';
// Decodes a height-raster FILE into {w,h,meters} for ElevationImport.
//  * 16-bit greyscale PNG (colour type 0, bit depth 16, not interlaced): value v in 0..65535 maps linearly to
//    minMeters + v/65535*(maxMeters-minMeters). Other PNG kinds are refused (8-bit has only 256 levels).
//  * JSON {"w":..,"h":..,"meters":[... w*h numbers, metres ...]}.
// Layout = editor grid layout: row-major, first row north, first column longitude -180.
// Needs DecompressionStream('deflate') (browsers, Electron, Node >= 18).

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10], MAX_CELLS = 8388608, MAX_ABS_METERS = 1e6;

let crcTable = null;
function crc32(bytes, start, end) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xFFFFFFFF; for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0;
}
const u32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;

async function inflate(parts, expected) {
  if (typeof DecompressionStream === 'undefined') throw Error('DecompressionStream is not available');
  const stream = new Blob(parts).stream().pipeThrough(new DecompressionStream('deflate')), reader = stream.getReader(), out = new Uint8Array(expected);
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    if (got + value.length > expected) { await reader.cancel(); throw Error('PNG data is longer than its header declares'); }
    out.set(value, got); got += value.length;
  }
  if (got !== expected) throw Error('PNG data is shorter than its header declares');
  return out;
}

async function decodePng16(bytes) {
  if (bytes.length < 33 || SIGNATURE.some((v, i) => bytes[i] !== v)) throw Error('Not a PNG file');
  let o = 8, w = 0, h = 0, idat = [], ended = false, seenHeader = false;
  while (o + 12 <= bytes.length && !ended) {
    const len = u32(bytes, o), type = String.fromCharCode(bytes[o + 4], bytes[o + 5], bytes[o + 6], bytes[o + 7]);
    if (o + 12 + len > bytes.length) throw Error('PNG chunk exceeds the file');
    if (crc32(bytes, o + 4, o + 8 + len) !== u32(bytes, o + 8 + len)) throw Error('PNG chunk checksum mismatch: ' + type);
    const d = o + 8;
    if (type === 'IHDR') {
      if (len !== 13 || seenHeader) throw Error('Invalid PNG header'); seenHeader = true;
      w = u32(bytes, d); h = u32(bytes, d + 4);
      if (bytes[d + 8] !== 16 || bytes[d + 9] !== 0) throw Error('Only 16-bit greyscale PNG is accepted (8-bit has too few levels)');
      if (bytes[d + 10] !== 0 || bytes[d + 11] !== 0 || bytes[d + 12] !== 0) throw Error('Interlaced or unusual PNG is not accepted');
    } else if (type === 'IDAT') { if (!seenHeader) throw Error('PNG data before header'); idat.push(bytes.subarray(d, d + len)); }
    else if (type === 'IEND') ended = true;
    else if (!(bytes[o + 4] & 32)) throw Error('Unsupported required PNG chunk: ' + type);   // critical chunks (PLTE etc.) are not valid for greyscale 16-bit
    o += 12 + len;
  }
  if (!seenHeader || !ended || !idat.length) throw Error('Incomplete PNG file');
  if (!Number.isInteger(w) || !Number.isInteger(h) || w < 1 || h < 1 || w * h > MAX_CELLS) throw Error('PNG size is out of range');
  const stride = w * 2, raw = await inflate(idat, (stride + 1) * h), values = new Uint16Array(w * h), line = new Uint8Array(stride), prev = new Uint8Array(stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)], src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let i = 0; i < stride; i++) {
      const a = i >= 2 ? line[i - 2] : 0, b = prev[i], c = i >= 2 ? prev[i - 2] : 0;
      let add;
      if (f === 0) add = 0; else if (f === 1) add = a; else if (f === 2) add = b; else if (f === 3) add = (a + b) >> 1;
      else if (f === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); add = pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      else throw Error('Invalid PNG filter type ' + f);
      line[i] = (src[i] + add) & 255;
    }
    for (let x = 0; x < w; x++) values[y * w + x] = (line[x * 2] << 8) | line[x * 2 + 1];
    prev.set(line);
  }
  return { w, h, values };
}

function checkRange(minMeters, maxMeters) {
  if (!Number.isFinite(minMeters) || !Number.isFinite(maxMeters) || maxMeters <= minMeters || Math.abs(minMeters) > MAX_ABS_METERS || Math.abs(maxMeters) > MAX_ABS_METERS) throw Error('PNG needs minMeters < maxMeters (finite, within +-' + MAX_ABS_METERS + ' m)');
}

async function decode(bytes, options = {}) {
  if (!(bytes instanceof Uint8Array)) throw Error('Bytes required');
  if (!options || typeof options !== 'object' || Array.isArray(options) || Object.keys(options).some(k => !['minMeters', 'maxMeters'].includes(k))) throw Error('Invalid decode options');
  if (bytes.length >= 8 && SIGNATURE.every((v, i) => bytes[i] === v)) {
    checkRange(options.minMeters, options.maxMeters);
    const { w, h, values } = await decodePng16(bytes), span = options.maxMeters - options.minMeters, meters = new Float64Array(w * h);
    for (let i = 0; i < meters.length; i++) meters[i] = options.minMeters + values[i] / 65535 * span;
    return { w, h, meters, format: 'png16' };
  }
  let data;
  try { data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); } catch (e) { throw Error('File is neither a 16-bit greyscale PNG nor JSON'); }
  if (!data || typeof data !== 'object' || Object.keys(data).some(k => !['w', 'h', 'meters'].includes(k)) || !Number.isInteger(data.w) || !Number.isInteger(data.h) || data.w < 1 || data.h < 1 || data.w * data.h > MAX_CELLS || !Array.isArray(data.meters) || data.meters.length !== data.w * data.h) throw Error('JSON raster must be {w,h,meters:[w*h numbers]}');
  const meters = new Float64Array(data.meters.length);
  for (let i = 0; i < meters.length; i++) { const v = data.meters[i]; if (typeof v !== 'number' || !Number.isFinite(v) || Math.abs(v) > MAX_ABS_METERS) throw Error('JSON raster value ' + i + ' is not a finite height'); meters[i] = v; }
  return { w: data.w, h: data.h, meters, format: 'json' };
}

const api = { decode, MAX_CELLS };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ElevationRasterFile = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
