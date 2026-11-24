//! Литология коренных пород, плодородие почв и физическая классификация биомов планеты.

use crate::climate::Climate;
use crate::erosion::ErosionResult;
use crate::grid::{slope_field, Grid};
use crate::hydrology::Hydrology;
use crate::tectonic::World;

/// Доминирующий геологический субстрат / коренная порода ячейки.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Bedrock {
    OceanicBasalt = 0,
    CratonShield = 1,
    SedimentaryPlatform = 2,
    OrogenicFold = 3,
    VolcanicProvince = 4,
    RiftBasin = 5,
    AlluvialPlain = 6,
}

/// Природный биом поверхности на основе водного баланса, сезонности и рельефа.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[repr(u8)]
pub enum Biome {
    Ocean = 0,
    Shelf = 1,
    Lake = 2,
    SaltFlat = 3,
    IceSheet = 4,
    PolarDesert = 5,
    Tundra = 6,
    Alpine = 7,
    BorealForest = 8,
    ColdDesert = 9,
    TemperateGrassland = 10,
    Mediterranean = 11,
    TemperateForest = 12,
    TemperateRainforest = 13,
    HotDesert = 14,
    TropicalSavanna = 15,
    TropicalSeasonalForest = 16,
    TropicalRainforest = 17,
    Wetland = 18,
}

impl Biome {
    /// Читаемое название биома на русском языке.
    pub fn name(self) -> &'static str {
        match self {
            Biome::Ocean => "Глубокий океан",
            Biome::Shelf => "Континентальный шельф",
            Biome::Lake => "Озеро",
            Biome::SaltFlat => "Солончак",
            Biome::IceSheet => "Ледниковый щит",
            Biome::PolarDesert => "Полярная пустыня",
            Biome::Tundra => "Тундра",
            Biome::Alpine => "Альпийский пояс",
            Biome::BorealForest => "Тайга",
            Biome::ColdDesert => "Холодная пустыня",
            Biome::TemperateGrassland => "Степь и прерия",
            Biome::Mediterranean => "Средиземноморские субтропики",
            Biome::TemperateForest => "Умеренный лес",
            Biome::TemperateRainforest => "Дождевой умеренный лес",
            Biome::HotDesert => "Жаркая пустыня",
            Biome::TropicalSavanna => "Саванна",
            Biome::TropicalSeasonalForest => "Муссонный лес",
            Biome::TropicalRainforest => "Тропический дождевой лес",
            Biome::Wetland => "Пойменные болота и дельты",
        }
    }

    /// Цвет биома в палитре старого атласа `[R, G, B]`.
    pub fn rgb(self) -> [u8; 3] {
        match self {
            Biome::Ocean => [28, 63, 99],
            Biome::Shelf => [68, 121, 161],
            Biome::Lake => [58, 128, 178],
            Biome::SaltFlat => [232, 228, 214],
            Biome::IceSheet => [242, 247, 252],
            Biome::PolarDesert => [204, 209, 214],
            Biome::Tundra => [147, 163, 129],
            Biome::Alpine => [146, 138, 129],
            Biome::BorealForest => [64, 98, 69],
            Biome::ColdDesert => [186, 173, 144],
            Biome::TemperateGrassland => [168, 178, 99],
            Biome::Mediterranean => [149, 158, 86],
            Biome::TemperateForest => [78, 130, 74],
            Biome::TemperateRainforest => [48, 108, 72],
            Biome::HotDesert => [223, 194, 132],
            Biome::TropicalSavanna => [184, 169, 86],
            Biome::TropicalSeasonalForest => [84, 140, 66],
            Biome::TropicalRainforest => [34, 102, 52],
            Biome::Wetland => [78, 134, 114],
        }
    }
}

/// Почвенно-литологический покров и биомы планеты.
#[derive(Clone, Debug)]
pub struct Biomes {
    pub biome: Vec<Biome>,
    pub bedrock: Vec<Bedrock>,
    /// Потенциальное плодородие почв на суше (`0..1`, в воде `0`).
    pub soil_fertility: Vec<f32>,
}

/// Классифицирует наземный биом по физическим параметрам среды.
#[allow(clippy::too_many_arguments)]
pub(crate) fn classify_land_biome(
    lat: f64,
    elev: f32,
    slope: f32,
    discharge_m3s: f32,
    alluvium_km: f32,
    temp_c: f32,
    temp_jan_c: f32,
    temp_jul_c: f32,
    precip_mm: f32,
    precip_jan_mm: f32,
    precip_jul_mm: f32,
    aridity_index: f64,
    monsoon_index: f32,
    glacier: f32,
) -> Biome {
    let lat_abs = lat.abs();
    let t_warm = temp_jan_c.max(temp_jul_c);
    let t_cold = temp_jan_c.min(temp_jul_c);
    let (p_sum, p_win) = if lat >= 0.0 {
        (precip_jul_mm, precip_jan_mm)
    } else {
        (precip_jan_mm, precip_jul_mm)
    };

    if glacier > 0.35 || (t_warm < -2.0 && precip_mm >= 80.0) {
        Biome::IceSheet
    } else if t_warm < 0.0 {
        Biome::PolarDesert
    } else if t_warm < 10.0 {
        if elev > 1.8 && lat_abs < 60.0 {
            Biome::Alpine
        } else if aridity_index < 0.25 {
            Biome::PolarDesert
        } else {
            Biome::Tundra
        }
    } else if elev > 2.6 || (elev > 1.9 && temp_c < 6.0) {
        Biome::Alpine
    } else if slope < 0.008
        && t_warm > 6.0
        && aridity_index > 0.75
        && (discharge_m3s > 18_000.0
            || (alluvium_km > 0.035 && aridity_index > 1.0 && slope < 0.005))
    {
        Biome::Wetland
    } else if temp_c < 4.5 {
        if aridity_index < 0.30 {
            Biome::ColdDesert
        } else if aridity_index < 0.55 {
            Biome::TemperateGrassland
        } else {
            Biome::BorealForest
        }
    } else if temp_c < 18.0 {
        if aridity_index < 0.22 {
            if temp_c < 12.0 {
                Biome::ColdDesert
            } else {
                Biome::HotDesert
            }
        } else if aridity_index < 0.55 {
            Biome::TemperateGrassland
        } else if temp_c > 9.0 && t_cold > 2.0 && p_win > 1.75 * p_sum && aridity_index < 1.35 {
            Biome::Mediterranean
        } else if aridity_index > 1.65 || precip_mm > 1550.0 {
            Biome::TemperateRainforest
        } else {
            Biome::TemperateForest
        }
    } else if aridity_index < 0.22 {
        Biome::HotDesert
    } else if aridity_index < 0.65 || (monsoon_index > 0.48 && aridity_index < 1.05) {
        Biome::TropicalSavanna
    } else if aridity_index < 1.25 || monsoon_index > 0.42 {
        Biome::TropicalSeasonalForest
    } else {
        Biome::TropicalRainforest
    }
}

/// Классифицирует коренные породы, плодородие почв и биомы по физическим полям планеты.
pub fn classify(
    grid: &Grid,
    world: &World,
    erosion: &ErosionResult,
    climate: &Climate,
    hydrology: &Hydrology,
) -> Biomes {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    assert_eq!(world.thickness.len(), n);
    assert_eq!(erosion.elevation_km.len(), n);
    assert_eq!(climate.temp_c.len(), n);
    assert_eq!(hydrology.is_ocean.len(), n);

    let slope = slope_field(&erosion.elevation_km, grid);
    let t_now = world.stats.time;

    let mut biome = vec![Biome::Ocean; n];
    let mut bedrock = vec![Bedrock::OceanicBasalt; n];
    let mut soil_fertility = vec![0.0f32; n];

    for y in 0..h {
        let lat = grid.lat_deg(y);
        let row = y * w;
        for x in 0..w {
            let i = row + x;

            // 1. Коренная порода
            bedrock[i] = if hydrology.is_ocean[i] != 0 {
                Bedrock::OceanicBasalt
            } else if erosion.alluvium_km[i] > 0.04 {
                Bedrock::AlluvialPlain
            } else if world.volcanic[i] > 0.25 {
                Bedrock::VolcanicProvince
            } else if world.rift[i] > 0.25 {
                Bedrock::RiftBasin
            } else {
                let young_oro = world.t_oro_myr[i] >= 0.0
                    && (t_now - world.t_oro_myr[i] as f64) <= 450.0
                    && erosion.elevation_km[i] > 0.9;
                if world.thickness[i] > 37.0 || young_oro {
                    Bedrock::OrogenicFold
                } else if world.marine_sediment_km[i] > 0.08 {
                    Bedrock::SedimentaryPlatform
                } else {
                    Bedrock::CratonShield
                }
            };

            // 2. Водные объекты и солончаки
            if hydrology.is_ocean[i] != 0 {
                biome[i] = if erosion.elevation_km[i] >= -0.25 {
                    Biome::Shelf
                } else {
                    Biome::Ocean
                };
                continue;
            }
            if hydrology.is_lake[i] != 0 {
                biome[i] = Biome::Lake;
                continue;
            }
            if hydrology.is_salt_flat[i] != 0 {
                biome[i] = Biome::SaltFlat;
                soil_fertility[i] = 0.02;
                continue;
            }

            // 3. Плодородие почв на суше
            let alluv = (erosion.alluvium_km[i] as f64 / 0.12).clamp(0.0, 1.0);
            let volc = (world.volcanic[i] as f64).clamp(0.0, 1.0);
            let sed = (world.marine_sediment_km[i] as f64 / 0.50).clamp(0.0, 1.0);
            let fore = (world.foreland[i] as f64).clamp(0.0, 1.0);
            let base_min = (0.24 + 0.38 * alluv + 0.24 * volc + 0.18 * sed + 0.12 * fore).min(1.0);

            let ai = climate.aridity_index[i] as f64;
            let t = climate.temp_c[i] as f64;
            let moist_f = if ai < 0.45 {
                0.05 + 0.95 * (ai / 0.45).clamp(0.0, 1.0).powf(0.8)
            } else if ai > 1.8 && t > 18.0 {
                1.0 - 0.45 * ((ai - 1.8) / 2.0).clamp(0.0, 1.0)
            } else {
                1.0
            };
            let temp_f = ((t + 6.0) / 10.0).clamp(0.05, 1.0);
            let slope_f = (1.0 - 0.85 * (slope[i] as f64 / 0.08).clamp(0.0, 1.0)).max(0.1);
            let glac_f = (1.0 - climate.glacier[i] as f64).clamp(0.0, 1.0);
            let mut sf = (base_min * moist_f * temp_f * slope_f * glac_f).clamp(0.0, 1.0) as f32;
            if hydrology.is_oasis[i] != 0 {
                sf = sf.max(0.55);
            }
            soil_fertility[i] = sf;

            // 4. Физическая классификация биомов суши
            biome[i] = classify_land_biome(
                lat,
                erosion.elevation_km[i],
                slope[i],
                hydrology.discharge_m3s[i],
                erosion.alluvium_km[i],
                climate.temp_c[i],
                climate.temp_jan_c[i],
                climate.temp_jul_c[i],
                climate.precip_mm[i],
                climate.precip_jan_mm[i],
                climate.precip_jul_mm[i],
                ai,
                climate.monsoon_index[i],
                climate.glacier[i],
            );
        }
    }

    Biomes {
        biome,
        bedrock,
        soil_fertility,
    }
}
