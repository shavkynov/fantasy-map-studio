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

/// Зональное напряжение ветра `τ_x(φ)` (пассаты < 0, западные ветры > 0, полярные < 0).
#[inline]
fn wind_tau(lat_rad: f64, rot: f64) -> f64 {
    let k = rot.clamp(0.25, 3.0).sqrt();
    -0.85 * (3.0 * k * lat_rad).cos() + 0.15 * (5.0 * k * lat_rad).cos()
}

/// Профиль ветрового ротора `G(φ) = -(1 / cos φ) * d(τ_x cos φ) / dφ` для пассатов, западных ветров и полярных ветров.
#[inline]
fn wind_curl(lat_rad: f64, rot: f64) -> f64 {
    let cl = lat_rad.cos().abs().max(0.18);
    let k = rot.clamp(0.25, 3.0).sqrt();
    let k3 = 3.0 * k;
    let k5 = 5.0 * k;
    let tau = wind_tau(lat_rad, rot);
    let dtau = 0.85 * k3 * (k3 * lat_rad).sin() - 0.15 * k5 * (k5 * lat_rad).sin();
    -(dtau * cl - tau * lat_rad.sin()) / cl
}

/// Решает функцию тока `ψ` Стоммела на грубой сферической сетке с параметрами вращения Земли по умолчанию.
pub fn solve(grid: &Grid, rel_height_km: &[f32]) -> Currents {
    solve_with_rotation(grid, rel_height_km, 1.0)
}

/// Решает функцию тока `ψ` Стоммела на сферической сетке с циркумполярными каналами и теплопереносом.
pub fn solve_with_rotation(grid: &Grid, rel_height_km: &[f32], rotation_rate: f64) -> Currents {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    assert_eq!(rel_height_km.len(), n);
    let rot = rotation_rate.clamp(0.25, 3.0);
    let rot_k = rot.sqrt();

    let cw = (w / 2).clamp(90, 180);
    let ch = (h / 2).clamp(45, 90);
    let cn = cw * ch;

    // Заполняем маску воды на сетке решателя (порог 1/3 сохраняет узкие проливы)
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
            if wcnt * 3 >= tot {
                water_c[cy * cw + cx] = 1;
            }
        }
    }
    // Полюсные строки считаем твёрдой границей (ψ фиксировано)
    for cx in 0..cw {
        water_c[cx] = 0;
        water_c[(ch - 1) * cw + cx] = 0;
    }

    let d_lon = std::f64::consts::TAU / cw as f64;
    let d_lat = PI / ch as f64;
    let inv_dlat2 = 1.0 / (d_lat * d_lat);
    let beta = rot.powf(0.65);
    let r_fric = 0.085f64.max(0.60 * beta * d_lon);

    let mut rhs = vec![0.0f64; cn];
    let mut cos_row = vec![0.0f64; ch];
    let mut tan_row = vec![0.0f64; ch];
    let mut lat_row = vec![0.0f64; ch];
    for cy in 0..ch {
        let lat = PI * 0.5 - (cy as f64 + 0.5) * PI / ch as f64;
        lat_row[cy] = lat;
        let cl = lat.cos().abs().max(0.18);
        cos_row[cy] = cl;
        tan_row[cy] = lat.sin().clamp(-0.98, 0.98) / cl;
        let g = wind_curl(lat, rot);
        for cx in 0..cw {
            if water_c[cy * cw + cx] != 0 {
                rhs[cy * cw + cx] = g;
            }
        }
    }

    // Определяем сквозные зональные коридоры (Антарктическое циркумполярное / полярные кольца)
    let open_row: Vec<bool> = (0..ch)
        .map(|cy| {
            cy > 0
                && cy + 1 < ch
                && (0..cw).all(|cx| water_c[cy * cw + cx] != 0)
        })
        .collect();

    let north_cut = (1..(ch / 2)).filter(|&cy| open_row[cy]).max();
    let south_cut = ((ch / 2)..(ch - 1)).filter(|&cy| open_row[cy]).min();

    let acc_damp = (r_fric * 3.2).max(0.28);
    let psi_north_cap = if let Some(nc) = north_cut {
        let mut s = 0.0f64;
        for cy in 1..=nc {
            if open_row[cy] {
                s -= (wind_tau(lat_row[cy], rot) / acc_damp) * d_lat;
            }
        }
        s.clamp(-1.2, 1.2)
    } else {
        0.0
    };
    let psi_south_cap = if let Some(sc) = south_cut {
        let mut s = 0.0f64;
        for cy in sc..(ch - 1) {
            if open_row[cy] {
                s += (wind_tau(lat_row[cy], rot) / acc_damp) * d_lat;
            }
        }
        s.clamp(-1.2, 1.2)
    } else {
        0.0
    };

    // Решаем `r ∇²ψ + β ∂ψ/∂λ = G(φ)` (SOR + upwind по β ∂ψ/∂λ для ровной западной интенсификации)
    let mut psi = vec![0.0f64; cn];
    for cy in 0..ch {
        let mut v_init = 0.0;
        if let Some(nc) = north_cut {
            if cy < nc {
                v_init = psi_north_cap;
            } else if cy == nc && water_c[cy * cw] == 0 {
                v_init = psi_north_cap;
            }
        }
        if let Some(sc) = south_cut {
            if cy > sc {
                v_init = psi_south_cap;
            }
        }
        if v_init != 0.0 {
            for cx in 0..cw {
                psi[cy * cw + cx] = v_init;
            }
        }
    }

    let omega = 1.48f64;
    for _iter in 0..240 {
        let mut max_diff = 0.0f64;
        for cy in 1..(ch - 1) {
            let cl = cos_row[cy];
            let ax = r_fric / (cl * cl * d_lon * d_lon);
            let ay = r_fric * inv_dlat2;
            let b_up = beta / d_lon;
            let mt = r_fric * tan_row[cy] / (2.0 * d_lat);
            let diag = 2.0 * ax + 2.0 * ay + b_up;
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
                    + b_up * p_e
                    - rhs[i];
                let target = num / diag;
                let next = psi[i] + omega * (target - psi[i]);
                max_diff = max_diff.max((next - psi[i]).abs());
                psi[i] = next;
            }
        }
        if max_diff < 1e-5 {
            break;
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

    // Нормализация к характерной шкале ~[-1, 1]
    let inv_norm = (1.0 / (max_spd * 0.45)).min(2.0) as f32;
    for i in 0..cn {
        uc[i] = (uc[i] * inv_norm).clamp(-1.5, 1.5);
        vc[i] = (vc[i] * inv_norm).clamp(-1.5, 1.5);
    }

    // Стационарный адвективно-релаксационный перенос тепловой аномалии воды вдоль течений
    let mut t_eq = vec![0.0f64; ch];
    let mut max_cfl = 0.0f64;
    for cy in 0..ch {
        t_eq[cy] = lat_row[cy].cos().abs().powf(1.15);
        let cl = cos_row[cy].max(0.22);
        let row = cy * cw;
        for cx in 0..cw {
            let i = row + cx;
            if water_c[i] != 0 {
                let cfl = (uc[i].abs() as f64) / (cl * d_lon) + (vc[i].abs() as f64) / d_lat;
                max_cfl = max_cfl.max(cfl);
            }
        }
    }
    let dt_adv = if max_cfl > 1e-6 { 0.42 / max_cfl } else { 0.02 };
    let lambda = 0.45f64;
    let mut t_sst = vec![0.0f64; cn];
    let mut t_next = vec![0.0f64; cn];
    for cy in 0..ch {
        for cx in 0..cw {
            t_sst[cy * cw + cx] = t_eq[cy];
        }
    }
    for _step in 0..48 {
        for cy in 1..(ch - 1) {
            let cl = cos_row[cy].max(0.22);
            let inv_dx = 1.0 / (cl * d_lon);
            let inv_dy = 1.0 / d_lat;
            let row = cy * cw;
            for cx in 0..cw {
                let i = row + cx;
                if water_c[i] == 0 {
                    t_next[i] = t_eq[cy];
                    continue;
                }
                let u_val = uc[i] as f64;
                let v_val = vc[i] as f64;
                let xl = if cx == 0 { cw - 1 } else { cx - 1 };
                let xr = if cx + 1 == cw { 0 } else { cx + 1 };

                let t_c = t_sst[i];
                let dtdx = if u_val >= 0.0 {
                    let nb = row + xl;
                    if water_c[nb] != 0 { (t_c - t_sst[nb]) * inv_dx } else { 0.0 }
                } else {
                    let nb = row + xr;
                    if water_c[nb] != 0 { (t_sst[nb] - t_c) * inv_dx } else { 0.0 }
                };
                // +v — поток к северу (уменьшение индекса cy)
                let dtdy = if v_val >= 0.0 {
                    let nb = (cy + 1) * cw + cx;
                    if water_c[nb] != 0 { (t_c - t_sst[nb]) * inv_dy } else { 0.0 }
                } else {
                    let nb = (cy - 1) * cw + cx;
                    if water_c[nb] != 0 { (t_sst[nb] - t_c) * inv_dy } else { 0.0 }
                };

                let d_t = -(u_val * dtdx + v_val * dtdy) + lambda * (t_eq[cy] - t_c);
                t_next[i] = (t_c + dt_adv * d_t).clamp(0.0, 1.0);
            }
        }
        std::mem::swap(&mut t_sst, &mut t_next);
    }

    let mut anom_c = vec![0.0f32; cn];
    for cy in 1..(ch - 1) {
        let row = cy * cw;
        let lat_abs = lat_row[cy].abs().to_degrees() as f32;
        let mid_lo = (34.0 / rot_k as f32).clamp(15.0, 58.0);
        let mid_hi = (66.0 / rot_k as f32).clamp(32.0, 82.0);
        for cx in 0..cw {
            let i = row + cx;
            if water_c[i] == 0 {
                continue;
            }
            let adv_a = ((t_sst[i] - t_eq[cy]) * 3.4) as f32;
            let mid_drift = if (mid_lo..=mid_hi).contains(&lat_abs) {
                0.18 * uc[i].max(0.0)
            } else {
                0.0
            };
            anom_c[i] = (adv_a + mid_drift).clamp(-1.0, 1.0);
        }
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
            temp_anomaly[i] = bilerp(&anom_c).clamp(-1.0, 1.0);
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
