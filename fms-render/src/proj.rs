//! Изотропная цилиндрическая проекция Паттерсона без разрезания континентов и региональная проекция.

use fms_core::geography::LandmassKind;
use fms_core::planet::Planet;
use fms_core::region::{Region, RegionOptions};
use std::f64::consts::PI;

#[inline]
pub fn wrap_lon_deg(lon: f64) -> f64 {
    (lon + 540.0).rem_euclid(360.0) - 180.0
}

#[inline]
pub fn patterson_y(phi_rad: f64) -> f64 {
    const C1: f64 = 1.0148;
    const C5: f64 = 0.23185;
    const C7: f64 = -0.14499;
    const C9: f64 = 0.02406;
    let p2 = phi_rad * phi_rad;
    let p4 = p2 * p2;
    let p6 = p4 * p2;
    let p8 = p4 * p4;
    phi_rad * (C1 + p4 * C5 + p6 * C7 + p8 * C9)
}

pub fn patterson_phi(y: f64) -> Option<f64> {
    const MAX_Y: f64 = 1.790857183;
    if y.abs() > MAX_Y {
        return None;
    }
    let mut phi = (y / 1.08).clamp(-PI * 0.5, PI * 0.5);
    for _ in 0..8 {
        let p2 = phi * phi;
        let p4 = p2 * p2;
        let p6 = p4 * p2;
        let p8 = p4 * p4;
        let f = patterson_y(phi) - y;
        let df = 1.0148 + 5.0 * 0.23185 * p4 + 7.0 * (-0.14499) * p6 + 9.0 * 0.02406 * p8;
        phi -= f / df;
    }
    Some(phi.clamp(-PI * 0.5, PI * 0.5))
}

/// Подбирает океанический меридиан разреза: приоритет — чистое окно без материков, иначе минимум взвешенного пересечения суши.
pub fn find_optimal_seam_lon(planet: &Planet) -> f64 {
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let n_bins = 720usize;
    let mut cont_hit = vec![false; n_bins];
    let mut land_cost = vec![0.0f64; n_bins];
    for y in 0..gh {
        let cos_lat = planet.grid.lat_rad(y).cos().max(0.05);
        for x in 0..gw {
            let i = y * gw + x;
            if planet.hydrology.is_ocean[i] != 0 {
                continue;
            }
            let lon = planet.grid.lon_deg(x);
            let b = (((lon + 180.0).rem_euclid(360.0) / 360.0) * n_bins as f64).floor() as usize % n_bins;
            let lid = planet.geography.landmass_id[i];
            let kind = if lid >= 0 {
                planet
                    .geography
                    .landmasses
                    .get(lid as usize)
                    .map(|l| l.kind)
                    .unwrap_or(LandmassKind::Island)
            } else {
                LandmassKind::Island
            };
            match kind {
                LandmassKind::Continent => {
                    cont_hit[b] = true;
                    land_cost[b] += 12.0 * cos_lat;
                }
                LandmassKind::LargeIsland => {
                    land_cost[b] += 2.5 * cos_lat;
                }
                LandmassKind::Island => {
                    land_cost[b] += 0.4 * cos_lat;
                }
            }
        }
    }

    let mut best_len = 0usize;
    let mut best_mid = 180.0f64;
    let mut run = 0usize;
    for k in 0..(n_bins * 2) {
        if !cont_hit[k % n_bins] {
            run += 1;
            if run > best_len && run <= n_bins {
                best_len = run;
                let end_bin = (k % n_bins) as f64 + 0.5;
                let mid_bin = end_bin - 0.5 * run as f64;
                best_mid = wrap_lon_deg((mid_bin.rem_euclid(n_bins as f64) / n_bins as f64) * 360.0 - 180.0);
            }
        } else {
            run = 0;
        }
    }
    if best_len >= 6 {
        return best_mid;
    }

    let mut best_cost = f64::INFINITY;
    let mut best_bin = 0usize;
    for b in 0..n_bins {
        let mut s = 0.0f64;
        for d in -10isize..=10isize {
            let idx = (b as isize + d).rem_euclid(n_bins as isize) as usize;
            let wgt = (11 - d.abs()) as f64;
            s += land_cost[idx] * wgt;
        }
        if s < best_cost {
            best_cost = s;
            best_bin = b;
        }
    }
    wrap_lon_deg(((best_bin as f64 + 0.5) / n_bins as f64) * 360.0 - 180.0)
}

/// Проекция карты мира без искажений (вписывает все материки целиком при `scale_x == scale_y`).
pub struct WorldProj {
    pub canvas_w: usize,
    pub canvas_h: usize,
    pub frame: [f64; 4],
    pub seam_lon_deg: f64,
    pub center_lon_deg: f64,
    pub px_per_unit: f64,
    pub origin_x_rad: f64,
    pub origin_y_pat: f64,
}

impl WorldProj {
    pub fn fit(planet: &Planet, target_w: usize) -> Self {
        let seam_lon_deg = find_optimal_seam_lon(planet);
        let center_lon_deg = wrap_lon_deg(seam_lon_deg + 180.0);

        let mut min_x = PI;
        let mut max_x = -PI;
        let mut min_y = 2.0f64;
        let mut max_y = -2.0f64;
        let gw = planet.grid.w;
        let gh = planet.grid.h;
        for y in 0..gh {
            let lat_r = planet.grid.lat_rad(y);
            let yp = patterson_y(lat_r);
            for x in 0..gw {
                if planet.hydrology.is_ocean[y * gw + x] != 0 {
                    continue;
                }
                let xr = wrap_lon_deg(planet.grid.lon_deg(x) - center_lon_deg).to_radians();
                min_x = min_x.min(xr);
                max_x = max_x.max(xr);
                min_y = min_y.min(yp);
                max_y = max_y.max(yp);
            }
        }
        let max_y_pat = patterson_y(PI * 0.5);
        let pad_x_rad = 14.0f64.to_radians();
        let pad_y_pat = 10.0f64.to_radians();
        let min_x_rad = (min_x - pad_x_rad).max(-PI);
        let max_x_rad = (max_x + pad_x_rad).min(PI);
        let min_y_pat = (min_y - pad_y_pat).max(-max_y_pat);
        let max_y_pat_w = (max_y + pad_y_pat).min(max_y_pat);

        let span_x_rad = (max_x_rad - min_x_rad).max(1.0);
        let span_y_pat = (max_y_pat_w - min_y_pat).max(1.0);
        let mid_x_rad = 0.5 * (min_x_rad + max_x_rad);
        let mid_y_pat = 0.5 * (min_y_pat + max_y_pat_w);

        let k_s = target_w as f64 / 2200.0;
        let pad_x = (72.0 * k_s).round().max(24.0);
        let pad_top = (72.0 * k_s).round().max(24.0);
        let pad_bot = (64.0 * k_s).round().max(20.0);
        let canvas_w = target_w.max(320);
        let inner_w = canvas_w as f64 - 2.0 * pad_x;
        let min_inner_h = (inner_w * 0.44).round();
        let max_inner_h = (inner_w * (max_y_pat / PI)).floor().max(min_inner_h);

        let px_per_unit_w = (inner_w / span_x_rad).max(inner_w / (2.0 * PI));
        let inner_h_fit = (span_y_pat * px_per_unit_w).round();
        let inner_h_pre = inner_h_fit.clamp(min_inner_h, max_inner_h);
        let px_per_unit = px_per_unit_w
            .min(inner_h_pre / span_y_pat)
            .max(inner_w / (2.0 * PI))
            .max(inner_h_pre / (2.0 * max_y_pat));
        let inner_h = (span_y_pat * px_per_unit).round().clamp(min_inner_h, max_inner_h);
        let px_per_unit = px_per_unit.max(inner_h / (2.0 * max_y_pat));
        let canvas_h = (pad_top + inner_h + pad_bot).round() as usize;

        let half_w_rad = (0.5 * inner_w / px_per_unit).min(PI);
        let origin_x_rad = mid_x_rad.clamp(-PI + half_w_rad, PI - half_w_rad);
        let half_h_pat = (0.5 * inner_h / px_per_unit).min(max_y_pat);
        let origin_y_pat = mid_y_pat.clamp(-max_y_pat + half_h_pat, max_y_pat - half_h_pat);

        Self {
            canvas_w,
            canvas_h,
            frame: [pad_x, pad_top, inner_w, inner_h],
            seam_lon_deg,
            center_lon_deg,
            px_per_unit,
            origin_x_rad,
            origin_y_pat,
        }
    }

    #[inline]
    pub fn project(&self, lat_deg: f64, lon_deg: f64) -> [f64; 2] {
        let dlon_rad = wrap_lon_deg(lon_deg - self.center_lon_deg).to_radians();
        let y_pat = patterson_y(lat_deg.to_radians());
        let cx = self.frame[0] + self.frame[2] * 0.5;
        let cy = self.frame[1] + self.frame[3] * 0.5;
        [
            cx + (dlon_rad - self.origin_x_rad) * self.px_per_unit,
            cy - (y_pat - self.origin_y_pat) * self.px_per_unit,
        ]
    }

    #[inline]
    pub fn inverse(&self, px: f64, py: f64) -> Option<(f64, f64)> {
        if px < self.frame[0]
            || px > self.frame[0] + self.frame[2]
            || py < self.frame[1]
            || py > self.frame[1] + self.frame[3]
        {
            return None;
        }
        let cx = self.frame[0] + self.frame[2] * 0.5;
        let cy = self.frame[1] + self.frame[3] * 0.5;
        let x_rad = self.origin_x_rad + (px - cx) / self.px_per_unit;
        if x_rad.abs() > PI {
            return None;
        }
        let y_pat = self.origin_y_pat + (cy - py) / self.px_per_unit;
        let phi = patterson_phi(y_pat)?;
        Some((phi.to_degrees(), wrap_lon_deg(self.center_lon_deg + x_rad.to_degrees())))
    }
}

/// Проекция регионального окна.
pub struct RegionProj {
    pub canvas_w: usize,
    pub canvas_h: usize,
    pub frame: [f64; 4],
    pub center_lon_deg: f64,
    pub lon_min_deg: f64,
    pub lat_min_deg: f64,
    pub lat_max_deg: f64,
    pub span_lon_deg: f64,
    pub reg_w: usize,
    pub reg_h: usize,
}

impl RegionProj {
    pub fn new(reg: &Region, opt: &RegionOptions, target_w: usize) -> Self {
        let k_s = target_w as f64 / 1680.0;
        let pad_x = (72.0 * k_s).round().max(24.0);
        let pad_top = (72.0 * k_s).round().max(24.0);
        let pad_bot = (64.0 * k_s).round().max(20.0);
        let canvas_w = target_w.max(320);
        let map_w = canvas_w as f64 - 2.0 * pad_x;
        let lat_span = (reg.lat_max_deg - reg.lat_min_deg).max(1e-6);
        let cos_mid = reg.center_lat_deg.to_radians().cos().abs().max(0.25);
        let map_h = (map_w * lat_span / (opt.span_lon_deg * cos_mid))
            .round()
            .clamp((map_w * 0.44).round(), (map_w * 0.80).round());
        let canvas_h = (pad_top + map_h + pad_bot).round() as usize;
        Self {
            canvas_w,
            canvas_h,
            frame: [pad_x, pad_top, map_w, map_h],
            center_lon_deg: reg.center_lon_deg,
            lon_min_deg: reg.lon_min_deg,
            lat_min_deg: reg.lat_min_deg,
            lat_max_deg: reg.lat_max_deg,
            span_lon_deg: opt.span_lon_deg,
            reg_w: reg.w,
            reg_h: reg.h,
        }
    }

    #[inline]
    pub fn project_cell(&self, rx: f64, ry: f64) -> [f64; 2] {
        [
            self.frame[0] + (rx / self.reg_w as f64) * self.frame[2],
            self.frame[1] + (ry / self.reg_h as f64) * self.frame[3],
        ]
    }

    #[inline]
    pub fn project_lat_lon(&self, lat_deg: f64, lon_deg: f64) -> Option<[f64; 2]> {
        let dlon = wrap_lon_deg(lon_deg - self.center_lon_deg);
        let half_lon = 0.5 * self.span_lon_deg;
        if dlon.abs() > half_lon || lat_deg < self.lat_min_deg || lat_deg > self.lat_max_deg {
            return None;
        }
        let fx = (dlon + half_lon) / self.span_lon_deg;
        let fy = (self.lat_max_deg - lat_deg) / (self.lat_max_deg - self.lat_min_deg).max(1e-9);
        Some([self.frame[0] + fx * self.frame[2], self.frame[1] + fy * self.frame[3]])
    }

    #[inline]
    pub fn inverse(&self, px: f64, py: f64) -> Option<(f64, f64)> {
        let [fx0, fy0, fw, fh] = self.frame;
        if px < fx0 || px > fx0 + fw || py < fy0 || py > fy0 + fh {
            return None;
        }
        let fx = (px - fx0) / fw;
        let fy = (py - fy0) / fh;
        let lat_deg = self.lat_max_deg - fy * (self.lat_max_deg - self.lat_min_deg);
        let lon_deg = wrap_lon_deg(self.lon_min_deg + fx * self.span_lon_deg);
        Some((lat_deg, lon_deg))
    }
}
