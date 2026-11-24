//! Геоморфологическая сегментация планеты: материки, острова и архипелаги, окраинные моря,
//! заливы, проливы и перешейки, озёра (со связями рек), горные хребты, перевалы и природные регионы.

use crate::biomes::{Biome, Biomes};
use crate::climate::Climate;
use crate::erosion::ErosionResult;
use crate::grid::{blur_xwrap, slope_field, Grid};
use crate::hydrology::{Hydrology, MouthKind};
use crate::tectonic::World;
use std::collections::BTreeMap;
use std::f64::consts::PI;

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
    Bay = 4,
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
    pub inflow_river_ids: Vec<u32>,
    pub outflow_river_id: Option<u32>,
}

#[derive(Clone, Debug)]
pub struct Bay {
    pub id: u32,
    pub area_km2: f64,
    pub max_depth_km: f32,
    pub center_cell: usize,
    pub landmass_id: i32,
}

#[derive(Clone, Debug)]
pub struct Isthmus {
    pub id: u32,
    pub cell: usize,
    pub landmass_id: u32,
    pub width_km: f32,
    pub elevation_km: f32,
}

#[derive(Clone, Debug)]
pub struct Archipelago {
    pub id: u32,
    pub island_ids: Vec<u32>,
    pub total_area_km2: f64,
    pub center_lat_deg: f32,
    pub center_lon_deg: f32,
    pub is_volcanic_arc: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RegionKind {
    Desert,
    Steppe,
    Rainforest,
    Forest,
    Tundra,
    Plateau,
    Lowland,
    WetlandBasin,
    Highlands,
}

impl RegionKind {
    pub fn name(self) -> &'static str {
        match self {
            RegionKind::Desert => "Пустыня",
            RegionKind::Steppe => "Степь",
            RegionKind::Rainforest => "Сельва",
            RegionKind::Forest => "Лесной край",
            RegionKind::Tundra => "Тундра",
            RegionKind::Plateau => "Плато",
            RegionKind::Lowland => "Низменность",
            RegionKind::WetlandBasin => "Плавни",
            RegionKind::Highlands => "Нагорье",
        }
    }
}

#[derive(Clone, Debug)]
pub struct NaturalRegion {
    pub id: u32,
    pub kind: RegionKind,
    pub landmass_id: i32,
    pub area_km2: f64,
    pub mean_elevation_km: f32,
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
    pub region_id: Vec<i32>,
    pub marine_zone: Vec<MarineZone>,
    pub landmasses: Vec<Landmass>,
    pub archipelagos: Vec<Archipelago>,
    pub bays: Vec<Bay>,
    pub isthmuses: Vec<Isthmus>,
    pub lakes: Vec<Lake>,
    pub mountain_ranges: Vec<MountainRange>,
    pub passes: Vec<MountainPass>,
    pub natural_regions: Vec<NaturalRegion>,
}

/// Выделяет материки, острова, архипелаги, моря, заливы, проливы, перешейки, озёра, хребты, перевалы и регионы.
pub fn analyze(
    grid: &Grid,
    world: &World,
    erosion: &ErosionResult,
    climate: &Climate,
    hydrology: &Hydrology,
    biomes: &Biomes,
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

            let (nbs8, cnt8) = grid.neighbors8(i);
            let land_nbs8 = nbs8[..cnt8]
                .iter()
                .filter(|&&nb| hydrology.is_ocean[nb] == 0)
                .count();

            marine_zone[i] = if pinch_ew || pinch_ns || pinch_diag {
                MarineZone::Strait
            } else if erosion.elevation_km[i] > -1.8
                && (land_nbs8 >= 5 || (land_nbs8 >= 3 && land_frac[i] > 0.46))
            {
                MarineZone::Bay
            } else if erosion.elevation_km[i] > -2.2 && land_frac[i] > 0.34 {
                MarineZone::MarginalSea
            } else {
                MarineZone::OpenOcean
            };
        }
    }

    // 2b. Заливы (связные вогнутые бухты и губы побережья)
    struct RawBay {
        area_km2: f64,
        max_depth_km: f32,
        center_cell: usize,
        landmass_id: i32,
    }
    let mut raw_bay_vis = vec![0u8; n];
    let mut raw_bays = Vec::new();
    for s0 in 0..n {
        if marine_zone[s0] != MarineZone::Bay || raw_bay_vis[s0] != 0 {
            continue;
        }
        raw_bay_vis[s0] = 1;
        stack.push(s0);
        let mut cells = Vec::new();
        let mut area_km2 = 0.0f64;
        let mut max_depth = 0.0f32;
        let mut max_land_nb = 0usize;
        let (mut vx, mut vy, mut vz) = (0.0f64, 0.0f64, 0.0f64);
        let mut adj_lm: BTreeMap<i32, usize> = BTreeMap::new();

        while let Some(c) = stack.pop() {
            cells.push(c);
            let (cx, cy) = (c % w, c / w);
            let a = area_row[cy];
            area_km2 += a;
            max_depth = max_depth.max((-erosion.elevation_km[c]).max(0.0));
            let u = grid.unit_vec(cx, cy);
            vx += u[0] * a;
            vy += u[1] * a;
            vz += u[2] * a;

            let (nbs, cnt) = grid.neighbors8(c);
            let mut lnb = 0usize;
            for &nb in &nbs[..cnt] {
                let lid = landmass_id[nb];
                if lid >= 0 {
                    lnb += 1;
                    *adj_lm.entry(lid).or_insert(0) += 1;
                } else if marine_zone[nb] == MarineZone::Bay && raw_bay_vis[nb] == 0 {
                    raw_bay_vis[nb] = 1;
                    stack.push(nb);
                }
            }
            max_land_nb = max_land_nb.max(lnb);
        }

        if cells.len() >= 2 || max_land_nb >= 5 {
            let vlen = (vx * vx + vy * vy + vz * vz).sqrt().max(1e-9);
            let target = [vx / vlen, vy / vlen, vz / vlen];
            let center_cell = *cells
                .iter()
                .max_by(|&&a, &&b| {
                    let (ax, ay) = grid.xy(a);
                    let (bx, by) = grid.xy(b);
                    let ua = grid.unit_vec(ax, ay);
                    let ub = grid.unit_vec(bx, by);
                    let da = ua[0] * target[0] + ua[1] * target[1] + ua[2] * target[2];
                    let db = ub[0] * target[0] + ub[1] * target[1] + ub[2] * target[2];
                    da.total_cmp(&db)
                })
                .unwrap();
            let lm_id = adj_lm
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map(|(k, _)| k)
                .unwrap_or(-1);
            raw_bays.push(RawBay {
                area_km2,
                max_depth_km: max_depth,
                center_cell,
                landmass_id: lm_id,
            });
        } else {
            for c in cells {
                marine_zone[c] = MarineZone::MarginalSea;
            }
        }
    }
    raw_bays.sort_by(|a, b| b.area_km2.total_cmp(&a.area_km2));
    let bays: Vec<Bay> = raw_bays
        .into_iter()
        .enumerate()
        .map(|(idx, b)| Bay {
            id: idx as u32,
            area_km2: b.area_km2,
            max_depth_km: b.max_depth_km,
            center_cell: b.center_cell,
            landmass_id: b.landmass_id,
        })
        .collect();

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
            inflow_river_ids: Vec::new(),
            outflow_river_id: None,
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
    let mut lake_feeder = vec![-1i32; n];
    let mut lake_feeder_q = vec![0.0f32; n];
    for i in 0..n {
        let li = lake_id[i];
        if li < 0 {
            continue;
        }
        let r = hydrology.receiver[i];
        if r >= 0 {
            let ru = r as usize;
            if lake_id[ru] < 0 && hydrology.is_ocean[ru] == 0 && hydrology.discharge_m3s[i] > lake_feeder_q[ru] {
                lake_feeder[ru] = li;
                lake_feeder_q[ru] = hydrology.discharge_m3s[i];
            }
        }
    }
    let mut best_out_q = vec![0.0f32; lakes.len()];
    for riv in &hydrology.rivers {
        if matches!(riv.mouth, MouthKind::Lake) {
            if let Some(&last) = riv.cells.last() {
                let lid = lake_id[last];
                if lid >= 0 {
                    lakes[lid as usize].inflow_river_ids.push(riv.id);
                }
            }
        }
        if let Some(&head) = riv.cells.first() {
            let lid = lake_feeder[head];
            if lid >= 0 {
                let lu = lid as usize;
                if riv.max_discharge_m3s > best_out_q[lu] {
                    best_out_q[lu] = riv.max_discharge_m3s;
                    lakes[lu].outflow_river_id = Some(riv.id);
                }
            }
        }
    }
    for riv in &hydrology.rivers {
        for &c in &riv.cells {
            let lid = lake_feeder[c];
            if lid >= 0 {
                let lu = lid as usize;
                if lakes[lu].outflow_river_id.is_none() && riv.max_discharge_m3s > best_out_q[lu] {
                    best_out_q[lu] = riv.max_discharge_m3s;
                    lakes[lu].outflow_river_id = Some(riv.id);
                }
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

    // 5. Перешейки (узкие полосы суши между морями, соединяющие два массива суши)
    let dy_km = grid.dy_km();
    let dx_row: Vec<f64> = (0..h).map(|y| grid.dx_km(y)).collect();
    let is_land_c = |xx: usize, yy: usize| -> bool { hydrology.is_ocean[yy * w + xx] == 0 };
    let is_oce_c = |xx: usize, yy: usize| -> bool { hydrology.is_ocean[yy * w + xx] != 0 };

    let mut cand_isth: Vec<(usize, u32, f32, f32)> = Vec::new();
    for y in 2..(h.saturating_sub(2)) {
        let dx_km = dx_row[y];
        for x in 0..w {
            let i = y * w + x;
            let lid = landmass_id[i];
            if lid < 0 || hydrology.is_lake[i] != 0 {
                continue;
            }
            if landmasses[lid as usize].cell_count < 12 {
                continue;
            }
            let xi = x as isize;
            let xl1 = grid.wrap_x(xi - 1);
            let xr1 = grid.wrap_x(xi + 1);
            let xl2 = grid.wrap_x(xi - 2);
            let xr2 = grid.wrap_x(xi + 2);

            let mut best_w = f32::INFINITY;
            // E/W океанское сужение, N/S суша
            let w_d = if is_oce_c(xl1, y) { 1 } else if is_oce_c(xl2, y) { 2 } else { 0 };
            let e_d = if is_oce_c(xr1, y) { 1 } else if is_oce_c(xr2, y) { 2 } else { 0 };
            if w_d > 0
                && e_d > 0
                && (w_d + e_d - 1) <= 3
                && is_land_c(x, y - 1)
                && is_land_c(x, y + 1)
                && is_land_c(x, y - 2)
                && is_land_c(x, y + 2)
            {
                best_w = best_w.min(((w_d + e_d - 1) as f64 * dx_km) as f32);
            }
            // N/S океанское сужение, E/W суша
            let n_d = if is_oce_c(x, y - 1) { 1 } else if is_oce_c(x, y - 2) { 2 } else { 0 };
            let s_d = if is_oce_c(x, y + 1) { 1 } else if is_oce_c(x, y + 2) { 2 } else { 0 };
            if n_d > 0
                && s_d > 0
                && (n_d + s_d - 1) <= 3
                && is_land_c(xl1, y)
                && is_land_c(xr1, y)
                && is_land_c(xl2, y)
                && is_land_c(xr2, y)
            {
                best_w = best_w.min(((n_d + s_d - 1) as f64 * dy_km) as f32);
            }
            // Диагональное сужение
            let nw_sw = is_oce_c(xl1, y - 1)
                && is_oce_c(xr1, y + 1)
                && is_land_c(xr1, y - 1)
                && is_land_c(xl1, y + 1);
            let ne_se = is_oce_c(xr1, y - 1)
                && is_oce_c(xl1, y + 1)
                && is_land_c(xl1, y - 1)
                && is_land_c(xr1, y + 1);
            if nw_sw || ne_se {
                best_w = best_w.min((dx_km.hypot(dy_km)) as f32);
            }

            if best_w.is_finite() {
                cand_isth.push((i, lid as u32, best_w, erosion.elevation_km[i]));
            }
        }
    }
    cand_isth.sort_by(|a, b| {
        a.2.total_cmp(&b.2)
            .then_with(|| a.3.total_cmp(&b.3))
            .then_with(|| a.0.cmp(&b.0))
    });
    let mut isthmuses: Vec<Isthmus> = Vec::new();
    for (cell, lm_id, width_km, elev_km) in cand_isth {
        let (cx, cy) = grid.xy(cell);
        let uc = grid.unit_vec(cx, cy);
        let too_close = isthmuses.iter().any(|q| {
            let (qx, qy) = grid.xy(q.cell);
            grid.spherical_dist_km(uc, grid.unit_vec(qx, qy)) < 260.0
        });
        if !too_close {
            isthmuses.push(Isthmus {
                id: isthmuses.len() as u32,
                cell,
                landmass_id: lm_id,
                width_km,
                elevation_km: elev_km,
            });
        }
    }

    // 6. Архипелаги (пространственные скопления островов и островных дуг)
    let mut max_volc_lm = vec![0.0f32; landmasses.len()];
    for i in 0..n {
        let lid = landmass_id[i];
        if lid >= 0 {
            let lu = lid as usize;
            max_volc_lm[lu] = max_volc_lm[lu].max(world.volcanic[i]);
        }
    }
    let isl_idx: Vec<usize> = landmasses
        .iter()
        .enumerate()
        .filter(|(_, l)| l.kind != LandmassKind::Continent)
        .map(|(idx, _)| idx)
        .collect();
    let m_isl = isl_idx.len();
    let mut isl_vecs = Vec::with_capacity(m_isl);
    let mut isl_rads = Vec::with_capacity(m_isl);
    for &li in &isl_idx {
        let l = &landmasses[li];
        let lat = (l.center_lat_deg as f64).to_radians();
        let lon = (l.center_lon_deg as f64).to_radians();
        let cl = lat.cos();
        isl_vecs.push([cl * lon.cos(), cl * lon.sin(), lat.sin()]);
        isl_rads.push((l.area_km2 / PI).sqrt());
    }
    let mut uf_p: Vec<usize> = (0..m_isl).collect();
    let uf_find = |p: &mut [usize], mut a: usize| -> usize {
        while p[a] != a {
            p[a] = p[p[a]];
            a = p[a];
        }
        a
    };
    let mut min_comp_edge = vec![f64::INFINITY; m_isl];
    for a in 0..m_isl {
        for b in (a + 1)..m_isl {
            let d_center = grid.spherical_dist_km(isl_vecs[a], isl_vecs[b]);
            let d_edge = (d_center - isl_rads[a] - isl_rads[b]).max(0.0);
            if d_center <= 680.0 && d_edge <= 450.0 {
                let ra = uf_find(&mut uf_p, a);
                let rb = uf_find(&mut uf_p, b);
                if ra != rb {
                    uf_p[rb] = ra;
                    min_comp_edge[ra] = min_comp_edge[ra].min(min_comp_edge[rb]).min(d_edge);
                } else {
                    min_comp_edge[ra] = min_comp_edge[ra].min(d_edge);
                }
            }
        }
    }
    let mut groups: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for a in 0..m_isl {
        let r = uf_find(&mut uf_p, a);
        groups.entry(r).or_default().push(isl_idx[a]);
    }
    let mut raw_arch = Vec::new();
    for (root, mut members) in groups {
        members.sort_unstable();
        let has_small = members
            .iter()
            .any(|&li| landmasses[li].kind == LandmassKind::Island);
        let keep = members.len() >= 3
            || (members.len() == 2 && min_comp_edge[root] <= 300.0 && has_small);
        if !keep {
            continue;
        }
        let mut tot_a = 0.0f64;
        let (mut ax, mut ay, mut az) = (0.0f64, 0.0f64, 0.0f64);
        let mut is_arc = false;
        for &li in &members {
            let l = &landmasses[li];
            tot_a += l.area_km2;
            let lat = (l.center_lat_deg as f64).to_radians();
            let lon = (l.center_lon_deg as f64).to_radians();
            let cl = lat.cos();
            ax += cl * lon.cos() * l.area_km2;
            ay += cl * lon.sin() * l.area_km2;
            az += lat.sin() * l.area_km2;
            if max_volc_lm[li] > 0.25 {
                is_arc = true;
            }
        }
        let al = (ax * ax + ay * ay + az * az).sqrt().max(1e-9);
        raw_arch.push(Archipelago {
            id: 0,
            island_ids: members.into_iter().map(|i| landmasses[i].id).collect(),
            total_area_km2: tot_a,
            center_lat_deg: (az / al).clamp(-1.0, 1.0).asin().to_degrees() as f32,
            center_lon_deg: ay.atan2(ax).to_degrees() as f32,
            is_volcanic_arc: is_arc,
        });
    }
    raw_arch.sort_by(|a, b| b.total_area_km2.total_cmp(&a.total_area_km2));
    for (idx, arch) in raw_arch.iter_mut().enumerate() {
        arch.id = idx as u32;
    }
    let archipelagos = raw_arch;

    // 7. Природные макрорегионы (пустыни, степи, сельва, леса, тундра, плато, низменности, нагорья)
    let mut cell_rkind: Vec<Option<RegionKind>> = vec![None; n];
    for i in 0..n {
        if hydrology.is_ocean[i] != 0 || hydrology.is_lake[i] != 0 {
            continue;
        }
        let b = biomes.biome[i];
        let e = erosion.elevation_km[i];
        let s = slope[i];
        let rk = match b {
            Biome::HotDesert | Biome::ColdDesert | Biome::SaltFlat => RegionKind::Desert,
            Biome::Wetland => RegionKind::WetlandBasin,
            Biome::IceSheet | Biome::PolarDesert | Biome::Tundra => RegionKind::Tundra,
            _ if e >= 1.10 && s < 0.016 => RegionKind::Plateau,
            _ if range_id[i] >= 0 || e >= 1.30 => RegionKind::Highlands,
            Biome::TemperateGrassland | Biome::TropicalSavanna => RegionKind::Steppe,
            Biome::TropicalRainforest
            | Biome::TemperateRainforest
            | Biome::TropicalSeasonalForest => RegionKind::Rainforest,
            _ if e < 0.35
                && s < 0.009
                && matches!(b, Biome::TemperateForest | Biome::Mediterranean) =>
            {
                RegionKind::Lowland
            }
            Biome::TemperateForest | Biome::BorealForest | Biome::Mediterranean => {
                RegionKind::Forest
            }
            _ => {
                if e < 0.45 {
                    RegionKind::Lowland
                } else {
                    RegionKind::Highlands
                }
            }
        };
        cell_rkind[i] = Some(rk);
    }

    struct RawReg {
        cells: Vec<usize>,
        kind: RegionKind,
        landmass_id: i32,
        area_km2: f64,
        mean_elev: f32,
        center_cell: usize,
    }
    let mut raw_reg_vis = vec![0u8; n];
    let mut raw_regs = Vec::new();
    for s0 in 0..n {
        let Some(kind) = cell_rkind[s0] else {
            continue;
        };
        if raw_reg_vis[s0] != 0 {
            continue;
        }
        raw_reg_vis[s0] = 1;
        stack.push(s0);
        let mut cells = Vec::new();
        let mut area_km2 = 0.0f64;
        let mut elev_sum = 0.0f64;
        let (mut vx, mut vy, mut vz) = (0.0f64, 0.0f64, 0.0f64);
        let mut lm_votes: BTreeMap<i32, usize> = BTreeMap::new();

        while let Some(c) = stack.pop() {
            cells.push(c);
            let (cx, cy) = grid.xy(c);
            let a = area_row[cy];
            area_km2 += a;
            elev_sum += erosion.elevation_km[c] as f64 * a;
            let u = grid.unit_vec(cx, cy);
            vx += u[0] * a;
            vy += u[1] * a;
            vz += u[2] * a;
            *lm_votes.entry(landmass_id[c]).or_insert(0) += 1;

            let (nbs, cnt) = grid.neighbors8(c);
            for &nb in &nbs[..cnt] {
                if raw_reg_vis[nb] == 0 && cell_rkind[nb] == Some(kind) {
                    raw_reg_vis[nb] = 1;
                    stack.push(nb);
                }
            }
        }
        if cells.len() >= 6 || area_km2 >= 90_000.0 {
            let vlen = (vx * vx + vy * vy + vz * vz).sqrt().max(1e-9);
            let target = [vx / vlen, vy / vlen, vz / vlen];
            let center_cell = *cells
                .iter()
                .max_by(|&&a, &&b| {
                    let (ax, ay) = grid.xy(a);
                    let (bx, by) = grid.xy(b);
                    let ua = grid.unit_vec(ax, ay);
                    let ub = grid.unit_vec(bx, by);
                    let da = ua[0] * target[0] + ua[1] * target[1] + ua[2] * target[2];
                    let db = ub[0] * target[0] + ub[1] * target[1] + ub[2] * target[2];
                    da.total_cmp(&db)
                })
                .unwrap();
            let lm_id = lm_votes
                .into_iter()
                .max_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)))
                .map(|(k, _)| k)
                .unwrap_or(-1);
            raw_regs.push(RawReg {
                cells,
                kind,
                landmass_id: lm_id,
                area_km2,
                mean_elev: (elev_sum / area_km2.max(1e-6)) as f32,
                center_cell,
            });
        }
    }
    raw_regs.sort_by(|a, b| b.area_km2.total_cmp(&a.area_km2));
    let mut region_id = vec![-1i32; n];
    let mut natural_regions = Vec::with_capacity(raw_regs.len());
    for (idx, reg) in raw_regs.into_iter().enumerate() {
        let id = idx as u32;
        for &c in &reg.cells {
            region_id[c] = id as i32;
        }
        natural_regions.push(NaturalRegion {
            id,
            kind: reg.kind,
            landmass_id: reg.landmass_id,
            area_km2: reg.area_km2,
            mean_elevation_km: reg.mean_elev,
            center_cell: reg.center_cell,
        });
    }

    Geography {
        landmass_id,
        lake_id,
        range_id,
        region_id,
        marine_zone,
        landmasses,
        archipelagos,
        bays,
        isthmuses,
        lakes,
        mountain_ranges,
        passes,
        natural_regions,
    }
}
