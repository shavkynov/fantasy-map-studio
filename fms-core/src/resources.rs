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

    let noise_prov_fe = Noise::new(&mut Rng::sub(seed, "resource-prov-iron"));
    let noise_vein_fe = Noise::new(&mut Rng::sub(seed, "resource-vein-iron"));
    let noise_prov_cg = Noise::new(&mut Rng::sub(seed, "resource-prov-copper"));
    let noise_vein_cg = Noise::new(&mut Rng::sub(seed, "resource-vein-copper"));
    let noise_prov_gm = Noise::new(&mut Rng::sub(seed, "resource-prov-gems"));
    let noise_vein_gm = Noise::new(&mut Rng::sub(seed, "resource-vein-gems"));
    let noise_prov_cl = Noise::new(&mut Rng::sub(seed, "resource-prov-coal"));
    let noise_vein_cl = Noise::new(&mut Rng::sub(seed, "resource-vein-coal"));
    let noise_prov_hc = Noise::new(&mut Rng::sub(seed, "resource-prov-hc"));
    let noise_vein_hc = Noise::new(&mut Rng::sub(seed, "resource-vein-hc"));
    let noise_prov_sl = Noise::new(&mut Rng::sub(seed, "resource-prov-salt"));
    let noise_vein_sl = Noise::new(&mut Rng::sub(seed, "resource-vein-salt"));

    let sample_pv = |np: &Noise, nv: &Noise, p: [f64; 3], ox: f64| -> (f64, f64) {
        let prov = 0.5 + 0.5 * np.fbm(p[0] * 5.0 + ox, p[1] * 5.0 - 1.3 * ox, p[2] * 5.0 + 0.7 * ox, 3);
        let vein = 0.5 + 0.5 * nv.fbm(p[0] * 11.0 - 0.9 * ox, p[1] * 11.0 + 1.4 * ox, p[2] * 11.0 - ox, 3);
        ((0.35 + 0.95 * prov).clamp(0.2, 1.3), vein)
    };

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
        let lat_deg = grid.lat_deg(y);
        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let p = grid.unit_vec(x, y);

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
                let (pf_hc, _) = sample_pv(&noise_prov_hc, &noise_vein_hc, p, 4.1);
                // Морские углеводороды пассивных шельфов и окраинных осадочных бассейнов
                if erosion.elevation_km[i] > -0.45 && sed > 0.08 {
                    let shelf_hc = (0.45 * sed + 0.25 * fore + 0.20 * rift) * pf_hc;
                    hydrocarbons[i] = shelf_hc.clamp(0.0, 1.0) as f32;
                }
                // Рыбные ресурсы: шельф + береговой апвеллинг + экваториальный пассатный апвеллинг + эстуарии
                let shelf_f = if erosion.elevation_km[i] >= -0.28 {
                    0.50
                } else if erosion.elevation_km[i] >= -1.2 {
                    0.22
                } else {
                    0.06
                };
                let near_coast = (1.0 - dist_to_land_km[i] as f64 / 450.0).clamp(0.0, 1.0);
                let upwelling = (-climate.current_temp[i] as f64).max(0.0) * near_coast * 0.45;
                let eq_upwell =
                    (-((lat_deg / 6.5).powi(2))).exp() * (-climate.current_u[i] as f64).max(0.0) * 0.28;
                let est = estuary_nutrients[i] as f64 * 0.42;
                let ice_pen = if climate.temp_c[i] < -8.0 { 0.35 } else { 1.0 };
                fishery[i] = ((shelf_f + upwelling + eq_upwell + est) * ice_pen).clamp(0.0, 1.0) as f32;
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
            let (pf_fe, v_fe) = sample_pv(&noise_prov_fe, &noise_vein_fe, p, 1.3);
            let (pf_cg, v_cg) = sample_pv(&noise_prov_cg, &noise_vein_cg, p, 2.7);
            let (pf_gm, v_gm) = sample_pv(&noise_prov_gm, &noise_vein_gm, p, 3.5);
            let (pf_cl, v_cl) = sample_pv(&noise_prov_cl, &noise_vein_cl, p, 5.2);
            let (pf_hc, v_hc) = sample_pv(&noise_prov_hc, &noise_vein_hc, p, 4.1);
            let (pf_sl, v_sl) = sample_pv(&noise_prov_sl, &noise_vein_sl, p, 6.4);

            // 1. Железные руды: древние щиты (железистые кварциты), глубокий срез орогенов и контактовые скарны
            let shield_fe = match br {
                Bedrock::CratonShield => 0.46,
                Bedrock::OrogenicFold => 0.32,
                Bedrock::VolcanicProvince => 0.24,
                _ => 0.08,
            };
            iron[i] = ((shield_fe + 0.26 * incised + 0.16 * volc) * pf_fe * (0.55 + 0.65 * v_fe) * ice_cover)
                .clamp(0.0, 1.0) as f32;

            // 2. Медь и золото: субдукционные дуги, молодые орогены и гидротермальные жилы
            let arc_margin = if world.margin[i] == 1 { 0.26 } else { 0.0 };
            let cg_base = 0.44 * volc + 0.28 * young_oro + arc_margin + 0.18 * incised;
            copper_gold[i] = (cg_base * pf_cg * (0.45 + 0.85 * v_cg.powf(1.8)) * ice_cover)
                .clamp(0.0, 1.0) as f32;

            // 3. Редкие металлы и самоцветы: корни древних гор и кимберлитовые/щелочные трубки рифтов
            let root_gems = if matches!(br, Bedrock::CratonShield | Bedrock::OrogenicFold) {
                0.42 * incised + 0.18 * (1.0 - young_oro)
            } else {
                0.06
            };
            let pipe_gems = (rift * volc).sqrt() * 0.68 + 0.22 * rift;
            gems_rare[i] = ((root_gems + pipe_gems) * pf_gm * (0.30 + 1.05 * v_gm.powf(1.8)) * ice_cover)
                .clamp(0.0, 1.0) as f32;

            // 4. Каменный уголь: предгорные прогибы, паралические аллювиальные равнины и влажная палеофлора
            if world.thickness[i] >= 16.0 {
                let alluv_f = (erosion.alluvium_km[i] as f64 / 0.08).clamp(0.0, 1.0);
                let basin_plat = match br {
                    Bedrock::AlluvialPlain => 0.28,
                    Bedrock::SedimentaryPlatform => 0.24,
                    _ => 0.05,
                };
                let paleo_flora = 0.15 + 0.25 * (biomes.soil_fertility[i] as f64).clamp(0.0, 1.0);
                let coal_raw = (0.40 * fore
                    + 0.26 * (sub_hist * (1.0 - 0.45 * sed))
                    + 0.18 * alluv_f
                    + basin_plat
                    + paleo_flora)
                    * pf_cl
                    * (0.48 + 0.64 * v_cl);
                coal[i] = (coal_raw * ice_cover).clamp(0.0, 1.0) as f32;
            }

            // 5. Нефть и газ: мощные морские осадки в краевых прогибах, рифтах и пассивных окраинах
            if sed > 0.04 || fore > 0.10 {
                let passive = if world.margin[i] == 2 { 0.20 } else { 0.0 };
                let hc_raw =
                    (0.48 * sed + 0.32 * fore + 0.24 * rift + passive) * pf_hc * (0.5 + 0.6 * v_hc);
                hydrocarbons[i] = (hc_raw * ice_cover).clamp(0.0, 1.0) as f32;
            }

            // 6. Каменная соль и эвапориты: солончаки, аридные бассейны и ископаемые соляные купола
            let salt_raw = if hydrology.is_salt_flat[i] != 0 {
                0.88
            } else if sed > 0.12 && climate.aridity_index[i] < 0.28 {
                (0.45 + 0.40 * sed) * pf_sl
            } else if sed > 0.25 && (rift > 0.14 || sub_hist > 0.42 || world.margin[i] == 2) {
                (0.26 * sed + 0.26 * rift + 0.22 * sub_hist) * pf_sl * (0.4 + 0.7 * v_sl)
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

    // Выделяем крупнейшие дискретные месторождения ископаемых (с масштабированием под рудные пояса и бассейны)
    let mut deposits = Vec::new();
    let mineral_layers: [(ResourceKind, &[f32], f32, f64); 6] = [
        (ResourceKind::Iron, &iron, 0.56, 210.0),
        (ResourceKind::CopperGold, &copper_gold, 0.54, 210.0),
        (ResourceKind::GemsRare, &gems_rare, 0.52, 210.0),
        (ResourceKind::Coal, &coal, 0.55, 300.0),
        (ResourceKind::Hydrocarbons, &hydrocarbons, 0.56, 300.0),
        (ResourceKind::Salt, &salt, 0.58, 300.0),
    ];

    for (kind, field, min_val, min_sep_km) in mineral_layers {
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
                grid.spherical_dist_km(uc, grid.unit_vec(kx, ky)) < min_sep_km
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
