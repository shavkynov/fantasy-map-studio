//! Закономерное распределение природных ресурсов по тектонике, литологии, эрозии, климату и океану:
//! железные и цветные руды, самоцветы, уголь, углеводороды, соль, строевой лес и рыбные промыслы.

use crate::biomes::{Bedrock, Biome, Biomes};
use crate::climate::Climate;
use crate::erosion::ErosionResult;
use crate::grid::{blur_xwrap, distance_to_mask_km, slope_field, Grid};
use crate::hydrology::{Hydrology, MouthKind};
use crate::rng::{Noise, Rng};
use crate::tectonic::World;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum ResourceKind {
    Iron = 0,
    CopperGold = 1,
    GemsRare = 2,
    Coal = 3,
    Hydrocarbons = 4,
    Salt = 5,
    Timber = 6,
    Fishery = 7,
}

impl ResourceKind {
    pub fn name(self) -> &'static str {
        match self {
            ResourceKind::Iron => "Железная руда",
            ResourceKind::CopperGold => "Медь и золото",
            ResourceKind::GemsRare => "Самоцветы и редкие металлы",
            ResourceKind::Coal => "Каменный уголь",
            ResourceKind::Hydrocarbons => "Нефть и газ",
            ResourceKind::Salt => "Соль и эвапориты",
            ResourceKind::Timber => "Строевой лес",
            ResourceKind::Fishery => "Рыбный промысел",
        }
    }
}

/// Крупное дискретное месторождение ископаемых ресурсов.
#[derive(Clone, Debug)]
pub struct Deposit {
    pub kind: ResourceKind,
    pub cell: usize,
    pub richness: f32,
}

/// Поля природных ресурсов планеты (`0..1`) и выделенные месторождения.
#[derive(Clone, Debug)]
pub struct Resources {
    pub iron: Vec<f32>,
    pub copper_gold: Vec<f32>,
    pub gems_rare: Vec<f32>,
    pub coal: Vec<f32>,
    pub hydrocarbons: Vec<f32>,
    pub salt: Vec<f32>,
    pub timber: Vec<f32>,
    pub fishery: Vec<f32>,
    pub deposits: Vec<Deposit>,
}

/// Вычисляет распределение ресурсов и месторождений из геологии, климата, воды и биомов.
pub fn compute(
    grid: &Grid,
    world: &World,
    erosion: &ErosionResult,
    climate: &Climate,
    hydrology: &Hydrology,
    biomes: &Biomes,
    seed: &str,
) -> Resources {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();

    let mut rng_prov = Rng::sub(seed, "resource-provinces");
    let noise_prov = Noise::new(&mut rng_prov);
    let mut rng_vein = Rng::sub(seed, "resource-veins");
    let noise_vein = Noise::new(&mut rng_vein);

    let slope = slope_field(&erosion.elevation_km, grid);
    let mut land_mask = vec![0u8; n];
    for i in 0..n {
        if hydrology.is_ocean[i] == 0 {
            land_mask[i] = 1;
        }
    }
    let dist_to_land_km = distance_to_mask_km(&land_mask, grid);

    // Биогенный вынос крупных рек в прибрежные воды
    let mut estuary_nutrients = vec![0.0f32; n];
    for r in &hydrology.rivers {
        if matches!(r.mouth, MouthKind::Ocean) {
            if let Some(&mouth_cell) = r.cells.last() {
                let boost = (r.max_discharge_m3s / 25_000.0).clamp(0.05, 1.0);
                estuary_nutrients[mouth_cell] = estuary_nutrients[mouth_cell].max(boost);
            }
        }
    }
    let r_est = ((w as f64 / 90.0).round() as usize).max(1);
    blur_xwrap(&mut estuary_nutrients, w, h, r_est);

    let mut iron = vec![0.0f32; n];
    let mut copper_gold = vec![0.0f32; n];
    let mut gems_rare = vec![0.0f32; n];
    let mut coal = vec![0.0f32; n];
    let mut hydrocarbons = vec![0.0f32; n];
    let mut salt = vec![0.0f32; n];
    let mut timber = vec![0.0f32; n];
    let mut fishery = vec![0.0f32; n];

    let t_now = world.stats.time;

    for y in 0..h {
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let p = grid.unit_vec(x, y);
            let prov = 0.5 + 0.5 * noise_prov.fbm(p[0] * 5.0 + 2.1, p[1] * 5.0 - 3.4, p[2] * 5.0 + 1.7, 3);
            let vein = 0.5 + 0.5 * noise_vein.fbm(p[0] * 11.0 - 4.2, p[1] * 11.0 + 6.1, p[2] * 11.0 - 1.9, 3);
            let prov_f = (0.35 + 0.95 * prov).clamp(0.2, 1.3);
            let vein_sharp = vein.powf(1.8);

            let sed = (world.marine_sediment_km[i] as f64 / 1.1).clamp(0.0, 1.0);
            let fore = (world.foreland[i] as f64).clamp(0.0, 1.0);
            let rift = (world.rift[i] as f64).clamp(0.0, 1.0);
            let volc = (world.volcanic[i] as f64).clamp(0.0, 1.0);
            let incised = (erosion.incised_km[i] as f64 / 1.2).clamp(0.0, 1.0);
            let sub_hist = (world.submerged_myr[i] as f64 / 450.0).clamp(0.0, 1.0);
            let oro_age = if world.t_oro_myr[i] < 0.0 {
                t_now
            } else {
                (t_now - world.t_oro_myr[i] as f64).max(0.0)
            };
            let young_oro = (-oro_age / 320.0).exp();
            let b = biomes.biome[i];
            let br = biomes.bedrock[i];

            if hydrology.is_ocean[i] != 0 {
                // Морские углеводороды пассивных шельфов и окраинных осадочных бассейнов
                if erosion.elevation_km[i] > -0.45 && sed > 0.08 {
                    let shelf_hc = (0.45 * sed + 0.25 * fore + 0.20 * rift) * prov_f;
                    hydrocarbons[i] = shelf_hc.clamp(0.0, 1.0) as f32;
                }
                // Рыбные ресурсы: континентальный шельф + холодный апвеллинг + эстуарии рек
                let shelf_f = if erosion.elevation_km[i] >= -0.28 {
                    0.50
                } else if erosion.elevation_km[i] >= -1.2 {
                    0.22
                } else {
                    0.06
                };
                let near_coast = (1.0 - dist_to_land_km[i] as f64 / 450.0).clamp(0.0, 1.0);
                let upwelling = (-climate.current_temp[i] as f64).max(0.0) * near_coast * 0.45;
                let est = estuary_nutrients[i] as f64 * 0.42;
                let ice_pen = if climate.temp_c[i] < -8.0 { 0.35 } else { 1.0 };
                fishery[i] = ((shelf_f + upwelling + est) * ice_pen).clamp(0.0, 1.0) as f32;
                continue;
            }

            if hydrology.is_lake[i] != 0 {
                if hydrology.is_endorheic_lake[i] != 0 {
                    salt[i] = 0.68;
                    fishery[i] = 0.12;
                } else {
                    fishery[i] = 0.48;
                }
                continue;
            }

            let ice_cover = (1.0 - climate.glacier[i] as f64 * 0.85).clamp(0.1, 1.0);

            // 1. Железные руды: древние щиты (железистые кварциты), глубокий срез орогенов и контактовые скарны
            let shield_fe = match br {
                Bedrock::CratonShield => 0.46,
                Bedrock::OrogenicFold => 0.32,
                Bedrock::VolcanicProvince => 0.24,
                _ => 0.08,
            };
            iron[i] = ((shield_fe + 0.26 * incised + 0.16 * volc) * prov_f * (0.55 + 0.65 * vein) * ice_cover)
                .clamp(0.0, 1.0) as f32;

            // 2. Медь и золото: субдукционные дуги, молодые орогены и гидротермальные жилы
            let arc_margin = if world.margin[i] == 1 { 0.26 } else { 0.0 };
            let cg_base = 0.44 * volc + 0.28 * young_oro + arc_margin + 0.18 * incised;
            copper_gold[i] = (cg_base * prov_f * (0.45 + 0.85 * vein_sharp) * ice_cover)
                .clamp(0.0, 1.0) as f32;

            // 3. Редкие металлы и самоцветы: корни древних гор и кимберлитовые/щелочные трубки рифтов
            let root_gems = if matches!(br, Bedrock::CratonShield | Bedrock::OrogenicFold) {
                0.42 * incised + 0.18 * (1.0 - young_oro)
            } else {
                0.06
            };
            let pipe_gems = (rift * volc).sqrt() * 0.68 + 0.22 * rift;
            gems_rare[i] = ((root_gems + pipe_gems) * (0.30 + 1.05 * vein_sharp) * ice_cover)
                .clamp(0.0, 1.0) as f32;

            // 4. Каменный уголь: предгорные прогибы и древние болотно-морские осадочные платформы
            if world.thickness[i] >= 16.0 {
                let sed_plat = if br == Bedrock::SedimentaryPlatform { 0.26 } else { 0.06 };
                let coal_raw = (0.42 * fore + 0.30 * sub_hist + sed_plat + 0.16 * sed)
                    * prov_f
                    * (0.5 + 0.6 * vein);
                coal[i] = (coal_raw * ice_cover).clamp(0.0, 1.0) as f32;
            }

            // 5. Нефть и газ: мощные морские осадки в краевых прогибах, рифтах и пассивных окраинах
            if sed > 0.04 || fore > 0.10 {
                let passive = if world.margin[i] == 2 { 0.20 } else { 0.0 };
                let hc_raw = (0.48 * sed + 0.32 * fore + 0.24 * rift + passive) * prov_f * (0.5 + 0.6 * vein);
                hydrocarbons[i] = (hc_raw * ice_cover).clamp(0.0, 1.0) as f32;
            }

            // 6. Каменная соль и эвапориты: солончаки и аридные бывшие морские бассейны
            let salt_raw = if hydrology.is_salt_flat[i] != 0 {
                0.88
            } else if sed > 0.12 && climate.aridity_index[i] < 0.28 {
                (0.45 + 0.40 * sed) * prov_f
            } else {
                0.0
            };
            salt[i] = salt_raw.clamp(0.0, 1.0) as f32;

            // 7. Строевой и корабельный лес
            let base_timber = match b {
                Biome::TemperateRainforest => 0.95,
                Biome::TropicalRainforest => 0.88,
                Biome::BorealForest => 0.82,
                Biome::TemperateForest => 0.78,
                Biome::TropicalSeasonalForest => 0.70,
                Biome::Mediterranean => 0.32,
                Biome::Wetland | Biome::TropicalSavanna => 0.18,
                _ => 0.0,
            };
            let access = (1.0 - 0.45 * (slope[i] as f64 / 0.08).clamp(0.0, 1.0)).max(0.35);
            timber[i] = (base_timber * access).clamp(0.0, 1.0) as f32;
        }
    }

    // Выделяем крупнейшие дискретные месторождения ископаемых
    let mut deposits = Vec::new();
    let mineral_layers: [(ResourceKind, &[f32], f32); 6] = [
        (ResourceKind::Iron, &iron, 0.56),
        (ResourceKind::CopperGold, &copper_gold, 0.54),
        (ResourceKind::GemsRare, &gems_rare, 0.52),
        (ResourceKind::Coal, &coal, 0.55),
        (ResourceKind::Hydrocarbons, &hydrocarbons, 0.56),
        (ResourceKind::Salt, &salt, 0.62),
    ];

    for (kind, field, min_val) in mineral_layers {
        let mut cands: Vec<(usize, f32)> = Vec::new();
        for i in 0..n {
            let v = field[i];
            if v < min_val {
                continue;
            }
            let (nbs, cnt) = grid.neighbors8(i);
            if nbs[..cnt].iter().all(|&nb| v >= field[nb]) {
                cands.push((i, v));
            }
        }
        cands.sort_by(|a, b| b.1.total_cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        let mut kept: Vec<usize> = Vec::new();
        for (cell, richness) in cands {
            let (cx, cy) = grid.xy(cell);
            let uc = grid.unit_vec(cx, cy);
            let too_close = kept.iter().any(|&k| {
                let (kx, ky) = grid.xy(k);
                grid.spherical_dist_km(uc, grid.unit_vec(kx, ky)) < 340.0
            });
            if !too_close {
                kept.push(cell);
                deposits.push(Deposit {
                    kind,
                    cell,
                    richness,
                });
                if kept.len() >= 28 {
                    break;
                }
            }
        }
    }

    Resources {
        iron,
        copper_gold,
        gems_rare,
        coal,
        hydrocarbons,
        salt,
        timber,
        fishery,
        deposits,
    }
}
