//! Тайлы крупного плана для «бесконечного» зума: куски мировой карты в координатах `WorldProj`.
//!
//! Всё, что видно на тайле (шум берега, зерно бумаги, значки, реки), вычисляется из мировых
//! координат, поэтому соседние тайлы стыкуются без швов, а при приближении появляются новые детали.

use crate::classic::{biome_tint, classic_biome_code, hyps_color, theme_of, ClassicTheme};
use crate::png::encode_png_rgb;
use crate::proj::WorldProj;
use crate::terrain::{plains_shift_km, Style};
use fms_core::planet::Planet;
use fms_core::rng::{Noise, Rng};

pub const TILE_SIZE: usize = 256;
pub const MAX_TILE_LEVEL: u32 = 7;
/// Ширина мирового холста, в единицах которого заданы тайлы (как у обзорной карты студии).
pub const TILE_WORLD_WIDTH: usize = 2200;

/// Запас вокруг тайла: не меньше дальности прибрежной тушёвки и половины самого крупного значка.
const PAD: usize = 40;
const SHORE: f32 = 36.0;
const LATTICE: i64 = 22;

struct Sampler<'a> {
    planet: &'a Planet,
    noise: Noise,
    shift: f64,
    /// Знаковая «суша/вода» по ячейкам: плавный нулевой уровень даёт берег без ступенек.
    coast: Vec<f32>,
    octaves: u32,
}

/// Четыре соседние ячейки сетки и их веса.
type Corners = [(usize, f64); 4];

impl<'a> Sampler<'a> {
    fn new(planet: &'a Planet, level: u32) -> Self {
        let coast = (0..planet.grid.len())
            .map(|i| {
                let e = planet.erosion.elevation_km[i];
                if planet.hydrology.is_ocean[i] != 0 {
                    e.clamp(-0.35, -0.08)
                } else {
                    e.clamp(0.08, 0.35)
                }
            })
            .collect();
        Self {
            planet,
            noise: Noise::new(&mut Rng::new(&format!("{}|tiles", planet.seed))),
            shift: plains_shift_km(planet),
            coast,
            octaves: 3 + level,
        }
    }

    fn corners(&self, lat: f64, lon: f64) -> Corners {
        let (w, h) = (self.planet.grid.w, self.planet.grid.h);
        let x = (lon + 180.0).rem_euclid(360.0) / 360.0 * w as f64 - 0.5;
        let y = ((90.0 - lat) / 180.0 * h as f64 - 0.5).clamp(0.0, (h - 1) as f64);
        let (x0, y0) = (x.floor(), y.floor());
        let (tx, ty) = (x - x0, y - y0);
        let xa = (x0 as isize).rem_euclid(w as isize) as usize;
        let xb = (xa + 1) % w;
        let ya = y0 as usize;
        let yb = (ya + 1).min(h - 1);
        [
            (ya * w + xa, (1.0 - tx) * (1.0 - ty)),
            (ya * w + xb, tx * (1.0 - ty)),
            (yb * w + xa, (1.0 - tx) * ty),
            (yb * w + xb, tx * ty),
        ]
    }

    /// Фрактальный шум на сфере. Новые октавы только добавляют мелочь и не сдвигают крупные формы.
    fn fbm(&self, p: [f64; 3], base: f64, octaves: u32, seed_shift: f64) -> f64 {
        let (mut sum, mut amp, mut f) = (0.0, 0.5, base);
        for _ in 0..octaves {
            sum += amp * self.noise.get(p[0] * f + seed_shift, p[1] * f, p[2] * f);
            amp *= 0.55;
            f *= 2.03;
        }
        sum
    }

    /// `> 0` — суша.
    fn land(&self, p: [f64; 3], c: &Corners) -> f64 {
        let mut v = 0.0;
        let mut ocean = 0.0;
        for &(i, wt) in c {
            v += self.coast[i] as f64 * wt;
            ocean += self.planet.hydrology.is_ocean[i] as f64 * wt;
        }
        // Вдали от берега шум не может изменить знак — не тратим на него время.
        if ocean == 0.0 || ocean == 1.0 {
            return v;
        }
        v + 0.22 * self.fbm(p, 45.0, self.octaves, 0.0)
    }

    fn field(&self, arr: &[f32], c: &Corners) -> f64 {
        c.iter().map(|&(i, wt)| arr[i] as f64 * wt).sum()
    }

    /// Высота ячеек с бикубической (Catmull-Rom) интерполяцией: уклон непрерывен, без «клеток».
    fn elevation(&self, lat: f64, lon: f64) -> f64 {
        let (w, h) = (self.planet.grid.w as isize, self.planet.grid.h as isize);
        let x = (lon + 180.0).rem_euclid(360.0) / 360.0 * w as f64 - 0.5;
        let y = (90.0 - lat) / 180.0 * h as f64 - 0.5;
        let (x0, y0) = (x.floor(), y.floor());
        let weights = |t: f64| {
            let (t2, t3) = (t * t, t * t * t);
            [
                0.5 * (-t3 + 2.0 * t2 - t),
                0.5 * (3.0 * t3 - 5.0 * t2 + 2.0),
                0.5 * (-3.0 * t3 + 4.0 * t2 + t),
                0.5 * (t3 - t2),
            ]
        };
        let (wx, wy) = (weights(x - x0), weights(y - y0));
        let mut sum = 0.0;
        for (j, wj) in wy.iter().enumerate() {
            let row = (y0 as isize + j as isize - 1).clamp(0, h - 1);
            for (i, wi) in wx.iter().enumerate() {
                let col = (x0 as isize + i as isize - 1).rem_euclid(w);
                sum += wi * wj * self.planet.erosion.elevation_km[(row * w + col) as usize] as f64;
            }
        }
        sum
    }

    /// Высота в шкале классического рендера (0 — берег, ~1.8 — высочайшие вершины).
    fn height(&self, p: [f64; 3], lat: f64, lon: f64) -> f64 {
        let e = self.elevation(lat, lon);
        let e_rel = (e - self.shift).max(0.02);
        let rough = 0.05 + 0.12 * e_rel.min(1.5);
        ((e_rel + rough * self.fbm(p, 70.0, self.octaves, 31.7)) * 0.56 + 0.04).clamp(0.02, 1.85)
    }

    fn nearest(c: &Corners) -> usize {
        c.iter().fold(c[0], |a, &b| if b.1 > a.1 { b } else { a }).0
    }

    fn is_lake(&self, p: [f64; 3], c: &Corners) -> bool {
        let v: f64 = c.iter().map(|&(i, wt)| self.planet.hydrology.is_lake[i] as f64 * wt).sum();
        v > 0.0 && v + 0.35 * self.fbm(p, 90.0, self.octaves.min(7), 57.1) > 0.5
    }
}

/// Перевод глобальных пикселей уровня в широту/долготу и точку на единичной сфере.
struct Frame {
    proj: WorldProj,
    px_per_unit: f64,
}

impl Frame {
    fn unit_x(&self, gx: f64) -> f64 {
        let [fx, _, fw, _] = self.proj.frame;
        (fx + gx / self.px_per_unit).clamp(fx + 1e-4, fx + fw - 1e-4)
    }
    fn unit_y(&self, gy: f64) -> f64 {
        let [_, fy, _, fh] = self.proj.frame;
        (fy + gy / self.px_per_unit).clamp(fy + 1e-4, fy + fh - 1e-4)
    }
    fn lat(&self, gy: f64) -> f64 {
        let mid = self.proj.frame[0] + self.proj.frame[2] * 0.5;
        self.proj.inverse(mid, self.unit_y(gy)).map_or(0.0, |p| p.0)
    }
    fn lon(&self, gx: f64) -> f64 {
        let mid = self.proj.frame[1] + self.proj.frame[3] * 0.5;
        self.proj.inverse(self.unit_x(gx), mid).map_or(0.0, |p| p.1)
    }
}

fn sphere(lat: f64, lon: f64) -> [f64; 3] {
    let (a, o) = (lat.to_radians(), lon.to_radians());
    [a.cos() * o.cos(), a.cos() * o.sin(), a.sin()]
}

fn hash(a: i64, b: i64, c: u64) -> u64 {
    let mut h = (a as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15)
        ^ (b as u64).wrapping_mul(0xC2B2_AE3D_27D4_EB4F)
        ^ c.wrapping_mul(0x1656_67B1_9E37_79F9);
    h ^= h >> 31;
    h = h.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    h ^ (h >> 29)
}

fn unit(h: u64, k: u32) -> f64 {
    ((h >> (k * 10)) & 1023) as f64 / 1023.0
}

fn mix(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    let t = t.clamp(0.0, 1.0);
    [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

/// Буфер тайла с запасом по краям.
struct Canvas {
    side: usize,
    rgb: Vec<[f64; 3]>,
    /// Если задана, рисуем только там, где маска истинна.
    clip: Option<Vec<bool>>,
}

impl Canvas {
    fn blend(&mut self, x: i64, y: i64, color: [f64; 3], a: f64) {
        if x < 0 || y < 0 || x >= self.side as i64 || y >= self.side as i64 || a <= 0.0 {
            return;
        }
        let i = y as usize * self.side + x as usize;
        if self.clip.as_ref().is_some_and(|m| !m[i]) {
            return;
        }
        self.rgb[i] = mix(self.rgb[i], color, a);
    }

    /// Сглаженный отрезок толщиной `w`.
    fn line(&mut self, a: [f64; 2], b: [f64; 2], w: f64, color: [f64; 3], alpha: f64) {
        let r = w * 0.5 + 1.0;
        let x0 = (a[0].min(b[0]) - r).floor().max(0.0) as i64;
        let x1 = (a[0].max(b[0]) + r).ceil().min(self.side as f64 - 1.0) as i64;
        let y0 = (a[1].min(b[1]) - r).floor().max(0.0) as i64;
        let y1 = (a[1].max(b[1]) + r).ceil().min(self.side as f64 - 1.0) as i64;
        let (dx, dy) = (b[0] - a[0], b[1] - a[1]);
        let len2 = (dx * dx + dy * dy).max(1e-9);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (px, py) = (x as f64 + 0.5 - a[0], y as f64 + 0.5 - a[1]);
                let t = ((px * dx + py * dy) / len2).clamp(0.0, 1.0);
                let d = (px - t * dx).hypot(py - t * dy);
                self.blend(x, y, color, alpha * (w * 0.5 + 0.5 - d).clamp(0.0, 1.0));
            }
        }
    }

    fn path(&mut self, pts: &[[f64; 2]], w: f64, color: [f64; 3]) {
        for s in pts.windows(2) {
            self.line(s[0], s[1], w, color, 0.92);
        }
    }

    fn fill_triangle(&mut self, p: [[f64; 2]; 3], color: [f64; 3]) {
        let x0 = p.iter().map(|q| q[0]).fold(f64::MAX, f64::min).floor() as i64;
        let x1 = p.iter().map(|q| q[0]).fold(f64::MIN, f64::max).ceil() as i64;
        let y0 = p.iter().map(|q| q[1]).fold(f64::MAX, f64::min).floor() as i64;
        let y1 = p.iter().map(|q| q[1]).fold(f64::MIN, f64::max).ceil() as i64;
        let edge = |a: [f64; 2], b: [f64; 2], x: f64, y: f64| (b[0] - a[0]) * (y - a[1]) - (b[1] - a[1]) * (x - a[0]);
        for y in y0..=y1 {
            for x in x0..=x1 {
                let (cx, cy) = (x as f64 + 0.5, y as f64 + 0.5);
                let e = [edge(p[0], p[1], cx, cy), edge(p[1], p[2], cx, cy), edge(p[2], p[0], cx, cy)];
                if e.iter().all(|&v| v >= 0.0) || e.iter().all(|&v| v <= 0.0) {
                    self.blend(x, y, color, 1.0);
                }
            }
        }
    }
}

/// Расстояние (в пикселях, не дальше `SHORE`) до ближайшего пикселя с другим значением маски.
fn shore_distance(mask: &[bool], side: usize) -> Vec<f32> {
    let mut d = vec![SHORE; mask.len()];
    for y in 0..side {
        for x in 0..side {
            let i = y * side + x;
            if (x + 1 < side && mask[i] != mask[i + 1]) || (x > 0 && mask[i] != mask[i - 1])
                || (y + 1 < side && mask[i] != mask[i + side]) || (y > 0 && mask[i] != mask[i - side])
            {
                d[i] = 0.5;
            }
        }
    }
    // Двухпроходное шамферное преобразование расстояний.
    for backward in [false, true] {
        for k in 0..mask.len() {
            let i = if backward { mask.len() - 1 - k } else { k };
            let (x, y) = ((i % side) as isize, (i / side) as isize);
            let s = if backward { 1 } else { -1 };
            for (ox, oy, c) in [(s, 0, 1.0), (0, s, 1.0), (s, s, 1.414), (-s, s, 1.414)] {
                let (nx, ny) = (x + ox, y + oy);
                if nx >= 0 && ny >= 0 && nx < side as isize && ny < side as isize {
                    let v = d[ny as usize * side + nx as usize] + c;
                    if v < d[i] {
                        d[i] = v;
                    }
                }
            }
        }
    }
    d
}

/// Рендерит тайл `(level, tx, ty)`: 256×256 px, уровень `level` — `2^level` px на единицу холста.
pub fn render_tile_png(planet: &Planet, style: Style, level: u32, tx: u32, ty: u32) -> Result<Vec<u8>, String> {
    if level == 0 || level > MAX_TILE_LEVEL {
        return Err(format!("level: 1..={MAX_TILE_LEVEL}"));
    }
    let frame = Frame {
        proj: WorldProj::fit(planet, TILE_WORLD_WIDTH),
        px_per_unit: (1u32 << level) as f64,
    };
    let [_, _, fw, fh] = frame.proj.frame;
    if tx as f64 * TILE_SIZE as f64 >= fw * frame.px_per_unit || ty as f64 * TILE_SIZE as f64 >= fh * frame.px_per_unit {
        return Err("тайл вне карты".into());
    }
    let th = theme_of(style);
    let s = Sampler::new(planet, level);
    let side = TILE_SIZE + 2 * PAD;
    let ox = tx as i64 * TILE_SIZE as i64 - PAD as i64;
    let oy = ty as i64 * TILE_SIZE as i64 - PAD as i64;

    let lats: Vec<f64> = (0..side).map(|y| frame.lat((oy + y as i64) as f64 + 0.5)).collect();
    let lons: Vec<f64> = (0..side).map(|x| frame.lon((ox + x as i64) as f64 + 0.5)).collect();
    let mut land = vec![false; side * side];
    let mut lake = vec![false; side * side];
    let mut height = vec![0.0f64; side * side];
    for y in 0..side {
        for x in 0..side {
            let i = y * side + x;
            let p = sphere(lats[y], lons[x]);
            let c = s.corners(lats[y], lons[x]);
            if s.land(p, &c) > 0.0 {
                lake[i] = s.is_lake(p, &c);
                land[i] = !lake[i];
                if land[i] {
                    height[i] = s.height(p, lats[y], lons[x]);
                }
            }
        }
    }
    let dist = shore_distance(&land, side);

    let mut cv = Canvas { side, rgb: vec![[0.0; 3]; side * side], clip: None };
    for y in 0..side {
        let gy = oy + y as i64;
        for x in 0..side {
            let gx = ox + x as i64;
            let i = y * side + x;
            let c = s.corners(lats[y], lons[x]);
            let d = dist[i] as f64;
            let mut col = if land[i] {
                land_color(&s, &th, &c, height[i])
            } else {
                water_color(&th, d, lake[i])
            };
            if land[i] {
                // Северо-западная светотень по уклону.
                let (a, b) = (height[if x > 1 && y > 1 { i - 2 * side - 2 } else { i }], height[i]);
                let slope = if a > 0.0 { ((b - a) * 7.0 * (1u32 << level) as f64 / 4.0).clamp(-1.0, 1.0) } else { 0.0 };
                col = mix(col, if slope > 0.0 { [255.0, 252.0, 242.0] } else { th.ink }, slope.abs() * 0.22);
            } else if !lake[i] {
                let temp = s.field(&planet.climate.temp_c, &c);
                if temp < -9.5 {
                    col = mix(col, [236.0, 240.0, 242.0], (-9.5 - temp) / 3.0);
                }
                if th.hatch && d > 2.0 && d < 26.0 && gy.rem_euclid(5) == 0 && unit(hash(gx.div_euclid(17), gy, 3), 0) > 0.3 {
                    col = mix(col, th.ink, 0.30 * (1.0 - d / 26.0));
                }
                for k in 1..=th.halos as u32 {
                    let r = k as f64 * 4.5;
                    col = mix(col, th.ink, (0.9 - (d - r).abs()).max(0.0) * (0.55 - 0.12 * k as f64));
                }
            }
            if d < 1.6 {
                col = mix(col, th.coast_rgb, (1.7 - d).min(1.0) * 0.9);
            }
            let grain = unit(hash(gx, gy, 11), 0) - 0.5;
            let k = 1.0 + grain * th.grain;
            cv.rgb[i] = [col[0] * k, col[1] * k, col[2] * k];
        }
    }

    cv.clip = Some(land);
    draw_rivers(&mut cv, &s, &frame, &th, level, ox, oy);
    cv.clip = None;
    draw_symbols(&mut cv, &s, &frame, &th, level, ox, oy);

    let mut out = Vec::with_capacity(TILE_SIZE * TILE_SIZE * 3);
    for y in PAD..PAD + TILE_SIZE {
        for x in PAD..PAD + TILE_SIZE {
            out.extend(cv.rgb[y * side + x].map(|v| v.clamp(0.0, 255.0) as u8));
        }
    }
    Ok(encode_png_rgb(TILE_SIZE, TILE_SIZE, &out))
}

fn land_color(s: &Sampler, th: &ClassicTheme, c: &Corners, h: f64) -> [f64; 3] {
    if !th.is_color {
        return mix(th.paper, th.ink, (h - 0.3).max(0.0) * 0.07);
    }
    // Оттенок биома смешивается по четырём ячейкам, без квадратов.
    let mut col = [0.0; 3];
    for &(i, wt) in c {
        let mut v = hyps_color(h);
        if let Some((tint, t)) = biome_tint(classic_biome_code(s.planet.biomes.biome[i])) {
            if h < 1.1 {
                v = mix(v, tint, t);
            }
        }
        for k in 0..3 {
            col[k] += v[k] * wt;
        }
    }
    col
}

fn water_color(th: &ClassicTheme, d: f64, lake: bool) -> [f64; 3] {
    if lake {
        return if th.is_color { th.river_rgb } else { th.water_near };
    }
    mix(th.water_near, th.water_far, d / SHORE as f64)
}

fn draw_rivers(cv: &mut Canvas, s: &Sampler, frame: &Frame, th: &ClassicTheme, level: u32, ox: i64, oy: i64) {
    let planet = s.planet;
    let (gw, gh) = (planet.grid.w as f64, planet.grid.h as f64);
    let k = frame.px_per_unit;
    let [fx, fy, _, _] = frame.proj.frame;
    let side = cv.side as f64;
    // Чем ближе, тем больше видно мелких рек.
    let min_q = 1400.0 / (1u32 << level) as f32;
    for river in planet.hydrology.rivers.iter().filter(|r| r.max_discharge_m3s >= min_q) {
        let n = river.smoothed_pts.len();
        let q = (river.max_discharge_m3s as f64 / 18_000.0).sqrt().clamp(0.15, 1.0);
        let geo: Vec<[f64; 2]> = river
            .smoothed_pts
            .iter()
            .map(|p| {
                let lon = (p[0] as f64 / gw - 0.5) * 360.0;
                let lat = 90.0 - p[1] as f64 / gh * 180.0;
                let u = frame.proj.project(lat, lon);
                [(u[0] - fx) * k - ox as f64, (u[1] - fy) * k - oy as f64]
            })
            .collect();
        for (i, seg) in geo.windows(2).enumerate() {
            let (a, b) = (seg[0], seg[1]);
            let len = (b[0] - a[0]).hypot(b[1] - a[1]);
            let margin = len * 0.4 + 6.0;
            // Разрыв на краю проекции или отрезок вне тайла.
            if len > 60.0 * k
                || a[0].max(b[0]) < -margin || a[0].min(b[0]) > side + margin
                || a[1].max(b[1]) < -margin || a[1].min(b[1]) > side + margin
            {
                continue;
            }
            let width = (0.5 + 2.2 * q * (i as f64 / n as f64).sqrt()) * (0.7 + 0.18 * level as f64);
            // Меандры: смещение зависит только от точки отрезка, на концах равно нулю.
            let steps = (len / 4.0).ceil().max(1.0) as usize;
            let (nx, ny) = (-(b[1] - a[1]) / len.max(1e-6), (b[0] - a[0]) / len.max(1e-6));
            let mut prev = a;
            for st in 1..=steps {
                let t = st as f64 / steps as f64;
                let phase = (river.id as f64) * 13.1 + (i as f64 + t) * 2.7;
                let wob = s.noise.fbm(phase, river.id as f64 * 0.7, 0.5, 4) * (t * std::f64::consts::PI).sin() * len * 0.45;
                let p = [a[0] + (b[0] - a[0]) * t + nx * wob, a[1] + (b[1] - a[1]) * t + ny * wob];
                cv.line(prev, p, width, th.river_rgb, 0.9);
                prev = p;
            }
        }
    }
}

fn draw_symbols(cv: &mut Canvas, s: &Sampler, frame: &Frame, th: &ClassicTheme, level: u32, ox: i64, oy: i64) {
    let side = cv.side as i64;
    let ink = th.sym_ink;
    let tree_fill = th.veg_paper;
    let first = |o: i64| o.div_euclid(LATTICE) - 1;
    let last = |o: i64| (o + side).div_euclid(LATTICE) + 1;
    // Строки идут сверху вниз: нижние значки перекрывают верхние.
    for gy in first(oy)..=last(oy) {
        for gx in first(ox)..=last(ox) {
            let h = hash(gx, gy, level as u64);
            let px = (gx as f64 + 0.15 + 0.7 * unit(h, 0)) * LATTICE as f64;
            let py = (gy as f64 + 0.15 + 0.7 * unit(h, 1)) * LATTICE as f64;
            let (lat, lon) = (frame.lat(py), frame.lon(px));
            let (p, c) = (sphere(lat, lon), s.corners(lat, lon));
            // Не ставим значок вплотную к берегу.
            if s.land(p, &c) < 0.07 || s.is_lake(p, &c) {
                continue;
            }
            let height = s.height(p, lat, lon);
            let biome = classic_biome_code(s.planet.biomes.biome[Sampler::nearest(&c)]);
            let x = px - ox as f64;
            let y = py - oy as f64;
            let r = unit(h, 2);
            let grove = s.fbm(p, 140.0, 3, 91.3);
            let size = 7.0 + 4.0 * unit(h, 3);
            let ridge = s.fbm(p, 110.0, 3, 17.9);
            if height > 0.88 && r < 0.55 + ridge && (gx + gy).rem_euclid(2) == 0 {
                let big = size * (0.8 + 1.1 * (height - 0.88).min(0.8) + 0.5 * unit(h, 4));
                let (w, t) = (big * 1.1, big * 1.5);
                let (l, peak, rt) = ([x - w, y + t * 0.4], [x, y - t * 0.6], [x + w, y + t * 0.4]);
                cv.fill_triangle([l, peak, rt], th.sym_paper);
                cv.fill_triangle([peak, rt, [x + w * 0.15, y + t * 0.4]], mix(th.sym_paper, ink, 0.4));
                cv.path(&[l, peak, rt], 1.5, ink);
            } else if height > 0.5 && r < 0.5 {
                let arc: Vec<[f64; 2]> = (0..=8)
                    .map(|i| {
                        let a = std::f64::consts::PI * (1.0 - i as f64 / 8.0);
                        [x + a.cos() * size, y - a.sin() * size * 0.6]
                    })
                    .collect();
                cv.path(&arc, 1.3, ink);
            } else {
                // 2, 3, 8, 9 — лесные коды классического рендера; 6 — пустыня.
                if matches!(biome, 3 | 8 | 9 | 2) && grove > -0.08 && r < 0.85 {
                    let t = size * 0.75;
                    cv.line([x, y], [x, y + t], 1.2, ink, 0.9);
                    if matches!(biome, 2 | 9) {
                        let tri = [[x - t * 0.7, y + t * 0.3], [x, y - t * 1.2], [x + t * 0.7, y + t * 0.3]];
                        cv.fill_triangle(tri, tree_fill);
                        cv.path(&[tri[0], tri[1], tri[2], tri[0]], 1.1, ink);
                    } else {
                        let ring: Vec<[f64; 2]> = (0..=10)
                            .map(|i| {
                                let a = std::f64::consts::TAU * i as f64 / 10.0;
                                [x + a.cos() * t * 0.65, y - t * 0.35 + a.sin() * t * 0.55]
                            })
                            .collect();
                        for e in ring.windows(2) {
                            cv.fill_triangle([[x, y - t * 0.35], e[0], e[1]], tree_fill);
                        }
                        cv.path(&ring, 1.1, ink);
                    }
                } else if biome == 6 && r < 0.3 {
                    cv.path(&[[x - size, y], [x - size * 0.3, y - size * 0.35], [x + size * 0.5, y]], 1.0, ink);
                } else if r < 0.07 {
                    for dx in [-3.0, 0.0, 3.0] {
                        cv.line([x + dx * 0.5, y], [x + dx, y - 4.0], 0.9, ink, 0.7);
                    }
                }
            }
        }
    }
}
