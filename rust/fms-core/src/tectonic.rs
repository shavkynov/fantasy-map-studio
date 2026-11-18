//! Тектоническая история мира на сфере — порт JS-прототипа `src/sphere-tectonic-history.js`
//! (план: docs/TECTONIC_HISTORY_PLAN.md). Алгоритм тот же; числа не обязаны совпадать с JS побитно
//! (sin/cos/pow в Rust и V8 могут отличаться в последнем разряде).

use crate::rng::{Noise, Rng};
use std::f64::consts::PI;

const DEG: f64 = PI / 180.0;
const TAU: f64 = PI * 2.0;
pub const VERSION: &str = "sphere-tectonic-history-rs-v1";

const TREF: f64 = 35.0;
const E_SLOPE: f64 = 0.15;
const E_FLOOR: f64 = -4.85;
const TAU_EROSION: f64 = 120.0;
const T_SHELF: f64 = 22.0;
const PTS_PER_BIN: f64 = 4.0;
const SUB: usize = 16;
const WELD_FRAC: f64 = 0.04;
const T_CAP: f64 = 60.0;
const ARC_RATE: f64 = 0.12;
const T_ARC_MAX: f64 = 52.0;
const AGE_MAX: f64 = 180.0;
const AGE_REF: f64 = 65.0;
const SUBSIDE: f64 = 0.26;
const SED_RATE: f64 = 0.03;
const T_CONT: f64 = 12.0;
const HOT_N: usize = 8;
const HOT_RATE: f64 = 0.25;
const HOT_RAD: f64 = 0.11;
const T_HOT_MAX: f64 = 48.0;
const OCE_W: f64 = 4.0;
const OCE_CAP: f64 = 1.3;
const T_ARC_OCE: f64 = 30.0;
const T_HOT_OCE: f64 = 34.0;
const KEEL: f64 = 3.0;
const G_FORCE: f64 = 1.6;
const TAU_V: f64 = 25.0;
const F_RIDGE: f64 = 0.25;
const SPEED_MAX: f64 = 12.0;

#[inline]
fn clamp(v: f64, a: f64, b: f64) -> f64 {
    v.max(a).min(b)
}
#[inline]
fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = clamp((x - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
/// Изостазия (Эйри): высота над общей отметкой, км.
pub fn isostasy(t: f64) -> f64 {
    E_SLOPE * t + E_FLOOR
}
#[inline]
fn jsround(x: f64) -> f64 {
    (x + 0.5).floor()
}

#[derive(Clone, Debug)]
pub struct Options {
    pub seed: String,
    pub w: usize,
    pub radius_km: f64,
    pub activity: f64,
    pub age_myr: f64,
    pub epoch_myr: f64,
    pub water_depth_km: f64,
    pub continental_fraction: f64,
    pub stop_at_myr: Option<f64>,
}

impl Options {
    pub fn new(seed: &str) -> Options {
        Options { seed: seed.to_string(), w: 360, radius_km: 6371.0, activity: 1.0, age_myr: 4500.0, epoch_myr: 150.0, water_depth_km: 2.62, continental_fraction: 0.4, stop_at_myr: None }
    }
    fn validate(&self) -> Result<f64, String> {
        if self.seed.trim().is_empty() || self.seed.encode_utf16().count() > 128 {
            return Err("Seed must be a nonempty string, at most 128 code units".into());
        }
        if self.w % 2 != 0 || self.w < 90 || self.w > 720 {
            return Err("Width must be an even integer 90..720".into());
        }
        if !(3000.0..=6500.0).contains(&self.radius_km) {
            return Err("Radius must be 3000..6500 km".into());
        }
        if !(0.5..=1.5).contains(&self.activity) {
            return Err("Activity must be 0.5..1.5".into());
        }
        if !(300.0..=4600.0).contains(&self.age_myr) {
            return Err("Age must be 300..4600 Myr".into());
        }
        if !(50.0..=450.0).contains(&self.epoch_myr) {
            return Err("Epoch must be 50..450 Myr".into());
        }
        if !(0.3..=6.0).contains(&self.water_depth_km) {
            return Err("Water depth must be 0.3..6 km".into());
        }
        if !(0.2..=0.5).contains(&self.continental_fraction) {
            return Err("Continental fraction must be 0.2..0.5".into());
        }
        let stop = self.stop_at_myr.unwrap_or(self.age_myr);
        if !(0.0..=self.age_myr).contains(&stop) {
            return Err("stopAtMyr must be within 0..ageMyr".into());
        }
        Ok(stop)
    }
}

#[derive(Clone, Debug, Default)]
pub struct Stats {
    pub land_fraction: f64,
    pub land_with_marine_sediment_fraction: f64,
    pub point_volume_start: f64,
    pub point_volume_end: f64,
    pub arc_added_volume: f64,
    pub hotspot_added_volume: f64,
    pub crust_volume_before_erosion: f64,
    pub crust_volume_after_erosion: f64,
    pub sediment_lost_volume: f64,
    pub points: usize,
    pub epochs: usize,
    pub time: f64,
}

#[derive(Clone, Debug)]
pub struct EpochRecord {
    pub plates: usize,
    pub welds: usize,
    pub omega_rad_per_myr: Vec<f64>,
}

#[derive(Clone, Debug)]
pub struct Hotspot {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub from_myr: f64,
    pub to_myr: f64,
    pub strength: f64,
}

pub struct World {
    pub w: usize,
    pub h: usize,
    pub thickness: Vec<f32>,
    pub thickness_before_erosion: Vec<f32>,
    pub elevation_km: Vec<f32>,
    pub sea_level_km: f64,
    pub cell_area: Vec<f64>,
    pub ocean_age_myr: Vec<f32>,
    pub submerged_myr: Vec<f32>,
    pub marine_sediment_km: Vec<f32>,
    pub sea_level_history_km: Vec<f64>,
    pub t_oro_myr: Vec<f32>,
    pub stats: Stats,
    pub history: Vec<EpochRecord>,
    pub hotspots: Vec<Hotspot>,
    pub cratons: usize,
}

struct Craton {
    p: [f64; 3],
    t1: [f64; 3],
    t2: [f64; 3],
    co: f64,
    si: f64,
    e: f64,
    rho: f64,
    pw: f64,
}

fn dcr(c: &Craton, x: f64, y: f64, z: f64) -> f64 {
    if x * c.p[0] + y * c.p[1] + z * c.p[2] < 0.0 {
        return 9.0;
    }
    let u0 = x * c.t1[0] + y * c.t1[1] + z * c.t1[2];
    let v0 = x * c.t2[0] + y * c.t2[1] + z * c.t2[2];
    let u = (u0 * c.co + v0 * c.si) / c.e;
    let v = -u0 * c.si + v0 * c.co;
    (u.abs().powf(c.pw) + v.abs().powf(c.pw)).powf(1.0 / c.pw) / c.rho
}

fn find(par: &mut [usize], mut i: usize) -> usize {
    while par[i] != i {
        par[i] = par[par[i]];
        i = par[i];
    }
    i
}

fn rot_matrix(w: [f64; 3], dt: f64) -> [f64; 9] {
    let ang = (w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sqrt() * dt;
    if ang < 1e-12 {
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    }
    let k = ang / dt;
    let (ux, uy, uz) = (w[0] / k, w[1] / k, w[2] / k);
    let (co, si) = (ang.cos(), ang.sin());
    let t = 1.0 - co;
    [
        co + ux * ux * t, ux * uy * t - uz * si, ux * uz * t + uy * si,
        uy * ux * t + uz * si, co + uy * uy * t, uy * uz * t - ux * si,
        uz * ux * t - uy * si, uz * uy * t + ux * si, co + uz * uz * t,
    ]
}

/// Сетка блюра по строкам (периодична по долготе).
fn blur_x(a: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut o = vec![0f32; w * h];
    let n = (2 * r + 1) as f32;
    for y in 0..h {
        for x in 0..w {
            let mut s = 0f32;
            for d in 0..=(2 * r) {
                s += a[y * w + (x + w + d - r) % w];
            }
            o[y * w + x] = s / n;
        }
    }
    o
}
fn blur_y(a: &[f32], w: usize, h: usize, r: usize) -> Vec<f32> {
    let mut o = vec![0f32; w * h];
    for y in 0..h {
        let y0 = y.saturating_sub(r);
        let y1 = (y + r).min(h - 1);
        let c = (y1 - y0 + 1) as f32;
        for x in 0..w {
            let mut s = 0f32;
            for yy in y0..=y1 {
                s += a[yy * w + x];
            }
            o[y * w + x] = s / c;
        }
    }
    o
}

pub fn generate(opt: &Options) -> Result<World, String> {
    let stop = opt.validate()?;
    let w_ = opt.w;
    let h_ = w_ / 2;
    let mut r = Rng::new(&format!("{}|tectonics", opt.seed));
    let noise = Noise::new(&mut Rng::new(&format!("{}|noise", opt.seed)));
    let wf = w_ as f64;

    // редуцированная сетка: число долготных ячеек в строке ~ cos широты
    let mut nlon = vec![0usize; h_];
    let mut off = vec![0usize; h_ + 1];
    let mut bin_area: Vec<f64> = Vec::new();
    let mut row_top = vec![0f64; h_];
    for row in 0..h_ {
        let lat0 = (90.0 - row as f64 / h_ as f64 * 180.0) * DEG;
        let lat1 = (90.0 - (row + 1) as f64 / h_ as f64 * 180.0) * DEG;
        let mid = (lat0 + lat1) / 2.0;
        nlon[row] = (jsround(wf * mid.cos()) as usize).max(1);
        off[row + 1] = off[row] + nlon[row];
        row_top[row] = lat0;
        let a = TAU / nlon[row] as f64 * (lat0.sin() - lat1.sin());
        for _ in 0..nlon[row] {
            bin_area.push(a);
        }
    }
    let nb = off[h_];
    const ZT: usize = 8192;
    let mut row_lut = vec![0usize; ZT + 1];
    for (i, v) in row_lut.iter_mut().enumerate() {
        let lat = (i as f64 / ZT as f64 * 2.0 - 1.0).asin();
        *v = (((90.0 - lat / DEG) / 180.0 * h_ as f64).floor().max(0.0) as usize).min(h_ - 1);
    }
    let bin_of = |x: f64, y: f64, z: f64| -> usize {
        let row = row_lut[jsround((z + 1.0) / 2.0 * ZT as f64) as usize];
        off[row] + (nlon[row] - 1).min((((y.atan2(x) + PI) / TAU * nlon[row] as f64).floor().max(0.0)) as usize)
    };
    let mut bc = vec![0f64; 3 * nb];
    let mut nbr = vec![0usize; 4 * nb];
    for row in 0..h_ {
        let lat = row_top[row] - PI / h_ as f64 * 0.5;
        for k in 0..nlon[row] {
            let lon = (k as f64 + 0.5) / nlon[row] as f64 * TAU - PI;
            let b = off[row] + k;
            bc[3 * b] = lat.cos() * lon.cos();
            bc[3 * b + 1] = lat.cos() * lon.sin();
            bc[3 * b + 2] = lat.sin();
        }
    }
    for b in 0..nb {
        let (x, y, z) = (bc[3 * b], bc[3 * b + 1], bc[3 * b + 2]);
        let el = x.hypot(y).max(1e-300);
        let el = if x.hypot(y) == 0.0 { 1.0 } else { el };
        let d = TAU / wf * 1.05;
        let (ex, ey, nx, ny, nz) = (-y / el, x / el, -z * x / el, -z * y / el, el);
        let at = |sx: f64, sy: f64, sz: f64| {
            let l = (sx * sx + sy * sy + sz * sz).sqrt();
            bin_of(sx / l, sy / l, sz / l)
        };
        nbr[4 * b] = at(x + d * ex, y + d * ey, z);
        nbr[4 * b + 1] = at(x - d * ex, y - d * ey, z);
        nbr[4 * b + 2] = at(x + d * nx, y + d * ny, z + d * nz);
        nbr[4 * b + 3] = at(x - d * nx, y - d * ny, z - d * nz);
    }

    // решётка Фибоначчи и стартовый суперконтинент — коллаж кратонов
    let np = jsround(PTS_PER_BIN * nb as f64) as usize;
    let pa = 4.0 * PI / np as f64;
    let golden = PI * (3.0 - 5f64.sqrt());
    let (cx, cy, cz) = (r.next() * 2.0 - 1.0, r.next() * 2.0 - 1.0, r.next() * 2.0 - 1.0);
    let cl = {
        let l = (cx * cx + cy * cy + cz * cz).sqrt();
        if l == 0.0 { 1.0 } else { l }
    };
    let c0 = [cx / cl, cy / cl, cz / cl];
    let ncr = 5 + (r.next() * 5.0).floor() as usize;
    let bx = if c0[2].abs() > 0.9 { [1.0, 0.0, 0.0] } else { [0.0, 0.0, 1.0] };
    let mut crat: Vec<Craton> = Vec::new();
    for c in 0..ncr {
        let (mut dx, mut dy, mut dz) = (r.next() * 2.0 - 1.0, r.next() * 2.0 - 1.0, r.next() * 2.0 - 1.0);
        let dl = { let l = (dx * dx + dy * dy + dz * dz).sqrt(); if l == 0.0 { 1.0 } else { l } };
        dx /= dl; dy /= dl; dz /= dl;
        let dd = dx * c0[0] + dy * c0[1] + dz * c0[2];
        dx -= dd * c0[0]; dy -= dd * c0[1]; dz -= dd * c0[2];
        let dm = { let l = (dx * dx + dy * dy + dz * dz).sqrt(); if l == 0.0 { 1.0 } else { l } };
        let a = if c == 0 { 0.0 } else { 0.3 + 0.5 * r.next() };
        let (px, py, pz) = (
            c0[0] * a.cos() + dx / dm * a.sin(),
            c0[1] * a.cos() + dy / dm * a.sin(),
            c0[2] * a.cos() + dz / dm * a.sin(),
        );
        let (mut t1x, mut t1y, mut t1z) = (py * bx[2] - pz * bx[1], pz * bx[0] - px * bx[2], px * bx[1] - py * bx[0]);
        let t1l = { let l = (t1x * t1x + t1y * t1y + t1z * t1z).sqrt(); if l == 0.0 { 1.0 } else { l } };
        t1x /= t1l; t1y /= t1l; t1z /= t1l;
        let (t2x, t2y, t2z) = (py * t1z - pz * t1y, pz * t1x - px * t1z, px * t1y - py * t1x);
        let th = r.next() * PI;
        let e = 1.0 + 1.2 * r.next();
        let rho = 0.4 + 0.3 * r.next();
        let pw = 1.1 + 1.6 * r.next();
        crat.push(Craton { p: [px, py, pz], t1: [t1x, t1y, t1z], t2: [t2x, t2y, t2z], co: th.cos(), si: th.sin(), e, rho, pw });
    }
    let mut score = vec![0f32; np];
    let mut suture = vec![0u8; np];
    let (mut sx, mut sy, mut sz) = (vec![0f64; np], vec![0f64; np], vec![0f64; np]);
    for i in 0..np {
        let z = 1.0 - (2.0 * i as f64 + 1.0) / np as f64;
        let rr = (1.0 - z * z).sqrt();
        let a = i as f64 * golden;
        sx[i] = rr * a.cos(); sy[i] = rr * a.sin(); sz[i] = z;
        let (mut d1, mut d2) = (9.0f64, 9.0f64);
        for c in &crat {
            let d = dcr(c, sx[i], sy[i], sz[i]);
            if d < d1 { d2 = d1; d1 = d; } else if d < d2 { d2 = d; }
        }
        score[i] = (d1 + 0.05 * noise.get(sx[i] * 5.3 + 3.0, sy[i] * 5.3 + 9.0, sz[i] * 5.3 + 1.0)) as f32;
        suture[i] = if d2 < 1.25 && d1 < 1.25 { 1 } else { 0 };
    }
    let mut order: Vec<usize> = (0..np).collect();
    order.sort_by(|&a, &b| score[a].partial_cmp(&score[b]).unwrap_or(std::cmp::Ordering::Equal));
    let n = jsround(opt.continental_fraction * np as f64) as usize;
    let no = (OCE_CAP * nb as f64).ceil() as usize;
    let nn = n + no;
    let mut x = vec![0f64; 3 * nn];
    let mut thick = vec![0f32; nn];
    let mut alive = vec![0u8; nn];
    let mut o_age = vec![0f32; nn];
    for k in 0..n {
        let i = order[k];
        x[3 * k] = sx[i]; x[3 * k + 1] = sy[i]; x[3 * k + 2] = sz[i];
        thick[k] = (TREF - 15.0 * smooth(0.7, 1.0, k as f64 / n as f64) + if suture[i] == 1 { 8.0 } else { 0.0 }) as f32;
        alive[k] = 1;
    }
    let mut free: Vec<usize> = Vec::new();
    {
        let mut has = vec![0u8; nb];
        for k in 0..n {
            has[bin_of(x[3 * k], x[3 * k + 1], x[3 * k + 2])] += 1;
        }
        let mut q = n;
        for b in 0..nb {
            if has[b] < 2 && q < nn {
                let k = q;
                q += 1;
                x[3 * k] = bc[3 * b]; x[3 * k + 1] = bc[3 * b + 1]; x[3 * k + 2] = bc[3 * b + 2];
                alive[k] = 1;
                o_age[k] = (r.next() * AGE_MAX) as f32;
            }
        }
        for k in (q..nn).rev() {
            free.push(k);
        }
    }
    let volume0: f64 = (0..n).map(|k| thick[k] as f64 * pa).sum();

    // горячие точки
    let mut hr = Rng::new(&format!("{}|hotspots", opt.seed));
    struct Hot { x: f64, y: f64, z: f64, t0: f64, t1: f64, s: f64 }
    let mut hots: Vec<Hot> = Vec::new();
    for _ in 0..HOT_N {
        let z = hr.next() * 2.0 - 1.0;
        let a = hr.next() * TAU;
        let rr = (1.0 - z * z).sqrt();
        let t0 = hr.next() * opt.age_myr;
        let t1 = t0 + 150.0 + 350.0 * hr.next();
        let s = 0.5 + hr.next();
        hots.push(Hot { x: rr * a.cos(), y: rr * a.sin(), z, t0, t1, s });
    }
    let hcos = (2.2 * HOT_RAD).cos();

    // ---- история ----
    let mut t_oro = vec![-1f32; nb];
    let mut sub_myr = vec![0f32; nb];
    let mut sea_sed = vec![0f32; nb];
    let mut sea_hist: Vec<f64> = Vec::new();
    let n_epochs = (stop / opt.epoch_myr).ceil() as usize;
    let mut epochs: Vec<EpochRecord> = Vec::new();
    let mut grp = vec![0usize; nn];
    let mut bin_idx = vec![0usize; nn];
    let mut oce_bin = vec![usize::MAX; nb];
    let mut cont_cnt = vec![0u8; nb];
    let mut cont_grp = vec![0usize; nb];
    let (mut time, mut arc_added, mut hot_added) = (0f64, 0f64, 0f64);
    let raster_bins = |bin_idx: &[usize], thick: &[f32]| -> Vec<f32> {
        let mut t = vec![0f32; nb];
        for k in 0..n {
            t[bin_idx[k]] += (thick[k] as f64 * pa) as f32;
        }
        for b in 0..nb {
            t[b] = (t[b] as f64 / bin_area[b]) as f32;
        }
        t
    };
    for k in 0..nn {
        if alive[k] == 1 {
            bin_idx[k] = bin_of(x[3 * k], x[3 * k + 1], x[3 * k + 2]);
        }
    }
    for k in n..nn {
        if alive[k] == 1 {
            oce_bin[bin_idx[k]] = k;
        }
    }
    let step = TAU / wf;
    for e in 0..n_epochs {
        let dt_epoch = opt.epoch_myr.min(stop - e as f64 * opt.epoch_myr);
        let dt = dt_epoch / SUB as f64;
        // (а) трещины
        let kp = 4 + (r.next() * 5.0).floor() as usize;
        let pick = |r: &mut Rng| -> usize {
            loop {
                let c = (r.next() * nn as f64).floor() as usize;
                if alive[c] == 1 { return c; }
            }
        };
        let mut seeds = vec![pick(&mut r)];
        while seeds.len() < kp {
            let (mut bi, mut bd) = (usize::MAX, -1f64);
            for _ in 0..300 {
                let c = pick(&mut r);
                let mut md = 9f64;
                for &s in &seeds {
                    md = md.min(1.0 - (x[3 * c] * x[3 * s] + x[3 * c + 1] * x[3 * s + 1] + x[3 * c + 2] * x[3 * s + 2]));
                }
                if md > bd { bd = md; bi = c; }
            }
            seeds.push(bi);
        }
        let wob = 0.1 + 0.12 * r.next();
        let nsx = r.next() * 50.0;
        let mut size = vec![0f64; kp];
        let mut csz = vec![0f64; kp];
        for k in 0..nn {
            if alive[k] == 0 { continue; }
            let (px, py, pz) = (x[3 * k], x[3 * k + 1], x[3 * k + 2]);
            let (mut bg, mut bs) = (0usize, 1e9f64);
            for s in 0..kp {
                let q = seeds[s];
                let d = 1.0 - (px * x[3 * q] + py * x[3 * q + 1] + pz * x[3 * q + 2])
                    + wob * noise.get(px * 3.0 + nsx + s as f64 * 7.1, py * 3.0 + s as f64 * 3.3, pz * 3.0 - nsx);
                if d < bs { bs = d; bg = s; }
            }
            grp[k] = bg;
            size[bg] += if k < n { 1.0 } else { OCE_W };
            if k < n { csz[bg] += 1.0; }
        }
        // (б) оси и стартовые скорости
        let n_oce = (n..nn).filter(|&k| alive[k] == 1).count();
        let mean_size = (n as f64 + OCE_W * n_oce as f64) / kp as f64;
        let mut omega: Vec<[f64; 3]> = Vec::new();
        for s in 0..kp {
            let (ax, ay, az) = (r.next() * 2.0 - 1.0, r.next() * 2.0 - 1.0, r.next() * 2.0 - 1.0);
            let al = { let l = (ax * ax + ay * ay + az * az).sqrt(); if l == 0.0 { 1.0 } else { l } };
            let v = opt.activity * (1.5 + 3.5 * r.next()) * clamp((mean_size / size[s].max(1.0)).powf(0.25), 0.7, 1.5);
            let w = v * 10.0 / opt.radius_km;
            omega.push([ax / al * w, ay / al * w, az / al * w]);
        }
        // (в) дрейф со сваркой
        let mut par: Vec<usize> = (0..kp).collect();
        let mut sum: Vec<[f64; 3]> = (0..kp).map(|s| [omega[s][0] * size[s], omega[s][1] * size[s], omega[s][2] * size[s]]).collect();
        let mut cnt = size.clone();
        let mut dm: Vec<f64> = (0..kp).map(|s| size[s] + (KEEL - 1.0) * csz[s]).collect();
        let mut welds = 0usize;
        let mut occ = vec![0u8; nb * kp];
        let mut pair = vec![0i32; kp * kp];
        let mut tb = vec![0f32; nb];
        let mut cnt_b = vec![0i32; nb];
        let mut b_start = vec![0usize; nb + 1];
        let mut fill_pos = vec![0usize; nb];
        let mut by_bin = vec![0usize; n];
        for st in 0..SUB {
            let rots: Vec<[f64; 9]> = (0..kp)
                .map(|s| {
                    let rt = find(&mut par, s);
                    let c = cnt[rt];
                    rot_matrix([sum[rt][0] / c, sum[rt][1] / c, sum[rt][2] / c], dt)
                })
                .collect();
            for v in cnt_b.iter_mut() { *v = 0; }
            for k in 0..n { cnt_b[bin_idx[k]] += 1; }
            for h in &hots {
                if time < h.t0 || time > h.t1 { continue; }
                for k in n..nn {
                    if alive[k] == 0 || thick[k] as f64 >= T_HOT_OCE { continue; }
                    let c = x[3 * k] * h.x + x[3 * k + 1] * h.y + x[3 * k + 2] * h.z;
                    if c < hcos { continue; }
                    let th = clamp(c, -1.0, 1.0).acos() / HOT_RAD;
                    thick[k] = (T_HOT_OCE).min(thick[k] as f64 + HOT_RATE * 2.0 * h.s * (-th * th).exp() * dt) as f32;
                }
                for k in 0..n {
                    let c = x[3 * k] * h.x + x[3 * k + 1] * h.y + x[3 * k + 2] * h.z;
                    if c < hcos || thick[k] as f64 >= T_HOT_MAX { continue; }
                    let th = clamp(c, -1.0, 1.0).acos() / HOT_RAD;
                    let inc = (T_HOT_MAX - thick[k] as f64).min(HOT_RATE * h.s * (-th * th).exp() * dt);
                    thick[k] = (thick[k] as f64 + inc) as f32;
                    hot_added += inc * pa;
                    t_oro[bin_idx[k]] = time as f32;
                }
            }
            // дуга возможна только у края суши: если ячейка, её соседи и соседи соседей заняты континентом, впереди океана нет
            let edge: Vec<bool> = (0..nb).map(|b| (0..4).any(|q| { let c = nbr[4 * b + q]; cnt_b[c] == 0 || (0..4).any(|q2| cnt_b[nbr[4 * c + q2]] == 0) })).collect();
            for k in 0..n {
                if !edge[bin_idx[k]] { continue; }
                let rt = find(&mut par, grp[k]);
                let c = cnt[rt];
                let (wx, wy, wz) = (sum[rt][0] / c, sum[rt][1] / c, sum[rt][2] / c);
                let (px, py, pz) = (x[3 * k], x[3 * k + 1], x[3 * k + 2]);
                let (vx, vy, vz) = (wy * pz - wz * py, wz * px - wx * pz, wx * py - wy * px);
                let sp = (vx * vx + vy * vy + vz * vz).sqrt();
                if sp < 1e-9 { continue; }
                let d = 1.5 * step / sp;
                let (ax, ay, az) = (px + vx * d, py + vy * d, pz + vz * d);
                let al = (ax * ax + ay * ay + az * az).sqrt();
                let b2 = bin_of(ax / al, ay / al, az / al);
                if cnt_b[b2] > 0 || thick[k] as f64 >= T_ARC_MAX { continue; }
                let o2 = oce_bin[b2];
                if o2 == usize::MAX { continue; }
                let g2 = grp[o2];
                if find(&mut par, g2) == rt { continue; }
                let inc = (T_ARC_MAX - thick[k] as f64).min(ARC_RATE * (sp * opt.radius_km / 10.0 / 5.0) * dt);
                thick[k] = (thick[k] as f64 + inc) as f32;
                arc_added += inc * pa;
                t_oro[bin_idx[k]] = time as f32;
            }
            // поворот всех точек плит; независим по точкам — считаем в нескольких потоках
            {
                let thr = std::thread::available_parallelism().map(|v| v.get()).unwrap_or(1).min(8);
                let cs = (nn + thr - 1) / thr;
                let (alive_r, grp_r, rots_r, bin_of_r) = (&alive, &grp, &rots, &bin_of);
                std::thread::scope(|sc| {
                    for (ci, (xc, bc_)) in x.chunks_mut(3 * cs).zip(bin_idx.chunks_mut(cs)).enumerate() {
                        sc.spawn(move || {
                            for j in 0..bc_.len() {
                                let k = ci * cs + j;
                                if alive_r[k] == 0 { continue; }
                                let m = &rots_r[grp_r[k]];
                                let (px, py, pz) = (xc[3 * j], xc[3 * j + 1], xc[3 * j + 2]);
                                let (mut nx, mut ny, mut nz) = (m[0] * px + m[1] * py + m[2] * pz, m[3] * px + m[4] * py + m[5] * pz, m[6] * px + m[7] * py + m[8] * pz);
                                let l = 1.0 / (nx * nx + ny * ny + nz * nz).sqrt();
                                nx *= l; ny *= l; nz *= l;
                                xc[3 * j] = nx; xc[3 * j + 1] = ny; xc[3 * j + 2] = nz;
                                bc_[j] = bin_of_r(nx, ny, nz);
                            }
                        });
                    }
                });
            }
            time += dt;
            // растекание сверхмощной коры
            for _pass in 0..4 {
                for v in tb.iter_mut() { *v = 0.0; }
                for v in cnt_b.iter_mut() { *v = 0; }
                for k in 0..n {
                    let b = bin_idx[k];
                    tb[b] += (thick[k] as f64 * pa / bin_area[b]) as f32;
                    cnt_b[b] += 1;
                }
                if !tb.iter().any(|&v| v as f64 > T_CAP) { break; }
                let mut acc = 0usize;
                for b in 0..=nb {
                    b_start[b] = acc;
                    if b < nb { acc += cnt_b[b] as usize; }
                }
                fill_pos.copy_from_slice(&b_start[..nb]);
                for k in 0..n {
                    let b = bin_idx[k];
                    by_bin[fill_pos[b]] = k;
                    fill_pos[b] += 1;
                }
                for b in 0..nb {
                    if tb[b] as f64 <= T_CAP { continue; }
                    let (mut nbi, mut lo) = (usize::MAX, tb[b]);
                    for q in 0..4 {
                        let c = nbr[4 * b + q];
                        if tb[c] < lo { lo = tb[c]; nbi = c; }
                    }
                    if nbi == usize::MAX { continue; }
                    let mv_n = (cnt_b[b] as f64 * (0.5f64).min((tb[b] as f64 - (lo as f64).max(T_CAP * 0.6)) / (2.0 * tb[b] as f64))).ceil() as usize;
                    for u in 0..mv_n {
                        let k = by_bin[b_start[b] + u];
                        let j = 1.0 / 2.2;
                        let (jx, jy) = ((r.next() - 0.5) * j * step, (r.next() - 0.5) * j * step);
                        let (mut px, mut py, mut pz) = (bc[3 * nbi] + jx, bc[3 * nbi + 1] + jy, bc[3 * nbi + 2] + jx * 0.3);
                        let l = (px * px + py * py + pz * pz).sqrt();
                        px /= l; py /= l; pz /= l;
                        x[3 * k] = px; x[3 * k + 1] = py; x[3 * k + 2] = pz;
                        bin_idx[k] = bin_of(px, py, pz);
                    }
                }
            }
            // силы
            let mut tor = vec![0f64; 3 * kp];
            let vel_at = |sum: &[[f64; 3]], cnt: &[f64], rr: usize, px: f64, py: f64, pz: f64| -> [f64; 3] {
                let c = cnt[rr];
                let (wx, wy, wz) = (sum[rr][0] / c, sum[rr][1] / c, sum[rr][2] / c);
                [wy * pz - wz * py, wz * px - wx * pz, wx * py - wy * px]
            };
            let pull = |sum: &[[f64; 3]], cnt: &[f64], tor: &mut [f64], rs: usize, ro: usize, px: f64, py: f64, pz: f64, age: f64, wgt: f64| {
                let a = vel_at(sum, cnt, rs, px, py, pz);
                let b = vel_at(sum, cnt, ro, px, py, pz);
                let (vx, vy, vz) = (a[0] - b[0], a[1] - b[1], a[2] - b[2]);
                let vm = (vx * vx + vy * vy + vz * vz).sqrt();
                if vm < 1e-9 { return; }
                let m = (0.3 + age.min(AGE_MAX) / 100.0) * wgt * (4.0f64).min(step / (vm * dt).max(step * 0.25)) / vm;
                tor[3 * rs] += (py * vz - pz * vy) * m;
                tor[3 * rs + 1] += (pz * vx - px * vz) * m;
                tor[3 * rs + 2] += (px * vy - py * vx) * m;
            };
            for v in cont_cnt.iter_mut() { *v = 0; }
            for k in 0..n {
                let b = bin_idx[k];
                if cont_cnt[b] < 255 { cont_cnt[b] += 1; }
                cont_grp[b] = grp[k];
            }
            for v in oce_bin.iter_mut() { *v = usize::MAX; }
            for k in n..nn {
                if alive[k] == 0 { continue; }
                o_age[k] += dt as f32;
                let b = bin_idx[k];
                if cont_cnt[b] >= 2 {
                    let (rs, ro) = (find(&mut par, grp[k]), find(&mut par, cont_grp[b]));
                    pull(&sum, &cnt, &mut tor, rs, ro, x[3 * k], x[3 * k + 1], x[3 * k + 2], o_age[k] as f64, OCE_W);
                    alive[k] = 0;
                    free.push(k);
                    continue;
                }
                let j = oce_bin[b];
                if j == usize::MAX { oce_bin[b] = k; continue; }
                let (rk, rj) = (find(&mut par, grp[k]), find(&mut par, grp[j]));
                if rk == rj {
                    alive[k] = 0;
                    free.push(k);
                    continue;
                }
                let (old, young) = if o_age[k] > o_age[j] { (k, j) } else { (j, k) };
                let (ro_, ry) = (find(&mut par, grp[old]), find(&mut par, grp[young]));
                pull(&sum, &cnt, &mut tor, ro_, ry, x[3 * old], x[3 * old + 1], x[3 * old + 2], o_age[old] as f64, OCE_W);
                alive[old] = 0;
                free.push(old);
                oce_bin[b] = young;
                thick[young] = T_ARC_OCE.min(thick[young] as f64 + ARC_RATE * dt) as f32;
            }
            for b in 0..nb {
                if cont_cnt[b] > 0 || oce_bin[b] != usize::MAX || free.is_empty() { continue; }
                let (mut g, mut gc) = (usize::MAX, 0usize);
                for q in 0..4 {
                    let c = nbr[4 * b + ((q + (st & 3)) & 3)];
                    if oce_bin[c] != usize::MAX { g = grp[oce_bin[c]]; gc = c; break; }
                    if cont_cnt[c] > 0 { g = cont_grp[c]; gc = c; break; }
                }
                if g == usize::MAX { continue; }
                {
                    let rr = find(&mut par, g);
                    let (dx, dy, dz) = (bc[3 * gc] - bc[3 * b], bc[3 * gc + 1] - bc[3 * b + 1], bc[3 * gc + 2] - bc[3 * b + 2]);
                    let dl = { let l = (dx * dx + dy * dy + dz * dz).sqrt(); if l == 0.0 { 1.0 } else { l } };
                    let wr = (sum[rr][0] * sum[rr][0] + sum[rr][1] * sum[rr][1] + sum[rr][2] * sum[rr][2]).sqrt() / cnt[rr];
                    let m = F_RIDGE * (4.0f64).min(step / (wr * dt).max(step * 0.25)) / dl;
                    let (px, py, pz) = (bc[3 * b], bc[3 * b + 1], bc[3 * b + 2]);
                    tor[3 * rr] += (py * dz - pz * dy) * m;
                    tor[3 * rr + 1] += (pz * dx - px * dz) * m;
                    tor[3 * rr + 2] += (px * dy - py * dx) * m;
                }
                let k = free.pop().unwrap();
                let j = 1.0 / 2.2;
                let (jx, jy) = ((r.next() - 0.5) * j * step, (r.next() - 0.5) * j * step);
                let (px, py, pz) = (bc[3 * b] + jx, bc[3 * b + 1] + jy, bc[3 * b + 2] + jx * 0.3);
                let l = (px * px + py * py + pz * pz).sqrt();
                x[3 * k] = px / l; x[3 * k + 1] = py / l; x[3 * k + 2] = pz / l;
                alive[k] = 1; o_age[k] = 0.0; thick[k] = 0.0; grp[k] = g; bin_idx[k] = b; oce_bin[b] = k;
            }
            {
                let relax = 1.0 - (-dt / TAU_V).exp();
                let w_max = SPEED_MAX * 10.0 / opt.radius_km;
                for rr in 0..kp {
                    if find(&mut par, rr) != rr { continue; }
                    let c = cnt[rr];
                    let g = G_FORCE * opt.activity / dm[rr];
                    let (mut tx, mut ty, mut tz) = (tor[3 * rr] * g, tor[3 * rr + 1] * g, tor[3 * rr + 2] * g);
                    let tm = (tx * tx + ty * ty + tz * tz).sqrt();
                    if tm > w_max { let f = w_max / tm; tx *= f; ty *= f; tz *= f; }
                    sum[rr][0] += (tx * c - sum[rr][0]) * relax;
                    sum[rr][1] += (ty * c - sum[rr][1]) * relax;
                    sum[rr][2] += (tz * c - sum[rr][2]) * relax;
                }
            }
            // столкновения и сварка
            for v in occ.iter_mut() { *v = 0; }
            for k in 0..n {
                let s = find(&mut par, grp[k]);
                let i = bin_idx[k] * kp + s;
                if occ[i] < 255 { occ[i] += 1; }
            }
            for v in pair.iter_mut() { *v = 0; }
            for b in 0..nb {
                let hit: Vec<usize> = (0..kp).filter(|&s| occ[b * kp + s] as f64 >= PTS_PER_BIN * 0.75).collect();
                if hit.len() < 2 { continue; }
                t_oro[b] = time as f32;
                for u in 0..hit.len() {
                    for v in (u + 1)..hit.len() {
                        pair[hit[u] * kp + hit[v]] += 1;
                    }
                }
            }
            for a in 0..kp {
                for s in (a + 1)..kp {
                    if find(&mut par, a) != a || find(&mut par, s) != s || pair[a * kp + s] == 0 { continue; }
                    if pair[a * kp + s] as f64 > (6f64).max(WELD_FRAC * csz[a].min(csz[s]) / PTS_PER_BIN) {
                        par[s] = a;
                        let ss = sum[s];
                        sum[a][0] += ss[0]; sum[a][1] += ss[1]; sum[a][2] += ss[2];
                        cnt[a] += cnt[s];
                        csz[a] += csz[s];
                        dm[a] += dm[s];
                        welds += 1;
                    }
                }
            }
        }
        // летопись затоплений
        {
            let tq = raster_bins(&bin_idx, &thick);
            let v0 = opt.water_depth_km * 4.0 * PI;
            let el: Vec<f32> = (0..nb).map(|b| isostasy((tq[b] as f64).min(T_CAP)) as f32).collect();
            let (mut l0, mut h0) = (-8.0f64, 14.0f64);
            for _ in 0..40 {
                let m = (l0 + h0) / 2.0;
                let mut v = 0.0;
                for b in 0..nb { if (el[b] as f64) < m { v += (m - el[b] as f64) * bin_area[b]; } }
                if v > v0 { h0 = m; } else { l0 = m; }
            }
            let sl = (l0 + h0) / 2.0;
            sea_hist.push(jsround(sl * 1000.0) / 1000.0);
            for b in 0..nb {
                if (el[b] as f64) < sl {
                    sub_myr[b] += dt_epoch as f32;
                    if tq[b] as f64 >= T_CONT && sl - (el[b] as f64) < 0.5 { sea_sed[b] += (SED_RATE * dt_epoch) as f32; }
                }
            }
        }
        let om: Vec<f64> = (0..kp)
            .map(|s| {
                let rt = find(&mut par, s);
                (sum[rt][0] * sum[rt][0] + sum[rt][1] * sum[rt][1] + sum[rt][2] * sum[rt][2]).sqrt() / cnt[rt]
            })
            .collect();
        epochs.push(EpochRecord { plates: kp, welds, omega_rad_per_myr: om });
    }
    let volume1: f64 = (0..n).map(|k| thick[k] as f64 * pa).sum();

    // ---- растр на равнопромежуточную сетку ----
    let nc = w_ * h_;
    let mut area = vec![0f64; nc];
    let mut t = vec![0f32; nc];
    let tb = raster_bins(&bin_idx, &thick);
    let mut sub_grid = vec![0f32; nc];
    let mut sed_grid = vec![0f32; nc];
    let mut t_oro_grid = vec![0f32; nc];
    let mut age_v = vec![0f32; nc];
    let mut age_w = vec![0f32; nc];
    for row in 0..h_ {
        let a = TAU / wf * ((90.0 - row as f64 / h_ as f64 * 180.0).mul_add(DEG, 0.0).sin() - (90.0 - (row + 1) as f64 / h_ as f64 * 180.0).mul_add(DEG, 0.0).sin());
        for xx in 0..w_ {
            let i = row * w_ + xx;
            let b = off[row] + (nlon[row] - 1).min(((xx as f64 + 0.5) / wf * nlon[row] as f64).floor() as usize);
            area[i] = a;
            let ok = oce_bin[b];
            t[i] = tb[b] + if ok != usize::MAX { thick[ok] } else { 0.0 };
            age_v[i] = if ok != usize::MAX { o_age[ok] } else { 0.0 };
            age_w[i] = if ok != usize::MAX { 1.0 } else { 0.0 };
            t_oro_grid[i] = t_oro[b];
            sub_grid[i] = sub_myr[b];
            sed_grid[i] = sea_sed[b];
        }
    }
    {
        let sm = blur_y(&blur_x(&t, w_, h_, 1), w_, h_, 1);
        t.copy_from_slice(&sm);
    }
    // эрозия
    let t_end = stop;
    let mut te = t.clone();
    let mut removed = vec![0f32; nc];
    let (mut rem_tot, mut tot0, mut lost) = (0f64, 0f64, 0f64);
    for i in 0..nc {
        tot0 += t[i] as f64 * area[i];
        let ex = (t[i] as f64 - TREF).max(0.0);
        if ex == 0.0 { continue; }
        let age = if t_oro_grid[i] < 0.0 { t_end } else { (t_end - t_oro_grid[i] as f64).max(0.0) };
        let keep = ex * (-age / TAU_EROSION).exp();
        te[i] = ((t[i] as f64).min(TREF) + keep) as f32;
        removed[i] = t[i] - te[i];
        rem_tot += removed[i] as f64 * area[i];
    }
    if rem_tot > 0.0 {
        let rr = 2usize.max(jsround(wf / 120.0) as usize);
        let mut dep = removed.clone();
        for _ in 0..2 { dep = blur_y(&blur_x(&dep, w_, h_, rr), w_, h_, rr); }
        let cont_in: Vec<f32> = te.iter().map(|&v| if v > 5.0 { 1.0 } else { 0.0 }).collect();
        let cont = blur_y(&blur_x(&cont_in, w_, h_, rr), w_, h_, rr);
        let mut dep_tot = 0f64;
        for i in 0..nc {
            dep[i] = (dep[i] as f64 * smooth(0.02, 0.2, cont[i] as f64) * if (te[i] as f64) < TREF { 1.0 } else { 0.0 }) as f32;
            dep_tot += dep[i] as f64 * area[i];
        }
        let sc = if dep_tot > 0.0 { rem_tot / dep_tot } else { 0.0 };
        let mut put = 0f64;
        for i in 0..nc {
            let d = (dep[i] as f64 * sc).min((T_SHELF - te[i] as f64).max(0.0));
            te[i] = (te[i] as f64 + d) as f32;
            put += d * area[i];
        }
        lost = rem_tot - put;
    }
    // обрушение перегруженной коры
    {
        const T_COLLAPSE: f64 = 65.0;
        for _ in 0..40 {
            let mut moved = 0;
            for i in 0..nc {
                if te[i] as f64 <= T_COLLAPSE { continue; }
                let (xx, yy) = (i % w_, i / w_);
                let mut cand = [i; 4];
                let mut nc_ = 0;
                cand[nc_] = yy * w_ + (xx + 1) % w_; nc_ += 1;
                cand[nc_] = yy * w_ + (xx + w_ - 1) % w_; nc_ += 1;
                if yy > 0 { cand[nc_] = i - w_; nc_ += 1; }
                if yy < h_ - 1 { cand[nc_] = i + w_; nc_ += 1; }
                let (mut j, mut lo) = (usize::MAX, te[i]);
                for &q in &cand[..nc_] {
                    if te[q] < lo { lo = te[q]; j = q; }
                }
                if j == usize::MAX { continue; }
                let dv = (te[i] as f64 - (lo as f64).max(T_COLLAPSE * 0.7)) * 0.35;
                if dv <= 0.0 { continue; }
                te[i] = (te[i] as f64 - dv) as f32;
                te[j] = (te[j] as f64 + dv * area[i] / area[j]) as f32;
                moved += 1;
            }
            if moved == 0 { break; }
        }
    }
    // изостазия и уровень моря из объёма воды
    let av = blur_y(&blur_x(&age_v, w_, h_, 2), w_, h_, 2);
    let aw = blur_y(&blur_x(&age_w, w_, h_, 2), w_, h_, 2);
    let age_s: Vec<f32> = (0..nc).map(|i| if aw[i] > 0.05 { ((AGE_MAX * 1.5).min((av[i] / aw[i]) as f64)) as f32 } else { AGE_MAX as f32 }).collect();
    let elev: Vec<f32> = (0..nc)
        .map(|i| (isostasy(te[i] as f64) + SUBSIDE * (AGE_REF.sqrt() - (AGE_MAX * 1.5).min(age_s[i] as f64).sqrt()) * (1.0 - smooth(2.0, 12.0, te[i] as f64))) as f32)
        .collect();
    let v_water = opt.water_depth_km * 4.0 * PI;
    let (mut lo, mut hi) = (-8.0f64, 14.0f64);
    for _ in 0..60 {
        let m = (lo + hi) / 2.0;
        let mut v = 0f64;
        for i in 0..nc { if (elev[i] as f64) < m { v += (m - elev[i] as f64) * area[i]; } }
        if v > v_water { hi = m; } else { lo = m; }
    }
    let sea_level = (lo + hi) / 2.0;
    let mut elevation = vec![0f32; nc];
    let mut land_area = 0f64;
    for i in 0..nc {
        elevation[i] = (elev[i] as f64 - sea_level) as f32;
        if elevation[i] > 0.0 { land_area += area[i]; }
    }
    let former_sea: f64 = (0..nc).filter(|&i| elevation[i] > 0.0 && sed_grid[i] > 0.05).map(|i| area[i]).sum();
    let tot1: f64 = (0..nc).map(|i| te[i] as f64 * area[i]).sum();
    Ok(World {
        w: w_, h: h_, thickness: te, thickness_before_erosion: t, elevation_km: elevation, sea_level_km: sea_level, cell_area: area,
        ocean_age_myr: age_s, submerged_myr: sub_grid, marine_sediment_km: sed_grid, sea_level_history_km: sea_hist, t_oro_myr: t_oro_grid,
        stats: Stats {
            land_fraction: land_area / (4.0 * PI),
            land_with_marine_sediment_fraction: if land_area > 0.0 { former_sea / land_area } else { 0.0 },
            point_volume_start: volume0, point_volume_end: volume1, arc_added_volume: arc_added, hotspot_added_volume: hot_added,
            crust_volume_before_erosion: tot0, crust_volume_after_erosion: tot1, sediment_lost_volume: lost, points: n, epochs: n_epochs, time,
        },
        history: epochs,
        hotspots: hots.iter().map(|h| Hotspot { x: h.x, y: h.y, z: h.z, from_myr: jsround(h.t0), to_myr: jsround(h.t1), strength: h.s }).collect(),
        cratons: crat.len(),
    })
}
