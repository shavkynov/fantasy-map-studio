//! Равнопромежуточная сферическая сетка и быстрые O(N) операции над полями.

use std::f64::consts::{PI, TAU};

/// Равнопромежуточная сферическая сетка `w × h` на сфере радиуса `radius_km`.
/// Долгота периодична по оси X (`0 ↔ w - 1`), широта от `+90°` (`y = 0`) до `-90°` (`y = h - 1`).
#[derive(Clone, Debug)]
pub struct Grid {
    pub w: usize,
    pub h: usize,
    pub radius_km: f64,
}

impl Grid {
    /// Создаёт сетку с проверкой ненулевых размеров.
    pub fn new(w: usize, h: usize, radius_km: f64) -> Self {
        assert!(w > 0 && h > 0 && radius_km > 0.0);
        Self { w, h, radius_km }
    }

    #[inline]
    pub fn len(&self) -> usize {
        self.w * self.h
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.w == 0 || self.h == 0
    }

    #[inline]
    pub fn idx(&self, x: usize, y: usize) -> usize {
        y * self.w + x
    }

    #[inline]
    pub fn xy(&self, idx: usize) -> (usize, usize) {
        (idx % self.w, idx / self.w)
    }

    #[inline]
    pub fn wrap_x(&self, x: isize) -> usize {
        x.rem_euclid(self.w as isize) as usize
    }

    #[inline]
    pub fn lat_rad(&self, y: usize) -> f64 {
        PI * 0.5 - (y as f64 + 0.5) * PI / self.h as f64
    }

    #[inline]
    pub fn lat_deg(&self, y: usize) -> f64 {
        self.lat_rad(y).to_degrees()
    }

    #[inline]
    pub fn lon_rad(&self, x: usize) -> f64 {
        ((x as f64 + 0.5) / self.w as f64 - 0.5) * TAU
    }

    #[inline]
    pub fn lon_deg(&self, x: usize) -> f64 {
        self.lon_rad(x).to_degrees()
    }

    /// Единичный вектор на сфере для центра ячейки `(x, y)`.
    #[inline]
    pub fn unit_vec(&self, x: usize, y: usize) -> [f64; 3] {
        self.unit_vec_f(x as f64, y as f64)
    }

    /// Единичный вектор на сфере для произвольных дробных координат `(x, y)`.
    #[inline]
    pub fn unit_vec_f(&self, x: f64, y: f64) -> [f64; 3] {
        let lon = ((x + 0.5) / self.w as f64 - 0.5) * TAU;
        let lat = (PI * 0.5 - (y + 0.5) * PI / self.h as f64).clamp(-PI * 0.5, PI * 0.5);
        let cl = lat.cos();
        [cl * lon.cos(), cl * lon.sin(), lat.sin()]
    }

    /// Геодезическое расстояние (по дуге большого круга) в км между единичными векторами.
    #[inline]
    pub fn spherical_dist_km(&self, a: [f64; 3], b: [f64; 3]) -> f64 {
        let d = (a[0] * b[0] + a[1] * b[1] + a[2] * b[2]).clamp(-1.0, 1.0);
        d.acos() * self.radius_km
    }

    /// Площадь ячейки в строке `y`, км².
    #[inline]
    pub fn cell_area_km2(&self, y: usize) -> f64 {
        let lat0 = PI * 0.5 - y as f64 * PI / self.h as f64;
        let lat1 = PI * 0.5 - (y + 1) as f64 * PI / self.h as f64;
        (TAU / self.w as f64) * (lat0.sin() - lat1.sin()) * self.radius_km * self.radius_km
    }

    /// Шаг сетки по меридиану, км.
    #[inline]
    pub fn dy_km(&self) -> f64 {
        PI * self.radius_km / self.h as f64
    }

    /// Шаг сетки по параллели в строке `y`, км (с защитой от вырождения у полюсов).
    #[inline]
    pub fn dx_km(&self, y: usize) -> f64 {
        (TAU * self.radius_km / self.w as f64) * self.lat_rad(y).cos().max(0.02)
    }

    /// 4-связные соседи ячейки `idx` (с замыканием по долготе).
    #[inline]
    pub fn neighbors4(&self, idx: usize) -> ([usize; 4], usize) {
        let x = idx % self.w;
        let y = idx / self.w;
        let mut out = [0usize; 4];
        let mut n = 0;
        let xl = if x == 0 { self.w - 1 } else { x - 1 };
        let xr = if x + 1 == self.w { 0 } else { x + 1 };
        out[n] = y * self.w + xl;
        n += 1;
        if self.w > 1 {
            out[n] = y * self.w + xr;
            n += 1;
        }
        if y > 0 {
            out[n] = (y - 1) * self.w + x;
            n += 1;
        }
        if y + 1 < self.h {
            out[n] = (y + 1) * self.w + x;
            n += 1;
        }
        (out, n)
    }

    /// 8-связные соседи ячейки `idx` (с замыканием по долготе).
    #[inline]
    pub fn neighbors8(&self, idx: usize) -> ([usize; 8], usize) {
        let x = idx % self.w;
        let y = idx / self.w;
        let mut out = [0usize; 8];
        let mut n = 0;
        let xl = if x == 0 { self.w - 1 } else { x - 1 };
        let xr = if x + 1 == self.w { 0 } else { x + 1 };
        let y0 = y.saturating_sub(1);
        let y1 = (y + 1).min(self.h - 1);
        for yy in y0..=y1 {
            for &xx in &[xl, x, xr] {
                let nb = yy * self.w + xx;
                if nb != idx {
                    out[n] = nb;
                    n += 1;
                }
            }
        }
        (out, n)
    }
}

/// Быстрое разделимое размытие окна `2*radius+1`: периодичное по X и зажатое по Y.
pub fn blur_xwrap(field: &mut [f32], w: usize, h: usize, radius: usize) {
    if radius == 0 || w == 0 || h == 0 {
        return;
    }
    let mut tmp = vec![0f32; w * h];
    let k = (2 * radius + 1) as f64;
    let r = radius as isize;
    for y in 0..h {
        let row = y * w;
        let mut sum = 0.0f64;
        for dx in -r..=r {
            let xx = dx.rem_euclid(w as isize) as usize;
            sum += field[row + xx] as f64;
        }
        for x in 0..w {
            tmp[row + x] = (sum / k) as f32;
            let x_add = (x as isize + r + 1).rem_euclid(w as isize) as usize;
            let x_sub = (x as isize - r).rem_euclid(w as isize) as usize;
            sum += field[row + x_add] as f64 - field[row + x_sub] as f64;
        }
    }
    for x in 0..w {
        let mut sum = 0.0f64;
        for dy in -r..=r {
            let yy = dy.clamp(0, h as isize - 1) as usize;
            sum += tmp[yy * w + x] as f64;
        }
        for y in 0..h {
            field[y * w + x] = (sum / k) as f32;
            let y_add = (y as isize + r + 1).clamp(0, h as isize - 1) as usize;
            let y_sub = (y as isize - r).clamp(0, h as isize - 1) as usize;
            sum += tmp[y_add * w + x] as f64 - tmp[y_sub * w + x] as f64;
        }
    }
}

/// Расстояние по поверхности сферы (приближение фаской, км) до клеток с `mask[i] != 0`.
/// Выполняет 2 прохода вперёд-назад с замыканием по долготе X (`0 ↔ w - 1`).
pub fn distance_to_mask_km(mask: &[u8], grid: &Grid) -> Vec<f32> {
    let n = grid.len();
    let inf = 1e9f32;
    let mut d = vec![inf; n];
    for i in 0..n {
        if mask[i] != 0 {
            d[i] = 0.0;
        }
    }
    let w = grid.w;
    let h = grid.h;
    let dy = grid.dy_km() as f32;
    let dx_row: Vec<f32> = (0..h).map(|y| grid.dx_km(y) as f32).collect();
    let diag_row: Vec<f32> = dx_row.iter().map(|&dx| dx.hypot(dy)).collect();

    for _pass in 0..2 {
        for y in 0..h {
            let dx = dx_row[y];
            let dg = diag_row[y];
            let row = y * w;
            for x in 0..w {
                let i = row + x;
                let mut v = d[i];
                let xl = if x == 0 { w - 1 } else { x - 1 };
                v = v.min(d[row + xl] + dx);
                if y > 0 {
                    let prev = (y - 1) * w;
                    let xr = if x + 1 == w { 0 } else { x + 1 };
                    v = v.min(d[prev + x] + dy);
                    v = v.min(d[prev + xl] + dg);
                    v = v.min(d[prev + xr] + dg);
                }
                d[i] = v;
            }
            for x in (0..w).rev() {
                let i = row + x;
                let xr = if x + 1 == w { 0 } else { x + 1 };
                let v = d[i].min(d[row + xr] + dx);
                d[i] = v;
            }
        }
        for y in (0..h).rev() {
            let dx = dx_row[y];
            let dg = diag_row[y];
            let row = y * w;
            for x in (0..w).rev() {
                let i = row + x;
                let mut v = d[i];
                let xr = if x + 1 == w { 0 } else { x + 1 };
                v = v.min(d[row + xr] + dx);
                if y + 1 < h {
                    let next = (y + 1) * w;
                    let xl = if x == 0 { w - 1 } else { x - 1 };
                    v = v.min(d[next + x] + dy);
                    v = v.min(d[next + xr] + dg);
                    v = v.min(d[next + xl] + dg);
                }
                d[i] = v;
            }
            for x in 0..w {
                let i = row + x;
                let xl = if x == 0 { w - 1 } else { x - 1 };
                d[i] = d[i].min(d[row + xl] + dx);
            }
        }
    }
    d
}

/// Безразмерный уклон поверхности (`|∇h| = hypot(dh/dx, dh/dy)`) с замыканием по долготе X.
pub fn slope_field(height_km: &[f32], grid: &Grid) -> Vec<f32> {
    let w = grid.w;
    let h = grid.h;
    let mut out = vec![0f32; w * h];
    let dy = grid.dy_km() as f32;
    for y in 0..h {
        let dx = grid.dx_km(y) as f32;
        let row = y * w;
        let y0 = y.saturating_sub(1);
        let y1 = (y + 1).min(h - 1);
        let span_y = ((y1 - y0).max(1) as f32) * dy;
        for x in 0..w {
            let xl = if x == 0 { w - 1 } else { x - 1 };
            let xr = if x + 1 == w { 0 } else { x + 1 };
            let gx = (height_km[row + xr] - height_km[row + xl]) / (2.0 * dx);
            let gy = (height_km[y1 * w + x] - height_km[y0 * w + x]) / span_y;
            out[row + x] = gx.hypot(gy);
        }
    }
    out
}
