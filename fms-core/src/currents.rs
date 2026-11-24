//! Сферический решатель океанических течений (уравнение Стоммела `r∇²ψ + ∂ψ/∂λ = G(φ)`):
//! воспроизводит субтропические и субполярные круговороты, западную интенсификацию (Гольфстрим/Куросио)
//! и прибрежный теплоперенос (тёплые и холодные течения).

use crate::grid::{blur_xwrap, Grid};
use std::f64::consts::PI;

/// Поля океанических течений на сферической сетке.
#[derive(Clone, Debug)]
pub struct Currents {
    /// Зональная скорость (+ на восток, - на запад), нормированная.
    pub u: Vec<f32>,
    /// Меридиональная скорость (+ к северу, - к югу), нормированная.
    pub v: Vec<f32>,
    /// Модуль скорости `hypot(u, v)`.
    pub speed: Vec<f32>,
    /// Температурная аномалия течения (`-1` холодное, `+1` тёплое), с диффузией на прибрежную сушу.
    pub temp_anomaly: Vec<f32>,
}

/// Профиль ветрового ротора `G(φ) = (1 / cos φ) * d(τ_x cos φ) / dφ` для пассатов, западных ветров и полярных ветров.
#[inline]
fn wind_curl(lat_rad: f64) -> f64 {
    let cl = lat_rad.cos().abs().max(0.18);
    // Гладкое зональное напряжение ветра: пассаты (- на экваторе), западные ветры (+ в 45°), полярные (-)
    let tau = -0.85 * (3.0 * lat_rad).cos() + 0.15 * (5.0 * lat_rad).cos();
    let dtau = 2.55 * (3.0 * lat_rad).sin() - 0.75 * (5.0 * lat_rad).sin();
    (dtau * cl - tau * lat_rad.sin()) / cl
}

/// Решает функцию тока `ψ` Стоммела на грубой сферической сетке и интерполирует скорости на полную сетку.
pub fn solve(grid: &Grid, rel_height_km: &[f32]) -> Currents {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    assert_eq!(rel_height_km.len(), n);

    let cw = (w / 3).clamp(60, 120);
    let ch = (h / 3).clamp(30, 60);
    let cn = cw * ch;

    // Заполняем маску воды на грубой сетке (1 = океан/вода, 0 = суша)
    let mut water_c = vec![0u8; cn];
    for cy in 0..ch {
        let y0 = (cy * h) / ch;
        let y1 = (((cy + 1) * h) / ch).max(y0 + 1).min(h);
        for cx in 0..cw {
            let x0 = (cx * w) / cw;
            let x1 = (((cx + 1) * w) / cw).max(x0 + 1).min(w);
            let mut wcnt = 0usize;
            let mut tot = 0usize;
            for yy in y0..y1 {
                for xx in x0..x1 {
                    tot += 1;
                    if rel_height_km[yy * w + xx] <= 0.0 {
                        wcnt += 1;
                    }
                }
            }
            if wcnt * 2 >= tot {
                water_c[cy * cw + cx] = 1;
            }
        }
    }

    let d_lon = std::f64::consts::TAU / cw as f64;
    let d_lat = PI / ch as f64;
    let inv_dlat2 = 1.0 / (d_lat * d_lat);
    let r_fric = 0.085f64;
    let beta = 1.0f64;

    let mut rhs = vec![0.0f64; cn];
    let mut cos_row = vec![0.0f64; ch];
    let mut tan_row = vec![0.0f64; ch];
    for cy in 0..ch {
        let lat = PI * 0.5 - (cy as f64 + 0.5) * PI / ch as f64;
        let cl = lat.cos().abs().max(0.18);
        cos_row[cy] = cl;
        tan_row[cy] = lat.sin().clamp(-0.98, 0.98) / cl;
        let g = wind_curl(lat);
        for cx in 0..cw {
            if water_c[cy * cw + cx] != 0 {
                rhs[cy * cw + cx] = g;
            }
        }
    }

    // Решаем `r ∇²ψ + β ∂ψ/∂λ = G(φ)` (SOR с замыканием X; ψ = 0 на суше и полюсах)
    let mut psi = vec![0.0f64; cn];
    let omega = 1.45f64;
    for _iter in 0..110 {
        for cy in 1..(ch - 1) {
            let cl = cos_row[cy];
            let ax = r_fric / (cl * cl * d_lon * d_lon);
            let ay = r_fric * inv_dlat2;
            let bx = beta / (2.0 * d_lon);
            let mt = r_fric * tan_row[cy] / (2.0 * d_lat);
            let diag = 2.0 * ax + 2.0 * ay;
            let row = cy * cw;
            for cx in 0..cw {
                let i = row + cx;
                if water_c[i] == 0 {
                    continue;
                }
                let xl = if cx == 0 { cw - 1 } else { cx - 1 };
                let xr = if cx + 1 == cw { 0 } else { cx + 1 };
                let p_e = psi[row + xr];
                let p_w = psi[row + xl];
                let p_n = psi[(cy - 1) * cw + cx];
                let p_s = psi[(cy + 1) * cw + cx];

                let num = ax * (p_e + p_w)
                    + ay * (p_n + p_s)
                    - mt * (p_n - p_s)
                    + bx * (p_e - p_w)
                    - rhs[i];
                let target = num / diag;
                psi[i] = psi[i] + omega * (target - psi[i]);
            }
        }
    }

    // Скорости (u = -∂ψ/∂φ, v_north = +∂ψ/∂λ / cos φ) на грубой сетке
    let mut uc = vec![0.0f32; cn];
    let mut vc = vec![0.0f32; cn];
    let mut max_spd = 1e-6f64;
    for cy in 1..(ch - 1) {
        let cl = cos_row[cy];
        let row = cy * cw;
        for cx in 0..cw {
            let i = row + cx;
            if water_c[i] == 0 {
                continue;
            }
            let xl = if cx == 0 { cw - 1 } else { cx - 1 };
            let xr = if cx + 1 == cw { 0 } else { cx + 1 };
            let dpsi_dlon = (psi[row + xr] - psi[row + xl]) / (2.0 * d_lon);
            let dpsi_dlat = (psi[(cy - 1) * cw + cx] - psi[(cy + 1) * cw + cx]) / (2.0 * d_lat);
            let u_val = -dpsi_dlat;
            let v_val = dpsi_dlon / cl;
            uc[i] = u_val as f32;
            vc[i] = v_val as f32;
            max_spd = max_spd.max(u_val.hypot(v_val));
        }
    }

    // Нормализация к характерной шкале ~[-1, 1] и билинейная интерполяция на полную сетку
    let inv_norm = (1.0 / (max_spd * 0.45)).min(2.0) as f32;
    for i in 0..cn {
        uc[i] = (uc[i] * inv_norm).clamp(-1.5, 1.5);
        vc[i] = (vc[i] * inv_norm).clamp(-1.5, 1.5);
    }

    let mut u = vec![0.0f32; n];
    let mut v = vec![0.0f32; n];
    let mut speed = vec![0.0f32; n];
    let mut temp_anomaly = vec![0.0f32; n];

    for y in 0..h {
        let fy = (y as f64 + 0.5) / h as f64 * ch as f64 - 0.5;
        let cy0 = (fy.floor() as isize).clamp(0, ch as isize - 1) as usize;
        let cy1 = (cy0 + 1).min(ch - 1);
        let ty = (fy - cy0 as f64).clamp(0.0, 1.0) as f32;
        let lat_rad = grid.lat_rad(y);
        let lat_sign = if lat_rad >= 0.0 { 1.0f32 } else { -1.0f32 };
        let lat_abs = lat_rad.abs().to_degrees() as f32;

        for x in 0..w {
            let i = grid.idx(x, y);
            if rel_height_km[i] > 0.0 {
                continue;
            }
            let fx = (x as f64 + 0.5) / w as f64 * cw as f64 - 0.5;
            let cx0 = (fx.floor() as isize).rem_euclid(cw as isize) as usize;
            let cx1 = (cx0 + 1) % cw;
            let tx = (fx - fx.floor()) as f32;

            let bilerp = |f: &[f32]| -> f32 {
                let f00 = f[cy0 * cw + cx0];
                let f10 = f[cy0 * cw + cx1];
                let f01 = f[cy1 * cw + cx0];
                let f11 = f[cy1 * cw + cx1];
                (f00 * (1.0 - tx) + f10 * tx) * (1.0 - ty) + (f01 * (1.0 - tx) + f11 * tx) * ty
            };

            let uu = bilerp(&uc);
            let vv = bilerp(&vc);
            u[i] = uu;
            v[i] = vv;
            speed[i] = uu.hypot(vv);

            // Поток к полюсу (v * lat_sign > 0) несёт тёплую воду, к экватору — холодную.
            // В умеренных широтах (35..65°) восточный дрейф приносит тепло с запада.
            let poleward = vv * lat_sign;
            let mid_drift = if (34.0..=66.0).contains(&lat_abs) {
                0.35 * uu.max(0.0)
            } else {
                0.0
            };
            temp_anomaly[i] = (poleward * 1.15 + mid_drift).clamp(-1.0, 1.0);
        }
    }

    // Прибрежная диффузия температурной аномалии течений на сушу
    let mut om = vec![0.0f32; n];
    let mut cv = vec![0.0f32; n];
    let mut og = vec![0.0f32; n];
    for i in 0..n {
        if rel_height_km[i] <= 0.0 {
            om[i] = 1.0;
            cv[i] = temp_anomaly[i];
            og[i] = 1.0;
        }
    }
    let r_cv = ((6.0 * w as f64 / 480.0).round() as usize).max(2);
    let r_og = ((9.0 * w as f64 / 480.0).round() as usize).max(3);
    blur_xwrap(&mut cv, w, h, r_cv);
    blur_xwrap(&mut om, w, h, r_cv);
    blur_xwrap(&mut og, w, h, r_og);
    for i in 0..n {
        if rel_height_km[i] > 0.0 {
            let t = ((og[i] - 0.12) / 0.38).clamp(0.0, 1.0);
            let onshore = t * t * (3.0 - 2.0 * t);
            temp_anomaly[i] = ((cv[i] / om[i].max(0.02)) * onshore * 0.95).clamp(-1.0, 1.0);
        }
    }

    Currents {
        u,
        v,
        speed,
        temp_anomaly,
    }
}
