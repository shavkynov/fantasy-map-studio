//! Статическая сферическая гидрология: открытый океан, Priority-Flood заполнение впадин,
//! сток, стационарный водный баланс озёр/солончаков, порядок Стрелера, дерево рек со сглаживанием Чайкина и типы берегов.

use crate::climate::Climate;
use crate::grid::{slope_field, Grid};
use crate::rng::{Noise, Rng};
use std::cmp::Ordering;
use std::collections::BinaryHeap;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum MouthKind {
    Ocean,
    Lake,
    Endorheic,
    /// Впадение притока в главную реку с указанным `id`.
    Confluence(u32),
}

/// Трассированная река (главный ствол или приток до слияния) со сглаженными координатами.
#[derive(Clone, Debug)]
pub struct River {
    pub id: u32,
    pub order: u8,
    pub length_km: f32,
    pub max_discharge_m3s: f32,
    pub mouth: MouthKind,
    pub cells: Vec<usize>,
    /// Сглаженные координаты Чайкина `[x, y]` в пределах `[0..w, 0..h]`.
    pub smoothed_pts: Vec<[f32; 2]>,
    /// Условная ширина русла в каждой точке `smoothed_pts` (растёт с расходом).
    pub widths: Vec<f32>,
}

/// Результаты гидрологического расчёта на сфере.
#[derive(Clone, Debug)]
pub struct Hydrology {
    pub is_ocean: Vec<u8>,
    pub is_lake: Vec<u8>,
    pub is_salt_flat: Vec<u8>,
    pub lake_surface_km: Vec<f32>,
    pub filled_km: Vec<f32>,
    /// Индекс принимающей клетки ниже по стоку (`-1` для океана / стока).
    pub receiver: Vec<i32>,
    pub discharge_m3s: Vec<f32>,
    pub river_mask: Vec<u8>,
    pub river_order: Vec<u8>,
    /// Тип берега суши у океана: 0 — не берег, 1 — активный клиф, 2 — пассивный шельф, 3 — фьорд, 4 — риа.
    pub coast_type: Vec<u8>,
    pub rivers: Vec<River>,
}

#[derive(Clone, Copy, Debug)]
struct FloodNode {
    elev: f64,
    idx: usize,
}

impl Eq for FloodNode {}
impl PartialEq for FloodNode {
    fn eq(&self, other: &Self) -> bool {
        self.idx == other.idx && self.elev.to_bits() == other.elev.to_bits()
    }
}
impl Ord for FloodNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other.elev.total_cmp(&self.elev).then_with(|| other.idx.cmp(&self.idx))
    }
}
impl PartialOrd for FloodNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[inline]
fn cell_jitter(idx: usize) -> f64 {
    let x = (idx as u32).wrapping_mul(2654435761);
    (x as f64) / 4294967296.0
}

#[inline]
fn evap_rate_m_yr(temp_c: f32) -> f64 {
    (0.15 + 0.075 * (temp_c as f64).max(0.0)).clamp(0.10, 2.50)
}

#[inline]
fn smoothstep_f32(e0: f32, e1: f32, x: f32) -> f32 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[derive(Clone, Copy)]
struct RiverPt {
    x: f32,
    y: f32,
    q: f32,
    slope: f32,
    conf_lock: f32,
}

fn meander_smooth_river(
    cells: &[usize],
    discharge_m3s: &[f32],
    slope: &[f32],
    has_confluence: &[u8],
    threshold: f32,
    w: usize,
    h: usize,
    river_id: u32,
    mouth: MouthKind,
) -> (Vec<[f32; 2]>, Vec<f32>) {
    if cells.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let wf = w as f32;
    let hf = h as f32;
    let wi = w as isize;
    let mut pts: Vec<RiverPt> = Vec::with_capacity(cells.len());
    let mut ux = (cells[0] % w) as f32 + 0.5;
    let mut prev_x = (cells[0] % w) as isize;

    for (idx, &c) in cells.iter().enumerate() {
        let cx = (c % w) as isize;
        let cy = (c / w) as f32 + 0.5;
        if idx > 0 {
            let mut dx = cx - prev_x;
            if dx > wi / 2 {
                dx -= wi;
            } else if dx < -wi / 2 {
                dx += wi;
            }
            ux += dx as f32;
            prev_x = cx;
        }
        pts.push(RiverPt {
            x: ux,
            y: cy,
            q: discharge_m3s[c],
            slope: slope[c],
            conf_lock: if has_confluence[c] != 0 { 1.0 } else { 0.0 },
        });
    }

    // 2 прохода подразделения Чайкина для гладкой базовой полилинии
    for _ in 0..2 {
        if pts.len() < 3 {
            break;
        }
        let mut next = Vec::with_capacity(pts.len() * 2);
        next.push(pts[0]);
        for k in 0..(pts.len() - 1) {
            let a = pts[k];
            let b = pts[k + 1];
            next.push(RiverPt {
                x: 0.75 * a.x + 0.25 * b.x,
                y: 0.75 * a.y + 0.25 * b.y,
                q: 0.75 * a.q + 0.25 * b.q,
                slope: 0.75 * a.slope + 0.25 * b.slope,
                conf_lock: a.conf_lock.max(b.conf_lock * 0.65),
            });
            next.push(RiverPt {
                x: 0.25 * a.x + 0.75 * b.x,
                y: 0.25 * a.y + 0.75 * b.y,
                q: 0.25 * a.q + 0.75 * b.q,
                slope: 0.25 * a.slope + 0.75 * b.slope,
                conf_lock: b.conf_lock.max(a.conf_lock * 0.65),
            });
        }
        next.push(*pts.last().unwrap());
        pts = next;
    }

    let m = pts.len();
    if m >= 3 {
        let mut arc = vec![0.0f32; m];
        for i in 1..m {
            let d = (pts[i].x - pts[i - 1].x).hypot(pts[i].y - pts[i - 1].y);
            arc[i] = arc[i - 1] + d;
        }

        let ph1 = ((river_id.wrapping_mul(1103515245) & 0xffff) as f32 / 65535.0)
            * std::f32::consts::TAU;
        let ph2 = ((river_id.wrapping_mul(2654435761) & 0xffff) as f32 / 65535.0)
            * std::f32::consts::TAU;
        let ph3 = ((river_id.wrapping_mul(2246822519) & 0xffff) as f32 / 65535.0)
            * std::f32::consts::TAU;

        let orig = pts.clone();
        for i in 1..(m - 1) {
            let tx = orig[i + 1].x - orig[i - 1].x;
            let ty = orig[i + 1].y - orig[i - 1].y;
            let tlen = tx.hypot(ty).max(1e-4);
            let nx = -ty / tlen;
            let ny = tx / tlen;

            let t = i as f32 / (m - 1) as f32;
            let end_env = (t * 6.0).min(1.0) * ((1.0 - t) * 7.0).min(1.0);
            let conf_env = (1.0 - orig[i].conf_lock).clamp(0.0, 1.0);
            let env = end_env * conf_env;

            let flat = (1.0 - smoothstep_f32(0.012, 0.065, orig[i].slope)).clamp(0.18, 1.0);
            let s = arc[i];
            let wave = 0.58 * (s * 1.15 + ph1).sin()
                + 0.28 * (s * 2.35 + ph2).sin()
                + 0.14 * (s * 4.10 + ph3).sin();
            let amp = 0.48 * flat * env * wave;

            pts[i].x = orig[i].x + nx * amp;
            pts[i].y = (orig[i].y + ny * amp).clamp(0.05, hf - 0.05);
        }

        // Один мягкий проход сглаживания после изгиба меандра
        let pre = pts.clone();
        for i in 1..(m - 1) {
            let lock = pre[i].conf_lock;
            if lock < 0.99 {
                let k = 1.0 - lock;
                pts[i].x = pre[i].x * (1.0 - 0.5 * k)
                    + (0.25 * pre[i - 1].x + 0.5 * pre[i].x + 0.25 * pre[i + 1].x) * (0.5 * k);
                pts[i].y = pre[i].y * (1.0 - 0.5 * k)
                    + (0.25 * pre[i - 1].y + 0.5 * pre[i].y + 0.25 * pre[i + 1].y) * (0.5 * k);
            }
        }
    }

    let mut out_pts = Vec::with_capacity(m);
    let mut out_w = Vec::with_capacity(m);
    let denom = (m.saturating_sub(1)).max(1) as f32;
    for (i, p) in pts.iter().enumerate() {
        let t = i as f32 / denom;
        let base_w = (p.q / threshold.max(1.0)).powf(0.38).clamp(0.45, 2.8);
        let head_taper = (t / 0.20).min(1.0);
        let mut w_val = 0.22 + (base_w - 0.22) * head_taper;
        if matches!(mouth, MouthKind::Ocean) {
            let flare = 1.0 + 0.28 * smoothstep_f32(0.88, 1.0, t);
            w_val *= flare;
        }
        out_pts.push([p.x.rem_euclid(wf), p.y]);
        out_w.push(w_val);
    }
    (out_pts, out_w)
}

/// Строит полную статическую гидрологию для текущего рельефа и климата.
pub fn compute(
    grid: &Grid,
    rel_height_km: &[f32],
    force_lake: &[u8],
    margin: &[u8],
    climate: &Climate,
    seed: &str,
) -> Hydrology {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    assert_eq!(rel_height_km.len(), n);
    assert_eq!(force_lake.len(), n);
    assert_eq!(margin.len(), n);

    // 1. Открытый океан (крупные связные водные бассейны <= 0, включая замыкание по долготе X).
    let mut is_ocean = vec![0u8; n];
    let mut comp_id = vec![-1i32; n];
    let mut comp_sizes = Vec::new();
    let mut stack = Vec::new();
    for s0 in 0..n {
        if rel_height_km[s0] > 0.0 || comp_id[s0] >= 0 {
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
                if rel_height_km[nb] <= 0.0 && comp_id[nb] < 0 {
                    comp_id[nb] = id;
                    stack.push(nb);
                }
            }
        }
        comp_sizes.push(sz);
    }
    let max_water = comp_sizes.iter().copied().max().unwrap_or(0);
    let ocean_min = (n / 100).max(1);
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

    // 2. Priority-Flood (8-связное заполнение впадин с замыканием по X).
    let mut filled_f64 = vec![0.0f64; n];
    let mut filled_km = vec![0.0f32; n];
    let mut receiver = vec![-1i32; n];
    let mut vis = vec![0u8; n];
    let mut order = Vec::with_capacity(n);
    let mut heap = BinaryHeap::with_capacity(n / 4 + 64);

    if any_ocean {
        for i in 0..n {
            if is_ocean[i] != 0 {
                vis[i] = 1;
                let e = rel_height_km[i] as f64;
                filled_f64[i] = e;
                filled_km[i] = rel_height_km[i];
                heap.push(FloodNode { elev: e, idx: i });
            }
        }
    } else {
        let mut min_i = 0usize;
        for i in 1..n {
            if rel_height_km[i] < rel_height_km[min_i] {
                min_i = i;
            }
        }
        vis[min_i] = 1;
        filled_f64[min_i] = rel_height_km[min_i] as f64;
        filled_km[min_i] = rel_height_km[min_i];
        heap.push(FloodNode { elev: filled_f64[min_i], idx: min_i });
    }

    while let Some(FloodNode { elev: f_c, idx: c }) = heap.pop() {
        order.push(c);
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
            let step_eps = 1.2e-4 * (if diag { 1.4142 } else { 1.0 }) * (1.0 + 2.0 * cell_jitter(nb));
            let f_n = (rel_height_km[nb] as f64).max(f_c + step_eps);
            filled_f64[nb] = f_n;
            let mut f32_n = f_n as f32;
            if f32_n <= filled_km[c] {
                f32_n = f32::from_bits(filled_km[c].to_bits() + 1);
            }
            filled_km[nb] = f32_n;
            heap.push(FloodNode { elev: f_n, idx: nb });
        }
    }

    // 2b. Дендритный выбор приёмника по крутейшему физическому уклону + потенциалу долин,
    //     чтобы убрать параллельную "расчёску" волн Priority-Flood.
    let mut val_rng = Rng::sub(seed, "river-valleys");
    let val_noise = Noise::new(&mut val_rng);
    let mut valley_aff = vec![0.0f64; n];
    for y in 0..h {
        for x in 0..w {
            let p = grid.unit_vec(x, y);
            let v1 = val_noise.fbm(p[0] * 11.0, p[1] * 11.0, p[2] * 11.0, 3);
            let v2 = val_noise.fbm(p[0] * 23.0 + 3.7, p[1] * 23.0 - 1.9, p[2] * 23.0 + 5.1, 2);
            valley_aff[grid.idx(x, y)] = (0.65 * v1 + 0.35 * v2).clamp(-1.0, 1.0);
        }
    }

    let dy_km_f64 = grid.dy_km();
    let dx_km_row: Vec<f64> = (0..h).map(|y| grid.dx_km(y)).collect();
    let mut dendritic_receiver = receiver.clone();
    for c in 0..n {
        if is_ocean[c] != 0 || filled_f64[c] > rel_height_km[c] as f64 + 1e-6 {
            continue;
        }
        let cx = c % w;
        let cy = c / w;
        let dx_c = dx_km_row[cy];
        let (nbs, cnt) = grid.neighbors8(c);
        let mut best_r = receiver[c];
        let mut best_score = f64::NEG_INFINITY;
        for &nb in &nbs[..cnt] {
            if filled_km[nb] >= filled_km[c] {
                continue;
            }
            let nx = nb % w;
            let ny = nb / w;
            let step_dx = if nx != cx { dx_c } else { 0.0 };
            let step_dy = if ny != cy { dy_km_f64 } else { 0.0 };
            let dist_km = step_dx.hypot(step_dy).max(1e-6);
            let drop = (filled_f64[c] - filled_f64[nb]).max(0.0);
            let s = drop / dist_km;
            let score = s * (1.0 + 0.55 * valley_aff[nb]);
            if score > best_score {
                best_score = score;
                best_r = nb as i32;
            }
        }
        dendritic_receiver[c] = best_r;
    }
    receiver = dendritic_receiver;

    // Топологическая сортировка O(N) по обновлённому графу приёмников:
    // order хранит сначала устья/стоки, в конце истоки (как в Priority-Flood).
    let mut in_deg = vec![0u32; n];
    for &r in &receiver {
        if r >= 0 {
            in_deg[r as usize] += 1;
        }
    }
    let mut top_queue = Vec::with_capacity(n / 2);
    for (c, &deg) in in_deg.iter().enumerate() {
        if deg == 0 {
            top_queue.push(c);
        }
    }
    let mut top_down = Vec::with_capacity(n);
    let mut q_head = 0usize;
    while q_head < top_queue.len() {
        let c = top_queue[q_head];
        q_head += 1;
        top_down.push(c);
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            in_deg[ru] -= 1;
            if in_deg[ru] == 0 {
                top_queue.push(ru);
            }
        }
    }
    debug_assert_eq!(top_down.len(), n);
    top_down.reverse();
    order = top_down;

    // 3. Предварительный расчёт локального стока (м³/с) и накопления по графу приёмников.
    const SECONDS_PER_YEAR: f64 = 31_557_600.0;
    let area_m2_row: Vec<f64> = (0..h).map(|y| grid.cell_area_km2(y) * 1e6).collect();
    let mut runoff_m3s = vec![0.0f32; n];
    for y in 0..h {
        let am2 = area_m2_row[y];
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if is_ocean[i] == 0 {
                let coeff = 0.25 + 0.45 * (climate.moisture[i] as f64).clamp(0.0, 1.0);
                let precip_m = (climate.precip_mm[i] as f64).max(0.0) * 1e-3;
                runoff_m3s[i] = ((am2 * precip_m * coeff) / SECONDS_PER_YEAR) as f32;
            }
        }
    }

    let mut discharge_m3s = runoff_m3s.clone();
    for &c in order.iter().rev() {
        let r = receiver[c];
        if r >= 0 && is_ocean[c] == 0 {
            discharge_m3s[r as usize] += discharge_m3s[c];
        }
    }

    // 4. Котловины и стационарный водный баланс (полное озеро / частичное бессточное / солончак).
    let mut cand = vec![0u8; n];
    for i in 0..n {
        if is_ocean[i] == 0 {
            let dep = filled_km[i] - rel_height_km[i];
            if dep > 0.015 || force_lake[i] != 0 {
                cand[i] = 1;
            }
        }
    }

    let mut basin_id = vec![-1i32; n];
    let mut basins: Vec<Vec<usize>> = Vec::new();
    let mut basin_forced: Vec<bool> = Vec::new();
    for s0 in 0..n {
        if cand[s0] == 0 || basin_id[s0] >= 0 {
            continue;
        }
        let bid = basins.len() as i32;
        let mut comp = Vec::new();
        let mut has_force = false;
        let mut max_dep = 0.0f32;
        basin_id[s0] = bid;
        stack.push(s0);
        while let Some(c) = stack.pop() {
            comp.push(c);
            if force_lake[c] != 0 {
                has_force = true;
            }
            max_dep = max_dep.max(filled_km[c] - rel_height_km[c]);
            let (nbs, cnt) = grid.neighbors4(c);
            for &nb in &nbs[..cnt] {
                if cand[nb] != 0 && basin_id[nb] < 0 {
                    basin_id[nb] = bid;
                    stack.push(nb);
                }
            }
        }
        if comp.len() >= 2 || has_force || max_dep > 0.08 {
            basins.push(comp);
            basin_forced.push(has_force);
        } else {
            for c in comp {
                basin_id[c] = -1;
            }
        }
    }

    let mut inflow = vec![0.0f64; basins.len()];
    for i in 0..n {
        let bi = basin_id[i];
        if bi >= 0 {
            inflow[bi as usize] += runoff_m3s[i] as f64;
        }
        let r = receiver[i];
        if r >= 0 {
            let br = basin_id[r as usize];
            if br >= 0 && bi != br {
                inflow[br as usize] += discharge_m3s[i] as f64;
            }
        }
    }

    let mut is_lake = vec![0u8; n];
    let mut is_salt_flat = vec![0u8; n];
    let mut lake_surface_km = vec![0.0f32; n];
    let mut closed_basin_cell = vec![0u8; n];

    for (bid, comp) in basins.iter().enumerate() {
        let mut pot_evap = 0.0f64;
        let mut mean_temp = 0.0f64;
        let mut spill_level = f32::NEG_INFINITY;
        for &c in comp {
            let y = c / w;
            let am2 = area_m2_row[y];
            let ev = evap_rate_m_yr(climate.temp_c[c]);
            pot_evap += (am2 * ev) / SECONDS_PER_YEAR;
            mean_temp += climate.temp_c[c] as f64;
            spill_level = spill_level.max(filled_km[c]).max(rel_height_km[c]);
        }
        mean_temp /= comp.len() as f64;
        let q_in = inflow[bid];
        let forced = basin_forced[bid];

        if forced || q_in >= pot_evap {
            for &c in comp {
                is_lake[c] = 1;
                lake_surface_km[c] = spill_level.max(rel_height_km[c]);
            }
        } else if q_in >= 0.20 * pot_evap {
            let mut sorted = comp.clone();
            sorted.sort_by(|&a, &b| rel_height_km[a].total_cmp(&rel_height_km[b]));
            let mut used_evap = 0.0f64;
            let mut k_end = 0usize;
            for (k, &c) in sorted.iter().enumerate() {
                let y = c / w;
                let cell_evap = (area_m2_row[y] * evap_rate_m_yr(climate.temp_c[c])) / SECONDS_PER_YEAR;
                if k == 0 || used_evap + cell_evap <= q_in {
                    used_evap += cell_evap;
                    k_end = k + 1;
                } else {
                    break;
                }
            }
            let eq_level = sorted[..k_end]
                .iter()
                .map(|&c| rel_height_km[c])
                .fold(f32::NEG_INFINITY, f32::max)
                + 0.005;
            let eq_level = eq_level.min(spill_level);
            for &c in &sorted[..k_end] {
                is_lake[c] = 1;
                lake_surface_km[c] = eq_level.max(rel_height_km[c]);
                closed_basin_cell[c] = 1;
            }
            for &c in &sorted[k_end..] {
                closed_basin_cell[c] = 1;
                if climate.precip_mm[c] < 450.0 && climate.temp_c[c] > 4.0 {
                    is_salt_flat[c] = 1;
                }
            }
        } else {
            for &c in comp {
                closed_basin_cell[c] = 1;
            }
            if mean_temp > 4.0 {
                let mut sorted = comp.clone();
                sorted.sort_by(|&a, &b| rel_height_km[a].total_cmp(&rel_height_km[b]));
                let keep = (sorted.len() + 1) / 2;
                for &c in &sorted[..keep] {
                    is_salt_flat[c] = 1;
                }
            }
        }
    }

    if closed_basin_cell.iter().any(|&v| v != 0) {
        discharge_m3s.copy_from_slice(&runoff_m3s);
        for &c in order.iter().rev() {
            if is_ocean[c] != 0 || closed_basin_cell[c] != 0 {
                continue;
            }
            let r = receiver[c];
            if r >= 0 {
                discharge_m3s[r as usize] += discharge_m3s[c];
            }
        }
    }

    // 5. Речная сеть, порядок Стрелера и дерево "главный ствол + притоки"
    let river_threshold_m3s = 4200.0f32;
    let mut river_mask = vec![0u8; n];
    for i in 0..n {
        if is_ocean[i] == 0
            && is_lake[i] == 0
            && is_salt_flat[i] == 0
            && closed_basin_cell[i] == 0
            && discharge_m3s[i] >= river_threshold_m3s
        {
            river_mask[i] = 1;
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

    // Вычисляем расход в конечном устье для сортировки истоков: сперва трассируется главный ствол
    let mut term_q = vec![0.0f32; n];
    for &c in &order {
        if river_mask[c] == 0 {
            continue;
        }
        let r = receiver[c];
        term_q[c] = if r >= 0 && river_mask[r as usize] != 0 {
            term_q[r as usize]
        } else {
            discharge_m3s[c]
        };
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
            .then_with(|| discharge_m3s[b].total_cmp(&discharge_m3s[a]))
            .then(a.cmp(&b))
    });

    let slope = slope_field(rel_height_km, grid);

    struct RawRiver {
        id: u32,
        order: u8,
        length_km: f32,
        max_discharge_m3s: f32,
        mouth: MouthKind,
        cells: Vec<usize>,
    }

    let mut raw_rivers = Vec::new();
    let mut has_confluence = vec![0u8; n];
    let mut traced_id = vec![0u32; n];
    let mut next_id = 1u32;
    let dy_km = grid.dy_km() as f32;
    let dx_row: Vec<f32> = (0..h).map(|y| grid.dx_km(y) as f32).collect();

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
            let step_dx = if rx != cx { dx_row[cy] } else { 0.0 };
            let step_dy = if ry != cy { dy_km } else { 0.0 };
            len_km += step_dx.hypot(step_dy);

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
            if is_salt_flat[ru] != 0 || closed_basin_cell[ru] != 0 {
                cells.push(ru);
                mouth = MouthKind::Endorheic;
                break;
            }
            if traced_id[ru] != 0 {
                cells.push(ru);
                mouth = MouthKind::Confluence(traced_id[ru]);
                break;
            }
            c = ru;
        }

        let min_cells = if matches!(mouth, MouthKind::Confluence(_)) {
            if w >= 480 { 4 } else { 3 }
        } else if w <= 200 {
            4
        } else {
            8
        };
        let keep_by_scale = matches!(mouth, MouthKind::Confluence(_))
            || len_km >= 360.0
            || max_q >= 9000.0
            || w <= 200;
        if cells.len() >= min_cells && keep_by_scale {
            if matches!(mouth, MouthKind::Confluence(_)) {
                if let Some(&last) = cells.last() {
                    has_confluence[last] = 1;
                }
            }
            raw_rivers.push(RawRiver {
                id: cur_id,
                order: max_ord,
                length_km: len_km,
                max_discharge_m3s: max_q,
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

    let mut rivers = Vec::with_capacity(raw_rivers.len());
    for rr in raw_rivers {
        let (smoothed_pts, widths) = meander_smooth_river(
            &rr.cells,
            &discharge_m3s,
            &slope,
            &has_confluence,
            river_threshold_m3s,
            w,
            h,
            rr.id,
            rr.mouth,
        );
        rivers.push(River {
            id: rr.id,
            order: rr.order,
            length_km: rr.length_km,
            max_discharge_m3s: rr.max_discharge_m3s,
            mouth: rr.mouth,
            cells: rr.cells,
            smoothed_pts,
            widths,
        });
    }

    // 6. Типы береговой линии (фьорды, рии, активные клифы, пассивные шельфы).
    let mut coast_rng = Rng::sub(seed, "coast-forms");
    let coast_noise = Noise::new(&mut coast_rng);
    let mut coast_type = vec![0u8; n];
    for y in 0..h {
        let lat_abs = grid.lat_deg(y).abs();
        for x in 0..w {
            let i = grid.idx(x, y);
            if is_ocean[i] != 0 || is_lake[i] != 0 {
                continue;
            }
            let (nbs, cnt) = grid.neighbors4(i);
            if !nbs[..cnt].iter().any(|&nb| is_ocean[nb] != 0) {
                continue;
            }
            let p = grid.unit_vec(x, y);
            let nval = coast_noise.fbm(p[0] * 10.0, p[1] * 10.0, p[2] * 10.0, 2);
            coast_type[i] = if lat_abs > 52.0 && (rel_height_km[i] > 0.35 || slope[i] > 0.025) {
                3 // фьорды
            } else if (25.0..=58.0).contains(&lat_abs)
                && (discharge_m3s[i] > 0.3 * river_threshold_m3s || nval > 0.30)
            {
                4 // рии
            } else if margin[i] == 1 {
                1 // активный клиф
            } else {
                2 // пассивный шельф
            };
        }
    }

    Hydrology {
        is_ocean,
        is_lake,
        is_salt_flat,
        lake_surface_km,
        filled_km,
        receiver,
        discharge_m3s,
        river_mask,
        river_order,
        coast_type,
        rivers,
    }
}
