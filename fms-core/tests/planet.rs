use fms_core::biomes::Biome;
use fms_core::geography::{LandmassKind, MarineZone};
use fms_core::planet::{self, PlanetOptions};
use fms_core::tectonic::Options;
use std::collections::HashSet;
use std::f64::consts::PI;

#[test]
fn planet_end_to_end_and_determinism() {
    let mut opt = Options::new("p1");
    opt.w = 180;

    let p1 = planet::generate(&opt).expect("planet generate 1");
    let p2 = planet::generate(&opt).expect("planet generate 2");

    assert_eq!(p1.erosion.elevation_km, p2.erosion.elevation_km);
    assert_eq!(p1.climate.temp_c, p2.climate.temp_c);
    assert_eq!(p1.hydrology.discharge_m3s, p2.hydrology.discharge_m3s);
    assert_eq!(p1.biomes.biome, p2.biomes.biome);
    assert_eq!(p1.geography.landmass_id, p2.geography.landmass_id);
    assert_eq!(p1.resources.iron, p2.resources.iron);
    assert_eq!(p1.civilization.realm_id, p2.civilization.realm_id);
    assert_eq!(
        p1.civilization.settlements.len(),
        p2.civilization.settlements.len()
    );
    assert_eq!(
        p1.civilization.trade_routes.len(),
        p2.civilization.trade_routes.len()
    );

    let n = p1.grid.len();
    let mut ocean_vol = 0.0f64;
    let mut has_incision = false;
    let mut has_alluvium = false;
    let mut land_biomes = HashSet::new();
    let mut has_ocean = false;
    let mut has_shelf = false;
    let (mut fertile_sum, mut fertile_cnt) = (0.0f64, 0usize);
    let (mut desert_sum, mut desert_cnt) = (0.0f64, 0usize);

    for i in 0..n {
        let e = p1.erosion.elevation_km[i];
        assert!(e.is_finite());
        if e < 0.0 {
            ocean_vol += (-e as f64) * p1.tectonic.cell_area[i];
        }
        if p1.erosion.incised_km[i] > 0.01 {
            has_incision = true;
        }
        if p1.erosion.alluvium_km[i] > 0.005 {
            has_alluvium = true;
        }
        assert!(
            p1.biomes.soil_fertility[i].is_finite()
                && (0.0..=1.0).contains(&p1.biomes.soil_fertility[i])
        );
        assert!(p1.climate.aridity_index[i].is_finite() && p1.climate.aridity_index[i] >= 0.0);
        assert!(p1.climate.temp_amp_c[i].is_finite() && p1.climate.temp_amp_c[i] >= 0.0);
        assert!(p1.climate.glacier[i].is_finite() && (0.0..=1.0).contains(&p1.climate.glacier[i]));

        let b = p1.biomes.biome[i];
        match b {
            Biome::Ocean => has_ocean = true,
            Biome::Shelf => has_shelf = true,
            Biome::Lake | Biome::SaltFlat => {
                land_biomes.insert(b);
            }
            _ => {
                land_biomes.insert(b);
                if (p1.erosion.alluvium_km[i] > 0.02 || p1.tectonic.volcanic[i] > 0.2)
                    && p1.climate.aridity_index[i] > 0.45
                {
                    fertile_sum += p1.biomes.soil_fertility[i] as f64;
                    fertile_cnt += 1;
                }
                if matches!(b, Biome::HotDesert | Biome::ColdDesert) {
                    desert_sum += p1.biomes.soil_fertility[i] as f64;
                    desert_cnt += 1;
                }
            }
        }
    }

    assert!(
        (ocean_vol / (opt.water_depth_km * 4.0 * PI) - 1.0).abs() < 1e-2,
        "post-erosion ocean volume mismatch: {ocean_vol}"
    );
    assert!(has_incision, "expected fluvial/glacial incision");
    assert!(has_alluvium, "expected alluvial deposition");
    assert!(has_ocean && has_shelf, "expected both deep ocean and continental shelf");
    assert!(
        land_biomes.len() >= 5,
        "expected diverse land biomes, got {}",
        land_biomes.len()
    );
    if fertile_cnt > 0 && desert_cnt > 0 {
        let fertile_mean = fertile_sum / fertile_cnt as f64;
        let desert_mean = desert_sum / desert_cnt as f64;
        assert!(
            fertile_mean > desert_mean,
            "fertile soil {fertile_mean:.3} should exceed desert {desert_mean:.3}"
        );
    }
}

#[test]
fn geography_resources_and_civilization_laws() {
    let mut opt = Options::new("a");
    opt.w = 180;
    let p = planet::generate(&opt).expect("planet generate");
    let n = p.grid.len();

    // 1. Геоморфология объектов
    assert!(!p.geography.landmasses.is_empty());
    assert!(p
        .geography
        .landmasses
        .iter()
        .any(|l| l.kind == LandmassKind::Continent));
    for win in p.geography.landmasses.windows(2) {
        assert!(win[0].area_km2 >= win[1].area_km2);
    }
    assert!(!p.geography.mountain_ranges.is_empty());
    for rg in &p.geography.mountain_ranges {
        assert!(p.erosion.elevation_km[rg.peak_cell] >= 0.90);
    }
    for pass in &p.geography.passes {
        let e = p.erosion.elevation_km[pass.cell];
        assert!((0.45..=3.80).contains(&e));
        assert_eq!(p.hydrology.is_ocean[pass.cell], 0);
    }
    for i in 0..n {
        if p.hydrology.is_ocean[i] == 0 {
            assert_eq!(p.geography.marine_zone[i], MarineZone::Land);
            assert!(p.geography.landmass_id[i] >= 0);
        } else {
            assert_ne!(p.geography.marine_zone[i], MarineZone::Land);
            assert_eq!(p.geography.landmass_id[i], -1);
        }
    }

    // 2. Природные ресурсы
    for layer in [
        &p.resources.iron,
        &p.resources.copper_gold,
        &p.resources.gems_rare,
        &p.resources.coal,
        &p.resources.hydrocarbons,
        &p.resources.salt,
        &p.resources.timber,
        &p.resources.fishery,
    ] {
        assert_eq!(layer.len(), n);
        assert!(layer.iter().all(|&v| v.is_finite() && (0.0..=1.0).contains(&v)));
    }
    assert!(!p.resources.deposits.is_empty(), "expected mineral deposits");
    for i in 0..n {
        if p.hydrology.is_ocean[i] == 0 && p.hydrology.is_lake[i] == 0 {
            assert_eq!(p.resources.fishery[i], 0.0);
        }
        if matches!(
            p.biomes.biome[i],
            Biome::HotDesert | Biome::ColdDesert | Biome::IceSheet
        ) {
            assert_eq!(p.resources.timber[i], 0.0);
        }
    }

    // 3. Цивилизации, города и торговые пути
    assert!(!p.civilization.settlements.is_empty());
    assert!(!p.civilization.realms.is_empty());
    assert!(!p.civilization.trade_routes.is_empty());

    for i in 0..n {
        let hab = p.civilization.habitability[i];
        assert!(hab.is_finite() && (0.0..=1.0).contains(&hab));
        if p.hydrology.is_ocean[i] != 0
            || p.hydrology.is_lake[i] != 0
            || p.climate.glacier[i] > 0.35
        {
            assert_eq!(hab, 0.0);
            assert_eq!(p.civilization.realm_id[i], -1);
        }
    }
    for s in &p.civilization.settlements {
        assert_eq!(p.hydrology.is_ocean[s.cell], 0);
        assert_eq!(p.hydrology.is_lake[s.cell], 0);
        assert!(p.civilization.habitability[s.cell] >= 0.09);
    }
    for r in &p.civilization.realms {
        assert!(r.area_km2 > 0.0 && r.carrying_capacity > 0.0);
        assert_eq!(p.civilization.realm_id[r.capital_cell], r.id as i32);
    }
    for tr in &p.civilization.trade_routes {
        assert!(tr.cells.len() >= 2);
        assert_eq!(tr.cells.len(), tr.segments.len() + 1);
        assert!(tr.cost.is_finite() && tr.cost > 0.0);
    }
}

#[test]
fn planet_options_axial_tilt_and_coarse_grid() {
    let mut no_tilt = PlanetOptions::new("tilt_test");
    no_tilt.tectonic.w = 90;
    no_tilt.climate.axial_tilt_deg = 0.0;
    let p0 = planet::generate_with_options(&no_tilt).expect("zero tilt planet");
    let max_amp_0 = p0
        .climate
        .temp_amp_c
        .iter()
        .copied()
        .fold(0.0f32, f32::max);
    assert!(
        max_amp_0 < 0.01,
        "zero axial tilt should produce zero seasonal temperature amplitude, got {max_amp_0}"
    );
    let land_frac_90: f64 = (0..p0.grid.len())
        .filter(|&i| p0.erosion.elevation_km[i] > 0.0)
        .map(|i| p0.tectonic.cell_area[i])
        .sum::<f64>()
        / (4.0 * PI);
    assert!(
        (0.18..=0.45).contains(&land_frac_90),
        "coarse w=90 land fraction out of range: {land_frac_90:.3}"
    );

    let mut high_tilt = no_tilt;
    high_tilt.climate.axial_tilt_deg = 32.0;
    let p_hi = planet::generate_with_options(&high_tilt).expect("high tilt planet");
    let max_amp_hi = p_hi
        .climate
        .temp_amp_c
        .iter()
        .copied()
        .fold(0.0f32, f32::max);
    assert!(
        max_amp_hi > 20.0,
        "high axial tilt should produce strong seasonal amplitude, got {max_amp_hi}"
    );
}
