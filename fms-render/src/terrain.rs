//! Ландшафтный и спрайтовый композитор карты мира и региона (без внешних зависимостей).

use crate::assets::{blit_sprite, lerp_rgb, rgb_to_u8, AssetPack, Sprite};
use crate::proj::{wrap_lon_deg, RegionProj, WorldProj};
use fms_core::biomes::Biome;
use fms_core::civilization::SettlementRole;
use fms_core::geography::LandmassKind;
use fms_core::planet::Planet;
use fms_core::region::{Region, RegionOptions};
use fms_core::rng::{Noise, Rng};
use fms_core::toponymy::generate_proper_name;
use std::collections::{HashSet, VecDeque};

/// Художественный стиль карты.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Style {
    /// Экспедиционный атлас: архивная палитра, физические течения океана, полярные льды, свитки и легенда.
    Expedition,
    /// Живописный фэнтези-атлас: сочные луга, лазурный океан и свитки городов.
    Painted,
}

impl Style {
    pub const ALL: [Style; 2] = [Style::Expedition, Style::Painted];

    pub fn slug(self) -> &'static str {
        match self {
            Style::Expedition => "expedition",
            Style::Painted => "painted",
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            Style::Expedition => "Экспедиционный атлас",
            Style::Painted => "Живописный атлас",
        }
    }

    pub fn from_slug(s: &str) -> Option<Self> {
        match s {
            "expedition" | "atlas" => Some(Style::Expedition),
            "painted" | "vivid" => Some(Style::Painted),
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
    /// Текстовый заголовок в шапке карты (если `None` — используется стандартное название стиля).
    pub title: Option<String>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            style: Style::Expedition,
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
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub kind: &'static str,
    pub score: f64,
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
    pub deposits: Vec<DepositPin>,
    pub waterfalls: Vec<WaterfallPin>,
    pub labels: Vec<MapLabel>,
    pub currents: Vec<Vec<[f64; 3]>>,
    pub legend_realms: Vec<(String, [f64; 3])>,
    pub legend_rect: [f64; 4],
    pub seam_lon_deg: f64,
    pub center_lon_deg: f64,
}

pub(crate) fn biome_painted_rgb(b: Biome) -> [f64; 3] {
    match b {
        Biome::TropicalRainforest => [86.0, 134.0, 48.0],
        Biome::TropicalSeasonalForest => [118.0, 152.0, 56.0],
        Biome::TropicalSavanna => [166.0, 168.0, 74.0],
        Biome::HotDesert => [206.0, 174.0, 108.0],
        Biome::ColdDesert => [180.0, 162.0, 122.0],
        Biome::TemperateGrassland => [156.0, 158.0, 78.0],
        Biome::Mediterranean => [138.0, 154.0, 66.0],
        Biome::TemperateForest => [124.0, 148.0, 54.0],
        Biome::TemperateRainforest => [96.0, 132.0, 54.0],
        Biome::BorealForest => [84.0, 108.0, 56.0],
        Biome::Tundra | Biome::PolarDesert => [144.0, 148.0, 118.0],
        Biome::Alpine => [136.0, 128.0, 112.0],
        Biome::IceSheet => [234.0, 238.0, 238.0],
        Biome::Wetland => [96.0, 124.0, 58.0],
        _ => [132.0, 150.0, 68.0],
    }
}

pub(crate) fn realm_archival_rgb(rid: i32) -> [f64; 3] {
    const PAL: [[f64; 3]; 6] = [
        [186.0, 112.0, 98.0],
        [108.0, 138.0, 158.0],
        [190.0, 154.0, 92.0],
        [128.0, 156.0, 114.0],
        [148.0, 112.0, 138.0],
        [178.0, 126.0, 94.0],
    ];
    PAL[(rid.max(0) as usize) % PAL.len()]
}

#[inline]
fn cubic_catmull(p0: f64, p1: f64, p2: f64, p3: f64, t: f64) -> f64 {
    let t2 = t * t;
    let t3 = t2 * t;
    0.5 * ((2.0 * p1)
        + (-p0 + p2) * t
        + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t2
        + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * t3)
}

fn sample_catmull(field: &[f32], w: usize, h: usize, wrap_x: bool, gx: f64, gy: f64) -> f64 {
    let x1 = gx.floor() as isize;
    let y1 = gy.floor() as isize;
    let tx = gx - x1 as f64;
    let ty = gy - y1 as f64;
    let idx_x = |x: isize| -> usize {
        if wrap_x {
            x.rem_euclid(w as isize) as usize
        } else {
            x.clamp(0, w as isize - 1) as usize
        }
    };
    let mut row = [0.0f64; 4];
    for j in 0..4 {
        let yy = (y1 + j as isize - 1).clamp(0, h as isize - 1) as usize;
        row[j] = cubic_catmull(
            field[yy * w + idx_x(x1 - 1)] as f64,
            field[yy * w + idx_x(x1)] as f64,
            field[yy * w + idx_x(x1 + 1)] as f64,
            field[yy * w + idx_x(x1 + 2)] as f64,
            tx,
        );
    }
    cubic_catmull(row[0], row[1], row[2], row[3], ty)
}

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

fn compute_dist_to_pred(w: usize, h: usize, inside: &[u8], is_seed: impl Fn(usize) -> bool) -> Vec<f32> {
    let n = w * h;
    let mut dist = vec![1e6f32; n];
    let mut q = VecDeque::with_capacity(n / 8);
    for i in 0..n {
        if inside[i] != 0 && is_seed(i) {
            dist[i] = 0.0;
            q.push_back(i);
        }
    }
    while let Some(c) = q.pop_front() {
        let d0 = dist[c];
        if d0 > 26.0 {
            continue;
        }
        let cx = c % w;
        let cy = c / w;
        for (dx, dy, step) in [
            (-1isize, 0isize, 1.0f32),
            (1, 0, 1.0),
            (0, -1, 1.0),
            (0, 1, 1.0),
            (-1, -1, 1.4142),
            (1, -1, 1.4142),
            (-1, 1, 1.4142),
            (1, 1, 1.4142),
        ] {
            let nx = cx as isize + dx;
            let ny = cy as isize + dy;
            if nx < 0 || nx >= w as isize || ny < 0 || ny >= h as isize {
                continue;
            }
            let nb = ny as usize * w + nx as usize;
            if inside[nb] == 0 {
                continue;
            }
            let nd = d0 + step;
            if nd + 1e-3 < dist[nb] {
                dist[nb] = nd;
                q.push_back(nb);
            }
        }
    }
    dist
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

fn blur_land_rgb_and_forest(
    w: usize,
    h: usize,
    wrap_x: bool,
    is_ocean: &[u8],
    r: &mut Vec<f32>,
    g: &mut Vec<f32>,
    b: &mut Vec<f32>,
    fc: &mut Vec<f32>,
) {
    for _ in 0..2 {
        let mut r2 = r.clone();
        let mut g2 = g.clone();
        let mut b2 = b.clone();
        let mut fc2 = fc.clone();
        for y in 0..h {
            for x in 0..w {
                let c = y * w + x;
                if is_ocean[c] != 0 {
                    continue;
                }
                let (mut s1, mut s2, mut s3, mut sf, mut ws) = (0.0f32, 0.0f32, 0.0f32, 0.0f32, 0.0f32);
                for dy in -1isize..=1 {
                    let ny = (y as isize + dy).clamp(0, h as isize - 1) as usize;
                    for dx in -1isize..=1 {
                        let nx = if wrap_x {
                            (x as isize + dx).rem_euclid(w as isize) as usize
                        } else {
                            (x as isize + dx).clamp(0, w as isize - 1) as usize
                        };
                        let nb = ny * w + nx;
                        if is_ocean[nb] != 0 {
                            continue;
                        }
                        let wt = if dx == 0 && dy == 0 { 4.0 } else if dx == 0 || dy == 0 { 2.0 } else { 1.0 };
                        s1 += r[nb] * wt;
                        s2 += g[nb] * wt;
                        s3 += b[nb] * wt;
                        sf += fc[nb] * wt;
                        ws += wt;
                    }
                }
                if ws > 0.0 {
                    r2[c] = s1 / ws;
                    g2[c] = s2 / ws;
                    b2[c] = s3 / ws;
                    fc2[c] = sf / ws;
                }
            }
        }
        *r = r2;
        *g = g2;
        *b = b2;
        *fc = fc2;
    }
}

fn vote_realm_id(planet: &Planet, gx_f: f64, gy_f: f64) -> i32 {
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let x0 = gx_f.floor() as isize;
    let y0 = gy_f.floor().clamp(0.0, (gh - 1) as f64) as usize;
    let tx = gx_f - gx_f.floor();
    let ty = (gy_f - y0 as f64).clamp(0.0, 1.0);
    let cx_b = (x0 + if tx >= 0.5 { 1 } else { 0 }).rem_euclid(gw as isize);
    let cy_b = (y0 + if ty >= 0.5 { 1 } else { 0 }).min(gh - 1) as isize;
    let mut votes: [(i32, f64); 9] = [(-999, 0.0); 9];
    let mut vlen = 0usize;
    for dy in -1isize..=1 {
        let yy = (cy_b + dy).clamp(0, gh as isize - 1) as usize;
        for dx in -1isize..=1 {
            let xx = (cx_b + dx).rem_euclid(gw as isize) as usize;
            let ci = yy * gw + xx;
            if planet.hydrology.is_ocean[ci] != 0 || planet.hydrology.is_lake[ci] != 0 {
                continue;
            }
            let vr = planet.civilization.realm_id[ci];
            let ddx = (cx_b + dx) as f64 - (x0 as f64 + tx);
            let ddy = yy as f64 - (y0 as f64 + ty);
            let mut wgt = (-(ddx * ddx + ddy * ddy) * 1.15).exp();
            if vr < 0 {
                wgt *= 0.85;
            }
            if let Some(pos) = votes[..vlen].iter().position(|v| v.0 == vr) {
                votes[pos].1 += wgt;
            } else if vlen < 9 {
                votes[vlen] = (vr, wgt);
                vlen += 1;
            }
        }
    }
    votes[..vlen].iter().max_by(|a, b| a.1.total_cmp(&b.1)).map(|b| b.0).unwrap_or(-1)
}

fn finalize_distances(
    w: usize,
    h: usize,
    inside: &[u8],
    is_land: &[u8],
    is_lake: &[u8],
    realm_id: &[i32],
) -> (Vec<f32>, Vec<f32>, Vec<f32>) {
    let coast_dist = compute_dist_to_pred(w, h, inside, |i| is_land[i] != 0 && is_lake[i] == 0);
    let land_coast_dist = compute_dist_to_pred(w, h, inside, |i| is_land[i] == 0);
    let border_dist = compute_dist_to_pred(w, h, inside, |i| {
        if is_land[i] == 0 || is_lake[i] != 0 || realm_id[i] < 0 {
            return false;
        }
        let x = i % w;
        let y = i / w;
        if x == 0 || x + 1 >= w || y == 0 || y + 1 >= h {
            return false;
        }
        let r0 = realm_id[i];
        [i - 1, i + 1, i - w, i + w]
            .into_iter()
            .any(|nb| inside[nb] != 0 && is_land[nb] != 0 && is_lake[nb] == 0 && realm_id[nb] != r0)
    });
    (coast_dist, land_coast_dist, border_dist)
}

pub(crate) fn build_world_grid(planet: &Planet, proj: &WorldProj, noise: &Noise) -> SampledGrid {
    let w = proj.canvas_w;
    let h = proj.canvas_h;
    let n = w * h;
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let ui_scale = (w as f64 / 2200.0).clamp(0.32, 1.5);

    let mut ir = vec![0.0f32; gw * gh];
    let mut ig = vec![0.0f32; gw * gh];
    let mut ib = vec![0.0f32; gw * gh];
    let mut fc = vec![0.0f32; gw * gh];
    let mut wc = vec![0.0f32; gw * gh];
    let mut is_land_g = vec![0.0f32; gw * gh];
    let mut is_lake_g = vec![0.0f32; gw * gh];
    let mut is_salt_g = vec![0.0f32; gw * gh];

    for i in 0..(gw * gh) {
        let c_i = biome_painted_rgb(planet.biomes.biome[i]);
        ir[i] = c_i[0] as f32;
        ig[i] = c_i[1] as f32;
        ib[i] = c_i[2] as f32;
        fc[i] = if is_forest_biome(planet.biomes.biome[i]) { 1.0 } else { 0.0 };
        wc[i] = if planet.biomes.biome[i] == Biome::Wetland || planet.hydrology.is_delta[i] != 0 {
            1.0
        } else {
            0.0
        };
        is_land_g[i] = if planet.hydrology.is_ocean[i] == 0 { 1.0 } else { 0.0 };
        is_lake_g[i] = if planet.hydrology.is_lake[i] != 0 { 1.0 } else { 0.0 };
        is_salt_g[i] = if planet.hydrology.is_salt_flat[i] != 0 { 1.0 } else { 0.0 };
    }
    blur_land_rgb_and_forest(gw, gh, true, &planet.hydrology.is_ocean, &mut ir, &mut ig, &mut ib, &mut fc);
    let mut bathy_g = planet.erosion.elevation_km.clone();
    for _ in 0..4 {
        let prev = bathy_g.clone();
        for cy in 0..gh {
            let y0 = cy.saturating_sub(1);
            let y1 = (cy + 1).min(gh - 1);
            for cx in 0..gw {
                let c = cy * gw + cx;
                if planet.hydrology.is_ocean[c] == 0 {
                    continue;
                }
                let (mut s, mut wt_sum) = (0.0f32, 0.0f32);
                for yy in [y0, cy, y1] {
                    for dx in -1isize..=1 {
                        let xx = (cx as isize + dx).rem_euclid(gw as isize) as usize;
                        let nb = yy * gw + xx;
                        let wt = if dx == 0 && yy == cy { 4.0 } else if dx == 0 || yy == cy { 2.0 } else { 1.0 };
                        s += prev[nb].min(0.0) * wt;
                        wt_sum += wt;
                    }
                }
                bathy_g[c] = s / wt_sum;
            }
        }
    }

    let mut inside = vec![0u8; n];
    let mut elev = vec![0.0f32; n];
    let mut is_land = vec![0u8; n];
    let mut is_lake = vec![0u8; n];
    let mut is_salt_flat = vec![0u8; n];
    let mut polar_ice = vec![0u8; n];
    let mut glacier = vec![0.0f32; n];
    let mut aridity = vec![0.0f32; n];
    let mut forest_cov = vec![0.0f32; n];
    let mut wetland_cov = vec![0.0f32; n];
    let mut ink_bio = vec![[0.0f64; 3]; n];
    let mut cloud_mottle = vec![0.0f32; n];
    let mut realm_id = vec![-1i32; n];

    let freq_k = 1.0 / ui_scale;
    for y in 0..h {
        let py = y as f64 + 0.5;
        for x in 0..w {
            let i = y * w + x;
            let px = x as f64 + 0.5;
            cloud_mottle[i] = noise.fbm(px * 0.011 * freq_k, py * 0.011 * freq_k, 5.2, 3).clamp(-1.0, 1.0) as f32;
            let Some((lat_deg, lon_deg)) = proj.inverse(px, py) else { continue; };
            inside[i] = 1;

            let gx = ((lon_deg + 180.0).rem_euclid(360.0) / 360.0) * gw as f64 - 0.5;
            let gy = (((90.0 - lat_deg) / 180.0) * gh as f64 - 0.5).clamp(0.0, (gh - 1) as f64);
            let lat_r = lat_deg.to_radians();
            let lon_r = lon_deg.to_radians();
            let u = [lat_r.cos() * lon_r.cos(), lat_r.cos() * lon_r.sin(), lat_r.sin()];

            let e_raw = sample_catmull(&planet.erosion.elevation_km, gw, gh, true, gx, gy);
            let e = if e_raw < -0.02 {
                let e_sm = sample_bilinear_norm(&bathy_g, gw, gh, true, gx, gy);
                let t_sea = ((-0.02 - e_raw) / 0.14).clamp(0.0, 1.0);
                e_raw * (1.0 - t_sea) + e_sm * t_sea
            } else {
                e_raw + 0.018 * noise.fbm(u[0] * 120.0, u[1] * 120.0, u[2] * 120.0, 2)
            };
            elev[i] = e as f32;

            let land_f = sample_bilinear_norm(&is_land_g, gw, gh, true, gx, gy);
            let lake_f = sample_bilinear_norm(&is_lake_g, gw, gh, true, gx, gy);
            let salt_f = sample_bilinear_norm(&is_salt_g, gw, gh, true, gx, gy);
            let lk = lake_f > 0.45 && e > -0.25;
            let sf = salt_f > 0.50;
            let lnd = e > 0.0 || (land_f > 0.55 && e > -0.04) || lk;
            is_land[i] = if lnd { 1 } else { 0 };
            is_lake[i] = if lk { 1 } else { 0 };
            is_salt_flat[i] = if sf { 1 } else { 0 };

            let ai = sample_bilinear_norm(&planet.climate.aridity_index, gw, gh, true, gx, gy);
            aridity[i] = ((0.68 - ai) / 0.58).clamp(0.0, 1.0) as f32;
            let tc = sample_bilinear_norm(&planet.climate.temp_c, gw, gh, true, gx, gy);
            let t_jan = sample_bilinear_norm(&planet.climate.temp_jan_c, gw, gh, true, gx, gy);
            let t_jul = sample_bilinear_norm(&planet.climate.temp_jul_c, gw, gh, true, gx, gy);
            let t_cold = t_jan.min(t_jul);
            if !lnd {
                let ice_noise = 2.6 * noise.fbm(u[0] * 7.5, u[1] * 7.5, u[2] * 7.5, 3)
                    + 1.1 * noise.fbm(u[0] * 24.0, u[1] * 24.0, u[2] * 24.0, 2);
                if tc + ice_noise < -10.5 && t_cold < -15.0 {
                    polar_ice[i] = 1;
                }
            }
            glacier[i] = sample_bilinear_norm(&planet.climate.glacier, gw, gh, true, gx, gy).clamp(0.0, 1.0) as f32;
            forest_cov[i] = sample_bilinear_norm(&fc, gw, gh, true, gx, gy).clamp(0.0, 1.0) as f32;
            wetland_cov[i] = sample_bilinear_norm(&wc, gw, gh, true, gx, gy).clamp(0.0, 1.0) as f32;
            ink_bio[i] = [
                sample_bilinear_norm(&ir, gw, gh, true, gx, gy),
                sample_bilinear_norm(&ig, gw, gh, true, gx, gy),
                sample_bilinear_norm(&ib, gw, gh, true, gx, gy),
            ];
            if lnd && !lk {
                realm_id[i] = vote_realm_id(planet, gx, gy);
            }
        }
    }

    let (coast_dist, land_coast_dist, border_dist) = finalize_distances(w, h, &inside, &is_land, &is_lake, &realm_id);
    SampledGrid {
        w,
        h,
        is_world: true,
        ui_scale,
        frame: proj.frame,
        inside,
        elev,
        is_land,
        is_lake,
        is_salt_flat,
        polar_ice,
        glacier,
        aridity,
        forest_cov,
        wetland_cov,
        ink_bio,
        cloud_mottle,
        realm_id,
        coast_dist,
        land_coast_dist,
        border_dist,
    }
}

pub(crate) fn build_region_grid(planet: &Planet, reg: &Region, proj: &RegionProj, noise: &Noise) -> SampledGrid {
    let w = proj.canvas_w;
    let h = proj.canvas_h;
    let n = w * h;
    let rw = reg.w;
    let rh = reg.h;
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let ui_scale = (w as f64 / 1680.0).clamp(0.32, 1.5);

    let mut ir = vec![0.0f32; rw * rh];
    let mut ig = vec![0.0f32; rw * rh];
    let mut ib = vec![0.0f32; rw * rh];
    let mut fc = vec![0.0f32; rw * rh];
    let mut wc = vec![0.0f32; rw * rh];
    let mut is_land_r = vec![0.0f32; rw * rh];
    let mut is_lake_r = vec![0.0f32; rw * rh];
    let mut is_salt_r = vec![0.0f32; rw * rh];

    for i in 0..(rw * rh) {
        let c_i = biome_painted_rgb(reg.biome[i]);
        ir[i] = c_i[0] as f32;
        ig[i] = c_i[1] as f32;
        ib[i] = c_i[2] as f32;
        fc[i] = if is_forest_biome(reg.biome[i]) { 1.0 } else { 0.0 };
        wc[i] = if reg.biome[i] == Biome::Wetland || reg.is_delta[i] != 0 {
            1.0
        } else {
            0.0
        };
        is_land_r[i] = if reg.is_ocean[i] == 0 { 1.0 } else { 0.0 };
        is_lake_r[i] = if reg.is_lake[i] != 0 { 1.0 } else { 0.0 };
        is_salt_r[i] = if reg.is_salt_flat[i] != 0 { 1.0 } else { 0.0 };
    }
    blur_land_rgb_and_forest(rw, rh, false, &reg.is_ocean, &mut ir, &mut ig, &mut ib, &mut fc);
    let mut bathy_r = reg.elevation_km.clone();
    for _ in 0..3 {
        let prev_b = bathy_r.clone();
        let prev_lk = is_lake_r.clone();
        for cy in 0..rh {
            let y0 = cy.saturating_sub(1);
            let y1 = (cy + 1).min(rh - 1);
            for cx in 0..rw {
                let c = cy * rw + cx;
                let (mut sb, mut slk, mut wt_sum) = (0.0f32, 0.0f32, 0.0f32);
                for yy in [y0, cy, y1] {
                    for dx in -1isize..=1 {
                        let xx = (cx as isize + dx).clamp(0, rw as isize - 1) as usize;
                        let nb = yy * rw + xx;
                        let wt = if dx == 0 && yy == cy { 4.0 } else if dx == 0 || yy == cy { 2.0 } else { 1.0 };
                        sb += prev_b[nb].min(0.0) * wt;
                        slk += prev_lk[nb] * wt;
                        wt_sum += wt;
                    }
                }
                if reg.is_ocean[c] != 0 {
                    bathy_r[c] = sb / wt_sum;
                }
                is_lake_r[c] = slk / wt_sum;
            }
        }
    }

    let mut inside = vec![0u8; n];
    let mut elev = vec![0.0f32; n];
    let mut is_land = vec![0u8; n];
    let mut is_lake = vec![0u8; n];
    let mut is_salt_flat = vec![0u8; n];
    let mut polar_ice = vec![0u8; n];
    let mut glacier = vec![0.0f32; n];
    let mut aridity = vec![0.0f32; n];
    let mut forest_cov = vec![0.0f32; n];
    let mut wetland_cov = vec![0.0f32; n];
    let mut ink_bio = vec![[0.0f64; 3]; n];
    let mut cloud_mottle = vec![0.0f32; n];
    let mut realm_id = vec![-1i32; n];
    let [fx0, fy0, fw, fh] = proj.frame;
    let freq_k = 1.0 / ui_scale;

    for y in 0..h {
        let fy = (y as f64 + 0.5 - fy0) / fh;
        for x in 0..w {
            let i = y * w + x;
            let px = x as f64 + 0.5;
            let py = y as f64 + 0.5;
            cloud_mottle[i] = noise.fbm(px * 0.011 * freq_k, py * 0.011 * freq_k, 5.2, 3).clamp(-1.0, 1.0) as f32;

            let fx = (px - fx0) / fw;
            if !(0.0..=1.0).contains(&fx) || !(0.0..=1.0).contains(&fy) {
                continue;
            }
            inside[i] = 1;

            let lat_deg = reg.lat_max_deg - fy * (reg.lat_max_deg - reg.lat_min_deg);
            let lon_deg = (reg.lon_min_deg + fx * proj.span_lon_deg + 540.0).rem_euclid(360.0) - 180.0;
            let lat_r = lat_deg.to_radians();
            let lon_r = lon_deg.to_radians();
            let u = [lat_r.cos() * lon_r.cos(), lat_r.cos() * lon_r.sin(), lat_r.sin()];

            let rx = (fx * rw as f64 - 0.5).clamp(0.0, (rw - 1) as f64);
            let ry = (fy * rh as f64 - 0.5).clamp(0.0, (rh - 1) as f64);
            let e_raw = sample_catmull(&reg.elevation_km, rw, rh, false, rx, ry);
            let e = if e_raw < -0.02 {
                let e_sm = sample_bilinear_norm(&bathy_r, rw, rh, false, rx, ry);
                let t_sea = ((-0.02 - e_raw) / 0.12).clamp(0.0, 1.0);
                e_raw * (1.0 - t_sea) + e_sm * t_sea
            } else {
                e_raw + 0.012 * noise.fbm(u[0] * 240.0, u[1] * 240.0, u[2] * 240.0, 2)
            };
            elev[i] = e as f32;

            let land_f = sample_bilinear_norm(&is_land_r, rw, rh, false, rx, ry);
            let lake_f = sample_bilinear_norm(&is_lake_r, rw, rh, false, rx, ry);
            let salt_f = sample_bilinear_norm(&is_salt_r, rw, rh, false, rx, ry);
            let lk_jit = 0.12 * noise.fbm(u[0] * 170.0 + 2.3, u[1] * 170.0 - 4.1, u[2] * 170.0 + 1.7, 2);
            let lk = lake_f > 0.22 && (lake_f + lk_jit) > 0.48 && e > -0.25;
            let sf = salt_f > 0.50;
            let lnd = e > 0.0 || (land_f > 0.55 && e > -0.04) || lk;
            is_land[i] = if lnd { 1 } else { 0 };
            is_lake[i] = if lk { 1 } else { 0 };
            is_salt_flat[i] = if sf { 1 } else { 0 };

            let gx_f = ((lon_deg + 180.0).rem_euclid(360.0) / 360.0) * gw as f64 - 0.5;
            let gy_f = (((90.0 - lat_deg) / 180.0) * gh as f64 - 0.5).clamp(0.0, (gh - 1) as f64);
            let ai = sample_bilinear_norm(&planet.climate.aridity_index, gw, gh, true, gx_f, gy_f);
            aridity[i] = ((0.68 - ai) / 0.58).clamp(0.0, 1.0) as f32;
            if !lnd {
                let tc = sample_bilinear_norm(&reg.temp_c, rw, rh, false, rx, ry);
                let t_cold = sample_bilinear_norm(&reg.temp_jan_c, rw, rh, false, rx, ry)
                    .min(sample_bilinear_norm(&reg.temp_jul_c, rw, rh, false, rx, ry));
                let ice_noise = 2.6 * noise.fbm(u[0] * 7.5, u[1] * 7.5, u[2] * 7.5, 3)
                    + 1.1 * noise.fbm(u[0] * 24.0, u[1] * 24.0, u[2] * 24.0, 2);
                if tc + ice_noise < -10.5 && t_cold < -15.0 {
                    polar_ice[i] = 1;
                }
            }
            glacier[i] = sample_bilinear_norm(&reg.glacier, rw, rh, false, rx, ry).clamp(0.0, 1.0) as f32;

            let bx = (rx + 0.55 * noise.fbm(u[0] * 140.0, u[1] * 140.0, u[2] * 140.0, 2)).clamp(0.0, (rw - 1) as f64);
            let by = (ry + 0.55 * noise.fbm(u[0] * 140.0 + 7.1, u[1] * 140.0 - 3.4, u[2] * 140.0 + 5.2, 2)).clamp(0.0, (rh - 1) as f64);
            forest_cov[i] = sample_bilinear_norm(&fc, rw, rh, false, bx, by).clamp(0.0, 1.0) as f32;
            wetland_cov[i] = sample_bilinear_norm(&wc, rw, rh, false, bx, by).clamp(0.0, 1.0) as f32;
            ink_bio[i] = [
                sample_bilinear_norm(&ir, rw, rh, false, bx, by),
                sample_bilinear_norm(&ig, rw, rh, false, bx, by),
                sample_bilinear_norm(&ib, rw, rh, false, bx, by),
            ];
            if lnd && !lk {
                realm_id[i] = vote_realm_id(planet, gx_f, gy_f);
            }
        }
    }

    let (coast_dist, land_coast_dist, border_dist) = finalize_distances(w, h, &inside, &is_land, &is_lake, &realm_id);
    SampledGrid {
        w,
        h,
        is_world: false,
        ui_scale,
        frame: proj.frame,
        inside,
        elev,
        is_land,
        is_lake,
        is_salt_flat,
        polar_ice,
        glacier,
        aridity,
        forest_cov,
        wetland_cov,
        ink_bio,
        cloud_mottle,
        realm_id,
        coast_dist,
        land_coast_dist,
        border_dist,
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn paint_terrain_rivers_roads(
    grid: &SampledGrid,
    style: Style,
    paper_tex: &[u8],
    rivers: &[Vec<[f64; 3]>],
    wadis: &[Vec<[f64; 2]>],
    oases: &[[f64; 2]],
    land_roads: &[Vec<[f64; 2]>],
) -> (Vec<u8>, Vec<f32>, Vec<f32>, Vec<[f64; 2]>) {
    let w = grid.w;
    let h = grid.h;
    let n = w * h;
    let mut rgb = vec![0u8; n * 3];
    let us = grid.ui_scale;
    let hs_step = (2.0 * us).round().max(1.0) as usize;
    let z_exag = if grid.is_world { 11.5 } else { 15.5 };

    let wd_ripples = |d: f64| -> f64 {
        let ds = d / us.max(0.4);
        if ds <= 1.4 || ds > 19.5 {
            return 0.0;
        }
        let mut r = 0.0f64;
        for &(pos, amp) in &[(3.8, 0.65), (8.2, 0.42), (13.5, 0.22)] {
            r = r.max((1.0 - (ds - pos).abs() / 0.90).clamp(0.0, 1.0) * amp);
        }
        r
    };

    for y in 0..h {
        let ny_edge = ((y as f64 / h as f64) - 0.5).abs() * 2.0;
        let p_row = (y & 511) * 512;
        for x in 0..w {
            let i = y * w + x;
            let p_delta = (paper_tex[p_row + (x & 511)] as f64 - 128.0) / 14.0;
            let cloud = grid.cloud_mottle[i] as f64;
            let nx_edge = ((x as f64 / w as f64) - 0.5).abs() * 2.0;
            let vig = (nx_edge * nx_edge * 0.45 + ny_edge * ny_edge * 0.55).clamp(0.0, 1.0);

            if grid.inside[i] == 0 {
                let bg = match style {
                    Style::Expedition => [216.0 - 9.0 * vig, 210.0 - 9.0 * vig, 194.0 - 8.0 * vig],
                    Style::Painted => [44.0, 35.0, 26.0],
                };
                let modulated = [
                    bg[0] * (1.0 + p_delta * 0.022),
                    bg[1] * (1.0 + p_delta * 0.022),
                    bg[2] * (1.0 + p_delta * 0.020),
                ];
                rgb[3 * i..3 * i + 3].copy_from_slice(&rgb_to_u8(modulated));
                continue;
            }

            let e = grid.elev[i] as f64;
            let cd = grid.coast_dist[i] as f64;
            let lcd = grid.land_coast_dist[i] as f64;
            let bd = grid.border_dist[i] as f64;
            let rid = grid.realm_id[i];

            // Направленная светотеневая отмывка рельефа (солнце с СЗ, 315°)
            let x0 = x.saturating_sub(hs_step);
            let x1 = (x + hs_step).min(w - 1);
            let y0 = y.saturating_sub(hs_step);
            let y1 = (y + hs_step).min(h - 1);
            let e_l = if grid.inside[y * w + x0] != 0 { grid.elev[y * w + x0] as f64 } else { e };
            let e_r = if grid.inside[y * w + x1] != 0 { grid.elev[y * w + x1] as f64 } else { e };
            let e_u = if grid.inside[y0 * w + x] != 0 { grid.elev[y0 * w + x] as f64 } else { e };
            let e_d = if grid.inside[y1 * w + x] != 0 { grid.elev[y1 * w + x] as f64 } else { e };
            let dz_dx = (e_r - e_l) / (((x1 - x0).max(1) as f64) / us.max(0.5));
            let dz_dy = (e_d - e_u) / (((y1 - y0).max(1) as f64) / us.max(0.5));
            let illum = ((0.7071 * dz_dx + 0.7071 * dz_dy) * z_exag).tanh();

            let mut lake_edge = false;
            if grid.is_lake[i] != 0 && x > 0 && x + 1 < w && y > 0 && y + 1 < h {
                if grid.is_lake[i - 1] == 0 || grid.is_lake[i + 1] == 0 || grid.is_lake[i - w] == 0 || grid.is_lake[i + w] == 0 {
                    lake_edge = true;
                }
            }

            let mut col = if grid.is_land[i] == 0 || grid.is_lake[i] != 0 {
                let is_lk = grid.is_lake[i] != 0;
                let depth_t = if is_lk { 0.12 } else { (-e / 6.0).clamp(0.0, 1.0) };
                let coast_w = (1.7 * us).clamp(1.0, 2.0);
                let bank_aa = if lake_edge {
                    0.90
                } else if !is_lk && cd <= coast_w {
                    ((coast_w - cd) / coast_w).clamp(0.0, 1.0)
                } else {
                    0.0
                };
                let mut ice_edge = false;
                if !is_lk && grid.polar_ice[i] != 0 && x > 0 && x + 1 < w && y > 0 && y + 1 < h {
                    for nb in [i - 1, i + 1, i - w, i + w] {
                        if grid.inside[nb] != 0 && grid.is_land[nb] == 0 && grid.polar_ice[nb] == 0 {
                            ice_edge = true;
                            break;
                        }
                    }
                }

                match style {
                    Style::Expedition => {
                        if !is_lk && grid.polar_ice[i] != 0 {
                            let mut s = lerp_rgb([220.0, 230.0, 236.0], [194.0, 210.0, 220.0], (0.5 + 0.5 * cloud) * 0.52);
                            s = [s[0] - 5.0 * vig, s[1] - 5.0 * vig, s[2] - 4.0 * vig];
                            if ice_edge {
                                s = lerp_rgb(s, [62.0, 58.0, 52.0], 0.80);
                            }
                            if bank_aa > 0.0 {
                                s = lerp_rgb(s, [44.0, 36.0, 26.0], bank_aa * 0.92);
                            }
                            s
                        } else if is_lk {
                            let s = lerp_rgb([128.0, 168.0, 180.0], [88.0, 134.0, 152.0], cloud * 0.35 + 0.5);
                            lerp_rgb(s, [52.0, 42.0, 32.0], bank_aa * 0.90)
                        } else {
                            let rip = wd_ripples(cd);
                            let bathy_sh = (illum * 0.08).clamp(-0.07, 0.07);
                            let mut sea = lerp_rgb(
                                [176.0 + 4.5 * cloud, 170.0 + 4.0 * cloud, 154.0 + 3.5 * cloud],
                                [124.0, 122.0, 112.0],
                                depth_t * 0.80,
                            );
                            sea = [sea[0] + 10.0 * bathy_sh, sea[1] + 10.0 * bathy_sh, sea[2] + 9.0 * bathy_sh];
                            let glow_w = 9.0 * us;
                            if cd < glow_w {
                                sea = lerp_rgb(sea, [198.0, 194.0, 180.0], (glow_w - cd) / glow_w * 0.28);
                            }
                            sea = lerp_rgb(sea, [80.0, 72.0, 62.0], rip * 0.32);
                            sea = [sea[0] - 8.0 * vig, sea[1] - 8.0 * vig, sea[2] - 7.0 * vig];
                            lerp_rgb(sea, [44.0, 36.0, 26.0], bank_aa * 0.92)
                        }
                    }
                    Style::Painted => {
                        if !is_lk && grid.polar_ice[i] != 0 {
                            let mut s = lerp_rgb([220.0, 238.0, 246.0], [182.0, 214.0, 230.0], (0.5 + 0.5 * cloud) * 0.55);
                            if ice_edge {
                                s = lerp_rgb(s, [96.0, 148.0, 174.0], 0.72);
                            }
                            s = [s[0] - 6.0 * vig, s[1] - 6.0 * vig, s[2] - 5.0 * vig];
                            lerp_rgb(s, [44.0, 35.0, 24.0], bank_aa * 0.92)
                        } else {
                            let bathy_sh = (illum * 0.09).clamp(-0.08, 0.08);
                            let mut s = if is_lk {
                                lerp_rgb([102.0, 174.0, 190.0], [60.0, 132.0, 158.0], cloud * 0.35 + 0.5)
                            } else {
                                let base = lerp_rgb(
                                    [84.0, 156.0, 176.0],
                                    [38.0, 88.0, 120.0],
                                    (depth_t * 0.85 + 0.14 * cloud).clamp(0.0, 1.0),
                                );
                                let sh_base = [
                                    base[0] + 12.0 * bathy_sh,
                                    base[1] + 15.0 * bathy_sh,
                                    base[2] + 16.0 * bathy_sh,
                                ];
                                let glow_w = 10.0 * us;
                                let shallow_glow = if cd < glow_w { ((glow_w - cd) / glow_w).powf(1.4) * 0.54 } else { 0.0 };
                                lerp_rgb(sh_base, [158.0, 216.0, 222.0], shallow_glow)
                            };
                            if !is_lk && cd > 1.3 * us && cd < 3.8 * us {
                                let rim = (1.0 - (cd - 2.3 * us).abs() / (1.5 * us)).clamp(0.0, 1.0);
                                s = lerp_rgb(s, [196.0, 234.0, 236.0], rim * 0.42);
                            }
                            s = [s[0] - 7.0 * vig, s[1] - 7.0 * vig, s[2] - 6.0 * vig];
                            lerp_rgb(s, [44.0, 35.0, 24.0], bank_aa * 0.92)
                        }
                    }
                }
            } else {
                let mtn_soil = ((e - 1.15) / 0.85).clamp(0.0, 1.0);
                let f_cov = grid.forest_cov[i] as f64;
                let w_cov = grid.wetland_cov[i] as f64;
                let glac = grid.glacier[i] as f64;
                let salt = grid.is_salt_flat[i] != 0;
                let marsh_tex = w_cov > 0.30
                    && glac < 0.2
                    && (y % 3 == 0)
                    && (((x.wrapping_mul(3) + y.wrapping_mul(7)) % 13) < 6);

                match style {
                    Style::Expedition => {
                        let paper = [220.0 + 8.0 * cloud - 8.0 * vig, 212.0 + 7.5 * cloud - 8.0 * vig, 188.0 + 6.5 * cloud - 7.0 * vig];
                        let mut c = lerp_rgb(paper, grid.ink_bio[i], 0.52);
                        let arid = grid.aridity[i] as f64;
                        if arid > 0.20 {
                            let at = (((arid - 0.20) / 0.65) * (0.72 + 0.28 * cloud)).clamp(0.0, 1.0);
                            c = lerp_rgb(c, [190.0, 126.0, 108.0], at * 0.50);
                        }
                        if f_cov > 0.05 {
                            c = lerp_rgb(c, [84.0, 92.0, 56.0], f_cov * 0.28);
                        }
                        if w_cov > 0.18 {
                            c = lerp_rgb(c, [106.0, 134.0, 114.0], w_cov * 0.32);
                            if marsh_tex {
                                c = lerp_rgb(c, [78.0, 116.0, 124.0], 0.42);
                            }
                        }
                        if mtn_soil > 0.02 {
                            c = lerp_rgb(c, [136.0, 128.0, 112.0], mtn_soil * 0.54);
                        }
                        if illum >= 0.0 {
                            c = [c[0] + 15.0 * illum, c[1] + 13.0 * illum, c[2] + 9.0 * illum];
                        } else {
                            let sh = -illum;
                            c = [c[0] - 19.0 * sh, c[1] - 18.0 * sh, c[2] - 14.0 * sh];
                        }
                        if salt {
                            c = lerp_rgb(c, [228.0, 220.0, 198.0], 0.85);
                        }
                        if glac > 0.25 {
                            c = lerp_rgb(c, [238.0, 240.0, 238.0], ((glac - 0.25) / 0.45).clamp(0.0, 0.85));
                        }
                        if rid >= 0 {
                            let rc = realm_archival_rgb(rid);
                            let rib = if bd <= 10.0 * us { (1.0 - bd / (10.0 * us)).powf(1.6) * 0.26 } else { 0.0 };
                            c = lerp_rgb(c, rc, 0.05 + rib);
                        }
                        if lcd < 5.5 * us {
                            c = lerp_rgb(c, [72.0, 60.0, 44.0], (1.0 - lcd / (5.5 * us)).powf(1.8) * 0.22);
                        }
                        let bw = (1.2 * us).max(0.95);
                        if rid >= 0 && bd <= bw {
                            let pat = (x + y) % 18;
                            if pat < 8 || (pat >= 11 && pat < 13) {
                                c = lerp_rgb(c, [64.0, 42.0, 34.0], ((bw - bd) / bw) * 0.82);
                            }
                        }
                        c
                    }
                    Style::Painted => {
                        let b_c = grid.ink_bio[i];
                        let mut c = [b_c[0] + 13.0 * cloud - 6.0 * vig, b_c[1] + 12.0 * cloud - 6.0 * vig, b_c[2] + 8.0 * cloud - 5.0 * vig];
                        if f_cov > 0.05 {
                            c = lerp_rgb(c, [62.0, 78.0, 30.0], f_cov * 0.30);
                        }
                        if w_cov > 0.18 {
                            c = lerp_rgb(c, [74.0, 128.0, 96.0], w_cov * 0.36);
                            if marsh_tex {
                                c = lerp_rgb(c, [68.0, 146.0, 152.0], 0.45);
                            }
                        }
                        if mtn_soil > 0.02 {
                            c = lerp_rgb(c, [110.0, 102.0, 86.0], mtn_soil * 0.65);
                        }
                        if illum >= 0.0 {
                            c = [c[0] + 19.0 * illum, c[1] + 16.0 * illum, c[2] + 10.0 * illum];
                        } else {
                            let sh = -illum;
                            c = [c[0] - 24.0 * sh, c[1] - 21.0 * sh, c[2] - 16.0 * sh];
                        }
                        if salt {
                            c = lerp_rgb(c, [224.0, 214.0, 186.0], 0.85);
                        }
                        if glac > 0.25 {
                            c = lerp_rgb(c, [240.0, 242.0, 244.0], ((glac - 0.25) / 0.45).clamp(0.0, 0.82));
                        }
                        if lcd < 6.0 * us {
                            c = lerp_rgb(c, [58.0, 48.0, 32.0], (1.0 - lcd / (6.0 * us)).powf(1.8) * 0.24);
                        }
                        let bw = (1.15 * us).max(0.9);
                        if rid >= 0 && bd <= bw && ((x + y) % 14 < 7) {
                            c = lerp_rgb(c, [178.0, 46.0, 36.0], ((bw - bd) / bw) * 0.56);
                        }
                        c
                    }
                }
            };

            let tex_strength = if grid.is_land[i] != 0 { 0.024 } else { 0.018 };
            col = [
                col[0] * (1.0 + p_delta * tex_strength),
                col[1] * (1.0 + p_delta * tex_strength),
                col[2] * (1.0 + p_delta * tex_strength),
            ];
            rgb[3 * i..3 * i + 3].copy_from_slice(&rgb_to_u8(col));
        }
    }

    let mut river_dist = vec![100.0f32; n];
    let mut road_dist = vec![100.0f32; n];
    let [fx, fy, fw, fh] = grid.frame;
    let clip = [
        fx.floor().max(0.0) as usize,
        fy.floor().max(0.0) as usize,
        ((fx + fw).ceil() as usize).min(w),
        ((fy + fh).ceil() as usize).min(h),
    ];

    // Сезонные пересыхающие русла (вади) и пустынные оазисы
    let wadi_col = match style {
        Style::Expedition => [124.0, 98.0, 74.0],
        Style::Painted => [138.0, 112.0, 76.0],
    };
    let wadi_r = (if grid.is_world { 0.65 } else { 0.95 }) * us.max(0.7);
    for wd in wadis {
        if wd.len() < 2 {
            continue;
        }
        let mut acc = 0.0f64;
        for k in 0..(wd.len() - 1) {
            let p0 = wd[k];
            let p1 = wd[k + 1];
            let seg = ((p1[0] - p0[0]).powi(2) + (p1[1] - p0[1]).powi(2)).sqrt();
            let steps = (seg * 1.2).ceil().max(1.0) as usize;
            for st in 0..steps {
                let d_along = acc + seg * (st as f64 / steps as f64);
                if ((d_along / (4.2 * us.max(0.6))) as usize) % 2 == 1 {
                    continue;
                }
                let t = st as f64 / steps as f64;
                let mx = p0[0] + (p1[0] - p0[0]) * t;
                let my = p0[1] + (p1[1] - p0[1]) * t;
                let rx0 = ((mx - wadi_r - 1.0).floor() as isize).max(clip[0] as isize) as usize;
                let rx1 = ((mx + wadi_r + 1.0).ceil() as isize).min(clip[2] as isize) as usize;
                let ry0 = ((my - wadi_r - 1.0).floor() as isize).max(clip[1] as isize) as usize;
                let ry1 = ((my + wadi_r + 1.0).ceil() as isize).min(clip[3] as isize) as usize;
                for yy in ry0..ry1 {
                    for xx in rx0..rx1 {
                        let idx = yy * w + xx;
                        if grid.inside[idx] == 0 || grid.is_land[idx] == 0 || grid.is_lake[idx] != 0 {
                            continue;
                        }
                        let d = ((xx as f64 + 0.5 - mx).powi(2) + (yy as f64 + 0.5 - my).powi(2)).sqrt();
                        if d <= wadi_r + 0.45 {
                            let a = ((1.0 - (d - wadi_r).max(0.0) / 0.45).clamp(0.0, 1.0)) * 0.58;
                            let cur = [rgb[3 * idx] as f64, rgb[3 * idx + 1] as f64, rgb[3 * idx + 2] as f64];
                            rgb[3 * idx..3 * idx + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, wadi_col, a)));
                        }
                    }
                }
            }
            acc += seg;
        }
    }

    let oasis_outer = (if grid.is_world { 3.4 } else { 5.4 }) * us.max(0.75);
    let oasis_pool = oasis_outer * 0.44;
    for &[ox, oy] in oases {
        let rx0 = ((ox - oasis_outer - 1.0).floor() as isize).max(clip[0] as isize) as usize;
        let rx1 = ((ox + oasis_outer + 1.0).ceil() as isize).min(clip[2] as isize) as usize;
        let ry0 = ((oy - oasis_outer - 1.0).floor() as isize).max(clip[1] as isize) as usize;
        let ry1 = ((oy + oasis_outer + 1.0).ceil() as isize).min(clip[3] as isize) as usize;
        for yy in ry0..ry1 {
            for xx in rx0..rx1 {
                let idx = yy * w + xx;
                if grid.inside[idx] == 0 || grid.is_land[idx] == 0 || grid.is_lake[idx] != 0 {
                    continue;
                }
                let d = ((xx as f64 + 0.5 - ox).powi(2) + (yy as f64 + 0.5 - oy).powi(2)).sqrt();
                let cur = [rgb[3 * idx] as f64, rgb[3 * idx + 1] as f64, rgb[3 * idx + 2] as f64];
                if d <= oasis_pool {
                    let pool_c = match style {
                        Style::Expedition => [78.0, 142.0, 158.0],
                        Style::Painted => [56.0, 172.0, 188.0],
                    };
                    rgb[3 * idx..3 * idx + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, pool_c, 0.88)));
                } else if d <= oasis_outer {
                    let lush_c = match style {
                        Style::Expedition => [86.0, 128.0, 72.0],
                        Style::Painted => [72.0, 146.0, 56.0],
                    };
                    let a = (1.0 - (d - oasis_pool) / (oasis_outer - oasis_pool).max(0.5)).clamp(0.0, 1.0) * 0.78;
                    rgb[3 * idx..3 * idx + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, lush_c, a)));
                }
            }
        }
    }

    // Двухпроходный композитинг рек без кольцевых перетяжек на стыках сегментов
    let mut riv_water_a = vec![0.0f32; n];
    let mut riv_core_t = vec![0.0f32; n];
    let mut riv_bank_a = vec![0.0f32; n];
    for riv in rivers {
        if riv.len() < 2 {
            continue;
        }
        for k in 0..(riv.len() - 1) {
            let p0 = [riv[k][0], riv[k][1]];
            let p1 = [riv[k + 1][0], riv[k + 1][1]];
            let w0 = riv[k][2];
            let w1 = riv[k + 1][2];
            let max_w = w0.max(w1);
            let max_core = (max_w * if grid.is_world { 0.72 } else { 1.15 } * us)
                .max(if grid.is_world { 0.70 * us.max(0.75) } else { 0.82 * us.max(0.75) });
            let max_outer = max_core + (max_core * 0.28 + 0.30 * us).min(0.82) + 0.55;
            let min_x = ((p0[0].min(p1[0]) - max_outer - 1.0).floor() as isize).max(clip[0] as isize) as usize;
            let max_x = ((p0[0].max(p1[0]) + max_outer + 1.0).ceil() as isize).min(clip[2] as isize) as usize;
            let min_y = ((p0[1].min(p1[1]) - max_outer - 1.0).floor() as isize).max(clip[1] as isize) as usize;
            let max_y = ((p0[1].max(p1[1]) + max_outer + 1.0).ceil() as isize).min(clip[3] as isize) as usize;

            let vx = p1[0] - p0[0];
            let vy = p1[1] - p0[1];
            let len2 = (vx * vx + vy * vy).max(1e-6);

            for y in min_y..max_y {
                for x in min_x..max_x {
                    let i = y * w + x;
                    if grid.inside[i] == 0 || (grid.is_land[i] == 0 && grid.is_lake[i] == 0) {
                        continue;
                    }
                    let px = x as f64 + 0.5;
                    let py = y as f64 + 0.5;
                    let t = (((px - p0[0]) * vx + (py - p0[1]) * vy) / len2).clamp(0.0, 1.0);
                    let w_interp = w0 + (w1 - w0) * t;
                    let core_r = (w_interp * if grid.is_world { 0.72 } else { 1.15 } * us)
                        .max(if grid.is_world { 0.70 * us.max(0.75) } else { 0.82 * us.max(0.75) });
                    let bank_w = (core_r * 0.28 + 0.30 * us).min(0.82);
                    let bank_edge = core_r + bank_w;
                    let outer_r = bank_edge + 0.45;

                    let qx = p0[0] + vx * t;
                    let qy = p0[1] + vy * t;
                    let d = ((px - qx).powi(2) + (py - qy).powi(2)).sqrt();
                    river_dist[i] = river_dist[i].min(d as f32);

                    if d <= outer_r && grid.is_lake[i] == 0 {
                        let ba = if d <= bank_edge {
                            1.0
                        } else {
                            ((outer_r - d) / 0.45).clamp(0.0, 1.0)
                        } as f32;
                        let wa = if d <= core_r {
                            1.0
                        } else if d <= bank_edge {
                            (1.0 - (d - core_r) / bank_w.max(0.25)).clamp(0.0, 1.0)
                        } else {
                            0.0
                        } as f32;
                        let ct = (1.0 - d / core_r.max(0.35)).clamp(0.0, 1.0) as f32;
                        if ba > riv_bank_a[i] {
                            riv_bank_a[i] = ba;
                        }
                        if wa > riv_water_a[i] {
                            riv_water_a[i] = wa;
                        }
                        if ct > riv_core_t[i] {
                            riv_core_t[i] = ct;
                        }
                    }
                }
            }
        }
    }
    let bank_col = match style {
        Style::Expedition => [54.0, 44.0, 32.0],
        Style::Painted => [52.0, 40.0, 26.0],
    };
    for i in 0..n {
        let ba = riv_bank_a[i] as f64;
        if ba <= 0.0 {
            continue;
        }
        let wa = riv_water_a[i] as f64;
        let ct = riv_core_t[i] as f64;
        let water_col = match style {
            Style::Expedition => lerp_rgb([142.0, 182.0, 194.0], [84.0, 130.0, 150.0], ct),
            Style::Painted => lerp_rgb([142.0, 210.0, 222.0], [64.0, 146.0, 176.0], ct),
        };
        let cur = [rgb[3 * i] as f64, rgb[3 * i + 1] as f64, rgb[3 * i + 2] as f64];
        let with_bank = lerp_rgb(cur, bank_col, (ba * 0.80).clamp(0.0, 1.0));
        let painted = lerp_rgb(with_bank, water_col, wa);
        rgb[3 * i..3 * i + 3].copy_from_slice(&rgb_to_u8(painted));
    }

    let mut bridges: Vec<[f64; 2]> = Vec::new();
    let road_half: f64 = (if grid.is_world { 1.9 } else { 3.2 }) * us;
    let br_sep2 = (42.0 * us).powi(2);
    for rt in land_roads {
        if rt.len() < 2 {
            continue;
        }
        for k in 0..(rt.len() - 1) {
            let p0 = rt[k];
            let p1 = rt[k + 1];
            let seg_len = ((p1[0] - p0[0]).powi(2) + (p1[1] - p0[1]).powi(2)).sqrt();
            let steps = (seg_len * 0.85).ceil().max(1.0) as usize;
            for st in 0..=steps {
                let t = st as f64 / steps as f64;
                let mx = p0[0] + (p1[0] - p0[0]) * t;
                let my = p0[1] + (p1[1] - p0[1]) * t;
                let cx = mx.round() as usize;
                let cy = my.round() as usize;
                if cx >= w || cy >= h {
                    continue;
                }
                let ci = cy * w + cx;
                if grid.is_land[ci] == 0 || grid.is_lake[ci] != 0 {
                    continue;
                }
                if river_dist[ci] < (3.6 * us as f32).max(1.8) {
                    if bridges.iter().all(|b| (b[0] - mx).powi(2) + (b[1] - my).powi(2) > br_sep2) {
                        bridges.push([mx, my]);
                    }
                    continue;
                }
                let rad_i = (road_half + 3.6 * us).ceil() as isize;
                for dy in -rad_i..=rad_i {
                    for dx in -rad_i..=rad_i {
                        let xx = cx as isize + dx;
                        let yy = cy as isize + dy;
                        if xx < clip[0] as isize || xx >= clip[2] as isize || yy < clip[1] as isize || yy >= clip[3] as isize {
                            continue;
                        }
                        let idx = yy as usize * w + xx as usize;
                        if grid.is_land[idx] == 0 || grid.is_lake[idx] != 0 || river_dist[idx] < (2.4 * us as f32).max(1.2) {
                            continue;
                        }
                        let d = ((dx as f64).powi(2) + (dy as f64).powi(2)).sqrt();
                        road_dist[idx] = road_dist[idx].min(d as f32);
                        let p_delta = (paper_tex[(yy as usize & 511) * 512 + (xx as usize & 511)] as f64 - 128.0) / 14.0;
                        if d <= road_half {
                            let road_c = match style {
                                Style::Expedition => [214.0 + 4.0 * p_delta, 206.0 + 3.5 * p_delta, 180.0 + 3.0 * p_delta],
                                Style::Painted => [200.0 + 4.5 * p_delta, 192.0 + 4.0 * p_delta, 162.0 + 3.5 * p_delta],
                            };
                            let cur = [rgb[3 * idx] as f64, rgb[3 * idx + 1] as f64, rgb[3 * idx + 2] as f64];
                            let a = (1.0 - (d / road_half.max(0.5)).powf(2.0) * 0.25) * 0.90;
                            rgb[3 * idx..3 * idx + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, road_c, a)));
                        } else if d <= road_half + 1.2 * us {
                            let cur = [rgb[3 * idx] as f64, rgb[3 * idx + 1] as f64, rgb[3 * idx + 2] as f64];
                            let edge_a = (1.0 - (d - road_half) / (1.2 * us).max(0.4)) * 0.28;
                            rgb[3 * idx..3 * idx + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, [72.0, 60.0, 44.0], edge_a)));
                        }
                    }
                }
            }
        }
    }

    (rgb, river_dist, road_dist, bridges)
}

enum StampItem {
    Mountain(usize),
    Broadleaf(usize),
    Pine(usize),
    Autumn(usize),
    Capital,
    Port,
    Fortress,
    Town,
    Watchtower,
}

struct SpriteCall {
    kind: StampItem,
    x: f64,
    y: f64,
    scale: f64,
    flip_x: bool,
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn stamp_all_assets(
    rgb: &mut [u8],
    grid: &SampledGrid,
    pack: &AssetPack,
    style: Style,
    river_dist: &[f32],
    road_dist: &[f32],
    bridges: &[[f64; 2]],
    forests: &[[f64; 4]],
    peaks: &[[f64; 3]],
    hills: &[[f64; 2]],
    settlements: &[(f64, f64, SettlementRole, f64)],
) {
    let w = grid.w;
    let h = grid.h;
    let us = grid.ui_scale;
    let [fx, fy, fw, fh] = grid.frame;
    let clip = [
        fx.floor().max(0.0) as usize,
        fy.floor().max(0.0) as usize,
        ((fx + fw).ceil() as usize).min(w),
        ((fy + fh).ceil() as usize).min(h),
    ];

    let (tint, tint_amt): ([f64; 3], f64) = match style {
        Style::Expedition => ([212.0, 200.0, 176.0], 0.14),
        Style::Painted => ([246.0, 238.0, 214.0], 0.06),
    };

    let dist_to_city = |x: f64, y: f64| -> f64 {
        let mut md = 1e9f64;
        for &(sx, sy, role, score) in settlements {
            if grid.is_world && role != SettlementRole::Capital && role != SettlementRole::Port && score < 60.0 {
                continue;
            }
            let r_clear = if role == SettlementRole::Capital {
                (if grid.is_world { 26.0 } else { 40.0 }) * us
            } else {
                (if grid.is_world { 17.0 } else { 26.0 }) * us
            };
            md = md.min(((sx - x).powi(2) + (sy - y).powi(2)).sqrt() - r_clear);
        }
        md
    };

    let near_river = |x: f64, y: f64, th: f32| -> bool {
        river_dist[(y.round() as usize).min(h - 1) * w + (x.round() as usize).min(w - 1)] < th
    };
    let near_road = |x: f64, y: f64, th: f32| -> bool {
        road_dist[(y.round() as usize).min(h - 1) * w + (x.round() as usize).min(w - 1)] < th
    };

    let mut drawn_hills: Vec<[f64; 2]> = Vec::new();
    let min_hd2 = (if grid.is_world { 46.0 } else { 74.0 } * us).powi(2);
    for (k, &[x, y]) in hills.iter().enumerate() {
        if dist_to_city(x, y) < 8.0 * us || near_river(x, y, (5.0 * us) as f32) || near_road(x, y, (5.0 * us) as f32) {
            continue;
        }
        if drawn_hills.iter().any(|p| (p[0] - x).powi(2) + (p[1] - y).powi(2) < min_hd2) {
            continue;
        }
        drawn_hills.push([x, y]);
        let sc = (if grid.is_world { 0.34 } else { 0.54 }) * us * (0.88 + ((k * 5) % 4) as f64 * 0.08);
        blit_sprite(rgb, w, clip, &pack.hill, x, y, sc, (k % 2) == 1, tint, tint_amt, 0.0);
    }

    let br_sc = (if grid.is_world { 0.16 } else { 0.24 }) * us;
    for &[bx, by] in bridges {
        blit_sprite(rgb, w, clip, &pack.bridge, bx, by, br_sc, false, tint, tint_amt * 0.6, 0.16);
    }

    let mut queue: Vec<SpriteCall> = Vec::with_capacity(peaks.len() + forests.len() + settlements.len());

    let mut drawn_peaks: Vec<[f64; 2]> = Vec::new();
    let min_pd2 = (if grid.is_world { 27.0 } else { 42.0 } * us).powi(2);
    for (k, &[x, y, e]) in peaks.iter().enumerate() {
        if dist_to_city(x, y) < 6.0 * us || near_river(x, y, (4.0 * us) as f32) || near_road(x, y, (4.5 * us) as f32) {
            continue;
        }
        if drawn_peaks.iter().any(|p| (p[0] - x).powi(2) + (p[1] - y).powi(2) < min_pd2) {
            continue;
        }
        drawn_peaks.push([x, y]);
        let is_high = e > 2.25;
        let idx = if is_high { (k + (x as usize)) % 6 } else { 6 + ((k + (y as usize)) % 3) };
        let hero = if k % 3 == 0 { 1.15 } else { 0.88 };
        let elev_sc = (0.78 + (e - 1.45).max(0.0) * 0.15).clamp(0.78, 1.30);
        let sc = (if grid.is_world { 0.34 } else { 0.54 }) * us * hero * elev_sc;
        queue.push(SpriteCall { kind: StampItem::Mountain(idx), x, y, scale: sc, flip_x: (k % 2) == 1 });
    }

    let mut drawn_trees: Vec<[f64; 2]> = Vec::new();
    let min_td2 = (if grid.is_world { 9.8 } else { 15.5 } * us).powi(2);
    for (k, &[x, y, pine_f, bio_warm]) in forests.iter().enumerate() {
        if dist_to_city(x, y) < 0.0
            || near_river(x, y, ((if grid.is_world { 3.0 } else { 4.4 }) * us) as f32)
            || near_road(x, y, ((if grid.is_world { 3.2 } else { 5.2 }) * us) as f32)
        {
            continue;
        }
        if drawn_trees.iter().any(|p| (p[0] - x).powi(2) + (p[1] - y).powi(2) < min_td2) {
            continue;
        }
        drawn_trees.push([x, y]);
        let hsh = ((x as usize).wrapping_mul(73856093) ^ (y as usize).wrapping_mul(19349663)) % 100;
        let sc = (if grid.is_world { 0.34 } else { 0.52 }) * us * (0.86 + (hsh % 7) as f64 * 0.05);
        let kind = if pine_f > 0.5 {
            StampItem::Pine((k + hsh) % pack.pines.len())
        } else if bio_warm < 0.7 && hsh < 14 {
            StampItem::Autumn((k + hsh) % pack.autumn.len())
        } else {
            StampItem::Broadleaf((k + hsh) % pack.broadleaf.len())
        };
        queue.push(SpriteCall { kind, x, y, scale: sc, flip_x: (hsh % 2) == 1 });
    }

    let mut drawn_setts: Vec<[f64; 2]> = Vec::new();
    let min_set2 = (22.0 * us).powi(2);
    for (si, &(sx, sy, role, score)) in settlements.iter().enumerate() {
        if sx < fx + 12.0 * us || sx > fx + fw - 12.0 * us || sy < fy + 12.0 * us || sy > fy + fh - 12.0 * us {
            continue;
        }
        if grid.is_world && role != SettlementRole::Capital && role != SettlementRole::Port && score < 60.0 {
            continue;
        }
        if grid.is_world && role != SettlementRole::Capital && drawn_setts.iter().any(|p| (p[0] - sx).powi(2) + (p[1] - sy).powi(2) < min_set2) {
            continue;
        }
        drawn_setts.push([sx, sy]);
        let (kind, sc) = match role {
            SettlementRole::Capital => (StampItem::Capital, (if grid.is_world { 0.34 } else { 0.62 }) * us),
            SettlementRole::Port => (StampItem::Port, (if grid.is_world { 0.28 } else { 0.50 }) * us),
            SettlementRole::PassFortress => (StampItem::Fortress, (if grid.is_world { 0.29 } else { 0.52 }) * us),
            _ => {
                if si % 4 == 3 && !grid.is_world {
                    (StampItem::Watchtower, 0.46 * us)
                } else {
                    (StampItem::Town, (if grid.is_world { 0.25 } else { 0.46 }) * us)
                }
            }
        };
        queue.push(SpriteCall { kind, x: sx, y: sy, scale: sc, flip_x: false });
    }

    queue.sort_by(|a, b| a.y.total_cmp(&b.y));
    for item in queue {
        let sp: &Sprite = match item.kind {
            StampItem::Mountain(i) => &pack.mountains[i % pack.mountains.len()],
            StampItem::Broadleaf(i) => &pack.broadleaf[i % pack.broadleaf.len()],
            StampItem::Pine(i) => &pack.pines[i % pack.pines.len()],
            StampItem::Autumn(i) => &pack.autumn[i % pack.autumn.len()],
            StampItem::Capital => &pack.capital,
            StampItem::Port => &pack.port,
            StampItem::Fortress => &pack.fortress,
            StampItem::Town => &pack.town,
            StampItem::Watchtower => &pack.watchtower,
        };
        blit_sprite(rgb, w, clip, sp, item.x, item.y, item.scale, item.flip_x, tint, tint_amt, 0.20);
    }
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

pub(crate) fn extract_world_anchors(
    planet: &Planet,
    sg: &SampledGrid,
    proj: &WorldProj,
) -> (Vec<[f64; 3]>, Vec<[f64; 4]>, Vec<[f64; 2]>) {
    let mut peaks = Vec::new();
    let mut forests = Vec::new();
    let mut hills = Vec::new();
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let dy_km = planet.grid.dy_km();
    for cy in 1..(gh - 1) {
        let lat = planet.grid.lat_deg(cy);
        let step_km = planet.grid.dx_km(cy).min(dy_km).max(5.0);
        for cx in 0..gw {
            let i = cy * gw + cx;
            if planet.hydrology.is_ocean[i] != 0 || planet.hydrology.is_lake[i] != 0 {
                continue;
            }
            let pr = proj.project(lat, planet.grid.lon_deg(cx));
            if pr[1] < sg.frame[1] + 14.0 * sg.ui_scale || pr[1] > sg.frame[1] + sg.frame[3] - 10.0 * sg.ui_scale {
                continue;
            }
            let px = pr[0].round() as isize;
            let py = pr[1].round() as isize;
            if px < 0 || px >= sg.w as isize || py < 0 || py >= sg.h as isize {
                continue;
            }
            let si = py as usize * sg.w + px as usize;
            if sg.inside[si] == 0 || sg.is_land[si] == 0 || sg.is_lake[si] != 0 {
                continue;
            }
            let e = planet.erosion.elevation_km[i] as f64;
            let (nbs, cnt) = planet.grid.neighbors8(i);
            let mut min_nb = e;
            let mut max_diff = 0.0f64;
            for &nb in &nbs[..cnt] {
                let en = (planet.erosion.elevation_km[nb] as f64).max(0.0);
                min_nb = min_nb.min(en);
                max_diff = max_diff.max((e - en).abs());
            }
            let local_relief = (e - min_nb).max(0.0);
            let slope_est = max_diff / step_km;

            let bio = planet.biomes.biome[i];
            if (e >= 1.38 && (slope_est >= 0.012 || local_relief >= 0.20)) || e >= 2.25 {
                peaks.push([pr[0], pr[1], e]);
            } else if ((e >= 0.72 && e < 1.38) || (e >= 1.25 && slope_est < 0.012 && local_relief < 0.20))
                && sg.coast_dist[si] >= 4.0 * sg.ui_scale as f32
                && !is_forest_biome(bio)
            {
                hills.push([pr[0], pr[1]]);
            }
            if is_forest_biome(bio) && e < 2.25 && sg.coast_dist[si] >= 3.0 * sg.ui_scale as f32 {
                let is_pine = matches!(bio, Biome::BorealForest | Biome::TemperateRainforest) || e > 1.30;
                let warm_f = if matches!(bio, Biome::TropicalRainforest | Biome::TropicalSeasonalForest) { 1.0 } else { 0.0 };
                forests.push([pr[0], pr[1], if is_pine { 1.0 } else { 0.0 }, warm_f]);
            }
        }
    }
    peaks.sort_by(|a, b| b[2].total_cmp(&a[2]));
    (peaks, forests, hills)
}

pub(crate) fn extract_region_anchors(
    reg: &Region,
    sg: &SampledGrid,
    proj: &RegionProj,
) -> (Vec<[f64; 3]>, Vec<[f64; 4]>, Vec<[f64; 2]>) {
    let mut peaks = Vec::new();
    let mut forests = Vec::new();
    let mut hills = Vec::new();
    let rw = reg.w;
    let rh = reg.h;
    for ry in (1..(rh - 1)).step_by(2) {
        let step_km = reg.dx_km_row[ry].min(reg.dy_km).max(2.0);
        for rx in (1..(rw - 1)).step_by(2) {
            let i = ry * rw + rx;
            if reg.is_ocean[i] != 0 || reg.is_lake[i] != 0 {
                continue;
            }
            let pr = proj.project_cell(rx as f64 + 0.5, ry as f64 + 0.5);
            let px = pr[0].round() as isize;
            let py = pr[1].round() as isize;
            if px < 0 || px >= sg.w as isize || py < 0 || py >= sg.h as isize {
                continue;
            }
            let si = py as usize * sg.w + px as usize;
            if sg.inside[si] == 0 || sg.is_land[si] == 0 || sg.is_lake[si] != 0 {
                continue;
            }
            let e = reg.elevation_km[i] as f64;
            let (nbs, cnt) = reg.neighbors8(i);
            let mut min_nb = e;
            let mut max_diff = 0.0f64;
            for &nb in &nbs[..cnt] {
                let en = (reg.elevation_km[nb] as f64).max(0.0);
                min_nb = min_nb.min(en);
                max_diff = max_diff.max((e - en).abs());
            }
            let local_relief = (e - min_nb).max(0.0);
            let slope_est = max_diff / step_km;

            let bio = reg.biome[i];
            if (e >= 1.38 && (slope_est >= 0.012 || local_relief >= 0.20)) || e >= 2.25 {
                peaks.push([pr[0], pr[1], e]);
            } else if ((e >= 0.72 && e < 1.38) || (e >= 1.25 && slope_est < 0.012 && local_relief < 0.20))
                && sg.coast_dist[si] >= 4.0 * sg.ui_scale as f32
                && !is_forest_biome(bio)
            {
                hills.push([pr[0], pr[1]]);
            }
            if is_forest_biome(bio) && e < 2.25 && sg.coast_dist[si] >= 3.0 * sg.ui_scale as f32 {
                let is_pine = matches!(bio, Biome::BorealForest | Biome::TemperateRainforest) || e > 1.30;
                let warm_f = if matches!(bio, Biome::TropicalRainforest | Biome::TropicalSeasonalForest) { 1.0 } else { 0.0 };
                forests.push([pr[0], pr[1], if is_pine { 1.0 } else { 0.0 }, warm_f]);
            }
        }
    }
    peaks.sort_by(|a, b| b[2].total_cmp(&a[2]));
    (peaks, forests, hills)
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

pub(crate) fn choose_legend_rect(grid: &SampledGrid, is_world: bool) -> [f64; 4] {
    let [fx, fy, fw, fh] = grid.frame;
    let us = grid.ui_scale;
    let bw = (if is_world { 208.0 } else { 192.0 }) * us;
    let bh = (if is_world { 300.0 } else { 180.0 }) * us;
    let m = 16.0 * us;
    let top_off = (if is_world { 46.0 } else { 16.0 }) * us;
    let candidates = [
        [fx + m, fy + fh - bh - m, bw, bh],
        [fx + m, fy + top_off, bw, bh],
        [fx + fw - bw - m, fy + top_off, bw, bh],
        [fx + fw - bw - m, fy + fh - bh - 122.0 * us, bw, bh],
    ];
    let mut best_rect = candidates[0];
    let mut best_hits = usize::MAX;
    for rect in candidates {
        let x0 = (rect[0].floor() as isize).max(0) as usize;
        let x1 = ((rect[0] + rect[2]).ceil() as isize).min(grid.w as isize) as usize;
        let y0 = (rect[1].floor() as isize).max(0) as usize;
        let y1 = ((rect[1] + rect[3]).ceil() as isize).min(grid.h as isize) as usize;
        let mut hits = 0usize;
        for y in (y0..y1).step_by(2) {
            for x in (x0..x1).step_by(2) {
                let i = y * grid.w + x;
                if grid.is_land[i] != 0 || grid.polar_ice[i] != 0 {
                    hits += 1;
                }
            }
        }
        if hits < best_hits {
            best_hits = hits;
            best_rect = rect;
        }
    }
    best_rect
}

pub(crate) fn compute_legend_realms(planet: &Planet, grid: &SampledGrid, max_n: usize) -> Vec<(String, [f64; 3])> {
    let n_r = planet.civilization.realms.len();
    let mut counts = vec![0usize; n_r];
    for y in (0..grid.h).step_by(4) {
        for x in (0..grid.w).step_by(4) {
            let rid = grid.realm_id[y * grid.w + x];
            if rid >= 0 && (rid as usize) < n_r {
                counts[rid as usize] += 1;
            }
        }
    }
    let mut ranked: Vec<(usize, usize)> = counts.into_iter().enumerate().filter(|&(_, c)| c > 0).collect();
    ranked.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    ranked
        .into_iter()
        .take(max_n)
        .map(|(rid, _)| (planet.civilization.realms[rid].name.clone(), realm_archival_rgb(rid as i32)))
        .collect()
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
                    if planet.erosion.elevation_km[ii] > 1.35 {
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

pub(crate) fn collect_world_labels(planet: &Planet, wg: &SampledGrid, proj: &WorldProj) -> Vec<MapLabel> {
    let gw = planet.grid.w as f64;
    let gh = planet.grid.h as f64;
    let us = wg.ui_scale;
    let mut out = Vec::new();
    for (idx, lm) in planet.geography.landmasses.iter().enumerate() {
        if lm.kind == LandmassKind::Continent || (lm.kind == LandmassKind::LargeIsland && lm.area_km2 > 180_000.0) {
            let pr = proj.project(lm.center_lat_deg as f64, lm.center_lon_deg as f64);
            out.push(MapLabel {
                text: planet.names.landmasses[idx].to_uppercase(),
                kind: "continent",
                x: pr[0],
                y: pr[1],
                prio: 1000.0 + lm.area_km2 / 1e6,
            });
        }
    }
    let mut rsx = vec![0.0f64; planet.civilization.realms.len()];
    let mut rsy = vec![0.0f64; planet.civilization.realms.len()];
    let mut rcn = vec![0usize; planet.civilization.realms.len()];
    for y in (0..wg.h).step_by(3) {
        for x in (0..wg.w).step_by(3) {
            let rid = wg.realm_id[y * wg.w + x];
            if rid >= 0 {
                let ru = rid as usize;
                rsx[ru] += x as f64;
                rsy[ru] += y as f64;
                rcn[ru] += 1;
            }
        }
    }
    for (ru, r) in planet.civilization.realms.iter().enumerate() {
        let (cx, cy) = planet.grid.xy(r.capital_cell);
        let cpr = proj.project(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx));
        let (lx, ly) = if rcn[ru] > 20 {
            (rsx[ru] / rcn[ru] as f64, rsy[ru] / rcn[ru] as f64)
        } else {
            (cpr[0], cpr[1] - 24.0 * us)
        };
        out.push(MapLabel {
            text: r.name.clone(),
            kind: "realm",
            x: lx,
            y: ly,
            prio: 820.0 + r.area_km2 / 1e5,
        });
    }
    for (idx, rg) in planet.geography.mountain_ranges.iter().take(18).enumerate() {
        let (rx, ry) = planet.grid.xy(rg.peak_cell);
        let pr = proj.project(planet.grid.lat_deg(ry), planet.grid.lon_deg(rx));
        out.push(MapLabel {
            text: planet.names.mountain_ranges[idx].clone(),
            kind: "range",
            x: pr[0],
            y: pr[1] - 12.0 * us,
            prio: 450.0 + rg.max_elevation_km as f64 * 10.0,
        });
    }
    let mut rr_rank: Vec<(usize, f32)> = planet.hydrology.rivers.iter().enumerate().map(|(i, r)| (i, r.max_discharge_m3s)).collect();
    rr_rank.sort_by(|a, b| b.1.total_cmp(&a.1));
    for (idx, q) in rr_rank.into_iter().take(14) {
        let mid = planet.hydrology.rivers[idx].smoothed_pts[planet.hydrology.rivers[idx].smoothed_pts.len() / 2];
        let pr = proj.project(90.0 - (mid[1] as f64 / gh) * 180.0, wrap_lon_deg(((mid[0] as f64 / gw) - 0.5) * 360.0));
        out.push(MapLabel {
            text: planet.names.rivers[idx].clone(),
            kind: "river",
            x: pr[0],
            y: pr[1] - 6.0 * us,
            prio: 400.0 + q as f64 / 5000.0,
        });
    }
    for (idx, lk) in planet.geography.lakes.iter().take(8).enumerate() {
        let (lx, ly) = planet.grid.xy(lk.center_cell);
        let pr = proj.project(planet.grid.lat_deg(ly), planet.grid.lon_deg(lx));
        out.push(MapLabel {
            text: planet.names.lakes[idx].clone(),
            kind: "water",
            x: pr[0],
            y: pr[1],
            prio: 360.0 + lk.area_km2 / 10_000.0,
        });
    }
    for (idx, bay) in planet.geography.bays.iter().take(8).enumerate() {
        let (bx, by) = planet.grid.xy(bay.center_cell);
        let pr = proj.project(planet.grid.lat_deg(by), planet.grid.lon_deg(bx));
        out.push(MapLabel {
            text: planet.names.bays[idx].clone(),
            kind: "water",
            x: pr[0],
            y: pr[1],
            prio: 320.0 + bay.area_km2 / 10_000.0,
        });
    }
    out
}

pub(crate) fn collect_region_labels(planet: &Planet, rg: &SampledGrid, proj: &RegionProj) -> Vec<MapLabel> {
    let gw = planet.grid.w as f64;
    let gh = planet.grid.h as f64;
    let us = rg.ui_scale;
    let [fx0, fy0, fw, fh] = proj.frame;
    let mut out = Vec::new();
    let mut seen_realms = HashSet::new();
    for y in (fy0 as usize..(fy0 + fh) as usize).step_by(4) {
        for x in (fx0 as usize..(fx0 + fw) as usize).step_by(4) {
            let rid = rg.realm_id[y * rg.w + x];
            if rid >= 0 {
                seen_realms.insert(rid as usize);
            }
        }
    }
    for ru in seen_realms {
        let (mut sx, mut sy, mut cnt) = (0.0f64, 0.0f64, 0usize);
        for y in (fy0 as usize..(fy0 + fh) as usize).step_by(4) {
            for x in (fx0 as usize..(fx0 + fw) as usize).step_by(4) {
                if rg.realm_id[y * rg.w + x] == ru as i32 {
                    sx += x as f64;
                    sy += y as f64;
                    cnt += 1;
                }
            }
        }
        if cnt > 20 {
            out.push(MapLabel {
                text: planet.civilization.realms[ru].name.clone(),
                kind: "realm",
                x: sx / cnt as f64,
                y: sy / cnt as f64,
                prio: 920.0,
            });
        }
    }
    for (idx, r_m) in planet.geography.mountain_ranges.iter().enumerate() {
        let (rx, ry) = planet.grid.xy(r_m.peak_cell);
        if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(ry), planet.grid.lon_deg(rx)) {
            out.push(MapLabel {
                text: planet.names.mountain_ranges[idx].clone(),
                kind: "range",
                x: pr[0],
                y: pr[1] - 12.0 * us,
                prio: 620.0,
            });
        }
    }
    for (idx, lk) in planet.geography.lakes.iter().take(60).enumerate() {
        if lk.area_km2 < 18_000.0 {
            continue;
        }
        let (lx, ly) = planet.grid.xy(lk.center_cell);
        if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(ly), planet.grid.lon_deg(lx)) {
            out.push(MapLabel {
                text: planet.names.lakes[idx].clone(),
                kind: "water",
                x: pr[0],
                y: pr[1],
                prio: 540.0 + lk.area_km2 / 5000.0,
            });
        }
    }
    for (idx, riv) in planet.hydrology.rivers.iter().enumerate() {
        let mid = riv.smoothed_pts[riv.smoothed_pts.len() / 2];
        let lon = wrap_lon_deg(((mid[0] as f64 / gw) - 0.5) * 360.0);
        let lat = 90.0 - (mid[1] as f64 / gh) * 180.0;
        if let Some(pr) = proj.project_lat_lon(lat, lon) {
            out.push(MapLabel {
                text: planet.names.rivers[idx].clone(),
                kind: "river",
                x: pr[0],
                y: pr[1],
                prio: 480.0 + riv.max_discharge_m3s as f64 / 5000.0,
            });
        }
    }
    for (idx, bay) in planet.geography.bays.iter().take(80).enumerate() {
        if bay.area_km2 < 15_000.0 {
            continue;
        }
        let (bx, by) = planet.grid.xy(bay.center_cell);
        if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(by), planet.grid.lon_deg(bx)) {
            out.push(MapLabel {
                text: planet.names.bays[idx].clone(),
                kind: "water",
                x: pr[0],
                y: pr[1],
                prio: 440.0 + bay.area_km2 / 5000.0,
            });
        }
    }
    out
}

/// Простой растровый композитинг течений, рамки и компаса прямо в RGB для автономного PNG.
pub(crate) fn rasterize_overlay_finish(base_rgb: &[u8], ov: &OverlayModel, pack: &AssetPack) -> Vec<u8> {
    let mut rgb = base_rgb.to_vec();
    let w = ov.width;
    let h = ov.height;
    let [fx, fy, fw, fh] = ov.frame;
    let clip = [
        fx.floor().max(0.0) as usize,
        fy.floor().max(0.0) as usize,
        ((fx + fw).ceil() as usize).min(w),
        ((fy + fh).ceil() as usize).min(h),
    ];
    let us = (w as f64 / if ov.is_world { 2200.0 } else { 1680.0 }).clamp(0.32, 1.5);
    let rose_cx = fx + fw - 66.0 * us;
    let rose_cy = fy + fh - 68.0 * us;
    let rose_sz = (if ov.is_world { 78.0 } else { 70.0 }) * us;
    let rose_r = rose_sz * 0.5;

    let draw_line = |rgb: &mut [u8], p0: [f64; 2], p1: [f64; 2], col: [f64; 3], alpha: f64, half_w: f64| {
        let min_x = ((p0[0].min(p1[0]) - half_w - 1.0).floor() as isize).max(clip[0] as isize) as usize;
        let max_x = ((p0[0].max(p1[0]) + half_w + 1.0).ceil() as isize).min(clip[2] as isize) as usize;
        let min_y = ((p0[1].min(p1[1]) - half_w - 1.0).floor() as isize).max(clip[1] as isize) as usize;
        let max_y = ((p0[1].max(p1[1]) + half_w + 1.0).ceil() as isize).min(clip[3] as isize) as usize;
        let vx = p1[0] - p0[0];
        let vy = p1[1] - p0[1];
        let len2 = (vx * vx + vy * vy).max(1e-6);
        for y in min_y..max_y {
            for x in min_x..max_x {
                let px = x as f64 + 0.5;
                let py = y as f64 + 0.5;
                let t = (((px - p0[0]) * vx + (py - p0[1]) * vy) / len2).clamp(0.0, 1.0);
                let d = ((px - (p0[0] + vx * t)).powi(2) + (py - (p0[1] + vy * t)).powi(2)).sqrt();
                if d <= half_w + 0.6 {
                    let a = ((1.0 - (d - half_w).max(0.0) / 0.6).clamp(0.0, 1.0) * alpha).clamp(0.0, 1.0);
                    let i = (y * w + x) * 3;
                    let cur = [rgb[i] as f64, rgb[i + 1] as f64, rgb[i + 2] as f64];
                    rgb[i..i + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, col, a)));
                }
            }
        }
    };

    if ov.style == Style::Expedition {
        let lr = ov.legend_rect;
        let t_scale = if ov.is_world { 0.30 } else { 0.14 };
        let half_w = (if ov.is_world { 0.55 } else { 0.68 }) * us.max(0.6);
        for st in &ov.currents {
            for k in 0..st.len().saturating_sub(1) {
                let p0 = [st[k][0], st[k][1]];
                let p1 = [st[k + 1][0], st[k + 1][1]];
                let mx = 0.5 * (p0[0] + p1[0]);
                let my = 0.5 * (p0[1] + p1[1]);
                let in_leg = mx >= lr[0] - 6.0 && mx <= lr[0] + lr[2] + 6.0 && my >= lr[1] - 6.0 && my <= lr[1] + lr[3] + 6.0;
                if in_leg || ((mx - rose_cx).powi(2) + (my - rose_cy).powi(2)).sqrt() < rose_r + 10.0 * us {
                    continue;
                }
                let t = 0.5 * (st[k][2] + st[k + 1][2]);
                let (col, a) = if t >= 0.0 {
                    let u = (t / t_scale).min(1.0);
                    (lerp_rgb([69.0, 61.0, 54.0], [168.0, 59.0, 46.0], u), 0.56 + 0.22 * u)
                } else {
                    let u = (-t / t_scale).min(1.0);
                    (lerp_rgb([69.0, 61.0, 54.0], [43.0, 97.0, 143.0], u), 0.56 + 0.22 * u)
                };
                draw_line(&mut rgb, p0, p1, col, a, half_w);
            }
        }
    }

    let route_col = if ov.style == Style::Expedition {
        [51.0, 66.0, 74.0]
    } else {
        [220.0, 234.0, 230.0]
    };
    for rt in &ov.routes {
        if !rt.is_sea || rt.pts.len() < 2 {
            continue;
        }
        for k in 0..(rt.pts.len() - 1) {
            if k % 2 == 0 {
                draw_line(&mut rgb, rt.pts[k], rt.pts[k + 1], route_col, 0.45, 0.55 * us.max(0.6));
            }
        }
    }

    // Дискретные маркеры месторождений и водопадов на автономном растре
    let lr = ov.legend_rect;
    let dep_r = (if ov.is_world { 3.8 } else { 5.0 }) * us.max(0.6);
    for d in &ov.deposits {
        if (d.x >= lr[0] - 6.0 && d.x <= lr[0] + lr[2] + 6.0 && d.y >= lr[1] - 6.0 && d.y <= lr[1] + lr[3] + 6.0)
            || ((d.x - rose_cx).powi(2) + (d.y - rose_cy).powi(2)).sqrt() < rose_r + 12.0 * us
        {
            continue;
        }
        let fill = match d.kind {
            "iron" => [116.0, 134.0, 150.0],
            "copper" => [224.0, 168.0, 62.0],
            "gems" => [64.0, 184.0, 158.0],
            "coal" => [53.0, 50.0, 48.0],
            "oil" => [148.0, 82.0, 30.0],
            "salt" => [244.0, 239.0, 228.0],
            _ => [200.0, 155.0, 82.0],
        };
        let stroke = if d.kind == "coal" { [216.0, 207.0, 188.0] } else { [31.0, 24.0, 17.0] };
        let x0 = ((d.x - dep_r - 1.5).floor() as isize).max(clip[0] as isize) as usize;
        let x1 = ((d.x + dep_r + 1.5).ceil() as isize).min(clip[2] as isize) as usize;
        let y0 = ((d.y - dep_r - 1.5).floor() as isize).max(clip[1] as isize) as usize;
        let y1 = ((d.y + dep_r + 1.5).ceil() as isize).min(clip[3] as isize) as usize;
        for yy in y0..y1 {
            for xx in x0..x1 {
                let dist = ((xx as f64 + 0.5 - d.x).powi(2) + (yy as f64 + 0.5 - d.y).powi(2)).sqrt();
                if dist <= dep_r + 1.1 {
                    let i = (yy * w + xx) * 3;
                    let cur = [rgb[i] as f64, rgb[i + 1] as f64, rgb[i + 2] as f64];
                    let c = if dist <= dep_r - 0.8 { fill } else { stroke };
                    let a = ((dep_r + 1.1 - dist) / 0.8).clamp(0.0, 1.0) * 0.90;
                    rgb[i..i + 3].copy_from_slice(&rgb_to_u8(lerp_rgb(cur, c, a)));
                }
            }
        }
    }
    for wf in &ov.waterfalls {
        if (wf.x >= lr[0] - 6.0 && wf.x <= lr[0] + lr[2] + 6.0 && wf.y >= lr[1] - 6.0 && wf.y <= lr[1] + lr[3] + 6.0)
            || ((wf.x - rose_cx).powi(2) + (wf.y - rose_cy).powi(2)).sqrt() < rose_r + 12.0 * us
        {
            continue;
        }
        let s = (if ov.is_world { 3.6 } else { 4.8 }) * us.max(0.6);
        draw_line(&mut rgb, [wf.x - s, wf.y - s * 0.5], [wf.x + s, wf.y - s * 0.5], [242.0, 250.0, 252.0], 0.92, 1.1 * us.max(0.6));
        draw_line(&mut rgb, [wf.x - s * 0.65, wf.y + s * 0.45], [wf.x + s * 0.65, wf.y + s * 0.45], [52.0, 134.0, 168.0], 0.88, 0.95 * us.max(0.6));
    }

    // Двойная рамка на растре
    let frame_col = if ov.style == Style::Expedition { [51.0, 41.0, 31.0] } else { [31.0, 20.0, 13.0] };
    let accent_col = if ov.style == Style::Expedition { [143.0, 112.0, 71.0] } else { [199.0, 153.0, 66.0] };
    let stroke_rect = |rgb: &mut [u8], x0: isize, y0: isize, x1: isize, y1: isize, col: [f64; 3]| {
        let u8c = rgb_to_u8(col);
        for x in x0.max(0)..=x1.min(w as isize - 1) {
            for y in [y0, y1] {
                if y >= 0 && y < h as isize {
                    let i = (y as usize * w + x as usize) * 3;
                    rgb[i..i + 3].copy_from_slice(&u8c);
                }
            }
        }
        for y in y0.max(0)..=y1.min(h as isize - 1) {
            for x in [x0, x1] {
                if x >= 0 && x < w as isize {
                    let i = (y as usize * w + x as usize) * 3;
                    rgb[i..i + 3].copy_from_slice(&u8c);
                }
            }
        }
    };
    stroke_rect(&mut rgb, clip[0] as isize, clip[1] as isize, clip[2] as isize - 1, clip[3] as isize - 1, frame_col);
    stroke_rect(
        &mut rgb,
        clip[0] as isize - 5,
        clip[1] as isize - 5,
        clip[2] as isize + 4,
        clip[3] as isize + 4,
        frame_col,
    );
    stroke_rect(
        &mut rgb,
        clip[0] as isize - 2,
        clip[1] as isize - 2,
        clip[2] as isize + 1,
        clip[3] as isize + 1,
        accent_col,
    );

    let comp_scale = rose_sz / pack.compass.w.max(1) as f64;
    blit_sprite(
        &mut rgb,
        w,
        clip,
        &pack.compass,
        rose_cx,
        rose_cy,
        comp_scale,
        false,
        [255.0, 255.0, 255.0],
        0.0,
        0.22,
    );

    rgb
}

#[allow(unused_variables)]
pub(crate) fn _unused_noise_guard(_: &Noise) {}
