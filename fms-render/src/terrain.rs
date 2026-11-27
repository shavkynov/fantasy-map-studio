#![allow(dead_code)]
//! Вспомогательные структуры проекции, течений, климата и выбора региона (без внешних зависимостей).

use crate::proj::{wrap_lon_deg, RegionProj, WorldProj};
use fms_core::biomes::Biome;
use fms_core::planet::Planet;
use fms_core::region::RegionOptions;
use fms_core::rng::Rng;
use fms_core::toponymy::generate_proper_name;
use std::collections::HashSet;

/// Художественный стиль карты (классическая линейка Fantasy Map Studio 0.89.0).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    /// Классический экспедиционный стиль на состаренном пергаменте со штриховкой воды.
    Sepia,
    /// Монохромная тушь на светлой бумаге с тремя концентрическими ореолами у берега.
    Ink,
    /// Цветной гипсометрический рельеф с отмывкой, голубыми реками и зелёными лесами.
    Color,
}

impl Style {
    pub const ALL: [Style; 3] = [Style::Sepia, Style::Ink, Style::Color];

    pub fn slug(self) -> &'static str {
        match self {
            Style::Sepia => "sepia",
            Style::Ink => "ink",
            Style::Color => "color",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Style::Sepia => "Сепия",
            Style::Ink => "Ч/Б",
            Style::Color => "Цветной",
        }
    }

    pub fn from_slug(s: &str) -> Option<Self> {
        match s.trim().to_ascii_lowercase().as_str() {
            "sepia" | "expedition" | "atlas" => Some(Style::Sepia),
            "ink" | "bw" | "sketch" | "pencil" | "hand" => Some(Style::Ink),
            "color" | "colour" | "painted" | "vivid" | "game" => Some(Style::Color),
            _ => None,
        }
    }
}

/// Параметры рендеринга.
#[derive(Clone, Debug)]
pub struct RenderOptions {
    /// Стиль оформления.
    pub style: Style,
    /// Ширина выходного изображения в пикселях (`320..=4096`).
    pub target_width: usize,
    /// Необязательный заголовок (сохраняется для совместимости API).
    pub title: Option<String>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            style: Style::Sepia,
            target_width: 2200,
            title: None,
        }
    }
}

#[derive(Clone, Debug)]
pub struct OverlayRoute {
    pub is_sea: bool,
    pub pts: Vec<[f64; 2]>,
}

#[derive(Clone, Debug)]
pub struct SettlementPin {
    pub id: Option<u32>,
    pub name: String,
    pub subtitle: String,
    pub lat: f64,
    pub lon: f64,
    pub x: f64,
    pub y: f64,
    pub kind: &'static str,
    pub score: f64,
}

#[derive(Clone, Debug)]
pub struct WildSitePin {
    pub id: String,
    pub name: String,
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub lat: f64,
    pub lon: f64,
}

#[derive(Clone, Debug)]
pub struct DepositPin {
    pub x: f64,
    pub y: f64,
    pub kind: &'static str,
    pub label: &'static str,
    pub richness: f32,
}

#[derive(Clone, Debug)]
pub struct WaterfallPin {
    pub x: f64,
    pub y: f64,
    pub drop_m: f32,
    pub discharge_m3s: f32,
}

#[derive(Clone, Debug)]
pub struct PoiPin {
    pub id: String,
    pub kind: &'static str,
    pub name: String,
    pub x: f64,
    pub y: f64,
}

#[derive(Clone, Debug)]
pub struct MapLabel {
    pub text: String,
    pub kind: &'static str,
    pub x: f64,
    pub y: f64,
    pub prio: f64,
}

#[derive(Clone, Debug)]
pub struct OverlayModel {
    pub width: usize,
    pub height: usize,
    pub is_world: bool,
    pub style: Style,
    pub title: String,
    pub frame: [f64; 4],
    pub subtitle: String,
    pub graticule: Vec<Vec<[f64; 2]>>,
    pub routes: Vec<OverlayRoute>,
    pub settlements: Vec<SettlementPin>,
    pub wild_sites: Vec<WildSitePin>,
    pub deposits: Vec<DepositPin>,
    pub waterfalls: Vec<WaterfallPin>,
    pub pois: Vec<PoiPin>,
    pub labels: Vec<MapLabel>,
    pub currents: Vec<Vec<[f64; 3]>>,
    pub legend_realms: Vec<(String, [f64; 3])>,
    pub legend_rect: [f64; 4],
    pub seam_lon_deg: f64,
    pub center_lon_deg: f64,
    pub classic_svg_layers: String,
}

#[inline]
fn sample_bilinear_norm(field: &[f32], w: usize, h: usize, wrap_x: bool, gx: f64, gy: f64) -> f64 {
    let x0 = gx.floor() as isize;
    let y0 = gy.floor() as isize;
    let tx = gx - x0 as f64;
    let ty = gy - y0 as f64;
    let ix0 = if wrap_x { x0.rem_euclid(w as isize) as usize } else { x0.clamp(0, w as isize - 1) as usize };
    let ix1 = if wrap_x { (x0 + 1).rem_euclid(w as isize) as usize } else { (x0 + 1).clamp(0, w as isize - 1) as usize };
    let iy0 = y0.clamp(0, h as isize - 1) as usize;
    let iy1 = (y0 + 1).clamp(0, h as isize - 1) as usize;
    let f00 = field[iy0 * w + ix0] as f64;
    let f10 = field[iy0 * w + ix1] as f64;
    let f01 = field[iy1 * w + ix0] as f64;
    let f11 = field[iy1 * w + ix1] as f64;
    (f00 * (1.0 - tx) + f10 * tx) * (1.0 - ty) + (f01 * (1.0 - tx) + f11 * tx) * ty
}

pub(crate) struct SampledGrid {
    pub w: usize,
    pub h: usize,
    pub is_world: bool,
    pub ui_scale: f64,
    pub frame: [f64; 4],
    pub inside: Vec<u8>,
    pub elev: Vec<f32>,
    pub is_land: Vec<u8>,
    pub is_lake: Vec<u8>,
    pub is_salt_flat: Vec<u8>,
    pub polar_ice: Vec<u8>,
    pub glacier: Vec<f32>,
    pub aridity: Vec<f32>,
    pub forest_cov: Vec<f32>,
    pub wetland_cov: Vec<f32>,
    pub ink_bio: Vec<[f64; 3]>,
    pub cloud_mottle: Vec<f32>,
    pub realm_id: Vec<i32>,
    pub coast_dist: Vec<f32>,
    pub land_coast_dist: Vec<f32>,
    pub border_dist: Vec<f32>,
}

pub(crate) fn is_forest_biome(b: Biome) -> bool {
    matches!(
        b,
        Biome::BorealForest
            | Biome::TemperateForest
            | Biome::TemperateRainforest
            | Biome::TropicalRainforest
            | Biome::TropicalSeasonalForest
    )
}

pub(crate) fn pick_ocean_hub(sg: &SampledGrid, is_world: bool) -> Vec<[f64; 2]> {
    let [fx, fy, fw, fh] = sg.frame;
    if is_world {
        let sectors = [
            (fx + fw * 0.06, fx + fw * 0.34, fy + fh * 0.12, fy + fh * 0.46),
            (fx + fw * 0.35, fx + fw * 0.66, fy + fh * 0.45, fy + fh * 0.86),
            (fx + fw * 0.67, fx + fw * 0.92, fy + fh * 0.12, fy + fh * 0.56),
        ];
        let mut out = Vec::new();
        for &(x0, x1, y0, y1) in &sectors {
            let mut best = (0.0f32, (x0 + x1) * 0.5, (y0 + y1) * 0.5);
            for y in ((y0 as usize)..(y1 as usize).min(sg.h)).step_by(10) {
                for x in ((x0 as usize)..(x1 as usize).min(sg.w)).step_by(10) {
                    let i = y * sg.w + x;
                    if sg.inside[i] == 0 || sg.is_land[i] != 0 || sg.is_lake[i] != 0 {
                        continue;
                    }
                    if sg.coast_dist[i] > best.0 {
                        best = (sg.coast_dist[i], x as f64, y as f64);
                    }
                }
            }
            if best.0 >= (14.0 * sg.ui_scale as f32).max(5.0) {
                out.push([best.1, best.2]);
            }
        }
        return out;
    }
    vec![[fx + fw * 0.52, fy + fh * 0.78]]
}

const REF_PLAINS_KM: f64 = 0.4;

pub(crate) fn plains_shift_km(planet: &Planet) -> f64 {
    let mut v: Vec<(f64, f64)> = Vec::new();
    for i in 0..planet.erosion.elevation_km.len() {
        if planet.hydrology.is_ocean[i] != 0 || planet.hydrology.is_lake[i] != 0 {
            continue;
        }
        v.push((planet.erosion.elevation_km[i] as f64, planet.tectonic.cell_area[i]));
    }
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.0.total_cmp(&b.0));
    let total: f64 = v.iter().map(|x| x.1).sum();
    let mut acc = 0.0;
    let mut median = v[v.len() - 1].0;
    for &(e, a) in &v {
        acc += a;
        if acc >= total * 0.5 {
            median = e;
            break;
        }
    }
    (median - REF_PLAINS_KM).max(0.0)
}

pub(crate) fn trace_ocean_currents(
    planet: &Planet,
    grid: &SampledGrid,
    inv: impl Fn(f64, f64) -> Option<(f64, f64)>,
) -> Vec<Vec<[f64; 3]>> {
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let [fx, fy, fw, fh] = grid.frame;
    let us = grid.ui_scale;
    let d_sep: f64 = (if grid.is_world { 26.0 } else { 36.0 }) * us;
    let d_test: f64 = (if grid.is_world { 15.0 } else { 21.0 }) * us;
    let d_test2 = d_test * d_test;
    let d_self2 = (d_test * 0.7).powi(2);
    let d_seed2 = (d_sep * 0.85).powi(2);
    let cell = d_test.max(4.0);
    let cw = ((grid.w as f64 / cell).ceil() as usize) + 2;
    let ch = ((grid.h as f64 / cell).ceil() as usize) + 2;
    let mut bins: Vec<Vec<[f64; 2]>> = vec![Vec::new(); cw * ch];

    let near_any = |bins: &[Vec<[f64; 2]>], x: f64, y: f64, thresh2: f64| -> bool {
        let bx = (x / cell).floor().clamp(0.0, (cw - 1) as f64) as isize;
        let by = (y / cell).floor().clamp(0.0, (ch - 1) as f64) as isize;
        for yy in (by - 1).max(0)..=(by + 1).min(ch as isize - 1) {
            for xx in (bx - 1).max(0)..=(bx + 1).min(cw as isize - 1) {
                for &p in &bins[yy as usize * cw + xx as usize] {
                    if (p[0] - x).powi(2) + (p[1] - y).powi(2) < thresh2 {
                        return true;
                    }
                }
            }
        }
        false
    };
    let register = |bins: &mut [Vec<[f64; 2]>], x: f64, y: f64| {
        let bx = (x / cell).floor().clamp(0.0, (cw - 1) as f64) as usize;
        let by = (y / cell).floor().clamp(0.0, (ch - 1) as f64) as usize;
        bins[by * cw + bx].push([x, y]);
    };
    let sample_flow = |px: f64, py: f64| -> Option<(f64, f64, f64)> {
        let (lat_deg, lon_deg) = inv(px, py)?;
        let gx = ((lon_deg + 180.0).rem_euclid(360.0) / 360.0) * gw as f64 - 0.5;
        let gy = (((90.0 - lat_deg) / 180.0) * gh as f64 - 0.5).clamp(0.0, (gh - 1) as f64);
        let u_phys = sample_bilinear_norm(&planet.climate.current_u, gw, gh, true, gx, gy);
        let v_phys = sample_bilinear_norm(&planet.climate.current_v, gw, gh, true, gx, gy);
        let t_anom = sample_bilinear_norm(&planet.climate.current_temp, gw, gh, true, gx, gy);
        let (sx, sy) = if grid.is_world {
            let phi = lat_deg.to_radians();
            let p2 = phi * phi;
            let p4 = p2 * p2;
            let dyp = 1.0148 + 5.0 * 0.23185 * p4 - 7.0 * 0.14499 * p4 * p2 + 9.0 * 0.02406 * p4 * p4;
            let cl = phi.cos().abs().max(0.24);
            (u_phys / cl, v_phys * dyp)
        } else {
            (u_phys, v_phys)
        };
        Some((sx, sy, t_anom))
    };
    let margin = 1.5 * us;
    let is_valid_sea = |px: f64, py: f64, min_cd: f32| -> bool {
        if px < fx + margin || px > fx + fw - margin || py < fy + margin || py > fy + fh - margin {
            return false;
        }
        let i = (py as usize).min(grid.h - 1) * grid.w + (px as usize).min(grid.w - 1);
        grid.inside[i] != 0 && grid.is_land[i] == 0 && grid.polar_ice[i] == 0 && grid.coast_dist[i] >= min_cd
    };

    let ds = (5.0 * us).max(2.0);
    let integrate_branch = |bins: &[Vec<[f64; 2]>], other: &[[f64; 3]], sx: f64, sy: f64, dir: f64| -> Vec<[f64; 3]> {
        let mut pts: Vec<[f64; 3]> = Vec::with_capacity(68);
        let mut cx = sx;
        let mut cy = sy;
        for _ in 0..68 {
            let Some((u0, v0, t0)) = sample_flow(cx, cy) else { break; };
            let spd0 = u0.hypot(v0);
            if spd0 < 0.025 {
                break;
            }
            let mx = cx + dir * (u0 / spd0) * ds * 0.5;
            let my = cy + dir * (-v0 / spd0) * ds * 0.5;
            let (ux, vy, tm) = match sample_flow(mx, my) {
                Some((um, vm, tm)) if um.hypot(vm) >= 0.020 => (um, vm, tm),
                _ => (u0, v0, t0),
            };
            let spdm = ux.hypot(vy);
            let nx = cx + dir * (ux / spdm) * ds;
            let ny = cy + dir * (-vy / spdm) * ds;
            if !is_valid_sea(nx, ny, (4.0 * us) as f32) || near_any(bins, nx, ny, d_test2) {
                break;
            }
            let len = pts.len();
            let self_hit = len > 6 && pts[..(len - 6)].iter().any(|p| (p[0] - nx).powi(2) + (p[1] - ny).powi(2) < d_self2);
            let other_hit = other.len() > 4 && other[4..].iter().any(|p| (p[0] - nx).powi(2) + (p[1] - ny).powi(2) < d_self2);
            if self_hit || other_hit {
                break;
            }
            let (_, _, nt) = sample_flow(nx, ny).unwrap_or((ux, vy, tm));
            pts.push([nx, ny, nt]);
            cx = nx;
            cy = ny;
        }
        pts
    };

    let mut out = Vec::new();
    let mut row = 0usize;
    let mut sy = fy + 6.0 * us;
    while sy <= fy + fh - 6.0 * us {
        let mut sx = fx + 4.0 * us + if row % 2 == 1 { d_sep * 0.5 } else { 0.0 };
        while sx <= fx + fw - 4.0 * us {
            if is_valid_sea(sx, sy, (7.0 * us) as f32) && !near_any(&bins, sx, sy, d_seed2) {
                if let Some((u0, v0, t0)) = sample_flow(sx, sy) {
                    if u0.hypot(v0) >= 0.030 {
                        let fwd = integrate_branch(&bins, &[], sx, sy, 1.0);
                        let bwd = integrate_branch(&bins, &fwd, sx, sy, -1.0);
                        if fwd.len() + bwd.len() + 1 >= 7 {
                            let mut line = Vec::with_capacity(fwd.len() + bwd.len() + 1);
                            line.extend(bwd.into_iter().rev());
                            line.push([sx, sy, t0]);
                            line.extend(fwd);
                            for _ in 0..2 {
                                let prev = line.clone();
                                for k in 1..(line.len() - 1) {
                                    line[k][0] = 0.25 * prev[k - 1][0] + 0.5 * prev[k][0] + 0.25 * prev[k + 1][0];
                                    line[k][1] = 0.25 * prev[k - 1][1] + 0.5 * prev[k][1] + 0.25 * prev[k + 1][1];
                                }
                            }
                            for &p in &line {
                                register(&mut bins, p[0], p[1]);
                            }
                            let last = line.len() - 1;
                            let kept: Vec<[f64; 3]> = line
                                .into_iter()
                                .enumerate()
                                .filter(|&(k, _)| k == 0 || k == last || k % 2 == 0)
                                .map(|(_, p)| [p[0], p[1], (p[2] * 1.45).clamp(-1.0, 1.0)])
                                .collect();
                            out.push(kept);
                        }
                    }
                }
            }
            sx += d_sep;
        }
        sy += d_sep * 0.90;
        row += 1;
    }
    out
}

pub(crate) fn generate_world_ocean_labels(
    seed: &str,
    wg: &SampledGrid,
    w_legend_rect: [f64; 4],
    w_hubs: &[[f64; 2]],
) -> Vec<MapLabel> {
    let us = wg.ui_scale;
    let in_leg = |px: f64, py: f64| -> bool {
        px >= w_legend_rect[0] - 90.0 * us
            && px <= w_legend_rect[0] + w_legend_rect[2] + 90.0 * us
            && py >= w_legend_rect[1] - 34.0 * us
            && py <= w_legend_rect[1] + w_legend_rect[3] + 34.0 * us
    };
    let mut ocean_anchors: Vec<[f64; 2]> = Vec::new();
    let [wfx, wfy, wfw, wfh] = wg.frame;
    let mut best_w = (0.0f32, wfx + wfw * 0.25, wfy + wfh * 0.30);
    for y in ((wfy + wfh * 0.16) as usize..(wfy + wfh * 0.45) as usize).step_by(8) {
        for x in ((wfx + wfw * 0.15) as usize..(wfx + wfw * 0.36) as usize).step_by(8) {
            let i = y * wg.w + x;
            if wg.inside[i] == 0 || wg.is_land[i] != 0 || wg.is_lake[i] != 0 || in_leg(x as f64, y as f64) {
                continue;
            }
            if wg.coast_dist[i] > best_w.0 {
                best_w = (wg.coast_dist[i], x as f64, y as f64);
            }
        }
    }
    if best_w.0 >= (14.0 * us as f32).max(5.0) {
        ocean_anchors.push([best_w.1, best_w.2]);
    }
    let sep2 = (240.0 * us).powi(2);
    for &[hx, hy] in w_hubs {
        if !in_leg(hx, hy) && ocean_anchors.iter().all(|a| (a[0] - hx).powi(2) + (a[1] - hy).powi(2) > sep2) {
            ocean_anchors.push([hx, hy]);
        }
    }
    let mut ocean_used = HashSet::new();
    let mut ocean_rng = Rng::sub(seed, "atlas-oceans");
    ocean_anchors
        .into_iter()
        .take(3)
        .enumerate()
        .map(|(oc, [hx, hy])| {
            let stem = generate_proper_name((oc * 3 + 1) as u8, &mut ocean_rng, 2, 3, &mut ocean_used);
            let title = if oc == 0 { format!("Океан {stem}") } else { format!("Море {stem}") };
            MapLabel {
                text: title,
                kind: "ocean",
                x: hx,
                y: hy,
                prio: 960.0 - oc as f64 * 10.0,
            }
        })
        .collect()
}

/// Подбирает богатое окно для регионального масштаба (горы, леса, реки, залив и города).
pub fn choose_region_window(planet: &Planet) -> RegionOptions {
    let plains_shift = plains_shift_km(planet);
    let mut best_cell = planet.grid.len() / 2;
    let mut best_score = -1.0f64;
    let mut seed_pts: Vec<(f64, f64)> = planet
        .civilization
        .settlements
        .iter()
        .map(|s| {
            let (cx, cy) = planet.grid.xy(s.cell);
            (planet.grid.lat_deg(cy), planet.grid.lon_deg(cx))
        })
        .collect();
    if seed_pts.is_empty() {
        for lm in &planet.geography.landmasses {
            seed_pts.push((lm.center_lat_deg as f64, lm.center_lon_deg as f64));
        }
    }
    for y in 0..planet.grid.h {
        let lat = planet.grid.lat_deg(y);
        if lat.abs() > 54.0 {
            continue;
        }
        for x in 0..planet.grid.w {
            let idx = y * planet.grid.w + x;
            let lon = planet.grid.lon_deg(x);
            let (mut n_land, mut n_sea, mut n_riv, mut n_hi, mut n_for, mut n_lk, mut n_set) =
                (0, 0, 0, 0, 0, 0, 0);
            for &(slat, slon) in &seed_pts {
                if (slat - lat).abs() <= 14.0 && wrap_lon_deg(slon - lon).abs() <= 21.0 {
                    n_set += 1;
                }
            }
            let step_g = ((planet.grid.w as isize) / 90).max(2);
            for dy in (-3isize..=3).step_by(2) {
                let yy = (y as isize + dy * step_g).clamp(0, planet.grid.h as isize - 1) as usize;
                for dx in (-4isize..=4).step_by(2) {
                    let xx = (x as isize + dx * step_g).rem_euclid(planet.grid.w as isize) as usize;
                    let ii = yy * planet.grid.w + xx;
                    if planet.hydrology.is_ocean[ii] != 0 {
                        n_sea += 1;
                    } else if planet.hydrology.is_lake[ii] != 0 {
                        n_lk += 1;
                    } else {
                        n_land += 1;
                    }
                    if planet.hydrology.river_mask[ii] != 0 {
                        n_riv += 1;
                    }
                    if planet.erosion.elevation_km[ii] as f64 - plains_shift > 1.35 {
                        n_hi += 1;
                    }
                    if is_forest_biome(planet.biomes.biome[ii]) {
                        n_for += 1;
                    }
                }
            }
            let mtn_bonus = if n_hi >= 2 { 32.0 } else { 0.0 };
            let lake_pen = (n_lk - 2).max(0) as f64 * 8.0;
            let sc = (n_land.min(14) * n_sea.min(8)) as f64
                + n_riv as f64 * 4.5
                + n_hi.min(8) as f64 * 8.5
                + mtn_bonus
                + n_for.min(12) as f64 * 5.0
                + n_set.min(6) as f64 * 12.0
                - lake_pen;
            if sc > best_score {
                best_score = sc;
                best_cell = idx;
            }
        }
    }
    RegionOptions::around_cell(planet, best_cell, 26.0, 4)
}

#[allow(dead_code)]
fn _keep_unused_imports_silent() {
    let _ = (RegionProj::new, WorldProj::fit);
}
