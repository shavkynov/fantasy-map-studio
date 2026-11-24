//! Географически обусловленное расселение, хозяйственные уклады, города, торговые пути
//! (по долинам, перевалам, судоходным рекам и морским ветрам/течениям) и естественные границы государств.

use crate::biomes::{Biome, Biomes};
use crate::climate::Climate;
use crate::currents::Currents;
use crate::erosion::ErosionResult;
use crate::geography::{Geography, MarineZone};
use crate::grid::{blur_xwrap, slope_field, Grid};
use crate::hydrology::{Hydrology, MouthKind};
use crate::planet::Planet;
use crate::resources::Resources;
use crate::rng::Rng;
use crate::toponymy;
use std::cmp::Ordering;
use std::collections::{BTreeSet, BinaryHeap, HashSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Livelihood {
    Uninhabitable = 0,
    Agrarian = 1,
    Pastoral = 2,
    Maritime = 3,
    Oasis = 4,
    Mining = 5,
    HunterForest = 6,
}

impl Livelihood {
    pub fn name(self) -> &'static str {
        match self {
            Livelihood::Uninhabitable => "Незаселено",
            Livelihood::Agrarian => "Земледелие",
            Livelihood::Pastoral => "Кочевое скотоводство",
            Livelihood::Maritime => "Мореходство и промысел",
            Livelihood::Oasis => "Оазисное ирригационное хозяйство",
            Livelihood::Mining => "Горнорудное дело",
            Livelihood::HunterForest => "Лесной промысел",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum CultureEthos {
    Agrarian = 0,
    Riverine = 1,
    Maritime = 2,
    SteppeNomad = 3,
    Highland = 4,
    DesertOasis = 5,
    Woodland = 6,
}

impl CultureEthos {
    pub fn name(self) -> &'static str {
        match self {
            CultureEthos::Agrarian => "Земледельческая",
            CultureEthos::Riverine => "Речная",
            CultureEthos::Maritime => "Морская",
            CultureEthos::SteppeNomad => "Степная",
            CultureEthos::Highland => "Горная",
            CultureEthos::DesertOasis => "Оазисная",
            CultureEthos::Woodland => "Лесная",
        }
    }
}

#[derive(Clone, Debug)]
pub struct Culture {
    pub id: u32,
    pub name: String,
    pub hearth_cell: usize,
    pub ethos: CultureEthos,
    pub phonology_profile: u8,
    pub area_km2: f64,
    pub isolation_index: f32,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum SettlementRole {
    Capital,
    Port,
    RiverHub,
    PassFortress,
    OasisTown,
    MiningTown,
    MarketTown,
}

#[derive(Clone, Debug)]
pub struct Settlement {
    pub id: u32,
    pub name: String,
    pub cell: usize,
    pub role: SettlementRole,
    /// Идентификатор государства (`u32::MAX`, если вне государственной досягаемости).
    pub realm_id: u32,
    pub culture_id: u32,
    pub population_score: f32,
    pub is_port: bool,
    pub river_access: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RouteKind {
    Road,
    Riverway,
    SeaLane,
}

#[derive(Clone, Debug)]
pub struct TradeRoute {
    pub from_settlement: u32,
    pub to_settlement: u32,
    pub cells: Vec<usize>,
    pub segments: Vec<RouteKind>,
    pub cost: f32,
}

#[derive(Clone, Debug)]
pub struct Realm {
    pub id: u32,
    pub name: String,
    pub capital_settlement_id: u32,
    pub capital_cell: usize,
    pub culture_id: u32,
    pub dominant_livelihood: Livelihood,
    pub area_km2: f64,
    pub carrying_capacity: f64,
}

/// Итоги расчёта антропогеографии планеты: пригодность, уклады, культуры, города, державы и пути сообщения.
#[derive(Clone, Debug)]
pub struct Civilization {
    pub habitability: Vec<f32>,
    pub livelihood: Vec<Livelihood>,
    pub culture_id: Vec<i32>,
    pub realm_id: Vec<i32>,
    pub cultures: Vec<Culture>,
    pub settlements: Vec<Settlement>,
    pub realms: Vec<Realm>,
    pub trade_routes: Vec<TradeRoute>,
}

#[derive(Clone, Copy)]
struct DijkNode {
    cost: f64,
    cell: usize,
    realm: u32,
}

impl Eq for DijkNode {}
impl PartialEq for DijkNode {
    fn eq(&self, other: &Self) -> bool {
        self.cell == other.cell
            && self.realm == other.realm
            && self.cost.to_bits() == other.cost.to_bits()
    }
}
impl Ord for DijkNode {
    fn cmp(&self, other: &Self) -> Ordering {
        other
            .cost
            .total_cmp(&self.cost)
            .then_with(|| self.cell.cmp(&other.cell))
            .then_with(|| self.realm.cmp(&other.realm))
    }
}
impl PartialOrd for DijkNode {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

#[allow(clippy::too_many_arguments)]
fn land_step_cost(
    u: usize,
    v: usize,
    dist_km: f64,
    elev: &[f32],
    slope: &[f32],
    is_pass_zone: &[u8],
    hydrology: &Hydrology,
    biomes: &Biomes,
    habitability: &[f32],
    existing_road_mask: Option<&[u8]>,
) -> f64 {
    if hydrology.is_lake[v] != 0 || hydrology.is_lake[u] != 0 {
        return 0.55 * dist_km;
    }
    if hydrology.river_mask[u] != 0 && hydrology.river_mask[v] != 0 {
        if hydrology.receiver[u] == v as i32 {
            return 0.28 * dist_km;
        }
        if hydrology.receiver[v] == u as i32 {
            return 0.48 * dist_km;
        }
    }
    let dz = (elev[v] - elev[u]).abs() as f64;
    let grade = dz / dist_km.max(1.0);
    let grid_slope = slope[v] as f64;
    let elev_v = elev[v] as f64;
    let in_pass = is_pass_zone[u] != 0 || is_pass_zone[v] != 0;

    let slope_pen = if in_pass {
        4.5 * grid_slope + 8.0 * dz
    } else {
        30.0 * grid_slope + 450.0 * grade * grade + 20.0 * dz
    };
    let alt_pen = if elev_v > 1.15 && !in_pass {
        14.0 * (elev_v - 1.15).powf(1.6) + 45.0 * (elev_v - 1.85).max(0.0)
    } else if elev_v > 2.2 {
        5.0 * (elev_v - 2.2)
    } else {
        0.0
    };
    let biome_pen = match biomes.biome[v] {
        Biome::IceSheet => 14.0,
        Biome::HotDesert | Biome::ColdDesert | Biome::PolarDesert | Biome::SaltFlat => {
            if hydrology.is_oasis[v] != 0 || hydrology.is_wadi[v] != 0 {
                0.35
            } else if habitability[v] >= 0.12 {
                0.45
            } else {
                4.5
            }
        }
        Biome::Wetland | Biome::TropicalRainforest => 2.1,
        Biome::TemperateGrassland | Biome::TropicalSavanna | Biome::Mediterranean => 0.0,
        _ => 0.65,
    };
    let river_cross_pen = if hydrology.river_mask[v] != 0
        && hydrology.discharge_m3s[v] > 3000.0
        && hydrology.receiver[u] != v as i32
        && hydrology.receiver[v] != u as i32
    {
        0.45
    } else {
        0.0
    };
    let valley_mult = if elev_v < 0.85 && grid_slope < 0.015 && habitability[v] >= 0.20 {
        0.88
    } else {
        1.0
    };
    let reuse_mult = match existing_road_mask {
        Some(m) if m[v] != 0 => 0.68,
        _ => 1.0,
    };
    dist_km * (1.0 + slope_pen + alt_pen + biome_pen + river_cross_pen) * valley_mult * reuse_mult
}

/// Прокладывает сухопутный торговый маршрут между двумя клетками суши с учётом уклона, высот и перевалов.
pub fn route_land_road(
    planet: &Planet,
    from_cell: usize,
    to_cell: usize,
    existing_road_mask: Option<&[u8]>,
) -> Option<Vec<usize>> {
    let grid = &planet.grid;
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    if from_cell >= n || to_cell >= n {
        return None;
    }
    if planet.hydrology.is_ocean[from_cell] != 0
        || planet.hydrology.is_lake[from_cell] != 0
        || planet.hydrology.is_ocean[to_cell] != 0
        || planet.hydrology.is_lake[to_cell] != 0
    {
        return None;
    }
    if from_cell == to_cell {
        return Some(vec![from_cell]);
    }

    let slope = slope_field(&planet.erosion.elevation_km, grid);
    let mut is_pass_zone = vec![0u8; n];
    for p in &planet.geography.passes {
        let (px, py) = grid.xy(p.cell);
        for dy in -1isize..=1 {
            let yy = py as isize + dy;
            if yy < 0 || yy >= h as isize {
                continue;
            }
            for dx in -1isize..=1 {
                let xx = grid.wrap_x(px as isize + dx);
                let c = grid.idx(xx, yy as usize);
                is_pass_zone[c] = 1;
            }
        }
    }

    let dy_km = grid.dy_km();
    let dx_row: Vec<f64> = (0..h).map(|y| grid.dx_km(y)).collect();
    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    dist[from_cell] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(DijkNode {
        cost: 0.0,
        cell: from_cell,
        realm: 0,
    });

    while let Some(DijkNode { cost, cell, .. }) = heap.pop() {
        if cost > dist[cell] + 1e-6 {
            continue;
        }
        if cell == to_cell {
            break;
        }
        let (ux, uy) = (cell % w, cell / w);
        let (nbs, cnt) = grid.neighbors8(cell);
        for &nb in &nbs[..cnt] {
            if planet.hydrology.is_ocean[nb] != 0 || planet.hydrology.is_lake[nb] != 0 {
                continue;
            }
            let (vx, vy) = (nb % w, nb / w);
            let mut dxi = vx as isize - ux as isize;
            let wi = w as isize;
            if dxi > wi / 2 {
                dxi -= wi;
            } else if dxi < -wi / 2 {
                dxi += wi;
            }
            let dyi = vy as isize - uy as isize;
            let dist_km = ((dxi as f64) * dx_row[uy])
                .hypot(-(dyi as f64) * dy_km)
                .max(1.0);
            let step = land_step_cost(
                cell,
                nb,
                dist_km,
                &planet.erosion.elevation_km,
                &slope,
                &is_pass_zone,
                &planet.hydrology,
                &planet.biomes,
                &planet.civilization.habitability,
                existing_road_mask,
            );
            let nc = cost + step;
            if nc + 1e-6 < dist[nb] {
                dist[nb] = nc;
                prev[nb] = cell;
                heap.push(DijkNode {
                    cost: nc,
                    cell: nb,
                    realm: 0,
                });
            }
        }
    }

    if !dist[to_cell].is_finite() {
        return None;
    }
    let mut path = Vec::new();
    let mut cur = to_cell;
    while cur != usize::MAX {
        path.push(cur);
        if cur == from_cell {
            break;
        }
        cur = prev[cur];
    }
    if path.last() != Some(&from_cell) {
        return None;
    }
    path.reverse();
    Some(path)
}

/// Строит карту пригодности к жизни, культур, поселений, торговых путей и государств.
#[allow(clippy::too_many_arguments)]
pub fn simulate(
    grid: &Grid,
    erosion: &ErosionResult,
    currents: &Currents,
    climate: &Climate,
    hydrology: &Hydrology,
    biomes: &Biomes,
    geography: &Geography,
    resources: &Resources,
    target_realms: usize,
    seed: &str,
) -> Civilization {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    let area_row: Vec<f64> = (0..h).map(|y| grid.cell_area_km2(y)).collect();
    let slope = slope_field(&erosion.elevation_km, grid);

    // Предвычисляем узловые географические признаки (слияния рек, эстуарии, перевалы, месторождения)
    let mut is_confluence = vec![0u8; n];
    let mut is_estuary = vec![0u8; n];
    for r in &hydrology.rivers {
        match r.mouth {
            MouthKind::Confluence(_) => {
                if let Some(&last) = r.cells.last() {
                    is_confluence[last] = 1;
                }
            }
            MouthKind::Ocean => {
                if r.cells.len() >= 2 {
                    let land_mouth = r.cells[r.cells.len() - 2];
                    is_estuary[land_mouth] = 1;
                }
            }
            _ => {}
        }
    }

    let mut is_pass_zone = vec![0u8; n];
    for p in &geography.passes {
        is_pass_zone[p.cell] = 2;
        let (nbs, cnt) = grid.neighbors8(p.cell);
        for &nb in &nbs[..cnt] {
            if is_pass_zone[nb] == 0 {
                is_pass_zone[nb] = 1;
            }
        }
    }

    let mut deposit_bonus = vec![0.0f32; n];
    for d in &resources.deposits {
        deposit_bonus[d.cell] = deposit_bonus[d.cell].max(d.richness);
        let (nbs, cnt) = grid.neighbors8(d.cell);
        for &nb in &nbs[..cnt] {
            deposit_bonus[nb] = deposit_bonus[nb].max(d.richness * 0.7);
        }
    }

    // 1. Пригодность к жизни и ведущий хозяйственный уклад
    let mut habitability = vec![0.0f32; n];
    let mut livelihood = vec![Livelihood::Uninhabitable; n];
    let mut is_coastal_land = vec![0u8; n];
    let mut hab_area_km2 = 0.0f64;

    for y in 0..h {
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if hydrology.is_ocean[i] != 0
                || hydrology.is_lake[i] != 0
                || hydrology.is_salt_flat[i] != 0
                || climate.glacier[i] > 0.35
            {
                continue;
            }

            let (nbs4, cnt4) = grid.neighbors4(i);
            let mut adj_ocean = false;
            let mut max_fish = 0.0f32;
            let mut near_strait = false;
            for &nb in &nbs4[..cnt4] {
                if hydrology.is_ocean[nb] != 0 {
                    adj_ocean = true;
                    max_fish = max_fish.max(resources.fishery[nb]);
                    if geography.marine_zone[nb] == MarineZone::Strait {
                        near_strait = true;
                    }
                }
            }
            if adj_ocean {
                is_coastal_land[i] = 1;
            }

            let mut adj_fresh_lake = false;
            let (nbs8, cnt8) = grid.neighbors8(i);
            let mut near_bay = false;
            for &nb in &nbs8[..cnt8] {
                if hydrology.is_lake[nb] != 0 && hydrology.is_endorheic_lake[nb] == 0 {
                    adj_fresh_lake = true;
                }
                if hydrology.is_ocean[nb] != 0 {
                    if geography.marine_zone[nb] == MarineZone::Strait {
                        near_strait = true;
                    }
                    if geography.marine_zone[nb] == MarineZone::Bay {
                        near_bay = true;
                    }
                }
            }

            let t_mean = climate.temp_c[i] as f64;
            let t_warm = climate.temp_jan_c[i].max(climate.temp_jul_c[i]) as f64;
            let ai = climate.aridity_index[i] as f64;
            let elev = erosion.elevation_km[i] as f64;

            let grow_f = ((t_warm - 9.0) / 11.0).clamp(0.0, 1.0)
                * ((36.0 - t_mean) / 11.0).clamp(0.20, 1.0);
            let rain_water = (ai / 0.65).clamp(0.0, 1.0);
            let river_irrig = ((hydrology.discharge_m3s[i] as f64 / 2200.0).clamp(0.0, 1.0))
                .max(if adj_fresh_lake { 0.80 } else { 0.0 })
                .max(if hydrology.is_oasis[i] != 0 { 0.62 } else { 0.0 });
            let flat_f = (1.0 - (slope[i] as f64 / 0.07).clamp(0.0, 1.0)).max(0.15);

            let rain_agr = biomes.soil_fertility[i] as f64 * rain_water * grow_f;
            let alluv_soil = (0.38
                + 0.48 * (erosion.alluvium_km[i] as f64 / 0.08).clamp(0.0, 1.0))
            .clamp(0.0, 1.0);
            let irrig_agr = alluv_soil * river_irrig * grow_f * flat_f * 0.92;
            let agr_score = rain_agr.max(irrig_agr);

            let b = biomes.biome[i];
            let pastoral_score = if matches!(b, Biome::TemperateGrassland | Biome::TropicalSavanna)
                || ((0.14..=0.55).contains(&ai) && t_warm > 10.0 && elev < 3.0)
            {
                0.34 * ((t_warm - 6.0) / 14.0).clamp(0.25, 1.0) * flat_f
            } else {
                0.0
            };

            let maritime_score = if adj_ocean && t_mean > -4.0 {
                let harbor = match hydrology.coast_type[i] {
                    4 => 1.0,
                    2 => 0.78,
                    3 => 0.58,
                    1 => 0.38,
                    _ => 0.50,
                };
                let strait_b = if near_strait { 0.16 } else { 0.0 };
                let bay_b = if near_bay { 0.12 } else { 0.0 };
                ((0.30 + 0.50 * max_fish as f64) * harbor + strait_b + bay_b)
                    * ((t_warm - 4.0) / 12.0).clamp(0.25, 1.0)
            } else {
                0.0
            };

            let max_min = resources.iron[i]
                .max(resources.copper_gold[i])
                .max(resources.gems_rare[i])
                .max(resources.coal[i])
                .max(resources.salt[i]) as f64;
            let mining_score = if max_min > 0.46 && t_warm > -4.0 {
                0.38 * max_min * ((t_warm + 4.0) / 16.0).clamp(0.3, 1.0)
            } else {
                0.0
            };

            let forest_score = if resources.timber[i] > 0.30 && t_warm > 6.0 {
                0.24 * resources.timber[i] as f64
            } else {
                0.0
            };

            let best = agr_score
                .max(pastoral_score)
                .max(maritime_score)
                .max(mining_score)
                .max(forest_score)
                .clamp(0.0, 1.0);

            if best < 0.06 {
                continue;
            }

            habitability[i] = best as f32;
            hab_area_km2 += area_row[y] * best;

            livelihood[i] = if (ai < 0.25 && river_irrig > 0.35 && irrig_agr >= 0.20)
                || (hydrology.is_oasis[i] != 0 && irrig_agr >= 0.14)
            {
                Livelihood::Oasis
            } else if maritime_score >= agr_score * 1.08 && maritime_score >= 0.28 {
                Livelihood::Maritime
            } else if agr_score >= pastoral_score && agr_score >= mining_score && agr_score >= 0.16
            {
                Livelihood::Agrarian
            } else if pastoral_score >= mining_score && pastoral_score >= forest_score {
                Livelihood::Pastoral
            } else if mining_score >= forest_score {
                Livelihood::Mining
            } else {
                Livelihood::HunterForest
            };
        }
    }

    // 2. Размещение городов и узловых поселений по транспортно-ресурсному потенциалу
    let mut hinterland = habitability.clone();
    let r_hint = ((w as f64 / 120.0).round() as usize).max(1);
    blur_xwrap(&mut hinterland, w, h, r_hint);

    let mut site_cands: Vec<(usize, f32)> = Vec::new();
    for i in 0..n {
        let hab = habitability[i];
        if hab < 0.09 {
            continue;
        }
        let mut score = 0.48 * hab + 0.44 * hinterland[i];
        if is_confluence[i] != 0 {
            score += 0.40;
        }
        if hydrology.river_mask[i] != 0 || hydrology.discharge_m3s[i] > 2500.0 {
            score += 0.24 * (hydrology.discharge_m3s[i] / 12_000.0).clamp(0.15, 1.0);
        }
        if is_estuary[i] != 0 {
            score += 0.36;
        } else if is_coastal_land[i] != 0 {
            let harbor_b = match hydrology.coast_type[i] {
                4 => 0.24,
                2 => 0.14,
                _ => 0.06,
            };
            score += harbor_b;
            let (nbs8, cnt8) = grid.neighbors8(i);
            if nbs8[..cnt8]
                .iter()
                .any(|&nb| geography.marine_zone[nb] == MarineZone::Strait)
            {
                score += 0.20;
            }
            if nbs8[..cnt8]
                .iter()
                .any(|&nb| geography.marine_zone[nb] == MarineZone::Bay)
            {
                score += 0.12;
            }
        }
        if is_pass_zone[i] != 0 {
            score += if is_pass_zone[i] == 2 { 0.30 } else { 0.18 };
        }
        if hydrology.is_oasis[i] != 0 {
            score += 0.26;
        }
        if deposit_bonus[i] >= 0.50 {
            score += 0.24 * deposit_bonus[i];
        }
        score -= 4.5 * slope[i];
        if erosion.elevation_km[i] > 1.85 && is_pass_zone[i] == 0 && deposit_bonus[i] < 0.50 {
            score -= 0.45 * (erosion.elevation_km[i] - 1.85);
        }
        site_cands.push((i, score));
    }

    site_cands.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let max_settlements = ((hab_area_km2 / 320_000.0).round() as usize).clamp(10, 120);
    let mut raw_sites: Vec<(usize, f32)> = Vec::new();
    for &(cell, score) in &site_cands {
        if raw_sites.len() >= max_settlements {
            break;
        }
        let (cx, cy) = grid.xy(cell);
        let uc = grid.unit_vec(cx, cy);
        let min_sep = (340.0 - 150.0 * hinterland[cell] as f64).clamp(175.0, 340.0);
        let too_close = raw_sites.iter().any(|&(other, _)| {
            let (ox, oy) = grid.xy(other);
            grid.spherical_dist_km(uc, grid.unit_vec(ox, oy)) < min_sep
        });
        if !too_close {
            raw_sites.push((cell, score));
        }
    }

    let auto_realms = if target_realms > 0 {
        target_realms
    } else {
        ((hab_area_km2 / 1_800_000.0).round() as usize).clamp(4, 18)
    };
    let desired_realms = auto_realms.min(raw_sites.len());

    let mut is_capital_idx = vec![false; raw_sites.len()];
    let mut capital_indices: Vec<usize> = Vec::new();
    for min_cap_sep in [760.0f64, 480.0, 260.0] {
        for (idx, &(cell, _)) in raw_sites.iter().enumerate() {
            if capital_indices.len() >= desired_realms {
                break;
            }
            if is_capital_idx[idx] {
                continue;
            }
            let (cx, cy) = grid.xy(cell);
            let uc = grid.unit_vec(cx, cy);
            let too_close = capital_indices.iter().any(|&ci| {
                let (ox, oy) = grid.xy(raw_sites[ci].0);
                grid.spherical_dist_km(uc, grid.unit_vec(ox, oy)) < min_cap_sep
            });
            if !too_close {
                is_capital_idx[idx] = true;
                capital_indices.push(idx);
            }
        }
        if capital_indices.len() >= desired_realms {
            break;
        }
    }

    let mut is_port_settlement = vec![0u8; n];
    for &(cell, _) in &raw_sites {
        if is_coastal_land[cell] != 0 {
            is_port_settlement[cell] = 1;
        }
    }

    // 3. Физическая анизотропная функция транспортных затрат u -> v
    let dy_km = grid.dy_km();
    let dx_row: Vec<f64> = (0..h).map(|y| grid.dx_km(y)).collect();

    let step_cost_base = |u: usize, v: usize, road_used: Option<&[u8]>| -> f64 {
        let (ux, uy) = (u % w, u / w);
        let (vx, vy) = (v % w, v / w);
        let mut dxi = vx as isize - ux as isize;
        let wi = w as isize;
        if dxi > wi / 2 {
            dxi -= wi;
        } else if dxi < -wi / 2 {
            dxi += wi;
        }
        let dyi = vy as isize - uy as isize;
        let step_e_km = (dxi as f64) * dx_row[uy];
        let step_n_km = -(dyi as f64) * dy_km;
        let dist_km = step_e_km.hypot(step_n_km).max(1.0);

        let u_oce = hydrology.is_ocean[u] != 0;
        let v_oce = hydrology.is_ocean[v] != 0;

        if !u_oce && !v_oce {
            land_step_cost(
                u,
                v,
                dist_km,
                &erosion.elevation_km,
                &slope,
                &is_pass_zone,
                hydrology,
                biomes,
                &habitability,
                road_used,
            )
        } else if u_oce != v_oce {
            let oce_c = if u_oce { u } else { v };
            let land_c = if u_oce { v } else { u };
            if geography.marine_zone[oce_c] == MarineZone::Strait {
                28.0 + 0.35 * dist_km
            } else if is_port_settlement[land_c] != 0 {
                70.0 + 0.40 * dist_km
            } else {
                165.0 + 0.55 * dist_km
            }
        } else {
            let sea_ice_pen = if climate.temp_c[v] < -12.0 { 12.0 } else { 0.0 };
            let dir_e = step_e_km / dist_km;
            let dir_n = step_n_km / dist_km;
            let wu = 0.5 * (climate.wind_u_jan[u] + climate.wind_u_jul[u]) as f64;
            let wv = 0.5 * (climate.wind_v_jan[u] + climate.wind_v_jul[u]) as f64;
            let cu = currents.u[u] as f64;
            let cv = currents.v[u] as f64;
            let align =
                (0.55 * (wu * dir_e + wv * dir_n) + 0.45 * (cu * dir_e + cv * dir_n)).clamp(-1.2, 1.2);
            let sail_mult = (1.0 - 0.35 * align).clamp(0.55, 1.55);
            let zone_f = match geography.marine_zone[v] {
                MarineZone::Bay => 0.30,
                MarineZone::Strait | MarineZone::MarginalSea => 0.32,
                MarineZone::OpenOcean => {
                    if erosion.elevation_km[v] >= -0.30 {
                        0.36
                    } else {
                        0.58
                    }
                }
                MarineZone::Land => 1.0,
            };
            dist_km * (zone_f * sail_mult + sea_ice_pen)
        }
    };

    // 3b. Этнокультурные ареалы и географическая изоляция (до расселения государств)
    let num_cultures = ((hab_area_km2 / 3_500_000.0).round() as usize)
        .clamp(4, 12)
        .min(raw_sites.len());
    let mut hearth_cells: Vec<usize> = Vec::new();
    let mut covered_lm = BTreeSet::new();
    for &(cell, _) in &raw_sites {
        if hearth_cells.len() >= num_cultures {
            break;
        }
        let lid = geography.landmass_id[cell];
        if lid < 0 || covered_lm.contains(&lid) {
            continue;
        }
        let (cx, cy) = grid.xy(cell);
        let uc = grid.unit_vec(cx, cy);
        let too_close = hearth_cells.iter().any(|&other| {
            let (ox, oy) = grid.xy(other);
            grid.spherical_dist_km(uc, grid.unit_vec(ox, oy)) < 650.0
        });
        if !too_close {
            covered_lm.insert(lid);
            hearth_cells.push(cell);
        }
    }
    for min_sep in [1100.0f64, 650.0, 320.0, 120.0, 0.0] {
        for &(cell, _) in &raw_sites {
            if hearth_cells.len() >= num_cultures {
                break;
            }
            if hearth_cells.contains(&cell) {
                continue;
            }
            let (cx, cy) = grid.xy(cell);
            let uc = grid.unit_vec(cx, cy);
            let too_close = min_sep > 0.0
                && hearth_cells.iter().any(|&other| {
                    let (ox, oy) = grid.xy(other);
                    grid.spherical_dist_km(uc, grid.unit_vec(ox, oy)) < min_sep
                });
            if !too_close {
                hearth_cells.push(cell);
            }
        }
        if hearth_cells.len() >= num_cultures {
            break;
        }
    }

    let mut culture_id = vec![-1i32; n];
    let mut cult_best = vec![f64::INFINITY; n];
    let mut cult_heap = BinaryHeap::new();
    let max_cult_cost = 5200.0f64;
    for (cid, &hc) in hearth_cells.iter().enumerate() {
        cult_best[hc] = 0.0;
        culture_id[hc] = cid as i32;
        cult_heap.push(DijkNode {
            cost: 0.0,
            cell: hc,
            realm: cid as u32,
        });
    }
    while let Some(DijkNode {
        cost,
        cell,
        realm: cult,
    }) = cult_heap.pop()
    {
        if cost > cult_best[cell] + 1e-6 {
            continue;
        }
        let (nbs, cnt) = grid.neighbors8(cell);
        for &nb in &nbs[..cnt] {
            let mut c_step = step_cost_base(cell, nb, None);
            if hydrology.is_ocean[nb] != 0 && geography.marine_zone[nb] == MarineZone::OpenOcean {
                c_step *= 2.2;
            }
            if erosion.elevation_km[nb] > 1.8 {
                c_step *= 1.8;
            }
            if matches!(
                biomes.biome[nb],
                Biome::HotDesert
                    | Biome::ColdDesert
                    | Biome::PolarDesert
                    | Biome::SaltFlat
                    | Biome::IceSheet
            ) {
                c_step *= 1.5;
            }
            let next_cost = cost + c_step;
            if next_cost <= max_cult_cost && next_cost + 1e-6 < cult_best[nb] {
                cult_best[nb] = next_cost;
                if hydrology.is_ocean[nb] == 0
                    && hydrology.is_lake[nb] == 0
                    && habitability[nb] >= 0.03
                {
                    culture_id[nb] = cult as i32;
                }
                cult_heap.push(DijkNode {
                    cost: next_cost,
                    cell: nb,
                    realm: cult,
                });
            }
        }
    }

    let nc = hearth_cells.len();
    let mut cult_area = vec![0.0f64; nc];
    let mut cult_cap = vec![0.0f64; nc];
    let mut cult_riv_cap = vec![0.0f64; nc];
    let mut cult_elev_sum = vec![0.0f64; nc];
    let mut cult_temp_sum = vec![0.0f64; nc];
    let mut cult_liv = vec![[0.0f64; 7]; nc];
    let mut cult_perim_tot = vec![0usize; nc];
    let mut cult_perim_bar = vec![0usize; nc];
    for i in 0..n {
        let c_raw = culture_id[i];
        if c_raw < 0 {
            continue;
        }
        if hydrology.is_ocean[i] != 0 || hydrology.is_lake[i] != 0 || habitability[i] < 0.03 {
            culture_id[i] = -1;
            continue;
        }
        let cu = c_raw as usize;
        let a = area_row[i / w];
        let cap = a * habitability[i] as f64;
        cult_area[cu] += a;
        cult_cap[cu] += cap;
        if hydrology.river_mask[i] != 0 || hydrology.discharge_m3s[i] > 2200.0 {
            cult_riv_cap[cu] += cap;
        }
        cult_elev_sum[cu] += erosion.elevation_km[i] as f64 * a;
        cult_temp_sum[cu] += climate.temp_c[i] as f64 * a;
        let li = livelihood[i] as usize;
        if li > 0 && li < 7 {
            cult_liv[cu][li] += cap;
        }
        let (nbs4, cnt4) = grid.neighbors4(i);
        for &nb in &nbs4[..cnt4] {
            if culture_id[nb] != c_raw {
                cult_perim_tot[cu] += 1;
                if hydrology.is_ocean[nb] != 0
                    || erosion.elevation_km[nb] > 1.8
                    || climate.glacier[nb] > 0.25
                    || matches!(
                        biomes.biome[nb],
                        Biome::HotDesert
                            | Biome::ColdDesert
                            | Biome::PolarDesert
                            | Biome::SaltFlat
                    )
                {
                    cult_perim_bar[cu] += 1;
                }
            }
        }
    }

    let mut name_rng = Rng::sub(seed, "civilization-names");
    let mut used_names: HashSet<String> = HashSet::new();
    let mut cultures = Vec::with_capacity(nc);
    for (cid, &hc) in hearth_cells.iter().enumerate() {
        let mut best_li = livelihood[hc] as usize;
        let mut best_v = -1.0f64;
        for (li, &v) in cult_liv[cid].iter().enumerate().skip(1) {
            if v > best_v {
                best_v = v;
                best_li = li;
            }
        }
        let mean_elev = (cult_elev_sum[cid] / cult_area[cid].max(1e-6)) as f32;
        let mean_temp = (cult_temp_sum[cid] / cult_area[cid].max(1e-6)) as f32;
        let riv_frac = cult_riv_cap[cid] / cult_cap[cid].max(1e-6);
        let ethos = match best_li {
            3 => CultureEthos::Maritime,
            2 => CultureEthos::SteppeNomad,
            4 => CultureEthos::DesertOasis,
            5 => CultureEthos::Highland,
            6 => CultureEthos::Woodland,
            1 => {
                if mean_elev > 1.05 {
                    CultureEthos::Highland
                } else if riv_frac > 0.32 || hydrology.river_mask[hc] != 0 {
                    CultureEthos::Riverine
                } else {
                    CultureEthos::Agrarian
                }
            }
            _ => CultureEthos::Agrarian,
        };
        let profile = match ethos {
            CultureEthos::Maritime => {
                if hydrology.is_lake[hc] == 0 && (cid % 4 == 3) {
                    6
                } else {
                    0
                }
            }
            CultureEthos::Highland => 1,
            CultureEthos::SteppeNomad => 2,
            CultureEthos::DesertOasis => 3,
            CultureEthos::Riverine | CultureEthos::Agrarian => {
                if mean_elev > 1.2 {
                    1
                } else {
                    4
                }
            }
            CultureEthos::Woodland => {
                if mean_temp < 1.0 {
                    7
                } else {
                    5
                }
            }
        };
        let isolation_index =
            (cult_perim_bar[cid] as f64 / cult_perim_tot[cid].max(1) as f64).clamp(0.0, 1.0)
                as f32;
        let name = toponymy::generate_proper_name(profile, &mut name_rng, 2, 3, &mut used_names);
        cultures.push(Culture {
            id: cid as u32,
            name,
            hearth_cell: hc,
            ethos,
            phonology_profile: profile,
            area_km2: cult_area[cid],
            isolation_index,
        });
    }

    let nearest_culture = |cell: usize| -> u32 {
        let c = culture_id[cell];
        if c >= 0 {
            return c as u32;
        }
        if cultures.is_empty() {
            return 0;
        }
        let (cx, cy) = grid.xy(cell);
        let uc = grid.unit_vec(cx, cy);
        cultures
            .iter()
            .min_by(|a, b| {
                let (ax, ay) = grid.xy(a.hearth_cell);
                let (bx, by) = grid.xy(b.hearth_cell);
                let da = grid.spherical_dist_km(uc, grid.unit_vec(ax, ay));
                let db = grid.spherical_dist_km(uc, grid.unit_vec(bx, by));
                da.total_cmp(&db)
            })
            .map(|c| c.id)
            .unwrap_or(0)
    };

    let mut settlements = Vec::with_capacity(raw_sites.len());
    let max_score = raw_sites.first().map(|s| s.1).unwrap_or(1.0).max(0.1);

    for (idx, &(cell, score)) in raw_sites.iter().enumerate() {
        let is_port = is_coastal_land[cell] != 0;
        let river_access = hydrology.river_mask[cell] != 0 || hydrology.discharge_m3s[cell] > 2200.0;
        let role = if is_capital_idx[idx] {
            SettlementRole::Capital
        } else if is_port && (is_estuary[cell] != 0 || matches!(hydrology.coast_type[cell], 2 | 4))
        {
            SettlementRole::Port
        } else if is_pass_zone[cell] != 0 {
            SettlementRole::PassFortress
        } else if livelihood[cell] == Livelihood::Oasis {
            SettlementRole::OasisTown
        } else if deposit_bonus[cell] >= 0.54 {
            SettlementRole::MiningTown
        } else if river_access || is_confluence[cell] != 0 {
            SettlementRole::RiverHub
        } else if is_port {
            SettlementRole::Port
        } else {
            SettlementRole::MarketTown
        };

        let cid = nearest_culture(cell);
        let prof = cultures
            .get(cid as usize)
            .map(|c| c.phonology_profile)
            .unwrap_or(4);
        let name = toponymy::settlement_name(prof, role, &mut name_rng, &mut used_names);
        let pop_score = ((score / max_score) * 100.0).clamp(5.0, 100.0);
        settlements.push(Settlement {
            id: idx as u32,
            name,
            cell,
            role,
            realm_id: u32::MAX,
            culture_id: cid,
            population_score: pop_score,
            is_port,
            river_access,
        });
    }

    // 4. Государства и естественные границы по логистической досягаемости и культурной близости
    let mut realm_id = vec![-1i32; n];
    let mut best_cost = vec![f64::INFINITY; n];
    let mut heap = BinaryHeap::new();
    let max_admin_cost = 2600.0f64;

    let mut realms = Vec::with_capacity(capital_indices.len());
    for (rid, &s_idx) in capital_indices.iter().enumerate() {
        let cap_cell = settlements[s_idx].cell;
        let cap_cult = settlements[s_idx].culture_id;
        let rid_u32 = rid as u32;
        settlements[s_idx].realm_id = rid_u32;
        best_cost[cap_cell] = 0.0;
        realm_id[cap_cell] = rid as i32;
        heap.push(DijkNode {
            cost: 0.0,
            cell: cap_cell,
            realm: rid_u32,
        });
        realms.push(Realm {
            id: rid_u32,
            name: String::new(),
            capital_settlement_id: settlements[s_idx].id,
            capital_cell: cap_cell,
            culture_id: cap_cult,
            dominant_livelihood: livelihood[cap_cell],
            area_km2: 0.0,
            carrying_capacity: 0.0,
        });
    }

    while let Some(DijkNode { cost, cell, realm }) = heap.pop() {
        if cost > best_cost[cell] + 1e-6 {
            continue;
        }
        let r_ref = &realms[realm as usize];
        let cap_s_id = r_ref.capital_settlement_id as usize;
        let cap_cult = r_ref.culture_id as i32;
        let power_scale =
            1.0 / (0.75 + 0.45 * (settlements[cap_s_id].population_score as f64 / 100.0));

        let (nbs, cnt) = grid.neighbors8(cell);
        for &nb in &nbs[..cnt] {
            let cult_mult = if culture_id[nb] >= 0 && culture_id[nb] != cap_cult {
                1.28
            } else {
                1.0
            };
            let next_cost = cost + step_cost_base(cell, nb, None) * power_scale * cult_mult;
            if next_cost <= max_admin_cost && next_cost + 1e-6 < best_cost[nb] {
                best_cost[nb] = next_cost;
                if hydrology.is_ocean[nb] == 0
                    && hydrology.is_lake[nb] == 0
                    && habitability[nb] >= 0.03
                {
                    realm_id[nb] = realm as i32;
                }
                heap.push(DijkNode {
                    cost: next_cost,
                    cell: nb,
                    realm,
                });
            }
        }
    }

    // Очищаем морские/озёрные метки и считаем статистику держав
    let mut liv_counts = vec![[0.0f64; 7]; realms.len()];
    for i in 0..n {
        if hydrology.is_ocean[i] != 0 || hydrology.is_lake[i] != 0 || habitability[i] < 0.03 {
            realm_id[i] = -1;
            continue;
        }
        let r = realm_id[i];
        if r >= 0 {
            let ru = r as usize;
            let a = area_row[i / w];
            realms[ru].area_km2 += a;
            let cap = a * habitability[i] as f64;
            realms[ru].carrying_capacity += cap;
            let li = livelihood[i] as usize;
            if li > 0 && li < 7 {
                liv_counts[ru][li] += cap;
            }
        }
    }
    for (ru, r) in realms.iter_mut().enumerate() {
        let mut best_l = r.dominant_livelihood;
        let mut best_v = -1.0f64;
        for (li, &v) in liv_counts[ru].iter().enumerate().skip(1) {
            if v > best_v {
                best_v = v;
                best_l = match li {
                    1 => Livelihood::Agrarian,
                    2 => Livelihood::Pastoral,
                    3 => Livelihood::Maritime,
                    4 => Livelihood::Oasis,
                    5 => Livelihood::Mining,
                    _ => Livelihood::HunterForest,
                };
            }
        }
        if best_v > 0.0 {
            r.dominant_livelihood = best_l;
        }
        let (prof, ethos) = cultures
            .get(r.culture_id as usize)
            .map(|c| (c.phonology_profile, c.ethos))
            .unwrap_or((4, CultureEthos::Agrarian));
        let root = toponymy::generate_proper_name(prof, &mut name_rng, 2, 3, &mut used_names);
        let mut title = toponymy::realm_title(&root, r.dominant_livelihood, ethos, &mut name_rng);
        while used_names.contains(&title) {
            let alt = toponymy::generate_proper_name(prof, &mut name_rng, 2, 3, &mut used_names);
            title = toponymy::realm_title(&alt, r.dominant_livelihood, ethos, &mut name_rng);
        }
        used_names.insert(title.clone());
        r.name = title;
    }

    for s in &mut settlements {
        if s.realm_id == u32::MAX {
            let rid = realm_id[s.cell];
            if rid >= 0 {
                s.realm_id = rid as u32;
            }
        }
    }

    // 5. Сухопутные, речные и морские торговые пути между важнейшими узлами
    let hub_limit = settlements.len().min(36);
    let mut pairs: BTreeSet<(usize, usize)> = BTreeSet::new();
    for a in 0..hub_limit {
        let (ax, ay) = grid.xy(settlements[a].cell);
        let ua = grid.unit_vec(ax, ay);
        let mut cands: Vec<(usize, f64)> = Vec::new();
        for b in 0..hub_limit {
            if a == b {
                continue;
            }
            let (bx, by) = grid.xy(settlements[b].cell);
            let d = grid.spherical_dist_km(ua, grid.unit_vec(bx, by));
            if d <= 2900.0 {
                cands.push((b, d));
            }
        }
        cands.sort_by(|x, y| x.1.total_cmp(&y.1).then_with(|| x.0.cmp(&y.0)));
        for &(b, _) in cands.iter().take(2) {
            let p = if a < b { (a, b) } else { (b, a) };
            pairs.insert(p);
        }
    }

    let mut adj_targets: Vec<Vec<usize>> = vec![Vec::new(); hub_limit];
    for &(a, b) in &pairs {
        adj_targets[a].push(b);
    }

    let mut trade_routes = Vec::new();
    let mut road_used = vec![0u8; n];
    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    let mut visited = Vec::with_capacity(n / 4);
    let max_route_cost = 4200.0f64;

    for (a, targets) in adj_targets.iter().enumerate() {
        if targets.is_empty() {
            continue;
        }
        let start_cell = settlements[a].cell;
        let target_cells: Vec<(usize, usize)> =
            targets.iter().map(|&b| (b, settlements[b].cell)).collect();
        let mut remaining = target_cells.len();

        for &c in &visited {
            dist[c] = f64::INFINITY;
            prev[c] = usize::MAX;
        }
        visited.clear();

        dist[start_cell] = 0.0;
        visited.push(start_cell);
        let mut r_heap = BinaryHeap::new();
        r_heap.push(DijkNode {
            cost: 0.0,
            cell: start_cell,
            realm: 0,
        });

        while let Some(DijkNode { cost, cell, .. }) = r_heap.pop() {
            if cost > dist[cell] + 1e-6 {
                continue;
            }
            if target_cells.iter().any(|&(_, tc)| tc == cell) {
                remaining = remaining.saturating_sub(1);
                if remaining == 0 {
                    break;
                }
            }
            if cost > max_route_cost {
                break;
            }
            let (nbs, cnt) = grid.neighbors8(cell);
            for &nb in &nbs[..cnt] {
                let nc = cost + step_cost_base(cell, nb, Some(&road_used));
                if nc <= max_route_cost && nc + 1e-6 < dist[nb] {
                    if !dist[nb].is_finite() {
                        visited.push(nb);
                    }
                    dist[nb] = nc;
                    prev[nb] = cell;
                    r_heap.push(DijkNode {
                        cost: nc,
                        cell: nb,
                        realm: 0,
                    });
                }
            }
        }

        for &(b, goal_cell) in &target_cells {
            if !dist[goal_cell].is_finite() {
                continue;
            }
            let mut path = Vec::new();
            let mut cur = goal_cell;
            while cur != usize::MAX {
                path.push(cur);
                if cur == start_cell {
                    break;
                }
                cur = prev[cur];
            }
            if path.last() != Some(&start_cell) || path.len() < 2 {
                continue;
            }
            path.reverse();
            for &c in &path {
                if hydrology.is_ocean[c] == 0 && hydrology.is_lake[c] == 0 {
                    road_used[c] = 1;
                }
            }
            let mut segments = Vec::with_capacity(path.len() - 1);
            for k in 0..(path.len() - 1) {
                let u = path[k];
                let v = path[k + 1];
                let kind = if hydrology.is_ocean[u] != 0 || hydrology.is_ocean[v] != 0 {
                    RouteKind::SeaLane
                } else if hydrology.river_mask[u] != 0
                    && hydrology.river_mask[v] != 0
                    && (hydrology.receiver[u] == v as i32 || hydrology.receiver[v] == u as i32)
                {
                    RouteKind::Riverway
                } else {
                    RouteKind::Road
                };
                segments.push(kind);
            }
            trade_routes.push(TradeRoute {
                from_settlement: settlements[a].id,
                to_settlement: settlements[b].id,
                cells: path,
                segments,
                cost: dist[goal_cell] as f32,
            });
        }
    }

    Civilization {
        habitability,
        livelihood,
        culture_id,
        realm_id,
        cultures,
        settlements,
        realms,
        trade_routes,
    }
}
