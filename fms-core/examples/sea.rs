use fms_core::tectonic::{generate, Options};
fn main() {
    for seed in ["a", "b", "c", "d"] {
        let w = generate(&Options::new(seed)).unwrap();
        let mn = w.sea_level_history_km.iter().cloned().fold(f64::MAX, f64::min);
        let mx = w.sea_level_history_km.iter().cloned().fold(f64::MIN, f64::max);
        println!("{} land {:.3} marine-sed {:.2} recent-seabed {:.2} sea hist {:.2}..{:.2} (swing {:.0} m)", seed, w.stats.land_fraction, w.stats.land_with_marine_sediment_fraction, w.stats.land_recent_seabed_fraction, mn, mx, (mx - mn) * 1000.0);
    }
}
