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

/// Сезонный водный режим реки.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FlowRegime {
    /// Постоянный круглогодичный сток.
    Perennial,
    /// Выраженное сезонное половодье (муссоны / зимние дожди).
    SeasonalMonsoon,
    /// Преимущественно снегово-ледниковое половодье.
    Snowmelt,
    /// Пересыхающее русло (вади / уэд) аридной зоны.
    EphemeralWadi,
}

/// Трассированная река (главный ствол или приток до слияния) со сглаженными координатами.
#[derive(Clone, Debug)]
pub struct River {
    pub id: u32,
    pub order: u8,
    pub length_km: f32,
    pub max_discharge_m3s: f32,
    pub discharge_jan_m3s: f32,
    pub discharge_jul_m3s: f32,
    pub regime: FlowRegime,
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
    /// Бессточные (солёные/солоноватые) озёра в замкнутых котловинах (`1`, если `is_lake == 1` и нет стока наружу).
    pub is_endorheic_lake: Vec<u8>,
    pub is_salt_flat: Vec<u8>,
    /// Временные пересыхающие русла (вади) аридных и полуаридных зон (`0` или `1`).
    pub is_wadi: Vec<u8>,
    /// Предгорные и инфильтрационные пустынные оазисы (`0` или `1`).
    pub is_oasis: Vec<u8>,
    pub lake_surface_km: Vec<f32>,
    pub filled_km: Vec<f32>,
    /// Индекс принимающей клетки ниже по стоку (`-1` для океана / стока).
    pub receiver: Vec<i32>,
    pub discharge_m3s: Vec<f32>,
    pub discharge_jan_m3s: Vec<f32>,
    pub discharge_jul_m3s: Vec<f32>,
    /// Индекс сезонной неравномерности стока (`|Q_jul - Q_jan| / (Q_jul + Q_jan)`).
    pub flow_seasonality: Vec<f32>,
    pub river_mask: Vec<u8>,
    pub river_order: Vec<u8>,
    /// Тип берега суши у океана: 0 — не берег, 1 — активный клиф, 2 — пассивный шельф, 3 — фьорд, 4 — риа.
    pub coast_type: Vec<u8>,
    /// Потери воды на испарение с озёр и русел (м³/с).
    pub water_loss_m3s: Vec<f32>,
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
pub(crate) fn evap_rate_m_yr(temp_c: f32) -> f64 {
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

#[allow(clippy::too_many_arguments)]
pub(crate) fn meander_smooth_river(
    cells: &[usize],
    discharge_m3s: &[f32],
    slope: &[f32],
    has_confluence: &[u8],
    threshold: f32,
    w: usize,
    h: usize,
    river_id: u32,
    mouth: MouthKind,
    starts_from_lake: bool,
    wrap_x: bool,
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
            if wrap_x {
                if dx > wi / 2 {
                    dx -= wi;
                } else if dx < -wi / 2 {
                    dx += wi;
                }
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
        let head_taper = if starts_from_lake {
            1.0
        } else {
            (t / 0.20).min(1.0)
        };
        let mut w_val = 0.22 + (base_w - 0.22) * head_taper;
        if matches!(mouth, MouthKind::Ocean) {
            let flare = 1.0 + 0.28 * smoothstep_f32(0.88, 1.0, t);
            w_val *= flare;
        }
        out_pts.push([
            if wrap_x {
                p.x.rem_euclid(wf)
            } else {
                p.x.clamp(0.0, wf)
            },
            p.y,
        ]);
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
                f32_n = filled_km[c].next_up();
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
            let score = s * (1.0 + 0.20 * valley_aff[nb]);
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
    let dy_km = grid.dy_km() as f32;
    let dx_row: Vec<f32> = (0..h).map(|y| grid.dx_km(y) as f32).collect();
    let mut step_m = vec![0.0f64; n];
    for c in 0..n {
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            let step_dx = if rx != cx { dx_row[cy] as f64 } else { 0.0 };
            let step_dy = if ry != cy { dy_km as f64 } else { 0.0 };
            step_m[c] = step_dx.hypot(step_dy) * 1000.0;
        }
    }

    let mut runoff_m3s = vec![0.0f32; n];
    for y in 0..h {
        let am2 = area_m2_row[y];
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if is_ocean[i] == 0 {
                let arid_f = (climate.aridity_index[i] as f64 / 0.45).clamp(0.25, 1.0);
                let melt_boost =
                    1.0 + 0.25 * (climate.snow_frac[i] as f64).max(climate.glacier[i] as f64);
                let coeff = ((0.25 + 0.45 * (climate.moisture[i] as f64).clamp(0.0, 1.0))
                    * arid_f
                    * melt_boost)
                    .clamp(0.05, 0.85);
                let precip_m = (climate.precip_mm[i] as f64).max(0.0) * 1e-3;
                runoff_m3s[i] = ((am2 * precip_m * coeff) / SECONDS_PER_YEAR) as f32;
            }
        }
    }

    // 4. Котловины и стационарный водный баланс (полное озеро / частичное бессточное / солончак).
    let mut cand = vec![0u8; n];
    for i in 0..n {
        if is_ocean[i] == 0 {
            let dep = filled_km[i] - rel_height_km[i];
            if dep > 0.020 || force_lake[i] != 0 {
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
            let (nbs, cnt) = grid.neighbors8(c);
            for &nb in &nbs[..cnt] {
                if cand[nb] != 0 && basin_id[nb] < 0 {
                    basin_id[nb] = bid;
                    stack.push(nb);
                }
            }
        }
        if (comp.len() >= 2 && max_dep > 0.035) || has_force || max_dep > 0.08 {
            basins.push(comp);
            basin_forced.push(has_force);
        } else {
            for c in comp {
                basin_id[c] = -1;
            }
        }
    }

    let mut discharge_m3s = vec![0.0f32; n];
    let mut water_loss_m3s = vec![0.0f32; n];
    let mut inflow = vec![0.0f64; basins.len()];
    let mut is_lake = vec![0u8; n];
    let mut is_salt_flat = vec![0u8; n];
    let mut lake_surface_km = vec![0.0f32; n];
    let mut closed_basin_cell = vec![0u8; n];
    let mut next_closed = vec![0u8; n];
    let mut open_lake_scale = vec![1.0f64; basins.len()];
    let mut next_open_scale = vec![1.0f64; basins.len()];
    let mut converged = false;

    for _iter in 0..16 {
        discharge_m3s.copy_from_slice(&runoff_m3s);
        water_loss_m3s.fill(0.0);
        for &c in order.iter().rev() {
            if is_ocean[c] != 0 || closed_basin_cell[c] != 0 {
                continue;
            }
            let bi = basin_id[c];
            if bi < 0 && climate.pet_mm[c] > climate.precip_mm[c] && discharge_m3s[c] > 0.0 {
                let ai = climate.aridity_index[c] as f64;
                let infil = 1.0 + 1.8 * ((0.22 - ai).max(0.0) / 0.22);
                let deficit_m_yr = (climate.pet_mm[c] - climate.precip_mm[c]) as f64 * 1e-3;
                let w_eff_m = 25.0 * (discharge_m3s[c] as f64).powf(0.45) * 10.0 * infil;
                let raw_loss = (w_eff_m * step_m[c] * deficit_m_yr) / SECONDS_PER_YEAR;
                let max_frac = if ai < 0.15 { 0.26 } else { 0.18 };
                let loss = raw_loss.min(discharge_m3s[c] as f64 * max_frac) as f32;
                discharge_m3s[c] = (discharge_m3s[c] - loss).max(0.0);
                water_loss_m3s[c] = loss;
            }
            let r = receiver[c];
            if r >= 0 {
                let ru = r as usize;
                let mut out_q = discharge_m3s[c];
                if bi >= 0 && basin_id[ru] != bi {
                    let scale = open_lake_scale[bi as usize];
                    let evap_loss = (out_q as f64 * (1.0 - scale)).max(0.0) as f32;
                    water_loss_m3s[c] += evap_loss;
                    out_q = (out_q as f64 * scale) as f32;
                }
                discharge_m3s[ru] += out_q;
            }
        }

        inflow.fill(0.0);
        for i in 0..n {
            let bi = basin_id[i];
            if bi >= 0 {
                inflow[bi as usize] += runoff_m3s[i] as f64;
            }
            let r = receiver[i];
            if r >= 0 {
                let br = basin_id[r as usize];
                if br >= 0 && bi != br && closed_basin_cell[i] == 0 {
                    let out_q = if bi >= 0 {
                        discharge_m3s[i] as f64 * open_lake_scale[bi as usize]
                    } else {
                        discharge_m3s[i] as f64
                    };
                    inflow[br as usize] += out_q;
                }
            }
        }

        is_lake.fill(0);
        is_salt_flat.fill(0);
        lake_surface_km.fill(0.0);
        next_closed.fill(0);
        next_open_scale.fill(0.0);

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
                next_open_scale[bid] = if q_in > 1e-6 {
                    ((q_in - pot_evap) / q_in).clamp(0.0, 1.0)
                } else {
                    0.0
                };
            } else if q_in >= 0.20 * pot_evap {
                let mut sorted = comp.clone();
                sorted.sort_by(|&a, &b| rel_height_km[a].total_cmp(&rel_height_km[b]));
                let mut used_evap = 0.0f64;
                let mut k_end = 0usize;
                for (k, &c) in sorted.iter().enumerate() {
                    let y = c / w;
                    let cell_evap =
                        (area_m2_row[y] * evap_rate_m_yr(climate.temp_c[c])) / SECONDS_PER_YEAR;
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
                    next_closed[c] = 1;
                }
                for &c in &sorted[k_end..] {
                    next_closed[c] = 1;
                    if climate.precip_mm[c] < 450.0 && climate.temp_c[c] > 4.0 {
                        is_salt_flat[c] = 1;
                    }
                }
            } else {
                for &c in comp {
                    next_closed[c] = 1;
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

        let max_scale_diff = open_lake_scale
            .iter()
            .zip(next_open_scale.iter())
            .map(|(a, b)| (a - b).abs())
            .fold(0.0f64, f64::max);
        if next_closed == closed_basin_cell && max_scale_diff < 1e-3 {
            open_lake_scale.copy_from_slice(&next_open_scale);
            converged = true;
            break;
        }
        closed_basin_cell.copy_from_slice(&next_closed);
        open_lake_scale.copy_from_slice(&next_open_scale);
    }

    if !converged || !basins.is_empty() {
        discharge_m3s.copy_from_slice(&runoff_m3s);
        water_loss_m3s.fill(0.0);
        for &c in order.iter().rev() {
            if is_ocean[c] != 0 || closed_basin_cell[c] != 0 {
                continue;
            }
            let bi = basin_id[c];
            if bi < 0 && climate.pet_mm[c] > climate.precip_mm[c] && discharge_m3s[c] > 0.0 {
                let ai = climate.aridity_index[c] as f64;
                let infil = 1.0 + 1.8 * ((0.22 - ai).max(0.0) / 0.22);
                let deficit_m_yr = (climate.pet_mm[c] - climate.precip_mm[c]) as f64 * 1e-3;
                let w_eff_m = 25.0 * (discharge_m3s[c] as f64).powf(0.45) * 10.0 * infil;
                let raw_loss = (w_eff_m * step_m[c] * deficit_m_yr) / SECONDS_PER_YEAR;
                let max_frac = if ai < 0.15 { 0.26 } else { 0.18 };
                let loss = raw_loss.min(discharge_m3s[c] as f64 * max_frac) as f32;
                discharge_m3s[c] = (discharge_m3s[c] - loss).max(0.0);
                water_loss_m3s[c] = loss;
            }
            let r = receiver[c];
            if r >= 0 {
                let ru = r as usize;
                let mut out_q = discharge_m3s[c];
                if bi >= 0 && basin_id[ru] != bi {
                    let scale = open_lake_scale[bi as usize];
                    let evap_loss = (out_q as f64 * (1.0 - scale)).max(0.0) as f32;
                    water_loss_m3s[c] += evap_loss;
                    out_q = (out_q as f64 * scale) as f32;
                }
                discharge_m3s[ru] += out_q;
            }
        }
    }

    // 4b. Сезонный сток (январь/июль) со снеготаянием, таянием ледников и аридными потерями
    let mut runoff_jan = vec![0.0f32; n];
    let mut runoff_jul = vec![0.0f32; n];
    for i in 0..n {
        if is_ocean[i] != 0 {
            continue;
        }
        let t_jan = climate.temp_jan_c[i] as f64;
        let t_jul = climate.temp_jul_c[i] as f64;
        let liq_jan = ((t_jan + 2.0) / 4.0).clamp(0.08, 1.0);
        let liq_jul = ((t_jul + 2.0) / 4.0).clamp(0.08, 1.0);
        let p_jan = (climate.precip_jan_mm[i] as f64).max(0.0);
        let p_jul = (climate.precip_jul_mm[i] as f64).max(0.0);
        let snow_jan = p_jan * (1.0 - liq_jan);
        let snow_jul = p_jul * (1.0 - liq_jul);
        let melt_jul = (t_jul / 6.0).clamp(0.0, 1.0);
        let melt_jan = (t_jan / 6.0).clamp(0.0, 1.0);
        let glac = climate.glacier[i] as f64;
        let glac_jan = if glac > 0.02 && t_jan > t_jul {
            glac * ((t_jan + 2.0) / 8.0).clamp(0.0, 1.0) * 280.0
        } else {
            0.0
        };
        let glac_jul = if glac > 0.02 && t_jul >= t_jan {
            glac * ((t_jul + 2.0) / 8.0).clamp(0.0, 1.0) * 280.0
        } else {
            0.0
        };
        let eff_jan = (p_jan * liq_jan + snow_jul * melt_jan + glac_jan).max(0.0);
        let eff_jul = (p_jul * liq_jul + snow_jan * melt_jul + glac_jul).max(0.0);
        let eff_mean = 0.5 * (eff_jan + eff_jul);
        if eff_mean > 1e-6 {
            runoff_jan[i] = runoff_m3s[i] * (eff_jan / eff_mean).clamp(0.02, 2.4) as f32;
            runoff_jul[i] = runoff_m3s[i] * (eff_jul / eff_mean).clamp(0.02, 2.4) as f32;
        } else {
            runoff_jan[i] = runoff_m3s[i];
            runoff_jul[i] = runoff_m3s[i];
        }
    }

    let mut discharge_jan_m3s = runoff_jan;
    let mut discharge_jul_m3s = runoff_jul;
    let seasonal_trans_loss = |q: f32, temp_c: f32, precip_mm: f32, ai: f64, step: f64| -> f32 {
        if q <= 0.0 {
            return 0.0;
        }
        let pet = (58.93 * (temp_c as f64).clamp(0.0, 30.0)).max(40.0);
        let deficit_m_yr = (pet - (precip_mm as f64).max(0.0)).max(0.0) * 1e-3;
        if deficit_m_yr <= 0.0 {
            return q;
        }
        let infil = 1.0 + 1.8 * ((0.22 - ai).max(0.0) / 0.22);
        let w_eff_m = 25.0 * (q as f64).powf(0.45) * 10.0 * infil;
        let raw_loss = (w_eff_m * step * deficit_m_yr) / SECONDS_PER_YEAR;
        let max_frac = if ai < 0.15 { 0.28 } else { 0.20 };
        let loss = raw_loss.min((q as f64) * max_frac) as f32;
        (q - loss).max(0.0)
    };

    for &c in order.iter().rev() {
        if is_ocean[c] != 0 || closed_basin_cell[c] != 0 {
            continue;
        }
        let bi = basin_id[c];
        if bi < 0 && step_m[c] > 0.0 {
            let ai = climate.aridity_index[c] as f64;
            if ai < 0.45 || water_loss_m3s[c] > 0.0 {
                discharge_jan_m3s[c] = seasonal_trans_loss(
                    discharge_jan_m3s[c],
                    climate.temp_jan_c[c],
                    climate.precip_jan_mm[c],
                    ai,
                    step_m[c],
                );
                discharge_jul_m3s[c] = seasonal_trans_loss(
                    discharge_jul_m3s[c],
                    climate.temp_jul_c[c],
                    climate.precip_jul_mm[c],
                    ai,
                    step_m[c],
                );
            }
        }
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            let mut out_jan = discharge_jan_m3s[c];
            let mut out_jul = discharge_jul_m3s[c];
            if bi >= 0 && basin_id[ru] != bi {
                let scale = open_lake_scale[bi as usize];
                out_jan = ((0.35 * discharge_m3s[c] as f64 + 0.65 * out_jan as f64) * scale) as f32;
                out_jul = ((0.35 * discharge_m3s[c] as f64 + 0.65 * out_jul as f64) * scale) as f32;
            }
            discharge_jan_m3s[ru] += out_jan;
            discharge_jul_m3s[ru] += out_jul;
        }
    }

    let mut flow_seasonality = vec![0.0f32; n];
    for i in 0..n {
        if is_ocean[i] == 0 {
            let qj = discharge_jan_m3s[i];
            let ql = discharge_jul_m3s[i];
            flow_seasonality[i] = ((ql - qj).abs() / (ql + qj + 1e-3)).clamp(0.0, 1.0);
        }
    }

    // 5. Речная сеть, порядок Стрелера и дерево "главный ствол + притоки"
    let river_threshold_m3s = (4200.0 * (180.0 / w as f32).min(1.0).powf(0.65)).clamp(1500.0, 4200.0);
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
                && closed_basin_cell[ru] == 0
                && discharge_m3s[ru] >= 0.35 * river_threshold_m3s
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

    // Вычисляем расход в конечном устье и длину до устья для сортировки истоков: сперва трассируется главный ствол
    let mut term_q = vec![0.0f32; n];
    let mut dist_to_mouth_km = vec![0.0f32; n];
    for &c in &order {
        if river_mask[c] == 0 {
            continue;
        }
        let r = receiver[c];
        if r >= 0 {
            let ru = r as usize;
            let (cx, cy) = (c % w, c / w);
            let (rx, ry) = (ru % w, ru / w);
            let step_dx = if rx != cx { dx_row[cy] } else { 0.0 };
            let step_dy = if ry != cy { dy_km } else { 0.0 };
            let step_len = step_dx.hypot(step_dy);
            if river_mask[ru] != 0 {
                term_q[c] = term_q[ru];
                dist_to_mouth_km[c] = dist_to_mouth_km[ru] + step_len;
            } else {
                term_q[c] = discharge_m3s[c];
                dist_to_mouth_km[c] = step_len;
            }
        } else {
            term_q[c] = discharge_m3s[c];
            dist_to_mouth_km[c] = 0.0;
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
            .then_with(|| dist_to_mouth_km[b].total_cmp(&dist_to_mouth_km[a]))
            .then_with(|| discharge_m3s[b].total_cmp(&discharge_m3s[a]))
            .then(a.cmp(&b))
    });

    let slope = slope_field(rel_height_km, grid);

    // 5b. Пересыхающие русла (вади) и предгорные/инфильтрационные оазисы
    let mut is_wadi = vec![0u8; n];
    let mut oasis_cands: Vec<(usize, f32)> = Vec::new();
    for i in 0..n {
        if is_ocean[i] != 0 || is_lake[i] != 0 || is_salt_flat[i] != 0 {
            continue;
        }
        let ai = climate.aridity_index[i];
        let q_peak = discharge_jan_m3s[i].max(discharge_jul_m3s[i]);
        if river_mask[i] == 0
            && ai < 0.34
            && q_peak >= 0.22 * river_threshold_m3s
            && (flow_seasonality[i] >= 0.25 || water_loss_m3s[i] > 0.0)
        {
            is_wadi[i] = 1;
        }
        if ai < 0.28 && climate.temp_c[i] > 5.0 && rel_height_km[i] < 1.6 {
            let trig_infil = (water_loss_m3s[i] > 0.0 || is_wadi[i] != 0)
                && discharge_m3s[i].max(q_peak) >= 120.0
                && river_mask[i] == 0;
            let mut trig_piedmont = false;
            if !trig_infil && discharge_m3s[i] >= 40.0 && slope[i] < 0.035 {
                let (nbs8, cnt8) = grid.neighbors8(i);
                for &nb in &nbs8[..cnt8] {
                    if rel_height_km[nb] > rel_height_km[i] + 0.35
                        && (climate.snow_frac[nb] > 0.15
                            || climate.precip_mm[nb] > climate.precip_mm[i] * 1.45)
                    {
                        trig_piedmont = true;
                        break;
                    }
                }
            }
            if trig_infil || trig_piedmont {
                let score = discharge_m3s[i]
                    + 2.0 * water_loss_m3s[i]
                    + if trig_piedmont { 150.0 } else { 0.0 };
                oasis_cands.push((i, score));
            }
        }
    }
    oasis_cands.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
    let mut is_oasis = vec![0u8; n];
    for (i, _) in oasis_cands {
        let (nbs8, cnt8) = grid.neighbors8(i);
        if nbs8[..cnt8].iter().any(|&nb| is_oasis[nb] != 0) {
            continue;
        }
        is_oasis[i] = 1;
    }

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
            if river_mask[ru] == 0 {
                cells.push(ru);
                mouth = MouthKind::Endorheic;
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
            sum_snow += climate.snow_frac[c];
        }
        let mean_snow = sum_snow / rr.cells.len().max(1) as f32;
        let q_hi = max_q_jan.max(max_q_jul);
        let q_lo = max_q_jan.min(max_q_jul);
        let seasonality = ((q_hi - q_lo) / (q_hi + q_lo + 1e-3)).clamp(0.0, 1.0);
        let regime = if matches!(rr.mouth, MouthKind::Endorheic) && q_lo < 0.35 * q_hi {
            FlowRegime::EphemeralWadi
        } else if mean_snow > 0.22 && seasonality > 0.22 {
            FlowRegime::Snowmelt
        } else if seasonality > 0.28 {
            FlowRegime::SeasonalMonsoon
        } else {
            FlowRegime::Perennial
        };
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
            starts_from_lake,
            true,
        );
        rivers.push(River {
            id: rr.id,
            order: rr.order,
            length_km: rr.length_km,
            max_discharge_m3s: rr.max_discharge_m3s,
            discharge_jan_m3s: max_q_jan,
            discharge_jul_m3s: max_q_jul,
            regime,
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
            let mut max_glac = climate.glacier[i];
            let (nbs8, cnt8) = grid.neighbors8(i);
            for &nb in &nbs8[..cnt8] {
                max_glac = max_glac.max(climate.glacier[nb]);
            }
            let cold_snow = climate.snow_frac[i] > 0.45
                && climate.temp_jan_c[i].min(climate.temp_jul_c[i]) < -6.0;
            coast_type[i] = if (max_glac > 0.05 || cold_snow)
                && (rel_height_km[i] > 0.30 || slope[i] > 0.022)
            {
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

    let mut is_endorheic_lake = vec![0u8; n];
    for i in 0..n {
        if is_lake[i] != 0 && closed_basin_cell[i] != 0 {
            is_endorheic_lake[i] = 1;
        }
    }

    Hydrology {
        is_ocean,
        is_lake,
        is_endorheic_lake,
        is_salt_flat,
        is_wadi,
        is_oasis,
        lake_surface_km,
        filled_km,
        receiver,
        discharge_m3s,
        discharge_jan_m3s,
        discharge_jul_m3s,
        flow_seasonality,
        river_mask,
        river_order,
        coast_type,
        water_loss_m3s,
        rivers,
    }
}
