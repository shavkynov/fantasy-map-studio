use fms_core::climate::{self, ClimateParams};
use fms_core::currents;
use fms_core::grid::{distance_to_mask_km, Grid};
use fms_core::hydrology::{self, MouthKind};
use fms_core::tectonic::{self, Options};
use std::collections::HashSet;

fn gen_tec(seed: &str, w: usize) -> tectonic::World {
    let mut o = Options::new(seed);
    o.w = w;
    tectonic::generate(&o).unwrap()
}

fn run_water(seed: &str, w: usize) -> (tectonic::World, Grid, currents::Currents, climate::Climate, hydrology::Hydrology) {
    let tec = gen_tec(seed, w);
    let grid = Grid::new(tec.w, tec.h, 6371.0);
    let force_lake = vec![0u8; grid.len()];
    let cur = currents::solve(&grid, &tec.elevation_km);
    let clim = climate::compute(&grid, &tec.elevation_km, &cur, seed);
    let hyd = hydrology::compute(&grid, &tec.elevation_km, &force_lake, &tec.margin, &clim, seed);
    (tec, grid, cur, clim, hyd)
}

#[test]
fn water_determinism() {
    let (_, _, cur1, clim1, hyd1) = run_water("det1", 180);
    let (_, _, cur2, clim2, hyd2) = run_water("det1", 180);
    assert_eq!(cur1.speed, cur2.speed);
    assert_eq!(clim1.temp_c, clim2.temp_c);
    assert_eq!(clim1.precip_mm, clim2.precip_mm);
    assert_eq!(hyd1.discharge_m3s, hyd2.discharge_m3s);
    assert_eq!(hyd1.is_ocean, hyd2.is_ocean);
    assert_eq!(hyd1.is_lake, hyd2.is_lake);

    let (_, _, cur3, clim3, hyd3) = run_water("det2", 180);
    assert_ne!(cur1.speed, cur3.speed);
    assert_ne!(clim1.temp_c, clim3.temp_c);
    assert_ne!(hyd1.discharge_m3s, hyd3.discharge_m3s);
}

#[test]
fn currents_stommel_invariants() {
    let (tec, grid, cur, _, _) = run_water("a", 180);
    let mut max_ocean_spd = 0.0f32;
    let mut has_warm = false;
    let mut has_cold = false;

    for i in 0..grid.len() {
        let spd = cur.speed[i];
        assert!(spd.is_finite(), "non-finite current speed at {i}");
        if tec.elevation_km[i] > 0.0 {
            assert_eq!(spd, 0.0, "non-zero ocean current on land at {i}");
        } else {
            max_ocean_spd = max_ocean_spd.max(spd);
        }
        if cur.temp_anomaly[i] > 0.1 {
            has_warm = true;
        }
        if cur.temp_anomaly[i] < -0.1 {
            has_cold = true;
        }
    }

    assert!(max_ocean_spd > 0.05, "max ocean speed too low: {max_ocean_spd}");
    assert!(has_warm && has_cold, "expected warm and cold currents");
}

#[test]
fn climate_moisture_invariants() {
    let (tec, grid, _, clim, _) = run_water("a", 180);
    let w = grid.w;
    let h = grid.h;

    let mut eq_sum = 0.0f64;
    let mut eq_cnt = 0usize;
    let mut pol_sum = 0.0f64;
    let mut pol_cnt = 0usize;
    let mut same_lat_pairs = 0usize;
    let mut same_lat_colder = 0usize;
    let mut diff_sum = 0.0f64;

    for y in 0..h {
        let lat = grid.lat_deg(y).abs();
        let (mut hi_s, mut hi_c, mut lo_s, mut lo_c) = (0.0f64, 0usize, 0.0f64, 0usize);
        for x in 0..w {
            let i = grid.idx(x, y);
            let t = clim.temp_c[i];
            let p = clim.precip_mm[i];
            let m = clim.moisture[i];
            let rl = clim.rain_level[i];

            assert!(t.is_finite(), "non-finite temp at {i}");
            assert!(p.is_finite() && p >= 0.0, "bad precip {p} at {i}");
            assert!(m.is_finite() && (0.0..=1.0).contains(&m), "bad moisture {m}");
            assert!((1..=5).contains(&rl), "bad rain_level {rl}");

            if lat < 15.0 {
                eq_sum += t as f64;
                eq_cnt += 1;
            } else if lat > 65.0 {
                pol_sum += t as f64;
                pol_cnt += 1;
            }

            let elev = tec.elevation_km[i];
            if elev > 2.0 {
                hi_s += t as f64;
                hi_c += 1;
            } else if elev > 0.0 && elev < 0.6 {
                lo_s += t as f64;
                lo_c += 1;
            }
        }
        if hi_c > 0 && lo_c > 0 {
            let hi_mean = hi_s / hi_c as f64;
            let lo_mean = lo_s / lo_c as f64;
            same_lat_pairs += 1;
            diff_sum += lo_mean - hi_mean;
            if hi_mean + 1.0 < lo_mean {
                same_lat_colder += 1;
            }
        }
    }

    assert!(eq_sum / eq_cnt as f64 > pol_sum / pol_cnt as f64 + 15.0);
    assert!(
        same_lat_pairs > 0
            && same_lat_colder * 10 >= same_lat_pairs * 9
            && diff_sum / same_lat_pairs as f64 > 5.0,
        "same_lat_pairs={same_lat_pairs}, same_lat_colder={same_lat_colder}, mean_diff={:.2}",
        diff_sum / same_lat_pairs.max(1) as f64
    );
}

#[test]
fn hydrology_invariants_and_seam_wrap() {
    let (tec, grid, _, _, hyd) = run_water("a", 180);
    let n = grid.len();

    for i in 0..n {
        let r = hyd.receiver[i];
        if r >= 0 {
            assert!(
                hyd.filled_km[r as usize] <= hyd.filled_km[i],
                "uphill receiver at {i} -> {r}: {} -> {}",
                hyd.filled_km[i],
                hyd.filled_km[r as usize]
            );
        }
    }

    let mut lake_cells = 0usize;
    for i in 0..n {
        if hyd.is_lake[i] != 0 {
            lake_cells += 1;
            assert_eq!(hyd.is_ocean[i], 0);
            assert!(
                tec.elevation_km[i] <= hyd.lake_surface_km[i] + 1e-4,
                "lake cell {i} above surface: {} > {}",
                tec.elevation_km[i],
                hyd.lake_surface_km[i]
            );
        }
    }
    assert!(lake_cells > 0);

    assert!(!hyd.rivers.is_empty());
    let river_ids: HashSet<u32> = hyd.rivers.iter().map(|r| r.id).collect();
    for river in &hyd.rivers {
        let min_len = if matches!(river.mouth, MouthKind::Confluence(_)) { 2 } else { 3 };
        assert!(river.cells.len() >= min_len);
        assert!(!river.smoothed_pts.is_empty());
        assert_eq!(river.smoothed_pts.len(), river.widths.len());
        let last = *river.cells.last().unwrap();
        match river.mouth {
            MouthKind::Ocean => assert_ne!(hyd.is_ocean[last], 0, "ocean river mouth not ocean"),
            MouthKind::Lake => assert_ne!(hyd.is_lake[last], 0, "lake river mouth not lake"),
            MouthKind::Endorheic => assert!(
                hyd.receiver[last] < 0 || hyd.is_salt_flat[last] != 0 || (hyd.is_ocean[last] == 0 && hyd.is_lake[last] == 0),
                "endorheic mouth invalid"
            ),
            MouthKind::Confluence(parent_id) => {
                assert_ne!(hyd.river_mask[last], 0, "confluence mouth must be a river cell");
                assert!(river_ids.contains(&parent_id), "missing parent river {parent_id}");
            }
        }
    }

    let seam_grid = Grid::new(180, 90, 6371.0);
    let mut mask = vec![0u8; seam_grid.len()];
    mask[seam_grid.idx(179, 45)] = 1;
    let dist = distance_to_mask_km(&mask, &seam_grid);
    let d_seam = dist[seam_grid.idx(0, 45)];
    let expected_dx = seam_grid.dx_km(45) as f32;
    assert!(
        (d_seam - expected_dx).abs() < 1.0,
        "seam distance mismatch: {d_seam} vs {expected_dx}"
    );
}

#[test]
fn currents_stommel_gyre_orientation() {
    let grid = Grid::new(180, 90, 6371.0);
    let mut elev = vec![1.0f32; grid.len()];
    for y in 4..86 {
        for x in 30..150 {
            elev[grid.idx(x, y)] = -2.0;
        }
    }

    let cur = currents::solve(&grid, &elev);

    // Северное полушарие, субтропический круговорот (~27°N, y = 31):
    // западная граница (Гольфстрим/Куросио) — на север и тёплое, восточная (Канарское) — на юг и холодное.
    let nh_west = grid.idx(34, 31);
    let nh_east = grid.idx(145, 31);
    assert!(cur.v[nh_west] > 0.0, "NH western boundary v should be northward: {}", cur.v[nh_west]);
    assert!(cur.temp_anomaly[nh_west] > 0.0, "NH western boundary should be warm: {}", cur.temp_anomaly[nh_west]);
    assert!(cur.v[nh_east] < 0.0, "NH eastern boundary v should be southward: {}", cur.v[nh_east]);
    assert!(cur.temp_anomaly[nh_east] < 0.0, "NH eastern boundary should be cold: {}", cur.temp_anomaly[nh_east]);
    assert!(
        cur.v[nh_west].abs() > cur.v[nh_east].abs(),
        "expected western intensification in NH: |{}| vs |{}|",
        cur.v[nh_west],
        cur.v[nh_east]
    );

    // Пассаты (~15°N, y = 37) текут на запад, западные ветры (~45°N, y = 22) — на восток.
    let nh_trades = grid.idx(90, 37);
    let nh_westerlies = grid.idx(90, 22);
    assert!(cur.u[nh_trades] < 0.0, "NH trades should flow westward: {}", cur.u[nh_trades]);
    assert!(cur.u[nh_westerlies] > 0.0, "NH westerlies should flow eastward: {}", cur.u[nh_westerlies]);

    // Южное полушарие, субтропический круговорот (~27°S, y = 58):
    // западная граница (Бразильское) — на юг и тёплое, восточная (Гумбольдта) — на север и холодное.
    let sh_west = grid.idx(34, 58);
    let sh_east = grid.idx(145, 58);
    assert!(cur.v[sh_west] < 0.0, "SH western boundary v should be southward: {}", cur.v[sh_west]);
    assert!(cur.temp_anomaly[sh_west] > 0.0, "SH western boundary should be warm: {}", cur.temp_anomaly[sh_west]);
    assert!(cur.v[sh_east] > 0.0, "SH eastern boundary v should be northward: {}", cur.v[sh_east]);
    assert!(cur.temp_anomaly[sh_east] < 0.0, "SH eastern boundary should be cold: {}", cur.temp_anomaly[sh_east]);
}

#[test]
fn hydrology_negative_depression_and_mainstem() {
    let grid = Grid::new(120, 60, 6371.0);
    let n = grid.len();
    let mut elev = vec![0.0f32; n];
    let force_lake = vec![0u8; n];
    let margin = vec![0u8; n];

    // Океан на x < 20, суша полого понижается к океану (выше вырезанных русел)
    for y in 0..grid.h {
        for x in 0..grid.w {
            let i = grid.idx(x, y);
            elev[i] = if x < 20 {
                -1.0
            } else {
                2.5 + 0.01 * (x - 20) as f32
            };
        }
    }

    // Длинный главный ствол по y = 30, x = 20..=60 (уклон на запад к океану)
    for x in 20..=60 {
        elev[grid.idx(x, 30)] = 0.05 + 0.05 * (x - 20) as f32;
    }
    // Короткий, но более многоводный боковой приток на x = 31, y = 24..=29 -> впадает в (30, 30)
    for y in 24..=29 {
        elev[grid.idx(31, y)] = 0.61 + 0.05 * (29 - y) as f32;
    }

    // Замкнутое кольцо суши и отрицательная котловина: x in 70..76, y in 26..32
    for y in 25..=32 {
        for x in 69..=76 {
            elev[grid.idx(x, y)] = if (70..76).contains(&x) && (26..32).contains(&y) {
                -2.0
            } else {
                3.6
            };
        }
    }

    let mut clim = climate::Climate::uniform(&grid, 15.0, 0.0, 0.05);

    // Главный ствол: исток у (60, 30) имеет расход выше порога 4200 м³/с, но меньше истока бокового притока
    for x in 20..=59 {
        let i = grid.idx(x, 30);
        clim.precip_mm[i] = 400.0;
        clim.moisture[i] = 0.3;
        clim.pet_mm[i] = 400.0;
        clim.aridity_index[i] = 1.0;
    }
    {
        let head = grid.idx(60, 30);
        clim.precip_mm[head] = 2000.0;
        clim.moisture[head] = 1.0;
        clim.pet_mm[head] = 400.0;
        clim.aridity_index[head] = 5.0;
    }
    // Боковой приток: многоводный короткий приток (31, 24..=29)
    for y in 24..=29 {
        let i = grid.idx(31, y);
        clim.precip_mm[i] = 3000.0;
        clim.moisture[i] = 1.0;
        clim.pet_mm[i] = 400.0;
        clim.aridity_index[i] = 7.5;
    }
    // Жаркая аридная котловина
    for y in 26..32 {
        for x in 70..76 {
            let i = grid.idx(x, y);
            clim.temp_c[i] = 30.0;
            clim.precip_mm[i] = 100.0;
            clim.moisture[i] = 0.05;
            clim.pet_mm[i] = 1800.0;
            clim.aridity_index[i] = 100.0 / 1800.0;
        }
    }

    let hyd = hydrology::compute(&grid, &elev, &force_lake, &margin, &clim, "synth");

    // Сравнение с нулевыми осадками внутри котловины: сток из бессточной котловины не должен утекать наружу
    let mut clim_dry_dep = clim.clone();
    for y in 26..32 {
        for x in 70..76 {
            let i = grid.idx(x, y);
            clim_dry_dep.precip_mm[i] = 0.0;
            clim_dry_dep.aridity_index[i] = 0.0;
        }
    }
    let hyd_dry = hydrology::compute(&grid, &elev, &force_lake, &margin, &clim_dry_dep, "synth");

    for i in 0..n {
        let r = hyd.receiver[i];
        if r >= 0 {
            assert!(
                hyd.filled_km[r as usize] <= hyd.filled_km[i],
                "uphill receiver at {i} -> {r}: {} -> {}",
                hyd.filled_km[i],
                hyd.filled_km[r as usize]
            );
        }
    }

    // Внутри замкнутой аридной котловины нет океана/полного озера, а её сток не утекает наружу
    let mut salt_count = 0usize;
    let mut dep_discharge_sum = 0.0f32;
    for y in 26..32 {
        for x in 70..76 {
            let i = grid.idx(x, y);
            assert_eq!(hyd.is_ocean[i], 0);
            assert_eq!(hyd.is_lake[i], 0);
            dep_discharge_sum += hyd.discharge_m3s[i];
            if hyd.is_salt_flat[i] != 0 {
                salt_count += 1;
            }
        }
    }
    assert!(salt_count > 0, "expected salt flat in closed arid depression");
    assert!(dep_discharge_sum > 500.0, "expected non-zero internal runoff in depression");

    for y in 0..grid.h {
        for x in 0..grid.w {
            if (70..76).contains(&x) && (26..32).contains(&y) {
                continue;
            }
            let i = grid.idx(x, y);
            assert_eq!(
                hyd.discharge_m3s[i], hyd_dry.discharge_m3s[i],
                "depression runoff leaked to cell ({x}, {y}): {} vs {}",
                hyd.discharge_m3s[i], hyd_dry.discharge_m3s[i]
            );
        }
    }

    // Главный длинный ствол (от x = 60, y = 30) должен впадать в океан,
    // а более короткий и многоводный боковой приток (от x = 31, y = 24) — в главный ствол.
    let main_head = grid.idx(60, 30);
    let trib_head = grid.idx(31, 24);
    let main_river = hyd
        .rivers
        .iter()
        .find(|r| r.cells.first() == Some(&main_head))
        .expect("mainstem river missing");
    let trib_river = hyd
        .rivers
        .iter()
        .find(|r| r.cells.first() == Some(&trib_head))
        .expect("tributary river missing");

    assert_eq!(main_river.mouth, MouthKind::Ocean, "long mainstem must reach ocean");
    assert_eq!(
        trib_river.mouth,
        MouthKind::Confluence(main_river.id),
        "shorter wetter tributary must join mainstem"
    );
}

#[test]
fn climate_seasonality_monsoon_and_glaciers() {
    let (tec, grid, _, clim, _) = run_water("a", 180);
    let mut ocean_amp_sum = 0.0f64;
    let mut ocean_cnt = 0usize;
    let mut cont_amp_sum = 0.0f64;
    let mut cont_cnt = 0usize;
    let mut has_glacier = false;

    for y in 0..grid.h {
        let lat = grid.lat_deg(y).abs();
        for x in 0..grid.w {
            let i = grid.idx(x, y);
            assert!(clim.pet_mm[i].is_finite() && clim.pet_mm[i] > 0.0);
            assert!(clim.aridity_index[i].is_finite() && clim.aridity_index[i] >= 0.0);
            assert!(clim.snow_frac[i].is_finite() && (0.0..=1.0).contains(&clim.snow_frac[i]));
            assert!(clim.glacier[i].is_finite() && (0.0..=1.0).contains(&clim.glacier[i]));
            assert!(clim.temp_amp_c[i].is_finite() && clim.temp_amp_c[i] >= 0.0);
            assert!(clim.monsoon_index[i].is_finite() && clim.monsoon_index[i] >= 0.0);

            if clim.glacier[i] > 0.1 {
                has_glacier = true;
            }
            if (30.0..=65.0).contains(&lat) {
                if tec.elevation_km[i] <= 0.0 {
                    ocean_amp_sum += clim.temp_amp_c[i] as f64;
                    ocean_cnt += 1;
                } else if clim.dist_to_sea_km[i] > 600.0 {
                    cont_amp_sum += clim.temp_amp_c[i] as f64;
                    cont_cnt += 1;
                }
            }
        }
    }

    assert!(ocean_cnt > 0 && cont_cnt > 0, "ocean={ocean_cnt} cont={cont_cnt}");
    let ocean_mean = ocean_amp_sum / ocean_cnt as f64;
    let cont_mean = cont_amp_sum / cont_cnt as f64;
    assert!(
        cont_mean > ocean_mean + 5.0,
        "continental seasonal amplitude {cont_mean:.2} should exceed ocean {ocean_mean:.2}"
    );
    assert!(has_glacier, "expected polar or mountain glaciers");
}

#[test]
fn hydrology_lake_evap_and_desert_loss() {
    let grid = Grid::new(90, 45, 6371.0);
    let n = grid.len();
    let mut elev = vec![0.0f32; n];
    let force_lake = vec![0u8; n];
    let margin = vec![0u8; n];

    for y in 0..grid.h {
        for x in 0..grid.w {
            elev[grid.idx(x, y)] = if x < 10 {
                -1.0
            } else {
                2.5 + 0.01 * (x - 10) as f32
            };
        }
    }
    // Канал стока к океану (y = 22, x = 10..=39)
    for x in 10..=39 {
        elev[grid.idx(x, 22)] = 0.05 + 0.03 * (x - 10) as f32;
    }
    // Котловина озера 3x3 на (40..=42, 21..=23) с выходом через (39, 22) = 0.92
    for y in 21..=23 {
        for x in 40..=42 {
            elev[grid.idx(x, y)] = 0.40;
        }
    }
    // Питающий канал (43..=70, y = 22)
    for x in 43..=70 {
        elev[grid.idx(x, 22)] = 0.95 + 0.03 * (x - 43) as f32;
    }

    let mut base_clim = climate::Climate::uniform(&grid, 12.0, 0.0, 0.05);
    for x in 43..=70 {
        let i = grid.idx(x, 22);
        base_clim.precip_mm[i] = 2500.0;
        base_clim.moisture[i] = 1.0;
        base_clim.pet_mm[i] = 400.0;
        base_clim.aridity_index[i] = 6.25;
    }
    for y in 21..=23 {
        for x in 40..=42 {
            let i = grid.idx(x, y);
            base_clim.precip_mm[i] = 2500.0;
            base_clim.moisture[i] = 1.0;
            base_clim.pet_mm[i] = 400.0;
            base_clim.aridity_index[i] = 6.25;
        }
    }

    let mut cold_clim = base_clim.clone();
    let mut hot_clim = base_clim.clone();
    for y in 21..=23 {
        for x in 40..=42 {
            cold_clim.temp_c[grid.idx(x, y)] = -10.0;
            hot_clim.temp_c[grid.idx(x, y)] = 28.0;
        }
    }

    let hyd_cold = hydrology::compute(&grid, &elev, &force_lake, &margin, &cold_clim, "lake_evap");
    let hyd_hot = hydrology::compute(&grid, &elev, &force_lake, &margin, &hot_clim, "lake_evap");

    for y in 21..=23 {
        for x in 40..=42 {
            let i = grid.idx(x, y);
            assert_eq!(hyd_cold.is_lake[i], 1);
            assert_eq!(hyd_hot.is_lake[i], 1);
        }
    }
    let outlet = grid.idx(39, 22);
    assert!(
        hyd_hot.discharge_m3s[outlet] < hyd_cold.discharge_m3s[outlet] * 0.90,
        "hot lake outlet Q={} should be noticeably lower than cold lake Q={}",
        hyd_hot.discharge_m3s[outlet],
        hyd_cold.discharge_m3s[outlet]
    );

    // Часть Б: потери пустынной транзитной реки (x = 10..=39, y = 22)
    let mut desert_clim = cold_clim;
    for x in 10..=39 {
        let i = grid.idx(x, 22);
        desert_clim.temp_c[i] = 35.0;
        desert_clim.precip_mm[i] = 50.0;
        desert_clim.moisture[i] = 0.05;
        desert_clim.pet_mm[i] = 2200.0;
        desert_clim.aridity_index[i] = 50.0 / 2200.0;
    }
    let hyd_des = hydrology::compute(&grid, &elev, &force_lake, &margin, &desert_clim, "lake_loss");
    let upper_des = grid.idx(38, 22);
    let lower_des = grid.idx(15, 22);
    assert!(
        hyd_des.water_loss_m3s[grid.idx(25, 22)] > 0.0,
        "expected positive transmission loss in desert river"
    );
    assert!(
        hyd_des.discharge_m3s[lower_des] < hyd_des.discharge_m3s[upper_des],
        "desert river discharge should decrease downstream: {} vs {}",
        hyd_des.discharge_m3s[lower_des],
        hyd_des.discharge_m3s[upper_des]
    );
}

#[test]
fn climate_and_currents_rotation_rate_physics() {
    let grid = Grid::new(120, 60, 6371.0);
    let mut elev = vec![0.3f32; grid.len()];
    for y in 4..56 {
        for x in 10..55 {
            elev[grid.idx(x, y)] = -2.5;
        }
    }

    let cur_slow = currents::solve_with_rotation(&grid, &elev, 0.4);
    let cur_fast = currents::solve_with_rotation(&grid, &elev, 2.2);

    for cur in [&cur_slow, &cur_fast] {
        assert!(cur.u.iter().all(|&v| v.is_finite() && v.abs() <= 2.0));
        assert!(cur.v.iter().all(|&v| v.is_finite() && v.abs() <= 2.0));
        assert!(cur.speed.iter().all(|&v| v.is_finite()));
    }

    let mut p_slow = ClimateParams::default();
    p_slow.rotation_rate = 0.4;
    let mut p_fast = ClimateParams::default();
    p_fast.rotation_rate = 2.2;

    let c_slow = climate::compute_with_params(&grid, &elev, &cur_slow, "rot", &p_slow);
    let c_fast = climate::compute_with_params(&grid, &elev, &cur_fast, "rot", &p_fast);

    let mut diff_wind = 0.0f64;
    let mut diff_prec = 0.0f64;
    for i in 0..grid.len() {
        assert!(c_slow.temp_c[i].is_finite() && c_fast.temp_c[i].is_finite());
        assert!(c_slow.precip_mm[i].is_finite() && c_fast.precip_mm[i].is_finite());
        diff_wind += (c_slow.wind_u_jul[i] - c_fast.wind_u_jul[i]).abs() as f64;
        diff_prec += (c_slow.precip_mm[i] - c_fast.precip_mm[i]).abs() as f64;
    }
    assert!(diff_wind > 100.0 && diff_prec > 1000.0);

    // При медленном вращении перепад температур экватор–полюса сглаживается шире развёрнутыми ячейками Хэдли
    let eq_y = grid.h / 2;
    let mean_row = |clim: &climate::Climate, y: usize| -> f64 {
        (0..grid.w)
            .map(|x| clim.temp_c[grid.idx(x, y)] as f64)
            .sum::<f64>()
            / grid.w as f64
    };
    let eq_slow = mean_row(&c_slow, eq_y);
    let pol_slow = 0.5 * (mean_row(&c_slow, 3) + mean_row(&c_slow, grid.h - 4));
    let eq_fast = mean_row(&c_fast, eq_y);
    let pol_fast = 0.5 * (mean_row(&c_fast, 3) + mean_row(&c_fast, grid.h - 4));
    assert!(
        (eq_slow - pol_slow) < (eq_fast - pol_fast),
        "slow rotator gradient {:.2} should be weaker than fast rotator {:.2}",
        eq_slow - pol_slow,
        eq_fast - pol_fast
    );
}

#[test]
fn hydrology_seasonal_snowmelt_wadis_oases_and_closed_basins() {
    let grid = Grid::new(90, 45, 6371.0);
    let n = grid.len();
    let mut elev = vec![0.0f32; n];
    let force_lake = vec![0u8; n];
    let margin = vec![0u8; n];

    // Океан на x < 10, горная гряда на x = 55..=60, предгорная пустыня на x = 40..54,
    // и замкнутая впадина на (x in 70..75, y in 20..25)
    for y in 0..grid.h {
        for x in 0..grid.w {
            let e = if x < 10 {
                -1.0
            } else if (70..75).contains(&x) && (20..25).contains(&y) {
                -0.8
            } else if (68..=76).contains(&x) && (18..=26).contains(&y) {
                3.5
            } else if x >= 55 && x <= 60 {
                3.2 + 0.02 * (x - 55) as f32
            } else {
                0.2 + 0.03 * (x as f32 - 10.0)
            };
            elev[grid.idx(x, y)] = e;
        }
    }
    // Русло со снежных гор (x = 55..=60 -> пустынный выход x = 10..=54) по y = 12
    for x in 10..=60 {
        let base = if x >= 55 {
            1.4 + 0.08 * (x - 55) as f32
        } else {
            0.05 + 0.028 * (x - 10) as f32
        };
        elev[grid.idx(x, 12)] = base;
    }

    let mut clim = climate::Climate::uniform(&grid, 22.0, 40.0, 0.06);
    for i in 0..n {
        clim.pet_mm[i] = 1800.0;
        clim.aridity_index[i] = 40.0 / 1800.0;
    }
    // В верховье на (55..=60, 12) — холодная зима (-12C), тёплое лето (+14C), зимний снег тает в июле
    for x in 55..=60 {
        let i = grid.idx(x, 12);
        clim.temp_jan_c[i] = -12.0;
        clim.temp_jul_c[i] = 14.0;
        clim.temp_c[i] = 1.0;
        clim.precip_jan_mm[i] = 2800.0;
        clim.precip_jul_mm[i] = 400.0;
        clim.precip_mm[i] = 1600.0;
        clim.moisture[i] = 0.9;
        clim.snow_frac[i] = 0.70;
        clim.pet_mm[i] = 400.0;
        clim.aridity_index[i] = 4.0;
    }
    // Сосед предгорья для подпитки оазиса
    let mtn_nb = grid.idx(54, 11);
    clim.precip_mm[mtn_nb] = 900.0;
    clim.snow_frac[mtn_nb] = 0.45;
    elev[mtn_nb] = 2.4;

    // Дождь в замкнутую аридную котловину, чтобы проверить отсутствие сезонной утечки наружу
    for y in 20..25 {
        for x in 70..75 {
            let i = grid.idx(x, y);
            clim.precip_jan_mm[i] = 250.0;
            clim.precip_jul_mm[i] = 250.0;
            clim.precip_mm[i] = 250.0;
        }
    }

    let hyd = hydrology::compute(&grid, &elev, &force_lake, &margin, &clim, "seasonal");
    let mut clim_dry_dep = clim;
    for y in 20..25 {
        for x in 70..75 {
            let i = grid.idx(x, y);
            clim_dry_dep.precip_jan_mm[i] = 0.0;
            clim_dry_dep.precip_jul_mm[i] = 0.0;
            clim_dry_dep.precip_mm[i] = 0.0;
        }
    }
    let hyd_dry = hydrology::compute(&grid, &elev, &force_lake, &margin, &clim_dry_dep, "seasonal");

    let foothills = grid.idx(50, 12);
    assert!(
        hyd.discharge_jul_m3s[foothills] > hyd.discharge_jan_m3s[foothills],
        "expected summer snowmelt peak at foothills: jul={} vs jan={}",
        hyd.discharge_jul_m3s[foothills],
        hyd.discharge_jan_m3s[foothills]
    );
    assert!(
        hyd.is_oasis.iter().any(|&v| v != 0),
        "expected desert oasis near mountain front / losing stream"
    );
    for i in 0..n {
        assert!(hyd.discharge_jan_m3s[i].is_finite() && hyd.discharge_jul_m3s[i].is_finite());
        assert!((0.0..=1.0).contains(&hyd.flow_seasonality[i]));
        let (x, y) = grid.xy(i);
        if !((70..75).contains(&x) && (20..25).contains(&y)) {
            assert_eq!(hyd.discharge_jan_m3s[i], hyd_dry.discharge_jan_m3s[i]);
            assert_eq!(hyd.discharge_jul_m3s[i], hyd_dry.discharge_jul_m3s[i]);
        }
    }
}

#[test]
fn currents_circumpolar_channel_and_thermal_advection() {
    let grid = Grid::new(180, 90, 6371.0);
    let mut elev = vec![-2.5f32; grid.len()];
    // Северный материковый барьер выше 32° ю.ш. и антарктическая шапка южнее 64° ю.ш. —
    // оставляем открытый зональный коридор в зоне западных ветров (40..58° ю.ш.).
    for y in 0..grid.h {
        let lat = grid.lat_deg(y);
        for x in 0..grid.w {
            if (lat > -28.0 && (30..80).contains(&x)) || lat < -64.0 {
                elev[grid.idx(x, y)] = 1.2;
            }
        }
    }
    let cur = currents::solve(&grid, &elev);
    let acc_y = 66usize; // ~43°S (внутри открытого коридора западных ветров)
    let mut east_cnt = 0usize;
    for x in 0..grid.w {
        let u = cur.u[grid.idx(x, acc_y)];
        assert!(u.is_finite() && cur.temp_anomaly[grid.idx(x, acc_y)].is_finite());
        if u > 0.05 {
            east_cnt += 1;
        }
    }
    assert!(
        east_cnt * 10 >= grid.w * 8,
        "expected continuous eastward circumpolar drift across southern channel, got {east_cnt}/{}",
        grid.w
    );
}
