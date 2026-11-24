//! Растровый рендер карты мира в стиле иллюстрированных фэнтези-атласов (без внешних зависимостей).
//!
//! Принципы: чистая карта без шума — гладкая береговая линия (бикубическая интерполяция маски суши
//! с субпиксельным сглаживанием), мягкие переходы биомов (нормированная свёртка цветов),
//! аккуратная светотень, сглаженные реки и разреженные иконки гор. Все стили строятся из одного
//! конвейера и отличаются палитрой и набором декоративных слоёв.

use crate::biomes::Biome;
use crate::civilization::{RouteKind, SettlementRole};
use crate::grid::{blur_xwrap, distance_to_mask_km};
use crate::hydrology::FlowRegime;
use crate::planet::Planet;
use std::fs::File;
use std::io::{BufWriter, Write};

type Rgb = [f32; 3];

/// Стиль оформления карты.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    /// Яркий «мультяшный» мир: бирюзовое море, сочная зелень, объёмные горы.
    Classic,
    /// Старый атлас: пергамент, чернильные контуры, волны вдоль берега.
    Parchment,
    /// Классический стиль с цветными государствами, границами, дорогами и городами.
    Political,
    /// Физическая карта: гипсометрическая раскраска и выразительная светотень.
    Relief,
}

impl Style {
    pub const ALL: [Style; 4] = [Style::Classic, Style::Parchment, Style::Political, Style::Relief];

    pub fn slug(self) -> &'static str {
        match self {
            Style::Classic => "classic",
            Style::Parchment => "parchment",
            Style::Political => "political",
            Style::Relief => "relief",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Style::Classic => "Классика",
            Style::Parchment => "Пергамент",
            Style::Political => "Политическая",
            Style::Relief => "Рельеф",
        }
    }
}

/// Готовое RGB-изображение.
pub struct Image {
    pub w: usize,
    pub h: usize,
    pub rgb: Vec<u8>,
}

impl Image {
    pub fn write_ppm(&self, path: &str) -> std::io::Result<()> {
        let mut out = BufWriter::new(File::create(path)?);
        writeln!(out, "P6\n{} {}\n255", self.w, self.h)?;
        out.write_all(&self.rgb)
    }

    /// Пишет PNG без сжатия (stored-блоки deflate): без внешних зависимостей, файл большой, но корректный.
    pub fn write_png(&self, path: &str) -> std::io::Result<()> {
        let stride = self.w * 3;
        let mut raw = Vec::with_capacity((stride + 1) * self.h);
        for y in 0..self.h {
            raw.push(0u8);
            raw.extend_from_slice(&self.rgb[y * stride..(y + 1) * stride]);
        }
        let mut z = vec![0x78u8, 0x01];
        let mut pos = 0usize;
        while pos < raw.len() {
            let n = (raw.len() - pos).min(65535);
            let last = pos + n == raw.len();
            z.push(last as u8);
            z.extend_from_slice(&(n as u16).to_le_bytes());
            z.extend_from_slice(&(!(n as u16)).to_le_bytes());
            z.extend_from_slice(&raw[pos..pos + n]);
            pos += n;
        }
        z.extend_from_slice(&adler32(&raw).to_be_bytes());

        let mut out = BufWriter::new(File::create(path)?);
        out.write_all(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A])?;
        let mut ihdr = Vec::with_capacity(13);
        ihdr.extend_from_slice(&(self.w as u32).to_be_bytes());
        ihdr.extend_from_slice(&(self.h as u32).to_be_bytes());
        ihdr.extend_from_slice(&[8, 2, 0, 0, 0]);
        write_chunk(&mut out, b"IHDR", &ihdr)?;
        write_chunk(&mut out, b"IDAT", &z)?;
        write_chunk(&mut out, b"IEND", &[])
    }
}

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for &v in chunk {
            a += v as u32;
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    (b << 16) | a
}

fn crc32(parts: &[&[u8]]) -> u32 {
    let mut table = [0u32; 256];
    for (i, t) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *t = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for part in parts {
        for &b in *part {
            crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
        }
    }
    crc ^ 0xFFFF_FFFF
}

fn write_chunk<W: Write>(out: &mut W, kind: &[u8; 4], data: &[u8]) -> std::io::Result<()> {
    out.write_all(&(data.len() as u32).to_be_bytes())?;
    out.write_all(kind)?;
    out.write_all(data)?;
    out.write_all(&crc32(&[kind, data]).to_be_bytes())
}

// ---------------------------------------------------------------------------------------------
// Математические помощники
// ---------------------------------------------------------------------------------------------

#[inline]
fn c3(r: u8, g: u8, b: u8) -> Rgb {
    [r as f32, g as f32, b as f32]
}

#[inline]
fn mix(a: Rgb, b: Rgb, t: f32) -> Rgb {
    let t = t.clamp(0.0, 1.0);
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

#[inline]
fn mul(a: Rgb, k: f32) -> Rgb {
    [a[0] * k, a[1] * k, a[2] * k]
}

#[inline]
fn smooth(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn hash01(mut x: u32) -> f32 {
    x ^= x >> 16;
    x = x.wrapping_mul(0x7feb_352d);
    x ^= x >> 15;
    x = x.wrapping_mul(0x846c_a68b);
    x ^= x >> 16;
    (x & 0x00FF_FFFF) as f32 / 16_777_216.0
}

#[inline]
fn wrap_i(x: isize, w: usize) -> usize {
    x.rem_euclid(w as isize) as usize
}

fn taps(t: f32, cubic: bool) -> [f32; 4] {
    if cubic {
        let t2 = t * t;
        let t3 = t2 * t;
        [
            -0.5 * t3 + t2 - 0.5 * t,
            1.5 * t3 - 2.5 * t2 + 1.0,
            -1.5 * t3 + 2.0 * t2 + 0.5 * t,
            0.5 * t3 - 0.5 * t2,
        ]
    } else {
        [0.0, 1.0 - t, t, 0.0]
    }
}

/// Масштабирует поле сетки в `s` раз (бикубика Catmull-Rom или билинейно), периодично по X.
fn upsample(src: &[f32], w: usize, h: usize, s: usize, cubic: bool) -> Vec<f32> {
    let ww = w * s;
    let hh = h * s;
    let sf = s as f32;
    let mut cx = vec![[0usize; 4]; ww];
    let mut cw = vec![[0f32; 4]; ww];
    for px in 0..ww {
        let sx = (px as f32 + 0.5) / sf - 0.5;
        let x0 = sx.floor();
        cw[px] = taps(sx - x0, cubic);
        for k in 0..4 {
            cx[px][k] = wrap_i(x0 as isize - 1 + k as isize, w);
        }
    }
    let mut out = vec![0f32; ww * hh];
    let mut hrow = vec![vec![0f32; ww]; 4];
    for py in 0..hh {
        let sy = (py as f32 + 0.5) / sf - 0.5;
        let y0 = sy.floor();
        let wy = taps(sy - y0, cubic);
        for k in 0..4 {
            if wy[k] == 0.0 {
                continue;
            }
            let ry = (y0 as isize - 1 + k as isize).clamp(0, h as isize - 1) as usize;
            let row = &src[ry * w..(ry + 1) * w];
            let hr = &mut hrow[k];
            for px in 0..ww {
                let i = &cx[px];
                let t = &cw[px];
                hr[px] = row[i[0]] * t[0] + row[i[1]] * t[1] + row[i[2]] * t[2] + row[i[3]] * t[3];
            }
        }
        let o = &mut out[py * ww..(py + 1) * ww];
        for px in 0..ww {
            let mut v = 0.0;
            for k in 0..4 {
                if wy[k] != 0.0 {
                    v += wy[k] * hrow[k][px];
                }
            }
            o[px] = v;
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Слой штрихов (линии с субпиксельным сглаживанием, накопление по максимуму)
// ---------------------------------------------------------------------------------------------

struct Layer {
    w: usize,
    h: usize,
    cov: Vec<f32>,
}

impl Layer {
    fn new(w: usize, h: usize) -> Self {
        Self { w, h, cov: vec![0.0; w * h] }
    }

    fn clear(&mut self) {
        self.cov.iter_mut().for_each(|v| *v = 0.0);
    }

    /// Отрезок с линейно меняющейся полушириной; круглые концы.
    fn stroke(&mut self, p0: [f32; 2], p1: [f32; 2], hw0: f32, hw1: f32) {
        let hmax = hw0.max(hw1) + 1.0;
        let x0 = (p0[0].min(p1[0]) - hmax).floor().max(0.0) as isize;
        let x1 = (p0[0].max(p1[0]) + hmax).ceil().min(self.w as f32 - 1.0) as isize;
        let y0 = (p0[1].min(p1[1]) - hmax).floor().max(0.0) as isize;
        let y1 = (p0[1].max(p1[1]) + hmax).ceil().min(self.h as f32 - 1.0) as isize;
        if x1 < x0 || y1 < y0 {
            return;
        }
        let dx = p1[0] - p0[0];
        let dy = p1[1] - p0[1];
        let len2 = (dx * dx + dy * dy).max(1e-6);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let px = x as f32 + 0.5;
                let py = y as f32 + 0.5;
                let t = (((px - p0[0]) * dx + (py - p0[1]) * dy) / len2).clamp(0.0, 1.0);
                let qx = p0[0] + dx * t;
                let qy = p0[1] + dy * t;
                let d = ((px - qx).powi(2) + (py - qy).powi(2)).sqrt();
                let hw = hw0 + (hw1 - hw0) * t;
                let c = (0.5 + hw - d).clamp(0.0, 1.0);
                let i = y as usize * self.w + x as usize;
                if c > self.cov[i] {
                    self.cov[i] = c;
                }
            }
        }
    }

    /// Ломаная с тремя копиями по X (замыкание карты по долготе).
    fn polyline_wrapped(&mut self, pts: &[[f32; 2]], hw: f32) {
        let ww = self.w as f32;
        for off in [-ww, 0.0, ww] {
            for k in 0..pts.len().saturating_sub(1) {
                self.stroke([pts[k][0] + off, pts[k][1]], [pts[k + 1][0] + off, pts[k + 1][1]], hw, hw);
            }
        }
    }

    /// Пунктир вдоль ломаной.
    fn dashed_wrapped(&mut self, pts: &[[f32; 2]], hw: f32, on: f32, off: f32) {
        let ww = self.w as f32;
        let mut dashes: Vec<Vec<[f32; 2]>> = Vec::new();
        let mut cur: Vec<[f32; 2]> = Vec::new();
        let mut drawing = true;
        let mut left = on;
        if let Some(&first) = pts.first() {
            cur.push(first);
        }
        for k in 0..pts.len().saturating_sub(1) {
            let a = pts[k];
            let b = pts[k + 1];
            let seg = ((b[0] - a[0]).powi(2) + (b[1] - a[1]).powi(2)).sqrt();
            if seg < 1e-4 {
                continue;
            }
            let mut pos = 0.0f32;
            while pos < seg {
                let step = (seg - pos).min(left);
                pos += step;
                left -= step;
                let t = pos / seg;
                let p = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
                if drawing {
                    cur.push(p);
                }
                if left <= 1e-4 {
                    if drawing {
                        dashes.push(std::mem::take(&mut cur));
                        drawing = false;
                        left = off;
                    } else {
                        drawing = true;
                        left = on;
                        cur.push(p);
                    }
                }
            }
        }
        if drawing && cur.len() > 1 {
            dashes.push(cur);
        }
        for d in &dashes {
            for o in [-ww, 0.0, ww] {
                for k in 0..d.len().saturating_sub(1) {
                    self.stroke([d[k][0] + o, d[k][1]], [d[k + 1][0] + o, d[k + 1][1]], hw, hw);
                }
            }
        }
    }
}

fn chaikin(pts: &[[f32; 2]], iters: usize) -> Vec<[f32; 2]> {
    let mut cur = pts.to_vec();
    for _ in 0..iters {
        if cur.len() < 3 {
            break;
        }
        let mut next = Vec::with_capacity(cur.len() * 2);
        next.push(cur[0]);
        for k in 0..cur.len() - 1 {
            let a = cur[k];
            let b = cur[k + 1];
            next.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]]);
            next.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
        }
        next.push(*cur.last().unwrap());
        cur = next;
    }
    cur
}

fn blend_px(buf: &mut [u8], ww: usize, hh: usize, x: isize, y: isize, col: Rgb, a: f32) {
    if x < 0 || y < 0 || x as usize >= ww || y as usize >= hh || a <= 0.0 {
        return;
    }
    let i = (y as usize * ww + x as usize) * 3;
    let a = a.min(1.0);
    for k in 0..3 {
        let v = buf[i + k] as f32;
        buf[i + k] = (v + (col[k] - v) * a).round().clamp(0.0, 255.0) as u8;
    }
}

fn composite_layer(buf: &mut [u8], layer: &Layer, col: Rgb, alpha: f32) {
    for (i, &c) in layer.cov.iter().enumerate() {
        if c <= 0.0 {
            continue;
        }
        let a = (c * alpha).min(1.0);
        for k in 0..3 {
            let v = buf[i * 3 + k] as f32;
            buf[i * 3 + k] = (v + (col[k] - v) * a).round().clamp(0.0, 255.0) as u8;
        }
    }
}

fn fill_circle(buf: &mut [u8], ww: usize, hh: usize, cx: f32, cy: f32, r: f32, col: Rgb, alpha: f32) {
    let x0 = (cx - r - 1.0).floor() as isize;
    let x1 = (cx + r + 1.0).ceil() as isize;
    let y0 = (cy - r - 1.0).floor() as isize;
    let y1 = (cy + r + 1.0).ceil() as isize;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let c = (0.5 + r - d).clamp(0.0, 1.0) * alpha;
            blend_px(buf, ww, hh, x, y, col, c);
        }
    }
}

fn ring(buf: &mut [u8], ww: usize, hh: usize, cx: f32, cy: f32, r: f32, wd: f32, col: Rgb) {
    let x0 = (cx - r - wd - 1.0).floor() as isize;
    let x1 = (cx + r + wd + 1.0).ceil() as isize;
    let y0 = (cy - r - wd - 1.0).floor() as isize;
    let y1 = (cy + r + wd + 1.0).ceil() as isize;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let c = (0.5 + wd * 0.5 - (d - r).abs()).clamp(0.0, 1.0);
            blend_px(buf, ww, hh, x, y, col, c);
        }
    }
}

// ---------------------------------------------------------------------------------------------
// Палитры
// ---------------------------------------------------------------------------------------------

struct Look {
    deep: Rgb,
    mid: Rgb,
    shallow: Rgb,
    glow_km: f32,
    foam: Rgb,
    foam_a: f32,
    foam_w: f32,
    lake: Rgb,
    lake_rim: Rgb,
    outline: Rgb,
    outline_px: f32,
    outline_a: f32,
    sand: Rgb,
    sand_a: f32,
    sand_w: f32,
    tint: Rgb,
    tint_amt: f32,
    hypso: f32,
    rock: Rgb,
    snow: Rgb,
    shade_k: f32,
    exag: f32,
    river: Rgb,
    river_edge: Rgb,
    river_edge_a: f32,
    river_k: f32,
    ripples: bool,
    ripple: Rgb,
    icons: bool,
    icon_scale: f32,
    ic_light: Rgb,
    ic_dark: Rgb,
    ic_snow_l: Rgb,
    ic_snow_d: Rgb,
    ic_line: Rgb,
    parchment: bool,
    political: bool,
}

fn look_of(style: Style) -> Look {
    let classic = Look {
        deep: c3(40, 112, 160),
        mid: c3(70, 158, 192),
        shallow: c3(150, 216, 214),
        glow_km: 420.0,
        foam: c3(230, 249, 245),
        foam_a: 0.34,
        foam_w: 2.4,
        lake: c3(92, 176, 208),
        lake_rim: c3(152, 216, 228),
        outline: c3(36, 90, 96),
        outline_px: 1.4,
        outline_a: 0.85,
        sand: c3(240, 228, 172),
        sand_a: 0.38,
        sand_w: 3.6,
        tint: c3(0, 0, 0),
        tint_amt: 0.0,
        hypso: 0.0,
        rock: c3(150, 132, 112),
        snow: c3(246, 249, 252),
        shade_k: 1.9,
        exag: 45.0,
        river: c3(76, 168, 210),
        river_edge: c3(34, 104, 150),
        river_edge_a: 0.65,
        river_k: 1.0,
        ripples: false,
        ripple: c3(255, 255, 255),
        icons: true,
        icon_scale: 1.0,
        ic_light: c3(198, 170, 134),
        ic_dark: c3(140, 110, 86),
        ic_snow_l: c3(251, 253, 255),
        ic_snow_d: c3(206, 216, 228),
        ic_line: c3(88, 64, 48),
        parchment: false,
        political: false,
    };
    match style {
        Style::Classic => classic,
        Style::Parchment => Look {
            deep: c3(178, 190, 176),
            mid: c3(208, 212, 190),
            shallow: c3(232, 228, 200),
            glow_km: 330.0,
            foam: c3(242, 234, 206),
            foam_a: 0.5,
            foam_w: 2.4,
            lake: c3(176, 198, 192),
            lake_rim: c3(208, 216, 198),
            outline: c3(78, 54, 36),
            outline_px: 1.6,
            outline_a: 0.95,
            sand: c3(232, 214, 170),
            sand_a: 0.22,
            tint: c3(238, 222, 178),
            tint_amt: 0.62,
            rock: c3(170, 144, 110),
            snow: c3(246, 240, 222),
            shade_k: 1.1,
            exag: 32.0,
            river: c3(96, 124, 130),
            river_edge: c3(70, 52, 38),
            river_edge_a: 0.30,
            river_k: 0.8,
            ripples: true,
            ripple: c3(92, 108, 100),
            ic_light: c3(228, 210, 168),
            ic_dark: c3(190, 162, 118),
            ic_snow_l: c3(248, 242, 224),
            ic_snow_d: c3(216, 206, 178),
            ic_line: c3(72, 50, 34),
            parchment: true,
            ..classic
        },
        Style::Political => Look {
            tint: c3(246, 242, 226),
            tint_amt: 0.32,
            sand_a: 0.12,
            shade_k: 1.1,
            icon_scale: 0.75,
            political: true,
            ..classic
        },
        Style::Relief => Look {
            deep: c3(18, 58, 108),
            mid: c3(44, 108, 160),
            shallow: c3(116, 192, 212),
            glow_km: 520.0,
            foam_a: 0.25,
            outline: c3(58, 78, 88),
            outline_px: 1.0,
            outline_a: 0.6,
            sand_a: 0.0,
            hypso: 0.72,
            shade_k: 2.7,
            exag: 62.0,
            river_k: 0.9,
            icons: false,
            ..classic
        },
    }
}

/// Базовый цвет биома (яркая гамма классического стиля).
fn biome_color(b: Biome) -> Rgb {
    match b {
        Biome::Ocean | Biome::Shelf | Biome::Lake => c3(96, 156, 96),
        Biome::SaltFlat => c3(236, 232, 218),
        Biome::IceSheet => c3(244, 248, 252),
        Biome::PolarDesert => c3(212, 218, 220),
        Biome::Tundra => c3(162, 180, 142),
        Biome::Alpine => c3(152, 160, 132),
        Biome::BorealForest => c3(76, 130, 86),
        Biome::ColdDesert => c3(200, 186, 152),
        Biome::TemperateGrassland => c3(164, 192, 98),
        Biome::Mediterranean => c3(174, 180, 102),
        Biome::TemperateForest => c3(98, 158, 86),
        Biome::TemperateRainforest => c3(66, 136, 90),
        Biome::HotDesert => c3(234, 208, 144),
        Biome::TropicalSavanna => c3(198, 188, 100),
        Biome::TropicalSeasonalForest => c3(106, 162, 76),
        Biome::TropicalRainforest => c3(50, 130, 68),
        Biome::Wetland => c3(100, 152, 126),
    }
}

/// Гипсометрическая раскраска по рангу высоты среди всей суши (`0..1`), а не по абсолютной высоте.
fn hypsometric(u: f32) -> Rgb {
    let u = u.clamp(0.0, 1.0);
    let stops: [(f32, Rgb); 7] = [
        (0.00, c3(96, 150, 92)),
        (0.30, c3(148, 182, 98)),
        (0.58, c3(206, 202, 124)),
        (0.78, c3(208, 174, 110)),
        (0.91, c3(172, 132, 98)),
        (0.97, c3(150, 130, 122)),
        (1.00, c3(238, 238, 242)),
    ];
    for k in 0..stops.len() - 1 {
        if u <= stops[k + 1].0 {
            let t = (u - stops[k].0) / (stops[k + 1].0 - stops[k].0);
            return mix(stops[k].1, stops[k + 1].1, t);
        }
    }
    stops[stops.len() - 1].1
}

const REALM_COLORS: [[u8; 3]; 12] = [
    [224, 132, 124],
    [118, 170, 218],
    [238, 204, 110],
    [132, 192, 134],
    [182, 142, 208],
    [236, 164, 108],
    [106, 192, 184],
    [212, 126, 162],
    [172, 194, 98],
    [142, 148, 214],
    [208, 172, 130],
    [122, 174, 152],
];

/// Жадная раскраска государств: соседи получают разные цвета.
fn color_realms(p: &Planet) -> Vec<Rgb> {
    let nr = p.civilization.realms.len();
    let w = p.grid.w;
    let n = p.grid.len();
    let mut adj = vec![vec![false; nr.max(1)]; nr.max(1)];
    for i in 0..n {
        let a = p.civilization.realm_id[i];
        if a < 0 {
            continue;
        }
        let (nb, cnt) = p.grid.neighbors8(i);
        for &j in &nb[..cnt] {
            let b = p.civilization.realm_id[j];
            if b >= 0 && b != a && (a as usize) < nr && (b as usize) < nr {
                adj[a as usize][b as usize] = true;
            }
        }
    }
    let _ = w;
    let mut order: Vec<usize> = (0..nr).collect();
    order.sort_by(|&a, &b| p.civilization.realms[b].area_km2.total_cmp(&p.civilization.realms[a].area_km2));
    let mut assigned = vec![usize::MAX; nr];
    let mut usage = [0usize; 12];
    for &r in &order {
        let mut used = [false; 12];
        for o in 0..nr {
            if adj[r][o] && assigned[o] != usize::MAX {
                used[assigned[o]] = true;
            }
        }
        // среди цветов, не занятых соседями, берём наименее используемый — палитра раскладывается ровно
        let pick = (0..12).filter(|&c| !used[c]).min_by_key(|&c| usage[c]).unwrap_or(r % 12);
        usage[pick] += 1;
        assigned[r] = pick;
    }
    (0..nr).map(|r| c3(REALM_COLORS[assigned[r]][0], REALM_COLORS[assigned[r]][1], REALM_COLORS[assigned[r]][2])).collect()
}

// ---------------------------------------------------------------------------------------------
// Иконки гор
// ---------------------------------------------------------------------------------------------

struct Peak {
    x: f32,
    y: f32,
    h: f32,
    snow: f32,
    seed: f32,
}

fn place_peaks(p: &Planet, s: usize, e_min: f32, e_max: f32, spacing: f32, size_k: f32) -> Vec<Peak> {
    let w = p.grid.w;
    let n = p.grid.len();
    let sf = s as f32;
    let ww = (w * s) as f32;
    let mut cand: Vec<usize> = (0..n)
        .filter(|&i| p.hydrology.is_ocean[i] == 0 && p.hydrology.is_lake[i] == 0 && p.erosion.elevation_km[i] >= e_min)
        .collect();
    cand.sort_by(|&a, &b| p.erosion.elevation_km[b].total_cmp(&p.erosion.elevation_km[a]).then(a.cmp(&b)));
    let bucket = spacing.max(4.0);
    let bw = (ww / bucket).ceil() as isize + 1;
    let mut grid: std::collections::HashMap<(isize, isize), Vec<usize>> = std::collections::HashMap::new();
    let mut peaks: Vec<Peak> = Vec::new();
    for &i in &cand {
        let cx = (i % w) as f32 + 0.5 + (hash01(i as u32 * 2 + 1) - 0.5) * 0.9;
        let cy = (i / w) as f32 + 0.5 + (hash01(i as u32 * 2 + 2) - 0.5) * 0.9;
        let (x, y) = (cx * sf, cy * sf);
        let (bx, by) = ((x / bucket) as isize, (y / bucket) as isize);
        let mut ok = true;
        'outer: for dy in -1..=1isize {
            for dx in -1..=1isize {
                let key = (wrap_i(bx + dx, bw as usize) as isize, by + dy);
                if let Some(list) = grid.get(&key) {
                    for &pi in list {
                        let q = &peaks[pi];
                        let mut ddx = (q.x - x).abs();
                        if ddx > ww * 0.5 {
                            ddx = ww - ddx;
                        }
                        let ddy = (q.y - y) * 1.25;
                        if ddx * ddx + ddy * ddy < spacing * spacing {
                            ok = false;
                            break 'outer;
                        }
                    }
                }
            }
        }
        if !ok {
            continue;
        }
        let e = p.erosion.elevation_km[i];
        let k = smooth(e_min, e_max, e);
        let vary = 0.82 + 0.36 * hash01(i as u32 * 5 + 11);
        let h = (14.0 + 18.0 * k) * sf / 4.0 * size_k * vary;
        let snow = smooth(0.55, 1.0, k);
        peaks.push(Peak { x, y: y + h * 0.35, h, snow, seed: hash01(i as u32 * 7 + 3) });
        grid.entry((wrap_i(bx, bw as usize) as isize, by)).or_default().push(peaks.len() - 1);
    }
    peaks.sort_by(|a, b| a.y.total_cmp(&b.y));
    peaks
}

#[inline]
fn edge_fn(ax: f32, ay: f32, bx: f32, by: f32, px: f32, py: f32) -> f32 {
    (bx - ax) * (py - ay) - (by - ay) * (px - ax)
}

fn dist_seg(px: f32, py: f32, a: [f32; 2], b: [f32; 2]) -> f32 {
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    let t = (((px - a[0]) * dx + (py - a[1]) * dy) / (dx * dx + dy * dy).max(1e-6)).clamp(0.0, 1.0);
    ((px - (a[0] + dx * t)).powi(2) + (py - (a[1] + dy * t)).powi(2)).sqrt()
}

#[allow(clippy::too_many_arguments)]
fn draw_tri(buf: &mut [u8], ww: usize, hh: usize, apex: [f32; 2], bl: [f32; 2], br: [f32; 2], ridge: [f32; 2], snow: f32, seed: f32, line_w: f32, look: &Look) {
    let h = (bl[1] - apex[1]).max(1.0);
    let wd = br[0] - bl[0];
    let cx = 0.5 * (bl[0] + br[0]);
    let x0 = (bl[0] - 2.0).floor() as isize;
    let x1 = (br[0] + 2.0).ceil() as isize;
    let y0 = (apex[1] - 2.0).floor() as isize;
    let y1 = (bl[1] + 2.0).ceil() as isize;
    let snow_frac = 0.40 * snow;
    for y in y0..=y1 {
        for x in x0..=x1 {
            let mut acc = [0f32; 3];
            let mut cover = 0.0f32;
            for sy in 0..3 {
                for sx in 0..3 {
                    let px = x as f32 + (sx as f32 + 0.5) / 3.0;
                    let py = y as f32 + (sy as f32 + 0.5) / 3.0;
                    let e1 = edge_fn(apex[0], apex[1], bl[0], bl[1], px, py);
                    let e2 = edge_fn(bl[0], bl[1], br[0], br[1], px, py);
                    let e3 = edge_fn(br[0], br[1], apex[0], apex[1], px, py);
                    let inside = (e1 >= 0.0 && e2 >= 0.0 && e3 >= 0.0) || (e1 <= 0.0 && e2 <= 0.0 && e3 <= 0.0);
                    if !inside {
                        continue;
                    }
                    let ridge_x = apex[0] + (ridge[0] - apex[0]) * ((py - apex[1]) / h).clamp(0.0, 1.0);
                    let lit = px < ridge_x;
                    let v = (bl[1] - py) / h;
                    let u = (px - cx) / wd.max(1.0);
                    let snow_line = 1.0 - snow_frac + 0.045 * (u * 16.0 + seed * 6.0).sin();
                    let mut col = if snow > 0.05 && v > snow_line {
                        if lit { look.ic_snow_l } else { look.ic_snow_d }
                    } else if lit {
                        mix(look.ic_light, look.ic_dark, (1.0 - v) * 0.25)
                    } else {
                        mix(look.ic_dark, mul(look.ic_dark, 0.82), 1.0 - v)
                    };
                    let de = dist_seg(px, py, apex, bl).min(dist_seg(px, py, apex, br));
                    if de < line_w * 0.5 {
                        col = look.ic_line;
                    }
                    acc[0] += col[0];
                    acc[1] += col[1];
                    acc[2] += col[2];
                    cover += 1.0;
                }
            }
            if cover > 0.0 {
                let col = [acc[0] / cover, acc[1] / cover, acc[2] / cover];
                blend_px(buf, ww, hh, x, y, col, cover / 9.0);
            }
        }
    }
}

fn draw_peak(buf: &mut [u8], ww: usize, hh: usize, pk: &Peak, s: f32, look: &Look) {
    let h = pk.h;
    let wd = h * 1.35;
    let (cx, by) = (pk.x, pk.y);
    let line_w = (0.95 * s / 4.0).max(0.8);
    // мягкая тень под основанием
    let (sx0, sy0) = (cx + 0.28 * wd, by + 0.03 * h);
    let (rx, ry) = (0.78 * wd, 0.17 * h + 1.0);
    for y in (sy0 - ry - 1.0).floor() as isize..=(sy0 + ry + 1.0).ceil() as isize {
        for x in (sx0 - rx - 1.0).floor() as isize..=(sx0 + rx + 1.0).ceil() as isize {
            let d = ((x as f32 + 0.5 - sx0) / rx).powi(2) + ((y as f32 + 0.5 - sy0) / ry).powi(2);
            if d < 1.0 {
                blend_px(buf, ww, hh, x, y, c3(30, 30, 20), 0.20 * (1.0 - d));
            }
        }
    }
    // малая вершина-спутник слева
    if pk.seed > 0.35 {
        let k = 0.58;
        let ccx = cx - 0.46 * wd;
        let cwd = wd * k;
        draw_tri(
            buf, ww, hh,
            [ccx + 0.05 * cwd, by - h * k],
            [ccx - 0.5 * cwd, by + 0.02 * h],
            [ccx + 0.5 * cwd, by + 0.02 * h],
            [ccx + 0.14 * cwd, by + 0.02 * h],
            pk.snow * 0.5, pk.seed + 0.37, line_w, look,
        );
    }
    draw_tri(
        buf, ww, hh,
        [cx + 0.06 * wd, by - h],
        [cx - 0.5 * wd, by],
        [cx + 0.5 * wd, by],
        [cx + 0.14 * wd, by],
        pk.snow, pk.seed, line_w, look,
    );
}

// ---------------------------------------------------------------------------------------------
// Главный конвейер
// ---------------------------------------------------------------------------------------------

fn percentile(sorted: &[f32], q: f32) -> f32 {
    if sorted.is_empty() {
        return 0.0;
    }
    sorted[((sorted.len() - 1) as f32 * q) as usize]
}

/// Дозаполняет воду высотой суши (для светотени без искусственного «обрыва» у берега).
fn inpaint_height(h: &mut [f32], known: &mut [bool], w: usize, hgt: usize, passes: usize) {
    for _ in 0..passes {
        let mut upd: Vec<(usize, f32)> = Vec::new();
        for y in 0..hgt {
            for x in 0..w {
                let i = y * w + x;
                if known[i] {
                    continue;
                }
                let mut sum = 0.0;
                let mut cnt = 0.0;
                for dy in -1..=1isize {
                    for dx in -1..=1isize {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        let yy = y as isize + dy;
                        if yy < 0 || yy >= hgt as isize {
                            continue;
                        }
                        let j = yy as usize * w + wrap_i(x as isize + dx, w);
                        if known[j] {
                            sum += h[j];
                            cnt += 1.0;
                        }
                    }
                }
                if cnt > 0.0 {
                    upd.push((i, sum / cnt));
                }
            }
        }
        if upd.is_empty() {
            break;
        }
        for (i, v) in upd {
            h[i] = v;
            known[i] = true;
        }
    }
}

/// Рисует карту планеты выбранным стилем. `scale` — число пикселей на ячейку сетки.
pub fn render(p: &Planet, style: Style, scale: usize) -> Image {
    let look = look_of(style);
    let w = p.grid.w;
    let h = p.grid.h;
    let n = w * h;
    let s = scale.max(1);
    let sf = s as f32 / 4.0;
    let (ww, hh) = (w * s, h * s);

    // --- маски суши ---
    let mut lake_flag: Vec<bool> = (0..n).map(|i| p.hydrology.is_ocean[i] == 0 && p.hydrology.is_lake[i] != 0).collect();
    // Мелкие озёра (единицы ячеек) не рисуем: на карте это просто шум.
    {
        let min_cells = ((6.0 * (w as f32 / 720.0).powi(2)) as usize).max(3);
        let mut seen = vec![false; n];
        for start in 0..n {
            if !lake_flag[start] || seen[start] {
                continue;
            }
            let mut comp = vec![start];
            seen[start] = true;
            let mut k = 0;
            while k < comp.len() {
                let (nb, cnt) = p.grid.neighbors8(comp[k]);
                for &j in &nb[..cnt] {
                    if lake_flag[j] && !seen[j] {
                        seen[j] = true;
                        comp.push(j);
                    }
                }
                k += 1;
            }
            if comp.len() < min_cells {
                for &c in &comp {
                    lake_flag[c] = false;
                }
            }
        }
    }
    let mut is_land = vec![false; n];
    let mut lake_m = vec![0f32; n];
    let mut field = vec![0f32; n];
    let mut nonocean = vec![0u8; n];
    for i in 0..n {
        let ocean = p.hydrology.is_ocean[i] != 0;
        let lake = lake_flag[i];
        is_land[i] = !ocean && !lake;
        if lake {
            lake_m[i] = 1.0;
        }
        field[i] = if is_land[i] { 1.0 } else { -1.0 };
        nonocean[i] = (!ocean) as u8;
    }
    // Сглаживание маски суши: контур поля получается плавным, а не «лесенкой» по ячейкам.
    blur_xwrap(&mut field, w, h, 1);
    field.iter_mut().for_each(|f| *f += 0.14);

    // --- пороги по процентилям высот суши ---
    let mut land_e: Vec<f32> = (0..n).filter(|&i| is_land[i]).map(|i| p.erosion.elevation_km[i]).collect();
    land_e.sort_by(|a, b| a.total_cmp(b));
    let e_hi = percentile(&land_e, 0.995);
    let rock0 = percentile(&land_e, 0.88);
    let rock1 = percentile(&land_e, 0.980);
    let snow0 = percentile(&land_e, 0.992);
    let snow1 = percentile(&land_e, 0.999);

    // --- поля высокого разрешения ---
    let fup = upsample(&field, w, h, s, true);
    let lakeup = upsample(&lake_m, w, h, s, false);

    let mut hs: Vec<f32> = (0..n).map(|i| if is_land[i] { p.erosion.elevation_km[i] } else { 0.0 }).collect();
    let mut known = is_land.clone();
    inpaint_height(&mut hs, &mut known, w, h, 14);
    blur_xwrap(&mut hs, w, h, 1);
    blur_xwrap(&mut hs, w, h, 1);
    let eup = upsample(&hs, w, h, s, true);

    let mut dist = distance_to_mask_km(&nonocean, &p.grid);
    dist.iter_mut().for_each(|d| *d = d.min(3000.0));
    blur_xwrap(&mut dist, w, h, 1);
    let dup = upsample(&dist, w, h, s, true);

    let glacier = upsample(&p.climate.glacier, w, h, s, false);

    // --- цвет биомов: нормированная свёртка для мягких переходов ---
    let mut cr = vec![0f32; n];
    let mut cg = vec![0f32; n];
    let mut cb = vec![0f32; n];
    let mut cwgt = vec![0f32; n];
    for i in 0..n {
        if is_land[i] {
            let mut c = biome_color(p.biomes.biome[i]);
            if look.tint_amt > 0.0 {
                c = mix(c, look.tint, look.tint_amt);
            }
            cr[i] = c[0];
            cg[i] = c[1];
            cb[i] = c[2];
            cwgt[i] = 1.0;
        }
    }
    for f in [&mut cr, &mut cg, &mut cb, &mut cwgt] {
        blur_xwrap(f, w, h, 2);
        blur_xwrap(f, w, h, 1);
    }
    for i in 0..n {
        if cwgt[i] > 1e-4 {
            cr[i] /= cwgt[i];
            cg[i] /= cwgt[i];
            cb[i] /= cwgt[i];
        } else {
            cr[i] = 120.0;
            cg[i] = 160.0;
            cb[i] = 100.0;
        }
    }
    let crup = upsample(&cr, w, h, s, false);
    let cgup = upsample(&cg, w, h, s, false);
    let cbup = upsample(&cb, w, h, s, false);
    drop((cr, cg, cb, cwgt));

    // --- государства: мягкие веса классов ---
    let nr = p.civilization.realms.len();
    let realm_cols = if look.political { color_realms(p) } else { Vec::new() };
    let mut class_of = vec![usize::MAX; n];
    let mut realm_w: Vec<Vec<f32>> = Vec::new();
    if look.political && nr > 0 {
        realm_w = vec![vec![0f32; n]; nr + 1];
        for i in 0..n {
            if is_land[i] {
                let r = p.civilization.realm_id[i];
                let k = if r >= 0 && (r as usize) < nr { r as usize } else { nr };
                class_of[i] = k;
                realm_w[k][i] = 1.0;
            }
        }
        for wv in realm_w.iter_mut() {
            blur_xwrap(wv, w, h, 2);
        }
    }
    let m_scale = 2.5 * s as f32; // ширина зоны перехода веса в пикселях (для границ и свечения)

    // --- реки ---
    let mut river_in = Layer::new(ww, hh);
    let mut river_out = Layer::new(ww, hh);
    let skip_regime = |r: FlowRegime| r == FlowRegime::EphemeralWadi;
    for r in &p.hydrology.rivers {
        if skip_regime(r.regime) || r.smoothed_pts.len() < 2 {
            continue;
        }
        let mut pts: Vec<[f32; 2]> = r.smoothed_pts.iter().map(|q| [q[0] * s as f32, q[1] * s as f32]).collect();
        // Разворачиваем координаты через шов долготы, чтобы не было «хорд» через всю карту.
        for k in 1..pts.len() {
            while pts[k][0] - pts[k - 1][0] > ww as f32 * 0.5 {
                pts[k][0] -= ww as f32;
            }
            while pts[k][0] - pts[k - 1][0] < -(ww as f32) * 0.5 {
                pts[k][0] += ww as f32;
            }
        }
        for off in [-(ww as f32), 0.0, ww as f32] {
            for k in 0..pts.len() - 1 {
                let w0 = r.widths.get(k).copied().unwrap_or(1.0);
                let w1 = r.widths.get(k + 1).copied().unwrap_or(w0);
                let hw0 = 0.5 * s as f32 * look.river_k * (0.30 + 0.36 * w0) * 0.9;
                let hw1 = 0.5 * s as f32 * look.river_k * (0.30 + 0.36 * w1) * 0.9;
                let a = [pts[k][0] + off, pts[k][1]];
                let b = [pts[k + 1][0] + off, pts[k + 1][1]];
                river_in.stroke(a, b, hw0, hw1);
                river_out.stroke(a, b, hw0 + 0.9 * sf, hw1 + 0.9 * sf);
            }
        }
    }

    // --- попиксельная композиция ---
    let mut buf = vec![0u8; ww * hh * 3];
    let kmpp = (p.grid.dy_km() as f32) / s as f32; // километров на пиксель по вертикали
    let half_cell_km = 0.5 * p.grid.dy_km() as f32;
    let light = {
        let (lx, ly, lz) = (-0.62f32, -0.62f32, 0.48f32);
        let l = (lx * lx + ly * ly + lz * lz).sqrt();
        [lx / l, ly / l, lz / l]
    };
    let ripple_levels: [(f32, f32); 3] = [(55.0, 0.60), (125.0, 0.42), (215.0, 0.26)];

    for py in 0..hh {
        let row = py * ww;
        let yu = if py == 0 { 0 } else { py - 1 };
        let yd = if py + 1 == hh { py } else { py + 1 };
        let sy = (py as f32 + 0.5) / s as f32 - 0.5;
        let cy0 = sy.floor();
        let ty = sy - cy0;
        let ya = (cy0 as isize).clamp(0, h as isize - 1) as usize;
        let yb = (cy0 as isize + 1).clamp(0, h as isize - 1) as usize;
        for px in 0..ww {
            let idx = row + px;
            let xl = if px == 0 { ww - 1 } else { px - 1 };
            let xr = if px + 1 == ww { 0 } else { px + 1 };

            // знаковое расстояние до берега в пикселях (>0 — суша)
            let f = fup[idx];
            let gx = (fup[row + xr] - fup[row + xl]) * 0.5;
            let gy = (fup[yd * ww + px] - fup[yu * ww + px]) * 0.5;
            let g = (gx * gx + gy * gy).sqrt().max(1e-4);
            let sd = f / g;
            let cov = (0.5 + sd).clamp(0.0, 1.0);
            let lake_px = lakeup[idx] > 0.5;

            // --- вода ---
            let wcol = if cov < 1.0 {
                if lake_px {
                    mix(look.lake_rim, look.lake, smooth(0.0, 9.0 * sf, -sd))
                } else {
                    let d_eff = (dup[idx] - half_cell_km).max(0.0);
                    let t = smooth(0.0, 1.0, d_eff / look.glow_km).powf(0.8);
                    let mut c = if t < 0.5 {
                        mix(look.shallow, look.mid, t * 2.0)
                    } else {
                        mix(look.mid, look.deep, (t - 0.5) * 2.0)
                    };
                    let dpx = (-sd).max(0.0);
                    c = mix(c, look.foam, look.foam_a * (-dpx / (look.foam_w * sf)).exp());
                    if look.ripples {
                        for (lvl, al) in ripple_levels {
                            let dd = (d_eff - lvl).abs() / kmpp;
                            let lc = (0.5 + 0.55 * sf * 1.1 - dd).clamp(0.0, 1.0) * al;
                            c = mix(c, look.ripple, lc);
                        }
                    }
                    c
                }
            } else {
                [0.0; 3]
            };

            // --- суша ---
            let lcol = if cov > 0.0 {
                let e = eup[idx];
                let mut c = [crup[idx], cgup[idx], cbup[idx]];

                // государства: заливка и внутреннее свечение у границ
                let mut border = 0.0f32;
                let mut border_col = [0.0f32; 3];
                if look.political && nr > 0 {
                    let sx = (px as f32 + 0.5) / s as f32 - 0.5;
                    let cx0 = sx.floor();
                    let tx = sx - cx0;
                    let xa = wrap_i(cx0 as isize, w);
                    let xb = wrap_i(cx0 as isize + 1, w);
                    let cells = [ya * w + xa, ya * w + xb, yb * w + xa, yb * w + xb];
                    let bw = [(1.0 - tx) * (1.0 - ty), tx * (1.0 - ty), (1.0 - tx) * ty, tx * ty];
                    let mut cand = [usize::MAX; 4];
                    let mut nc = 0;
                    for &cell in &cells {
                        let k = class_of[cell];
                        if k != usize::MAX && !cand[..nc].contains(&k) {
                            cand[nc] = k;
                            nc += 1;
                        }
                    }
                    let (mut k1, mut w1, mut k2, mut w2) = (usize::MAX, 0.0f32, usize::MAX, 0.0f32);
                    for &k in &cand[..nc] {
                        let wk: f32 = (0..4).map(|j| bw[j] * realm_w[k][cells[j]]).sum();
                        if wk > w1 {
                            k2 = k1;
                            w2 = w1;
                            k1 = k;
                            w1 = wk;
                        } else if wk > w2 {
                            k2 = k;
                            w2 = wk;
                        }
                    }
                    if k1 != usize::MAX {
                        let m = if k2 == usize::MAX { 1.0 } else { (w1 - w2) / (w1 + w2 + 1e-6) };
                        if k1 < nr {
                            let glow = (1.0 - smooth(0.0, 1.0, m)).powf(1.4);
                            let a = 0.60 + 0.24 * glow;
                            c = mix(c, realm_cols[k1], a);
                        }
                        let dpx = m * m_scale;
                        let lw = 2.2 * sf;
                        let lc = (0.5 + lw * 0.5 - dpx).clamp(0.0, 1.0);
                        if lc > 0.0 && k2 != usize::MAX {
                            let ca = if k1 < nr { realm_cols[k1] } else { c3(150, 140, 120) };
                            let cb2 = if k2 < nr { realm_cols[k2] } else { c3(150, 140, 120) };
                            let both = k1 < nr && k2 < nr;
                            border = lc * if both { 0.95 } else { 0.5 };
                            border_col = mul(mix(ca, cb2, 0.5), 0.5);
                        }
                    }
                }

                if look.hypso > 0.0 {
                    let rank = land_e.partition_point(|&v| v < e) as f32 / land_e.len().max(1) as f32;
                    c = mix(c, hypsometric(rank), look.hypso);
                }
                let rt = smooth(rock0, rock1, e);
                c = mix(c, look.rock, rt * 0.82);
                let st = smooth(0.12, 0.55, glacier[idx]).max(smooth(snow0, snow1, e));
                c = mix(c, look.snow, st * 0.9);

                // светлая полоса суши у берега
                if look.sand_a > 0.0 {
                    let sa = look.sand_a * (1.0 - smooth(0.0, look.sand_w * sf, sd.max(0.0)));
                    c = mix(c, look.sand, sa);
                }

                // светотень
                let ez = eup[row + xr] - eup[row + xl];
                let ey = eup[yd * ww + px] - eup[yu * ww + px];
                let dzdx = ez / (2.0 * kmpp);
                let dzdy = ey / ((yd - yu).max(1) as f32 * kmpp);
                let nx = -look.exag * dzdx;
                let ny = -look.exag * dzdy;
                let il = 1.0 / (nx * nx + ny * ny + 1.0).sqrt();
                let dot = (nx * light[0] + ny * light[1] + light[2]) * il;
                let shade = dot - light[2];
                c = mul(c, (1.0 + look.shade_k * shade).clamp(0.55, 1.45));

                // реки
                let clip = (0.5 + sd + 3.0 * sf).clamp(0.0, 1.0) * if lake_px && cov < 0.5 { 0.0 } else { 1.0 };
                let ro = river_out.cov[idx] * clip;
                if ro > 0.0 {
                    c = mix(c, look.river_edge, ro * look.river_edge_a);
                }
                let ri = river_in.cov[idx] * clip;
                if ri > 0.0 {
                    c = mix(c, look.river, ri);
                }
                if border > 0.0 {
                    c = mix(c, border_col, border);
                }
                c
            } else {
                [0.0; 3]
            };

            let mut c = if cov >= 1.0 {
                lcol
            } else if cov <= 0.0 {
                wcol
            } else {
                mix(wcol, lcol, cov)
            };

            // береговая линия
            let lw = look.outline_px * sf;
            let oc = (0.5 + lw * 0.5 - sd.abs()).clamp(0.0, 1.0);
            if oc > 0.0 {
                let a = look.outline_a * if lake_px && cov < 0.5 { 0.6 } else { 1.0 };
                c = mix(c, look.outline, oc * a);
            }

            // пергамент: виньетка
            if look.parchment {
                let u = (px as f32 / ww as f32 - 0.5) * 2.0;
                let v = (py as f32 / hh as f32 - 0.5) * 2.0;
                let r2 = u * u + v * v;
                c = mul(c, 1.0 - 0.26 * smooth(0.55, 2.0, r2));
                c = mix(c, [158.0, 118.0, 72.0], 0.10 * smooth(0.7, 2.0, r2));
            }

            let o = idx * 3;
            buf[o] = c[0].round().clamp(0.0, 255.0) as u8;
            buf[o + 1] = c[1].round().clamp(0.0, 255.0) as u8;
            buf[o + 2] = c[2].round().clamp(0.0, 255.0) as u8;
        }
    }
    drop((river_in, river_out, fup, lakeup, eup, dup, glacier, crup, cgup, cbup));

    // --- иконки гор ---
    if look.icons {
        let spacing = 31.0 * sf * look.icon_scale.max(0.5);
        let e_min = percentile(&land_e, 0.95);
        let peaks = place_peaks(p, s, e_min, e_hi, spacing, look.icon_scale);
        for pk in &peaks {
            draw_peak(&mut buf, ww, hh, pk, s as f32, &look);
        }
    }

    // --- дороги, морские пути, города (политическая карта) ---
    if look.political {
        let mut roads = Layer::new(ww, hh);
        let mut lanes = Layer::new(ww, hh);
        for tr in &p.civilization.trade_routes {
            if tr.cells.len() < 2 {
                continue;
            }
            let mut pts: Vec<[f32; 2]> = Vec::with_capacity(tr.cells.len());
            let mut ux = 0.0f32;
            let mut prev = (tr.cells[0] % w) as isize;
            for (k, &cell) in tr.cells.iter().enumerate() {
                let cx = (cell % w) as isize;
                if k == 0 {
                    ux = cx as f32 + 0.5;
                } else {
                    let mut dx = cx - prev;
                    if dx > (w / 2) as isize {
                        dx -= w as isize;
                    } else if dx < -((w / 2) as isize) {
                        dx += w as isize;
                    }
                    ux += dx as f32;
                }
                prev = cx;
                pts.push([ux * s as f32, ((cell / w) as f32 + 0.5) * s as f32]);
            }
            let mut i = 0;
            while i < tr.segments.len() {
                let kind = tr.segments[i];
                let mut j = i;
                while j + 1 < tr.segments.len() && tr.segments[j + 1] == kind {
                    j += 1;
                }
                let run = chaikin(&pts[i..=(j + 1).min(pts.len() - 1)], 2);
                match kind {
                    RouteKind::Road => roads.dashed_wrapped(&run, 1.0 * sf, 8.0 * sf, 5.0 * sf),
                    RouteKind::SeaLane => lanes.dashed_wrapped(&run, 0.7 * sf, 5.0 * sf, 7.0 * sf),
                    RouteKind::Riverway => {}
                }
                i = j + 1;
            }
        }
        composite_layer(&mut buf, &lanes, c3(238, 248, 250), 0.80);
        composite_layer(&mut buf, &roads, c3(120, 82, 50), 0.88);
        drop((roads, lanes));

        for st in &p.civilization.settlements {
            let cx = ((st.cell % w) as f32 + 0.5) * s as f32;
            let cy = ((st.cell / w) as f32 + 0.5) * s as f32;
            let capital = st.role == SettlementRole::Capital;
            let r = if capital { 6.2 * sf } else { 3.9 * sf };
            for off in [-(ww as f32), 0.0, ww as f32] {
                let x = cx + off;
                if x < -r - 2.0 || x > ww as f32 + r + 2.0 {
                    continue;
                }
                fill_circle(&mut buf, ww, hh, x + 0.8 * sf, cy + 1.0 * sf, r + 0.6 * sf, c3(20, 20, 20), 0.28);
                fill_circle(&mut buf, ww, hh, x, cy, r + 1.2 * sf, c3(58, 42, 32), 1.0);
                fill_circle(&mut buf, ww, hh, x, cy, r, if capital { c3(252, 216, 92) } else { c3(250, 244, 228) }, 1.0);
                if capital {
                    fill_circle(&mut buf, ww, hh, x, cy, r * 0.38, c3(58, 42, 32), 1.0);
                }
            }
        }
    }

    // --- пергамент: рамка ---
    if look.parchment {
        let ink = c3(72, 50, 34);
        let inset = (16.0 * sf) as isize;
        let (x0, y0, x1, y1) = (inset, inset, ww as isize - 1 - inset, hh as isize - 1 - inset);
        let thick = [(0isize, 2.4f32 * sf), (6, 1.0 * sf)];
        for (d, t) in thick {
            let t = t.max(1.0);
            let ti = t.ceil() as isize;
            for k in 0..ti {
                for x in (x0 + d)..=(x1 - d) {
                    blend_px(&mut buf, ww, hh, x, y0 + d + k, ink, 0.9);
                    blend_px(&mut buf, ww, hh, x, y1 - d - k, ink, 0.9);
                }
                for y in (y0 + d)..=(y1 - d) {
                    blend_px(&mut buf, ww, hh, x0 + d + k, y, ink, 0.9);
                    blend_px(&mut buf, ww, hh, x1 - d - k, y, ink, 0.9);
                }
            }
        }
    }

    Image { w: ww, h: hh, rgb: buf }
}
