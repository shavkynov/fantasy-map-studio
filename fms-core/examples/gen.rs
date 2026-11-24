use fms_core::tectonic::{generate, Options};
fn main() {
    let a: Vec<String> = std::env::args().collect();
    let seed = a.get(1).map(|s| s.as_str()).unwrap_or("a");
    let mut o = Options::new(seed);
    if let Some(w) = a.get(2) { o.w = w.parse().unwrap(); }
    let t = std::time::Instant::now();
    let w = generate(&o).unwrap();
    let mx = w.thickness.iter().cloned().fold(0f32, f32::max);
    println!("seed {} land {:.3} maxT {:.1} sea {:.2} arc {:.2} hot {:.2} time {:?}", seed, w.stats.land_fraction, mx, w.sea_level_km, w.stats.arc_added_volume, w.stats.hotspot_added_volume, t.elapsed());
}
