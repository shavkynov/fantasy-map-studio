//! Единый связанный конвейер генерации планеты:
//! тектоника -> океан и климат -> флювиально-ледниковая эрозия -> обновлённый климат ->
//! гидрология -> биомы и почвы -> геоморфология -> ресурсы -> цивилизации и торговые пути.

use crate::biomes::{self, Biomes};
use crate::civilization::{self, Civilization};
use crate::climate::{self, Climate, ClimateParams};
use crate::currents::{self, Currents};
use crate::erosion::{self, ErosionParams, ErosionResult};
use crate::geography::{self, Geography};
use crate::grid::Grid;
use crate::hydrology::{self, Hydrology};
use crate::resources::{self, Resources};
use crate::tectonic::{self, Options, World};

/// Расширенные настройки генерации планеты и мира.
#[derive(Clone, Debug)]
pub struct PlanetOptions {
    pub tectonic: Options,
    pub climate: ClimateParams,
    pub erosion: ErosionParams,
    /// Целевое число государств (`0` — автоматически из пригодной площади суши).
    pub target_realms: usize,
}

impl PlanetOptions {
    pub fn new(seed: &str) -> Self {
        Self {
            tectonic: Options::new(seed),
            climate: ClimateParams::default(),
            erosion: ErosionParams::default(),
            target_realms: 0,
        }
    }

    pub fn from_tectonic(tectonic: Options) -> Self {
        Self {
            tectonic,
            climate: ClimateParams::default(),
            erosion: ErosionParams::default(),
            target_realms: 0,
        }
    }
}

/// Полная физическая и антропогеографическая модель сгенерированной планеты.
#[derive(Clone)]
pub struct Planet {
    pub grid: Grid,
    pub tectonic: World,
    pub currents: Currents,
    pub climate: Climate,
    pub erosion: ErosionResult,
    pub hydrology: Hydrology,
    pub biomes: Biomes,
    pub geography: Geography,
    pub resources: Resources,
    pub civilization: Civilization,
}

/// Генерирует планету с настройками Земли по умолчанию поверх параметров тектоники `opt`.
pub fn generate(opt: &Options) -> Result<Planet, String> {
    generate_with_options(&PlanetOptions::from_tectonic(opt.clone()))
}

/// Генерирует планету с полным набором параметров климата, эрозии и цивилизаций.
pub fn generate_with_options(opt: &PlanetOptions) -> Result<Planet, String> {
    let tectonic = tectonic::generate(&opt.tectonic)?;
    let grid = Grid::new(tectonic.w, tectonic.h, opt.tectonic.radius_km);
    let seed = &opt.tectonic.seed;

    let cur0 = currents::solve(&grid, &tectonic.elevation_km);
    let clim0 = climate::compute_with_params(&grid, &tectonic.elevation_km, &cur0, seed, &opt.climate);
    let erosion = erosion::erode_with_params(&grid, &tectonic, &clim0, seed, &opt.erosion);

    let currents = currents::solve(&grid, &erosion.elevation_km);
    let climate = climate::compute_with_params(&grid, &erosion.elevation_km, &currents, seed, &opt.climate);

    let force_lake = vec![0u8; grid.len()];
    let hydrology = hydrology::compute(
        &grid,
        &erosion.elevation_km,
        &force_lake,
        &tectonic.margin,
        &climate,
        seed,
    );
    let biomes = biomes::classify(&grid, &tectonic, &erosion, &climate, &hydrology);
    let geography = geography::analyze(&grid, &tectonic, &erosion, &climate, &hydrology);
    let resources = resources::compute(
        &grid,
        &tectonic,
        &erosion,
        &climate,
        &hydrology,
        &biomes,
        seed,
    );
    let civilization = civilization::simulate(
        &grid,
        &erosion,
        &currents,
        &climate,
        &hydrology,
        &biomes,
        &geography,
        &resources,
        opt.target_realms,
    );

    Ok(Planet {
        grid,
        tectonic,
        currents,
        climate,
        erosion,
        hydrology,
        biomes,
        geography,
        resources,
        civilization,
    })
}
