//! Климат на сфере: сезонные температуры (зима/лето) и континентальность,
//! муссонная циркуляция, 2D-перенос влаги с рециклингом с суши и дождевой тенью,
//! испаряемость (PET), индекс аридности, снегопады и ледники.

use crate::currents::Currents;
use crate::grid::{blur_xwrap, distance_to_mask_km, Grid};
use crate::rng::{Noise, Rng};
use std::f64::consts::TAU;

/// Планетарные параметры климата (наклон оси вращения, инсоляция и скорость вращения).
#[derive(Clone, Copy, Debug)]
pub struct ClimateParams {
    /// Наклон оси вращения планеты, градусы (`23.4°` для Земли; `0°` — мир без времён года).
    pub axial_tilt_deg: f64,
    /// Глобальный температурный сдвиг инсоляции/парникового эффекта, °C (`0.0` — Земля).
    pub solar_offset_c: f64,
    /// Скорость вращения планеты относительно Земли (`1.0` — Земля, `0.25..=3.0`).
    pub rotation_rate: f64,
}

impl Default for ClimateParams {
    fn default() -> Self {
        Self {
            axial_tilt_deg: 23.4,
            solar_offset_c: 0.0,
            rotation_rate: 1.0,
        }
    }
}

/// Климатические поля планеты на сферической сетке.
#[derive(Clone, Debug)]
pub struct Climate {
    /// Среднегодовая температура поверхности, °C.
    pub temp_c: Vec<f32>,
    /// Средняя температура января, °C.
    pub temp_jan_c: Vec<f32>,
    /// Средняя температура июля, °C.
    pub temp_jul_c: Vec<f32>,
    /// Сезонная амплитуда температур (`|T_jul - T_jan|`), °C.
    pub temp_amp_c: Vec<f32>,
    /// Нормированная температура `0..1` (`-24 °C .. +29 °C`).
    pub temp_01: Vec<f32>,
    /// Годовые осадки, мм/год.
    pub precip_mm: Vec<f32>,
    /// Осадки января в пересчёте на годовую интенсивность, мм/год.
    pub precip_jan_mm: Vec<f32>,
    /// Осадки июля в пересчёте на годовую интенсивность, мм/год.
    pub precip_jul_mm: Vec<f32>,
    /// Индекс муссонности `|P_jul - P_jan| / (P_ann + 100)`.
    pub monsoon_index: Vec<f32>,
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
    /// Приземный ветер в январе (+ на восток, + на север).
    pub wind_u_jan: Vec<f32>,
    pub wind_v_jan: Vec<f32>,
    /// Приземный ветер в июле (+ на восток, + на север).
    pub wind_u_jul: Vec<f32>,
    pub wind_v_jul: Vec<f32>,
    /// Потенциальная испаряемость (Holdridge PET), мм/год.
    pub pet_mm: Vec<f32>,
    /// Индекс аридности `precip_mm / pet_mm`.
    pub aridity_index: Vec<f32>,
    /// Доля твёрдых осадков (снег) в годовом стоке, `0..1`.
    pub snow_frac: Vec<f32>,
    /// Интенсивность постоянного ледника/покрова льда, `0..1`.
    pub glacier: Vec<f32>,
    /// Доля многолетней (вечной) мерзлоты грунта, `0..1`.
    pub permafrost: Vec<f32>,
    /// Оценка высоты снеговой линии над уровнем моря, км.
    pub snow_line_km: Vec<f32>,
}

impl Climate {
    /// Создаёт однородный климат для синтетических тестов и изолированных проверок.
    pub fn uniform(grid: &Grid, temp_c: f32, precip_mm: f32, moisture: f32) -> Self {
        let n = grid.len();
        let p = precip_mm.max(0.0);
        let m = moisture.clamp(0.0, 1.0);
        let bio_t = (temp_c as f64).clamp(0.0, 30.0);
        let pet = (58.93 * bio_t).max(40.0) as f32;
        let aridity = ((p as f64) / (pet as f64).max(50.0)).clamp(0.0, 10.0) as f32;
        let t01 = ((temp_c + 24.0) / 53.0).clamp(0.0, 1.0);
        let rl = if p < 250.0 {
            1
        } else if p < 500.0 {
            2
        } else if p < 950.0 {
            3
        } else if p < 1550.0 {
            4
        } else {
            5
        };
        let snow_f = ((2.0 - temp_c as f64) / 4.0).clamp(0.0, 1.0) as f32;
        let perma = ((-0.5 - temp_c as f64) / 7.0).clamp(0.0, 1.0) as f32;
        let snow_line = ((temp_c as f64 - 1.0) / 6.2).max(0.0) as f32;

        Self {
            temp_c: vec![temp_c; n],
            temp_jan_c: vec![temp_c; n],
            temp_jul_c: vec![temp_c; n],
            temp_amp_c: vec![0.0; n],
            temp_01: vec![t01; n],
            precip_mm: vec![p; n],
            precip_jan_mm: vec![p; n],
            precip_jul_mm: vec![p; n],
            monsoon_index: vec![0.0; n],
            moisture: vec![m; n],
            rain_level: vec![rl; n],
            current_temp: vec![0.0; n],
            current_u: vec![0.0; n],
            current_v: vec![0.0; n],
            dist_to_sea_km: vec![500.0; n],
            wind_u_jan: vec![0.0; n],
            wind_v_jan: vec![0.0; n],
            wind_u_jul: vec![0.0; n],
            wind_v_jul: vec![0.0; n],
            pet_mm: vec![pet; n],
            aridity_index: vec![aridity; n],
            snow_frac: vec![snow_f; n],
            glacier: vec![0.0; n],
            permafrost: vec![perma; n],
            snow_line_km: vec![snow_line; n],
        }
    }
}

fn season_temperature(
    grid: &Grid,
    rel_height_km: &[f32],
    dist_to_sea_km: &[f32],
    current_temp: &[f32],
    noise_t: &Noise,
    season_sign: f64,
    params: &ClimateParams,
) -> Vec<f32> {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    let mut temp_s = vec![0f32; n];
    let tilt_scale = (params.axial_tilt_deg.clamp(0.0, 60.0)) / 23.4;
    let rot = params.rotation_rate.clamp(0.25, 3.0);
    let grad_scale = 1.0 - 0.14 * (1.0 - rot).max(0.0);

    for y in 0..h {
        let lat_deg = grid.lat_deg(y);
        for x in 0..w {
            let i = grid.idx(x, y);
            let p = grid.unit_vec(x, y);
            let cont = (dist_to_sea_km[i] as f64 / 2000.0).clamp(0.0, 1.0);
            let lat_eq = season_sign * tilt_scale * (5.0 + 10.0 * cont);
            let eff_lat = (lat_deg - lat_eq).clamp(-90.0, 90.0).to_radians();
            let t_base = -18.5
                + 23.5 * (1.0 - grad_scale)
                + params.solar_offset_c
                + 47.0 * grad_scale * eff_lat.cos().max(0.0).powf(0.95);

            let hemi_s = season_sign * (lat_deg / 90.0);
            let mid_env = (lat_deg.abs() / 48.0).clamp(0.0, 1.0)
                * (1.0 - 0.25 * ((lat_deg.abs() - 60.0) / 30.0).clamp(0.0, 1.0));
            let t_cont_season = tilt_scale
                * if hemi_s >= 0.0 {
                    16.0 * cont * mid_env * hemi_s.powf(0.75)
                } else {
                    -20.0 * cont * mid_env * (-hemi_s).powf(0.75)
                };

            let jitter =
                2.0 * noise_t.fbm(p[0] * 4.5 + 3.1, p[1] * 4.5 - 1.7, p[2] * 4.5 + 2.4, 2);

            temp_s[i] = (t_base + t_cont_season + jitter + 5.5 * current_temp[i] as f64) as f32;
        }
    }

    let r_temp = ((2.0 * w as f64 / 360.0).round() as usize).max(1);
    blur_xwrap(&mut temp_s, w, h, r_temp);
    for i in 0..n {
        let hv = (rel_height_km[i] as f64).clamp(0.0, 9.0);
        let lapse = if rel_height_km[i] > 0.0 {
            6.2 * (hv - 0.20).max(0.0)
        } else {
            0.0
        };
        temp_s[i] = (temp_s[i] as f64 - lapse).clamp(-55.0, 48.0) as f32;
    }
    temp_s
}

fn season_winds(
    grid: &Grid,
    rel_height_km: &[f32],
    temp_s: &[f32],
    season_sign: f64,
    tilt_scale: f64,
    rot: f64,
) -> (Vec<f32>, Vec<f32>) {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();

    let mut t_anom = vec![0.0f32; n];
    for y in 0..h {
        let row = y * w;
        let mut sum = 0.0f64;
        for x in 0..w {
            let i = row + x;
            let hv = (rel_height_km[i] as f64).clamp(0.0, 9.0);
            let lapse = if rel_height_km[i] > 0.0 {
                6.2 * (hv - 0.20).max(0.0)
            } else {
                0.0
            };
            let t_sl = temp_s[i] as f64 + lapse;
            t_anom[i] = t_sl as f32;
            sum += t_sl;
        }
        let mean = (sum / w as f64) as f32;
        for x in 0..w {
            t_anom[row + x] -= mean;
        }
    }

    let r_mon = ((w as f64 / 16.0).round() as usize).max(4);
    blur_xwrap(&mut t_anom, w, h, r_mon);
    blur_xwrap(&mut t_anom, w, h, r_mon);

    let lat_itcz = season_sign * 11.0 * tilt_scale;
    let dy_km = grid.dy_km();
    let rot = rot.clamp(0.25, 3.0);
    let rot_k = rot.sqrt();
    let mut wind_u = vec![0.0f32; n];
    let mut wind_v = vec![0.0f32; n];

    for y in 0..h {
        let lat_deg = grid.lat_deg(y);
        let lat_rad = grid.lat_rad(y);
        let dx_km = grid.dx_km(y);
        let y0 = y.saturating_sub(1);
        let y1 = (y + 1).min(h - 1);
        let span_y = ((y1 - y0).max(1) as f64) * dy_km;
        let cor = (0.35 * rot).clamp(0.08, 0.90) * lat_rad.sin();

        let sl_rad = (lat_deg - lat_itcz).clamp(-90.0, 90.0).to_radians();
        let u_base = -0.85 * (3.0 * rot_k * sl_rad).cos() + 0.15 * (5.0 * rot_k * sl_rad).cos();
        let v_base = -0.45 * (6.0 * rot_k * sl_rad).sin();

        let row = y * w;
        for x in 0..w {
            let xl = if x == 0 { w - 1 } else { x - 1 };
            let xr = if x + 1 == w { 0 } else { x + 1 };
            let gx = (t_anom[row + xr] as f64 - t_anom[row + xl] as f64) / (2.0 * dx_km);
            let gy_north = (t_anom[y0 * w + x] as f64 - t_anom[y1 * w + x] as f64) / span_y;

            let scale = 160.0;
            let u_mon = (scale * (gx + cor * gy_north)).clamp(-1.2, 1.2);
            let v_mon = (scale * (gy_north - cor * gx)).clamp(-1.2, 1.2);

            let i = row + x;
            wind_u[i] = (u_base + u_mon).clamp(-1.8, 1.8) as f32;
            wind_v[i] = (v_base + v_mon).clamp(-1.8, 1.8) as f32;
        }
    }

    (wind_u, wind_v)
}

fn advect_moisture_season(
    grid: &Grid,
    rel_height_km: &[f32],
    temp_s: &[f32],
    wind_u: &[f32],
    wind_v: &[f32],
    current_temp: &[f32],
    lat_itcz: f64,
    rot_k: f64,
) -> Vec<f32> {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    let wf = w as f64;
    let hf_max = (h - 1) as f64;
    let dy_km = grid.dy_km();
    let step_km = 200.0;

    let mut q_sat = vec![0.0f64; n];
    let mut h_pos = vec![0.0f64; n];
    let mut q = vec![0.0f64; n];
    let mut conv_rate = vec![0.0f64; n];
    let mut src_x = vec![0.0f64; n];
    let mut src_y = vec![0.0f64; n];
    let mut is_land = vec![false; n];
    let mut curr_mod_arr = vec![1.0f64; n];
    let mut recycle_temp = vec![0.0f64; n];

    let sub_center = (26.0 / rot_k).clamp(14.0, 56.0);
    let sub_width = (9.0 / rot_k).clamp(5.0, 18.0);
    let storm_center = (50.0 / rot_k).clamp(26.0, 76.0);
    let storm_width = (12.0 / rot_k).clamp(7.0, 22.0);

    for y in 0..h {
        let lat_deg = grid.lat_deg(y);
        let sl = (lat_deg - lat_itcz).abs();
        let itcz_conv = 0.34 * (-(sl / 12.0).powi(2)).exp();
        let storm_conv = 0.26 * (-((sl - storm_center) / storm_width).powi(2)).exp();
        let sub_dry = 0.21 * (-((sl - sub_center) / sub_width).powi(2)).exp();
        let cr = (0.14 + itcz_conv + storm_conv - sub_dry).clamp(0.02, 0.58);
        let dx_row = grid.dx_km(y).max(40.0);

        let row = y * w;
        for x in 0..w {
            let i = row + x;
            let t = temp_s[i] as f64;
            let qs = (0.14 * (0.055 * (t + 18.0)).exp()).clamp(0.06, 1.65);
            q_sat[i] = qs;
            let hv = rel_height_km[i] as f64;
            let land = hv > 0.0;
            is_land[i] = land;
            h_pos[i] = hv.max(0.0);
            q[i] = if land { 0.32 * qs } else { 0.78 * qs };
            conv_rate[i] = cr;

            let u = wind_u[i] as f64;
            let v = wind_v[i] as f64;
            let spd = u.hypot(v).max(0.25);
            let off_x = ((u / spd) * step_km / dx_row).clamp(-6.0, 6.0);
            let off_y = ((v / spd) * step_km / dy_km).clamp(-4.0, 4.0);
            src_x[i] = (x as f64 - off_x).rem_euclid(wf);
            src_y[i] = (y as f64 + off_y).clamp(0.0, hf_max);

            curr_mod_arr[i] = if land {
                (1.0 + 0.45 * current_temp[i] as f64).clamp(0.45, 1.30)
            } else {
                (1.0 + 0.35 * current_temp[i] as f64).clamp(0.55, 1.30)
            };
            recycle_temp[i] = ((t + 5.0) / 30.0).clamp(0.0, 1.0);
        }
    }

    // Предвычисляем билинейные индексы и веса, чтобы внутренний цикл был без тригонометрии
    let mut idx00 = vec![0usize; n];
    let mut idx10 = vec![0usize; n];
    let mut idx01 = vec![0usize; n];
    let mut idx11 = vec![0usize; n];
    let mut w00 = vec![0.0f64; n];
    let mut w10 = vec![0.0f64; n];
    let mut w01 = vec![0.0f64; n];
    let mut w11 = vec![0.0f64; n];
    let mut h_in_arr = vec![0.0f64; n];

    for i in 0..n {
        let sx = src_x[i];
        let sy = src_y[i];
        let x0 = (sx.floor() as usize) % w;
        let x1 = (x0 + 1) % w;
        let tx = sx - sx.floor();

        let y0 = (sy.floor() as usize).min(h - 1);
        let y1 = (y0 + 1).min(h - 1);
        let ty = sy - (y0 as f64);

        let a = y0 * w + x0;
        let b = y0 * w + x1;
        let c = y1 * w + x0;
        let d = y1 * w + x1;

        idx00[i] = a;
        idx10[i] = b;
        idx01[i] = c;
        idx11[i] = d;

        let wa = (1.0 - tx) * (1.0 - ty);
        let wb = tx * (1.0 - ty);
        let wc = (1.0 - tx) * ty;
        let wd = tx * ty;

        w00[i] = wa;
        w10[i] = wb;
        w01[i] = wc;
        w11[i] = wd;
        h_in_arr[i] = h_pos[a] * wa + h_pos[b] * wb + h_pos[c] * wc + h_pos[d] * wd;
    }

    let mut q_next = vec![0.0f64; n];
    let mut rain_acc = vec![0.0f32; n];
    const N_ITERS: usize = 56;
    const RECORD_START: usize = 40;

    for iter in 0..N_ITERS {
        let record = iter >= RECORD_START;
        for i in 0..n {
            let q_in = q[idx00[i]] * w00[i]
                + q[idx10[i]] * w10[i]
                + q[idx01[i]] * w01[i]
                + q[idx11[i]] * w11[i];
            let qs = q_sat[i];
            let cr = conv_rate[i];
            let p_step;
            if is_land[i] {
                let lift = (h_pos[i] - h_in_arr[i]).max(0.0);
                let descent = (h_in_arr[i] - h_pos[i]).max(0.0);
                let foehn_supp = (-descent * 3.2).exp();
                let qs_eff = qs * (1.0 + 0.35 * descent);
                let excess = (q_in - qs_eff).max(0.0);
                p_step = (q_in
                    * (cr * 0.35 * foehn_supp + (lift * 0.85).min(0.60))
                    * curr_mod_arr[i]
                    + 0.65 * excess)
                    .min(q_in);
                let q_rem = (q_in - p_step).max(0.0);
                let recycle = (0.34 * p_step * recycle_temp[i]).min((qs_eff - q_rem).max(0.0));
                q_next[i] = q_rem + recycle;
            } else {
                let q_new = q_in + (qs - q_in).max(0.0) * 0.28;
                p_step = q_new * cr * 0.45 * curr_mod_arr[i];
                q_next[i] = (q_new - 0.5 * p_step).max(0.0);
            }
            if record {
                rain_acc[i] += p_step as f32;
            }
        }
        std::mem::swap(&mut q, &mut q_next);
    }

    let r_rain = ((2.0 * w as f64 / 360.0).round() as usize).max(1);
    blur_xwrap(&mut rain_acc, w, h, r_rain);
    rain_acc
}

/// Вычисляет сезонный климат с параметрами Земли по умолчанию.
pub fn compute(grid: &Grid, rel_height_km: &[f32], currents: &Currents, seed: &str) -> Climate {
    compute_with_params(
        grid,
        rel_height_km,
        currents,
        seed,
        &ClimateParams::default(),
    )
}

/// Вычисляет сезонный климат по рельефу `rel_height_km`, океаническим течениям `currents` и параметрам планеты.
pub fn compute_with_params(
    grid: &Grid,
    rel_height_km: &[f32],
    currents: &Currents,
    seed: &str,
    params: &ClimateParams,
) -> Climate {
    let w = grid.w;
    let h = grid.h;
    let n = grid.len();
    assert_eq!(rel_height_km.len(), n);
    assert_eq!(currents.temp_anomaly.len(), n);
    let tilt_scale = (params.axial_tilt_deg.clamp(0.0, 60.0)) / 23.4;
    let rot = params.rotation_rate.clamp(0.25, 3.0);
    let rot_k = rot.sqrt();
    let itcz_shift = 11.0 * tilt_scale;

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

    let current_temp = currents.temp_anomaly.clone();
    let current_u = currents.u.clone();
    let current_v = currents.v.clone();

    // 1. Сезонные температуры (январь / июль) и среднегодовая температура.
    let temp_jan_c = season_temperature(
        grid,
        rel_height_km,
        &dist_to_sea_km,
        &current_temp,
        &noise_t,
        -1.0,
        params,
    );
    let temp_jul_c = season_temperature(
        grid,
        rel_height_km,
        &dist_to_sea_km,
        &current_temp,
        &noise_t,
        1.0,
        params,
    );

    let mut temp_c = vec![0f32; n];
    let mut temp_amp_c = vec![0f32; n];
    let mut temp_01 = vec![0f32; n];
    for i in 0..n {
        temp_c[i] = 0.5 * (temp_jan_c[i] + temp_jul_c[i]);
        temp_amp_c[i] = (temp_jul_c[i] - temp_jan_c[i]).abs();
        temp_01[i] = ((temp_c[i] + 24.0) / 53.0).clamp(0.0, 1.0);
    }

    // 2. Сезонные приземные ветры с термическими муссонами.
    let (wind_u_jan, wind_v_jan) =
        season_winds(grid, rel_height_km, &temp_jan_c, -1.0, tilt_scale, rot);
    let (wind_u_jul, wind_v_jul) =
        season_winds(grid, rel_height_km, &temp_jul_c, 1.0, tilt_scale, rot);

    // 3. Сезонный 2D-перенос влаги (полулагранжев перенос + Клаузиус-Клапейрон + рециклинг с суши).
    let rain_jan = advect_moisture_season(
        grid,
        rel_height_km,
        &temp_jan_c,
        &wind_u_jan,
        &wind_v_jan,
        &current_temp,
        -itcz_shift,
        rot_k,
    );
    let rain_jul = advect_moisture_season(
        grid,
        rel_height_km,
        &temp_jul_c,
        &wind_u_jul,
        &wind_v_jul,
        &current_temp,
        itcz_shift,
        rot_k,
    );

    let mut rain_ann = vec![0.0f32; n];
    for i in 0..n {
        rain_ann[i] = 0.5 * (rain_jan[i] + rain_jul[i]);
    }

    let mut land_rain = Vec::new();
    for i in (0..n).step_by(2) {
        if rel_height_km[i] > 0.0 {
            land_rain.push(rain_ann[i]);
        }
    }
    land_rain.sort_by(|a, b| a.total_cmp(b));
    let med = if land_rain.is_empty() {
        1e-3f64
    } else {
        (land_rain[land_rain.len() / 2] as f64).max(1e-6)
    };

    let mut precip_mm = vec![0f32; n];
    let mut precip_jan_mm = vec![0f32; n];
    let mut precip_jul_mm = vec![0f32; n];
    let mut monsoon_index = vec![0f32; n];
    let mut moisture = vec![0f32; n];
    let mut rain_level = vec![1u8; n];
    let mut pet_mm = vec![0f32; n];
    let mut aridity_index = vec![0f32; n];
    let mut snow_frac = vec![0f32; n];
    let mut glacier = vec![0f32; n];
    let mut permafrost = vec![0f32; n];
    let mut snow_line_km = vec![0f32; n];

    let sub_lat = (27.0 / rot_k).clamp(15.0, 58.0);
    let sub_w = (9.5 / rot_k).clamp(5.0, 18.0);
    for y in 0..h {
        let lat = grid.lat_deg(y).abs();
        let itcz_boost = 0.10 * (-(lat / 11.0).powi(2)).exp();
        let subtrop_dry = 0.16 * (-((lat - sub_lat) / sub_w).powi(2)).exp();
        for x in 0..w {
            let i = grid.idx(x, y);
            let p = grid.unit_vec(x, y);
            let n_m = noise_m.fbm(p[0] * 6.0 + 11.0, p[1] * 6.0 - 5.0, p[2] * 6.0 + 7.0, 3);
            let cont = (dist_to_sea_km[i] as f64 / 2200.0).clamp(0.0, 1.0);
            let ratio_ann = ((rain_ann[i] as f64) / med).max(0.0);

            let base_m = 0.04 + 0.44 * ratio_ann.powf(0.80);
            let m = if rel_height_km[i] > 0.0 {
                ((base_m + 0.07 * n_m) * (1.0 - 0.18 * cont) + itcz_boost - 0.75 * subtrop_dry)
                    .clamp(0.02, 1.0)
            } else {
                (base_m + 0.06 * n_m).clamp(0.1, 1.0)
            };
            moisture[i] = m as f32;

            let mm = if rel_height_km[i] > 0.0 {
                (760.0
                    * ratio_ann.powf(0.88)
                    * (1.0 - 0.14 * cont)
                    * (1.0 + itcz_boost - 0.65 * subtrop_dry).max(0.30)
                    * (1.0 + 0.12 * n_m))
                    .clamp(20.0, 4200.0)
            } else {
                (760.0 * ratio_ann.max(0.05).powf(0.70)).clamp(80.0, 3400.0)
            };
            precip_mm[i] = mm as f32;

            let r_mean = (rain_ann[i] as f64).max(1e-6);
            let r_jan = (rain_jan[i] as f64 / r_mean).clamp(0.05, 2.5);
            let r_jul = (rain_jul[i] as f64 / r_mean).clamp(0.05, 2.5);
            let norm = 0.5 * (r_jan + r_jul);
            let p_jan = (mm * (r_jan / norm)).clamp(5.0, 6500.0);
            let p_jul = (mm * (r_jul / norm)).clamp(5.0, 6500.0);
            precip_jan_mm[i] = p_jan as f32;
            precip_jul_mm[i] = p_jul as f32;
            monsoon_index[i] = ((p_jul - p_jan).abs() / (mm + 100.0)) as f32;

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

            // 4. 12-месячный гармонический баланс испаряемости (Holdridge PET), снега и ледников (PDD).
            let t_jan = temp_jan_c[i] as f64;
            let t_jul = temp_jul_c[i] as f64;
            let t_mean = 0.5 * (t_jan + t_jul);
            let t_half = 0.5 * (t_jul - t_jan);
            let p_mean = 0.5 * (p_jan + p_jul);
            let p_half = 0.5 * (p_jul - p_jan);

            let mut bio_sum = 0.0f64;
            let mut pdd = 0.0f64;
            let mut snow_mm = 0.0f64;
            for month in 0..12 {
                let c = (TAU * (month as f64 - 6.0) / 12.0).cos();
                let tm = t_mean + t_half * c;
                let pm = (p_mean + p_half * c).max(0.0) / 12.0;
                bio_sum += tm.clamp(0.0, 30.0);
                pdd += tm.max(0.0) * 30.4375;
                snow_mm += pm * ((2.0 - tm) / 4.0).clamp(0.0, 1.0);
            }
            let pet = (58.93 * (bio_sum / 12.0)).max(40.0);
            pet_mm[i] = pet as f32;
            aridity_index[i] = (mm / pet.max(50.0)).clamp(0.0, 10.0) as f32;
            snow_frac[i] = (snow_mm / mm.max(1.0)).clamp(0.0, 1.0) as f32;

            let ablation_mm = 4.5 * pdd;
            let balance = snow_mm - ablation_mm;
            glacier[i] = if rel_height_km[i] > 0.0 && balance > 0.0 {
                (balance / (balance + 400.0)).clamp(0.0, 1.0) as f32
            } else {
                0.0
            };
            let t_warm = t_jan.max(t_jul);
            let t_cold = t_jan.min(t_jul);
            permafrost[i] = if rel_height_km[i] > 0.0 && t_mean < -0.5 {
                let cold_f = ((-0.5 - t_mean) / 7.0).clamp(0.0, 1.0);
                let winter_f = ((-8.0 - t_cold) / 14.0).clamp(0.35, 1.0);
                (cold_f * winter_f * (1.0 - 0.65 * glacier[i] as f64)).clamp(0.0, 1.0) as f32
            } else {
                0.0
            };
            snow_line_km[i] =
                ((rel_height_km[i].max(0.0) as f64) + (t_warm - 1.0) / 6.2).max(0.0) as f32;
        }
    }

    Climate {
        temp_c,
        temp_jan_c,
        temp_jul_c,
        temp_amp_c,
        temp_01,
        precip_mm,
        precip_jan_mm,
        precip_jul_mm,
        monsoon_index,
        moisture,
        rain_level,
        current_temp,
        current_u,
        current_v,
        dist_to_sea_km,
        wind_u_jan,
        wind_v_jan,
        wind_u_jul,
        wind_v_jul,
        pet_mm,
        aridity_index,
        snow_frac,
        glacier,
        permafrost,
        snow_line_km,
    }
}
