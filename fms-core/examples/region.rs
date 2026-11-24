use fms_core::civilization::SettlementRole;
use fms_core::hydrology::MouthKind;
use fms_core::planet;
use fms_core::region::{self, RegionOptions};
use fms_core::tectonic::Options;
use std::fs::File;
use std::io::{BufWriter, Write};
use std::time::Instant;

fn write_ppm(path: &str, w: usize, h: usize, rgb: &[u8]) {
    let f = File::create(path).expect("failed to create ppm");
    let mut out = BufWriter::new(f);
    writeln!(out, "P6\n{w} {h}\n255").unwrap();
    out.write_all(rgb).unwrap();
}

fn lerp_rgb(a: [u8; 3], b: [u8; 3], t: f32) -> [u8; 3] {
    let t = t.clamp(0.0, 1.0);
    [
        (a[0] as f32 + (b[0] as f32 - a[0] as f32) * t).round() as u8,
        (a[1] as f32 + (b[1] as f32 - a[1] as f32) * t).round() as u8,
        (a[2] as f32 + (b[2] as f32 - a[2] as f32) * t).round() as u8,
    ]
}

fn elev_color(e: f32) -> [u8; 3] {
    if e <= 0.0 {
        let t = (-e / 5.5).clamp(0.0, 1.0);
        lerp_rgb([64, 130, 180], [12, 34, 68], t)
    } else if e < 0.8 {
        lerp_rgb([74, 134, 72], [186, 178, 108], e / 0.8)
    } else if e < 2.2 {
        lerp_rgb([186, 178, 108], [138, 102, 68], (e - 0.8) / 1.4)
    } else {
        lerp_rgb(
            [138, 102, 68],
            [244, 246, 250],
            ((e - 2.2) / 3.0).clamp(0.0, 1.0),
        )
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed = args.get(1).map(|s| s.as_str()).unwrap_or("a");
    let scale: usize = args
        .get(2)
        .and_then(|s| s.parse().ok())
        .unwrap_or(6)
        .clamp(2, 16);
    let ppm_prefix = args.get(3).map(|s| s.as_str());

    let mut opt = Options::new(seed);
    opt.w = 360;
    let p = planet::generate(&opt).expect("planet generate");

    // Выбираем заметную столицу (или устье крупной реки), чтобы в окне были и реки, и побережье, и горы
    let focus_cell = p
        .civilization
        .settlements
        .iter()
        .find(|s| s.role == SettlementRole::Capital && (s.is_port || s.river_access))
        .or_else(|| p.civilization.settlements.first())
        .map(|s| s.cell)
        .unwrap_or(p.grid.idx(p.grid.w / 2, p.grid.h / 2));

    let mut r_opt = RegionOptions::around_cell(&p, focus_cell, 22.0, scale);
    r_opt.span_lon_deg = 32.0;

    let t0 = Instant::now();
    let reg = region::generate_region(&p, &r_opt).expect("region generation failed");
    let elapsed = t0.elapsed();

    let n = reg.w * reg.h;
    let avg_dx = reg.dx_km_row.iter().sum::<f64>() / reg.dx_km_row.len() as f64;
    let (mut e_min, mut e_max) = (f32::MAX, f32::MIN);
    let mut land_cnt = 0usize;
    let mut lake_cnt = 0usize;
    let mut wadi_cnt = 0usize;
    let mut oasis_cnt = 0usize;
    let mut boundary_in: f64 = 0.0;
    for i in 0..n {
        e_min = e_min.min(reg.elevation_km[i]);
        e_max = e_max.max(reg.elevation_km[i]);
        if reg.is_ocean[i] == 0 {
            land_cnt += 1;
        }
        if reg.is_lake[i] != 0 {
            lake_cnt += 1;
        }
        if reg.is_wadi[i] != 0 {
            wadi_cnt += 1;
        }
        if reg.is_oasis[i] != 0 {
            oasis_cnt += 1;
        }
        boundary_in += reg.boundary_inflow_m3s[i] as f64;
    }

    let (mut r_oce, mut r_lake, mut r_end, mut r_conf) = (0usize, 0usize, 0usize, 0usize);
    for r in &reg.rivers {
        match r.mouth {
            MouthKind::Ocean => r_oce += 1,
            MouthKind::Lake => r_lake += 1,
            MouthKind::Endorheic => r_end += 1,
            MouthKind::Confluence(_) => r_conf += 1,
        }
    }

    println!(
        "region seed={seed} scale={scale}x grid={}x{} time={:?} cell={:.1}x{:.1} km",
        reg.w, reg.h, elapsed, avg_dx, reg.dy_km
    );
    println!(
        "window: center=({:.2}, {:.2}) land={:.3} elev=[{e_min:.2}, {e_max:.2}] km boundary_inflow={boundary_in:.0} m3/s",
        reg.center_lat_deg,
        reg.center_lon_deg,
        land_cnt as f64 / n as f64
    );
    println!(
        "hydro: rivers={} (ocean={r_oce} lake={r_lake} endorheic={r_end} conf={r_conf} vs global {}) lake_cells={lake_cnt} wadis={wadi_cnt} oases={oasis_cnt}",
        reg.rivers.len(),
        p.hydrology.rivers.len()
    );
    println!(
        "features: passes={} settlements={}",
        reg.passes.len(),
        reg.settlements.len()
    );
    if !reg.settlements.is_empty() {
        let names: Vec<&str> = reg
            .settlements
            .iter()
            .take(5)
            .map(|s| s.name.as_str())
            .collect();
        println!("settlements sample: {}", names.join(", "));
    }

    if let Some(prefix) = ppm_prefix {
        let mut img_elev = vec![0u8; n * 3];
        let mut img_biom = vec![0u8; n * 3];
        for i in 0..n {
            let mut ce = elev_color(reg.elevation_km[i]);
            let mut cb = if reg.river_mask[i] != 0 {
                [42, 118, 188]
            } else if reg.is_wadi[i] != 0 {
                [132, 152, 128]
            } else {
                reg.biome[i].rgb()
            };
            if reg.river_mask[i] != 0 {
                ce = lerp_rgb(ce, [42, 118, 188], 0.72);
            }
            if reg.is_oasis[i] != 0 {
                cb = [64, 178, 92];
            }
            img_elev[3 * i..3 * i + 3].copy_from_slice(&ce);
            img_biom[3 * i..3 * i + 3].copy_from_slice(&cb);
        }
        for s in &reg.settlements {
            let col = if s.role == SettlementRole::Capital {
                [252, 232, 64]
            } else {
                [248, 248, 248]
            };
            img_biom[3 * s.cell..3 * s.cell + 3].copy_from_slice(&col);
        }
        write_ppm(&format!("{prefix}_elev.ppm"), reg.w, reg.h, &img_elev);
        write_ppm(&format!("{prefix}_biomes.ppm"), reg.w, reg.h, &img_biom);
        println!("wrote regional PPM maps with prefix '{prefix}'");
    }
}
