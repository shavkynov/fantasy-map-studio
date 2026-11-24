use fms_core::tectonic::{generate, isostasy, Options};
use std::f64::consts::PI;

fn opts(seed: &str) -> Options {
    let mut o = Options::new(seed);
    o.w = 180;
    o
}

#[test]
fn determinism_and_seeds() {
    let a = generate(&opts("t1")).unwrap();
    let b = generate(&opts("t1")).unwrap();
    assert_eq!(a.thickness, b.thickness);
    assert_eq!(a.elevation_km, b.elevation_km);
    let c = generate(&opts("t2")).unwrap();
    assert_ne!(a.thickness, c.thickness);
}

#[test]
fn volume_conservation() {
    let w = generate(&opts("t1")).unwrap();
    let s = &w.stats;
    assert!(s.arc_added_volume > 0.0);
    let expect = s.point_volume_start + s.arc_added_volume + s.hotspot_added_volume;
    assert!((s.point_volume_end / expect - 1.0).abs() < 1e-4, "{} {}", s.point_volume_end, expect);
    assert!(s.sediment_lost_volume >= 0.0);
    assert!(((s.crust_volume_after_erosion + s.sediment_lost_volume) / s.crust_volume_before_erosion - 1.0).abs() < 2e-3);
}

#[test]
fn thickness_sea_and_land() {
    let w = generate(&opts("t1")).unwrap();
    assert!(w.thickness.iter().all(|&t| t.is_finite() && t >= 0.0 && t <= 80.0));
    let mut v = 0.0;
    for i in 0..w.w * w.h {
        let e = w.elevation_km[i] as f64;
        if e < 0.0 { v += -e * w.cell_area[i]; }
    }
    assert!((v / (2.62 * 4.0 * PI) - 1.0).abs() < 1e-2, "water volume {}", v);
    assert!(w.stats.land_fraction > 0.15 && w.stats.land_fraction < 0.45, "{}", w.stats.land_fraction);
    assert!(isostasy(0.0) < isostasy(35.0));
}

#[test]
fn wetter_world_has_less_land() {
    let mut a = opts("t3");
    a.water_depth_km = 1.5;
    let mut b = opts("t3");
    b.water_depth_km = 3.6;
    assert!(generate(&a).unwrap().stats.land_fraction > generate(&b).unwrap().stats.land_fraction);
}

#[test]
fn history_and_forces() {
    let w = generate(&opts("t1")).unwrap();
    assert_eq!(w.history.len(), w.stats.epochs);
    assert_eq!(w.sea_level_history_km.len(), w.stats.epochs);
    for e in &w.history {
        assert!(e.plates >= 4 && e.plates <= 8);
        for &o in &e.omega_rad_per_myr {
            assert!(o >= 0.0 && o * 637.1 <= 12.1, "{}", o * 637.1);
        }
    }
    let mean = |act: f64| {
        let mut o = opts("t1");
        o.activity = act;
        let w = generate(&o).unwrap();
        let v: Vec<f64> = w.history.iter().flat_map(|e| e.omega_rad_per_myr.iter().map(|x| x * 637.1)).collect();
        v.iter().sum::<f64>() / v.len() as f64
    };
    assert!(mean(1.5) > mean(0.5));
}

#[test]
fn ocean_age_and_prefix() {
    let w = generate(&opts("t1")).unwrap();
    let (mut aw, mut ag) = (0.0, 0.0);
    for i in 0..w.w * w.h {
        if w.thickness[i] < 8.0 {
            aw += w.cell_area[i];
            ag += w.ocean_age_myr[i] as f64 * w.cell_area[i];
        }
    }
    let m = ag / aw;
    assert!(m > 30.0 && m < 110.0, "mean ocean age {}", m);
    let mut half = opts("t1");
    half.stop_at_myr = Some(450.0);
    assert_eq!(generate(&half).unwrap().stats.time.round(), 450.0);
}

#[test]
fn option_errors() {
    for bad in [
        { let mut o = opts("x"); o.seed = String::new(); o },
        { let mut o = opts("x"); o.w = 181; o },
        { let mut o = opts("x"); o.w = 1000; o },
        { let mut o = opts("x"); o.radius_km = 100.0; o },
        { let mut o = opts("x"); o.activity = 3.0; o },
        { let mut o = opts("x"); o.age_myr = 10.0; o },
        { let mut o = opts("x"); o.continental_fraction = 0.9; o },
        { let mut o = opts("x"); o.stop_at_myr = Some(1e9); o },
    ] {
        assert!(generate(&bad).is_err());
    }
}

#[test]
fn margins_and_short_history() {
    let w = generate(&opts("t1")).unwrap();
    let act = w.margin.iter().filter(|&&m| m == 1).count();
    let pas = w.margin.iter().filter(|&&m| m == 2).count();
    assert!(act > 0 && pas > 0, "active {} passive {}", act, pas);
    assert!(w.margin.iter().all(|&m| m <= 2));
    let mut o = opts("t1");
    o.history_myr = 300.0;
    let short = generate(&o).unwrap();
    assert_eq!(short.stats.epochs, 2);
    o.history_myr = 100.0;
    assert!(generate(&o).is_err());
}

#[test]
fn flooding_record() {
    let w = generate(&opts("t1")).unwrap();
    let (mn, mx) = w.sea_level_history_km.iter().fold((f64::MAX, f64::MIN), |a, &v| (a.0.min(v), a.1.max(v)));
    assert!(mx > mn, "уровень моря должен меняться: связь с возрастом дна");
    assert!(w.last_submerged_myr.iter().all(|&v| v.is_finite() && v >= -1.0 && (v as f64) <= w.stats.time + 1e-3));
    let f = w.stats.land_recent_seabed_fraction;
    assert!(f > 0.0 && f < 0.9, "recent seabed {}", f);
}

#[test]
fn target_continents_and_zero_stop() {
    for tc in [1u8, 3u8] {
        let mut o = opts("tc_seed");
        o.target_continents = tc;
        let w = generate(&o).unwrap();
        assert!(w.thickness.iter().all(|&t| t.is_finite()));
        assert!(w.elevation_km.iter().all(|&e| e.is_finite()));
        for e in &w.history {
            assert!(e.omega_rad_per_myr.iter().all(|&om| om.is_finite()));
        }
        assert!(
            (0.10..=0.60).contains(&w.stats.land_fraction),
            "target_continents={tc} land_fraction={}",
            w.stats.land_fraction
        );
    }

    let mut bad = opts("tc_seed");
    bad.target_continents = 7;
    assert!(generate(&bad).is_err());

    let mut zero = opts("zero_stop");
    zero.stop_at_myr = Some(0.0);
    let w0 = generate(&zero).unwrap();
    assert_eq!(w0.stats.epochs, 0);
    assert_eq!(w0.stats.time, 0.0);
    assert!(w0.thickness.iter().all(|&t| t.is_finite()));
    assert!(w0.elevation_km.iter().all(|&e| e.is_finite()));
}

#[test]
fn geological_features_present() {
    let w = generate(&opts("t1")).unwrap();
    let n = w.w * w.h;
    for field in [&w.rift, &w.trench, &w.foreland, &w.volcanic] {
        assert_eq!(field.len(), n);
        assert!(field.iter().all(|&v| v.is_finite() && (0.0..=1.0).contains(&v)));
    }
    assert!(w.trench.iter().any(|&v| v > 0.2), "expected subduction trenches");
    assert!(w.foreland.iter().any(|&v| v > 0.1), "expected foreland basins");
    assert!(w.volcanic.iter().any(|&v| v > 0.15), "expected volcanic provinces");
}
