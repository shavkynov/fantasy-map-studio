//! Климат на сфере: температура с высотным градиентом и континентальностью,
//! зональный перенос влаги (пассаты и западные ветры), орографические осадки и дождевая тень.

use crate::currents::Currents;
use crate::grid::{blur_xwrap, distance_to_mask_km, Grid};
use crate::rng::{Noise, Rng};

#[inline]
fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Климатические поля планеты на сферической сетке.
#[derive(Clone, Debug)]
pub struct Climate {
    /// Физическая температура поверхности, °C.
    pub temp_c: Vec<f32>,
    /// Нормированная температура `0..1` (`-24 °C .. +29 °C`).
    pub temp_01: Vec<f32>,
    /// Годовые осадки, мм/год.
    pub precip_mm: Vec<f32>,
    /// Нормированная влажность `0..1`.
    pub moisture: Vec<f32>,
    /// Дискретный уровень дождя `1..=5` (1 — аридный, 5 — влажный тропик/муссон).
    pub rain_level: Vec<u8>,
    /// Термическая аномалия течений (`-1` холодное, `+1` тёплое).
    pub current_temp: Vec<f32>,
    /// Зональная составляющая течения.
    pub current_u: Vec<f32>,
    /// Меридиональная составляющая течения (+ к северу).
    pub current_v: Vec<f32>,
    /// Расстояние до ближайшего моря/воды (`rel_height_km <= 0`), км.
    pub dist_to_sea_km: Vec<f32>,
}

/// Вычисляет климат по текущей высоте `rel_height_km` и океаническим течениям `currents`.
pub fn compute(grid: &Grid, rel_height_km: &[f32], currents: &Currents, seed: &str) -> Climate {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    assert_eq!(rel_height_km.len(), n);
    assert_eq!(currents.temp_anomaly.len(), n);

    let mut water_mask = vec![0u8; n];
    for i in 0..n {
        if rel_height_km[i] <= 0.0 {
            water_mask[i] = 1;
        }
    }
    let dist_to_sea_km = distance_to_mask_km(&water_mask, grid);

    let mut rng_t = Rng::sub(seed, "climate-temp");
    let noise_t = Noise::new(&mut rng_t);
    let mut rng_m = Rng::sub(seed, "climate-moist");
    let noise_m = Noise::new(&mut rng_m);

    // 1. Базовая температура по широте + вертикальный градиент + сферический шум.
    let mut temp_c = vec![0f32; n];
    for y in 0..h {
        let lat_rad = grid.lat_rad(y);
        let t_sea = -18.0 + 46.5 * lat_rad.cos().max(0.0).powf(0.95);
        for x in 0..w {
            let i = grid.idx(x, y);
            let p = grid.unit_vec(x, y);
            let hv = (rel_height_km[i] as f64).clamp(0.0, 8.0);
            let lapse = if rel_height_km[i] > 0.0 {
                5.4 * (hv - 0.30).max(0.0)
            } else {
                0.0
            };
            let jitter = 2.2 * noise_t.fbm(p[0] * 4.5 + 3.1, p[1] * 4.5 - 1.7, p[2] * 4.5 + 2.4, 2);
            temp_c[i] = (t_sea - lapse + jitter) as f32;
        }
    }

    let current_temp = currents.temp_anomaly.clone();
    let current_u = currents.u.clone();
    let current_v = currents.v.clone();

    // Применяем течения и континентальность к температуре
    for i in 0..n {
        let cont = (dist_to_sea_km[i] as f64 / 2200.0).clamp(0.0, 1.0);
        let coldness = ((-temp_c[i] as f64 + 12.0) / 30.0).clamp(0.0, 1.0);
        temp_c[i] += 5.5 * current_temp[i] - (3.5 * cont * coldness) as f32;
    }
    let r_temp = ((2.0 * w as f64 / 360.0).round() as usize).max(1);
    blur_xwrap(&mut temp_c, w, h, r_temp);

    let mut temp_01 = vec![0f32; n];
    for i in 0..n {
        temp_c[i] = temp_c[i].clamp(-45.0, 42.0);
        temp_01[i] = ((temp_c[i] + 24.0) / 53.0).clamp(0.0, 1.0);
    }

    // 2. Зональный перенос влаги по кругу (два прохода для сшивки через x = 0 ↔ w - 1)
    let mut rain = vec![0f32; n];
    let sc = 480.0 / w as f64;
    let zonal = |lat: f64| -> f64 {
        0.18 + 0.95 * (-(lat / 14.0).powi(2)).exp() + 0.70 * (-((lat - 55.0) / 13.0).powi(2)).exp()
    };
    let west_weight = |lat: f64| -> f64 {
        smoothstep(24.0, 36.0, lat) * (1.0 - smoothstep(58.0, 68.0, lat))
    };

    for dir in [1isize, -1isize] {
        for y in 0..h {
            let lat = grid.lat_deg(y).abs();
            let wgt = if dir > 0 {
                west_weight(lat)
            } else {
                1.0 - west_weight(lat)
            };
            if wgt < 0.01 {
                continue;
            }
            let z_conv = zonal(lat);
            let mut q = 0.55f64;
            let mut prev_h = 0.0f64;
            for xi in 0..(2 * w) {
                let record = xi >= w;
                let xx = xi % w;
                let x = if dir > 0 { xx } else { w - 1 - xx };
                let i = y * w + x;
                let hv = rel_height_km[i] as f64;
                let t01 = temp_01[i] as f64;
                if hv <= 0.0 {
                    q += (1.0 - q) * 0.10 * sc * (0.3 + t01);
                    prev_h = 0.0;
                    if record {
                        rain[i] += (wgt * 0.003 * q * z_conv) as f32;
                    }
                } else {
                    let lift = (hv - prev_h).max(0.0);
                    prev_h = hv;
                    let r = q
                        * (0.04 * sc * z_conv * (0.4 + t01)
                            + (lift * 1.45).min(0.55) * (0.6 + 0.4 * z_conv));
                    if record {
                        rain[i] += (wgt * r) as f32;
                    }
                    q = (q - r).max(0.0);
                    q += 0.004 * sc * (0.3 + t01) * (1.0 - q);
                }
            }
        }
    }

    // Холодные течения иссушают побережье (Атакама/Намиб), тёплые увлажняют
    for i in 0..n {
        if rel_height_km[i] > 0.0 {
            let mod_f = (1.0 + 0.50 * current_temp[i] as f64).clamp(0.45, 1.25);
            rain[i] *= mod_f as f32;
        }
    }
    let r_rain = ((3.0 * w as f64 / 360.0).round() as usize).max(2);
    blur_xwrap(&mut rain, w, h, r_rain);

    let mut land_rain = Vec::new();
    for i in (0..n).step_by(2) {
        if rel_height_km[i] > 0.0 {
            land_rain.push(rain[i]);
        }
    }
    land_rain.sort_by(|a, b| a.total_cmp(b));
    let med = if land_rain.is_empty() {
        1e-3f64
    } else {
        (land_rain[land_rain.len() / 2] as f64).max(1e-6)
    };

    let mut precip_mm = vec![0f32; n];
    let mut moisture = vec![0f32; n];
    let mut rain_level = vec![1u8; n];
    for y in 0..h {
        let lat = grid.lat_deg(y).abs();
        let itcz_boost = 0.14 * (-(lat / 11.0).powi(2)).exp();
        let subtrop_dry = 0.21 * (-((lat - 27.0) / 9.5).powi(2)).exp();
        for x in 0..w {
            let i = grid.idx(x, y);
            let p = grid.unit_vec(x, y);
            let n_m = noise_m.fbm(p[0] * 6.0 + 11.0, p[1] * 6.0 - 5.0, p[2] * 6.0 + 7.0, 3);
            let cont = (dist_to_sea_km[i] as f64 / 2000.0).clamp(0.0, 1.0);
            let base_m = 0.03 + 0.43 * ((rain[i] as f64) / med).max(0.0).powf(0.82);
            let m = if rel_height_km[i] > 0.0 {
                ((base_m + 0.09 * n_m) * (1.0 - 0.30 * cont) + itcz_boost - subtrop_dry)
                    .clamp(0.02, 1.0)
            } else {
                (base_m + 0.08 * n_m).clamp(0.1, 1.0)
            };
            moisture[i] = m as f32;

            let mm = if rel_height_km[i] > 0.0 {
                (750.0 * ((rain[i] as f64) / med).max(0.0).powf(0.90)
                    * (1.0 - 0.26 * cont)
                    * (1.0 + itcz_boost - 0.85 * subtrop_dry).max(0.25)
                    * (1.0 + 0.15 * n_m))
                    .clamp(20.0, 3800.0)
            } else {
                (750.0 * ((rain[i] as f64) / med).max(0.05).powf(0.7)).clamp(80.0, 3200.0)
            };
            precip_mm[i] = mm as f32;
            rain_level[i] = if mm < 250.0 {
                1
            } else if mm < 500.0 {
                2
            } else if mm < 950.0 {
                3
            } else if mm < 1550.0 {
                4
            } else {
                5
            };
        }
    }

    Climate {
        temp_c,
        temp_01,
        precip_mm,
        moisture,
        rain_level,
        current_temp,
        current_u,
        current_v,
        dist_to_sea_km,
    }
}
