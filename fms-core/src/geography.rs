//! Геоморфологическая сегментация планеты: материки и острова, окраинные моря и проливы,
//! озёра (с генезисом и солёностью), горные хребты и естественные перевалы.

use crate::climate::Climate;
use crate::erosion::ErosionResult;
use crate::grid::{blur_xwrap, slope_field, Grid};
use crate::hydrology::Hydrology;
use crate::tectonic::World;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LandmassKind {
    Continent,
    LargeIsland,
    Island,
}

#[derive(Clone, Debug)]
pub struct Landmass {
    pub id: u32,
    pub kind: LandmassKind,
    pub area_km2: f64,
    pub cell_count: usize,
    pub max_elevation_km: f32,
    pub peak_cell: usize,
    pub center_lat_deg: f32,
    pub center_lon_deg: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum MarineZone {
    Land = 0,
    OpenOcean = 1,
    MarginalSea = 2,
    Strait = 3,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum LakeOrigin {
    /// Рифтовое тектоническое озеро (аналог Байкала, Танганьики).
    TectonicRift,
    /// Ледниковое или подпрудно-моренное озеро (Ладожское, Великие озёра, альпийские).
    Glacial,
    /// Вулканическое / кальдерное озеро.
    Volcanic,
    /// Бессточное остаточное солёное море-озеро (Каспий, Арал, Мёртвое море).
    EndorheicBasin,
    /// Пойменно-аллювиальное озеро низин.
    Floodplain,
    /// Межгорная или платформенная котловина.
    TectonicBasin,
}

#[derive(Clone, Debug)]
pub struct Lake {
    pub id: u32,
    pub origin: LakeOrigin,
    pub is_saline: bool,
    pub area_km2: f64,
    pub surface_km: f32,
    pub max_depth_km: f32,
    pub inflow_m3s: f32,
    pub center_cell: usize,
}

#[derive(Clone, Debug)]
pub struct MountainRange {
    pub id: u32,
    pub area_km2: f64,
    pub max_elevation_km: f32,
    pub peak_cell: usize,
    pub is_young_alpine: bool,
}

#[derive(Clone, Debug)]
pub struct MountainPass {
    pub cell: usize,
    pub elevation_km: f32,
    pub range_id: u32,
    /// Превышение соседних гребней над седловиной перевала, км.
    pub prominence_drop_km: f32,
}

/// Выделенные географические объекты и индексные карты мира.
#[derive(Clone, Debug)]
pub struct Geography {
    pub landmass_id: Vec<i32>,
    pub lake_id: Vec<i32>,
    pub range_id: Vec<i32>,
    pub marine_zone: Vec<MarineZone>,
    pub landmasses: Vec<Landmass>,
    pub lakes: Vec<Lake>,
    pub mountain_ranges: Vec<MountainRange>,
    pub passes: Vec<MountainPass>,
}

/// Выделяет материки, острова, моря, проливы, озёра, горные хребты и перевалы.
pub fn analyze(
    grid: &Grid,
    world: &World,
    erosion: &ErosionResult,
    climate: &Climate,
    hydrology: &Hydrology,
) -> Geography {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    let area_row: Vec<f64> = (0..h).map(|y| grid.cell_area_km2(y)).collect();
    let slope = slope_field(&erosion.elevation_km, grid);
    let mut stack = Vec::with_capacity(n / 8 + 32);

    // 1. Массивы суши (материки и острова)
    let mut raw_lm = vec![-1i32; n];
    struct RawLm {
        cells: Vec<usize>,
        area_km2: f64,
        max_elev: f32,
        peak_cell: usize,
        vx: f64,
        vy: f64,
        vz: f64,
    }
    let mut lms = Vec::new();
    for s0 in 0..n {
        if hydrology.is_ocean[s0] != 0 || raw_lm[s0] >= 0 {
            continue;
        }
        let cid = lms.len() as i32;
        raw_lm[s0] = cid;
        stack.push(s0);
        let mut cells = Vec::new();
        let mut area_km2 = 0.0f64;
        let mut max_elev = f32::NEG_INFINITY;
        let mut peak_cell = s0;
        let (mut vx, mut vy, mut vz) = (0.0f64, 0.0f64, 0.0f64);

        while let Some(c) = stack.pop() {
            cells.push(c);
            let (cx, cy) = (c % w, c / w);
            let a = area_row[cy];
            area_km2 += a;
            let e = erosion.elevation_km[c];
            if e > max_elev {
                max_elev = e;
                peak_cell = c;
            }
            let u = grid.unit_vec(cx, cy);
            vx += u[0] * a;
            vy += u[1] * a;
            vz += u[2] * a;

            let (nbs, cnt) = grid.neighbors8(c);
            for &nb in &nbs[..cnt] {
                if hydrology.is_ocean[nb] == 0 && raw_lm[nb] < 0 {
                    raw_lm[nb] = cid;
                    stack.push(nb);
                }
            }
        }
        lms.push(RawLm {
            cells,
            area_km2,
            max_elev,
            peak_cell,
            vx,
            vy,
            vz,
        });
    }

    lms.sort_by(|a, b| b.area_km2.total_cmp(&a.area_km2));
    let mut landmass_id = vec![-1i32; n];
    let mut landmasses = Vec::with_capacity(lms.len());
    for (idx, lm) in lms.into_iter().enumerate() {
        let id = idx as u32;
        for &c in &lm.cells {
            landmass_id[c] = id as i32;
        }
        let kind = if lm.area_km2 >= 900_000.0 || (idx == 0 && lm.area_km2 >= 200_000.0) {
            LandmassKind::Continent
        } else if lm.area_km2 >= 25_000.0 {
            LandmassKind::LargeIsland
        } else {
            LandmassKind::Island
        };
        let vlen = (lm.vx * lm.vx + lm.vy * lm.vy + lm.vz * lm.vz)
            .sqrt()
            .max(1e-9);
        let lat_deg = (lm.vz / vlen).clamp(-1.0, 1.0).asin().to_degrees() as f32;
        let lon_deg = lm.vy.atan2(lm.vx).to_degrees() as f32;
        landmasses.push(Landmass {
            id,
            kind,
            area_km2: lm.area_km2,
            cell_count: lm.cells.len(),
            max_elevation_km: lm.max_elev.max(0.0),
            peak_cell: lm.peak_cell,
            center_lat_deg: lat_deg,
            center_lon_deg: lon_deg,
        });
    }

    // 2. Морские зоны: открытый океан, окраинные/внутренние моря и проливы
    let mut land_frac = vec![0.0f32; n];
    for i in 0..n {
        if hydrology.is_ocean[i] == 0 {
            land_frac[i] = 1.0;
        }
    }
    let r_sea = ((w as f64 / 45.0).round() as usize).max(2);
    blur_xwrap(&mut land_frac, w, h, r_sea);

    let mut marine_zone = vec![MarineZone::Land; n];
    for y in 0..h {
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if hydrology.is_ocean[i] == 0 {
                marine_zone[i] = MarineZone::Land;
                continue;
            }
            let xl = grid.wrap_x(x as isize - 1);
            let xr = grid.wrap_x(x as isize + 1);
            let xl2 = grid.wrap_x(x as isize - 2);
            let xr2 = grid.wrap_x(x as isize + 2);

            let land_w = hydrology.is_ocean[row + xl] == 0 || hydrology.is_ocean[row + xl2] == 0;
            let land_e = hydrology.is_ocean[row + xr] == 0 || hydrology.is_ocean[row + xr2] == 0;
            let pinch_ew = (hydrology.is_ocean[row + xl] == 0 && hydrology.is_ocean[row + xr] == 0)
                || (land_w
                    && land_e
                    && (hydrology.is_ocean[row + xl] == 0 || hydrology.is_ocean[row + xr] == 0));

            let pinch_ns = if y >= 1 && y + 1 < h {
                let n0 = hydrology.is_ocean[(y - 1) * w + x] == 0;
                let s0 = hydrology.is_ocean[(y + 1) * w + x] == 0;
                let n1 = y >= 2 && hydrology.is_ocean[(y - 2) * w + x] == 0;
                let s1 = y + 2 < h && hydrology.is_ocean[(y + 2) * w + x] == 0;
                (n0 && s0) || ((n0 || n1) && (s0 || s1) && (n0 || s0))
            } else {
                false
            };

            let pinch_diag = if y >= 1 && y + 1 < h {
                (hydrology.is_ocean[(y - 1) * w + xl] == 0
                    && hydrology.is_ocean[(y + 1) * w + xr] == 0)
                    || (hydrology.is_ocean[(y - 1) * w + xr] == 0
                        && hydrology.is_ocean[(y + 1) * w + xl] == 0)
            } else {
                false
            };

            marine_zone[i] = if pinch_ew || pinch_ns || pinch_diag {
                MarineZone::Strait
            } else if erosion.elevation_km[i] > -2.2 && land_frac[i] > 0.34 {
                MarineZone::MarginalSea
            } else {
                MarineZone::OpenOcean
            };
        }
    }

    // 3. Озёра как географические объекты с генезисом и солёностью
    struct RawLake {
        cells: Vec<usize>,
        area_km2: f64,
        surface_km: f32,
        max_depth_km: f32,
        is_saline: bool,
        origin: LakeOrigin,
        center_cell: usize,
    }
    let mut raw_lk = vec![-1i32; n];
    let mut lks = Vec::new();
    for s0 in 0..n {
        if hydrology.is_lake[s0] == 0 || raw_lk[s0] >= 0 {
            continue;
        }
        let cid = lks.len() as i32;
        raw_lk[s0] = cid;
        stack.push(s0);
        let mut cells = Vec::new();
        let mut area_km2 = 0.0f64;
        let mut surface_km = f32::NEG_INFINITY;
        let mut max_depth = 0.0f32;
        let mut deepest_cell = s0;
        let mut is_saline = false;
        let mut max_rift = 0.0f32;
        let mut max_glac = 0.0f32;
        let mut max_gcarve = 0.0f32;
        let mut max_volc = 0.0f32;
        let mut sum_alluv = 0.0f64;

        while let Some(c) = stack.pop() {
            cells.push(c);
            let cy = c / w;
            area_km2 += area_row[cy];
            surface_km = surface_km.max(hydrology.lake_surface_km[c]);
            let dep = (hydrology.lake_surface_km[c] - erosion.elevation_km[c]).max(0.0);
            if dep > max_depth {
                max_depth = dep;
                deepest_cell = c;
            }
            if hydrology.is_endorheic_lake[c] != 0 {
                is_saline = true;
            }
            max_rift = max_rift.max(world.rift[c]);
            max_glac = max_glac.max(climate.glacier[c]);
            max_gcarve = max_gcarve.max(erosion.glacial_carve_km[c]);
            max_volc = max_volc.max(world.volcanic[c]);
            sum_alluv += erosion.alluvium_km[c] as f64;

            let (nbs, cnt) = grid.neighbors8(c);
            for &nb in &nbs[..cnt] {
                if hydrology.is_lake[nb] != 0 && raw_lk[nb] < 0 {
                    raw_lk[nb] = cid;
                    stack.push(nb);
                }
            }
        }
        let mean_alluv = sum_alluv / cells.len() as f64;
        let origin = if max_rift > 0.22 {
            LakeOrigin::TectonicRift
        } else if max_glac > 0.08 || max_gcarve > 0.02 {
            LakeOrigin::Glacial
        } else if max_volc > 0.32 && area_km2 < 80_000.0 {
            LakeOrigin::Volcanic
        } else if is_saline {
            LakeOrigin::EndorheicBasin
        } else if mean_alluv > 0.025 {
            LakeOrigin::Floodplain
        } else {
            LakeOrigin::TectonicBasin
        };

        lks.push(RawLake {
            cells,
            area_km2,
            surface_km,
            max_depth_km: max_depth,
            is_saline,
            origin,
            center_cell: deepest_cell,
        });
    }

    lks.sort_by(|a, b| b.area_km2.total_cmp(&a.area_km2));
    let mut lake_id = vec![-1i32; n];
    let mut lakes = Vec::with_capacity(lks.len());
    for (idx, lk) in lks.into_iter().enumerate() {
        let id = idx as u32;
        for &c in &lk.cells {
            lake_id[c] = id as i32;
        }
        lakes.push(Lake {
            id,
            origin: lk.origin,
            is_saline: lk.is_saline,
            area_km2: lk.area_km2,
            surface_km: lk.surface_km,
            max_depth_km: lk.max_depth_km,
            inflow_m3s: 0.0,
            center_cell: lk.center_cell,
        });
    }
    for i in 0..n {
        let r = hydrology.receiver[i];
        if r >= 0 {
            let lr = lake_id[r as usize];
            if lr >= 0 && lake_id[i] != lr {
                lakes[lr as usize].inflow_m3s += hydrology.discharge_m3s[i];
            }
        }
    }

    // 4. Горные системы и седловины перевалов
    let mut is_mtn = vec![0u8; n];
    for i in 0..n {
        if hydrology.is_ocean[i] == 0
            && hydrology.is_lake[i] == 0
            && (erosion.elevation_km[i] >= 1.30
                || (erosion.elevation_km[i] >= 0.90 && slope[i] >= 0.018))
        {
            is_mtn[i] = 1;
        }
    }

    struct RawRange {
        cells: Vec<usize>,
        area_km2: f64,
        max_elev: f32,
        peak_cell: usize,
        young_cnt: usize,
    }
    let mut raw_rg = vec![-1i32; n];
    let mut rgs = Vec::new();
    let t_now = world.stats.time;
    for s0 in 0..n {
        if is_mtn[s0] == 0 || raw_rg[s0] >= 0 {
            continue;
        }
        let cid = rgs.len() as i32;
        raw_rg[s0] = cid;
        stack.push(s0);
        let mut cells = Vec::new();
        let mut area_km2 = 0.0f64;
        let mut max_elev = f32::NEG_INFINITY;
        let mut peak_cell = s0;
        let mut young_cnt = 0usize;

        while let Some(c) = stack.pop() {
            cells.push(c);
            area_km2 += area_row[c / w];
            let e = erosion.elevation_km[c];
            if e > max_elev {
                max_elev = e;
                peak_cell = c;
            }
            if world.t_oro_myr[c] >= 0.0 && (t_now - world.t_oro_myr[c] as f64) < 350.0 {
                young_cnt += 1;
            }
            let (nbs, cnt) = grid.neighbors8(c);
            for &nb in &nbs[..cnt] {
                if is_mtn[nb] != 0 && raw_rg[nb] < 0 {
                    raw_rg[nb] = cid;
                    stack.push(nb);
                }
            }
        }
        if area_km2 >= 12_000.0 || cells.len() >= 2 {
            rgs.push(RawRange {
                cells,
                area_km2,
                max_elev,
                peak_cell,
                young_cnt,
            });
        }
    }

    rgs.sort_by(|a, b| b.area_km2.total_cmp(&a.area_km2));
    let mut range_id = vec![-1i32; n];
    let mut mountain_ranges = Vec::with_capacity(rgs.len());
    for (idx, rg) in rgs.into_iter().enumerate() {
        let id = idx as u32;
        for &c in &rg.cells {
            range_id[c] = id as i32;
        }
        let is_young_alpine = rg.young_cnt * 3 >= rg.cells.len() || rg.max_elev > 3.2;
        mountain_ranges.push(MountainRange {
            id,
            area_km2: rg.area_km2,
            max_elevation_km: rg.max_elev,
            peak_cell: rg.peak_cell,
            is_young_alpine,
        });
    }

    // Топографические седловины (горные перевалы): подъём вдоль оси хребта и спуск в две долины поперёк
    let mut cand_passes: Vec<MountainPass> = Vec::new();
    let sample_max = |x: isize, y: isize, dx: isize, dy: isize| -> f32 {
        let mut best = f32::NEG_INFINITY;
        for step in 1..=2 {
            let yy = (y + dy * step).clamp(0, h as isize - 1) as usize;
            let xx = grid.wrap_x(x + dx * step);
            best = best.max(erosion.elevation_km[yy * w + xx]);
        }
        best
    };
    let sample_min = |x: isize, y: isize, dx: isize, dy: isize| -> f32 {
        let mut best = f32::INFINITY;
        for step in 1..=2 {
            let yy = (y + dy * step).clamp(0, h as isize - 1) as usize;
            let xx = grid.wrap_x(x + dx * step);
            best = best.min(erosion.elevation_km[yy * w + xx]);
        }
        best
    };

    const AXES: [(isize, isize, isize, isize); 4] = [
        (1, 0, 0, 1),
        (0, 1, 1, 0),
        (1, 1, 1, -1),
        (1, -1, 1, 1),
    ];

    for y in 2..(h.saturating_sub(2)) {
        for x in 0..w {
            let i = y * w + x;
            if hydrology.is_ocean[i] != 0 || hydrology.is_lake[i] != 0 {
                continue;
            }
            let e = erosion.elevation_km[i];
            if !(0.45..=3.80).contains(&e) {
                continue;
            }
            let mut rid = range_id[i];
            if rid < 0 {
                let (nbs, cnt) = grid.neighbors8(i);
                for &nb in &nbs[..cnt] {
                    if range_id[nb] >= 0 {
                        rid = range_id[nb];
                        break;
                    }
                }
            }
            if rid < 0 {
                continue;
            }

            let (xi, yi) = (x as isize, y as isize);
            let mut best_prom = 0.0f32;
            for &(ax, ay, bx, by) in &AXES {
                let ridge_a = sample_max(xi, yi, ax, ay);
                let ridge_b = sample_max(xi, yi, -ax, -ay);
                let val_a = sample_min(xi, yi, bx, by);
                let val_b = sample_min(xi, yi, -bx, -by);
                let rise = ridge_a.min(ridge_b) - e;
                let drop = e - val_a.max(val_b);
                if rise >= 0.22 && drop >= 0.12 {
                    best_prom = best_prom.max(rise);
                }
            }
            if best_prom > 0.0 {
                cand_passes.push(MountainPass {
                    cell: i,
                    elevation_km: e,
                    range_id: rid as u32,
                    prominence_drop_km: best_prom,
                });
            }
        }
    }

    cand_passes.sort_by(|a, b| {
        b.prominence_drop_km
            .total_cmp(&a.prominence_drop_km)
            .then_with(|| a.elevation_km.total_cmp(&b.elevation_km))
    });

    let mut passes: Vec<MountainPass> = Vec::new();
    let min_pass_sep_km = 240.0;
    for p in cand_passes {
        let (px, py) = grid.xy(p.cell);
        let up = grid.unit_vec(px, py);
        let too_close = passes.iter().any(|q| {
            let (qx, qy) = grid.xy(q.cell);
            grid.spherical_dist_km(up, grid.unit_vec(qx, qy)) < min_pass_sep_km
        });
        if !too_close {
            passes.push(p);
        }
    }

    Geography {
        landmass_id,
        lake_id,
        range_id,
        marine_zone,
        landmasses,
        lakes,
        mountain_ranges,
        passes,
    }
}
