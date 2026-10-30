'use strict';
// Общие функции рисования контактных листов (PNG-писатель без зависимостей, цифры, плитка маски). Используются sil-gallery.js и sil-compare.js
const zlib = require('zlib');
// --- PNG ---
const crcT = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcT[n] = c >>> 0; }
const crc = (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
function png(w, h, rgb) { const raw = Buffer.alloc((w * 3 + 1) * h); for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); } const ch = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]), c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); }; const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2; return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), ch('IHDR', ih), ch('IDAT', zlib.deflateSync(raw)), ch('IEND', Buffer.alloc(0))]); }
const DIG = { A: '010101111101101', B: '110101110101110', 0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111', K: '101101110101101', '#': '101111101111101' };
function text(buf, W, x0, y0, str, col, sc) { let x = x0; for (const ch of String(str)) { const g = DIG[ch]; if (g) for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (g[r * 3 + c] === '1') for (let yy = 0; yy < sc; yy++) for (let xx = 0; xx < sc; xx++) { const o = ((y0 + r * sc + yy) * W + x + c * sc + xx) * 3; buf[o] = col[0]; buf[o + 1] = col[1]; buf[o + 2] = col[2]; } x += 4 * sc; } }
const COL = { sea: [28, 40, 54], main: [214, 190, 140], island: [232, 214, 170], arch: [168, 200, 214], frag: [150, 150, 150] };
function drawTile(M, buf, BW, ox, oy, tw, th, s, bad) {
  const f = s.W / tw, comp = M.comps(s), cat = {}; for (const c of comp) cat[c.c] = c.area < 0.0004 ? 'frag' : c.cat;
  for (let y = 0; y < th; y++) for (let x = 0; x < tw; x++) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) { const sx = Math.min(s.W - 1, Math.floor(x * f + xx)), sy = Math.min(s.H - 1, Math.floor(y * f + yy)), i = sy * s.W + sx, c = s.lab[i], k = c >= 0 ? COL[cat[c]] || COL.frag : COL.sea; r += k[0]; g += k[1]; b += k[2]; n++; }
    const o = ((oy + y) * BW + ox + x) * 3; buf[o] = r / n; buf[o + 1] = g / n; buf[o + 2] = b / n;
  }
  if (bad) for (let t = 0; t < 3; t++) for (let x = 0; x < tw; x++) for (const y of [t, th - 1 - t]) { const o = ((oy + y) * BW + ox + x) * 3; buf[o] = 230; buf[o + 1] = 40; buf[o + 2] = 40; }
  if (bad) for (let t = 0; t < 3; t++) for (let y = 0; y < th; y++) for (const x of [t, tw - 1 - t]) { const o = ((oy + y) * BW + ox + x) * 3; buf[o] = 230; buf[o + 1] = 40; buf[o + 2] = 40; }
}

module.exports = { png, text, drawTile, COL, DIG };
