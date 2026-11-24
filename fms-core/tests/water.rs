use fms_core::climate;
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
