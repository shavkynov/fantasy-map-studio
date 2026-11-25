use fms_core::biomes::Biome;
use fms_core::geography::{LandmassKind, MarineZone};
use fms_core::planet::{self, PlanetOptions};
use fms_core::region::{self, RegionOptions};
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
        assert!(p1.climate.permafrost[i].is_finite() && (0.0..=1.0).contains(&p1.climate.permafrost[i]));

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

    // 4. Расширенная география (заливы, перешейки, архипелаги, природные регионы и связи озёр)
    assert!(!p.geography.natural_regions.is_empty(), "expected natural regions");
    assert!(
        p.geography
            .natural_regions
            .iter()
            .all(|r| r.area_km2 > 0.0 && p.hydrology.is_ocean[r.center_cell] == 0)
    );
    assert!(
        p.geography.bays.is_empty()
            || p.geography
                .marine_zone
                .contains(&MarineZone::Bay)
    );
    for isth in &p.geography.isthmuses {
        assert_eq!(p.hydrology.is_ocean[isth.cell], 0);
        assert!(isth.width_km > 0.0);
    }
    for arch in &p.geography.archipelagos {
        assert!(arch.island_ids.len() >= 2);
        assert!(arch.total_area_km2 > 0.0);
    }
    let river_ids: HashSet<u32> = p.hydrology.rivers.iter().map(|r| r.id).collect();
    for lk in &p.geography.lakes {
        for rid in &lk.inflow_river_ids {
            assert!(river_ids.contains(rid));
        }
        if let Some(oid) = lk.outflow_river_id {
            assert!(river_ids.contains(&oid));
        }
    }

    // 5. Культуры, изоляция и русская топонимика
    assert!(!p.civilization.cultures.is_empty(), "expected cultures");
    let mut cult_names = HashSet::new();
    for c in &p.civilization.cultures {
        assert!(!c.name.is_empty());
        assert!(cult_names.insert(c.name.clone()), "duplicate culture name {}", c.name);
        assert!((0.0..=1.0).contains(&c.isolation_index));
    }
    for s in &p.civilization.settlements {
        assert!(!s.name.is_empty());
        assert!((s.culture_id as usize) < p.civilization.cultures.len());
    }
    for r in &p.civilization.realms {
        assert!(!r.name.is_empty());
        assert!((r.culture_id as usize) < p.civilization.cultures.len());
    }
    assert_eq!(p.names.landmasses.len(), p.geography.landmasses.len());
    assert_eq!(p.names.archipelagos.len(), p.geography.archipelagos.len());
    assert_eq!(p.names.bays.len(), p.geography.bays.len());
    assert_eq!(p.names.isthmuses.len(), p.geography.isthmuses.len());
    assert_eq!(p.names.lakes.len(), p.geography.lakes.len());
    assert_eq!(p.names.mountain_ranges.len(), p.geography.mountain_ranges.len());
    assert_eq!(p.names.passes.len(), p.geography.passes.len());
    assert_eq!(p.names.natural_regions.len(), p.geography.natural_regions.len());
    assert_eq!(p.names.rivers.len(), p.hydrology.rivers.len());
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

#[test]
fn regional_zoom_continuity_and_antimeridian() {
    let mut opt = Options::new("a");
    opt.w = 180;
    let p = planet::generate(&opt).expect("planet generate");

    // Ошибки валидации параметров
    let bad_scale = RegionOptions::new(0.0, 0.0, 20.0, 15.0, 1);
    assert!(region::generate_region(&p, &bad_scale).is_err());
    let too_big_scale = RegionOptions::new(0.0, 0.0, 20.0, 15.0, 20);
    assert!(region::generate_region(&p, &too_big_scale).is_err());
    let huge_window = RegionOptions::new(0.0, 0.0, 180.0, 120.0, 8);
    assert!(region::generate_region(&p, &huge_window).is_err());

    // Стандартный зум вокруг крупной столицы или суши
    let center_cell = p
        .civilization
        .settlements
        .first()
        .map(|s| s.cell)
        .unwrap_or(p.grid.idx(p.grid.w / 2, p.grid.h / 2));
    let mut r_opt = RegionOptions::around_cell(&p, center_cell, 24.0, 4);
    r_opt.span_lon_deg = 32.0;

    let r1 = region::generate_region(&p, &r_opt).expect("region 1");
    let r2 = region::generate_region(&p, &r_opt).expect("region 2");
    assert_eq!(r1.elevation_km, r2.elevation_km);
    assert_eq!(r1.discharge_m3s, r2.discharge_m3s);
    assert_eq!(r1.biome, r2.biome);

    let rn = r1.w * r1.h;
    assert_eq!(r1.elevation_km.len(), rn);
    for i in 0..rn {
        assert!(r1.elevation_km[i].is_finite());
        assert!(r1.temp_c[i].is_finite());
        assert!(r1.precip_mm[i].is_finite());
        assert!(r1.discharge_m3s[i].is_finite());
        assert!(r1.permafrost[i].is_finite() && (0.0..=1.0).contains(&r1.permafrost[i]));
        assert!(r1.is_delta[i] <= 1);
        let recv = r1.receiver[i];
        if recv >= 0 {
            assert!(
                r1.filled_km[recv as usize] <= r1.filled_km[i],
                "uphill regional receiver at {i} -> {recv}: {} -> {}",
                r1.filled_km[i],
                r1.filled_km[recv as usize]
            );
        }
    }
    assert!(!r1.rivers.is_empty(), "expected refined regional rivers");

    // Бесшовный зум строго через антимеридиан ±180°
    let seam_opt = RegionOptions::new(10.0, 179.5, 30.0, 20.0, 4);
    let seam = region::generate_region(&p, &seam_opt).expect("antimeridian region");
    assert_eq!(seam.elevation_km.len(), seam.w * seam.h);
    let mid_y = seam.h / 2;
    let x_l = seam.w / 2 - 1;
    let x_r = seam.w / 2;
    assert!(seam.lon_deg(x_l) > 170.0 || seam.lon_deg(x_l) < -170.0);
    let seam_jump = (seam.elevation_km[seam.idx(x_r, mid_y)]
        - seam.elevation_km[seam.idx(x_l, mid_y)])
    .abs();
    assert!(
        seam_jump < 1.5,
        "unexpected jump across +-180 seam: {seam_jump} km"
    );
    for i in 0..(seam.w * seam.h) {
        assert!(seam.elevation_km[i].is_finite());
        let recv = seam.receiver[i];
        if recv >= 0 {
            assert!(seam.filled_km[recv as usize] <= seam.filled_km[i]);
        }
    }

    assert!(
        p.resources.coal != p.resources.hydrocarbons,
        "coal and hydrocarbons should follow distinct sedimentary and alluvial controls"
    );
    assert_eq!(p.erosion.effective_thickness_km.len(), p.grid.len());
    assert!(p
        .erosion
        .effective_thickness_km
        .iter()
        .all(|&t| t.is_finite() && (0.0..=80.0).contains(&t)));

    // Проверка прокладки дорог и месторождений в регионе
    for dep in &r1.deposits {
        assert!(dep.cell < rn);
        assert!(dep.richness.is_finite());
    }
    if r1.settlements.len() >= 2 {
        assert!(!r1.roads.is_empty(), "expected relief-aware regional roads");
        for rd in &r1.roads {
            assert!(rd.cells.len() >= 2);
            for &c in &rd.cells {
                assert_eq!(r1.is_ocean[c], 0, "road stepped into ocean");
                assert_eq!(r1.is_lake[c], 0, "road stepped into lake");
            }
        }
        let rd = region::route_region_road(&r1, r1.settlements[0].cell, r1.settlements[1].cell, None)
            .expect("route region road between first two regional settlements");
        assert!(rd.cells.len() >= 2);
    }
    for tr in &p.civilization.trade_routes {
        if let (Some(&a), Some(&b)) = (tr.cells.first(), tr.cells.last()) {
            if p.hydrology.is_ocean[a] == 0
                && p.hydrology.is_lake[a] == 0
                && p.hydrology.is_ocean[b] == 0
                && p.hydrology.is_lake[b] == 0
                && tr.segments.iter().all(|s| *s != fms_core::civilization::RouteKind::SeaLane)
            {
                if let Some(path) = fms_core::civilization::route_land_road(&p, a, b, None) {
                    assert!(path.iter().all(|&c| p.hydrology.is_ocean[c] == 0 && p.hydrology.is_lake[c] == 0));
                    break;
                }
            }
        }
    }
}
