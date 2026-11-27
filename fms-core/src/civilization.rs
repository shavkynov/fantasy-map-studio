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
use std::collections::{BTreeSet, BinaryHeap, HashSet, VecDeque};

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

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[repr(u8)]
pub enum SettlementTier {
    Village = 0,
    Town = 1,
    City = 2,
    Metropolis = 3,
    Capital = 4,
}

impl SettlementTier {
    pub fn name(self) -> &'static str {
        match self {
            SettlementTier::Village => "Деревня",
            SettlementTier::Town => "Посёлок",
            SettlementTier::City => "Город",
            SettlementTier::Metropolis => "Крупный торговый город",
            SettlementTier::Capital => "Столица",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum WildSiteKind {
    HunterCamp = 0,
    Ruins = 1,
}

impl WildSiteKind {
    pub fn name(self) -> &'static str {
        match self {
            WildSiteKind::HunterCamp => "Стоянка охотников",
            WildSiteKind::Ruins => "Древние руины",
        }
    }
}

#[derive(Clone, Debug)]
pub struct WildSite {
    pub id: u32,
    pub name: String,
    pub cell: usize,
    pub kind: WildSiteKind,
}

#[derive(Clone, Debug)]
pub struct Settlement {
    pub id: u32,
    pub name: String,
    pub cell: usize,
    pub role: SettlementRole,
    pub tier: SettlementTier,
    /// Идентификатор государства (`u32::MAX`, если вне государственной досягаемости).
    pub realm_id: u32,
    pub culture_id: u32,
    pub population_score: f32,
    pub resource_score: f32,
    pub food_score: f32,
    pub water_score: f32,
    pub timber_score: f32,
    pub mineral_score: f32,
    pub trade_degree: u16,
    pub is_port: bool,
    pub river_access: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RouteKind {
    Road,
    Riverway,
    SeaLane,
    WildTrail,
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

/// Параметры выборочной генерации цивилизации после построения физической планеты.
#[derive(Clone, Debug, PartialEq, Eq, Hash)]
pub struct CivilizationOptions {
    pub include_realms: bool,
    pub include_cities: bool,
    pub include_routes: bool,
    pub target_realms: usize,
    pub salt: u32,
}

impl Default for CivilizationOptions {
    fn default() -> Self {
        Self {
            include_realms: true,
            include_cities: true,
            include_routes: true,
            target_realms: 0,
            salt: 0,
        }
    }
}

impl CivilizationOptions {
    pub fn none() -> Self {
        Self {
            include_realms: false,
            include_cities: false,
            include_routes: false,
            target_realms: 0,
            salt: 0,
        }
    }
}

/// Итоги расчёта антропогеографии планеты: пригодность, уклады, культуры, города, державы и пути сообщения.
#[derive(Clone, Debug)]
pub struct Civilization {
    pub habitability: Vec<f32>,
    pub livelihood: Vec<Livelihood>,
    pub culture_id: Vec<i32>,
    pub realm_id: Vec<i32>,
    pub is_wild: Vec<u8>,
    pub cultures: Vec<Culture>,
    pub settlements: Vec<Settlement>,
    pub wild_sites: Vec<WildSite>,
    pub realms: Vec<Realm>,
    pub trade_routes: Vec<TradeRoute>,
}

impl Civilization {
    /// Строит чистую природную антропогеографическую основу (пригодность, ресурсы и дикие земли) без стран, городов и дорог.
    pub fn physical_only(
        grid: &Grid,
        erosion: &ErosionResult,
        climate: &Climate,
        hydrology: &Hydrology,
        biomes: &Biomes,
        geography: &Geography,
        resources: &Resources,
    ) -> Self {
        let n = grid.len();
        let basket = resource_and_wild_fields(
            grid, erosion, climate, hydrology, biomes, geography, resources,
        );
        Self {
            habitability: basket.habitability,
            livelihood: basket.livelihood,
            culture_id: vec![-1; n],
            realm_id: vec![-1; n],
            is_wild: basket.is_wild,
            cultures: Vec::new(),
            settlements: Vec::new(),
            wild_sites: Vec::new(),
            realms: Vec::new(),
            trade_routes: Vec::new(),
        }
    }
}

/// Расстояние каждой морской ячейки до ближайшего берега (0 на суше, 1..=5 в море, 255 дальше 5 шагов).
pub fn compute_ocean_coast_dist(grid: &Grid, is_ocean: &[u8]) -> Vec<u8> {
    let n = grid.len();
    let mut dist = vec![255u8; n];
    let mut q = VecDeque::with_capacity(n / 4);
    for i in 0..n {
        if is_ocean[i] == 0 {
            dist[i] = 0;
            q.push_back(i);
        }
    }
    while let Some(c) = q.pop_front() {
        let d = dist[c];
        if d >= 5 {
            continue;
        }
        let (nbs, cnt) = grid.neighbors8(c);
        for &nb in &nbs[..cnt] {
            if dist[nb] == 255 {
                dist[nb] = d + 1;
                q.push_back(nb);
            }
        }
    }
    dist
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
    permafrost: &[f32],
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
    let perma_pen = 2.4 * (permafrost[v] as f64).clamp(0.0, 1.0);
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
    dist_km
        * (1.0 + slope_pen + alt_pen + biome_pen + perma_pen + river_cross_pen)
        * valley_mult
        * reuse_mult
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
                &planet.climate.permafrost,
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

/// Прокладывает морской путь по открытой воде с учётом шельфа, ветров/течений и обходом полярных льдов.
pub fn route_sea_lane(planet: &Planet, from_cell: usize, to_cell: usize) -> Option<Vec<usize>> {
    let grid = &planet.grid;
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    if from_cell >= n || to_cell >= n {
        return None;
    }

    let snap_sea = |seed_cell: usize| -> Option<usize> {
        let (sx, sy) = grid.xy(seed_cell);
        let mut best = None;
        let mut best_score = f64::INFINITY;
        for rad in 0isize..=6 {
            for dy in -rad..=rad {
                let yy = sy as isize + dy;
                if yy < 0 || yy >= h as isize {
                    continue;
                }
                for dx in -rad..=rad {
                    let xx = grid.wrap_x(sx as isize + dx);
                    let c = grid.idx(xx, yy as usize);
                    if planet.hydrology.is_ocean[c] == 0 {
                        continue;
                    }
                    let d = (dx as f64).hypot(dy as f64);
                    let ice_pen = if planet.climate.temp_c[c] < -8.0 { 10.0 } else { 0.0 };
                    let sc = d + ice_pen;
                    if sc < best_score {
                        best_score = sc;
                        best = Some(c);
                    }
                }
            }
            if best.is_some() {
                break;
            }
        }
        best
    };

    let start = snap_sea(from_cell)?;
    let goal = snap_sea(to_cell)?;
    if start == goal {
        return Some(vec![start]);
    }

    let dy_km = grid.dy_km();
    let dx_row: Vec<f64> = (0..h).map(|y| grid.dx_km(y)).collect();
    let ocean_coast_dist = compute_ocean_coast_dist(grid, &planet.hydrology.is_ocean);
    let (sx0, sy0) = grid.xy(start);
    let (gx0, gy0) = grid.xy(goal);
    let u_start = grid.unit_vec(sx0, sy0);
    let u_goal = grid.unit_vec(gx0, gy0);
    let port_clear_km = (2.2 * dy_km.max(dx_row[sy0]).max(dx_row[gy0])).clamp(60.0, 260.0);

    let dy_km_v = dy_km;
    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    dist[start] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(DijkNode {
        cost: 0.0,
        cell: start,
        realm: 0,
    });

    while let Some(DijkNode { cost, cell, .. }) = heap.pop() {
        if cost > dist[cell] + 1e-6 {
            continue;
        }
        if cell == goal {
            break;
        }
        let (ux, uy) = (cell % w, cell / w);
        let (nbs, cnt) = grid.neighbors8(cell);
        for &nb in &nbs[..cnt] {
            if planet.hydrology.is_ocean[nb] == 0 {
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
            let step_e_km = (dxi as f64) * dx_row[uy];
            let step_n_km = -(dyi as f64) * dy_km_v;
            let dist_km = step_e_km.hypot(step_n_km).max(1.0);
            let dir_e = step_e_km / dist_km;
            let dir_n = step_n_km / dist_km;
            let wu = 0.5 * (planet.climate.wind_u_jan[cell] + planet.climate.wind_u_jul[cell]) as f64;
            let wv = 0.5 * (planet.climate.wind_v_jan[cell] + planet.climate.wind_v_jul[cell]) as f64;
            let cu = planet.currents.u[cell] as f64;
            let cv = planet.currents.v[cell] as f64;
            let align =
                (0.55 * (wu * dir_e + wv * dir_n) + 0.45 * (cu * dir_e + cv * dir_n)).clamp(-1.2, 1.2);
            let sail_mult = (1.0 - 0.30 * align).clamp(0.60, 1.45);
            let shelf_f = match planet.geography.marine_zone[nb] {
                MarineZone::Bay | MarineZone::Strait | MarineZone::MarginalSea => 0.88,
                MarineZone::OpenOcean if planet.erosion.elevation_km[nb] >= -0.30 => 0.90,
                _ => 0.98,
            };
            let u_nb = grid.unit_vec(vx, vy);
            let near_terminal = grid.spherical_dist_km(u_nb, u_start) < port_clear_km
                || grid.spherical_dist_km(u_nb, u_goal) < port_clear_km;
            let coast_clearance = if planet.geography.marine_zone[nb] == MarineZone::Strait || near_terminal {
                1.0
            } else {
                match ocean_coast_dist[nb] {
                    1 => 1.85,
                    2 => 1.08,
                    _ => 0.86,
                }
            };
            let ice_pen = if planet.climate.temp_c[nb] < -9.0 { 6.0 } else { 1.0 };
            let nc = cost + dist_km * sail_mult * shelf_f * coast_clearance * ice_pen;
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

    if !dist[goal].is_finite() {
        return None;
    }
    let mut path = Vec::new();
    let mut cur = goal;
    while cur != usize::MAX {
        path.push(cur);
        if cur == start {
            break;
        }
        cur = prev[cur];
    }
    if path.last() != Some(&start) {
        return None;
    }
    path.reverse();
    Some(path)
}

struct ResourceBaskets {
    habitability: Vec<f32>,
    livelihood: Vec<Livelihood>,
    hab_area_km2: f64,
    is_coastal_land: Vec<u8>,
    water_score: Vec<f32>,
    food_score: Vec<f32>,
    timber_score: Vec<f32>,
    mineral_score: Vec<f32>,
    resource_score: Vec<f32>,
    is_wild: Vec<u8>,
}

#[allow(clippy::too_many_arguments)]
fn resource_and_wild_fields(
    grid: &Grid,
    erosion: &ErosionResult,
    climate: &Climate,
    hydrology: &Hydrology,
    biomes: &Biomes,
    geography: &Geography,
    resources: &Resources,
) -> ResourceBaskets {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    let area_row: Vec<f64> = (0..h).map(|y| grid.cell_area_km2(y)).collect();
    let slope = slope_field(&erosion.elevation_km, grid);

    let mut dep_rich = vec![0.0f32; n];
    for d in &resources.deposits {
        dep_rich[d.cell] = dep_rich[d.cell].max(d.richness);
        let (nbs, cnt) = grid.neighbors8(d.cell);
        for &nb in &nbs[..cnt] {
            dep_rich[nb] = dep_rich[nb].max(d.richness * 0.72);
        }
    }

    let mut is_pass_near = vec![0u8; n];
    for p in &geography.passes {
        is_pass_near[p.cell] = 1;
        let (nbs, cnt) = grid.neighbors8(p.cell);
        for &nb in &nbs[..cnt] {
            is_pass_near[nb] = 1;
        }
    }

    // Окрестностный потенциал древесины и ископаемых (радиус 2 ячейки)
    let mut local_timber = vec![0.0f32; n];
    let mut local_mineral = vec![0.0f32; n];
    for y in 0..h {
        let y0 = y.saturating_sub(2);
        let y1 = (y + 2).min(h - 1);
        for x in 0..w {
            let i = y * w + x;
            if hydrology.is_ocean[i] != 0 || hydrology.is_lake[i] != 0 {
                continue;
            }
            let mut best_t = resources.timber[i].max(0.55 * resources.coal[i]);
            let mut best_m = dep_rich[i].max(
                resources.iron[i]
                    .max(resources.copper_gold[i])
                    .max(resources.gems_rare[i])
                    .max(resources.coal[i])
                    .max(resources.salt[i])
                    .max(resources.hydrocarbons[i]),
            );
            for yy in y0..=y1 {
                for dx in -2isize..=2 {
                    let xx = grid.wrap_x(x as isize + dx);
                    let c = yy * w + xx;
                    if hydrology.is_ocean[c] != 0 {
                        continue;
                    }
                    let atten = if dx.abs() <= 1 && (yy as isize - y as isize).abs() <= 1 {
                        0.85
                    } else {
                        0.62
                    };
                    let t_c = resources.timber[c].max(0.50 * resources.coal[c]) * atten;
                    let m_c = dep_rich[c].max(
                        resources.iron[c]
                            .max(resources.copper_gold[c])
                            .max(resources.gems_rare[c])
                            .max(resources.coal[c])
                            .max(resources.salt[c]),
                    ) * atten;
                    if t_c > best_t { best_t = t_c; }
                    if m_c > best_m { best_m = m_c; }
                }
            }
            local_timber[i] = best_t.clamp(0.0, 1.0);
            local_mineral[i] = best_m.clamp(0.0, 1.0);
        }
    }

    let mut habitability = vec![0.0f32; n];
    let mut livelihood = vec![Livelihood::Uninhabitable; n];
    let mut is_coastal_land = vec![0u8; n];
    let mut water_score = vec![0.0f32; n];
    let mut food_score = vec![0.0f32; n];
    let mut timber_score = vec![0.0f32; n];
    let mut mineral_score = vec![0.0f32; n];
    let mut resource_score = vec![0.0f32; n];
    let mut is_wild = vec![0u8; n];
    let mut hab_area_km2 = 0.0f64;

    for y in 0..h {
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            if hydrology.is_ocean[i] != 0 || hydrology.is_lake[i] != 0 {
                continue;
            }
            if hydrology.is_salt_flat[i] != 0 || climate.glacier[i] > 0.35 {
                is_wild[i] = 1;
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
            let mut lake_fish = 0.0f32;
            let (nbs8, cnt8) = grid.neighbors8(i);
            let mut near_bay = false;
            for &nb in &nbs8[..cnt8] {
                if hydrology.is_lake[nb] != 0 && hydrology.is_endorheic_lake[nb] == 0 {
                    adj_fresh_lake = true;
                    lake_fish = lake_fish.max(resources.fishery[nb]);
                }
                if hydrology.is_ocean[nb] != 0 {
                    max_fish = max_fish.max(resources.fishery[nb] * 0.9);
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
            let rain_water = (ai / 0.62).clamp(0.0, 1.0);
            let river_irrig = ((hydrology.discharge_m3s[i] as f64 / 2000.0).clamp(0.0, 1.0))
                .max(if hydrology.river_mask[i] != 0 { 0.58 } else { 0.0 })
                .max(if adj_fresh_lake { 0.85 } else { 0.0 })
                .max(if hydrology.is_oasis[i] != 0 { 0.72 } else { 0.0 })
                .max(if hydrology.is_wadi[i] != 0 { 0.22 } else { 0.0 });
            let flat_f = (1.0 - (slope[i] as f64 / 0.07).clamp(0.0, 1.0)).max(0.15);

            let rain_agr = biomes.soil_fertility[i] as f64 * rain_water * grow_f;
            let alluv_soil = (0.38
                + 0.48 * (erosion.alluvium_km[i] as f64 / 0.08).clamp(0.0, 1.0))
            .clamp(0.0, 1.0);
            let irrig_agr = alluv_soil * river_irrig * grow_f * flat_f * 0.94;
            let agr_score = rain_agr.max(irrig_agr);

            let b = biomes.biome[i];
            let pastoral_score = if matches!(b, Biome::TemperateGrassland | Biome::TropicalSavanna)
                || ((0.14..=0.55).contains(&ai) && t_warm > 10.0 && elev < 3.0)
            {
                0.36 * ((t_warm - 6.0) / 14.0).clamp(0.25, 1.0) * flat_f
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

            let w_sc = rain_water
                .max(river_irrig)
                .max(if hydrology.river_mask[i] != 0 { 0.55 } else { 0.0 })
                .clamp(0.0, 1.0);
            let f_sc = agr_score
                .max(pastoral_score * 0.90)
                .max((max_fish.max(lake_fish) as f64) * 0.72 * ((t_warm - 2.0) / 12.0).clamp(0.15, 1.0))
                .clamp(0.0, 1.0);
            let t_sc = local_timber[i] as f64;
            let m_sc = local_mineral[i] as f64;
            let r_sc = (0.36 * f_sc + 0.28 * w_sc + 0.16 * t_sc + 0.12 * m_sc + 0.08 * maritime_score.max(best))
                .clamp(0.0, 1.0);

            water_score[i] = w_sc as f32;
            food_score[i] = f_sc as f32;
            timber_score[i] = t_sc as f32;
            mineral_score[i] = m_sc as f32;
            resource_score[i] = r_sc as f32;

            let harsh_biome = matches!(b, Biome::IceSheet | Biome::PolarDesert | Biome::SaltFlat)
                || (matches!(b, Biome::HotDesert | Biome::ColdDesert)
                    && hydrology.is_oasis[i] == 0
                    && w_sc < 0.28)
                || (b == Biome::Alpine && elev > 2.05 && dep_rich[i] < 0.50 && is_pass_near[i] == 0)
                || climate.permafrost[i] > 0.55;
            if harsh_biome || best < 0.09 || w_sc < 0.16 || f_sc < 0.14 {
                is_wild[i] = 1;
            }

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

    ResourceBaskets {
        habitability,
        livelihood,
        hab_area_km2,
        is_coastal_land,
        water_score,
        food_score,
        timber_score,
        mineral_score,
        resource_score,
        is_wild,
    }
}

/// Вычисляет физически обусловленную пригодность к жизни и хозяйственный уклад без поселений и границ.
pub fn compute_habitability_and_livelihood(
    grid: &Grid,
    erosion: &ErosionResult,
    climate: &Climate,
    hydrology: &Hydrology,
    biomes: &Biomes,
    geography: &Geography,
    resources: &Resources,
) -> (Vec<f32>, Vec<Livelihood>) {
    let b = resource_and_wild_fields(
        grid, erosion, climate, hydrology, biomes, geography, resources,
    );
    (b.habitability, b.livelihood)
}

/// Строит цивилизации, города и торговые пути согласно флагам `opt`.
#[allow(clippy::too_many_arguments)]
pub fn simulate_with_options(
    grid: &Grid,
    erosion: &ErosionResult,
    currents: &Currents,
    climate: &Climate,
    hydrology: &Hydrology,
    biomes: &Biomes,
    geography: &Geography,
    resources: &Resources,
    opt: &CivilizationOptions,
    seed: &str,
) -> Civilization {
    if !opt.include_realms && !opt.include_cities && !opt.include_routes {
        return Civilization::physical_only(
            grid, erosion, climate, hydrology, biomes, geography, resources,
        );
    }

    let eff_seed = if opt.salt == 0 {
        seed.to_string()
    } else {
        format!("{seed}#civ{}", opt.salt)
    };
    let mut civ = simulate(
        grid,
        erosion,
        currents,
        climate,
        hydrology,
        biomes,
        geography,
        resources,
        opt.target_realms,
        &eff_seed,
    );

    if opt.include_realms && !opt.include_cities {
        civ.settlements
            .retain(|s| s.role == SettlementRole::Capital);
        let kept: HashSet<u32> = civ.settlements.iter().map(|s| s.id).collect();
        if opt.include_routes {
            civ.trade_routes
                .retain(|tr| kept.contains(&tr.from_settlement) && kept.contains(&tr.to_settlement));
        } else {
            civ.trade_routes.clear();
        }
        civ.wild_sites.clear();
    } else {
        if !opt.include_realms {
            civ.realms.clear();
            civ.realm_id.fill(-1);
            civ.cultures.clear();
            civ.culture_id.fill(-1);
            for s in &mut civ.settlements {
                s.realm_id = u32::MAX;
                if s.role == SettlementRole::Capital {
                    s.role = SettlementRole::MarketTown;
                    s.tier = if s.trade_degree >= 2 && s.resource_score >= 0.42 {
                        SettlementTier::Metropolis
                    } else if s.resource_score >= 0.34 {
                        SettlementTier::City
                    } else {
                        SettlementTier::Town
                    };
                }
            }
        }
        if !opt.include_routes {
            civ.trade_routes.clear();
        }
    }
    civ
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
    let mut is_portage = vec![0u8; n];
    for wf in &hydrology.waterfalls {
        is_portage[wf.cell] = 1;
        let r = hydrology.receiver[wf.cell];
        if r >= 0 && hydrology.is_ocean[r as usize] == 0 && hydrology.is_lake[r as usize] == 0 {
            is_portage[r as usize] = 1;
        }
    }

    // 1. Пригодность к жизни, ресурсные корзины и зоны диких/опасных земель
    let baskets = resource_and_wild_fields(
        grid, erosion, climate, hydrology, biomes, geography, resources,
    );
    let habitability = baskets.habitability;
    let livelihood = baskets.livelihood;
    let hab_area_km2 = baskets.hab_area_km2;
    let is_coastal_land = baskets.is_coastal_land;
    let water_score = baskets.water_score;
    let food_score = baskets.food_score;
    let timber_score = baskets.timber_score;
    let mineral_score = baskets.mineral_score;
    let resource_score = baskets.resource_score;
    let is_wild = baskets.is_wild;

    // 2. Иерархическое размещение поселений по ресурсам и дистанции (города не стоят вплотную друг к другу)
    let mut hinterland = habitability.clone();
    let r_hint = ((w as f64 / 120.0).round() as usize).max(1);
    blur_xwrap(&mut hinterland, w, h, r_hint);

    let mut site_scores = vec![0.0f32; n];
    let mut site_cands: Vec<(usize, f32)> = Vec::new();
    for i in 0..n {
        if is_wild[i] != 0 || habitability[i] < 0.09 || water_score[i] < 0.16 || food_score[i] < 0.14 {
            continue;
        }
        let hab = habitability[i];
        let mut score = 0.42 * resource_score[i] + 0.24 * hab + 0.34 * hinterland[i];
        if is_confluence[i] != 0 {
            score += 0.38;
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
            score += if is_pass_zone[i] == 2 { 0.28 } else { 0.16 };
        }
        if hydrology.is_oasis[i] != 0 {
            score += 0.26;
        }
        if hydrology.is_delta[i] != 0 && climate.permafrost[i] < 0.25 {
            score += 0.24;
        }
        if is_portage[i] != 0 {
            score += 0.14;
        }
        if deposit_bonus[i] >= 0.50 {
            score += 0.24 * deposit_bonus[i];
        }
        score -= 4.2 * slope[i];
        if erosion.elevation_km[i] > 1.85 && is_pass_zone[i] == 0 && deposit_bonus[i] < 0.50 {
            score -= 0.45 * (erosion.elevation_km[i] - 1.85);
        }
        site_scores[i] = score;
        site_cands.push((i, score));
    }

    site_cands.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

    let auto_realms = if target_realms > 0 {
        target_realms
    } else {
        ((hab_area_km2 / 4_400_000.0).round() as usize).clamp(4, 8)
    };

    // Проход 1: крупные городские центры (будущие столицы и большие города, строгий ценз ресурсов и дистанции)
    // Проход 2: специализированные города/порты/крепости/посёлки
    // Проход 3: деревни
    let max_major = ((hab_area_km2 / 1_900_000.0).round() as usize).clamp(auto_realms.max(6), 16);
    let max_towns = ((hab_area_km2 / 980_000.0).round() as usize).clamp(12, 30);
    let max_settlements = ((hab_area_km2 / 580_000.0).round() as usize).clamp(16, 52);

    // (cell, score, from_major_pass)
    let mut raw_sites: Vec<(usize, f32, bool)> = Vec::new();
    let far_enough = |sites: &[(usize, f32, bool)], cell: usize, min_km: f64| -> bool {
        let (cx, cy) = grid.xy(cell);
        let uc = grid.unit_vec(cx, cy);
        !sites.iter().any(|&(other, _, _)| {
            let (ox, oy) = grid.xy(other);
            grid.spherical_dist_km(uc, grid.unit_vec(ox, oy)) < min_km
        })
    };

    for sep in [600.0f64, 460.0] {
        for &(cell, score) in &site_cands {
            if raw_sites.len() >= max_major {
                break;
            }
            if raw_sites.iter().any(|&(c, _, _)| c == cell) {
                continue;
            }
            let rich_basket = resource_score[cell] >= 0.34
                && food_score[cell] >= 0.24
                && water_score[cell] >= 0.26
                && (timber_score[cell] >= 0.12
                    || mineral_score[cell] >= 0.35
                    || is_coastal_land[cell] != 0);
            if !rich_basket {
                continue;
            }
            if far_enough(&raw_sites, cell, sep) {
                raw_sites.push((cell, score, true));
            }
        }
        if raw_sites.len() >= (auto_realms + 3).min(max_major) {
            break;
        }
    }

    for sep in [320.0f64, 240.0] {
        for &(cell, score) in &site_cands {
            if raw_sites.len() >= max_towns {
                break;
            }
            if raw_sites.iter().any(|&(c, _, _)| c == cell) {
                continue;
            }
            let town_basket = water_score[cell] >= 0.18
                && ((food_score[cell] >= 0.18 && resource_score[cell] >= 0.23)
                    || deposit_bonus[cell] >= 0.48
                    || is_pass_zone[cell] != 0
                    || hydrology.is_oasis[cell] != 0);
            if !town_basket {
                continue;
            }
            if far_enough(&raw_sites, cell, sep) {
                raw_sites.push((cell, score, false));
            }
        }
        if raw_sites.len() >= auto_realms.max(8) {
            break;
        }
    }

    for sep in [190.0f64, 130.0] {
        for &(cell, score) in &site_cands {
            if raw_sites.len() >= max_settlements {
                break;
            }
            if raw_sites.iter().any(|&(c, _, _)| c == cell) {
                continue;
            }
            if far_enough(&raw_sites, cell, sep) {
                raw_sites.push((cell, score, false));
            }
        }
        if raw_sites.len() >= auto_realms.max(12) {
            break;
        }
    }

    let desired_realms = auto_realms.min(raw_sites.len());

    let mut is_capital_idx = vec![false; raw_sites.len()];
    let mut capital_indices: Vec<usize> = Vec::new();
    for min_cap_sep in [900.0f64, 620.0, 380.0, 220.0] {
        for (idx, &(cell, _, _)) in raw_sites.iter().enumerate() {
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
    for &(cell, _, _) in &raw_sites {
        if is_coastal_land[cell] != 0 {
            is_port_settlement[cell] = 1;
        }
    }

    // 3. Физическая анизотропная функция транспортных затрат u -> v (с морским отступом от берега)
    let dy_km = grid.dy_km();
    let dx_row: Vec<f64> = (0..h).map(|y| grid.dx_km(y)).collect();
    let ocean_coast_dist = compute_ocean_coast_dist(grid, &hydrology.is_ocean);

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
                &climate.permafrost,
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
                MarineZone::Bay => 0.36,
                MarineZone::Strait | MarineZone::MarginalSea => 0.36,
                MarineZone::OpenOcean => {
                    if erosion.elevation_km[v] >= -0.30 {
                        0.38
                    } else {
                        0.48
                    }
                }
                MarineZone::Land => 1.0,
            };
            let coast_clearance = if geography.marine_zone[v] == MarineZone::Strait {
                1.0
            } else {
                match ocean_coast_dist[v] {
                    1 => 1.85,
                    2 => 1.08,
                    _ => 0.86,
                }
            };
            dist_km * (zone_f * sail_mult * coast_clearance + sea_ice_pen)
        }
    };

    // 3b. Этнокультурные ареалы и географическая изоляция (до расселения государств)
    let num_cultures = ((hab_area_km2 / 3_500_000.0).round() as usize)
        .clamp(4, 12)
        .min(raw_sites.len());
    let mut hearth_cells: Vec<usize> = Vec::new();
    let mut covered_lm = BTreeSet::new();
    for &(cell, _, _) in &raw_sites {
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
        for &(cell, _, _) in &raw_sites {
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

    let natural_role_for = |cell: usize| -> SettlementRole {
        let is_port = is_coastal_land[cell] != 0;
        let river_access = hydrology.river_mask[cell] != 0 || hydrology.discharge_m3s[cell] > 2200.0;
        if is_port && (is_estuary[cell] != 0 || matches!(hydrology.coast_type[cell], 2 | 4)) {
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
        }
    };

    let mut settlements = Vec::with_capacity(raw_sites.len());
    let max_score = raw_sites.first().map(|s| s.1).unwrap_or(1.0).max(0.1);

    for (idx, &(cell, score, from_major)) in raw_sites.iter().enumerate() {
        let is_port = is_coastal_land[cell] != 0;
        let river_access = hydrology.river_mask[cell] != 0 || hydrology.discharge_m3s[cell] > 2200.0;
        let role = if is_capital_idx[idx] {
            SettlementRole::Capital
        } else {
            natural_role_for(cell)
        };
        let init_tier = if is_capital_idx[idx] {
            SettlementTier::Capital
        } else if from_major {
            SettlementTier::City
        } else if role != SettlementRole::MarketTown || resource_score[cell] >= 0.24 {
            SettlementTier::Town
        } else {
            SettlementTier::Village
        };

        let cid = nearest_culture(cell);
        let prof = cultures
            .get(cid as usize)
            .map(|c| c.phonology_profile)
            .unwrap_or(4);
        let name = toponymy::settlement_name(prof, role, &mut name_rng, &mut used_names);
        let pop_score = ((score / max_score) * 100.0).clamp(12.0, 100.0);
        settlements.push(Settlement {
            id: idx as u32,
            name,
            cell,
            role,
            tier: init_tier,
            realm_id: u32::MAX,
            culture_id: cid,
            population_score: pop_score,
            resource_score: resource_score[cell],
            food_score: food_score[cell],
            water_score: water_score[cell],
            timber_score: timber_score[cell],
            mineral_score: mineral_score[cell],
            trade_degree: 0,
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

    // Проверяем, что столица каждой державы находится в самом выгодном и богатом месте государства
    for ru in 0..realms.len() {
        let rid_i32 = ru as i32;
        let cur_cap_idx = settlements
            .iter()
            .position(|s| s.id == realms[ru].capital_settlement_id);
        let mut best_idx = cur_cap_idx;
        let mut best_cap_val = f64::NEG_INFINITY;
        for (idx, s) in settlements.iter().enumerate() {
            if realm_id[s.cell] != rid_i32 {
                continue;
            }
            let (sx, sy) = grid.xy(s.cell);
            let us = grid.unit_vec(sx, sy);
            let near_other_cap = realms.iter().enumerate().any(|(oru, or)| {
                if oru == ru {
                    return false;
                }
                let (ox, oy) = grid.xy(or.capital_cell);
                grid.spherical_dist_km(us, grid.unit_vec(ox, oy)) < 260.0
            });
            if near_other_cap && Some(idx) != cur_cap_idx {
                continue;
            }
            let (nbs8, cnt8) = grid.neighbors8(s.cell);
            let border_edge = nbs8[..cnt8]
                .iter()
                .any(|&nb| realm_id[nb] >= 0 && realm_id[nb] != rid_i32);
            let val = site_scores[s.cell] as f64
                + 0.25 * s.resource_score as f64
                - if border_edge { 0.14 } else { 0.0 };
            if val > best_cap_val {
                best_cap_val = val;
                best_idx = Some(idx);
            }
        }
        if let (Some(old_i), Some(new_i)) = (cur_cap_idx, best_idx) {
            if old_i != new_i {
                is_capital_idx[old_i] = false;
                is_capital_idx[new_i] = true;
                let old_cell = settlements[old_i].cell;
                settlements[old_i].role = natural_role_for(old_cell);
                settlements[new_i].role = SettlementRole::Capital;
                settlements[new_i].tier = SettlementTier::Capital;
                let new_id = settlements[new_i].id;
                let new_cell = settlements[new_i].cell;
                realms[ru].capital_settlement_id = new_id;
                realms[ru].capital_cell = new_cell;
            }
        }
    }

    // 5. Сухопутные, речные и морские торговые пути между важнейшими узлами
    let mut hub_indices: Vec<usize> = Vec::with_capacity(settlements.len().min(38));
    for (idx, s) in settlements.iter().enumerate() {
        if s.role == SettlementRole::Capital {
            hub_indices.push(idx);
        }
    }
    for (idx, _) in settlements.iter().enumerate() {
        if hub_indices.len() >= settlements.len().min(38) {
            break;
        }
        if !hub_indices.contains(&idx) {
            hub_indices.push(idx);
        }
    }

    let mut pairs: BTreeSet<(usize, usize)> = BTreeSet::new();
    for &a in &hub_indices {
        let (ax, ay) = grid.xy(settlements[a].cell);
        let ua = grid.unit_vec(ax, ay);
        let mut cands: Vec<(usize, f64)> = Vec::new();
        for &b in &hub_indices {
            if a == b {
                continue;
            }
            let (bx, by) = grid.xy(settlements[b].cell);
            let d = grid.spherical_dist_km(ua, grid.unit_vec(bx, by));
            if d <= 3100.0 {
                cands.push((b, d));
            }
        }
        cands.sort_by(|x, y| x.1.total_cmp(&y.1).then_with(|| x.0.cmp(&y.0)));
        let take_n = if settlements[a].role == SettlementRole::Capital { 3 } else { 2 };
        for &(b, _) in cands.iter().take(take_n) {
            let p = if a < b { (a, b) } else { (b, a) };
            pairs.insert(p);
        }
    }

    let mut adj_targets: Vec<Vec<usize>> = vec![Vec::new(); settlements.len()];
    for &(a, b) in &pairs {
        adj_targets[a].push(b);
    }

    let mut trade_routes = Vec::new();
    let mut road_used = vec![0u8; n];
    let mut dist = vec![f64::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    let mut visited = Vec::with_capacity(n / 4);
    let max_route_cost = 4600.0f64;

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

    // 5b. Подсчёт торговой связности, иерархии статусов и итоговой численности от ресурсов + путей
    let mut cell_to_sett: Vec<i32> = vec![-1; n];
    for (si, s) in settlements.iter().enumerate() {
        cell_to_sett[s.cell] = si as i32;
    }
    let mut deg_acc = vec![0u16; settlements.len()];
    for tr in &trade_routes {
        let mut hit = vec![false; settlements.len()];
        if let Some(i0) = settlements.iter().position(|s| s.id == tr.from_settlement) {
            hit[i0] = true;
        }
        if let Some(i1) = settlements.iter().position(|s| s.id == tr.to_settlement) {
            hit[i1] = true;
        }
        for &c in &tr.cells {
            if cell_to_sett[c] >= 0 {
                hit[cell_to_sett[c] as usize] = true;
            }
            let (nbs8, cnt8) = grid.neighbors8(c);
            for &nb in &nbs8[..cnt8] {
                if cell_to_sett[nb] >= 0 {
                    hit[cell_to_sett[nb] as usize] = true;
                }
            }
        }
        for (si, &h_flag) in hit.iter().enumerate() {
            if h_flag {
                deg_acc[si] = deg_acc[si].saturating_add(1);
            }
        }
    }

    let mut major_positions: Vec<usize> = Vec::new();
    for s in &settlements {
        if s.role == SettlementRole::Capital {
            major_positions.push(s.cell);
        }
    }
    for (idx, s) in settlements.iter_mut().enumerate() {
        s.trade_degree = deg_acc[idx];
        let is_major_seed = raw_sites[idx].2;
        if s.role == SettlementRole::Capital {
            s.tier = SettlementTier::Capital;
            s.population_score = (84.0 + 16.0 * s.resource_score).clamp(84.0, 100.0);
            continue;
        }
        let (sx, sy) = grid.xy(s.cell);
        let us = grid.unit_vec(sx, sy);
        let min_major_d = major_positions
            .iter()
            .map(|&mc| {
                let (mx, my) = grid.xy(mc);
                grid.spherical_dist_km(us, grid.unit_vec(mx, my))
            })
            .fold(f64::INFINITY, f64::min);

        if is_major_seed && s.trade_degree >= 2 && s.resource_score >= 0.40 && min_major_d >= 460.0 {
            s.tier = SettlementTier::Metropolis;
            s.population_score = (70.0 + 12.0 * s.resource_score).clamp(70.0, 82.0);
            major_positions.push(s.cell);
        } else if (is_major_seed || (s.resource_score >= 0.34 && s.trade_degree >= 1))
            && min_major_d >= 420.0
        {
            s.tier = SettlementTier::City;
            s.population_score = (52.0 + 16.0 * s.resource_score).clamp(52.0, 68.0);
            major_positions.push(s.cell);
        } else if matches!(
            s.role,
            SettlementRole::Port
                | SettlementRole::PassFortress
                | SettlementRole::MiningTown
                | SettlementRole::OasisTown
                | SettlementRole::RiverHub
        ) || (s.resource_score >= 0.25 && s.trade_degree >= 1)
        {
            s.tier = SettlementTier::Town;
            s.population_score = (32.0 + 18.0 * s.resource_score).clamp(32.0, 50.0);
        } else {
            s.tier = SettlementTier::Village;
            s.population_score = (12.0 + 18.0 * s.resource_score).clamp(12.0, 30.0);
        }
    }

    // 6. Стоянки охотников, древние руины и особые тропы в диких/опасных землях
    let mut wild_cands: Vec<(usize, WildSiteKind, f32)> = Vec::new();
    for i in 0..n {
        if is_wild[i] == 0
            || hydrology.is_ocean[i] != 0
            || hydrology.is_lake[i] != 0
            || climate.glacier[i] > 0.72
        {
            continue;
        }
        let b = biomes.biome[i];
        let (cx, cy) = grid.xy(i);
        let uc = grid.unit_vec(cx, cy);
        let near_sett = settlements.iter().any(|s| {
            let (sx, sy) = grid.xy(s.cell);
            grid.spherical_dist_km(uc, grid.unit_vec(sx, sy)) < 220.0
        });
        if near_sett {
            continue;
        }
        if matches!(
            b,
            Biome::BorealForest
                | Biome::Tundra
                | Biome::TemperateRainforest
                | Biome::Alpine
                | Biome::TemperateForest
        ) && (resources.timber[i] > 0.18 || hydrology.discharge_m3s[i] > 120.0)
        {
            let sc = 0.55 * resources.timber[i]
                + 0.35 * (hydrology.discharge_m3s[i] / 2500.0).clamp(0.0, 1.0)
                + 0.25 * (1.0 - slope[i] * 8.0).clamp(0.0, 1.0);
            wild_cands.push((i, WildSiteKind::HunterCamp, sc));
        } else if matches!(
            b,
            Biome::HotDesert | Biome::ColdDesert | Biome::SaltFlat | Biome::TropicalRainforest | Biome::Alpine
        ) {
            let sc = 0.35 * if hydrology.is_wadi[i] != 0 { 1.0 } else { 0.3 }
                + 0.30 * (world_elev_or_incision_score(erosion.incised_km[i], erosion.alluvium_km[i]))
                + 0.25 * mineral_score[i];
            wild_cands.push((i, WildSiteKind::Ruins, sc));
        }
    }
    wild_cands.sort_by(|a, b| b.2.total_cmp(&a.2).then_with(|| a.0.cmp(&b.0)));

    let mut wild_sites: Vec<WildSite> = Vec::new();
    let max_wild = 14usize;
    for (cell, kind, _) in wild_cands {
        if wild_sites.len() >= max_wild {
            break;
        }
        let (cx, cy) = grid.xy(cell);
        let uc = grid.unit_vec(cx, cy);
        let too_close = wild_sites.iter().any(|ws| {
            let (wx, wy) = grid.xy(ws.cell);
            grid.spherical_dist_km(uc, grid.unit_vec(wx, wy)) < 540.0
        });
        if too_close {
            continue;
        }
        let cid = nearest_culture(cell);
        let prof = cultures
            .get(cid as usize)
            .map(|c| c.phonology_profile)
            .unwrap_or(5);
        let name = toponymy::wild_site_name(prof, kind, &mut name_rng, &mut used_names);
        wild_sites.push(WildSite {
            id: wild_sites.len() as u32,
            name,
            cell,
            kind,
        });
    }

    // Особые охотничьи/караванные тропы от ближайших пограничных поселений к стоянкам и руинам
    let mut routed_trails = 0usize;
    for ws in &wild_sites {
        if routed_trails >= 8 {
            break;
        }
        let (wx, wy) = grid.xy(ws.cell);
        let uw = grid.unit_vec(wx, wy);
        let w_lm = geography.landmass_id[ws.cell];
        let mut best_s: Option<(usize, f64)> = None;
        for s in &settlements {
            if w_lm >= 0 && geography.landmass_id[s.cell] != w_lm {
                continue;
            }
            let (sx, sy) = grid.xy(s.cell);
            let d = grid.spherical_dist_km(uw, grid.unit_vec(sx, sy));
            if d <= 1250.0 && best_s.map_or(true, |(_, bd)| d < bd) {
                best_s = Some((s.id as usize, d));
            }
        }
        let Some((s_idx, _)) = best_s else { continue };
        let from_cell = settlements[s_idx].cell;
        if let Some(path) = route_land_road_cells(
            grid,
            from_cell,
            ws.cell,
            &erosion.elevation_km,
            &slope,
            &is_pass_zone,
            hydrology,
            biomes,
            &climate.permafrost,
            &habitability,
            Some(&road_used),
        ) {
            if path.len() >= 2 {
                let segs = vec![RouteKind::WildTrail; path.len() - 1];
                trade_routes.push(TradeRoute {
                    from_settlement: settlements[s_idx].id,
                    to_settlement: u32::MAX,
                    cells: path,
                    segments: segs,
                    cost: 100.0,
                });
                routed_trails += 1;
            }
        }
    }

    Civilization {
        habitability,
        livelihood,
        culture_id,
        realm_id,
        is_wild,
        cultures,
        settlements,
        wild_sites,
        realms,
        trade_routes,
    }
}

#[inline]
fn world_elev_or_incision_score(incised: f32, alluvium: f32) -> f32 {
    ((incised / 1.2) + (alluvium / 0.10)).clamp(0.0, 1.0)
}

#[allow(clippy::too_many_arguments)]
fn route_land_road_cells(
    grid: &Grid,
    from_cell: usize,
    to_cell: usize,
    elev: &[f32],
    slope: &[f32],
    is_pass_zone: &[u8],
    hydrology: &Hydrology,
    biomes: &Biomes,
    permafrost: &[f32],
    habitability: &[f32],
    existing_road_mask: Option<&[u8]>,
) -> Option<Vec<usize>> {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
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
            if hydrology.is_ocean[nb] != 0 || hydrology.is_lake[nb] != 0 {
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
            let nc = cost
                + land_step_cost(
                    cell,
                    nb,
                    dist_km,
                    elev,
                    slope,
                    is_pass_zone,
                    hydrology,
                    biomes,
                    permafrost,
                    habitability,
                    existing_road_mask,
                );
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
