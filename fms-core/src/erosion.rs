//! Сопряжённая флювиальная и ледниковая эрозия рельефа (неявный решатель FastScape),
//! перенос и отложение аллювия в котловинах, предгорьях и устьях с сохранением объёма воды.

use crate::climate::Climate;
use crate::grid::{blur_xwrap, Grid};
use crate::rng::{Noise, Rng};
use crate::tectonic::World;
use std::cmp::Ordering;
use std::collections::BinaryHeap;

const SECONDS_PER_YEAR: f64 = 31_557_600.0;

#[derive(Clone, Debug)]
pub struct ErosionParams {
    pub iterations: usize,
    pub k_fluvial: f64,
    pub k_glacial: f64,
    pub k_deposit: f64,
    pub hillslope_diff: f64,
    pub max_incision_per_step_km: f64,
    pub max_deposit_per_step_km: f64,
}

impl Default for ErosionParams {
    fn default() -> Self {
        Self {
            iterations: 10,
            k_fluvial: 0.045,
            k_glacial: 0.030,
            k_deposit: 0.35,
            hillslope_diff: 0.05,
            max_incision_per_step_km: 0.16,
            max_deposit_per_step_km: 0.10,
        }
    }
}

/// Результаты эрозии и переотложения осадков.
#[derive(Clone, Debug)]
pub struct ErosionResult {
    /// Итоговая высота рельефа после эрозии и выравнивания уровня моря, км.
    pub elevation_km: Vec<f32>,
    /// Суммарное снижение рельефа (`world.elevation_km - elevation_km`), км (положительно при врезе).
    pub incised_km: Vec<f32>,
    /// Накопленная мощность речного и предгорного аллювия, км.
    pub alluvium_km: Vec<f32>,
    /// Глубина ледникового выпахивания долин и фьордов, км.
    pub glacial_carve_km: Vec<f32>,
    /// Относительная размываемость пород (`0.45..1.85`).
    pub erodibility: Vec<f32>,
    /// Эффективная мощность коры после эрозионного среза и накопления аллювия, км.
    pub effective_thickness_km: Vec<f32>,
    /// Сдвиг уровня моря при перераспределении объёма котловин/аллювия, км.
    pub sea_level_shift_km: f64,
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

#[inline]
fn cell_jitter(idx: usize) -> f64 {
    let x = (idx as u32).wrapping_mul(2654435761);
    (x as f64) / 4294967296.0
}

/// Выполняет сопряжённую флювиально-ледниковую эрозию с параметрами по умолчанию.
pub fn erode(grid: &Grid, world: &World, climate: &Climate, seed: &str) -> ErosionResult {
    erode_with_params(grid, world, climate, seed, &ErosionParams::default())
}

/// Выполняет сопряжённую флювиально-ледниковую эрозию с заданными параметрами.
pub fn erode_with_params(
    grid: &Grid,
    world: &World,
    climate: &Climate,
    seed: &str,
    params: &ErosionParams,
) -> ErosionResult {
    let w = grid.w;
    let h_rows = grid.h;
    let n = grid.len();
    assert_eq!(world.elevation_km.len(), n);
    assert_eq!(climate.precip_mm.len(), n);

    let mut rng_k = Rng::sub(seed, "erosion-k");
    let noise_k = Noise::new(&mut rng_k);

    // 1. Размываемость пород по литологии и тектонической истории
    let mut erodibility = vec![1.0f32; n];
    let t_now = world.stats.time;
    for y in 0..h_rows {
        for x in 0..w {
            let i = grid.idx(x, y);
            let p = grid.unit_vec(x, y);
            let sed = (world.marine_sediment_km[i] as f64).clamp(0.0, 2.5);
            let fore = (world.foreland[i] as f64).clamp(0.0, 1.0);
            let volc = (world.volcanic[i] as f64).clamp(0.0, 1.0);
            let thick = world.thickness[i] as f64;
            let oro_age = if world.t_oro_myr[i] < 0.0 {
                t_now
            } else {
                (t_now - world.t_oro_myr[i] as f64).max(0.0)
            };
            let young_oro = (-oro_age / 300.0).exp();
            let shield_hard = if thick > 28.0 {
                0.22 * (1.0 - young_oro)
            } else {
                0.0
            };
            let lith_noise =
                0.10 * noise_k.fbm(p[0] * 7.5 + 1.3, p[1] * 7.5 - 2.9, p[2] * 7.5 + 4.1, 2);

            let k_val = 1.0 + 0.35 * sed + 0.30 * fore + 0.15 * young_oro - shield_hard
                - 0.12 * volc
                + lith_noise;
            erodibility[i] = k_val.clamp(0.45, 1.85) as f32;
        }
    }

    // 2. Локальный сток с учётом осадков, влажности и таяния снега/льда
    let area_km2_row: Vec<f64> = (0..h_rows).map(|y| grid.cell_area_km2(y)).collect();
    let dy_km = grid.dy_km();
    let dx_row: Vec<f64> = (0..h_rows).map(|y| grid.dx_km(y)).collect();
    let mut runoff_m3s = vec![0.0f64; n];
    for y in 0..h_rows {
        let am2 = area_km2_row[y] * 1e6;
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let melt_boost =
                1.0 + 0.25 * (climate.snow_frac[i] as f64).max(climate.glacier[i] as f64);
            let coeff = ((0.25 + 0.45 * (climate.moisture[i] as f64).clamp(0.0, 1.0)) * melt_boost)
                .clamp(0.10, 0.85);
            let precip_m = (climate.precip_mm[i] as f64).max(0.0) * 1e-3;
            runoff_m3s[i] = (am2 * precip_m * coeff) / SECONDS_PER_YEAR;
        }
    }

    // 3. Исходный объём воды мирового океана для сохранения водного баланса
    let mut v0 = 0.0f64;
    let mut h: Vec<f64> = Vec::with_capacity(n);
    for y in 0..h_rows {
        let a = area_km2_row[y];
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let e = world.elevation_km[i] as f64;
            if e < 0.0 {
                v0 += -e * a;
            }
            h.push(e);
        }
    }

    let mut alluvium_km = vec![0.0f32; n];
    let mut glacial_carve_km = vec![0.0f32; n];
    let mut rock_incised_km = vec![0.0f32; n];
    let mut step_drop = vec![0.0f32; n];

    let mut is_ocean = vec![0u8; n];
    let mut comp_id = vec![-1i32; n];
    let mut stack = Vec::with_capacity(n / 4 + 64);
    let mut filled_h = vec![0.0f64; n];
    let mut receiver = vec![-1i32; n];
    let mut vis = vec![0u8; n];
    let mut discharge = vec![0.0f64; n];
    let mut sed_flux = vec![0.0f64; n];
    let mut min_up_h = vec![f64::INFINITY; n];
    let mut h_next = vec![0.0f64; n];
    let mut in_deg = vec![0u32; n];
    let mut top_queue = Vec::with_capacity(n / 2 + 16);
    let mut order = Vec::with_capacity(n);

    let ocean_min = (n / 100).max(1);

    for _iter in 0..params.iterations {
        // 4a. Склоновая диффузия на суше (до флювиального вреза, чтобы реки расчищали коллювий в долинах)
        if params.hillslope_diff > 0.0 {
            h_next.copy_from_slice(&h);
            for y in 0..h_rows {
                let row = y * w;
                for x in 0..w {
                    let c = row + x;
                    if h[c] <= 0.0 {
                        continue;
                    }
                    let (nbs, cnt) = grid.neighbors4(c);
                    let mut sum_nb = 0.0;
                    for &nb in &nbs[..cnt] {
                        sum_nb += h[nb].max(0.0);
                    }
                    let avg_nb = sum_nb / cnt as f64;
                    let coast_keep = 0.22 + 0.78 * ((h[c] - 0.05) / 0.35).clamp(0.0, 1.0);
                    h_next[c] = (h[c] + params.hillslope_diff * coast_keep * (avg_nb - h[c])).max(0.001);
                }
            }
            h.copy_from_slice(&h_next);
        }

        // 4b. Маска открытого океана
        is_ocean.fill(0);
        comp_id.fill(-1);
        let mut comp_sizes = Vec::new();
        for s0 in 0..n {
            if h[s0] > 0.0 || comp_id[s0] >= 0 {
                continue;
            }
            let id = comp_sizes.len() as i32;
            let mut sz = 0usize;
            comp_id[s0] = id;
            stack.push(s0);
            while let Some(c) = stack.pop() {
                sz += 1;
                let (nbs, cnt) = grid.neighbors4(c);
                for &nb in &nbs[..cnt] {
                    if h[nb] <= 0.0 && comp_id[nb] < 0 {
                        comp_id[nb] = id;
                        stack.push(nb);
                    }
                }
            }
            comp_sizes.push(sz);
        }
        let max_water = comp_sizes.iter().copied().max().unwrap_or(0);
        let mut any_ocean = false;
        for i in 0..n {
            let cid = comp_id[i];
            if cid >= 0 {
                let sz = comp_sizes[cid as usize];
                if sz == max_water || sz >= ocean_min {
                    is_ocean[i] = 1;
                    any_ocean = true;
                }
            }
        }

        // 4b. Priority-Flood для заполнения впадин и определения графа стока
        vis.fill(0);
        receiver.fill(-1);
        let mut heap = BinaryHeap::with_capacity(n / 4 + 64);
        if any_ocean {
            for i in 0..n {
                if is_ocean[i] != 0 {
                    vis[i] = 1;
                    filled_h[i] = h[i];
                    heap.push(FloodCell { elev: h[i], idx: i });
                }
            }
        } else {
            let mut min_i = 0usize;
            for i in 1..n {
                if h[i] < h[min_i] {
                    min_i = i;
                }
            }
            vis[min_i] = 1;
            filled_h[min_i] = h[min_i];
            heap.push(FloodCell {
                elev: h[min_i],
                idx: min_i,
            });
        }

        while let Some(FloodCell { elev: f_c, idx: c }) = heap.pop() {
            let cx = c % w;
            let cy = c / w;
            let (nbs, cnt) = grid.neighbors8(c);
            for &nb in &nbs[..cnt] {
                if vis[nb] != 0 {
                    continue;
                }
                vis[nb] = 1;
                receiver[nb] = c as i32;
                let nx = nb % w;
                let ny = nb / w;
                let diag = nx != cx && ny != cy;
                let step_eps =
                    1e-4 * (if diag { 1.4142 } else { 1.0 }) * (1.0 + 0.5 * cell_jitter(nb));
                let f_n = h[nb].max(f_c + step_eps);
                filled_h[nb] = f_n;
                heap.push(FloodCell { elev: f_n, idx: nb });
            }
        }

        // Уточняем направление стока по крутейшему физическому уклону
        for c in 0..n {
            if is_ocean[c] != 0 || filled_h[c] > h[c] + 1e-6 {
                continue;
            }
            let cx = c % w;
            let cy = c / w;
            let dx_c = dx_row[cy];
            let (nbs, cnt) = grid.neighbors8(c);
            let mut best_r = receiver[c];
            let mut best_s = f64::NEG_INFINITY;
            for &nb in &nbs[..cnt] {
                if filled_h[nb] >= filled_h[c] {
                    continue;
                }
                let nx = nb % w;
                let ny = nb / w;
                let dist = (if nx != cx { dx_c } else { 0.0 })
                    .hypot(if ny != cy { dy_km } else { 0.0 })
                    .max(1e-6);
                let s = (filled_h[c] - filled_h[nb]) / dist;
                if s > best_s {
                    best_s = s;
                    best_r = nb as i32;
                }
            }
            receiver[c] = best_r;
        }

        // Топологическая сортировка: в order сначала устья/стоки, в конце истоки
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

        // 4c. Накопление расхода воды (истоки -> устья)
        for i in 0..n {
            discharge[i] = if is_ocean[i] == 0 { runoff_m3s[i] } else { 0.0 };
        }
        for &c in order.iter().rev() {
            let r = receiver[c];
            if r >= 0 && is_ocean[c] == 0 {
                discharge[r as usize] += discharge[c];
            }
        }

        // 4d. Неявный врез FastScape (устья -> истоки) + расчёт потока осадков
        sed_flux.fill(0.0);
        step_drop.fill(0.0);
        for &c in &order {
            if is_ocean[c] != 0 {
                continue;
            }
            let glacial_coast = climate.glacier[c] > 0.10 && h[c] > -0.30;
            if h[c] <= 0.0 && !glacial_coast {
                continue;
            }
            if h[c] < filled_h[c] - 1e-4 {
                continue;
            }
            let r = receiver[c];
            if r < 0 {
                continue;
            }
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            let dist_km = (if rx != cx { dx_row[cy] } else { 0.0 })
                .hypot(if ry != cy { dy_km } else { 0.0 })
                .max(1e-3);
            let dist_scale = (dist_km / 100.0).max(0.25);

            let q_norm = (discharge[c] / 5000.0).max(0.0);
            let kf = params.k_fluvial * (erodibility[c] as f64) * q_norm.powf(0.45) / dist_scale;
            let kg = if climate.glacier[c] > 0.05 {
                params.k_glacial * (climate.glacier[c] as f64) * (0.25 + q_norm.powf(0.25))
                    / dist_scale
            } else {
                0.0
            };

            let h_base = if kg > 0.0 {
                h[ru].max(-0.35)
            } else {
                h[ru].max(0.0)
            };
            let k_tot = kf + kg;
            if h[c] > h_base && k_tot > 0.0 {
                let h_target = (h[c] + k_tot * h_base) / (1.0 + k_tot);
                let drop = (h[c] - h_target).clamp(0.0, params.max_incision_per_step_km);
                h[c] -= drop;
                step_drop[c] = drop as f32;
                rock_incised_km[c] += drop as f32;
                if kg > 0.0 {
                    glacial_carve_km[c] += (drop * (kg / k_tot)) as f32;
                }
                sed_flux[c] += drop * area_km2_row[cy];
            }
        }

        // 4e. Транспорт и аллювиальное отложение осадков (истоки -> устья, без образования искусственных плотин)
        min_up_h.fill(f64::INFINITY);
        for u in 0..n {
            if is_ocean[u] != 0 {
                continue;
            }
            let r = receiver[u];
            if r >= 0 {
                let ru = r as usize;
                if h[u] > h[ru] {
                    min_up_h[ru] = min_up_h[ru].min(h[u]);
                }
            }
        }

        for &c in order.iter().rev() {
            if is_ocean[c] != 0 {
                continue;
            }
            let flux = sed_flux[c];
            if flux <= 0.0 || h[c] <= -0.25 {
                continue;
            }
            let r = receiver[c];
            let cy = c / w;
            let area = area_km2_row[cy];
            let mut slope = 0.0f64;
            let mut mouth_ocean = false;
            if r >= 0 {
                let ru = r as usize;
                let (cx, rx, ry) = (c % w, ru % w, ru / w);
                let dist_km = (if rx != cx { dx_row[cy] } else { 0.0 })
                    .hypot(if ry != cy { dy_km } else { 0.0 })
                    .max(1e-3);
                slope = ((h[c] - h[ru]) / dist_km).max(0.0);
                mouth_ocean = h[ru] <= 0.0 || is_ocean[ru] != 0;
            }

            let in_dep = h[c] < filled_h[c] - 1e-4;
            let q_norm = (discharge[c] / 5000.0).max(0.0);
            let cap = 0.06 * q_norm.powf(0.75) * slope.max(0.0005) * area;

            let mut dep_vol = 0.0;
            if (in_dep || slope < 0.006) && flux > cap {
                let mut dep_h = ((flux - cap) * params.k_deposit / area)
                    .clamp(0.0, params.max_deposit_per_step_km);
                if in_dep {
                    dep_h = dep_h.min((filled_h[c] - h[c]).max(0.0));
                } else if min_up_h[c].is_finite() {
                    dep_h = dep_h
                        .min((min_up_h[c] - h[c] - 2e-4).max(0.0))
                        .min(0.03);
                } else {
                    dep_h = dep_h.min(0.02);
                }
                if dep_h > 0.0 {
                    h[c] += dep_h;
                    alluvium_km[c] += dep_h as f32;
                    dep_vol = dep_h * area;
                }
            }
            let mut rem_flux = (flux - dep_vol).max(0.0);
            if mouth_ocean && r >= 0 && rem_flux > cap {
                let ru = r as usize;
                if h[ru] > -0.20 && h[ru] <= 0.0 {
                    let area_ru = area_km2_row[ru / w];
                    let delta_h = ((rem_flux - cap) * 0.22 / area_ru)
                        .clamp(0.0, 0.022)
                        .min((0.012 - h[ru]).max(0.0));
                    if delta_h > 0.0 {
                        h[ru] += delta_h;
                        alluvium_km[ru] += delta_h as f32;
                        rem_flux = (rem_flux - delta_h * area_ru).max(0.0);
                    }
                }
            }
            if r >= 0 {
                sed_flux[r as usize] += rem_flux;
            }
        }

        // 4f. Локальная изостатическая компенсация разгрузки горных блоков
        let r_iso = ((w as f64 / 90.0).round() as usize).max(1);
        blur_xwrap(&mut step_drop, w, h_rows, r_iso);
        for c in 0..n {
            if h[c] > 0.0 && step_drop[c] > 0.0 {
                h[c] += 0.28 * step_drop[c] as f64;
            }
        }
    }

    // 5. Выравнивание уровня моря для точного сохранения объёма воды океана
    let (mut lo, mut hi) = (-2.0f64, 2.0f64);
    for _ in 0..48 {
        let mid = 0.5 * (lo + hi);
        let mut v = 0.0f64;
        for y in 0..h_rows {
            let a = area_km2_row[y];
            let row = y * w;
            for x in 0..w {
                let e = h[row + x];
                if e < mid {
                    v += (mid - e) * a;
                }
            }
        }
        if v > v0 {
            hi = mid;
        } else {
            lo = mid;
        }
    }
    let sea_level_shift_km = 0.5 * (lo + hi);

    let mut elevation_km = vec![0.0f32; n];
    let mut incised_km = vec![0.0f32; n];
    let mut effective_thickness_km = vec![0.0f32; n];
    for i in 0..n {
        let e = (h[i] - sea_level_shift_km) as f32;
        elevation_km[i] = e;
        incised_km[i] = world.elevation_km[i] - e;
        effective_thickness_km[i] =
            (world.thickness[i] - (rock_incised_km[i] - alluvium_km[i]) * 2.0).clamp(0.0, 80.0);
    }

    ErosionResult {
        elevation_km,
        incised_km,
        alluvium_km,
        glacial_carve_km,
        erodibility,
        effective_thickness_km,
        sea_level_shift_km,
    }
}
