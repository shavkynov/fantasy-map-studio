use fms_core::biomes::Biome;
use fms_core::civilization::{RouteKind, SettlementRole};
use fms_core::geography::{LakeOrigin, LandmassKind};
use fms_core::hydrology::MouthKind;
use fms_core::planet;
use fms_core::tectonic::Options;
use std::collections::BTreeMap;
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

fn temp_color(t: f32) -> [u8; 3] {
    let u = ((t + 35.0) / 70.0).clamp(0.0, 1.0);
    if u < 0.35 {
        lerp_rgb([36, 72, 168], [92, 188, 224], u / 0.35)
    } else if u < 0.65 {
        lerp_rgb([92, 188, 224], [238, 212, 92], (u - 0.35) / 0.30)
    } else {
        lerp_rgb([238, 212, 92], [198, 48, 36], (u - 0.65) / 0.35)
    }
}

fn precip_color(p: f32) -> [u8; 3] {
    let u = (p / 2500.0).clamp(0.0, 1.0);
    if u < 0.35 {
        lerp_rgb([216, 188, 128], [134, 182, 108], u / 0.35)
    } else {
        lerp_rgb([134, 182, 108], [24, 96, 152], (u - 0.35) / 0.65)
    }
}

fn realm_color(rid: u32) -> [u8; 3] {
    const PALETTE: [[u8; 3]; 12] = [
        [198, 92, 78],
        [86, 146, 196],
        [208, 168, 72],
        [106, 166, 104],
        [156, 108, 178],
        [212, 128, 74],
        [78, 164, 158],
        [182, 96, 134],
        [142, 164, 78],
        [118, 122, 188],
        [186, 142, 104],
        [98, 148, 122],
    ];
    PALETTE[(rid as usize) % PALETTE.len()]
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed = args.get(1).map(|s| s.as_str()).unwrap_or("a");
    let mut opt = Options::new(seed);
    if let Some(w) = args.get(2) {
        opt.w = w.parse().expect("invalid width");
    }
    let ppm_prefix = args.get(3).map(|s| s.as_str());

    let t0 = Instant::now();
    let p = planet::generate(&opt).expect("planet generation failed");
    let elapsed = t0.elapsed();

    let w = p.grid.w;
    let h = p.grid.h;
    let n = p.grid.len();

    let mut land_cells = 0usize;
    let mut land_area = 0.0f64;
    let mut elev_min = f32::MAX;
    let mut elev_max = f32::MIN;
    let mut trench_cnt = 0usize;
    let mut foreland_cnt = 0usize;
    let mut rift_cnt = 0usize;
    let mut volc_cnt = 0usize;
    let mut suture_cnt = 0usize;

    let mut t_min = f32::MAX;
    let mut t_max = f32::MIN;
    let mut amp_max = 0.0f32;
    let mut monsoon_cnt = 0usize;
    let mut glacier_cnt = 0usize;

    let mut max_incision = 0.0f32;
    let mut alluv_cnt = 0usize;
    let mut glac_carve_cnt = 0usize;

    let mut land_precip = Vec::new();
    let mut lake_cnt = 0usize;
    let mut salt_lake_cnt = 0usize;
    let mut salt_cnt = 0usize;
    let mut wadi_cnt = 0usize;
    let mut oasis_cnt = 0usize;
    let mut total_loss_m3s = 0.0f64;

    let mut biome_counts: BTreeMap<&'static str, usize> = BTreeMap::new();

    for i in 0..n {
        let e = p.erosion.elevation_km[i];
        elev_min = elev_min.min(e);
        elev_max = elev_max.max(e);
        if e > 0.0 {
            land_cells += 1;
            land_area += p.tectonic.cell_area[i];
            land_precip.push(p.climate.precip_mm[i]);
        }
        if p.tectonic.trench[i] > 0.2 {
            trench_cnt += 1;
        }
        if p.tectonic.foreland[i] > 0.15 {
            foreland_cnt += 1;
        }
        if p.tectonic.rift[i] > 0.2 {
            rift_cnt += 1;
        }
        if p.tectonic.volcanic[i] > 0.2 {
            volc_cnt += 1;
        }
        if p.tectonic.suture[i] > 0.25 {
            suture_cnt += 1;
        }

        t_min = t_min
            .min(p.climate.temp_jan_c[i])
            .min(p.climate.temp_jul_c[i]);
        t_max = t_max
            .max(p.climate.temp_jan_c[i])
            .max(p.climate.temp_jul_c[i]);
        amp_max = amp_max.max(p.climate.temp_amp_c[i]);
        if p.climate.monsoon_index[i] > 0.40 && e > 0.0 {
            monsoon_cnt += 1;
        }
        if p.climate.glacier[i] > 0.10 {
            glacier_cnt += 1;
        }

        max_incision = max_incision.max(p.erosion.incised_km[i]);
        if p.erosion.alluvium_km[i] > 0.02 {
            alluv_cnt += 1;
        }
        if p.erosion.glacial_carve_km[i] > 0.01 {
            glac_carve_cnt += 1;
        }

        if p.hydrology.is_lake[i] != 0 {
            lake_cnt += 1;
            if p.hydrology.is_endorheic_lake[i] != 0 {
                salt_lake_cnt += 1;
            }
        }
        if p.hydrology.is_salt_flat[i] != 0 {
            salt_cnt += 1;
        }
        if p.hydrology.is_wadi[i] != 0 {
            wadi_cnt += 1;
        }
        if p.hydrology.is_oasis[i] != 0 {
            oasis_cnt += 1;
        }
        total_loss_m3s += p.hydrology.water_loss_m3s[i] as f64;

        let b = p.biomes.biome[i];
        if !matches!(b, Biome::Ocean | Biome::Shelf) {
            *biome_counts.entry(b.name()).or_insert(0) += 1;
        }
    }

    land_precip.sort_by(|a, b| a.total_cmp(b));
    let p_min = land_precip.first().copied().unwrap_or(0.0);
    let p_med = land_precip
        .get(land_precip.len() / 2)
        .copied()
        .unwrap_or(0.0);
    let p_max = land_precip.last().copied().unwrap_or(0.0);

    let (mut r_oce, mut r_lake, mut r_end, mut r_conf) = (0usize, 0usize, 0usize, 0usize);
    for r in &p.hydrology.rivers {
        match r.mouth {
            MouthKind::Ocean => r_oce += 1,
            MouthKind::Lake => r_lake += 1,
            MouthKind::Endorheic => r_end += 1,
            MouthKind::Confluence(_) => r_conf += 1,
        }
    }

    let continents = p
        .geography
        .landmasses
        .iter()
        .filter(|l| l.kind == LandmassKind::Continent)
        .count();
    let large_islands = p
        .geography
        .landmasses
        .iter()
        .filter(|l| l.kind == LandmassKind::LargeIsland)
        .count();
    let islands = p
        .geography
        .landmasses
        .iter()
        .filter(|l| l.kind == LandmassKind::Island)
        .count();
    let rift_lakes = p
        .geography
        .lakes
        .iter()
        .filter(|l| l.origin == LakeOrigin::TectonicRift)
        .count();
    let glacial_lakes = p
        .geography
        .lakes
        .iter()
        .filter(|l| l.origin == LakeOrigin::Glacial)
        .count();

    let ports = p
        .civilization
        .settlements
        .iter()
        .filter(|s| s.role == SettlementRole::Port)
        .count();
    let river_hubs = p
        .civilization
        .settlements
        .iter()
        .filter(|s| s.role == SettlementRole::RiverHub)
        .count();
    let pass_forts = p
        .civilization
        .settlements
        .iter()
        .filter(|s| s.role == SettlementRole::PassFortress)
        .count();

    let (mut seg_road, mut seg_river, mut seg_sea) = (0usize, 0usize, 0usize);
    for tr in &p.civilization.trade_routes {
        for &seg in &tr.segments {
            match seg {
                RouteKind::Road => seg_road += 1,
                RouteKind::Riverway => seg_river += 1,
                RouteKind::SeaLane => seg_sea += 1,
            }
        }
    }

    let mut top_biomes: Vec<(&'static str, usize)> = biome_counts.into_iter().collect();
    top_biomes.sort_by(|a, b| b.1.cmp(&a.1));

    println!(
        "planet seed={seed} grid={w}x{h} time={:?} land={:.3} elev=[{:.2}, {:.2}] km",
        elapsed,
        land_area / (4.0 * std::f64::consts::PI),
        elev_min,
        elev_max
    );
    println!(
        "geology: trench={trench_cnt} foreland={foreland_cnt} rift={rift_cnt} volcanic={volc_cnt} suture={suture_cnt} deposits={}",
        p.resources.deposits.len()
    );
    println!(
        "climate: temp=[{t_min:.1}, {t_max:.1}] C max_amp={amp_max:.1} C precip_land=[{p_min:.0}, med {p_med:.0}, {p_max:.0}] mm monsoon={monsoon_cnt} glacier={glacier_cnt}"
    );
    println!(
        "erosion: max_incision={max_incision:.2} km alluvium={alluv_cnt} glacial_carve={glac_carve_cnt} sea_shift={:+.3} km",
        p.erosion.sea_level_shift_km
    );
    println!(
        "hydrology: lake_cells={lake_cnt} (saline={salt_lake_cnt}) salt_flats={salt_cnt} wadis={wadi_cnt} oases={oasis_cnt} rivers={} (ocean={r_oce} lake={r_lake} endorheic={r_end} conf={r_conf}) loss={:.0} m3/s",
        p.hydrology.rivers.len(),
        total_loss_m3s
    );
    println!(
        "geography: continents={continents} large_islands={large_islands} islands={islands} archipelagos={} bays={} isthmuses={} lakes={} (rift={rift_lakes} glacial={glacial_lakes}) ranges={} passes={} regions={}",
        p.geography.archipelagos.len(),
        p.geography.bays.len(),
        p.geography.isthmuses.len(),
        p.geography.lakes.len(),
        p.geography.mountain_ranges.len(),
        p.geography.passes.len(),
        p.geography.natural_regions.len()
    );
    println!(
        "civilization: cultures={} realms={} settlements={} (ports={ports} river_hubs={river_hubs} pass_forts={pass_forts}) routes={} (road_seg={seg_road} river_seg={seg_river} sea_seg={seg_sea})",
        p.civilization.cultures.len(),
        p.civilization.realms.len(),
        p.civilization.settlements.len(),
        p.civilization.trade_routes.len()
    );
    let sample_realms: Vec<&str> = p
        .civilization
        .realms
        .iter()
        .take(3)
        .map(|r| r.name.as_str())
        .collect();
    let sample_rivers: Vec<&str> = p
        .names
        .rivers
        .iter()
        .take(3)
        .map(|s| s.as_str())
        .collect();
    let sample_ranges: Vec<&str> = p
        .names
        .mountain_ranges
        .iter()
        .take(3)
        .map(|s| s.as_str())
        .collect();
    println!(
        "names: realms=[{}] rivers=[{}] ranges=[{}]",
        sample_realms.join(", "),
        sample_rivers.join(", "),
        sample_ranges.join(", ")
    );
    print!("top biomes:");
    for (name, cnt) in top_biomes.iter().take(6) {
        print!(
            " {name}={:.1}%",
            (*cnt as f64 / land_cells.max(1) as f64) * 100.0
        );
    }
    println!();

    if let Some(prefix) = ppm_prefix {
        let mut img_elev = vec![0u8; n * 3];
        let mut img_temp = vec![0u8; n * 3];
        let mut img_prec = vec![0u8; n * 3];
        let mut img_biom = vec![0u8; n * 3];
        let mut img_pol = vec![0u8; n * 3];

        for i in 0..n {
            let ce = elev_color(p.erosion.elevation_km[i]);
            let ct = temp_color(p.climate.temp_c[i]);
            let cp = precip_color(p.climate.precip_mm[i]);
            let base_b = p.biomes.biome[i].rgb();
            let cb = if p.hydrology.river_mask[i] != 0 {
                [42, 118, 188]
            } else {
                base_b
            };
            let rid = p.civilization.realm_id[i];
            let cpol = if rid >= 0 {
                lerp_rgb(base_b, realm_color(rid as u32), 0.58)
            } else {
                cb
            };

            img_elev[3 * i..3 * i + 3].copy_from_slice(&ce);
            img_temp[3 * i..3 * i + 3].copy_from_slice(&ct);
            img_prec[3 * i..3 * i + 3].copy_from_slice(&cp);
            img_biom[3 * i..3 * i + 3].copy_from_slice(&cb);
            img_pol[3 * i..3 * i + 3].copy_from_slice(&cpol);
        }

        for tr in &p.civilization.trade_routes {
            for &c in &tr.cells {
                let col = if p.hydrology.is_ocean[c] != 0 {
                    [210, 228, 245]
                } else {
                    [92, 62, 38]
                };
                img_pol[3 * c..3 * c + 3].copy_from_slice(&col);
            }
        }
        for s in &p.civilization.settlements {
            let col = if s.role == SettlementRole::Capital {
                [252, 232, 64]
            } else {
                [248, 248, 248]
            };
            img_pol[3 * s.cell..3 * s.cell + 3].copy_from_slice(&col);
        }

        write_ppm(&format!("{prefix}_elev.ppm"), w, h, &img_elev);
        write_ppm(&format!("{prefix}_temp.ppm"), w, h, &img_temp);
        write_ppm(&format!("{prefix}_precip.ppm"), w, h, &img_prec);
        write_ppm(&format!("{prefix}_biomes.ppm"), w, h, &img_biom);
        write_ppm(&format!("{prefix}_realms.ppm"), w, h, &img_pol);
        println!("wrote diagnostic PPM maps with prefix '{prefix}'");
    }
}
