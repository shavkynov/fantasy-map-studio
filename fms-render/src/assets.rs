#![allow(dead_code)]
//! Загрузчик иллюстрированного пакета спрайтов и текстуры бумаги.

use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};

/// Растровый спрайт с точкой опоры (straight RGBA).
#[derive(Clone)]
pub struct Sprite {
    pub w: usize,
    pub h: usize,
    pub anchor_x: f64,
    pub anchor_y: f64,
    pub rgba: Vec<u8>,
}

/// Полный иллюстрированный набор ассетов: горы, леса, постройки, мосты, роза ветров и бумага.
#[derive(Clone)]
pub struct AssetPack {
    pub mountains: Vec<Sprite>,
    pub broadleaf: Vec<Sprite>,
    pub pines: Vec<Sprite>,
    pub autumn: Vec<Sprite>,
    pub capital: Sprite,
    pub town: Sprite,
    pub port: Sprite,
    pub fortress: Sprite,
    pub watchtower: Sprite,
    pub bridge: Sprite,
    pub hill: Sprite,
    pub compass: Sprite,
    /// Бесшовная тайловая текстура бумаги 512x512 (центрирована вокруг 128).
    pub paper_tex: Vec<u8>,
}

fn load_sprite(path: &Path) -> Result<Sprite, String> {
    let mut f = File::open(path).map_err(|e| format!("Не удалось открыть спрайт {}: {e}", path.display()))?;
    let mut hdr = [0u8; 16];
    f.read_exact(&mut hdr)
        .map_err(|e| format!("Ошибка заголовка {}: {e}", path.display()))?;
    let w = u32::from_le_bytes(hdr[0..4].try_into().unwrap()) as usize;
    let h = u32::from_le_bytes(hdr[4..8].try_into().unwrap()) as usize;
    let anchor_x = f32::from_le_bytes(hdr[8..12].try_into().unwrap()) as f64;
    let anchor_y = f32::from_le_bytes(hdr[12..16].try_into().unwrap()) as f64;
    let mut rgba = vec![0u8; w * h * 4];
    f.read_exact(&mut rgba)
        .map_err(|e| format!("Ошибка чтения пикселей {}: {e}", path.display()))?;
    Ok(Sprite {
        w,
        h,
        anchor_x,
        anchor_y,
        rgba,
    })
}

fn resolve_default_assets_dir() -> Result<PathBuf, String> {
    let mut candidates = Vec::new();
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("../Resources/assets"));
            candidates.push(dir.join("assets"));
        }
    }
    candidates.push(PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/assets")));
    candidates.push(PathBuf::from("fms-render/assets"));
    candidates.push(PathBuf::from("assets"));
    for p in &candidates {
        if p.join("paper_tex.bin").is_file() && p.join("sprites/capital_0.rgba").is_file() {
            return Ok(p.clone());
        }
    }
    Err(format!(
        "Каталог ассетов не найден; проверены пути: {}",
        candidates
            .iter()
            .map(|p| p.display().to_string())
            .collect::<Vec<_>>()
            .join(", ")
    ))
}

impl AssetPack {
    /// Возвращает пустой набор ассетов (для автономного запуска классического векторно-растрового рендерера без внешнего каталога `assets/`).
    pub fn empty() -> Self {
        let dummy = Sprite {
            w: 1,
            h: 1,
            anchor_x: 0.0,
            anchor_y: 0.0,
            rgba: vec![0, 0, 0, 0],
        };
        Self {
            mountains: Vec::new(),
            broadleaf: Vec::new(),
            pines: Vec::new(),
            autumn: Vec::new(),
            capital: dummy.clone(),
            town: dummy.clone(),
            port: dummy.clone(),
            fortress: dummy.clone(),
            watchtower: dummy.clone(),
            bridge: dummy.clone(),
            hill: dummy.clone(),
            compass: dummy,
            paper_tex: vec![128; 512 * 512],
        }
    }

    /// Загружает штатный пакет ассетов или возвращает пустой `AssetPack::empty()`, если папка `assets/` отсутствует рядом с бинарником.
    pub fn load_default_or_empty() -> Self {
        Self::load_default().unwrap_or_else(|_| Self::empty())
    }

    /// Загружает штатный пакет ассетов из каталога `fms-render/assets`.
    pub fn load_default() -> Result<Self, String> {
        let dir = resolve_default_assets_dir()?;
        Self::load_dir(&dir)
    }

    /// Загружает пакет ассетов из указанной директории.
    pub fn load_dir(dir: &Path) -> Result<Self, String> {
        let spr = dir.join("sprites");
        let mountains = (0..9)
            .map(|i| load_sprite(&spr.join(format!("mountain_{i}.rgba"))))
            .collect::<Result<Vec<_>, _>>()?;
        let broadleaf = (0..8)
            .map(|i| load_sprite(&spr.join(format!("broadleaf_{i}.rgba"))))
            .collect::<Result<Vec<_>, _>>()?;
        let pines = (0..2)
            .map(|i| load_sprite(&spr.join(format!("pine_{i}.rgba"))))
            .collect::<Result<Vec<_>, _>>()?;
        let autumn = (0..2)
            .map(|i| load_sprite(&spr.join(format!("autumn_{i}.rgba"))))
            .collect::<Result<Vec<_>, _>>()?;

        let mut paper_tex = Vec::with_capacity(512 * 512);
        File::open(dir.join("paper_tex.bin"))
            .and_then(|mut f| f.read_to_end(&mut paper_tex))
            .map_err(|e| format!("Ошибка чтения paper_tex.bin: {e}"))?;
        if paper_tex.len() != 512 * 512 {
            return Err(format!("Некорректный размер paper_tex.bin: {}", paper_tex.len()));
        }

        Ok(Self {
            mountains,
            broadleaf,
            pines,
            autumn,
            capital: load_sprite(&spr.join("capital_0.rgba"))?,
            town: load_sprite(&spr.join("town_0.rgba"))?,
            port: load_sprite(&spr.join("port_0.rgba"))?,
            fortress: load_sprite(&spr.join("fortress_0.rgba"))?,
            watchtower: load_sprite(&spr.join("watchtower_0.rgba"))?,
            bridge: load_sprite(&spr.join("bridge_0.rgba"))?,
            hill: load_sprite(&spr.join("hill_0.rgba"))?,
            compass: load_sprite(&spr.join("compass_0.rgba"))?,
            paper_tex,
        })
    }

    /// Создаёт копию набора спрайтов в графике графитового карандаша на тёплом пергаменте.
    pub fn sketch_variant(&self) -> Self {
        Self {
            mountains: self.mountains.iter().map(sketch_sprite).collect(),
            broadleaf: self.broadleaf.iter().map(sketch_sprite).collect(),
            pines: self.pines.iter().map(sketch_sprite).collect(),
            autumn: self.autumn.iter().map(sketch_sprite).collect(),
            capital: sketch_sprite(&self.capital),
            town: sketch_sprite(&self.town),
            port: sketch_sprite(&self.port),
            fortress: sketch_sprite(&self.fortress),
            watchtower: sketch_sprite(&self.watchtower),
            bridge: sketch_sprite(&self.bridge),
            hill: sketch_sprite(&self.hill),
            compass: sketch_sprite(&self.compass),
            paper_tex: self.paper_tex.clone(),
        }
    }
}

/// Преобразует цветной RGBA-спрайт в мягкую карандашную штриховку на тёплом пергаменте
/// с сохранением штрихового контура и полной чистотой альфа-канала.
pub(crate) fn sketch_sprite(sp: &Sprite) -> Sprite {
    let mut out = sp.rgba.clone();
    let w = sp.w;
    let h = sp.h;
    let luma_at = |x: usize, y: usize, fallback: f64| -> f64 {
        let i = (y * w + x) * 4;
        if sp.rgba[i + 3] <= 20 {
            return fallback;
        }
        (0.299 * sp.rgba[i] as f64 + 0.587 * sp.rgba[i + 1] as f64 + 0.114 * sp.rgba[i + 2] as f64) / 255.0
    };
    for y in 0..h {
        let ym = y.saturating_sub(1);
        let yp = (y + 1).min(h - 1);
        for x in 0..w {
            let i = (y * w + x) * 4;
            if sp.rgba[i + 3] == 0 {
                continue;
            }
            let g = (0.299 * sp.rgba[i] as f64 + 0.587 * sp.rgba[i + 1] as f64 + 0.114 * sp.rgba[i + 2] as f64) / 255.0;
            let xm = x.saturating_sub(1);
            let xp = (x + 1).min(w - 1);
            let edge = ((luma_at(xp, y, g) - luma_at(xm, y, g)).abs()
                + (luma_at(x, yp, g) - luma_at(x, ym, g)).abs())
            .min(1.0);
            let l_fill = 0.24 + 0.76 * g;
            let t_dark = ((g - 0.08) / 0.26).clamp(0.0, 1.0);
            let dark_t = t_dark * t_dark * (3.0 - 2.0 * t_dark);
            let tone = (l_fill * (1.0 - 0.38 * edge)).min(0.14 + 0.86 * dark_t).clamp(0.0, 1.0);
            let col = if tone < 0.55 {
                lerp_rgb([52.0, 47.0, 40.0], [172.0, 164.0, 148.0], tone / 0.55)
            } else {
                lerp_rgb([172.0, 164.0, 148.0], [243.0, 237.0, 220.0], (tone - 0.55) / 0.45)
            };
            let u8c = rgb_to_u8(col);
            out[i] = u8c[0];
            out[i + 1] = u8c[1];
            out[i + 2] = u8c[2];
        }
    }
    Sprite {
        w: sp.w,
        h: sp.h,
        anchor_x: sp.anchor_x,
        anchor_y: sp.anchor_y,
        rgba: out,
    }
}

#[inline]
pub(crate) fn lerp_rgb(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    let t = t.clamp(0.0, 1.0);
    [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
        a[2] + (b[2] - a[2]) * t,
    ]
}

#[inline]
pub(crate) fn rgb_to_u8(c: [f64; 3]) -> [u8; 3] {
    [
        c[0].round().clamp(0.0, 255.0) as u8,
        c[1].round().clamp(0.0, 255.0) as u8,
        c[2].round().clamp(0.0, 255.0) as u8,
    ]
}

/// Накладывает straight-RGBA спрайт с билинейной фильтрацией, контактной тенью и мягкой тонировкой.
#[allow(clippy::too_many_arguments)]
pub(crate) fn blit_sprite(
    rgb: &mut [u8],
    cw: usize,
    clip: [usize; 4],
    sp: &Sprite,
    dst_x: f64,
    dst_y: f64,
    scale: f64,
    flip_x: bool,
    tint: [f64; 3],
    tint_amt: f64,
    shadow_alpha: f64,
) {
    let sw = sp.w as f64;
    let sh = sp.h as f64;
    let inv_s = 1.0 / scale.max(1e-3);
    let dx_s = 3.2 * scale;
    let dy_s = 2.4 * scale;

    let sample_rgba = |u: f64, v: f64| -> [f64; 4] {
        let su = if flip_x { sw - 1.0 - u } else { u };
        let x0 = su.floor() as isize;
        let y0 = v.floor() as isize;
        let tx = su - x0 as f64;
        let ty = v - y0 as f64;
        let get = |x: isize, y: isize| -> [f64; 4] {
            if x < 0 || x >= sp.w as isize || y < 0 || y >= sp.h as isize {
                return [0.0; 4];
            }
            let p = &sp.rgba[4 * (y as usize * sp.w + x as usize)..];
            [p[0] as f64, p[1] as f64, p[2] as f64, p[3] as f64 / 255.0]
        };
        let p00 = get(x0, y0);
        let p10 = get(x0 + 1, y0);
        let p01 = get(x0, y0 + 1);
        let p11 = get(x0 + 1, y0 + 1);
        let w00 = p00[3] * (1.0 - tx) * (1.0 - ty);
        let w10 = p10[3] * tx * (1.0 - ty);
        let w01 = p01[3] * (1.0 - tx) * ty;
        let w11 = p11[3] * tx * ty;
        let wsum = w00 + w10 + w01 + w11;
        if wsum <= 1e-4 {
            return [0.0; 4];
        }
        [
            (p00[0] * w00 + p10[0] * w10 + p01[0] * w01 + p11[0] * w11) / wsum,
            (p00[1] * w00 + p10[1] * w10 + p01[1] * w01 + p11[1] * w11) / wsum,
            (p00[2] * w00 + p10[2] * w10 + p01[2] * w01 + p11[2] * w11) / wsum,
            wsum,
        ]
    };

    let min_x = ((dst_x - sp.anchor_x * scale - 2.0).floor() as isize).max(clip[0] as isize) as usize;
    let max_x = ((dst_x + (sw - sp.anchor_x) * scale + dx_s + 2.0).ceil() as isize).min(clip[2] as isize) as usize;
    let min_y = ((dst_y - sp.anchor_y * scale - 2.0).floor() as isize).max(clip[1] as isize) as usize;
    let max_y = ((dst_y + (sh - sp.anchor_y) * scale + dy_s + 2.0).ceil() as isize).min(clip[3] as isize) as usize;

    if shadow_alpha > 0.005 {
        for py in min_y..max_y {
            let v = (py as f64 - (dst_y + dy_s)) * inv_s + sp.anchor_y;
            if v < 0.0 || v >= sh - 1.0 {
                continue;
            }
            for px in min_x..max_x {
                let u = (px as f64 - (dst_x + dx_s)) * inv_s + sp.anchor_x;
                if u < 0.0 || u >= sw - 1.0 {
                    continue;
                }
                let s = sample_rgba(u, v);
                let sa = (s[3] * shadow_alpha).clamp(0.0, 0.55);
                if sa <= 0.005 {
                    continue;
                }
                let i = (py * cw + px) * 3;
                let cur = [rgb[i] as f64, rgb[i + 1] as f64, rgb[i + 2] as f64];
                rgb[i..i + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, [26.0, 20.0, 14.0], sa)));
            }
        }
    }

    for py in min_y..max_y {
        let v = (py as f64 - dst_y) * inv_s + sp.anchor_y;
        if v < 0.0 || v >= sh - 1.0 {
            continue;
        }
        for px in min_x..max_x {
            let u = (px as f64 - dst_x) * inv_s + sp.anchor_x;
            if u < 0.0 || u >= sw - 1.0 {
                continue;
            }
            let s = sample_rgba(u, v);
            let a = s[3].clamp(0.0, 1.0);
            if a <= 0.005 {
                continue;
            }
            let src_col = lerp_rgb([s[0], s[1], s[2]], tint, tint_amt);
            let i = (py * cw + px) * 3;
            let cur = [rgb[i] as f64, rgb[i + 1] as f64, rgb[i + 2] as f64];
            rgb[i..i + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, src_col, a)));
        }
    }
}
