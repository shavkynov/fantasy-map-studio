//! Многомасштабный региональный зум: вырезка окна планеты в произвольном месте сферы
//! (включая переход через ±180°), физически обусловленная детализация рельефа, перенос граничного
//! притока глобальных рек, локальная эрозия FastScape, детальная гидрология и местные поселения.

use crate::biomes::{classify_land_biome, Biome};
use crate::civilization::SettlementRole;
use crate::grid::slope_field;
use crate::hydrology::{evap_rate_m_yr, meander_smooth_river, FlowRegime, MouthKind, River, Waterfall};
use crate::planet::Planet;
use crate::resources::ResourceKind;
use crate::rng::{Noise, Rng};
use std::cmp::Ordering;
use std::collections::{BTreeSet, BinaryHeap};
use std::f64::consts::TAU;

const SECONDS_PER_YEAR: f64 = 31_557_600.0;

/// Настройки вырезки и физического достроения региона карты.
#[derive(Clone, Debug)]
pub struct RegionOptions {
    pub center_lat_deg: f64,
    pub center_lon_deg: f64,
    pub span_lon_deg: f64,
    pub span_lat_deg: f64,
    /// Кратность повышения углового разрешения (`2..=16`).
    pub scale: usize,
    /// Число итераций локального врезания FastScape (`0..=40`).
    pub erosion_iterations: usize,
    /// Дополнительный тег сида для локальной детализации.
    pub seed_tag: String,
}

impl RegionOptions {
    pub fn new(
        center_lat_deg: f64,
        center_lon_deg: f64,
        span_lon_deg: f64,
        span_lat_deg: f64,
        scale: usize,
    ) -> Self {
        Self {
            center_lat_deg,
            center_lon_deg,
            span_lon_deg,
            span_lat_deg,
            scale,
            erosion_iterations: 12,
            seed_tag: String::new(),
        }
    }

    /// Создаёт окно вокруг глобальной ячейки `cell` размером `span_deg` по широте.
    pub fn around_cell(planet: &Planet, cell: usize, span_deg: f64, scale: usize) -> Self {
        let (x, y) = planet.grid.xy(cell);
        let lat = planet.grid.lat_deg(y).clamp(-78.0, 78.0);
        let lon = planet.grid.lon_deg(x);
        let span_lat = span_deg.clamp(2.0, 120.0);
        let span_lon = (span_deg * 1.35).clamp(2.0, 180.0);
        Self::new(lat, lon, span_lon, span_lat, scale)
    }

    fn validate(&self) -> Result<(), String> {
        if !self.center_lat_deg.is_finite()
            || !self.center_lon_deg.is_finite()
            || !self.span_lon_deg.is_finite()
            || !self.span_lat_deg.is_finite()
        {
            return Err("Region coordinates must be finite".into());
        }
        if !(2..=16).contains(&self.scale) {
            return Err("Region scale must be within 2..=16".into());
        }
        if !(2.0..=180.0).contains(&self.span_lon_deg) {
            return Err("Region span_lon_deg must be within 2..=180".into());
        }
        if !(2.0..=120.0).contains(&self.span_lat_deg) {
            return Err("Region span_lat_deg must be within 2..=120".into());
        }
        if !(-85.0..=85.0).contains(&self.center_lat_deg) {
            return Err("Region center_lat_deg must be within -85..=85".into());
        }
        if self.erosion_iterations > 40 {
            return Err("Region erosion_iterations must be <= 40".into());
        }
        Ok(())
    }
}

/// Горный перевал, выделенный на детализированном региональном рельефе.
#[derive(Clone, Debug)]
pub struct RegionPass {
    pub cell: usize,
    pub x: usize,
    pub y: usize,
    pub elevation_km: f32,
    pub prominence_drop_km: f32,
}

/// Поселение, перенесённое и привязанное к детальному рельефу/берегу/рекам региона.
#[derive(Clone, Debug)]
pub struct RegionSettlement {
    pub global_id: Option<u32>,
    pub name: String,
    pub cell: usize,
    pub x: usize,
    pub y: usize,
    pub role: SettlementRole,
    pub is_port: bool,
    pub river_access: bool,
}

/// Сухопутная дорога в региональном масштабе, проложенная по рельефу и перевалам.
#[derive(Clone, Debug)]
pub struct RegionRoad {
    pub cells: Vec<usize>,
    pub pts: Vec<[f32; 2]>,
}

/// Дискретное месторождение ресурса, привязанное к детальному рельефу и геологии региона.
#[derive(Clone, Debug)]
pub struct RegionDeposit {
    pub kind: ResourceKind,
    pub cell: usize,
    pub x: usize,
    pub y: usize,
    pub richness: f32,
}

/// Детализированная физическая, гидрологическая и поселенческая модель региона.
#[derive(Clone, Debug)]
pub struct Region {
    pub w: usize,
    pub h: usize,
    pub scale: usize,
    pub radius_km: f64,
    pub center_lat_deg: f64,
    pub center_lon_deg: f64,
    pub lat_min_deg: f64,
    pub lat_max_deg: f64,
    pub lon_min_deg: f64,
    pub lon_max_deg: f64,
    pub dx_km_row: Vec<f64>,
    pub dy_km: f64,
    pub cell_area_km2: Vec<f64>,
    pub elevation_km: Vec<f32>,
    pub coarse_elevation_km: Vec<f32>,
    pub incised_km: Vec<f32>,
    pub alluvium_km: Vec<f32>,
    pub glacial_carve_km: Vec<f32>,
    pub temp_c: Vec<f32>,
    pub temp_jan_c: Vec<f32>,
    pub temp_jul_c: Vec<f32>,
    pub precip_mm: Vec<f32>,
    pub glacier: Vec<f32>,
    pub permafrost: Vec<f32>,
    pub biome: Vec<Biome>,
    pub is_ocean: Vec<u8>,
    pub is_lake: Vec<u8>,
    pub is_endorheic_lake: Vec<u8>,
    pub is_salt_flat: Vec<u8>,
    pub is_wadi: Vec<u8>,
    pub is_oasis: Vec<u8>,
    pub is_delta: Vec<u8>,
    pub lake_surface_km: Vec<f32>,
    pub filled_km: Vec<f32>,
    pub receiver: Vec<i32>,
    pub boundary_inflow_m3s: Vec<f32>,
    pub discharge_m3s: Vec<f32>,
    pub discharge_jan_m3s: Vec<f32>,
    pub discharge_jul_m3s: Vec<f32>,
    pub river_mask: Vec<u8>,
    pub river_order: Vec<u8>,
    pub coast_type: Vec<u8>,
    pub rivers: Vec<River>,
    pub waterfalls: Vec<Waterfall>,
    pub passes: Vec<RegionPass>,
    pub settlements: Vec<RegionSettlement>,
    pub roads: Vec<RegionRoad>,
    pub deposits: Vec<RegionDeposit>,
}

#[derive(Clone, Copy)]
struct RoadNode {
    cost: f64,
    cell: usize,
}

impl Eq for RoadNode {}
impl PartialEq for RoadNode {
    fn eq(&self, other: &Self) -> bool {
        self.cell == other.cell && self.cost.to_bits() == other.cost.to_bits()
    }
}
impl Ord for RoadNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| self.cell.cmp(&other.cell))
    }
}
impl PartialOrd for RoadNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[allow(clippy::too_many_arguments)]
fn route_region_road_fields(
    w: usize,
    h: usize,
    dx_km_row: &[f64],
    dy_km: f64,
    elevation_km: &[f32],
    is_ocean: &[u8],
    is_lake: &[u8],
    biome: &[Biome],
    permafrost: &[f32],
    river_mask: &[u8],
    passes: &[RegionPass],
    from_cell: usize,
    to_cell: usize,
    existing_mask: Option<&[u8]>,
) -> Option<RegionRoad> {
    let n = w * h;
    if from_cell >= n || to_cell >= n {
        return None;
    }
    if is_ocean[from_cell] != 0
        || is_lake[from_cell] != 0
        || is_ocean[to_cell] != 0
        || is_lake[to_cell] != 0
        || biome[from_cell] == Biome::IceSheet
        || biome[to_cell] == Biome::IceSheet
    {
        return None;
    }
    if from_cell == to_cell {
        let pt = [(from_cell % w) as f32 + 0.5, (from_cell / w) as f32 + 0.5];
        return Some(RegionRoad {
            cells: vec![from_cell],
            pts: vec![pt],
        });
    }

    let mut is_pass_zone = vec![0u8; n];
    for p in passes {
        let px = p.x as isize;
        let py = p.y as isize;
        for dy in -3isize..=3 {
            let yy = py + dy;
            if yy < 0 || yy >= h as isize {
                continue;
            }
            for dx in -3isize..=3 {
                let xx = px + dx;
                if xx < 0 || xx >= w as isize {
                    continue;
                }
                is_pass_zone[yy as usize * w + xx as usize] = 1;
            }
        }
    }

    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    dist[from_cell] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(RoadNode {
        cost: 0.0,
        cell: from_cell,
    });

    while let Some(RoadNode { cost, cell }) = heap.pop() {
        if cost > dist[cell] + 1e-6 {
            continue;
        }
        if cell == to_cell {
            break;
        }
        let (ux, uy) = (cell % w, cell / w);
        let (nbs, cnt) = reg_neighbors8(cell, w, h);
        for &nb in &nbs[..cnt] {
            if is_ocean[nb] != 0 || is_lake[nb] != 0 || biome[nb] == Biome::IceSheet {
                continue;
            }
            let (vx, vy) = (nb % w, nb / w);
            let step_e_km = (vx as f64 - ux as f64) * dx_km_row[uy];
            let step_n_km = (vy as f64 - uy as f64) * dy_km;
            let dist_km = step_e_km.hypot(step_n_km).max(0.25);

            let elev_u = elevation_km[cell] as f64;
            let elev_v = elevation_km[nb] as f64;
            let dz = (elev_v - elev_u).abs();
            let grade = dz / dist_km;
            let in_pass = is_pass_zone[cell] != 0 || is_pass_zone[nb] != 0;

            let slope_pen = if in_pass {
                6.0 * grade
            } else {
                32.0 * grade + 850.0 * grade * grade
            };
            let alt_pen = if elev_v > 1.15 && !in_pass {
                16.0 * (elev_v - 1.15).powf(1.6) + 55.0 * (elev_v - 1.85).max(0.0)
            } else if elev_v > 1.4 && in_pass {
                1.5 * (elev_v - 1.4)
            } else {
                0.0
            };
            let river_cross_pen = if river_mask[nb] != 0 && river_mask[cell] == 0 {
                1.4
            } else {
                0.0
            };
            let biome_pen = match biome[nb] {
                Biome::Wetland | Biome::TropicalRainforest => 1.6,
                Biome::HotDesert | Biome::ColdDesert | Biome::PolarDesert | Biome::SaltFlat => 1.4,
                Biome::Alpine => 1.2,
                Biome::TemperateGrassland | Biome::TropicalSavanna | Biome::Mediterranean => 0.0,
                _ => 0.35,
            };
            let reuse_mult = match existing_mask {
                Some(m) if m[nb] != 0 => 0.62,
                _ => 1.0,
            };
            let border_pen = if vx == 0 || vx + 1 == w || vy == 0 || vy + 1 == h {
                0.35
            } else {
                0.0
            };

            let perma_pen = 2.4 * (permafrost[nb] as f64).clamp(0.0, 1.0);
            let step_cost =
                dist_km * (1.0 + slope_pen + alt_pen + river_cross_pen + biome_pen + perma_pen + border_pen) * reuse_mult;
            let nc = cost + step_cost;
            if nc + 1e-6 < dist[nb] {
                dist[nb] = nc;
                prev[nb] = cell;
                heap.push(RoadNode { cost: nc, cell: nb });
            }
        }
    }

    if !dist[to_cell].is_finite() {
        return None;
    }

    let mut cells = Vec::new();
    let mut cur = to_cell;
    while cur != usize::MAX {
        cells.push(cur);
        if cur == from_cell {
            break;
        }
        cur = prev[cur];
    }
    if cells.last() != Some(&from_cell) {
        return None;
    }
    cells.reverse();

    let raw: Vec<[f32; 2]> = cells
        .iter()
        .map(|&c| [(c % w) as f32 + 0.5, (c / w) as f32 + 0.5])
        .collect();
    let pts = smooth_region_road_pts(&raw, w, h, elevation_km, is_ocean, is_lake);
    Some(RegionRoad { cells, pts })
}

fn smooth_region_road_pts(
    raw: &[[f32; 2]],
    w: usize,
    h: usize,
    elevation_km: &[f32],
    is_ocean: &[u8],
    is_lake: &[u8],
) -> Vec<[f32; 2]> {
    if raw.len() < 3 {
        return raw.to_vec();
    }
    let mut out = Vec::with_capacity(raw.len() * 2);
    out.push(raw[0]);
    for i in 0..(raw.len() - 1) {
        let p0 = raw[i];
        let p1 = raw[i + 1];
        let ax = p0[0] * 0.75 + p1[0] * 0.25;
        let ay = p0[1] * 0.75 + p1[1] * 0.25;
        let bx = p0[0] * 0.25 + p1[0] * 0.75;
        let by = p0[1] * 0.25 + p1[1] * 0.75;
        let c0 = (p0[1].floor() as usize).min(h - 1) * w + (p0[0].floor() as usize).min(w - 1);
        let c1 = (p1[1].floor() as usize).min(h - 1) * w + (p1[0].floor() as usize).min(w - 1);
        let e_ref = 0.5 * (elevation_km[c0] + elevation_km[c1]) + 0.25;

        let check_pt = |px: f32, py: f32| -> [f32; 2] {
            let cx = (px.floor() as isize).clamp(0, w as isize - 1) as usize;
            let cy = (py.floor() as isize).clamp(0, h as isize - 1) as usize;
            let c = cy * w + cx;
            if is_ocean[c] == 0 && is_lake[c] == 0 && elevation_km[c] <= e_ref {
                [px, py]
            } else {
                [0.5 * (p0[0] + p1[0]), 0.5 * (p0[1] + p1[1])]
            }
        };
        out.push(check_pt(ax, ay));
        out.push(check_pt(bx, by));
    }
    out.push(*raw.last().unwrap());
    out
}

/// Прокладывает сухопутную дорогу между двумя клетками детального региона по рельефу, долинам и перевалам.
pub fn route_region_road(
    reg: &Region,
    from_cell: usize,
    to_cell: usize,
    existing_mask: Option<&[u8]>,
) -> Option<RegionRoad> {
    route_region_road_fields(
        reg.w,
        reg.h,
        &reg.dx_km_row,
        reg.dy_km,
        &reg.elevation_km,
        &reg.is_ocean,
        &reg.is_lake,
        &reg.biome,
        &reg.permafrost,
        &reg.river_mask,
        &reg.passes,
        from_cell,
        to_cell,
        existing_mask,
    )
}

impl Region {
    #[inline]
    pub fn idx(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    #[inline]
    pub fn xy(&self, idx: usize) -> (usize, usize) {
        (idx % self.w, idx / self.w)
    }

    #[inline]
    pub fn lat_deg(&self, y: usize) -> f64 {
        self.lat_max_deg
            - ((y as f64 + 0.5) / self.h as f64) * (self.lat_max_deg - self.lat_min_deg)
    }

    #[inline]
    pub fn lon_deg(&self, x: usize) -> f64 {
        let raw = self.lon_min_deg
            + ((x as f64 + 0.5) / self.w as f64) * (self.lon_max_deg - self.lon_min_deg);
        (raw + 540.0).rem_euclid(360.0) - 180.0
    }

    #[inline]
    pub fn neighbors4(&self, idx: usize) -> ([usize; 4], usize) {
        reg_neighbors4(idx, self.w, self.h)
    }

    #[inline]
    pub fn neighbors8(&self, idx: usize) -> ([usize; 8], usize) {
        reg_neighbors8(idx, self.w, self.h)
    }
}

#[inline]
fn reg_neighbors4(idx: usize, w: usize, h: usize) -> ([usize; 4], usize) {
    let x = idx % w;
    let y = idx / w;
    let mut out = [0usize; 4];
    let mut n = 0;
    if x > 0 {
        out[n] = idx - 1;
        n += 1;
    }
    if x + 1 < w {
        out[n] = idx + 1;
        n += 1;
    }
    if y > 0 {
        out[n] = idx - w;
        n += 1;
    }
    if y + 1 < h {
        out[n] = idx + w;
        n += 1;
    }
    (out, n)
}

#[inline]
fn reg_neighbors8(idx: usize, w: usize, h: usize) -> ([usize; 8], usize) {
    let x = idx % w;
    let y = idx / w;
    let mut out = [0usize; 8];
    let mut n = 0;
    let x0 = x.saturating_sub(1);
    let x1 = (x + 1).min(w - 1);
    let y0 = y.saturating_sub(1);
    let y1 = (y + 1).min(h - 1);
    for yy in y0..=y1 {
        for xx in x0..=x1 {
            let nb = yy * w + xx;
            if nb != idx {
                out[n] = nb;
                n += 1;
            }
        }
    }
    (out, n)
}

#[inline]
fn cell_jitter(idx: usize) -> f64 {
    let x = (idx as u32).wrapping_mul(2654435761);
    (x as f64) / 4294967296.0
}

#[derive(Clone, Copy, Debug)]
struct FloodCell {
    elev: f64,
    idx: usize,
}

impl Eq for FloodCell {}
impl PartialEq for FloodCell {
    fn eq(&self, other: &Self) -> bool {
        self.idx == other.idx && self.elev.to_bits() == other.elev.to_bits()
    }
}
impl Ord for FloodCell {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .elev
            .total_cmp(&self.elev)
            .then_with(|| other.idx.cmp(&self.idx))
    }
}
impl PartialOrd for FloodCell {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn reg_slope_field(elev: &[f32], w: usize, h: usize, dx_row: &[f64], dy_km: f64) -> Vec<f32> {
    let mut out = vec![0.0f32; w * h];
    let dy = dy_km as f32;
    for y in 0..h {
        let dx = dx_row[y] as f32;
        let y0 = y.saturating_sub(1);
        let y1 = (y + 1).min(h - 1);
        let span_y = ((y1 - y0).max(1) as f32) * dy;
        let row = y * w;
        for x in 0..w {
            let x0 = x.saturating_sub(1);
            let x1 = (x + 1).min(w - 1);
            let span_x = ((x1 - x0).max(1) as f32) * dx;
            let gx = (elev[row + x1] - elev[row + x0]) / span_x;
            let gy = (elev[y1 * w + x] - elev[y0 * w + x]) / span_y;
            out[row + x] = gx.hypot(gy);
        }
    }
    out
}

/// Строит детализированный регион планеты с граничными условиями и непрерывным стоком глобальной модели.
pub fn generate_region(planet: &Planet, opt: &RegionOptions) -> Result<Region, String> {
    opt.validate()?;
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let radius_km = planet.grid.radius_km;

    let lat_max_deg = (opt.center_lat_deg + 0.5 * opt.span_lat_deg).min(89.5);
    let lat_min_deg = (opt.center_lat_deg - 0.5 * opt.span_lat_deg).max(-89.5);
    let actual_span_lat = lat_max_deg - lat_min_deg;
    if actual_span_lat < 2.0 {
        return Err("Effective latitude span must be >= 2 degrees".into());
    }
    let center_lat_deg = 0.5 * (lat_min_deg + lat_max_deg);
    let center_lon_deg = (opt.center_lon_deg + 540.0).rem_euclid(360.0) - 180.0;
    let lon_min_deg = center_lon_deg - 0.5 * opt.span_lon_deg;
    let lon_max_deg = center_lon_deg + 0.5 * opt.span_lon_deg;

    let w = ((opt.span_lon_deg / 360.0) * (gw as f64) * (opt.scale as f64)).round() as usize;
    let h = ((actual_span_lat / 180.0) * (gh as f64) * (opt.scale as f64)).round() as usize;
    if w < 24 || h < 24 {
        return Err("Region window too small: must produce at least 24x24 cells".into());
    }
    if w * h > 512 * 512 {
        return Err("Region grid exceeds 262144 cells; reduce span or scale".into());
    }
    let n = w * h;

    let dy_km = (actual_span_lat.to_radians() * radius_km) / h as f64;
    let d_lon_rad = opt.span_lon_deg.to_radians() / w as f64;
    let mut dx_km_row = Vec::with_capacity(h);
    let mut cell_area_km2 = Vec::with_capacity(h);
    for y in 0..h {
        let lat_deg = lat_max_deg - ((y as f64 + 0.5) / h as f64) * actual_span_lat;
        let lat_rad = lat_deg.to_radians();
        dx_km_row.push((radius_km * d_lon_rad * lat_rad.cos()).max(0.05 * dy_km));
        let lat0 = (lat_max_deg - (y as f64 / h as f64) * actual_span_lat).to_radians();
        let lat1 = (lat_max_deg - ((y + 1) as f64 / h as f64) * actual_span_lat).to_radians();
        cell_area_km2.push(d_lon_rad * (lat0.sin() - lat1.sin()).abs() * radius_km * radius_km);
    }

    // 1. Билинейный перенос глобальных полей с бесшовным X-замыканием ±180°
    let coarse_global_slope = slope_field(&planet.erosion.elevation_km, &planet.grid);
    let t_now = planet.tectonic.stats.time;

    let sample_bilinear = |lat_deg: f64, lon_deg: f64, field: &[f32]| -> f64 {
        let gx = ((lon_deg + 180.0).rem_euclid(360.0) / 360.0) * (gw as f64) - 0.5;
        let gy = (((90.0 - lat_deg) / 180.0) * (gh as f64) - 0.5).clamp(0.0, (gh - 1) as f64);
        let x0 = (gx.floor() as isize).rem_euclid(gw as isize) as usize;
        let x1 = (x0 + 1) % gw;
        let tx = gx - gx.floor();
        let y0 = (gy.floor() as usize).min(gh - 1);
        let y1 = (y0 + 1).min(gh - 1);
        let ty = gy - (y0 as f64);
        let a = field[y0 * gw + x0] as f64;
        let b = field[y0 * gw + x1] as f64;
        let c = field[y1 * gw + x0] as f64;
        let d = field[y1 * gw + x1] as f64;
        (a * (1.0 - tx) + b * tx) * (1.0 - ty) + (c * (1.0 - tx) + d * tx) * ty
    };

    let sample_nearest_idx = |lat_deg: f64, lon_deg: f64| -> usize {
        let gx = ((lon_deg + 180.0).rem_euclid(360.0) / 360.0) * (gw as f64);
        let gy = ((90.0 - lat_deg) / 180.0) * (gh as f64);
        let nx = (gx.floor() as isize).rem_euclid(gw as isize) as usize;
        let ny = (gy.floor() as isize).clamp(0, gh as isize - 1) as usize;
        ny * gw + nx
    };

    let mut rng_det = Rng::new(&format!("{}|region|{}", planet.seed, opt.seed_tag));
    let noise_det = Noise::new(&mut rng_det);

    let mut coarse_elevation_km = vec![0.0f32; n];
    let mut init_elev_f64 = vec![0.0f64; n];
    let mut coarse_temp_c = vec![0.0f32; n];
    let mut coarse_temp_jan_c = vec![0.0f32; n];
    let mut coarse_temp_jul_c = vec![0.0f32; n];
    let mut precip_mm = vec![0.0f32; n];
    let mut precip_jan_mm = vec![0.0f32; n];
    let mut precip_jul_mm = vec![0.0f32; n];
    let mut moisture = vec![0.0f32; n];
    let mut aridity_base = vec![0.0f32; n];
    let mut monsoon_index = vec![0.0f32; n];
    let mut snow_frac = vec![0.0f32; n];
    let mut glacier = vec![0.0f32; n];
    let mut erodibility = vec![1.0f64; n];
    let mut coast_type_near = vec![0u8; n];
    let mut global_ocean_near = vec![0u8; n];

    let scale_f = (1.0 - 1.0 / opt.scale as f64).clamp(0.3, 0.95);

    for y in 0..h {
        let lat_deg = lat_max_deg - ((y as f64 + 0.5) / h as f64) * actual_span_lat;
        let lat_rad = lat_deg.to_radians();
        let cl = lat_rad.cos();
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let raw_lon = lon_min_deg + ((x as f64 + 0.5) / w as f64) * opt.span_lon_deg;
            let lon_deg = (raw_lon + 540.0).rem_euclid(360.0) - 180.0;
            let lon_rad = lon_deg.to_radians();
            let p = [cl * lon_rad.cos(), cl * lon_rad.sin(), lat_rad.sin()];

            let ce = sample_bilinear(lat_deg, lon_deg, &planet.erosion.elevation_km);
            let cs = sample_bilinear(lat_deg, lon_deg, &coarse_global_slope);
            let volc = sample_bilinear(lat_deg, lon_deg, &planet.tectonic.volcanic);
            let rift = sample_bilinear(lat_deg, lon_deg, &planet.tectonic.rift);
            let inc = sample_bilinear(lat_deg, lon_deg, &planet.erosion.incised_km);
            let erod = sample_bilinear(lat_deg, lon_deg, &planet.erosion.erodibility);

            coarse_elevation_km[i] = ce as f32;
            coarse_temp_c[i] = sample_bilinear(lat_deg, lon_deg, &planet.climate.temp_c) as f32;
            coarse_temp_jan_c[i] =
                sample_bilinear(lat_deg, lon_deg, &planet.climate.temp_jan_c) as f32;
            coarse_temp_jul_c[i] =
                sample_bilinear(lat_deg, lon_deg, &planet.climate.temp_jul_c) as f32;
            precip_mm[i] =
                sample_bilinear(lat_deg, lon_deg, &planet.climate.precip_mm).max(5.0) as f32;
            precip_jan_mm[i] =
                sample_bilinear(lat_deg, lon_deg, &planet.climate.precip_jan_mm).max(5.0) as f32;
            precip_jul_mm[i] =
                sample_bilinear(lat_deg, lon_deg, &planet.climate.precip_jul_mm).max(5.0) as f32;
            moisture[i] = sample_bilinear(lat_deg, lon_deg, &planet.climate.moisture)
                .clamp(0.02, 1.0) as f32;
            aridity_base[i] = sample_bilinear(lat_deg, lon_deg, &planet.climate.aridity_index)
                .max(0.0) as f32;
            monsoon_index[i] = sample_bilinear(lat_deg, lon_deg, &planet.climate.monsoon_index)
                .clamp(0.0, 2.0) as f32;
            snow_frac[i] = sample_bilinear(lat_deg, lon_deg, &planet.climate.snow_frac)
                .clamp(0.0, 1.0) as f32;
            let gl = sample_bilinear(lat_deg, lon_deg, &planet.climate.glacier)
                .clamp(0.0, 1.0);
            glacier[i] = gl as f32;
            erodibility[i] = erod.clamp(0.45, 1.85);

            let g_idx = sample_nearest_idx(lat_deg, lon_deg);
            let ct = planet.hydrology.coast_type[g_idx];
            coast_type_near[i] = ct;
            global_ocean_near[i] = planet.hydrology.is_ocean[g_idx];

            // Мелкомасштабная детализация строго на 3D-сфере: отсутствие швов на ±180°
            let n1 = noise_det.get(p[0] * 22.0 + 3.1, p[1] * 22.0 - 1.7, p[2] * 22.0 + 5.3);
            let n2 = noise_det.get(p[0] * 52.0 - 4.2, p[1] * 52.0 + 2.9, p[2] * 52.0 - 6.1);
            let r1 = 1.0 - n1.abs();
            let r2 = 1.0 - n2.abs();
            let ridge = 0.65 * (r1 - 0.50) + 0.35 * (r2 - 0.50);
            let fine = noise_det.fbm(p[0] * 38.0 + 7.7, p[1] * 38.0 - 3.3, p[2] * 38.0 + 1.9, 3);

            let young_oro = if planet.tectonic.t_oro_myr[g_idx] >= 0.0
                && (t_now - planet.tectonic.t_oro_myr[g_idx] as f64) < 350.0
            {
                0.15
            } else {
                0.0
            };
            let rough = (ce.max(0.0) * 0.25
                + cs * 3.8
                + 0.20 * volc
                + 0.16 * rift
                + 0.12 * inc
                + young_oro)
                * scale_f;
            let terrain_delta = (0.58 * ridge + 0.42 * fine) * rough.clamp(0.02, 0.90);

            let coast_weight = (1.0 - (ce.abs() / 0.35)).clamp(0.0, 1.0);
            let coast_amp = if ct == 3 || gl > 0.05 {
                0.16
            } else if ct == 4 {
                0.10
            } else {
                0.05
            };
            let coast_delta = coast_weight
                * coast_amp
                * scale_f
                * (0.65 * n1 + 0.35 * fine);

            init_elev_f64[i] = ce + terrain_delta + coast_delta;
        }
    }

    // 2. Перенос граничного притока глобальных рек внутрь региона
    let global_to_region_xy = |lat_deg: f64, lon_deg: f64| -> Option<(usize, usize)> {
        let dlon = (lon_deg - center_lon_deg + 540.0).rem_euclid(360.0) - 180.0;
        let half_lon = 0.5 * opt.span_lon_deg;
        if dlon < -half_lon || dlon > half_lon || lat_deg < lat_min_deg || lat_deg > lat_max_deg {
            return None;
        }
        let rx = (((dlon + half_lon) / opt.span_lon_deg) * (w as f64))
            .floor()
            .clamp(0.0, (w - 1) as f64) as usize;
        let ry = (((lat_max_deg - lat_deg) / actual_span_lat) * (h as f64))
            .floor()
            .clamp(0.0, (h - 1) as f64) as usize;
        Some((rx, ry))
    };

    let mut boundary_inflow_m3s = vec![0.0f32; n];
    let mut boundary_inflow_jan = vec![0.0f32; n];
    let mut boundary_inflow_jul = vec![0.0f32; n];
    let mut inflow_guard = vec![0u8; n];
    let r_snap = (opt.scale / 2).max(1) as isize;
    let x_lo_safe = if w > 4 { 1 } else { 0 };
    let x_hi_safe = if w > 4 { w - 2 } else { w - 1 };
    let y_lo_safe = if h > 4 { 1 } else { 0 };
    let y_hi_safe = if h > 4 { h - 2 } else { h - 1 };

    for u in 0..planet.grid.len() {
        if planet.hydrology.is_ocean[u] != 0 || planet.hydrology.discharge_m3s[u] <= 50.0 {
            continue;
        }
        let (ux, uy) = planet.grid.xy(u);
        if global_to_region_xy(planet.grid.lat_deg(uy), planet.grid.lon_deg(ux)).is_some() {
            continue;
        }
        let r = planet.hydrology.receiver[u];
        if r < 0 {
            continue;
        }
        let (gx, gy) = planet.grid.xy(r as usize);
        let Some((ix, iy)) =
            global_to_region_xy(planet.grid.lat_deg(gy), planet.grid.lon_deg(gx))
        else {
            continue;
        };

        let mut best_cell = iy.clamp(y_lo_safe, y_hi_safe) * w + ix.clamp(x_lo_safe, x_hi_safe);
        let mut best_elev = f64::INFINITY;
        let x0 = (ix as isize - r_snap).max(x_lo_safe as isize) as usize;
        let x1 = (ix as isize + r_snap).min(x_hi_safe as isize) as usize;
        let y0 = (iy as isize - r_snap).max(y_lo_safe as isize) as usize;
        let y1 = (iy as isize + r_snap).min(y_hi_safe as isize) as usize;
        for yy in y0..=y1 {
            for xx in x0..=x1 {
                let c = yy * w + xx;
                let e = init_elev_f64[c];
                let adj = if e > 0.0 { e } else { e + 10.0 };
                if adj < best_elev {
                    best_elev = adj;
                    best_cell = c;
                }
            }
        }
        boundary_inflow_m3s[best_cell] += planet.hydrology.discharge_m3s[u];
        boundary_inflow_jan[best_cell] += planet.hydrology.discharge_jan_m3s[u];
        boundary_inflow_jul[best_cell] += planet.hydrology.discharge_jul_m3s[u];

        // Не даём граничным клеткам рядом с точкой входа глобальной реки мгновенно выводить приток наружу за край рамки
        let (bx, by) = (best_cell % w, best_cell / w);
        let gx0 = bx.saturating_sub(3);
        let gx1 = (bx + 3).min(w - 1);
        let gy0 = by.saturating_sub(3);
        let gy1 = (by + 3).min(h - 1);
        for py in gy0..=gy1 {
            for px in gx0..=gx1 {
                if px == 0 || px + 1 == w || py == 0 || py + 1 == h {
                    inflow_guard[py * w + px] = 1;
                }
            }
        }
    }

    // 3. Детализированная эрозия FastScape в открытой области
    let mut runoff_m3s = vec![0.0f64; n];
    for y in 0..h {
        let am2 = cell_area_km2[y] * 1e6;
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let melt_boost = 1.0 + 0.25 * (snow_frac[i] as f64).max(glacier[i] as f64);
            let coeff = ((0.25 + 0.45 * (moisture[i] as f64)) * melt_boost).clamp(0.10, 0.85);
            runoff_m3s[i] = (am2 * (precip_mm[i] as f64) * 1e-3 * coeff) / SECONDS_PER_YEAR;
        }
    }

    let dx_avg_km = (dx_km_row.iter().sum::<f64>() / dx_km_row.len() as f64).max(1.0);
    let q_ref_erosion = (500.0 * (dx_avg_km / 20.0).powf(1.5)).clamp(80.0, 2500.0);

    let mut elev_f64 = init_elev_f64.clone();
    let mut alluvium_km = vec![0.0f32; n];
    let mut glacial_carve_km = vec![0.0f32; n];

    let mut is_ocean = vec![0u8; n];
    let mut comp_id = vec![-1i32; n];
    let mut stack = Vec::with_capacity(n / 4 + 64);
    let mut filled_f64 = vec![0.0f64; n];
    let mut receiver = vec![-1i32; n];
    let mut vis = vec![0u8; n];
    let mut discharge = vec![0.0f64; n];
    let mut sed_flux = vec![0.0f64; n];
    let mut min_up_h = vec![f64::INFINITY; n];
    let mut h_next = vec![0.0f64; n];
    let mut in_deg = vec![0u32; n];
    let mut top_queue = Vec::with_capacity(n / 2 + 16);
    let mut order = Vec::with_capacity(n);

    let mark_ocean = |h_arr: &[f64],
                      is_oce: &mut [u8],
                      cid_buf: &mut [i32],
                      stk: &mut Vec<usize>| {
        is_oce.fill(0);
        cid_buf.fill(-1);
        let mut sizes: Vec<(usize, bool, bool)> = Vec::new();
        for s0 in 0..n {
            if h_arr[s0] > 0.0 || cid_buf[s0] >= 0 {
                continue;
            }
            let id = sizes.len() as i32;
            let mut sz = 0usize;
            let mut touches_global_sea = false;
            let mut touches_edge_sea = false;
            cid_buf[s0] = id;
            stk.push(s0);
            while let Some(c) = stk.pop() {
                sz += 1;
                if global_ocean_near[c] != 0 {
                    touches_global_sea = true;
                }
                let (cx, cy) = (c % w, c / w);
                if (cx == 0 || cx + 1 == w || cy == 0 || cy + 1 == h)
                    && coarse_elevation_km[c] <= 0.05
                {
                    touches_edge_sea = true;
                }
                let (nbs, cnt) = reg_neighbors4(c, w, h);
                for &nb in &nbs[..cnt] {
                    if h_arr[nb] <= 0.0 && cid_buf[nb] < 0 {
                        cid_buf[nb] = id;
                        stk.push(nb);
                    }
                }
            }
            sizes.push((sz, touches_global_sea, touches_edge_sea));
        }
        let ocean_min = (n / 120).max(16);
        for i in 0..n {
            let cid = cid_buf[i];
            if cid >= 0 {
                let (sz, gsea, esea) = sizes[cid as usize];
                if gsea || esea || sz >= ocean_min {
                    is_oce[i] = 1;
                }
            }
        }
    };

    for _iter in 0..opt.erosion_iterations {
        // 3a. Склоновая диффузия до вреза
        h_next.copy_from_slice(&elev_f64);
        for c in 0..n {
            if elev_f64[c] <= 0.0 {
                continue;
            }
            let (nbs, cnt) = reg_neighbors4(c, w, h);
            let mut sum_nb = 0.0;
            for &nb in &nbs[..cnt] {
                sum_nb += elev_f64[nb].max(0.0);
            }
            let avg_nb = sum_nb / cnt as f64;
            h_next[c] = (elev_f64[c] + 0.04 * (avg_nb - elev_f64[c])).max(0.001);
        }
        elev_f64.copy_from_slice(&h_next);

        mark_ocean(&elev_f64, &mut is_ocean, &mut comp_id, &mut stack);

        // 3b. Priority-Flood с открытым периметром области
        vis.fill(0);
        receiver.fill(-1);
        let mut heap = BinaryHeap::with_capacity(n / 4 + 64);
        for y in 0..h {
            let row = y * w;
            for x in 0..w {
                let i = row + x;
                let on_edge = x == 0 || x + 1 == w || y == 0 || y + 1 == h;
                if is_ocean[i] != 0 || (on_edge && inflow_guard[i] == 0) {
                    vis[i] = 1;
                    filled_f64[i] = elev_f64[i];
                    heap.push(FloodCell {
                        elev: elev_f64[i],
                        idx: i,
                    });
                }
            }
        }
        if heap.is_empty() {
            vis[0] = 1;
            filled_f64[0] = elev_f64[0];
            heap.push(FloodCell {
                elev: elev_f64[0],
                idx: 0,
            });
        }

        while let Some(FloodCell { elev: f_c, idx: c }) = heap.pop() {
            let (cx, cy) = (c % w, c / w);
            let (nbs, cnt) = reg_neighbors8(c, w, h);
            for &nb in &nbs[..cnt] {
                if vis[nb] != 0 {
                    continue;
                }
                vis[nb] = 1;
                receiver[nb] = c as i32;
                let (nx, ny) = (nb % w, nb / w);
                let diag = nx != cx && ny != cy;
                let step_eps =
                    6e-5 * (if diag { 1.4142 } else { 1.0 }) * (1.0 + 0.5 * cell_jitter(nb));
                let f_n = elev_f64[nb].max(f_c + step_eps);
                filled_f64[nb] = f_n;
                heap.push(FloodCell { elev: f_n, idx: nb });
            }
        }

        for c in 0..n {
            if is_ocean[c] != 0 || receiver[c] < 0 || filled_f64[c] > elev_f64[c] + 1e-6 {
                continue;
            }
            let (cx, cy) = (c % w, c / w);
            let dx_c = dx_km_row[cy];
            let (nbs, cnt) = reg_neighbors8(c, w, h);
            let mut best_r = receiver[c];
            let mut best_s = f64::NEG_INFINITY;
            for &nb in &nbs[..cnt] {
                if filled_f64[nb] >= filled_f64[c] {
                    continue;
                }
                let (nx, ny) = (nb % w, nb / w);
                let dist = (if nx != cx { dx_c } else { 0.0 })
                    .hypot(if ny != cy { dy_km } else { 0.0 })
                    .max(1e-6);
                let s = (filled_f64[c] - filled_f64[nb]) / dist;
                if s > best_s {
                    best_s = s;
                    best_r = nb as i32;
                }
            }
            receiver[c] = best_r;
        }

        in_deg.fill(0);
        for &r in &receiver {
            if r >= 0 {
                in_deg[r as usize] += 1;
            }
        }
        top_queue.clear();
        for (c, &deg) in in_deg.iter().enumerate() {
            if deg == 0 {
                top_queue.push(c);
            }
        }
        order.clear();
        let mut qh = 0usize;
        while qh < top_queue.len() {
            let c = top_queue[qh];
            qh += 1;
            order.push(c);
            let r = receiver[c];
            if r >= 0 {
                let ru = r as usize;
                in_deg[ru] -= 1;
                if in_deg[ru] == 0 {
                    top_queue.push(ru);
                }
            }
        }
        debug_assert_eq!(order.len(), n);
        order.reverse();

        for i in 0..n {
            discharge[i] = if is_ocean[i] == 0 {
                runoff_m3s[i] + boundary_inflow_m3s[i] as f64
            } else {
                0.0
            };
        }
        for &c in order.iter().rev() {
            let r = receiver[c];
            if r >= 0 && is_ocean[c] == 0 {
                discharge[r as usize] += discharge[c];
            }
        }

        sed_flux.fill(0.0);
        for &c in &order {
            if is_ocean[c] != 0 {
                continue;
            }
            let glacial_coast = glacier[c] > 0.10 && elev_f64[c] > -0.25;
            if elev_f64[c] <= 0.0 && !glacial_coast {
                continue;
            }
            if elev_f64[c] < filled_f64[c] - 1e-4 {
                continue;
            }
            let r = receiver[c];
            if r < 0 {
                continue;
            }
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            let dist_km = (if rx != cx { dx_km_row[cy] } else { 0.0 })
                .hypot(if ry != cy { dy_km } else { 0.0 })
                .max(1e-3);
            let dist_scale = (dist_km / 20.0).max(0.25);

            let q_norm = (discharge[c] / q_ref_erosion).max(0.0);
            let kf = 0.032 * erodibility[c] * q_norm.powf(0.45) / dist_scale;
            let kg = if glacier[c] > 0.05 {
                0.022 * (glacier[c] as f64) * (0.25 + q_norm.powf(0.25)) / dist_scale
            } else {
                0.0
            };
            let h_base = if kg > 0.0 {
                elev_f64[ru].max(-0.25)
            } else {
                elev_f64[ru].max(0.0)
            };
            let k_tot = kf + kg;
            if elev_f64[c] > h_base && k_tot > 0.0 {
                let h_target = (elev_f64[c] + k_tot * h_base) / (1.0 + k_tot);
                let drop = (elev_f64[c] - h_target).clamp(0.0, 0.08);
                elev_f64[c] -= drop;
                if kg > 0.0 {
                    glacial_carve_km[c] += (drop * (kg / k_tot)) as f32;
                }
                sed_flux[c] += drop * cell_area_km2[cy];
            }
        }

        min_up_h.fill(f64::INFINITY);
        for u in 0..n {
            if is_ocean[u] != 0 {
                continue;
            }
            let r = receiver[u];
            if r >= 0 {
                let ru = r as usize;
                if elev_f64[u] > elev_f64[ru] {
                    min_up_h[ru] = min_up_h[ru].min(elev_f64[u]);
                }
            }
        }

        for &c in order.iter().rev() {
            if is_ocean[c] != 0 {
                continue;
            }
            let flux = sed_flux[c];
            if flux <= 0.0 || elev_f64[c] <= -0.20 {
                continue;
            }
            let r = receiver[c];
            let cy = c / w;
            let area = cell_area_km2[cy];
            let mut slope = 0.0;
            if r >= 0 {
                let ru = r as usize;
                let (cx, rx, ry) = (c % w, ru % w, ru / w);
                let dist_km = (if rx != cx { dx_km_row[cy] } else { 0.0 })
                    .hypot(if ry != cy { dy_km } else { 0.0 })
                    .max(1e-3);
                slope = ((elev_f64[c] - elev_f64[ru]) / dist_km).max(0.0);
            }
            let in_dep = elev_f64[c] < filled_f64[c] - 1e-4;
            let q_norm = (discharge[c] / q_ref_erosion).max(0.0);
            let cap = 0.045 * q_norm.powf(0.75) * slope.max(0.0005) * area;

            let mut dep_vol = 0.0;
            if (in_dep || slope < 0.006) && flux > cap {
                let mut dep_h = ((flux - cap) * 0.30 / area).clamp(0.0, 0.06);
                if in_dep {
                    dep_h = dep_h.min((filled_f64[c] - elev_f64[c]).max(0.0));
                } else if min_up_h[c].is_finite() {
                    dep_h = dep_h
                        .min((min_up_h[c] - elev_f64[c] - 2e-4).max(0.0))
                        .min(0.02);
                } else {
                    dep_h = dep_h.min(0.015);
                }
                if dep_h > 0.0 {
                    elev_f64[c] += dep_h;
                    alluvium_km[c] += dep_h as f32;
                    dep_vol = dep_h * area;
                }
            }
            let remain = (flux - dep_vol).max(0.0);
            if r >= 0 && remain > 0.0 {
                let ru = r as usize;
                if is_ocean[ru] == 0 {
                    sed_flux[ru] += remain * 0.85;
                }
            }
        }
    }

    let mut elevation_km = vec![0.0f32; n];
    let mut incised_km = vec![0.0f32; n];
    for i in 0..n {
        elevation_km[i] = elev_f64[i] as f32;
        incised_km[i] = (init_elev_f64[i] - elev_f64[i]).max(0.0) as f32;
    }

    // 4. Высотная поправка климата и обновление ледников
    let mut temp_c = vec![0.0f32; n];
    let mut temp_jan_c = vec![0.0f32; n];
    let mut temp_jul_c = vec![0.0f32; n];
    let mut pet_mm = vec![0.0f32; n];
    let mut aridity_index = vec![0.0f32; n];

    for i in 0..n {
        let lapse_shift = -6.2
            * ((elevation_km[i].max(0.0) - coarse_elevation_km[i].max(0.0)) as f64);
        let tj = (coarse_temp_jan_c[i] as f64 + lapse_shift).clamp(-55.0, 48.0);
        let tl = (coarse_temp_jul_c[i] as f64 + lapse_shift).clamp(-55.0, 48.0);
        temp_jan_c[i] = tj as f32;
        temp_jul_c[i] = tl as f32;
        temp_c[i] = (0.5 * (tj + tl)) as f32;

        let t_mean = 0.5 * (tj + tl);
        let t_half = 0.5 * (tl - tj);
        let p_mean = 0.5 * (precip_jan_mm[i] as f64 + precip_jul_mm[i] as f64);
        let p_half = 0.5 * (precip_jul_mm[i] as f64 - precip_jan_mm[i] as f64);
        let mut bio_sum = 0.0f64;
        let mut pdd = 0.0f64;
        let mut snow_mm = 0.0f64;
        for m in 0..12 {
            let c = (TAU * (m as f64 - 6.0) / 12.0).cos();
            let tm = t_mean + t_half * c;
            let pm = (p_mean + p_half * c).max(0.0) / 12.0;
            bio_sum += tm.clamp(0.0, 30.0);
            pdd += tm.max(0.0) * 30.4375;
            snow_mm += pm * ((2.0 - tm) / 4.0).clamp(0.0, 1.0);
        }
        let pet = (58.93 * (bio_sum / 12.0)).max(40.0);
        pet_mm[i] = pet as f32;
        aridity_index[i] = if lapse_shift.abs() > 0.05 {
            ((precip_mm[i] as f64) / pet.max(50.0)).clamp(0.0, 10.0) as f32
        } else {
            aridity_base[i]
        };
        let sf = (snow_mm / (precip_mm[i] as f64).max(1.0)).clamp(0.0, 1.0) as f32;
        snow_frac[i] = sf;
        let bal = snow_mm - 4.5 * pdd;
        glacier[i] = if elevation_km[i] > 0.0 && bal > 0.0 {
            (bal / (bal + 400.0)).clamp(0.0, 1.0) as f32
        } else {
            0.0
        };
    }

    // 5. Итоговая детальная гидрология региона
    mark_ocean(&elev_f64, &mut is_ocean, &mut comp_id, &mut stack);

    vis.fill(0);
    receiver.fill(-1);
    let mut filled_km = vec![0.0f32; n];
    let mut heap = BinaryHeap::with_capacity(n / 4 + 64);
    for y in 0..h {
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let on_edge = x == 0 || x + 1 == w || y == 0 || y + 1 == h;
            if is_ocean[i] != 0 || (on_edge && inflow_guard[i] == 0) {
                vis[i] = 1;
                filled_f64[i] = elev_f64[i];
                filled_km[i] = elevation_km[i];
                heap.push(FloodCell {
                    elev: elev_f64[i],
                    idx: i,
                });
            }
        }
    }
    if heap.is_empty() {
        vis[0] = 1;
        filled_f64[0] = elev_f64[0];
        filled_km[0] = elevation_km[0];
        heap.push(FloodCell {
            elev: elev_f64[0],
            idx: 0,
        });
    }
    while let Some(FloodCell { elev: f_c, idx: c }) = heap.pop() {
        let (cx, cy) = (c % w, c / w);
        let (nbs, cnt) = reg_neighbors8(c, w, h);
        for &nb in &nbs[..cnt] {
            if vis[nb] != 0 {
                continue;
            }
            vis[nb] = 1;
            receiver[nb] = c as i32;
            let (nx, ny) = (nb % w, nb / w);
            let diag = nx != cx && ny != cy;
            let step_eps =
                8e-5 * (if diag { 1.4142 } else { 1.0 }) * (1.0 + 1.5 * cell_jitter(nb));
            let f_n = elev_f64[nb].max(f_c + step_eps);
            filled_f64[nb] = f_n;
            let mut f32_n = f_n as f32;
            if f32_n <= filled_km[c] {
                f32_n = filled_km[c].next_up();
            }
            filled_km[nb] = f32_n;
            heap.push(FloodCell { elev: f_n, idx: nb });
        }
    }

    for c in 0..n {
        if is_ocean[c] != 0 || receiver[c] < 0 || filled_f64[c] > elev_f64[c] + 1e-6 {
            continue;
        }
        let (cx, cy) = (c % w, c / w);
        let dx_c = dx_km_row[cy];
        let (nbs, cnt) = reg_neighbors8(c, w, h);
        let mut best_r = receiver[c];
        let mut best_s = f64::NEG_INFINITY;
        for &nb in &nbs[..cnt] {
            if filled_km[nb] >= filled_km[c] {
                continue;
            }
            let (nx, ny) = (nb % w, nb / w);
            let dist = (if nx != cx { dx_c } else { 0.0 })
                .hypot(if ny != cy { dy_km } else { 0.0 })
                .max(1e-6);
            let s = (filled_f64[c] - filled_f64[nb]) / dist;
            if s > best_s {
                best_s = s;
                best_r = nb as i32;
            }
        }
        receiver[c] = best_r;
    }

    in_deg.fill(0);
    for &r in &receiver {
        if r >= 0 {
            in_deg[r as usize] += 1;
        }
    }
    top_queue.clear();
    for (c, &deg) in in_deg.iter().enumerate() {
        if deg == 0 {
            top_queue.push(c);
        }
    }
    order.clear();
    let mut qh = 0usize;
    while qh < top_queue.len() {
        let c = top_queue[qh];
        qh += 1;
        order.push(c);
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            in_deg[ru] -= 1;
            if in_deg[ru] == 0 {
                top_queue.push(ru);
            }
        }
    }
    debug_assert_eq!(order.len(), n);
    order.reverse();

    let mut local_runoff = vec![0.0f32; n];
    let mut runoff_jan = vec![0.0f32; n];
    let mut runoff_jul = vec![0.0f32; n];
    for y in 0..h {
        let am2 = cell_area_km2[y] * 1e6;
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if is_ocean[i] != 0 {
                continue;
            }
            let arid_f = (aridity_index[i] as f64 / 0.45).clamp(0.25, 1.0);
            let perma_est = if elevation_km[i] > 0.0 && temp_c[i] < -0.5 {
                (((-0.5 - temp_c[i] as f64) / 7.0).clamp(0.0, 1.0)
                    * (1.0 - 0.65 * glacier[i] as f64))
                    .clamp(0.0, 1.0)
            } else {
                0.0
            };
            let melt_boost = 1.0 + 0.25 * (snow_frac[i] as f64).max(glacier[i] as f64);
            let perma_boost = 1.0 + 0.22 * perma_est;
            let coeff = ((0.25 + 0.45 * (moisture[i] as f64)) * arid_f * melt_boost * perma_boost)
                .clamp(0.05, 0.88);
            let r_ann = ((am2 * (precip_mm[i] as f64) * 1e-3 * coeff) / SECONDS_PER_YEAR) as f32;
            local_runoff[i] = r_ann;

            let tj = temp_jan_c[i] as f64;
            let tl = temp_jul_c[i] as f64;
            let lj = ((tj + 2.0) / 4.0).clamp(0.08, 1.0);
            let ll = ((tl + 2.0) / 4.0).clamp(0.08, 1.0);
            let pj = precip_jan_mm[i] as f64;
            let pl = precip_jul_mm[i] as f64;
            let eff_jan = pj * lj + pl * (1.0 - ll) * (tj / 6.0).clamp(0.0, 1.0);
            let eff_jul = pl * ll + pj * (1.0 - lj) * (tl / 6.0).clamp(0.0, 1.0);
            let eff_m = 0.5 * (eff_jan + eff_jul);
            if eff_m > 1e-6 {
                runoff_jan[i] = r_ann * (eff_jan / eff_m).clamp(0.02, 2.4) as f32;
                runoff_jul[i] = r_ann * (eff_jul / eff_m).clamp(0.02, 2.4) as f32;
            } else {
                runoff_jan[i] = r_ann;
                runoff_jul[i] = r_ann;
            }
        }
    }

    // Внутренние озёра, солончаки и баланс испарения
    let mut cand = vec![0u8; n];
    for y in 1..(h.saturating_sub(1)) {
        for x in 1..(w.saturating_sub(1)) {
            let i = y * w + x;
            if is_ocean[i] == 0 && (filled_km[i] - elevation_km[i]) > 0.015 {
                cand[i] = 1;
            }
        }
    }
    let mut basin_id = vec![-1i32; n];
    let mut basins: Vec<Vec<usize>> = Vec::new();
    for s0 in 0..n {
        if cand[s0] == 0 || basin_id[s0] >= 0 {
            continue;
        }
        let bid = basins.len() as i32;
        let mut comp = Vec::new();
        let mut max_dep = 0.0f32;
        basin_id[s0] = bid;
        stack.push(s0);
        while let Some(c) = stack.pop() {
            comp.push(c);
            max_dep = max_dep.max(filled_km[c] - elevation_km[c]);
            let (nbs, cnt) = reg_neighbors8(c, w, h);
            for &nb in &nbs[..cnt] {
                if cand[nb] != 0 && basin_id[nb] < 0 {
                    basin_id[nb] = bid;
                    stack.push(nb);
                }
            }
        }
        if (comp.len() >= 2 && max_dep > 0.02) || max_dep > 0.06 {
            basins.push(comp);
        } else {
            for c in comp {
                basin_id[c] = -1;
            }
        }
    }

    let mut step_m = vec![0.0f64; n];
    for c in 0..n {
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            let sdx = if rx != cx { dx_km_row[cy] } else { 0.0 };
            let sdy = if ry != cy { dy_km } else { 0.0 };
            step_m[c] = sdx.hypot(sdy) * 1000.0;
        }
    }

    let mut discharge_m3s = vec![0.0f32; n];
    let mut is_lake = vec![0u8; n];
    let mut is_endorheic_lake = vec![0u8; n];
    let mut is_salt_flat = vec![0u8; n];
    let mut lake_surface_km = vec![0.0f32; n];
    let mut closed_basin = vec![0u8; n];
    let mut next_closed = vec![0u8; n];
    let mut open_scale = vec![1.0f64; basins.len()];
    let mut next_scale = vec![1.0f64; basins.len()];
    let mut inflow = vec![0.0f64; basins.len()];

    for _iter in 0..10 {
        for i in 0..n {
            discharge_m3s[i] = local_runoff[i] + boundary_inflow_m3s[i];
        }
        for &c in order.iter().rev() {
            if is_ocean[c] != 0 || closed_basin[c] != 0 {
                continue;
            }
            let bi = basin_id[c];
            if bi < 0 && pet_mm[c] > precip_mm[c] && discharge_m3s[c] > 0.0 {
                let ai = aridity_index[c] as f64;
                let infil = 1.0 + 1.5 * ((0.22 - ai).max(0.0) / 0.22);
                let def = (pet_mm[c] - precip_mm[c]) as f64 * 1e-3;
                let weff = 20.0 * (discharge_m3s[c] as f64).powf(0.45) * 6.0 * infil;
                let raw = (weff * step_m[c] * def) / SECONDS_PER_YEAR;
                let loss = raw.min(discharge_m3s[c] as f64 * 0.20) as f32;
                discharge_m3s[c] = (discharge_m3s[c] - loss).max(0.0);
            }
            let r = receiver[c];
            if r >= 0 {
                let ru = r as usize;
                let mut q_out = discharge_m3s[c];
                if bi >= 0 && basin_id[ru] != bi {
                    q_out = (q_out as f64 * open_scale[bi as usize]) as f32;
                }
                discharge_m3s[ru] += q_out;
            }
        }

        if basins.is_empty() {
            break;
        }

        inflow.fill(0.0);
        for i in 0..n {
            let bi = basin_id[i];
            if bi >= 0 {
                inflow[bi as usize] += (local_runoff[i] + boundary_inflow_m3s[i]) as f64;
            }
            let r = receiver[i];
            if r >= 0 {
                let br = basin_id[r as usize];
                if br >= 0 && br != bi && closed_basin[i] == 0 {
                    let q_out = if bi >= 0 {
                        discharge_m3s[i] as f64 * open_scale[bi as usize]
                    } else {
                        discharge_m3s[i] as f64
                    };
                    inflow[br as usize] += q_out;
                }
            }
        }

        is_lake.fill(0);
        is_endorheic_lake.fill(0);
        is_salt_flat.fill(0);
        lake_surface_km.fill(0.0);
        next_closed.fill(0);
        next_scale.fill(0.0);

        for (bid, comp) in basins.iter().enumerate() {
            let mut pot_evap = 0.0f64;
            let mut mean_t = 0.0f64;
            let mut spill = f32::NEG_INFINITY;
            for &c in comp {
                let y = c / w;
                let am2 = cell_area_km2[y] * 1e6;
                pot_evap += (am2 * evap_rate_m_yr(temp_c[c])) / SECONDS_PER_YEAR;
                mean_t += temp_c[c] as f64;
                spill = spill.max(filled_km[c]).max(elevation_km[c]);
            }
            mean_t /= comp.len() as f64;
            let q_in = inflow[bid];
            if q_in >= pot_evap {
                for &c in comp {
                    is_lake[c] = 1;
                    lake_surface_km[c] = spill.max(elevation_km[c]);
                }
                next_scale[bid] = if q_in > 1e-6 {
                    ((q_in - pot_evap) / q_in).clamp(0.0, 1.0)
                } else {
                    0.0
                };
            } else if q_in >= 0.20 * pot_evap {
                let mut sorted = comp.clone();
                sorted.sort_by(|&a, &b| elevation_km[a].total_cmp(&elevation_km[b]));
                let mut used = 0.0f64;
                let mut kend = 0usize;
                for (k, &c) in sorted.iter().enumerate() {
                    let cevap = (cell_area_km2[c / w] * 1e6 * evap_rate_m_yr(temp_c[c]))
                        / SECONDS_PER_YEAR;
                    if k == 0 || used + cevap <= q_in {
                        used += cevap;
                        kend = k + 1;
                    } else {
                        break;
                    }
                }
                let eq = (sorted[..kend]
                    .iter()
                    .map(|&c| elevation_km[c])
                    .fold(f32::NEG_INFINITY, f32::max)
                    + 0.004)
                    .min(spill);
                for &c in &sorted[..kend] {
                    is_lake[c] = 1;
                    is_endorheic_lake[c] = 1;
                    lake_surface_km[c] = eq.max(elevation_km[c]);
                    next_closed[c] = 1;
                }
                for &c in &sorted[kend..] {
                    next_closed[c] = 1;
                    if precip_mm[c] < 450.0 && temp_c[c] > 4.0 {
                        is_salt_flat[c] = 1;
                    }
                }
            } else {
                for &c in comp {
                    next_closed[c] = 1;
                }
                if mean_t > 4.0 {
                    let mut sorted = comp.clone();
                    sorted.sort_by(|&a, &b| elevation_km[a].total_cmp(&elevation_km[b]));
                    for &c in &sorted[..(sorted.len() + 1) / 2] {
                        is_salt_flat[c] = 1;
                    }
                }
            }
        }

        let diff = open_scale
            .iter()
            .zip(next_scale.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f64, f64::max);
        if next_closed == closed_basin && diff < 1e-3 {
            open_scale.copy_from_slice(&next_scale);
            break;
        }
        closed_basin.copy_from_slice(&next_closed);
        open_scale.copy_from_slice(&next_scale);
    }

    let mut discharge_jan_m3s = vec![0.0f32; n];
    let mut discharge_jul_m3s = vec![0.0f32; n];
    for i in 0..n {
        discharge_jan_m3s[i] = runoff_jan[i] + boundary_inflow_jan[i];
        discharge_jul_m3s[i] = runoff_jul[i] + boundary_inflow_jul[i];
    }
    for &c in order.iter().rev() {
        if is_ocean[c] != 0 || closed_basin[c] != 0 {
            continue;
        }
        let bi = basin_id[c];
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            let mut qj = discharge_jan_m3s[c];
            let mut ql = discharge_jul_m3s[c];
            if bi >= 0 && basin_id[ru] != bi {
                let s = open_scale[bi as usize];
                qj = ((0.35 * discharge_m3s[c] as f64 + 0.65 * qj as f64) * s) as f32;
                ql = ((0.35 * discharge_m3s[c] as f64 + 0.65 * ql as f64) * s) as f32;
            }
            discharge_jan_m3s[ru] += qj;
            discharge_jul_m3s[ru] += ql;
        }
    }

    // 6. Мелкая речная сеть региона, вади, оазисы и биомы
    let river_thresh = (160.0 * (dx_avg_km as f32 / 18.0).powf(1.45)).clamp(35.0, 1200.0);
    let mut river_mask = vec![0u8; n];
    for i in 0..n {
        if is_ocean[i] == 0
            && is_lake[i] == 0
            && is_salt_flat[i] == 0
            && closed_basin[i] == 0
            && discharge_m3s[i] >= river_thresh
        {
            river_mask[i] = 1;
        }
    }
    for &c in order.iter().rev() {
        if river_mask[c] == 0 {
            continue;
        }
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            if is_ocean[ru] == 0
                && is_lake[ru] == 0
                && is_salt_flat[ru] == 0
                && closed_basin[ru] == 0
                && discharge_m3s[ru] >= 0.35 * river_thresh
            {
                river_mask[ru] = 1;
            }
        }
    }

    let mut river_order = vec![0u8; n];
    let mut up_river_count = vec![0u16; n];
    let mut up_max_ord = vec![0u8; n];
    let mut up_max_cnt = vec![0u8; n];
    for &c in order.iter().rev() {
        if river_mask[c] == 0 {
            continue;
        }
        let ord = if up_river_count[c] == 0 {
            1
        } else if up_max_cnt[c] >= 2 {
            up_max_ord[c].saturating_add(1)
        } else {
            up_max_ord[c]
        };
        river_order[c] = ord;
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            if river_mask[ru] != 0 {
                up_river_count[ru] += 1;
                if ord > up_max_ord[ru] {
                    up_max_ord[ru] = ord;
                    up_max_cnt[ru] = 1;
                } else if ord == up_max_ord[ru] {
                    up_max_cnt[ru] = up_max_cnt[ru].saturating_add(1);
                }
            }
        }
    }

    let mut term_q = vec![0.0f32; n];
    let mut dist_to_mouth = vec![0.0f32; n];
    for &c in &order {
        if river_mask[c] == 0 {
            continue;
        }
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            let slen = (if rx != cx { dx_km_row[cy] as f32 } else { 0.0 })
                .hypot(if ry != cy { dy_km as f32 } else { 0.0 });
            if river_mask[ru] != 0 {
                term_q[c] = term_q[ru];
                dist_to_mouth[c] = dist_to_mouth[ru] + slen;
            } else {
                term_q[c] = discharge_m3s[c];
                dist_to_mouth[c] = slen;
            }
        } else {
            term_q[c] = discharge_m3s[c];
        }
    }

    let mut headwaters = Vec::new();
    for i in 0..n {
        if river_mask[i] != 0 && up_river_count[i] == 0 {
            headwaters.push(i);
        }
    }
    headwaters.sort_by(|&a, &b| {
        term_q[b]
            .total_cmp(&term_q[a])
            .then_with(|| dist_to_mouth[b].total_cmp(&dist_to_mouth[a]))
            .then_with(|| discharge_m3s[b].total_cmp(&discharge_m3s[a]))
            .then(a.cmp(&b))
    });

    let slope = reg_slope_field(&elevation_km, w, h, &dx_km_row, dy_km);

    struct RawRiv {
        id: u32,
        order: u8,
        length_km: f32,
        max_q: f32,
        mouth: MouthKind,
        cells: Vec<usize>,
    }
    let mut raw_rivers = Vec::new();
    let mut has_confluence = vec![0u8; n];
    let mut traced_id = vec![0u32; n];
    let mut next_id = 1u32;

    for start in headwaters {
        let cur_id = next_id;
        let mut cells = Vec::new();
        let mut c = start;
        let mut max_q = 0.0f32;
        let mut max_ord = 1u8;
        let mut len_km = 0.0f32;
        let mut mouth = MouthKind::Endorheic;

        for _step in 0..n {
            cells.push(c);
            traced_id[c] = cur_id;
            max_q = max_q.max(discharge_m3s[c]);
            max_ord = max_ord.max(river_order[c]);
            let r = receiver[c];
            if r < 0 {
                mouth = MouthKind::Endorheic;
                break;
            }
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            len_km += (if rx != cx { dx_km_row[cy] as f32 } else { 0.0 })
                .hypot(if ry != cy { dy_km as f32 } else { 0.0 });
            if is_ocean[ru] != 0 {
                cells.push(ru);
                mouth = MouthKind::Ocean;
                break;
            }
            if is_lake[ru] != 0 {
                cells.push(ru);
                mouth = MouthKind::Lake;
                break;
            }
            if is_salt_flat[ru] != 0 || closed_basin[ru] != 0 {
                cells.push(ru);
                mouth = MouthKind::Endorheic;
                break;
            }
            if traced_id[ru] != 0 {
                cells.push(ru);
                mouth = MouthKind::Confluence(traced_id[ru]);
                break;
            }
            if river_mask[ru] == 0 {
                cells.push(ru);
                mouth = MouthKind::Endorheic;
                break;
            }
            c = ru;
        }

        let min_cells = if matches!(mouth, MouthKind::Confluence(_)) {
            3
        } else {
            4
        };
        if cells.len() >= min_cells {
            if matches!(mouth, MouthKind::Confluence(_)) {
                if let Some(&last) = cells.last() {
                    has_confluence[last] = 1;
                }
            }
            raw_rivers.push(RawRiv {
                id: cur_id,
                order: max_ord,
                length_km: len_km,
                max_q,
                mouth,
                cells,
            });
            next_id += 1;
        } else {
            for &cell in &cells {
                if traced_id[cell] == cur_id {
                    traced_id[cell] = 0;
                }
            }
        }
    }

    let mut has_lake_inflow = vec![0u8; n];
    for i in 0..n {
        if is_lake[i] != 0 {
            let r = receiver[i];
            if r >= 0 {
                has_lake_inflow[r as usize] = 1;
            }
        }
    }

    let mut rivers = Vec::with_capacity(raw_rivers.len());
    for rr in raw_rivers {
        let starts_from_lake = rr.cells.first().is_some_and(|&c| has_lake_inflow[c] != 0);
        let mut max_q_jan = 0.0f32;
        let mut max_q_jul = 0.0f32;
        let mut sum_snow = 0.0f32;
        for &c in &rr.cells {
            max_q_jan = max_q_jan.max(discharge_jan_m3s[c]);
            max_q_jul = max_q_jul.max(discharge_jul_m3s[c]);
            sum_snow += snow_frac[c];
        }
        let mean_snow = sum_snow / rr.cells.len().max(1) as f32;
        let q_hi = max_q_jan.max(max_q_jul);
        let q_lo = max_q_jan.min(max_q_jul);
        let seas = ((q_hi - q_lo) / (q_hi + q_lo + 1e-3)).clamp(0.0, 1.0);
        let regime = if matches!(rr.mouth, MouthKind::Endorheic) && q_lo < 0.35 * q_hi {
            FlowRegime::EphemeralWadi
        } else if mean_snow > 0.22 && seas > 0.22 {
            FlowRegime::Snowmelt
        } else if seas > 0.28 {
            FlowRegime::SeasonalMonsoon
        } else {
            FlowRegime::Perennial
        };
        let (smoothed_pts, widths) = meander_smooth_river(
            &rr.cells,
            &discharge_m3s,
            &slope,
            &has_confluence,
            river_thresh,
            w,
            h,
            rr.id,
            rr.mouth,
            starts_from_lake,
            false,
        );
        rivers.push(River {
            id: rr.id,
            order: rr.order,
            length_km: rr.length_km,
            max_discharge_m3s: rr.max_q,
            discharge_jan_m3s: max_q_jan,
            discharge_jul_m3s: max_q_jul,
            regime,
            mouth: rr.mouth,
            cells: rr.cells,
            smoothed_pts,
            widths,
        });
    }

    let mut is_wadi = vec![0u8; n];
    let mut is_oasis = vec![0u8; n];
    let mut oasis_cands = Vec::new();
    for i in 0..n {
        if is_ocean[i] != 0 || is_lake[i] != 0 || is_salt_flat[i] != 0 {
            continue;
        }
        let qj = discharge_jan_m3s[i];
        let ql = discharge_jul_m3s[i];
        let q_peak = qj.max(ql);
        let seas = ((ql - qj).abs() / (ql + qj + 1e-3)).clamp(0.0, 1.0);
        let ai = aridity_index[i];
        if river_mask[i] == 0 && ai < 0.34 && q_peak >= 0.22 * river_thresh && seas >= 0.22 {
            is_wadi[i] = 1;
        }
        if ai < 0.28 && temp_c[i] > 5.0 && elevation_km[i] < 1.6 && slope[i] < 0.04 {
            let mut mtn_recharge = false;
            let (nbs8, cnt8) = reg_neighbors8(i, w, h);
            for &nb in &nbs8[..cnt8] {
                if elevation_km[nb] > elevation_km[i] + 0.30
                    && (snow_frac[nb] > 0.12 || precip_mm[nb] > precip_mm[i] * 1.40)
                {
                    mtn_recharge = true;
                    break;
                }
            }
            if (is_wadi[i] != 0 && q_peak >= 60.0)
                || (mtn_recharge && discharge_m3s[i].max(q_peak) >= 20.0)
            {
                oasis_cands.push((i, q_peak + if mtn_recharge { 80.0 } else { 0.0 }));
            }
        }
    }
    oasis_cands.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    for (i, _) in oasis_cands {
        let (nbs8, cnt8) = reg_neighbors8(i, w, h);
        if !nbs8[..cnt8].iter().any(|&nb| is_oasis[nb] != 0) {
            is_oasis[i] = 1;
        }
    }

    let mut permafrost = vec![0.0f32; n];
    for i in 0..n {
        if is_ocean[i] == 0 && is_lake[i] == 0 && temp_c[i] < -0.5 {
            let t_cold = temp_jan_c[i].min(temp_jul_c[i]) as f64;
            let cold_f = ((-0.5 - temp_c[i] as f64) / 7.0).clamp(0.0, 1.0);
            let winter_f = ((-8.0 - t_cold) / 14.0).clamp(0.35, 1.0);
            permafrost[i] =
                (cold_f * winter_f * (1.0 - 0.65 * glacier[i] as f64)).clamp(0.0, 1.0) as f32;
        }
    }

    let mut is_delta = vec![0u8; n];
    for riv in &rivers {
        if !matches!(riv.mouth, MouthKind::Ocean | MouthKind::Lake) || riv.cells.len() < 2 {
            continue;
        }
        if riv.max_discharge_m3s < 1.8 * river_thresh {
            continue;
        }
        let m_cell = riv.cells[riv.cells.len() - 2];
        if is_ocean[m_cell] != 0 || is_lake[m_cell] != 0 {
            continue;
        }
        if slope[m_cell] < 0.0075 && elevation_km[m_cell] < 0.12 {
            is_delta[m_cell] = 1;
            let (nbs8, cnt8) = reg_neighbors8(m_cell, w, h);
            for &nb in &nbs8[..cnt8] {
                if is_ocean[nb] == 0
                    && is_lake[nb] == 0
                    && elevation_km[nb] < 0.08
                    && slope[nb] < 0.0080
                {
                    let (nbs4, cnt4) = reg_neighbors4(nb, w, h);
                    if nbs4[..cnt4].iter().any(|&q| is_ocean[q] != 0 || is_lake[q] != 0) {
                        is_delta[nb] = 1;
                    }
                }
            }
        }
    }

    let mut wf_cands: Vec<(usize, f32, f32, f32)> = Vec::new();
    for c in 0..n {
        if river_mask[c] == 0
            || is_ocean[c] != 0
            || is_lake[c] != 0
            || discharge_m3s[c] < 0.60 * river_thresh
        {
            continue;
        }
        let r = receiver[c];
        if r < 0 {
            continue;
        }
        let ru = r as usize;
        if is_ocean[ru] != 0 {
            continue;
        }
        let base_down = if is_lake[ru] != 0 {
            lake_surface_km[ru]
        } else {
            elevation_km[ru].max(0.0)
        };
        let drop_km = elevation_km[c] - base_down;
        let step_km = (step_m[c] * 1e-3).max(0.5) as f32;
        if filled_km[c] <= elevation_km[c] + 0.005
            && drop_km >= 0.075
            && (drop_km / step_km) >= 0.012
        {
            let drop_m = drop_km * 1000.0;
            let q = discharge_m3s[c];
            wf_cands.push((c, drop_m, q, drop_m * q.sqrt()));
        }
    }
    wf_cands.sort_by(|a, b| b.3.total_cmp(&a.3).then_with(|| a.0.cmp(&b.0)));
    let min_wf_sep_km = (dx_avg_km * 3.5).clamp(18.0, 95.0);
    let mut waterfalls: Vec<Waterfall> = Vec::new();
    for (c, drop_m, q, _) in wf_cands {
        let (cx, cy) = (c % w, c / w);
        let too_close = waterfalls.iter().any(|w0| {
            let (wx, wy) = (w0.cell % w, w0.cell / w);
            ((cx as f64 - wx as f64) * dx_km_row[cy])
                .hypot((cy as f64 - wy as f64) * dy_km)
                < min_wf_sep_km
        });
        if !too_close {
            waterfalls.push(Waterfall {
                cell: c,
                drop_m,
                discharge_m3s: q,
            });
            if waterfalls.len() >= 20 {
                break;
            }
        }
    }

    let mut biome = vec![Biome::Ocean; n];
    let mut coast_type = vec![0u8; n];
    for y in 0..h {
        let lat_deg = lat_max_deg - ((y as f64 + 0.5) / h as f64) * actual_span_lat;
        let lat_abs = lat_deg.abs();
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if is_ocean[i] != 0 {
                biome[i] = if elevation_km[i] >= -0.25 {
                    Biome::Shelf
                } else {
                    Biome::Ocean
                };
                continue;
            }
            if is_lake[i] != 0 {
                biome[i] = Biome::Lake;
                continue;
            }
            if is_salt_flat[i] != 0 {
                biome[i] = Biome::SaltFlat;
                continue;
            }
            let (nbs4, cnt4) = reg_neighbors4(i, w, h);
            if nbs4[..cnt4].iter().any(|&nb| is_ocean[nb] != 0) {
                let g_idx = sample_nearest_idx(
                    lat_deg,
                    (lon_min_deg + ((x as f64 + 0.5) / w as f64) * opt.span_lon_deg + 540.0)
                        .rem_euclid(360.0)
                        - 180.0,
                );
                let mut max_gl = glacier[i];
                let (nbs8, cnt8) = reg_neighbors8(i, w, h);
                for &nb in &nbs8[..cnt8] {
                    max_gl = max_gl.max(glacier[nb]);
                }
                let cold_snow = snow_frac[i] > 0.45 && temp_jan_c[i].min(temp_jul_c[i]) < -6.0;
                coast_type[i] = if (max_gl > 0.05 || cold_snow)
                    && (elevation_km[i] > 0.22 || slope[i] > 0.025)
                {
                    3
                } else if (25.0..=58.0).contains(&lat_abs) && discharge_m3s[i] > 0.3 * river_thresh
                {
                    4
                } else if planet.tectonic.margin[g_idx] == 1 {
                    1
                } else {
                    2
                };
                if matches!(coast_type[i], 1 | 3) {
                    is_delta[i] = 0;
                }
            }

            biome[i] = classify_land_biome(
                lat_deg,
                elevation_km[i],
                slope[i],
                discharge_m3s[i],
                alluvium_km[i],
                temp_c[i],
                temp_jan_c[i],
                temp_jul_c[i],
                precip_mm[i],
                precip_jan_mm[i],
                precip_jul_mm[i],
                aridity_index[i] as f64,
                monsoon_index[i],
                glacier[i],
                permafrost[i],
                is_delta[i] != 0,
            );
        }
    }

    // 7. Детализированные перевалы и перенесённые поселения
    let mut cand_passes = Vec::new();
    let sample_max_reg = |x: isize, y: isize, dx: isize, dy: isize| -> f32 {
        let mut best = f32::NEG_INFINITY;
        for step in 1..=3 {
            let xx = (x + dx * step).clamp(0, w as isize - 1) as usize;
            let yy = (y + dy * step).clamp(0, h as isize - 1) as usize;
            best = best.max(elevation_km[yy * w + xx]);
        }
        best
    };
    let sample_min_reg = |x: isize, y: isize, dx: isize, dy: isize| -> f32 {
        let mut best = f32::INFINITY;
        for step in 1..=3 {
            let xx = (x + dx * step).clamp(0, w as isize - 1) as usize;
            let yy = (y + dy * step).clamp(0, h as isize - 1) as usize;
            best = best.min(elevation_km[yy * w + xx]);
        }
        best
    };
    const AXES: [(isize, isize, isize, isize); 4] =
        [(1, 0, 0, 1), (0, 1, 1, 0), (1, 1, 1, -1), (1, -1, 1, 1)];
    for y in 2..(h.saturating_sub(2)) {
        for x in 2..(w.saturating_sub(2)) {
            let i = y * w + x;
            if is_ocean[i] != 0 || is_lake[i] != 0 {
                continue;
            }
            let e = elevation_km[i];
            if !(0.25..=4.50).contains(&e) {
                continue;
            }
            let mut best_prom = 0.0f32;
            for &(ax, ay, bx, by) in &AXES {
                let ridge_a = sample_max_reg(x as isize, y as isize, ax, ay);
                let ridge_b = sample_max_reg(x as isize, y as isize, -ax, -ay);
                let val_a = sample_min_reg(x as isize, y as isize, bx, by);
                let val_b = sample_min_reg(x as isize, y as isize, -bx, -by);
                let rise = ridge_a.min(ridge_b) - e;
                let drop = e - val_a.max(val_b);
                if rise >= 0.08 && drop >= 0.05 {
                    best_prom = best_prom.max(rise);
                }
            }
            if best_prom > 0.0 {
                cand_passes.push(RegionPass {
                    cell: i,
                    x,
                    y,
                    elevation_km: e,
                    prominence_drop_km: best_prom,
                });
            }
        }
    }
    cand_passes.sort_by(|a, b| {
        b.prominence_drop_km
            .total_cmp(&a.prominence_drop_km)
            .then_with(|| a.elevation_km.total_cmp(&b.elevation_km))
            .then_with(|| a.cell.cmp(&b.cell))
    });
    let min_pass_sep_km = (dx_avg_km * 4.0).clamp(25.0, 120.0);
    let mut passes: Vec<RegionPass> = Vec::new();
    for p in cand_passes {
        let too_close = passes.iter().any(|q| {
            let ddx = (p.x as f64 - q.x as f64) * dx_km_row[p.y];
            let ddy = (p.y as f64 - q.y as f64) * dy_km;
            ddx.hypot(ddy) < min_pass_sep_km
        });
        if !too_close {
            passes.push(p);
        }
    }

    let snap_r = opt.scale as isize;
    let mut settlements = Vec::new();
    for s in &planet.civilization.settlements {
        let (gx, gy) = planet.grid.xy(s.cell);
        let Some((ix, iy)) =
            global_to_region_xy(planet.grid.lat_deg(gy), planet.grid.lon_deg(gx))
        else {
            continue;
        };
        let x0 = (ix as isize - snap_r).max(0) as usize;
        let x1 = (ix as isize + snap_r).min(w as isize - 1) as usize;
        let y0 = (iy as isize - snap_r).max(0) as usize;
        let y1 = (iy as isize + snap_r).min(h as isize - 1) as usize;

        let mut best_cell = None;
        let mut best_score = f64::NEG_INFINITY;
        for yy in y0..=y1 {
            for xx in x0..=x1 {
                let c = yy * w + xx;
                if is_ocean[c] != 0 || is_lake[c] != 0 {
                    continue;
                }
                let d2 = ((xx as f64 - ix as f64).powi(2) + (yy as f64 - iy as f64).powi(2)).sqrt();
                let mut sc = -d2;
                if s.is_port {
                    let (nbs4, cnt4) = reg_neighbors4(c, w, h);
                    if nbs4[..cnt4].iter().any(|&nb| is_ocean[nb] != 0) {
                        sc += 25.0;
                    }
                } else if s.river_access {
                    if river_mask[c] != 0 {
                        sc += 20.0 + (discharge_m3s[c] as f64 / river_thresh as f64).min(10.0);
                    } else {
                        sc += (discharge_m3s[c] as f64 / river_thresh as f64).min(8.0);
                    }
                }
                if sc > best_score {
                    best_score = sc;
                    best_cell = Some(c);
                }
            }
        }
        if let Some(c) = best_cell {
            settlements.push(RegionSettlement {
                global_id: Some(s.id),
                name: s.name.clone(),
                cell: c,
                x: c % w,
                y: c / w,
                role: s.role,
                is_port: s.is_port,
                river_access: s.river_access || river_mask[c] != 0,
            });
        }
    }

    // 8. Сухопутные дороги в деталях региона (между местными поселениями по рельефу и перевалам)
    let mut roads: Vec<RegionRoad> = Vec::new();
    let mut road_used = vec![0u8; w * h];
    let mut pairs: BTreeSet<(usize, usize)> = BTreeSet::new();
    for a in 0..settlements.len() {
        let sa = &settlements[a];
        let mut cands: Vec<(usize, f64)> = Vec::new();
        for b in 0..settlements.len() {
            if a == b {
                continue;
            }
            let sb = &settlements[b];
            let ddx = (sb.x as f64 - sa.x as f64) * dx_km_row[sa.y];
            let ddy = (sb.y as f64 - sa.y as f64) * dy_km;
            let d = ddx.hypot(ddy);
            if d <= 2200.0 {
                cands.push((b, d));
            }
        }
        cands.sort_by(|x, y| x.1.total_cmp(&y.1).then_with(|| x.0.cmp(&y.0)));
        for &(b, _) in cands.iter().take(2) {
            let p = if a < b { (a, b) } else { (b, a) };
            pairs.insert(p);
        }
    }
    for (a, b) in pairs {
        if let Some(rd) = route_region_road_fields(
            w,
            h,
            &dx_km_row,
            dy_km,
            &elevation_km,
            &is_ocean,
            &is_lake,
            &biome,
            &permafrost,
            &river_mask,
            &passes,
            settlements[a].cell,
            settlements[b].cell,
            Some(&road_used),
        ) {
            for &c in &rd.cells {
                road_used[c] = 1;
            }
            roads.push(rd);
        }
    }

    // 9. Перенос и локальная привязка месторождений полезных ископаемых в регионе
    let mut deposits: Vec<RegionDeposit> = Vec::new();
    for dep in &planet.resources.deposits {
        let (gx, gy) = planet.grid.xy(dep.cell);
        let Some((ix, iy)) =
            global_to_region_xy(planet.grid.lat_deg(gy), planet.grid.lon_deg(gx))
        else {
            continue;
        };
        let want_ocean = planet.hydrology.is_ocean[dep.cell] != 0;
        let x0 = (ix as isize - snap_r).max(0) as usize;
        let x1 = (ix as isize + snap_r).min(w as isize - 1) as usize;
        let y0 = (iy as isize - snap_r).max(0) as usize;
        let y1 = (iy as isize + snap_r).min(h as isize - 1) as usize;
        let mut best_cell = None;
        let mut best_score = f64::NEG_INFINITY;
        for yy in y0..=y1 {
            for xx in x0..=x1 {
                let c = yy * w + xx;
                let cell_ocean = is_ocean[c] != 0;
                if want_ocean {
                    if !cell_ocean {
                        continue;
                    }
                } else if cell_ocean || is_lake[c] != 0 {
                    continue;
                }
                let d2 = ((xx as f64 - ix as f64).powi(2) + (yy as f64 - iy as f64).powi(2)).sqrt();
                let sc = match dep.kind {
                    ResourceKind::Iron | ResourceKind::CopperGold | ResourceKind::GemsRare => {
                        -d2 + 2.5 * elevation_km[c].max(0.0) as f64 + 1.8 * incised_km[c].max(0.0) as f64
                    }
                    ResourceKind::Hydrocarbons if want_ocean => {
                        -d2 + 4.0 * if elevation_km[c] >= -0.45 { 1.0 } else { -1.0 }
                    }
                    _ => -d2 + 2.5 * alluvium_km[c] as f64 - 1.2 * (elevation_km[c] - 1.2).max(0.0) as f64,
                };
                if sc > best_score {
                    best_score = sc;
                    best_cell = Some(c);
                }
            }
        }
        if let Some(c) = best_cell {
            if !deposits.iter().any(|d| d.kind == dep.kind && d.cell == c) {
                deposits.push(RegionDeposit {
                    kind: dep.kind,
                    cell: c,
                    x: c % w,
                    y: c / w,
                    richness: dep.richness,
                });
            }
        }
    }

    Ok(Region {
        w,
        h,
        scale: opt.scale,
        radius_km,
        center_lat_deg,
        center_lon_deg,
        lat_min_deg,
        lat_max_deg,
        lon_min_deg,
        lon_max_deg,
        dx_km_row,
        dy_km,
        cell_area_km2,
        elevation_km,
        coarse_elevation_km,
        incised_km,
        alluvium_km,
        glacial_carve_km,
        temp_c,
        temp_jan_c,
        temp_jul_c,
        precip_mm,
        glacier,
        permafrost,
        biome,
        is_ocean,
        is_lake,
        is_endorheic_lake,
        is_salt_flat,
        is_wadi,
        is_oasis,
        is_delta,
        lake_surface_km,
        filled_km,
        receiver,
        boundary_inflow_m3s,
        discharge_m3s,
        discharge_jan_m3s,
        discharge_jul_m3s,
        river_mask,
        river_order,
        coast_type,
        rivers,
        waterfalls,
        passes,
        settlements,
        roads,
        deposits,
    })
}
