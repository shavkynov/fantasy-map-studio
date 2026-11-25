//! Стиль «Рисунок пером»: чёрно-белая карта, нарисованная тушью от руки, без цветов и сепии.
//!
//! Растр сначала собирается обычным конвейером в палитре экспедиционного атласа (берега, русла,
//! дороги и границы получаются тёмными линиями). Здесь он пересобирается в штриховку:
//! линии контуров остаются линиями, вода получает волновые штрихи, рельеф и биомы — штриховку и пунктир.

use crate::assets::{AssetPack, Sprite};
use crate::terrain::SampledGrid;

const PAPER: f64 = 247.0;
const INK: f64 = 24.0;

fn ihash(x: i64, y: i64) -> u32 {
    let mut h = (x as u32).wrapping_mul(0x9E37_79B1) ^ (y as u32).wrapping_mul(0x85EB_CA77);
    h ^= h >> 15;
    h = h.wrapping_mul(0x2C1B_3C6D);
    h ^= h >> 12;
    h = h.wrapping_mul(0x297A_2D39);
    h ^ (h >> 15)
}

fn hf(x: i64, y: i64) -> f64 {
    (ihash(x, y) & 0xFFFF) as f64 / 65535.0
}

fn luma(rgb: &[u8], i: usize) -> f64 {
    0.299 * rgb[3 * i] as f64 + 0.587 * rgb[3 * i + 1] as f64 + 0.114 * rgb[3 * i + 2] as f64
}

/// Накладывает штрих с покрытием `a` (0..1) на накопленное покрытие чернил.
fn over(acc: f64, a: f64) -> f64 {
    1.0 - (1.0 - acc) * (1.0 - a.clamp(0.0, 1.0))
}

/// Пересобирает уже закрашенный растр (рельеф, реки, дороги, границы) в чёрно-белую пером-штриховку.
/// Вызывается до расстановки спрайтов.
pub(crate) fn ink_terrain_pass(rgb: &mut [u8], grid: &SampledGrid, paper_tex: &[u8], river_dist: &[f32], road_dist: &[f32]) {
    let w = grid.w;
    let h = grid.h;
    let us = grid.ui_scale.max(0.35);
    let src: Vec<f64> = (0..w * h).map(|i| luma(rgb, i)).collect();
    let hs = (2.0 * us).round().max(1.0) as isize;
    let z_exag = if grid.is_world { 11.5 } else { 15.5 };
    // шаг штриховки в пикселях
    let hatch_p = (4.2 * us).round().max(3.0) as i64;
    let wob = 0.9 * us;

    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let tex = (paper_tex[(y & 511) * 512 + (x & 511)] as f64 - 128.0) / 14.0;
            if grid.inside[i] == 0 {
                let v = (PAPER + tex * 1.2).clamp(0.0, 255.0) as u8;
                rgb[3 * i..3 * i + 3].copy_from_slice(&[v, v, v]);
                continue;
            }
            let xi = x as i64;
            let yi = y as i64;
            let cm = grid.cloud_mottle[i] as f64;
            let cd = grid.coast_dist[i] as f64;
            let is_land = grid.is_land[i] != 0 && grid.is_lake[i] == 0;
            let is_lake = grid.is_lake[i] != 0;
            let mut ink = 0.0f64;

            // 1. Контурные линии (берега, русла, границы): ищем тёмные пиксели в исходнике с «дрожанием руки»
            let dx = (wob * (yi as f64 * 0.21 + xi as f64 * 0.05).sin()).round() as isize;
            let dy = (wob * (xi as f64 * 0.19 - yi as f64 * 0.04).sin()).round() as isize;
            let sx = (x as isize + dx).clamp(0, w as isize - 1) as usize;
            let sy = (y as isize + dy).clamp(0, h as isize - 1) as usize;
            let l = src[sy * w + sx];
            let line = ((96.0 - l) / 40.0).clamp(0.0, 1.0);
            ink = over(ink, line * 0.97);

            if !is_land {
                // 2. Вода: береговая линия пером и волновые контуры вдоль берега с разрывами
                let cdw = cd / us + 0.9 * cm;
                let shore = (1.0 - (cd / us + 0.35 * cm - 0.75).max(0.0) / 0.55).clamp(0.0, 1.0);
                ink = over(ink, shore * 0.96);
                let mut ring = 0.0f64;
                for &(pos, hw) in &[(2.6, 0.42), (5.2, 0.40), (8.6, 0.36), (13.2, 0.34)] {
                    ring = ring.max((1.0 - (cdw - pos).abs() / hw).clamp(0.0, 1.0));
                }
                let gate = hf(xi / (7 * us.round().max(1.0) as i64), yi / (7 * us.round().max(1.0) as i64));
                if !is_lake || cd > 1.5 * us {
                    if gate > 0.28 {
                        ink = over(ink, ring * 0.78);
                    }
                }
                // 3. Короткие волновые штрихи в открытом океане
                if !is_lake && cd > 15.0 * us && grid.polar_ice[i] == 0 {
                    let cw = (17.0 * us).round().max(8.0) as i64;
                    let ch = (11.0 * us).round().max(6.0) as i64;
                    let cx = xi.div_euclid(cw);
                    let cy = yi.div_euclid(ch);
                    let r = hf(cx, cy);
                    if r < 0.32 {
                        let x0 = cx * cw + (hf(cx + 91, cy) * 0.4 * cw as f64) as i64;
                        let len = (0.45 * cw as f64 + hf(cx, cy + 53) * 0.2 * cw as f64) as i64;
                        let y0 = cy * ch + (ch / 2) + ((hf(cx + 7, cy + 3) - 0.5) * 0.5 * ch as f64) as i64;
                        let t = xi - x0;
                        if t >= 0 && t < len {
                            let yy = y0 + ((t as f64 * 0.55).sin() * 0.9 * us).round() as i64;
                            if yi == yy {
                                ink = over(ink, 0.82);
                            }
                        }
                    }
                }
                // 4. Полярные льды: частый пунктир-крапинка
                if !is_lake && grid.polar_ice[i] != 0 && hf(xi, yi) < 0.10 {
                    ink = over(ink, 0.8);
                }
            } else {
                // 5. Рельеф: косая штриховка на теневых склонах (солнце с северо-запада)
                let e = grid.elev[i] as f64;
                let at = |xx: isize, yy: isize| -> f64 {
                    let xx = xx.clamp(0, w as isize - 1) as usize;
                    let yy = yy.clamp(0, h as isize - 1) as usize;
                    let j = yy * w + xx;
                    if grid.inside[j] != 0 { grid.elev[j] as f64 } else { e }
                };
                let (xs, ys) = (x as isize, y as isize);
                let dz_dx = (at(xs + hs, ys) - at(xs - hs, ys)) / (2 * hs) as f64 * us;
                let dz_dy = (at(xs, ys + hs) - at(xs, ys - hs)) / (2 * hs) as f64 * us;
                let illum = ((0.7071 * dz_dx + 0.7071 * dz_dy) * z_exag).tanh();
                let shade = (-illum - 0.10).max(0.0);
                if shade > 0.0 && e > 0.12 {
                    let jit = (hf(xi >> 3, yi >> 3) * 2.0) as i64;
                    let on1 = (xi + yi + jit).rem_euclid(hatch_p) == 0;
                    let on2 = (xi - yi + jit).rem_euclid(hatch_p) == 0;
                    let broken = hf(xi >> 2, yi >> 2) > 0.18;
                    if broken && (on1 || (shade > 0.42 && on2)) {
                        ink = over(ink, (0.55 + shade).min(0.92));
                    }
                }
                // 6. Биомы: лес — точки, болота — штрихи, пустыни — редкий крап
                let f_cov = grid.forest_cov[i] as f64;
                let w_cov = grid.wetland_cov[i] as f64;
                let glac = grid.glacier[i] as f64;
                let arid = grid.aridity[i] as f64;
                if glac < 0.25 {
                    if w_cov > 0.30 && yi % (3 * hatch_p / 2).max(2) == 0 && ((xi * 3 + yi * 7).rem_euclid(13) < 6) {
                        ink = over(ink, 0.65);
                    }
                    if arid > 0.30 && hf(xi * 3 + 1, yi * 5 + 2) < (arid - 0.25) * 0.05 {
                        ink = over(ink, 0.75);
                    }
                    if f_cov > 0.10 && hf(xi * 7 + 5, yi * 3 + 1) < f_cov * 0.03 {
                        ink = over(ink, 0.75);
                    }
                }
                if grid.is_salt_flat[i] != 0 && hf(xi * 5 + 2, yi * 11 + 6) < 0.05 {
                    ink = over(ink, 0.7);
                }
                // 7. Дороги: пунктир
                if road_dist[i] < 0.9 * us as f32 && river_dist[i] > 2.0 * us as f32 {
                    let seg = (xi + yi) / (4 * us.round().max(1.0) as i64);
                    if seg % 2 == 0 {
                        ink = over(ink, 0.88);
                    }
                }
            }

            let ink = ink.clamp(0.0, 1.0);
            let paper = PAPER + tex * 1.4;
            let v = (paper * (1.0 - ink) + INK * ink).clamp(0.0, 255.0) as u8;
            rgb[3 * i..3 * i + 3].copy_from_slice(&[v, v, v]);
        }
    }
}

/// Переводит RGB-буфер в строгую шкалу серого (R = G = B).
pub(crate) fn desaturate(rgb: &mut [u8]) {
    for px in rgb.chunks_exact_mut(3) {
        let g = (0.299 * px[0] as f64 + 0.587 * px[1] as f64 + 0.114 * px[2] as f64).round() as u8;
        px[0] = g;
        px[1] = g;
        px[2] = g;
    }
}

fn ink_sprite(sp: &mut Sprite) {
    for p in sp.rgba.chunks_exact_mut(4) {
        let g = (0.299 * p[0] as f64 + 0.587 * p[1] as f64 + 0.114 * p[2] as f64) / 255.0;
        // резкая кривая: свет → бумага, тень → тушь
        let t = ((g - 0.20) / 0.62).clamp(0.0, 1.0);
        let s = t * t * (3.0 - 2.0 * t);
        let v = (INK + (PAPER - INK) * s).round() as u8;
        p[0] = v;
        p[1] = v;
        p[2] = v;
    }
}

impl AssetPack {
    /// Копия набора спрайтов, переведённая в контрастную чёрно-белую графику.
    pub fn ink_variant(&self) -> AssetPack {
        let mut p = self.clone();
        for sp in p
            .mountains
            .iter_mut()
            .chain(p.broadleaf.iter_mut())
            .chain(p.pines.iter_mut())
            .chain(p.autumn.iter_mut())
        {
            ink_sprite(sp);
        }
        for sp in [&mut p.capital, &mut p.town, &mut p.port, &mut p.fortress, &mut p.watchtower, &mut p.bridge, &mut p.hill, &mut p.compass] {
            ink_sprite(sp);
        }
        p
    }
}

fn gray_u8(r: f64, g: f64, b: f64) -> u8 {
    (0.299 * r + 0.587 * g + 0.114 * b).round().clamp(0.0, 255.0) as u8
}

/// Заменяет все цветовые литералы SVG (`#rrggbb`, `#rgb`, `rgb()`, `rgba()`) их серыми эквивалентами.
pub(crate) fn grayscale_svg(svg: &str) -> String {
    let b = svg.as_bytes();
    let mut out = String::with_capacity(svg.len());
    let mut i = 0usize;
    let mut last = 0usize;
    while i < b.len() {
        let c = b[i];
        if c == b'#' {
            let prev = svg[..i].chars().last().unwrap_or(' ');
            let in_url = svg[..i].ends_with("url(") || svg[..i].ends_with("href=\"");
            if !in_url && (prev == '"' || prev == '\'' || prev == ' ' || prev == ':' || prev == '(') {
                let mut n = 0;
                while i + 1 + n < b.len() && b[i + 1 + n].is_ascii_hexdigit() {
                    n += 1;
                }
                let next_ok = i + 1 + n >= b.len() || !(b[i + 1 + n] as char).is_ascii_alphanumeric();
                if next_ok && (n == 6 || n == 3) {
                    let hx = &svg[i + 1..i + 1 + n];
                    let comp = |k: usize| -> f64 {
                        if n == 6 {
                            u8::from_str_radix(&hx[2 * k..2 * k + 2], 16).unwrap_or(0) as f64
                        } else {
                            (u8::from_str_radix(&hx[k..k + 1], 16).unwrap_or(0) as f64) * 17.0
                        }
                    };
                    let g = gray_u8(comp(0), comp(1), comp(2));
                    out.push_str(&svg[last..i]);
                    out.push_str(&format!("#{g:02x}{g:02x}{g:02x}"));
                    i += 1 + n;
                    last = i;
                    continue;
                }
            }
        } else if (c == b'r') && (svg[i..].starts_with("rgba(") || svg[i..].starts_with("rgb(")) {
            let open = svg[i..].find('(').unwrap() + i;
            if let Some(close_rel) = svg[open..].find(')') {
                let close = open + close_rel;
                let parts: Vec<&str> = svg[open + 1..close].split(',').map(|p| p.trim()).collect();
                if parts.len() >= 3 {
                    if let (Ok(r), Ok(g), Ok(bl)) = (parts[0].parse::<f64>(), parts[1].parse::<f64>(), parts[2].parse::<f64>()) {
                        let v = gray_u8(r, g, bl);
                        out.push_str(&svg[last..i]);
                        if parts.len() >= 4 {
                            out.push_str(&format!("rgba({v},{v},{v},{})", parts[3]));
                        } else {
                            out.push_str(&format!("rgb({v},{v},{v})"));
                        }
                        i = close + 1;
                        last = i;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    out.push_str(&svg[last..]);
    out
}
