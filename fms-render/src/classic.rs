//! Классический рисованный «от руки» рендерер Fantasy Map Studio (линейка 0.89.0):
//! бумага и зерно, береговой размыв, штриховка воды («Сепия»), три концентрических ореола («Ч/Б»),
//! гипсометрическая отмывка («Цветной»), векторные горы с теневой штриховкой, холмы, вулканы,
//! восемь типов значков биомов, реки, дороги с мостами, границы держав, дуговые подписи и легенда.

use crate::png::base64_encode;
use crate::proj::{wrap_lon_deg, RegionProj, WorldProj};
use crate::terrain::{
    choose_region_window, generate_world_ocean_labels, pick_ocean_hub, plains_shift_km,
    trace_ocean_currents, DepositPin, MapLabel, OverlayModel, OverlayRoute, PoiPin,
    RenderOptions, SampledGrid, SettlementPin, Style, WaterfallPin, WildSitePin,
};
use crate::RenderOutput;
use fms_core::biomes::Biome;
use fms_core::civilization::{RouteKind, SettlementRole, SettlementTier, WildSiteKind};
use fms_core::geography::LandmassKind;
use fms_core::hydrology::River;
use fms_core::planet::Planet;
use fms_core::region::Region;
use fms_core::resources::ResourceKind;
use fms_core::rng::Rng;
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};
use std::f64::consts::{PI, TAU};
use std::fmt::Write as _;

// ---------- Палитры и темы (точные константы релиза 0.89.0) ----------

#[derive(Clone, Copy)]
pub(crate) struct ClassicTheme {
    pub(crate) paper: [f64; 3],
    pub(crate) paper_var: f64,
    pub(crate) grain: f64,
    pub(crate) ink_hex: &'static str,
    pub(crate) ink: [f64; 3],
    pub(crate) water_far: [f64; 3],
    pub(crate) water_near: [f64; 3],
    pub(crate) hatch: bool,
    pub(crate) halos: usize,
    pub(crate) vignette: f64,
    pub(crate) frame: bool,
    pub(crate) is_color: bool,
    pub(crate) sym_paper: [f64; 3],
    pub(crate) sym_paper_hex: &'static str,
    pub(crate) sym_ink: [f64; 3],
    pub(crate) sym_ink_hex: &'static str,
    pub(crate) veg_paper: [f64; 3],
    pub(crate) veg_paper_hex: &'static str,
    pub(crate) river_hex: &'static str,
    pub(crate) river_rgb: [f64; 3],
    pub(crate) coast_hex: &'static str,
    pub(crate) coast_rgb: [f64; 3],
    pub(crate) sea_name_hex: &'static str,
    pub(crate) sea_route_hex: &'static str,
}

pub(crate) fn theme_of(style: Style) -> ClassicTheme {
    match style {
        Style::Sepia => ClassicTheme {
            paper: [223.0, 215.0, 201.0],
            paper_var: 13.0,
            grain: 0.06,
            ink_hex: "#3b3229",
            ink: [59.0, 50.0, 41.0],
            water_far: [182.0, 174.0, 160.0],
            water_near: [206.0, 198.0, 185.0],
            hatch: true,
            halos: 0,
            vignette: 0.24,
            frame: true,
            is_color: false,
            sym_paper: [221.0, 213.0, 199.0],
            sym_paper_hex: "#ddd5c7",
            sym_ink: [59.0, 50.0, 41.0],
            sym_ink_hex: "#3b3229",
            veg_paper: [221.0, 213.0, 199.0],
            veg_paper_hex: "#ddd5c7",
            river_hex: "#3b3229",
            river_rgb: [59.0, 50.0, 41.0],
            coast_hex: "#3b3229",
            coast_rgb: [59.0, 50.0, 41.0],
            sea_name_hex: "rgba(55,75,100,0.88)",
            sea_route_hex: "rgba(42,68,94,0.88)",
        },
        Style::Ink => ClassicTheme {
            paper: [247.0, 247.0, 245.0],
            paper_var: 3.0,
            grain: 0.04,
            ink_hex: "#151515",
            ink: [21.0, 21.0, 21.0],
            water_far: [226.0, 226.0, 224.0],
            water_near: [236.0, 236.0, 234.0],
            hatch: false,
            halos: 3,
            vignette: 0.0,
            frame: false,
            is_color: false,
            sym_paper: [247.0, 247.0, 245.0],
            sym_paper_hex: "#f7f7f5",
            sym_ink: [21.0, 21.0, 21.0],
            sym_ink_hex: "#151515",
            veg_paper: [247.0, 247.0, 245.0],
            veg_paper_hex: "#f7f7f5",
            river_hex: "#151515",
            river_rgb: [21.0, 21.0, 21.0],
            coast_hex: "#151515",
            coast_rgb: [21.0, 21.0, 21.0],
            sea_name_hex: "#151515",
            sea_route_hex: "#151515",
        },
        Style::Color => ClassicTheme {
            paper: [250.0, 247.0, 238.0],
            paper_var: 3.0,
            grain: 0.03,
            ink_hex: "#2d2a26",
            ink: [45.0, 42.0, 38.0],
            water_far: [112.0, 150.0, 178.0],
            water_near: [182.0, 210.0, 220.0],
            hatch: false,
            halos: 0,
            vignette: 0.10,
            frame: true,
            is_color: true,
            sym_paper: [236.0, 230.0, 212.0],
            sym_paper_hex: "#ece6d4",
            sym_ink: [58.0, 50.0, 40.0],
            sym_ink_hex: "#3a3228",
            veg_paper: [142.0, 168.0, 112.0],
            veg_paper_hex: "#8ea870",
            river_hex: "#42729c",
            river_rgb: [66.0, 114.0, 156.0],
            coast_hex: "rgba(52,80,104,0.75)",
            coast_rgb: [52.0, 80.0, 104.0],
            sea_name_hex: "rgba(20,50,110,0.90)",
            sea_route_hex: "rgba(20,40,90,0.85)",
        },
    }
}

// ---------- Детерминированный RNG и быстрый 2D-шум (порт 0.89.0 rng.js) ----------

struct Mulberry32 {
    state: u32,
}

impl Mulberry32 {
    fn from_seed(s: &str) -> Self {
        let mut h = 2166136261u32;
        for b in s.bytes() {
            h ^= b as u32;
            h = h.wrapping_mul(16777619);
        }
        Self { state: h.max(1) }
    }

    fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6D2B_79F5);
        let mut t = self.state;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4294967296.0
    }
}

struct Noise2 {
    perm: [u8; 512],
}

impl Noise2 {
    fn new(seed: &str) -> Self {
        let mut rng = Mulberry32::from_seed(seed);
        let mut p = [0u8; 256];
        for (i, v) in p.iter_mut().enumerate() {
            *v = i as u8;
        }
        for i in (1..256).rev() {
            let j = (rng.next() * (i + 1) as f64).floor() as usize;
            p.swap(i, j.min(i));
        }
        let mut perm = [0u8; 512];
        for i in 0..512 {
            perm[i] = p[i & 255];
        }
        Self { perm }
    }

    #[inline]
    fn sample(&self, x: f64, y: f64) -> f64 {
        let xi = x.floor() as isize;
        let yi = y.floor() as isize;
        let xf = x - xi as f64;
        let yf = y - yi as f64;
        let u = xf * xf * (3.0 - 2.0 * xf);
        let v = yf * yf * (3.0 - 2.0 * yf);
        let x0 = (xi & 255) as usize;
        let y0 = (yi & 255) as usize;
        let a = self.perm[self.perm[x0] as usize + y0];
        let b = self.perm[self.perm[(x0 + 1) & 255] as usize + y0];
        let c = self.perm[self.perm[x0] as usize + ((y0 + 1) & 255)];
        let d = self.perm[self.perm[(x0 + 1) & 255] as usize + ((y0 + 1) & 255)];
        let grad = |h: u8, dx: f64, dy: f64| -> f64 {
            match h & 7 {
                0 => dx + dy,
                1 => -dx + dy,
                2 => dx - dy,
                3 => -dx - dy,
                4 => dx,
                5 => -dx,
                6 => dy,
                _ => -dy,
            }
        };
        let x1 = grad(a, xf, yf) * (1.0 - u) + grad(b, xf - 1.0, yf) * u;
        let x2 = grad(c, xf, yf - 1.0) * (1.0 - u) + grad(d, xf - 1.0, yf - 1.0) * u;
        (x1 * (1.0 - v) + x2 * v).clamp(-1.0, 1.0)
    }

    fn fbm(&self, x: f64, y: f64, oct: usize) -> f64 {
        let (mut sum, mut amp, mut freq, mut norm) = (0.0, 1.0, 1.0, 0.0);
        for _ in 0..oct {
            sum += self.sample(x * freq, y * freq) * amp;
            norm += amp;
            amp *= 0.5;
            freq *= 2.03;
        }
        sum / norm.max(1e-6)
    }
}

#[inline]
fn clamp(v: f64, a: f64, b: f64) -> f64 {
    v.max(a).min(b)
}

#[inline]
fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = clamp((x - a) / (b - a), 0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn lerp3(a: [f64; 3], b: [f64; 3], t: f64) -> [f64; 3] {
    let u = t.clamp(0.0, 1.0);
    [
        a[0] + (b[0] - a[0]) * u,
        a[1] + (b[1] - a[1]) * u,
        a[2] + (b[2] - a[2]) * u,
    ]
}

fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len() + 8);
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            _ => out.push(ch),
        }
    }
    out
}

pub(crate) fn classic_biome_code(b: Biome) -> u8 {
    match b {
        Biome::IceSheet | Biome::PolarDesert => 1,
        Biome::Tundra => 2,
        Biome::BorealForest | Biome::TemperateRainforest => 3,
        Biome::TemperateForest | Biome::Mediterranean => 4,
        Biome::TemperateGrassland => 5,
        Biome::HotDesert | Biome::ColdDesert | Biome::SaltFlat => 6,
        Biome::TropicalSavanna => 7,
        Biome::TropicalRainforest | Biome::TropicalSeasonalForest => 8,
        Biome::Wetland => 9,
        Biome::Alpine => 10,
        _ => 0,
    }
}

// ---------- Сетка классического рендера внутри frame ----------

struct ClassicGrid {
    gw: usize,
    gh: usize,
    canvas_w: usize,
    canvas_h: usize,
    frame: [f64; 4],
    sx: f64,
    sy: f64,
    scale_k: f64,
    h: Vec<f32>,
    ocean: Vec<u8>,
    lake: Vec<u8>,
    polar_ice: Vec<u8>,
    biome: Vec<u8>,
    moist: Vec<f32>,
    young: Vec<f32>,
    old: Vec<f32>,
    volcanic: Vec<f32>,
    margin_mod: Vec<f32>,
    river_mask: Vec<u8>,
    realm_id: Vec<i32>,
    dist: Vec<f32>,
    dist_blur1: Vec<f32>,
    dist_blur3: Vec<f32>,
    volcanoes: Vec<(f64, f64, bool)>,
}

impl ClassicGrid {
    #[inline]
    fn px(&self, gx: f64) -> f64 {
        self.frame[0] + gx * self.sx
    }

    #[inline]
    fn py(&self, gy: f64) -> f64 {
        self.frame[1] + gy * self.sy
    }

    fn bil(&self, arr: &[f32], fx: f64, fy: f64) -> f64 {
        let x0 = clamp(fx.floor(), 0.0, (self.gw - 2) as f64) as usize;
        let y0 = clamp(fy.floor(), 0.0, (self.gh - 2) as f64) as usize;
        let u = clamp(fx - x0 as f64, 0.0, 1.0);
        let v = clamp(fy - y0 as f64, 0.0, 1.0);
        let i = y0 * self.gw + x0;
        let a = arr[i] as f64;
        let b = arr[i + 1] as f64;
        let c = arr[i + self.gw] as f64;
        let d = arr[i + self.gw + 1] as f64;
        (a * (1.0 - u) + b * u) * (1.0 - v) + (c * (1.0 - u) + d * u) * v
    }

    fn sample_world(planet: &Planet, proj: &WorldProj) -> Self {
        let frame = proj.frame;
        let gw = 640usize;
        let gh = ((gw as f64 * frame[3] / frame[2].max(1.0)).round() as usize).clamp(200, 460);
        let n = gw * gh;
        let sx = frame[2] / (gw - 1) as f64;
        let sy = frame[3] / (gh - 1) as f64;
        let scale_k = (frame[2] / 2250.0).clamp(0.35, 1.4);

        let pw = planet.grid.w;
        let ph = planet.grid.h;
        let p_shift = plains_shift_km(planet);
        let t_now = planet.stats_time();
        let ice_noise = Noise2::new(&format!("{}|packice", planet.seed));

        // Сохраняем до 24 настоящих озёр планеты (>= 3 ячеек) с минимальной фильтрацией, чтобы не превращать их в «фасолины»
        let world_lake_smooth = {
            let pn = pw * ph;
            let mut keep = vec![0.0f32; pn];
            let mut vis = vec![0u8; pn];
            let mut q = VecDeque::new();
            let mut comps: Vec<Vec<usize>> = Vec::new();
            for s0 in 0..pn {
                if planet.hydrology.is_lake[s0] == 0 || vis[s0] != 0 {
                    continue;
                }
                let mut comp = vec![s0];
                vis[s0] = 1;
                q.push_back(s0);
                while let Some(c) = q.pop_front() {
                    let cy = c / pw;
                    let cx = c % pw;
                    let nbs = [
                        cy * pw + (cx + pw - 1) % pw,
                        cy * pw + (cx + 1) % pw,
                        cy.saturating_sub(1) * pw + cx,
                        (cy + 1).min(ph - 1) * pw + cx,
                    ];
                    for nb in nbs {
                        if planet.hydrology.is_lake[nb] != 0 && vis[nb] == 0 {
                            vis[nb] = 1;
                            comp.push(nb);
                            q.push_back(nb);
                        }
                    }
                }
                if comp.len() >= 3 {
                    comps.push(comp);
                }
            }
            comps.sort_by(|a, b| b.len().cmp(&a.len()));
            comps.truncate(24);
            for comp in comps {
                for idx in comp {
                    keep[idx] = 1.0;
                }
            }
            let mut sm = vec![0.0f32; pn];
            for y in 0..ph {
                for x in 0..pw {
                    let c = keep[y * pw + x];
                    let xl = (x + pw - 1) % pw;
                    let xr = (x + 1) % pw;
                    let yu = y.saturating_sub(1);
                    let yd = (y + 1).min(ph - 1);
                    let nb4 = 0.25 * (keep[y * pw + xl] + keep[y * pw + xr] + keep[yu * pw + x] + keep[yd * pw + x]);
                    sm[y * pw + x] = 0.65 * c + 0.35 * nb4;
                }
            }
            sm
        };

        let mut h = vec![0.0f32; n];
        let mut ocean = vec![0u8; n];
        let mut lake = vec![0u8; n];
        let mut polar_ice = vec![0u8; n];
        let mut biome = vec![0u8; n];
        let mut moist = vec![0.0f32; n];
        let mut young = vec![0.0f32; n];
        let mut old = vec![0.0f32; n];
        let mut volcanic = vec![0.0f32; n];
        let mut margin_mod = vec![1.0f32; n];
        let mut river_mask = vec![0u8; n];
        let mut realm_id = vec![-1i32; n];

        let bil_p = |arr: &[f32], gx: f64, gy: f64| -> f64 {
            let x0 = gx.floor() as isize;
            let y0 = gy.floor() as isize;
            let tx = gx - x0 as f64;
            let ty = gy - y0 as f64;
            let ix0 = x0.rem_euclid(pw as isize) as usize;
            let ix1 = (x0 + 1).rem_euclid(pw as isize) as usize;
            let iy0 = y0.clamp(0, ph as isize - 1) as usize;
            let iy1 = (y0 + 1).clamp(0, ph as isize - 1) as usize;
            let a = arr[iy0 * pw + ix0] as f64;
            let b = arr[iy0 * pw + ix1] as f64;
            let c = arr[iy1 * pw + ix0] as f64;
            let d = arr[iy1 * pw + ix1] as f64;
            (a * (1.0 - tx) + b * tx) * (1.0 - ty) + (c * (1.0 - tx) + d * tx) * ty
        };

        for gy in 0..gh {
            let py = (frame[1] + gy as f64 * sy).clamp(frame[1] + 1e-4, frame[1] + frame[3] - 1e-4);
            for gx in 0..gw {
                let px = (frame[0] + gx as f64 * sx).clamp(frame[0] + 1e-4, frame[0] + frame[2] - 1e-4);
                let idx = gy * gw + gx;
                let Some((lat, lon)) = proj.inverse(px, py) else {
                    h[idx] = -0.5;
                    ocean[idx] = 1;
                    continue;
                };
                let pxf = ((lon + 180.0).rem_euclid(360.0) / 360.0) * pw as f64 - 0.5;
                let pyf = (((90.0 - lat) / 180.0) * ph as f64 - 0.5).clamp(0.0, (ph - 1) as f64);
                let cx = (pxf.round() as isize).rem_euclid(pw as isize) as usize;
                let cy = (pyf.round() as isize).clamp(0, ph as isize - 1) as usize;
                let ci = cy * pw + cx;

                let elev = bil_p(&planet.erosion.elevation_km, pxf, pyf);
                let is_oc = elev < 0.0 || planet.hydrology.is_ocean[ci] != 0;
                if is_oc {
                    ocean[idx] = 1;
                    h[idx] = -(smooth(0.0, 4.5, (-elev).max(0.02)) * 1.15 + 0.04) as f32;
                    let temp = bil_p(&planet.climate.temp_c, pxf, pyf);
                    let ice_n = ice_noise.fbm(lon * 0.045, lat * 0.09, 3);
                    if temp + 3.8 * ice_n < -9.5 {
                        polar_ice[idx] = 1;
                    }
                    biome[idx] = 0;
                } else {
                    let e_rel = (elev - p_shift).max(0.02);
                    h[idx] = (e_rel * 0.56 + 0.04).clamp(0.03, 1.85) as f32;
                    if bil_p(&world_lake_smooth, pxf, pyf) > 0.44 {
                        lake[idx] = 1;
                    }
                    biome[idx] = classic_biome_code(planet.biomes.biome[ci]);
                    let pr = bil_p(&planet.climate.precip_mm, pxf, pyf);
                    let ai = bil_p(&planet.climate.aridity_index, pxf, pyf);
                    moist[idx] = (0.55 * (pr / 1700.0).clamp(0.0, 1.0)
                        + 0.45 * (ai / 1.45).clamp(0.0, 1.0))
                    .clamp(0.0, 1.0) as f32;

                    let oro_t = planet.tectonic.t_oro_myr[ci] as f64;
                    let age = if oro_t < 0.0 {
                        900.0
                    } else {
                        (t_now - oro_t).max(0.0)
                    };
                    let young_fac = if age < 320.0 {
                        1.0
                    } else if age < 750.0 {
                        0.65
                    } else {
                        0.35
                    };
                    let y_val = (smooth(0.92, 2.25, e_rel) * (0.55 + 0.45 * young_fac)
                        + 0.25 * planet.tectonic.suture[ci] as f64 * smooth(0.65, 1.6, e_rel))
                    .clamp(0.0, 1.0);
                    let o_val = (smooth(0.42, 1.25, e_rel) * (1.0 - 0.55 * y_val))
                        .clamp(0.0, 1.0);
                    young[idx] = y_val as f32;
                    old[idx] = o_val as f32;
                    volcanic[idx] = planet.tectonic.volcanic[ci];
                    let conv = if planet.tectonic.margin[ci] == 1 { 1.0 } else { 0.0 };
                    let pass = if planet.tectonic.margin[ci] == 2 { 1.0 } else { 0.0 };
                    let rift = planet.tectonic.rift[ci] as f64;
                    margin_mod[idx] = (1.0 + 0.5 * rift + 0.2 * pass - 0.45 * conv)
                        .clamp(0.5, 1.6) as f32;

                    if planet.hydrology.river_mask[ci] != 0 {
                        river_mask[idx] = 1;
                    }
                    if planet.hydrology.is_lake[ci] == 0 {
                        realm_id[idx] = planet.civilization.realm_id[ci];
                    }
                }
            }
        }

        let mut grid = Self {
            gw,
            gh,
            canvas_w: proj.canvas_w,
            canvas_h: proj.canvas_h,
            frame,
            sx,
            sy,
            scale_k,
            h,
            ocean,
            lake,
            polar_ice,
            biome,
            moist,
            young,
            old,
            volcanic,
            margin_mod,
            river_mask,
            realm_id,
            dist: Vec::new(),
            dist_blur1: Vec::new(),
            dist_blur3: Vec::new(),
            volcanoes: Vec::new(),
        };
        grid.finish_fields();
        grid
    }

    fn sample_region(planet: &Planet, reg: &Region, proj: &RegionProj) -> Self {
        let frame = proj.frame;
        let gw = 640usize;
        let gh = ((gw as f64 * frame[3] / frame[2].max(1.0)).round() as usize).clamp(200, 520);
        let n = gw * gh;
        let sx = frame[2] / (gw - 1) as f64;
        let sy = frame[3] / (gh - 1) as f64;
        let scale_k = (frame[2] / 1680.0).clamp(0.42, 1.6);

        let rw = reg.w;
        let rh = reg.h;
        let pw = planet.grid.w;
        let ph = planet.grid.h;
        let p_shift = plains_shift_km(planet);
        let t_now = planet.stats_time();
        let ice_noise = Noise2::new(&format!("{}|packice", planet.seed));

        // Сохраняем до 16 настоящих озёр региона (>= 8 ячеек reg), сохраняя изрезанность берегов
        let reg_lake_smooth = {
            let rn = rw * rh;
            let mut keep = vec![0.0f32; rn];
            let mut vis = vec![0u8; rn];
            let mut q = VecDeque::new();
            let mut comps: Vec<Vec<usize>> = Vec::new();
            for s0 in 0..rn {
                if reg.is_lake[s0] == 0 || vis[s0] != 0 {
                    continue;
                }
                let mut comp = vec![s0];
                vis[s0] = 1;
                q.push_back(s0);
                while let Some(c) = q.pop_front() {
                    let cx = c % rw;
                    let cy = c / rw;
                    for (dx, dy) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                        let nx = cx as isize + dx;
                        let ny = cy as isize + dy;
                        if nx >= 0 && ny >= 0 && nx < rw as isize && ny < rh as isize {
                            let nb = ny as usize * rw + nx as usize;
                            if reg.is_lake[nb] != 0 && vis[nb] == 0 {
                                vis[nb] = 1;
                                comp.push(nb);
                                q.push_back(nb);
                            }
                        }
                    }
                }
                if comp.len() >= 8 {
                    comps.push(comp);
                }
            }
            comps.sort_by(|a, b| b.len().cmp(&a.len()));
            comps.truncate(16);
            for comp in comps {
                for idx in comp {
                    keep[idx] = 1.0;
                }
            }
            let mut sm = vec![0.0f32; rn];
            for y in 0..rh {
                for x in 0..rw {
                    let c = keep[y * rw + x];
                    let xl = x.saturating_sub(1);
                    let xr = (x + 1).min(rw - 1);
                    let yu = y.saturating_sub(1);
                    let yd = (y + 1).min(rh - 1);
                    let nb4 = 0.25 * (keep[y * rw + xl] + keep[y * rw + xr] + keep[yu * rw + x] + keep[yd * rw + x]);
                    sm[y * rw + x] = 0.65 * c + 0.35 * nb4;
                }
            }
            sm
        };

        let mut h = vec![0.0f32; n];
        let mut ocean = vec![0u8; n];
        let mut lake = vec![0u8; n];
        let mut polar_ice = vec![0u8; n];
        let mut biome = vec![0u8; n];
        let mut moist = vec![0.0f32; n];
        let mut young = vec![0.0f32; n];
        let mut old = vec![0.0f32; n];
        let mut volcanic = vec![0.0f32; n];
        let mut margin_mod = vec![1.0f32; n];
        let mut river_mask = vec![0u8; n];
        let mut realm_id = vec![-1i32; n];

        let bil_r = |arr: &[f32], gx: f64, gy: f64| -> f64 {
            let x0 = clamp(gx.floor(), 0.0, (rw - 2) as f64) as usize;
            let y0 = clamp(gy.floor(), 0.0, (rh - 2) as f64) as usize;
            let tx = clamp(gx - x0 as f64, 0.0, 1.0);
            let ty = clamp(gy - y0 as f64, 0.0, 1.0);
            let i = y0 * rw + x0;
            let a = arr[i] as f64;
            let b = arr[i + 1] as f64;
            let c = arr[i + rw] as f64;
            let d = arr[i + rw + 1] as f64;
            (a * (1.0 - tx) + b * tx) * (1.0 - ty) + (c * (1.0 - tx) + d * tx) * ty
        };

        for gy in 0..gh {
            let py = (frame[1] + gy as f64 * sy).clamp(frame[1] + 1e-4, frame[1] + frame[3] - 1e-4);
            for gx in 0..gw {
                let px = (frame[0] + gx as f64 * sx).clamp(frame[0] + 1e-4, frame[0] + frame[2] - 1e-4);
                let idx = gy * gw + gx;
                let Some((lat, lon)) = proj.inverse(px, py) else {
                    h[idx] = -0.5;
                    ocean[idx] = 1;
                    continue;
                };
                let dlon = wrap_lon_deg(lon - reg.center_lon_deg);
                let rxf = clamp((dlon / proj.span_lon_deg.max(1e-6) + 0.5) * rw as f64 - 0.5, 0.0, (rw - 1) as f64);
                let ryf = clamp(
                    (reg.lat_max_deg - lat) / (reg.lat_max_deg - reg.lat_min_deg).max(1e-6) * rh as f64 - 0.5,
                    0.0,
                    (rh - 1) as f64,
                );
                let rx = (rxf.round() as usize).min(rw - 1);
                let ry = (ryf.round() as usize).min(rh - 1);
                let ri = ry * rw + rx;

                let pxf = ((lon + 180.0).rem_euclid(360.0) / 360.0) * pw as f64 - 0.5;
                let pyf = (((90.0 - lat) / 180.0) * ph as f64 - 0.5).clamp(0.0, (ph - 1) as f64);
                let px_i = (pxf.round() as isize).rem_euclid(pw as isize) as usize;
                let py_i = (pyf.round() as isize).clamp(0, ph as isize - 1) as usize;
                let pi = py_i * pw + px_i;

                let elev = bil_r(&reg.elevation_km, rxf, ryf);
                let is_oc = elev < 0.0 || reg.is_ocean[ri] != 0;
                if is_oc {
                    ocean[idx] = 1;
                    h[idx] = -(smooth(0.0, 4.5, (-elev).max(0.02)) * 1.15 + 0.04) as f32;
                    let temp = bil_r(&reg.temp_c, rxf, ryf);
                    let ice_n = ice_noise.fbm(lon * 0.045, lat * 0.09, 3);
                    if temp + 3.8 * ice_n < -9.5 {
                        polar_ice[idx] = 1;
                    }
                    biome[idx] = 0;
                } else {
                    let e_rel = (elev - p_shift).max(0.02);
                    h[idx] = (e_rel * 0.56 + 0.04).clamp(0.03, 1.85) as f32;
                    let is_lk = bil_r(&reg_lake_smooth, rxf, ryf) > 0.45;
                    if is_lk {
                        lake[idx] = 1;
                    }
                    biome[idx] = classic_biome_code(reg.biome[ri]);
                    moist[idx] = (bil_r(&reg.precip_mm, rxf, ryf) / 1600.0).clamp(0.0, 1.0) as f32;

                    let oro_t = planet.tectonic.t_oro_myr[pi] as f64;
                    let age = if oro_t < 0.0 { 900.0 } else { (t_now - oro_t).max(0.0) };
                    let young_fac = if age < 320.0 { 1.0 } else if age < 750.0 { 0.65 } else { 0.35 };
                    let y_val = (smooth(0.95, 2.30, e_rel) * (0.52 + 0.48 * young_fac)
                        + 0.25 * planet.tectonic.suture[pi] as f64 * smooth(0.65, 1.65, e_rel))
                    .clamp(0.0, 1.0);
                    let o_val = (smooth(0.44, 1.25, e_rel) * (1.0 - 0.55 * y_val)).clamp(0.0, 1.0);
                    young[idx] = y_val as f32;
                    old[idx] = o_val as f32;
                    volcanic[idx] = planet.tectonic.volcanic[pi];
                    let conv = if planet.tectonic.margin[pi] == 1 { 1.0 } else { 0.0 };
                    let pass = if planet.tectonic.margin[pi] == 2 { 1.0 } else { 0.0 };
                    let rift = planet.tectonic.rift[pi] as f64;
                    margin_mod[idx] = (1.0 + 0.5 * rift + 0.2 * pass - 0.45 * conv)
                        .clamp(0.5, 1.6) as f32;

                    if reg.river_mask[ri] != 0 {
                        river_mask[idx] = 1;
                    }
                    if !is_lk {
                        // Билинейное взвешивание принадлежности державам (убирает ступеньки грубой сетки планеты)
                        let x0 = pxf.floor() as isize;
                        let y0 = pyf.floor() as isize;
                        let tx = pxf - x0 as f64;
                        let ty = pyf - y0 as f64;
                        let ix0 = x0.rem_euclid(pw as isize) as usize;
                        let ix1 = (x0 + 1).rem_euclid(pw as isize) as usize;
                        let iy0 = y0.clamp(0, ph as isize - 1) as usize;
                        let iy1 = (y0 + 1).clamp(0, ph as isize - 1) as usize;
                        let cands = [
                            (planet.civilization.realm_id[iy0 * pw + ix0], (1.0 - tx) * (1.0 - ty)),
                            (planet.civilization.realm_id[iy0 * pw + ix1], tx * (1.0 - ty)),
                            (planet.civilization.realm_id[iy1 * pw + ix0], (1.0 - tx) * ty),
                            (planet.civilization.realm_id[iy1 * pw + ix1], tx * ty),
                        ];
                        let mut best_r = -1i32;
                        let mut best_w = 0.0f64;
                        for (ci_r, &(rid, _)) in cands.iter().enumerate() {
                            if rid < 0 {
                                continue;
                            }
                            let mut w_sum = 0.0;
                            for &(r2, w2) in &cands[ci_r..] {
                                if r2 == rid {
                                    w_sum += w2;
                                }
                            }
                            if w_sum > best_w {
                                best_w = w_sum;
                                best_r = rid;
                            }
                        }
                        realm_id[idx] = best_r;
                    }
                }
            }
        }

        let mut grid = Self {
            gw,
            gh,
            canvas_w: proj.canvas_w,
            canvas_h: proj.canvas_h,
            frame,
            sx,
            sy,
            scale_k,
            h,
            ocean,
            lake,
            polar_ice,
            biome,
            moist,
            young,
            old,
            volcanic,
            margin_mod,
            river_mask,
            realm_id,
            dist: Vec::new(),
            dist_blur1: Vec::new(),
            dist_blur3: Vec::new(),
            volcanoes: Vec::new(),
        };
        grid.finish_fields();
        grid
    }

    fn finish_fields(&mut self) {
        let gw = self.gw;
        let gh = self.gh;
        let n = gw * gh;

        // Замкнутые внутренние водоёмы без выхода к внешнему океану переводим в озёра (без морской штриховки/ореолов внутри)
        {
            let mut vis_oc = vec![0u8; n];
            let mut oq = VecDeque::new();
            for s0 in 0..n {
                if self.ocean[s0] == 0 || vis_oc[s0] != 0 {
                    continue;
                }
                let mut comp = vec![s0];
                vis_oc[s0] = 1;
                oq.push_back(s0);
                let mut touches_edge = false;
                while let Some(c) = oq.pop_front() {
                    let cx = c % gw;
                    let cy = c / gw;
                    if cx == 0 || cy == 0 || cx + 1 == gw || cy + 1 == gh {
                        touches_edge = true;
                    }
                    for (dx, dy) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                        let nx = cx as isize + dx;
                        let ny = cy as isize + dy;
                        if nx >= 0 && ny >= 0 && nx < gw as isize && ny < gh as isize {
                            let nb = ny as usize * gw + nx as usize;
                            if self.ocean[nb] != 0 && vis_oc[nb] == 0 {
                                vis_oc[nb] = 1;
                                comp.push(nb);
                                oq.push_back(nb);
                            }
                        }
                    }
                }
                if !touches_edge && comp.len() < (n / 18) {
                    let as_lake = if comp.len() >= 24 { 1u8 } else { 0u8 };
                    for idx in comp {
                        self.ocean[idx] = 0;
                        self.polar_ice[idx] = 0;
                        self.h[idx] = 0.05;
                        self.lake[idx] = as_lake;
                    }
                }
            }
        }

        let mut dist = vec![1e6f32; n];
        let mut q = VecDeque::with_capacity(n / 4);
        for i in 0..n {
            if self.ocean[i] == 0 {
                dist[i] = 0.0;
                q.push_back(i);
            }
        }
        while let Some(c) = q.pop_front() {
            let d0 = dist[c];
            if d0 > 55.0 {
                continue;
            }
            let cx = c % gw;
            let cy = c / gw;
            for (dx, dy, step) in [
                (-1isize, 0isize, 1.0f32),
                (1, 0, 1.0),
                (0, -1, 1.0),
                (0, 1, 1.0),
                (-1, -1, 1.4142),
                (1, -1, 1.4142),
                (-1, 1, 1.4142),
                (1, 1, 1.4142),
            ] {
                let nx = cx as isize + dx;
                let ny = cy as isize + dy;
                if nx < 0 || ny < 0 || nx >= gw as isize || ny >= gh as isize {
                    continue;
                }
                let nb = ny as usize * gw + nx as usize;
                let nd = d0 + step;
                if nd + 1e-3 < dist[nb] {
                    dist[nb] = nd;
                    q.push_back(nb);
                }
            }
        }
        for d in &mut dist {
            if *d > 55.0 {
                *d = 55.0;
            }
        }
        let blur_box = |src: &[f32], rad: usize| -> Vec<f32> {
            let mut tmp = vec![0.0f32; n];
            let mut out = vec![0.0f32; n];
            for y in 0..gh {
                for x in 0..gw {
                    let mut sum = 0.0f32;
                    let mut cnt = 0usize;
                    let x0 = x.saturating_sub(rad);
                    let x1 = (x + rad).min(gw - 1);
                    for xx in x0..=x1 {
                        sum += src[y * gw + xx];
                        cnt += 1;
                    }
                    tmp[y * gw + x] = sum / cnt as f32;
                }
            }
            for y in 0..gh {
                let y0 = y.saturating_sub(rad);
                let y1 = (y + rad).min(gh - 1);
                for x in 0..gw {
                    let mut sum = 0.0f32;
                    let mut cnt = 0usize;
                    for yy in y0..=y1 {
                        sum += tmp[yy * gw + x];
                        cnt += 1;
                    }
                    out[y * gw + x] = sum / cnt as f32;
                }
            }
            out
        };
        let dist_blur1 = blur_box(&dist, 1);
        let dist_blur3 = blur_box(&dist, 3);
        self.dist = dist;
        self.dist_blur1 = dist_blur1;
        self.dist_blur3 = dist_blur3;

        // Припайный морской лёд оставляем только у холодных побережий (без сплошной горизонтальной полосы через весь верх/низ рамки)
        for i in 0..n {
            if self.dist[i] > 8.5 {
                self.polar_ice[i] = 0;
            }
        }

        // Убираем мелкие озёра-лужицы (< 10 ячеек), создающие визуальный мусор из обведённых кружков
        {
            let mut seen_lk = vec![0u8; n];
            let mut lq = VecDeque::new();
            for s0 in 0..n {
                if self.lake[s0] == 0 || seen_lk[s0] != 0 {
                    continue;
                }
                let mut comp = vec![s0];
                seen_lk[s0] = 1;
                lq.push_back(s0);
                while let Some(c) = lq.pop_front() {
                    let cx = c % gw;
                    let cy = c / gw;
                    for (dx, dy) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                        let nx = cx as isize + dx;
                        let ny = cy as isize + dy;
                        if nx >= 0 && ny >= 0 && nx < gw as isize && ny < gh as isize {
                            let nb = ny as usize * gw + nx as usize;
                            if self.lake[nb] != 0 && seen_lk[nb] == 0 {
                                seen_lk[nb] = 1;
                                comp.push(nb);
                                lq.push_back(nb);
                            }
                        }
                    }
                }
                if comp.len() < 12 {
                    for idx in comp {
                        self.lake[idx] = 0;
                    }
                }
            }
        }

        // Модальное сглаживание сетки государств, чтобы границы шли плавными дугами без прямоугольных ступенек
        if self.realm_id.iter().any(|&r| r >= 0) {
            let rad = 4isize;
            for _ in 0..3 {
                let prev = self.realm_id.clone();
                for y in 0..gh {
                    for x in 0..gw {
                        let idx = y * gw + x;
                        if self.ocean[idx] != 0 || self.lake[idx] != 0 || prev[idx] < 0 {
                            continue;
                        }
                        let mut counts: [(i32, u16); 8] = [(-1, 0); 8];
                        for dy in -rad..=rad {
                            let ny = y as isize + dy;
                            if ny < 0 || ny >= gh as isize {
                                continue;
                            }
                            let row = ny as usize * gw;
                            for dx in -rad..=rad {
                                let nx = x as isize + dx;
                                if nx < 0 || nx >= gw as isize {
                                    continue;
                                }
                                let r = prev[row + nx as usize];
                                if r < 0 {
                                    continue;
                                }
                                for slot in &mut counts {
                                    if slot.0 == r {
                                        slot.1 += 1;
                                        break;
                                    } else if slot.1 == 0 {
                                        *slot = (r, 1);
                                        break;
                                    }
                                }
                            }
                        }
                        let mut best = prev[idx];
                        let mut best_c = 0u16;
                        for &(r, c) in &counts {
                            if c > best_c {
                                best_c = c;
                                best = r;
                            }
                        }
                        self.realm_id[idx] = best;
                    }
                }
            }
        }

        // Выделение макро-гребней кордильер (без «пустых» высокогорных плато) и нормировка доли гор/холмов
        {
            let r_macro = (gw / 24).max(16);
            let h_med = blur_box(&self.h, 2);
            let h_broad = blur_box(&self.h, r_macro);
            for i in 0..n {
                if self.ocean[i] != 0 || self.lake[i] != 0 {
                    self.young[i] = 0.0;
                    self.old[i] = 0.0;
                    continue;
                }
                let prom = (h_med[i] - h_broad[i]).max(0.0);
                let high_core = smooth(0.68, 1.32, self.h[i] as f64) as f32;
                self.young[i] = (0.58 * self.young[i].max(high_core * 0.88) + 1.35 * prom).clamp(0.0, 1.6);
            }
            self.young = blur_box(&self.young, 2);
            for i in 0..n {
                if self.ocean[i] != 0 || self.lake[i] != 0 {
                    self.young[i] = 0.0;
                }
            }
            // Физическая доля гор и холмов без принудительного выравнивания низменностей до горных стран;
            // ограничиваем лишь верхний предел (>28%), чтобы альпийские области не перегружали значки.
            let cap_excess = |field: &mut [f32], ocean: &[u8], lake: &[u8], h_arr: &[f32], thr: f32, max_hi: f64| {
                let mut land_n = 0usize;
                let mut hi_n = 0usize;
                for i in 0..field.len() {
                    if ocean[i] == 0 && lake[i] == 0 && h_arr[i] > 0.06 {
                        land_n += 1;
                        if field[i] > thr {
                            hi_n += 1;
                        }
                    }
                }
                if land_n < 32 {
                    return;
                }
                let share = hi_n as f64 / land_n as f64;
                if share > max_hi {
                    let (mut l, mut r) = (0.20f32, 1.0f32);
                    for _ in 0..14 {
                        let m = 0.5 * (l + r);
                        let mut c = 0usize;
                        for i in 0..field.len() {
                            if ocean[i] == 0 && lake[i] == 0 && h_arr[i] > 0.06 && field[i] * m > thr {
                                c += 1;
                            }
                        }
                        if (c as f64 / land_n as f64) > max_hi { r = m; } else { l = m; }
                    }
                    let mul = 0.5 * (l + r);
                    for v in field.iter_mut() {
                        *v = (*v * mul).clamp(0.0, 1.5);
                    }
                }
            };
            cap_excess(&mut self.young, &self.ocean, &self.lake, &self.h, 0.20, 0.26);
            for i in 0..n {
                let high_sup = if self.h[i] > 0.92 { 0.15 } else { 1.0 };
                self.old[i] = (self.old[i] * (1.0 - 0.90 * self.young[i].min(1.0)) * high_sup).clamp(0.0, 1.2);
            }
            cap_excess(&mut self.old, &self.ocean, &self.lake, &self.h, 0.15, 0.24);
        }

        // Локальные максимумы вулканизма на суше
        let mut vcands = Vec::new();
        for y in 2..(gh - 2) {
            for x in 2..(gw - 2) {
                let i = y * gw + x;
                if self.ocean[i] != 0 || self.lake[i] != 0 || self.volcanic[i] < 0.62 || self.h[i] < 0.25 {
                    continue;
                }
                let v0 = self.volcanic[i];
                let mut is_max = true;
                for dy in -2isize..=2 {
                    for dx in -2isize..=2 {
                        if dx == 0 && dy == 0 {
                            continue;
                        }
                        if self.volcanic[(y as isize + dy) as usize * gw + (x as isize + dx) as usize] > v0 {
                            is_max = false;
                            break;
                        }
                    }
                    if !is_max {
                        break;
                    }
                }
                if is_max {
                    vcands.push((x, y, v0));
                }
            }
        }
        vcands.sort_by(|a, b| b.2.total_cmp(&a.2));
        for (vx, vy, vv) in vcands {
            if self.volcanoes.len() >= 10 {
                break;
            }
            let too_close = self
                .volcanoes
                .iter()
                .any(|&(ox, oy, _)| (ox - vx as f64).hypot(oy - vy as f64) < 26.0);
            if !too_close {
                self.volcanoes.push((vx as f64, vy as f64, vv >= 0.78));
            }
        }
    }
}

trait StatsTimeExt {
    fn stats_time(&self) -> f64;
}
impl StatsTimeExt for Planet {
    fn stats_time(&self) -> f64 {
        self.tectonic.stats.time
    }
}

// ---------- Marching Squares (порт contours из 0.89.0) + Chaikin + HandLoop2 ----------

fn marching_contours(f: &[f32], w: usize, h: usize, level: f32) -> Vec<(Vec<[f64; 2]>, bool)> {
    let mut adj: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut link = |a: usize, b: usize| {
        adj.entry(a).or_default().push(b);
        adj.entry(b).or_default().push(a);
    };
    for y in 0..(h - 1) {
        for x in 0..(w - 1) {
            let i = y * w + x;
            let m = (if f[i] > level { 8 } else { 0 })
                | (if f[i + 1] > level { 4 } else { 0 })
                | (if f[i + w + 1] > level { 2 } else { 0 })
                | (if f[i + w] > level { 1 } else { 0 });
            if m == 0 || m == 15 {
                continue;
            }
            let t = i * 2;
            let b = (i + w) * 2;
            let l = i * 2 + 1;
            let r = (i + 1) * 2 + 1;
            match m {
                1 | 14 => link(l, b),
                2 | 13 => link(b, r),
                3 | 12 => link(l, r),
                4 | 11 => link(t, r),
                5 => {
                    link(t, r);
                    link(l, b);
                }
                6 | 9 => link(t, b),
                7 | 8 => link(t, l),
                10 => {
                    link(t, l);
                    link(b, r);
                }
                _ => {}
            }
        }
    }

    let to_point = |k: usize| -> [f64; 2] {
        let idx = k >> 1;
        let x = idx % w;
        let y = idx / w;
        if (k & 1) != 0 {
            let a = (f[idx] - level) as f64;
            let b = (f[idx + w] - level) as f64;
            let t = if (a - b).abs() < 1e-6 { 0.5 } else { (a / (a - b)).clamp(0.0, 1.0) };
            [x as f64, y as f64 + t]
        } else {
            let a = (f[idx] - level) as f64;
            let b = (f[idx + 1] - level) as f64;
            let t = if (a - b).abs() < 1e-6 { 0.5 } else { (a / (a - b)).clamp(0.0, 1.0) };
            [x as f64 + t, y as f64]
        }
    };

    let edge_key = |a: usize, b: usize| -> (usize, usize) {
        if a < b { (a, b) } else { (b, a) }
    };

    let mut seen: HashSet<(usize, usize)> = HashSet::new();
    let mut keys: Vec<usize> = adj.keys().copied().collect();
    keys.sort_unstable();
    let mut out = Vec::new();

    // Открытые цепочки (касающиеся границ в Region-режиме)
    for &start in &keys {
        let nbs = &adj[&start];
        if nbs.len() != 1 {
            continue;
        }
        let next = nbs[0];
        if !seen.insert(edge_key(start, next)) {
            continue;
        }
        let mut chain = vec![to_point(start), to_point(next)];
        let (mut prev, mut cur) = (start, next);
        while let Some(cands) = adj.get(&cur) {
            let Some(&nx) = cands.iter().find(|&&v| v != prev && !seen.contains(&edge_key(cur, v))) else {
                break;
            };
            seen.insert(edge_key(cur, nx));
            chain.push(to_point(nx));
            prev = cur;
            cur = nx;
        }
        if chain.len() >= 2 {
            out.push((chain, false));
        }
    }

    // Замкнутые контуры
    for &start in &keys {
        for &next in &adj[&start] {
            if !seen.insert(edge_key(start, next)) {
                continue;
            }
            let mut loop_pts = vec![to_point(start), to_point(next)];
            let (mut prev, mut cur) = (start, next);
            while let Some(cands) = adj.get(&cur) {
                let Some(&nx) = cands.iter().find(|&&v| v != prev && !seen.contains(&edge_key(cur, v))) else {
                    break;
                };
                if nx == start {
                    seen.insert(edge_key(cur, nx));
                    break;
                }
                seen.insert(edge_key(cur, nx));
                loop_pts.push(to_point(nx));
                prev = cur;
                cur = nx;
            }
            if loop_pts.len() >= 3 {
                out.push((loop_pts, true));
            }
        }
    }
    out
}

fn chaikin_closed(mut pts: Vec<[f64; 2]>, iter: usize) -> Vec<[f64; 2]> {
    for _ in 0..iter {
        let n = pts.len();
        if n < 3 {
            break;
        }
        let mut out = Vec::with_capacity(n * 2);
        for i in 0..n {
            let p = pts[i];
            let q = pts[(i + 1) % n];
            out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
            out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
        }
        pts = out;
    }
    pts
}

fn chaikin_open(mut pts: Vec<[f64; 2]>, iter: usize) -> Vec<[f64; 2]> {
    for _ in 0..iter {
        let n = pts.len();
        if n < 3 {
            break;
        }
        let mut out = Vec::with_capacity(n * 2);
        out.push(pts[0]);
        for i in 0..(n - 1) {
            let p = pts[i];
            let q = pts[i + 1];
            out.push([0.75 * p[0] + 0.25 * q[0], 0.75 * p[1] + 0.25 * q[1]]);
            out.push([0.25 * p[0] + 0.75 * q[0], 0.25 * p[1] + 0.75 * q[1]]);
        }
        out.push(pts[n - 1]);
        pts = out;
    }
    pts
}

fn hand_loop2(
    grid: &ClassicGrid,
    raw: &[[f64; 2]],
    closed: bool,
    noise: &Noise2,
    amp: f64,
    in_padded_coords: bool,
) -> Vec<[f64; 2]> {
    let shift = if in_padded_coords { 1.0 } else { 0.0 };
    let [fx, fy, fw, fh] = grid.frame;
    let scaled: Vec<[f64; 2]> = raw
        .iter()
        .map(|p| {
            let gx = (p[0] - shift).clamp(0.0, (grid.gw - 1) as f64);
            let gy = (p[1] - shift).clamp(0.0, (grid.gh - 1) as f64);
            [grid.px(gx), grid.py(gy)]
        })
        .collect();
    let mut pts = if closed {
        chaikin_closed(scaled, 2)
    } else {
        chaikin_open(scaled, 2)
    };
    if closed && pts.len() > 80 {
        // Лёгкое снятие ступенек сетки (rad = 2), ослабленное на фьордах и рифтовых берегах, чтобы не «оплавлять» полуострова и бухты
        let m = pts.len();
        let rad = 2isize;
        let mut sm = Vec::with_capacity(m);
        for i in 0..m {
            let p0 = pts[i];
            let gx = ((p0[0] - fx) / grid.sx).round().clamp(0.0, (grid.gw - 1) as f64) as usize;
            let gy = ((p0[1] - fy) / grid.sy).round().clamp(0.0, (grid.gh - 1) as f64) as usize;
            let m_mod = grid.margin_mod[gy * grid.gw + gx] as f64;
            let keep_raw = ((m_mod - 0.95) * 0.85).clamp(0.0, 0.75);
            let (mut x, mut y, mut ws) = (0.0, 0.0, 0.0);
            for d in -rad..=rad {
                let wgt = (rad + 1 - d.abs()) as f64;
                let q = pts[(i as isize + d).rem_euclid(m as isize) as usize];
                x += q[0] * wgt;
                y += q[1] * wgt;
                ws += wgt;
            }
            let sx_m = x / ws;
            let sy_m = y / ws;
            sm.push([
                sx_m + (p0[0] - sx_m) * keep_raw,
                sy_m + (p0[1] - sy_m) * keep_raw,
            ]);
        }
        pts = sm;
    }
    let n = pts.len();
    if n < 3 {
        return pts;
    }
    let mut out = Vec::with_capacity(n);
    for i in 0..n {
        let p = pts[i];
        let on_edge = p[0] <= fx + 0.5 || p[0] >= fx + fw - 0.5 || p[1] <= fy + 0.5 || p[1] >= fy + fh - 0.5;
        if on_edge || (!closed && (i == 0 || i + 1 == n)) {
            out.push([clamp(p[0], fx, fx + fw), clamp(p[1], fy, fy + fh)]);
            continue;
        }
        let a = if closed {
            pts[(i + n - 2) % n]
        } else {
            pts[i.saturating_sub(2)]
        };
        let b = if closed {
            pts[(i + 2) % n]
        } else {
            pts[(i + 2).min(n - 1)]
        };
        let tx = b[0] - a[0];
        let ty = b[1] - a[1];
        let len = tx.hypot(ty).max(1e-6);
        let nx = -ty / len;
        let ny = tx / len;
        let gx = ((p[0] - fx) / grid.sx).round().clamp(0.0, (grid.gw - 1) as f64) as usize;
        let gy = ((p[1] - fy) / grid.sy).round().clamp(0.0, (grid.gh - 1) as f64) as usize;
        let m_mod = grid.margin_mod[gy * grid.gw + gx] as f64;
        let k_s = grid.scale_k;
        let w = (0.9 * noise.sample(p[0] * 0.03 / k_s, p[1] * 0.03 / k_s)
            + 0.6 * noise.sample(p[0] * 0.09 / k_s + 40.0, p[1] * 0.09 / k_s)
            + 0.4 * noise.sample(p[0] * 0.22 / k_s + 80.0, p[1] * 0.22 / k_s + 5.0))
            * amp
            * m_mod;
        out.push([
            clamp(p[0] + nx * w, fx, fx + fw),
            clamp(p[1] + ny * w, fy, fy + fh),
        ]);
    }
    out
}

fn coast_contours(
    grid: &ClassicGrid,
    noise: &Noise2,
) -> (Vec<Vec<[f64; 2]>>, Vec<(Vec<[f64; 2]>, bool)>, Vec<Vec<(Vec<[f64; 2]>, bool)>>) {
    // 1. Замкнутые полигоны суши из того же непрерывного поля `grid.h` (уровень 0.0) с внешней каймой -1.0
    let pw = grid.gw + 2;
    let ph = grid.gh + 2;
    let mut padded = vec![-1.0f32; pw * ph];
    for y in 0..grid.gh {
        for x in 0..grid.gw {
            let idx = y * grid.gw + x;
            padded[(y + 1) * pw + (x + 1)] = if grid.ocean[idx] == 0 {
                grid.h[idx].max(1e-3)
            } else {
                grid.h[idx].min(-1e-3)
            };
        }
    }
    let filled_raw = marching_contours(&padded, pw, ph, 0.0);
    let mut filled_loops = Vec::new();
    for (pts, closed) in filled_raw {
        if !closed || pts.len() < 4 {
            continue;
        }
        let lp = hand_loop2(grid, &pts, true, noise, 1.5 * grid.scale_k, true);
        if lp.len() >= 4 {
            filled_loops.push(lp);
        }
    }

    // 2. Внутренние береговые контуры без рамки для штриха береговой линии
    let stroke_raw = marching_contours(&grid.h, grid.gw, grid.gh, 0.0);
    let mut coast_strokes = Vec::new();
    for (pts, closed) in stroke_raw {
        if pts.len() < 4 {
            continue;
        }
        let lp = hand_loop2(grid, &pts, closed, noise, 1.5 * grid.scale_k, false);
        coast_strokes.push((lp, closed));
    }

    // 3. Три концентрических ореола для Ч/Б
    let mut halo_sets = Vec::with_capacity(3);
    for lv in [1.7f32, 3.6, 5.9] {
        let field: Vec<f32> = grid.dist_blur1.iter().map(|&d| lv - d).collect();
        let raw = marching_contours(&field, grid.gw, grid.gh, 0.0);
        let mut set = Vec::new();
        for (pts, closed) in raw {
            if pts.len() < 4 {
                continue;
            }
            let lp = hand_loop2(grid, &pts, closed, noise, 1.1 * grid.scale_k, false);
            set.push((lp, closed));
        }
        halo_sets.push(set);
    }

    (filled_loops, coast_strokes, halo_sets)
}

// ---------- Сканирующая маска суши для безшовного растра base_rgb ----------

fn rasterize_land_mask(w: usize, h: usize, loops: &[Vec<[f64; 2]>]) -> Vec<u8> {
    let mut mask = vec![0u8; w * h];
    let mut xs = Vec::with_capacity(64);
    for y in 0..h {
        let py = y as f64 + 0.5;
        xs.clear();
        for poly in loops {
            let n = poly.len();
            if n < 3 {
                continue;
            }
            for i in 0..n {
                let a = poly[i];
                let b = poly[(i + 1) % n];
                if (a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py) {
                    let x = a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]);
                    xs.push(x);
                }
            }
        }
        if xs.len() < 2 {
            continue;
        }
        xs.sort_by(|a, b| a.total_cmp(b));
        let row = y * w;
        for pair in xs.chunks_exact(2) {
            let x0 = (pair[0].round() as isize).clamp(0, w as isize) as usize;
            let x1 = (pair[1].round() as isize).clamp(0, w as isize) as usize;
            for x in x0..x1 {
                mask[row + x] = 1;
            }
        }
    }
    mask
}

// ---------- Базовый растр: бумага, вода или гипсометрия, зерно, виньетка ----------

const HYPS: &[(f64, [f64; 3])] = &[
    (0.0, [126.0, 162.0, 104.0]),
    (0.14, [148.0, 178.0, 114.0]),
    (0.38, [184.0, 194.0, 130.0]),
    (0.66, [206.0, 190.0, 128.0]),
    (0.95, [186.0, 156.0, 110.0]),
    (1.28, [156.0, 128.0, 96.0]),
    (1.56, [182.0, 172.0, 162.0]),
    (1.82, [224.0, 224.0, 220.0]),
];

pub(crate) fn hyps_color(hv: f64) -> [f64; 3] {
    if hv <= HYPS[0].0 {
        return HYPS[0].1;
    }
    for w in HYPS.windows(2) {
        if hv <= w[1].0 {
            let t = (hv - w[0].0) / (w[1].0 - w[0].0);
            return lerp3(w[0].1, w[1].1, t);
        }
    }
    HYPS[HYPS.len() - 1].1
}

pub(crate) fn biome_tint(code: u8) -> Option<([f64; 3], f64)> {
    match code {
        1 => Some(([224.0, 228.0, 232.0], 0.24)),
        2 => Some(([190.0, 196.0, 178.0], 0.30)),
        6 => Some(([218.0, 200.0, 150.0], 0.45)),
        9 => Some(([124.0, 150.0, 116.0], 0.35)),
        8 => Some(([98.0, 146.0, 94.0], 0.28)),
        3 => Some(([122.0, 158.0, 116.0], 0.20)),
        _ => None,
    }
}

fn paint_base_raster(
    grid: &ClassicGrid,
    th: &ClassicTheme,
    land_mask: &[u8],
    noise: &Noise2,
    seed: &str,
) -> Vec<u8> {
    let w = grid.canvas_w;
    let h = grid.canvas_h;
    let [fx, fy, fw, fh] = grid.frame;
    let mut rgb = vec![0u8; w * h * 3];

    // Бумага 1/5 разрешения (точный алгоритм getPaper из render.js)
    let lw = (w + 4) / 5;
    let lh = (h + 4) / 5;
    let p_noise = Noise2::new(&format!("{seed}|paper"));
    let mut low_paper = vec![[0.0f64; 3]; lw * lh];
    for y in 0..lh {
        for x in 0..lw {
            let n = 0.6 * p_noise.fbm(x as f64 * 0.018, y as f64 * 0.018, 4)
                + 0.4 * p_noise.fbm(x as f64 * 0.08 + 7.0, y as f64 * 0.08 + 3.0, 3);
            let d = n * th.paper_var;
            low_paper[y * lw + x] = [th.paper[0] + d, th.paper[1] + d, th.paper[2] + d * 1.1];
        }
    }

    // Сглаженное поле высот для деликатной северо-западной отмывки рельефа в стилях Сепия и Ч/Б
    let h_wash: Vec<f32> = if !th.is_color {
        let gw = grid.gw;
        let gh = grid.gh;
        let mut tmp = vec![0.0f32; gw * gh];
        let mut out = vec![0.0f32; gw * gh];
        for y in 0..gh {
            for x in 0..gw {
                let x0 = x.saturating_sub(2);
                let x1 = (x + 2).min(gw - 1);
                let mut s = 0.0f32;
                for xx in x0..=x1 { s += grid.h[y * gw + xx]; }
                tmp[y * gw + x] = s / (x1 - x0 + 1) as f32;
            }
        }
        for y in 0..gh {
            let y0 = y.saturating_sub(2);
            let y1 = (y + 2).min(gh - 1);
            for x in 0..gw {
                let mut s = 0.0f32;
                for yy in y0..=y1 { s += tmp[yy * gw + x]; }
                out[y * gw + x] = s / (y1 - y0 + 1) as f32;
            }
        }
        out
    } else {
        Vec::new()
    };

    // Цветная основа суши для Style::Color (gameTerrain из render_game.js)
    let color_col: Vec<[f64; 3]> = if th.is_color {
        let mut out = vec![[0.0; 3]; grid.gw * grid.gh];
        for i in 0..(grid.gw * grid.gh) {
            let hv = (grid.h[i] as f64).max(0.0);
            let gx = (i % grid.gw) as f64;
            let gy = (i / grid.gw) as f64;
            let mut c = hyps_color(hv);
            if let Some((bt, wt)) = biome_tint(grid.biome[i]) {
                if hv < 1.1 {
                    c = lerp3(c, bt, wt);
                }
            }
            let lum = 0.3 * c[0] + 0.59 * c[1] + 0.11 * c[2];
            c[0] += (lum - c[0]) * 0.2;
            c[1] += (lum - c[1]) * 0.2;
            c[2] += (lum - c[2]) * 0.2;
            let tone = 1.0 + 0.03 * noise.fbm(gx * 0.09 + 40.0, gy * 0.09, 3);
            out[i] = [c[0] * tone, c[1] * tone, c[2] * tone];
        }
        // Двухпроходное сглаживание цветовой подложки биомов (убирает пиксельные квадраты на региональном зуме)
        let gw = grid.gw;
        let gh = grid.gh;
        let mut tmp = vec![[0.0; 3]; gw * gh];
        for _ in 0..2 {
            for y in 0..gh {
                for x in 0..gw {
                    let x0 = x.saturating_sub(3);
                    let x1 = (x + 3).min(gw - 1);
                    let mut s = [0.0; 3];
                    let cnt = (x1 - x0 + 1) as f64;
                    for xx in x0..=x1 {
                        let c = out[y * gw + xx];
                        s[0] += c[0];
                        s[1] += c[1];
                        s[2] += c[2];
                    }
                    tmp[y * gw + x] = [s[0] / cnt, s[1] / cnt, s[2] / cnt];
                }
            }
            for y in 0..gh {
                let y0 = y.saturating_sub(3);
                let y1 = (y + 3).min(gh - 1);
                let cnt = (y1 - y0 + 1) as f64;
                for x in 0..gw {
                    let mut s = [0.0; 3];
                    for yy in y0..=y1 {
                        let c = tmp[yy * gw + x];
                        s[0] += c[0];
                        s[1] += c[1];
                        s[2] += c[2];
                    }
                    out[y * gw + x] = [s[0] / cnt, s[1] / cnt, s[2] / cnt];
                }
            }
        }
        out
    } else {
        Vec::new()
    };

    let sample_paper = |px: usize, py: usize| -> [f64; 3] {
        let fx_p = ((px as f64 / w as f64) * lw as f64 - 0.5).clamp(0.0, (lw - 2).max(0) as f64);
        let fy_p = ((py as f64 / h as f64) * lh as f64 - 0.5).clamp(0.0, (lh - 2).max(0) as f64);
        let x0 = fx_p.floor() as usize;
        let y0 = fy_p.floor() as usize;
        let x1 = (x0 + 1).min(lw - 1);
        let y1 = (y0 + 1).min(lh - 1);
        let tx = fx_p - x0 as f64;
        let ty = fy_p - y0 as f64;
        let top = lerp3(low_paper[y0 * lw + x0], low_paper[y0 * lw + x1], tx);
        let bot = lerp3(low_paper[y1 * lw + x0], low_paper[y1 * lw + x1], tx);
        lerp3(top, bot, ty)
    };

    let vig_r0 = 0.35 * (w.min(h) as f64);
    let vig_r1 = 0.55 * (w as f64).hypot(h as f64);
    let mut grain_tbl = vec![1.0f64; 65536];
    let mut g_rng = Mulberry32::from_seed("grain-12345");
    for v in &mut grain_tbl {
        *v = 1.0 - g_rng.next() * th.grain;
    }

    for py in 0..h {
        let y_f = py as f64 + 0.5;
        let dy_c = y_f - h as f64 * 0.5;
        let in_y = y_f >= fy && y_f <= fy + fh;
        let gy_f = clamp((y_f - fy) / grid.sy, 0.0, (grid.gh - 2) as f64);
        for px in 0..w {
            let x_f = px as f64 + 0.5;
            let in_fr = in_y && x_f >= fx && x_f <= fx + fw;
            let idx = py * w + px;
            let gx_f = clamp((x_f - fx) / grid.sx, 0.0, (grid.gw - 2) as f64);

            // Мягкое 5-точечное сглаживание по краю береговой маски (субпиксельный AA)
            let is_land_f = if in_fr {
                if px > 0 && px + 1 < w && py > 0 && py + 1 < h {
                    let c0 = land_mask[idx];
                    let sum = c0 * 2 + land_mask[idx - 1] + land_mask[idx + 1] + land_mask[idx - w] + land_mask[idx + w];
                    sum as f64 / 6.0
                } else {
                    land_mask[idx] as f64
                }
            } else {
                1.0
            };

            let mut col = sample_paper(px, py);
            if in_fr {
                if th.is_color {
                    let mut land_c = [0.0; 3];
                    if is_land_f > 0.0 {
                        let x0 = gx_f.floor() as usize;
                        let y0 = gy_f.floor() as usize;
                        let u = gx_f - x0 as f64;
                        let v = gy_f - y0 as f64;
                        let i0 = y0 * grid.gw + x0;
                        let top = lerp3(color_col[i0], color_col[i0 + 1], u);
                        let bot = lerp3(color_col[i0 + grid.gw], color_col[i0 + grid.gw + 1], u);
                        let base = lerp3(top, bot, v);
                        let dx = grid.bil(&grid.h, gx_f + 0.6, gy_f) - grid.bil(&grid.h, gx_f - 0.6, gy_f);
                        let dy = grid.bil(&grid.h, gx_f, gy_f + 0.6) - grid.bil(&grid.h, gx_f, gy_f - 0.6);
                        let sh = clamp(-(dx * 0.75 + dy * 0.75) * 4.4, -1.0, 1.0);
                        let m = 1.0 + if sh > 0.0 { sh * 0.20 } else { sh * 0.50 };
                        let cool = if sh < 0.0 { 1.0 - sh * 0.07 } else { 1.0 };
                        let nz = 1.0 + 0.012 * noise.sample(x_f * 0.35 / grid.scale_k, y_f * 0.35 / grid.scale_k);
                        land_c = [base[0] * m * nz / cool, base[1] * m * nz, base[2] * m * nz * cool];
                    }
                    let mut wat_c = [0.0; 3];
                    if is_land_f < 1.0 {
                        let dd = grid.bil(&grid.dist_blur3, gx_f, gy_f);
                        let t = smooth(0.0, 34.0, dd);
                        let s2 = 1.0 - smooth(0.0, 3.2, dd);
                        let wn = 1.0 + 0.01 * noise.sample(x_f * 0.12 / grid.scale_k + 99.0, y_f * 0.12 / grid.scale_k);
                        wat_c = [
                            (182.0 + (112.0 - 182.0) * t + s2 * 24.0) * wn,
                            (210.0 + (150.0 - 210.0) * t + s2 * 12.0) * wn,
                            (220.0 + (178.0 - 220.0) * t + s2 * 6.0) * wn,
                        ];
                    }
                    col = lerp3(wat_c, land_c, is_land_f);
                } else {
                    if is_land_f > 0.0 {
                        let dx = grid.bil(&h_wash, gx_f + 1.0, gy_f) - grid.bil(&h_wash, gx_f - 1.0, gy_f);
                        let dy = grid.bil(&h_wash, gx_f, gy_f + 1.0) - grid.bil(&h_wash, gx_f, gy_f - 1.0);
                        let hv = grid.bil(&h_wash, gx_f, gy_f).max(0.0);
                        let sh = clamp(-(dx * 0.72 + dy * 0.72) * 3.1, -1.0, 1.0);
                        let elev_wash = smooth(0.30, 1.25, hv);
                        if th.hatch {
                            // Тёплая деликатная отмывка складок и возвышенностей в Сепии без ряби
                            let d_lum = if sh > 0.0 { sh * 4.5 } else { sh * 11.0 } - elev_wash * 6.0;
                            col[0] += d_lum;
                            col[1] += d_lum * 1.02;
                            col[2] += d_lum * 1.08;
                        } else {
                            // Строго нейтральный Ч/Б тон отмывки рельефа
                            let d_lum = if sh > 0.0 { sh * 2.2 } else { sh * 7.2 } - elev_wash * 3.5;
                            col[0] += d_lum;
                            col[1] += d_lum;
                            col[2] += d_lum;
                        }
                    }
                    if is_land_f < 1.0 {
                        let dd = grid.bil(&grid.dist, gx_f, gy_f);
                        let t = smooth(2.0, 28.0, dd);
                        let n_w = noise.fbm(gx_f * 0.05, gy_f * 0.05, 3) * 3.0;
                        let wat_c = [
                            th.water_near[0] + (th.water_far[0] - th.water_near[0]) * t + n_w,
                            th.water_near[1] + (th.water_far[1] - th.water_near[1]) * t + n_w,
                            th.water_near[2] + (th.water_far[2] - th.water_near[2]) * t + n_w,
                        ];
                        col = lerp3(wat_c, col, is_land_f);
                    }
                }
            }

            if th.vignette > 0.0 {
                let d_c = (x_f - w as f64 * 0.5).hypot(dy_c);
                let vt = ((d_c - vig_r0) / (vig_r1 - vig_r0).max(1.0)).clamp(0.0, 1.0);
                let va = vt * vt * th.vignette;
                col = lerp3(col, [60.0, 45.0, 30.0], va);
            }
            let gm = grain_tbl[(py & 255) * 256 + (px & 255)];
            let off = idx * 3;
            rgb[off] = (col[0] * gm).round().clamp(0.0, 255.0) as u8;
            rgb[off + 1] = (col[1] * gm).round().clamp(0.0, 255.0) as u8;
            rgb[off + 2] = (col[2] * gm).round().clamp(0.0, 255.0) as u8;
        }
    }
    rgb
}

// ---------- Расстановка и рисование символов рельефа и лесов (0.89.0 render_symbols.js) ----------

#[derive(Clone, Copy, PartialEq, Eq)]
enum FeatKind {
    Mountain,
    Hill,
    Downs,
    Volcano,
    Tree,
    Conifer,
    Jungle,
    Acacia,
    Tuft,
    Dune,
    Ice,
    Swamp,
}

struct FeatItem {
    kind: FeatKind,
    active: bool,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: [f64; 14],
    s: f64,
}

fn place_features(grid: &ClassicGrid, noise: &Noise2, seed: &str) -> Vec<FeatItem> {
    let mut rand = Mulberry32::from_seed(&format!("{seed}|features"));
    let rnoise = Noise2::new(&format!("{seed}|range"));
    let gw = grid.gw;
    let gh = grid.gh;
    let [fx, fy, fw, fh] = grid.frame;
    let k = grid.scale_k;
    let sp = 14.8 * k;
    let mut mtn_bins: HashMap<i64, [f64; 2]> = HashMap::new();
    let vs: Vec<[f64; 2]> = grid
        .volcanoes
        .iter()
        .map(|&(vx, vy, _)| [grid.px(vx), grid.py(vy)])
        .collect();
    let near_v = |x: f64, y: f64, d_g: f64| -> bool {
        let th2 = (d_g * grid.sx).powi(2);
        vs.iter().any(|v| (v[0] - x).powi(2) + (v[1] - y).powi(2) < th2)
    };

    let mut items = Vec::new();
    let mut py = fy + sp;
    while py < fy + fh - sp {
        let mut px = fx + sp;
        while px < fx + fw - sp {
            let mut x = px + (rand.next() - 0.5) * sp * 1.5;
            let mut y = py + (rand.next() - 0.5) * sp * 1.5;
            let gx = (((x - fx) / grid.sx).round() as isize).clamp(0, gw as isize - 1) as usize;
            let gy = (((y - fy) / grid.sy).round() as isize).clamp(0, gh as isize - 1) as usize;
            let i = gy * gw + gx;
            if grid.h[i] < 0.05 || grid.lake[i] != 0 {
                rand.next();
                rand.next();
                px += sp;
                continue;
            }
            let ym = grid.young[i] as f64;
            let om = grid.old[i] as f64;
            let mut r = [0.0f64; 14];
            for slot in &mut r {
                *slot = rand.next();
            }
            if ym > 0.20 {
                let s = smooth(0.20, 0.92, ym);
                if r[13] <= 0.46 + 0.50 * s && !near_v(x, y, 9.0) {
                    let (mut cx, mut cy) = (x, y);
                    for _ in 0..3 {
                        let qx = (((cx - fx) / grid.sx).round() as isize).clamp(1, gw as isize - 2) as usize;
                        let qy = (((cy - fy) / grid.sy).round() as isize).clamp(1, gh as isize - 2) as usize;
                        let q = qy * gw + qx;
                        let gx_v = (grid.young[q + 1] - grid.young[q - 1]) as f64;
                        let gy_v = (grid.young[q + gw] - grid.young[q - gw]) as f64;
                        let gl = gx_v.hypot(gy_v);
                        if gl < 0.004 {
                            break;
                        }
                        cx += gx_v / gl * grid.sx * 1.3;
                        cy += gy_v / gl * grid.sy * 1.3;
                    }
                    let kx = (cx / (sp * 0.9)).floor() as i64;
                    let ky = (cy / (sp * 0.9)).floor() as i64;
                    let mut busy = false;
                    let min_d2 = (sp * 0.90).powi(2);
                    for ay in -1..=1 {
                        for ax in -1..=1 {
                            if let Some(o) = mtn_bins.get(&((ky + ay) * 4096 + (kx + ax))) {
                                if (o[0] - cx).powi(2) + (o[1] - cy).powi(2) < min_d2 {
                                    busy = true;
                                    break;
                                }
                            }
                        }
                        if busy {
                            break;
                        }
                    }
                    if !busy {
                        mtn_bins.insert(ky * 4096 + kx, [cx, cy]);
                        x = clamp(cx, fx + 4.0 * k, fx + fw - 4.0 * k);
                        y = clamp(cy, fy + 16.0 * k, fy + fh - 4.0 * k);
                        let mult = 0.78 + 0.48 * (rnoise.fbm(x * 0.03 / k, y * 0.03 / k, 2) * 0.5 + 0.5);
                        let w_m = (18.0 + 32.0 * s.powf(1.25)) * mult * (0.85 + 0.32 * r[12]) * k;
                        items.push(FeatItem {
                            kind: FeatKind::Mountain,
                            active: false,
                            x,
                            y,
                            w: w_m,
                            h: w_m * (0.64 + 0.30 * r[11]),
                            r,
                            s,
                        });
                    }
                }
            } else if (om > 0.14 || ym > 0.10) && !near_v(x, y, 6.0) {
                let s = smooth(0.12, 0.72, om.max(ym));
                if r[13] <= 0.14 + 0.42 * s {
                    let w_h = (11.5 + 9.5 * s) * (0.8 + 0.4 * r[12]) * k;
                    items.push(FeatItem {
                        kind: FeatKind::Hill,
                        active: false,
                        x,
                        y,
                        w: w_h,
                        h: w_h * (0.38 + 0.12 * r[11]),
                        r,
                        s,
                    });
                }
            } else if (grid.h[i] > 0.24 || om > 0.08) && !near_v(x, y, 6.0) {
                // Мягкие волнистые увалы и взгорья на возвышенных равнинах и водоразделах
                let cl_d = smooth(0.15, 0.65, rnoise.fbm(x * 0.018 / k, y * 0.018 / k, 2) * 0.5 + 0.5);
                let elev_s = smooth(0.22, 0.68, grid.h[i] as f64);
                if r[13] <= (0.04 + 0.12 * elev_s) * cl_d {
                    let w_d = (14.0 + 10.0 * r[12]) * k;
                    items.push(FeatItem {
                        kind: FeatKind::Downs,
                        active: false,
                        x,
                        y,
                        w: w_d,
                        h: w_d * (0.20 + 0.06 * r[11]),
                        r,
                        s: 0.25,
                    });
                }
            }
            px += sp;
        }
        py += sp;
    }

    // Биомы и леса (сгруппированные рощи, гряды дюн и луговые волны без точечного шума)
    let mut trand = Mulberry32::from_seed(&format!("{seed}|trees"));
    let tnoise = Noise2::new(&format!("{seed}|treenoise"));
    let ts = 9.4 * k;
    let mut py = fy + ts;
    while py < fy + fh - ts {
        let mut px = fx + ts;
        while px < fx + fw - ts {
            let x = px + (trand.next() - 0.5) * ts * 1.45;
            let y = py + (trand.next() - 0.5) * ts * 1.45;
            let rr = trand.next();
            let rs = trand.next();
            let gx = (((x - fx) / grid.sx).round() as isize).clamp(0, gw as isize - 1) as usize;
            let gy = (((y - fy) / grid.sy).round() as isize).clamp(0, gh as isize - 1) as usize;
            let i = gy * gw + gx;
            if grid.h[i] < 0.06
                || grid.lake[i] != 0
                || grid.young[i] > 0.15
                || grid.old[i] > 0.26
                || grid.river_mask[i] != 0
                || near_v(x, y, 5.0)
            {
                px += ts;
                continue;
            }
            let cl = smooth(0.08, 0.48, tnoise.fbm((x - fx) / grid.sx * 0.034, (y - fy) / grid.sy * 0.034, 3));
            let bm = grid.biome[i];
            let mo = grid.moist[i] as f64;
            let (kind, p, sz) = match bm {
                4 => (Some(FeatKind::Tree), (0.30 + 0.55 * smooth(0.20, 0.72, mo)) * cl * 0.82, 1.0),
                3 => (Some(FeatKind::Conifer), (0.34 + 0.50 * smooth(0.18, 0.70, mo)) * cl * 0.85, 1.0),
                8 => (Some(FeatKind::Jungle), (0.42 + 0.46 * cl) * smooth(0.30, 0.78, mo), 1.12),
                7 => (Some(FeatKind::Acacia), 0.11 * smooth(0.22, 0.70, cl), 1.0),
                5 => {
                    if mo > 0.52 && cl > 0.65 {
                        (Some(FeatKind::Tree), 0.14 * cl, 0.92)
                    } else {
                        (Some(FeatKind::Tuft), 0.12 * smooth(0.26, 0.74, cl), 0.85)
                    }
                }
                9 => (Some(FeatKind::Swamp), 0.30 * (0.35 + 0.65 * cl), 1.0),
                2 => (Some(FeatKind::Tuft), 0.085 * smooth(0.24, 0.72, cl), 0.75),
                6 => (Some(FeatKind::Dune), 0.15 * smooth(0.22, 0.70, cl), 1.45),
                1 => (Some(FeatKind::Ice), 0.065 * smooth(0.25, 0.72, cl), 1.18),
                _ => (None, 0.0, 1.0),
            };
            if let Some(fk) = kind {
                if rr <= p {
                    let hh = (8.0 + 4.0 * rs) * k * sz;
                    let w_f = hh * match fk {
                        FeatKind::Tree => 0.38,
                        FeatKind::Conifer => 0.34,
                        FeatKind::Jungle => 0.50,
                        FeatKind::Acacia => 0.70,
                        FeatKind::Tuft => 0.90,
                        FeatKind::Swamp => 1.10,
                        _ => 1.30,
                    };
                    let h_f = match fk {
                        FeatKind::Acacia => hh * 0.70,
                        FeatKind::Tuft | FeatKind::Dune | FeatKind::Ice | FeatKind::Swamp => hh * 0.50,
                        _ => hh,
                    };
                    items.push(FeatItem {
                        kind: fk,
                        active: false,
                        x,
                        y,
                        w: w_f,
                        h: h_f,
                        r: [rs; 14],
                        s: 0.0,
                    });
                }
            }
            px += ts;
        }
        py += ts;
    }

    for &(vx, vy, active) in &grid.volcanoes {
        let w_v = 38.0 * k;
        items.push(FeatItem {
            kind: FeatKind::Volcano,
            active,
            x: grid.px(vx),
            y: grid.py(vy) + w_v * 0.3,
            w: w_v,
            h: w_v * 0.62,
            r: [0.5; 14],
            s: 1.0,
        });
    }

    let _ = noise;
    items.sort_by(|a, b| a.y.total_cmp(&b.y));
    items
}

// ---------- Примитивы SVG/Растр отрисовки символов ----------

#[derive(Default)]
struct PathBatch {
    d: String,
}

impl PathBatch {
    fn move_line(&mut self, p0: [f64; 2], p1: [f64; 2]) {
        let _ = write!(self.d, "M{:.1},{:.1} L{:.1},{:.1} ", p0[0], p0[1], p1[0], p1[1]);
    }
    fn polyline(&mut self, pts: &[[f64; 2]], closed: bool) {
        if pts.len() < 2 {
            return;
        }
        let _ = write!(self.d, "M{:.1},{:.1}", pts[0][0], pts[0][1]);
        for p in &pts[1..] {
            let _ = write!(self.d, " L{:.1},{:.1}", p[0], p[1]);
        }
        if closed {
            self.d.push('Z');
        }
        self.d.push(' ');
    }
}

struct MiniCanvas<'a> {
    w: usize,
    clip: [usize; 4],
    rgb: &'a mut [u8],
}

impl<'a> MiniCanvas<'a> {
    fn blend_px(&mut self, x: isize, y: isize, col: [f64; 3], alpha: f64) {
        if x < self.clip[0] as isize
            || x >= self.clip[2] as isize
            || y < self.clip[1] as isize
            || y >= self.clip[3] as isize
            || alpha <= 0.005
        {
            return;
        }
        let a = alpha.clamp(0.0, 1.0);
        let i = (y as usize * self.w + x as usize) * 3;
        self.rgb[i] = (self.rgb[i] as f64 * (1.0 - a) + col[0] * a).round().clamp(0.0, 255.0) as u8;
        self.rgb[i + 1] = (self.rgb[i + 1] as f64 * (1.0 - a) + col[1] * a).round().clamp(0.0, 255.0) as u8;
        self.rgb[i + 2] = (self.rgb[i + 2] as f64 * (1.0 - a) + col[2] * a).round().clamp(0.0, 255.0) as u8;
    }

    fn stroke_seg(&mut self, p0: [f64; 2], p1: [f64; 2], col: [f64; 3], width: f64, alpha: f64) {
        let hw = (width * 0.5).max(0.42);
        let x0 = (p0[0].min(p1[0]) - hw - 1.0).floor() as isize;
        let x1 = (p0[0].max(p1[0]) + hw + 1.0).ceil() as isize;
        let y0 = (p0[1].min(p1[1]) - hw - 1.0).floor() as isize;
        let y1 = (p0[1].max(p1[1]) + hw + 1.0).ceil() as isize;
        let vx = p1[0] - p0[0];
        let vy = p1[1] - p0[1];
        let len2 = (vx * vx + vy * vy).max(1e-6);
        for y in y0.max(self.clip[1] as isize)..y1.min(self.clip[3] as isize) {
            let py = y as f64 + 0.5;
            for x in x0.max(self.clip[0] as isize)..x1.min(self.clip[2] as isize) {
                let px = x as f64 + 0.5;
                let t = (((px - p0[0]) * vx + (py - p0[1]) * vy) / len2).clamp(0.0, 1.0);
                let d = (px - (p0[0] + vx * t)).hypot(py - (p0[1] + vy * t));
                if d <= hw + 0.65 {
                    let aa = (1.0 - (d - hw).max(0.0) / 0.65).clamp(0.0, 1.0);
                    self.blend_px(x, y, col, aa * alpha);
                }
            }
        }
    }

    fn stroke_poly(&mut self, pts: &[[f64; 2]], closed: bool, col: [f64; 3], width: f64, alpha: f64) {
        for w in pts.windows(2) {
            self.stroke_seg(w[0], w[1], col, width, alpha);
        }
        if closed && pts.len() >= 3 {
            self.stroke_seg(pts[pts.len() - 1], pts[0], col, width, alpha);
        }
    }

    fn stroke_dashed(&mut self, pts: &[[f64; 2]], dash: f64, gap: f64, col: [f64; 3], width: f64, alpha: f64) {
        let period = (dash + gap).max(1.0);
        let mut acc = 0.0;
        for w in pts.windows(2) {
            let dx = w[1][0] - w[0][0];
            let dy = w[1][1] - w[0][1];
            let len = dx.hypot(dy);
            if len < 0.2 {
                continue;
            }
            let steps = (len / 2.0).ceil().max(1.0) as usize;
            let mut prev = w[0];
            for s in 1..=steps {
                let t = s as f64 / steps as f64;
                let cur = [w[0][0] + dx * t, w[0][1] + dy * t];
                let d = len / steps as f64;
                if (acc % period) <= dash {
                    self.stroke_seg(prev, cur, col, width, alpha);
                }
                acc += d;
                prev = cur;
            }
        }
    }

    fn fill_poly(&mut self, pts: &[[f64; 2]], col: [f64; 3], alpha: f64) {
        if pts.len() < 3 {
            return;
        }
        let mut min_y = f64::INFINITY;
        let mut max_y = f64::NEG_INFINITY;
        for p in pts {
            min_y = min_y.min(p[1]);
            max_y = max_y.max(p[1]);
        }
        let y0 = (min_y.floor() as isize).max(self.clip[1] as isize) as usize;
        let y1 = (max_y.ceil() as isize).min(self.clip[3] as isize) as usize;
        let n = pts.len();
        let mut xs = Vec::with_capacity(16);
        for y in y0..y1 {
            let py = y as f64 + 0.5;
            xs.clear();
            for i in 0..n {
                let a = pts[i];
                let b = pts[(i + 1) % n];
                if (a[1] <= py && b[1] > py) || (b[1] <= py && a[1] > py) {
                    xs.push(a[0] + (py - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
                }
            }
            xs.sort_by(|a, b| a.total_cmp(b));
            for pair in xs.chunks_exact(2) {
                let x0 = (pair[0].floor() as isize).max(self.clip[0] as isize);
                let x1 = (pair[1].ceil() as isize).min(self.clip[2] as isize);
                for x in x0..x1 {
                    self.blend_px(x, y as isize, col, alpha);
                }
            }
        }
    }

    fn fill_circle(&mut self, cx: f64, cy: f64, r: f64, col: [f64; 3], alpha: f64) {
        let x0 = (cx - r - 1.0).floor() as isize;
        let x1 = (cx + r + 1.0).ceil() as isize;
        let y0 = (cy - r - 1.0).floor() as isize;
        let y1 = (cy + r + 1.0).ceil() as isize;
        for y in y0.max(self.clip[1] as isize)..y1.min(self.clip[3] as isize) {
            let dy = (y as f64 + 0.5) - cy;
            for x in x0.max(self.clip[0] as isize)..x1.min(self.clip[2] as isize) {
                let dx = (x as f64 + 0.5) - cx;
                let d = dx.hypot(dy);
                if d <= r + 0.65 {
                    let aa = (1.0 - (d - r).max(0.0) / 0.65).clamp(0.0, 1.0);
                    self.blend_px(x, y, col, aa * alpha);
                }
            }
        }
    }
}

fn coast_w_est(th: &ClassicTheme) -> f64 {
    if th.is_color { 1.1 } else { 1.6 }
}

fn poly_at(arr: &[[f64; 2]], t: f64) -> [f64; 2] {
    let f = clamp(t, 0.0, 1.0) * (arr.len() - 1) as f64;
    let i = (f.floor() as usize).min(arr.len() - 2);
    let u = f - i as f64;
    [
        arr[i][0] + (arr[i + 1][0] - arr[i][0]) * u,
        arr[i][1] + (arr[i + 1][1] - arr[i][1]) * u,
    ]
}

fn emit_peak(
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    r: &[f64; 14],
    th: &ClassicTheme,
    k: f64,
    fill_batch: &mut PathBatch,
    shade_light: &mut PathBatch,
    shade_dark: &mut PathBatch,
    hatch_thin: &mut PathBatch,
    outline: &mut PathBatch,
    ridge_mid: &mut PathBatch,
    ridge_fine: &mut PathBatch,
    cv: &mut MiniCanvas<'_>,
) {
    let hw = w * 0.5;
    let big = h > 16.0 * k;
    let tall = h > 24.0 * k;
    let rf = |i: usize| r[i % 14];
    let ax = x + (rf(0) - 0.5) * w * 0.22;
    let ay = y - h;

    let ridge = |bx: f64, by: f64, seed: usize, wob: f64| -> Vec<[f64; 2]> {
        let mut pts = Vec::with_capacity(5);
        pts.push([ax, ay]);
        for j in 1..=4 {
            let t = j as f64 / 4.0;
            pts.push([
                ax + (bx - ax) * t.powf(1.15)
                    + (rf(seed + j) - 0.5) * w * wob * if j < 4 { 1.0 } else { 0.3 },
                ay + (by - ay) * t + (rf(seed + j + 5) - 0.5) * h * 0.03,
            ]);
        }
        pts
    };

    let l = ridge(x - hw, y, 1, 0.13);
    let rr = ridge(x + hw, y + (rf(6) - 0.5) * h * 0.05, 7, 0.13);
    let m = ridge(ax + (rf(2) - 0.35) * w * 0.14, y + h * 0.04, 3, 0.07);
    let n_r = if big {
        Some(ridge(x + hw * (0.35 + 0.25 * rf(4)), y + h * 0.03, 5, 0.07))
    } else {
        None
    };

    let mut sil = Vec::with_capacity(11);
    for i in (0..=4).rev() {
        sil.push(l[i]);
    }
    for i in 1..=4 {
        sil.push(rr[i]);
    }
    sil.push([x, y + h * 0.065]);
    fill_batch.polyline(&sil, true);
    let base_alpha = if th.is_color { 0.86 } else { 1.0 };
    cv.fill_poly(&sil, th.sym_paper, base_alpha);

    let facet_poly = |p: &[[f64; 2]], q: &[[f64; 2]]| -> Vec<[f64; 2]> {
        let mut fp = Vec::with_capacity(p.len() + q.len());
        fp.extend_from_slice(p);
        fp.extend(q.iter().rev().copied());
        fp
    };
    if let Some(nr) = &n_r {
        let fp1 = facet_poly(&m, nr);
        let fp2 = facet_poly(nr, &rr);
        shade_light.polyline(&fp1, true);
        shade_dark.polyline(&fp2, true);
        cv.fill_poly(&fp1, th.sym_ink, 0.13 * base_alpha);
        cv.fill_poly(&fp2, th.sym_ink, 0.27 * base_alpha);
    } else {
        let fp = facet_poly(&m, &rr);
        shade_dark.polyline(&fp, true);
        cv.fill_poly(&fp, th.sym_ink, 0.22 * base_alpha);
    }

    let t_min = if tall { 0.38 } else { 0.25 };
    let mut do_hatch = |p: &[[f64; 2]], q: &[[f64; 2]], count: usize, t0_min: f64, seed: usize| {
        for j in 0..count {
            let s = (j as f64 + 0.5 + (rf(seed + j) - 0.5) * 0.6) / count as f64;
            let t0 = t0_min + 0.26 * rf(seed + j * 3 + 1);
            let t1 = (0.60 + 0.40 * rf(seed + j * 5 + 2)).min(0.98);
            let mut stroke_pts = Vec::new();
            let mut t = t0;
            while t <= t1 + 1e-6 {
                let a = poly_at(p, t);
                let b = poly_at(q, t);
                stroke_pts.push([a[0] + (b[0] - a[0]) * s, a[1] + (b[1] - a[1]) * s]);
                t += 0.18;
            }
            if stroke_pts.len() >= 2 {
                hatch_thin.polyline(&stroke_pts, false);
                cv.stroke_poly(&stroke_pts, false, th.sym_ink, 0.75 * k, 0.78 * base_alpha);
            }
        }
    };
    if let Some(nr) = &n_r {
        do_hatch(nr, &rr, (w / (5.0 * k)).round().max(4.0) as usize, t_min, 8);
        do_hatch(&m, nr, (w / (11.0 * k)).round().max(2.0) as usize, t_min + 0.05, 2);
    } else {
        do_hatch(&m, &rr, (w / (6.0 * k)).round().max(3.0) as usize, t_min, 8);
    }
    do_hatch(&l, &m, if big { 3 } else { 1 }, 0.32, 11);

    let mut out_pts = Vec::with_capacity(9);
    for i in (0..=4).rev() {
        out_pts.push(l[i]);
    }
    for i in 1..=4 {
        out_pts.push(rr[i]);
    }
    outline.polyline(&out_pts, false);
    cv.stroke_poly(&out_pts, false, th.sym_ink, 1.35 * k, base_alpha);

    ridge_mid.polyline(&m[..=3], false);
    cv.stroke_poly(&m[..=3], false, th.sym_ink, 1.0 * k, base_alpha);
    if let Some(nr) = &n_r {
        ridge_fine.polyline(&nr[..=3], false);
        cv.stroke_poly(&nr[..=3], false, th.sym_ink, 0.8 * k, 0.85 * base_alpha);
    }
    if tall {
        let a = poly_at(&l, 0.3);
        let b = poly_at(&rr, 0.3);
        let mut snow = Vec::with_capacity(7);
        snow.push(a);
        for i in 1..=6 {
            let u = i as f64 / 6.0;
            let sgn = if i % 2 == 1 { 1.0 } else { -1.0 };
            snow.push([
                a[0] + (b[0] - a[0]) * u,
                a[1] + (b[1] - a[1]) * u + sgn * h * 0.035 * (0.6 + rf(i + 9) * 0.8),
            ]);
        }
        ridge_fine.polyline(&snow, false);
        cv.stroke_poly(&snow, false, th.sym_ink, 0.8 * k, 0.8 * base_alpha);
    }
}

fn quad_curve_pts(p0: [f64; 2], cp: [f64; 2], p1: [f64; 2], steps: usize) -> Vec<[f64; 2]> {
    (0..=steps)
        .map(|s| {
            let t = s as f64 / steps as f64;
            let mt = 1.0 - t;
            [
                mt * mt * p0[0] + 2.0 * mt * t * cp[0] + t * t * p1[0],
                mt * mt * p0[1] + 2.0 * mt * t * cp[1] + t * t * p1[1],
            ]
        })
        .collect()
}

// ---------- Слой рек, дорог и границ ----------

fn trace_river_polylines(planet: &Planet, proj: &WorldProj, grid: &ClassicGrid, noise: &Noise2) -> Vec<Vec<[f64; 3]>> {
    let gw = planet.grid.w as f64;
    let gh = planet.grid.h as f64;
    let mut out = Vec::new();
    for riv in &planet.hydrology.rivers {
        if riv.smoothed_pts.len() < 5 || riv.max_discharge_m3s < 950.0 {
            continue;
        }
        let n_pts = riv.smoothed_pts.len();
        let q_scale = (riv.max_discharge_m3s as f64 / 18_000.0).sqrt().clamp(0.18, 1.0);
        let mut cur = Vec::new();
        let mut prev_dlon: Option<f64> = None;
        for (idx, pt) in riv.smoothed_pts.iter().enumerate() {
            let lon = wrap_lon_deg(((pt[0] as f64 / gw) - 0.5) * 360.0);
            let lat = 90.0 - (pt[1] as f64 / gh) * 180.0;
            let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
            let pr = proj.project(lat, lon);
            let pr_w = [
                pr[0] + noise.sample(pt[0] as f64 * 0.3, pt[1] as f64 * 0.3) * 0.7 * grid.scale_k,
                pr[1] + noise.sample(pt[0] as f64 * 0.3 + 9.0, pt[1] as f64 * 0.3) * 0.7 * grid.scale_k,
            ];
            let t_along = idx as f64 / (n_pts - 1).max(1) as f64;
            let wid = (0.06 + 0.68 * q_scale * t_along.powf(0.72)).clamp(0.06, 0.82);
            if let Some(pd) = prev_dlon {
                if (dlon - pd).abs() > 120.0 {
                    if cur.len() >= 2 {
                        out.push(std::mem::take(&mut cur));
                    } else {
                        cur.clear();
                    }
                }
            }
            cur.push([pr_w[0], pr_w[1], wid]);
            prev_dlon = Some(dlon);
        }
        if cur.len() >= 2 {
            out.push(cur);
        }
    }
    out
}

fn trace_region_rivers(reg: &Region, proj: &RegionProj, grid: &ClassicGrid, noise: &Noise2) -> (Vec<Vec<[f64; 3]>>, usize) {
    let mut kept: Vec<&River> = reg
        .rivers
        .iter()
        .filter(|riv| {
            riv.smoothed_pts.len() >= 4
                && riv.max_discharge_m3s >= 480.0
                && (riv.length_km >= 60.0 || riv.max_discharge_m3s >= 1200.0 || riv.order >= 3)
        })
        .collect();
    if kept.len() < 10 {
        let mut fb: Vec<&River> = reg
            .rivers
            .iter()
            .filter(|riv| riv.smoothed_pts.len() >= 4 && (riv.length_km >= 40.0 || riv.max_discharge_m3s >= 260.0 || riv.order >= 2))
            .collect();
        fb.sort_by(|a, b| b.max_discharge_m3s.total_cmp(&a.max_discharge_m3s));
        fb.truncate(26);
        kept = fb;
    }
    let count = kept.len();
    let out = kept
        .into_iter()
        .map(|riv| {
            let n_pts = riv.smoothed_pts.len();
            let q_scale = (riv.max_discharge_m3s as f64 / 14_000.0).sqrt().clamp(0.16, 1.0);
            let raw_3: Vec<[f64; 3]> = riv
                .smoothed_pts
                .iter()
                .enumerate()
                .map(|(pi, pt)| {
                    let pr = proj.project_cell(pt[0] as f64, pt[1] as f64);
                    let t_along = pi as f64 / (n_pts - 1).max(1) as f64;
                    let w = (0.06 + 0.72 * q_scale * t_along.powf(0.70)).clamp(0.06, 0.85);
                    [pr[0], pr[1], w]
                })
                .collect();
            let mut sm_3 = Vec::with_capacity(raw_3.len() * 2);
            if raw_3.len() >= 3 {
                sm_3.push(raw_3[0]);
                for seg in raw_3.windows(2) {
                    let a = seg[0];
                    let b = seg[1];
                    sm_3.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0.75 * a[2] + 0.25 * b[2]]);
                    sm_3.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0.25 * a[2] + 0.75 * b[2]]);
                }
                sm_3.push(*raw_3.last().unwrap());
            } else {
                sm_3 = raw_3;
            }
            sm_3.into_iter()
                .enumerate()
                .map(|(idx, p)| {
                    [
                        p[0] + noise.sample(idx as f64 * 0.28, p[1] * 0.04) * 0.55 * grid.scale_k,
                        p[1] + noise.sample(idx as f64 * 0.28 + 9.0, p[0] * 0.04) * 0.55 * grid.scale_k,
                        p[2],
                    ]
                })
                .collect()
        })
        .collect();
    (out, count)
}

struct RoadScene {
    wild_trails: Vec<Vec<[f64; 2]>>,
    trails: Vec<Vec<[f64; 2]>>,
    roads: Vec<Vec<[f64; 2]>>,
    highways: Vec<Vec<[f64; 2]>>,
    bridges: Vec<([f64; 2], [f64; 2], u8)>,
    sea_routes: Vec<OverlayRoute>,
}

fn build_world_roads(planet: &Planet, proj: &WorldProj, grid: &ClassicGrid, noise: &Noise2) -> RoadScene {
    let mut cell_usage: HashMap<usize, u8> = HashMap::new();
    for tr in &planet.civilization.trade_routes {
        if tr.segments.first().copied() == Some(RouteKind::WildTrail) {
            continue;
        }
        let mut seen = HashSet::new();
        for &c in &tr.cells {
            if planet.hydrology.is_ocean[c] == 0 && planet.hydrology.is_lake[c] == 0 && seen.insert(c) {
                let e = cell_usage.entry(c).or_insert(0);
                *e = e.saturating_add(1);
            }
        }
    }

    let mut wild_trails = Vec::new();
    let mut trails = Vec::new();
    let mut roads = Vec::new();
    let mut highways = Vec::new();
    let mut bridges = Vec::new();
    let mut sea_routes = Vec::new();

    for tr in &planet.civilization.trade_routes {
        if tr.segments.first().copied() == Some(RouteKind::WildTrail) {
            let mut cur = Vec::new();
            let mut prev_dlon: Option<f64> = None;
            for &c in &tr.cells {
                let (cx, cy) = planet.grid.xy(c);
                let lon = planet.grid.lon_deg(cx);
                let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
                if let Some(pd) = prev_dlon {
                    if (dlon - pd).abs() > 120.0 {
                        if cur.len() >= 2 { wild_trails.push(wobble_road(grid, noise, std::mem::take(&mut cur))); }
                        else { cur.clear(); }
                    }
                }
                cur.push(proj.project(planet.grid.lat_deg(cy), lon));
                prev_dlon = Some(dlon);
            }
            if cur.len() >= 2 {
                wild_trails.push(wobble_road(grid, noise, cur));
            }
            continue;
        }
        let mut cur_pts = Vec::new();
        let mut cur_cls = 0u8;
        let mut cur_sea = false;
        let mut prev_dlon: Option<f64> = None;

        for (idx, &c) in tr.cells.iter().enumerate() {
            let (cx, cy) = planet.grid.xy(c);
            let lon = planet.grid.lon_deg(cx);
            let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
            let pr = proj.project(planet.grid.lat_deg(cy), lon);
            let is_sea = planet.hydrology.is_ocean[c] != 0 || planet.hydrology.is_lake[c] != 0;
            let u = cell_usage.get(&c).copied().unwrap_or(1);
            let cls = if is_sea { 0 } else if u >= 3 { 3 } else if u == 2 { 2 } else { 1 };

            if idx > 0 && idx + 1 < tr.cells.len() && !is_sea && planet.hydrology.river_mask[c] != 0 {
                let pc = tr.cells[idx - 1];
                if planet.hydrology.river_mask[pc] == 0 && planet.hydrology.is_ocean[pc] == 0 {
                    let (ncx, ncy) = planet.grid.xy(tr.cells[idx + 1]);
                    let (pcx, pcy) = planet.grid.xy(pc);
                    let np = proj.project(planet.grid.lat_deg(ncy), planet.grid.lon_deg(ncx));
                    let pp = proj.project(planet.grid.lat_deg(pcy), planet.grid.lon_deg(pcx));
                    bridges.push((pr, [np[0] - pp[0], np[1] - pp[1]], cls));
                }
            }

            if let Some(pd) = prev_dlon {
                let jump = (dlon - pd).abs() > 120.0;
                if jump || is_sea != cur_sea || (!is_sea && cls != cur_cls) {
                    let keep_end = if !jump && is_sea == cur_sea {
                        cur_pts.last().copied()
                    } else {
                        None
                    };
                    if cur_pts.len() >= 2 {
                        if cur_sea {
                            sea_routes.push(OverlayRoute { is_sea: true, pts: std::mem::take(&mut cur_pts) });
                        } else {
                            let sm = wobble_road(grid, noise, std::mem::take(&mut cur_pts));
                            match cur_cls {
                                3 => highways.push(sm),
                                2 => roads.push(sm),
                                _ => trails.push(sm),
                            }
                        }
                    } else {
                        cur_pts.clear();
                    }
                    if let Some(ep) = keep_end {
                        cur_pts.push(ep);
                    }
                }
            }
            cur_sea = is_sea;
            cur_cls = cls;
            cur_pts.push(pr);
            prev_dlon = Some(dlon);
        }
        if cur_pts.len() >= 2 {
            if cur_sea {
                sea_routes.push(OverlayRoute { is_sea: true, pts: cur_pts });
            } else {
                let sm = wobble_road(grid, noise, cur_pts);
                match cur_cls {
                    3 => highways.push(sm),
                    2 => roads.push(sm),
                    _ => trails.push(sm),
                }
            }
        }
    }

    RoadScene {
        wild_trails,
        trails,
        roads,
        highways,
        bridges,
        sea_routes,
    }
}

fn build_region_roads(planet: &Planet, reg: &Region, proj: &RegionProj, grid: &ClassicGrid, noise: &Noise2) -> RoadScene {
    let mut cell_usage: HashMap<usize, u8> = HashMap::new();
    for rd in &reg.roads {
        let mut seen = HashSet::new();
        for &c in &rd.cells {
            if seen.insert(c) {
                let e = cell_usage.entry(c).or_insert(0);
                *e = e.saturating_add(1);
            }
        }
    }
    let mut wild_trails = Vec::new();
    let mut trails = Vec::new();
    let mut roads = Vec::new();
    let mut highways = Vec::new();
    let mut bridges = Vec::new();
    let mut sea_routes = Vec::new();

    for rd in &reg.roads {
        if rd.pts.len() < 2 {
            continue;
        }
        let max_u = rd
            .cells
            .iter()
            .map(|c| cell_usage.get(c).copied().unwrap_or(1))
            .max()
            .unwrap_or(1);
        for w in rd.cells.windows(3) {
            if reg.river_mask[w[1]] != 0 && reg.river_mask[w[0]] == 0 {
                let (cx, cy) = reg.xy(w[1]);
                let p0 = proj.project_cell(reg.xy(w[0]).0 as f64 + 0.5, reg.xy(w[0]).1 as f64 + 0.5);
                let p1 = proj.project_cell(cx as f64 + 0.5, cy as f64 + 0.5);
                let p2 = proj.project_cell(reg.xy(w[2]).0 as f64 + 0.5, reg.xy(w[2]).1 as f64 + 0.5);
                bridges.push((p1, [p2[0] - p0[0], p2[1] - p0[1]], if max_u >= 3 { 3 } else if max_u == 2 { 2 } else { 1 }));
            }
        }
        let pts: Vec<[f64; 2]> = rd.pts.iter().map(|p| proj.project_cell(p[0] as f64, p[1] as f64)).collect();
        let sm = wobble_road(grid, noise, pts);
        if max_u >= 3 {
            highways.push(sm);
        } else if max_u == 2 {
            roads.push(sm);
        } else {
            trails.push(sm);
        }
    }

    for tr in &planet.civilization.trade_routes {
        let is_wt = tr.segments.first().copied() == Some(RouteKind::WildTrail);
        let mut cur = Vec::new();
        for &c in &tr.cells {
            if is_wt {
                if planet.hydrology.is_ocean[c] == 0 && planet.hydrology.is_lake[c] == 0 {
                    let (cx, cy) = planet.grid.xy(c);
                    if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx)) {
                        cur.push(pr);
                    } else if cur.len() >= 2 {
                        wild_trails.push(wobble_road(grid, noise, std::mem::take(&mut cur)));
                    } else {
                        cur.clear();
                    }
                }
                continue;
            }
            if planet.hydrology.is_ocean[c] == 0 && planet.hydrology.is_lake[c] == 0 {
                if cur.len() >= 2 {
                    sea_routes.push(OverlayRoute { is_sea: true, pts: std::mem::take(&mut cur) });
                } else {
                    cur.clear();
                }
                continue;
            }
            let (cx, cy) = planet.grid.xy(c);
            if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx)) {
                cur.push(pr);
            } else if cur.len() >= 2 {
                sea_routes.push(OverlayRoute { is_sea: true, pts: std::mem::take(&mut cur) });
            } else {
                cur.clear();
            }
        }
        if cur.len() >= 2 {
            if is_wt {
                wild_trails.push(wobble_road(grid, noise, cur));
            } else {
                sea_routes.push(OverlayRoute { is_sea: true, pts: cur });
            }
        }
    }

    RoadScene {
        wild_trails,
        trails,
        roads,
        highways,
        bridges,
        sea_routes,
    }
}

/// Отводит морской маршрут в открытую воду дальше от береговой линии и ореолов.
fn push_sea_route_offshore(grid: &ClassicGrid, th: &ClassicTheme, raw: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    let mut sm = chaikin_open(raw, 3);
    let n = sm.len();
    if n < 3 {
        return sm;
    }
    let [fx, fy, fw, fh] = grid.frame;
    let target_d = if th.halos > 0 { 8.2 } else { 5.4 };
    for (i, pt) in sm.iter_mut().enumerate().skip(1).take(n - 2) {
        let end_d = i.min(n - 1 - i) as f64;
        let taper = (end_d / 3.5).clamp(0.0, 1.0);
        if taper <= 0.05 {
            continue;
        }
        let gx = clamp((pt[0] - fx) / grid.sx, 1.0, (grid.gw - 2) as f64);
        let gy = clamp((pt[1] - fy) / grid.sy, 1.0, (grid.gh - 2) as f64);
        let d = grid.bil(&grid.dist_blur1, gx, gy);
        if d < target_d {
            let gdx = grid.bil(&grid.dist_blur1, (gx + 1.0).min((grid.gw - 2) as f64), gy)
                - grid.bil(&grid.dist_blur1, (gx - 1.0).max(0.0), gy);
            let gdy = grid.bil(&grid.dist_blur1, gx, (gy + 1.0).min((grid.gh - 2) as f64))
                - grid.bil(&grid.dist_blur1, gx, (gy - 1.0).max(0.0));
            let gl = gdx.hypot(gdy);
            if gl > 1e-3 {
                let push_px = (target_d - d) * grid.sx * taper;
                let nx = clamp(pt[0] + (gdx / gl) * push_px, fx + 2.0, fx + fw - 2.0);
                let ny = clamp(pt[1] + (gdy / gl) * push_px, fy + 2.0, fy + fh - 2.0);
                let ngx = ((nx - fx) / grid.sx).round().clamp(0.0, (grid.gw - 1) as f64) as usize;
                let ngy = ((ny - fy) / grid.sy).round().clamp(0.0, (grid.gh - 1) as f64) as usize;
                let n_dist = grid.dist_blur1[ngy * grid.gw + ngx] as f64;
                if grid.ocean[ngy * grid.gw + ngx] != 0 && n_dist > d {
                    pt[0] = nx;
                    pt[1] = ny;
                }
            }
        }
    }
    let orig = sm.clone();
    for i in 1..(n - 1) {
        sm[i][0] = 0.25 * orig[i - 1][0] + 0.50 * orig[i][0] + 0.25 * orig[i + 1][0];
        sm[i][1] = 0.25 * orig[i - 1][1] + 0.50 * orig[i][1] + 0.25 * orig[i + 1][1];
    }
    sm
}

fn wobble_road(grid: &ClassicGrid, noise: &Noise2, raw: Vec<[f64; 2]>) -> Vec<[f64; 2]> {
    let p = chaikin_open(raw, 2);
    let n = p.len();
    let k = grid.scale_k;
    let [fx, fy, fw, fh] = grid.frame;
    p.iter()
        .enumerate()
        .map(|(i, q)| {
            if i == 0 || i + 1 == n {
                return [clamp(q[0], fx, fx + fw), clamp(q[1], fy, fy + fh)];
            }
            let a = p[i - 1];
            let b = p[i + 1];
            let dx = b[0] - a[0];
            let dy = b[1] - a[1];
            let len = dx.hypot(dy).max(1e-6);
            let w = noise.sample(q[0] * 0.06 / k + 20.0, q[1] * 0.06 / k + 5.0) * 1.1 * k;
            [
                clamp(q[0] - (dy / len) * w, fx, fx + fw),
                clamp(q[1] + (dx / len) * w, fy, fy + fh),
            ]
        })
        .collect()
}

// ---------- Границы государств и дуговые подписи держав (0.89.0 render_political.js) ----------

fn border_lines(grid: &ClassicGrid, noise: &Noise2) -> Vec<Vec<[f64; 2]>> {
    let w = grid.gw;
    let h = grid.gh;
    let mut adj: HashMap<usize, Vec<usize>> = HashMap::new();
    let mut link = |a: usize, b: usize| {
        adj.entry(a).or_default().push(b);
        adj.entry(b).or_default().push(a);
    };
    let node = |cx: usize, cy: usize| cy * (w + 1) + cx;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            let a = grid.realm_id[i];
            if a < 0 {
                continue;
            }
            if x + 1 < w {
                let b = grid.realm_id[i + 1];
                if b >= 0 && b != a {
                    link(node(x + 1, y), node(x + 1, y + 1));
                }
            }
            if y + 1 < h {
                let b = grid.realm_id[i + w];
                if b >= 0 && b != a {
                    link(node(x, y + 1), node(x + 1, y + 1));
                }
            }
        }
    }
    let key = |a: usize, b: usize| if a < b { (a, b) } else { (b, a) };
    let to_pt = |nd: usize| -> [f64; 2] {
        [
            grid.px((nd % (w + 1)) as f64 - 0.5),
            grid.py((nd / (w + 1)) as f64 - 0.5),
        ]
    };
    let mut seen = HashSet::new();
    let mut keys: Vec<usize> = adj.keys().copied().collect();
    keys.sort_unstable();
    let mut chains = Vec::new();
    for pass in 0..2 {
        for &start in &keys {
            if pass == 0 && adj[&start].len() == 2 {
                continue;
            }
            for &next in &adj[&start] {
                if !seen.insert(key(start, next)) {
                    continue;
                }
                let mut ln = vec![to_pt(start), to_pt(next)];
                let (mut prev, mut cur) = (start, next);
                while let Some(cands) = adj.get(&cur) {
                    if cands.len() != 2 {
                        break;
                    }
                    let nx = if cands[0] == prev { cands[1] } else { cands[0] };
                    if !seen.insert(key(cur, nx)) {
                        break;
                    }
                    ln.push(to_pt(nx));
                    prev = cur;
                    cur = nx;
                }
                if ln.len() >= 2 {
                    let decimated = if ln.len() >= 7 {
                        let mut d = Vec::with_capacity(ln.len() / 4 + 2);
                        d.push(ln[0]);
                        for idx in (4..(ln.len() - 1)).step_by(4) {
                            d.push(ln[idx]);
                        }
                        d.push(*ln.last().unwrap());
                        d
                    } else {
                        ln
                    };
                    let sm = chaikin_open(decimated, 3);
                    let n = sm.len();
                    let k = grid.scale_k;
                    let wob: Vec<[f64; 2]> = sm
                        .iter()
                        .enumerate()
                        .map(|(idx, q)| {
                            if idx == 0 || idx + 1 == n {
                                return *q;
                            }
                            let a = sm[idx - 1];
                            let b = sm[idx + 1];
                            let dx = b[0] - a[0];
                            let dy = b[1] - a[1];
                            let l = dx.hypot(dy).max(1e-6);
                            let wv = noise.sample(q[0] * 0.045 / k + 70.0, q[1] * 0.045 / k) * 1.15 * k;
                            [q[0] - (dy / l) * wv, q[1] + (dx / l) * wv]
                        })
                        .collect();
                    chains.push(wob);
                }
            }
        }
    }
    chains
}

struct RealmArc {
    text: String,
    pts: Vec<[f64; 2]>,
    length_px: f64,
    thick_px: f64,
}

fn realm_label_paths(planet: &Planet, grid: &ClassicGrid) -> Vec<RealmArc> {
    if planet.civilization.realms.is_empty() {
        return Vec::new();
    }
    let w = grid.gw;
    let mut by_realm: HashMap<i32, Vec<usize>> = HashMap::new();
    for (i, &rid) in grid.realm_id.iter().enumerate() {
        if rid >= 0 {
            by_realm.entry(rid).or_default().push(i);
        }
    }
    let mut out = Vec::new();
    for r in &planet.civilization.realms {
        let Some(list) = by_realm.get(&(r.id as i32)) else {
            continue;
        };
        if list.len() < 36 {
            continue;
        }
        let mut seen: HashSet<usize> = HashSet::with_capacity(list.len());
        let mut best_comp: Vec<usize> = Vec::new();
        let target_rid = r.id as i32;
        for &start in list {
            if !seen.insert(start) {
                continue;
            }
            let mut comp = vec![start];
            let mut q = VecDeque::new();
            q.push_back(start);
            while let Some(cur) = q.pop_front() {
                let cx = cur % w;
                let cy = cur / w;
                for (dx, dy) in [(-1isize, 0isize), (1, 0), (0, -1), (0, 1)] {
                    let nx = cx as isize + dx;
                    let ny = cy as isize + dy;
                    if nx < 0 || ny < 0 || nx >= w as isize || ny >= grid.gh as isize {
                        continue;
                    }
                    let ni = ny as usize * w + nx as usize;
                    if grid.realm_id[ni] == target_rid && seen.insert(ni) {
                        comp.push(ni);
                        q.push_back(ni);
                    }
                }
            }
            if comp.len() > best_comp.len() {
                best_comp = comp;
            }
        }
        if best_comp.len() < 36 {
            continue;
        }
        let list = &best_comp;
        let (mut mx, mut my) = (0.0, 0.0);
        for &i in list {
            mx += (i % w) as f64;
            my += (i / w) as f64;
        }
        mx /= list.len() as f64;
        my /= list.len() as f64;
        let (mut cxx, mut cyy, mut cxy) = (0.0, 0.0, 0.0);
        for &i in list {
            let dx = (i % w) as f64 - mx;
            let dy = (i / w) as f64 - my;
            cxx += dx * dx;
            cyy += dy * dy;
            cxy += dx * dy;
        }
        let ang = 0.5 * (2.0 * cxy).atan2(cxx - cyy);
        let (ux, uy) = (ang.cos(), ang.sin());
        let (vx, vy) = (-uy, ux);
        const BIN: f64 = 3.0;
        let mut bins: BTreeMap<isize, (usize, f64, f64, f64)> = BTreeMap::new();
        let mut ss = Vec::with_capacity(list.len());
        for &i in list {
            let dx = (i % w) as f64 - mx;
            let dy = (i / w) as f64 - my;
            let sp = dx * ux + dy * uy;
            let tp = dx * vx + dy * vy;
            ss.push(sp);
            let b = (sp / BIN).round() as isize;
            let e = bins.entry(b).or_insert((0, f64::INFINITY, f64::NEG_INFINITY, 0.0));
            e.0 += 1;
            e.1 = e.1.min(tp);
            e.2 = e.2.max(tp);
            e.3 += tp;
        }
        ss.sort_by(|a, b| a.total_cmp(b));
        let smin = ss[(ss.len() as f64 * 0.08) as usize];
        let smax = ss[((ss.len() as f64 * 0.92) as usize).min(ss.len() - 1)];
        let keys: Vec<isize> = bins
            .iter()
            .filter(|(&b, o)| b as f64 * BIN >= smin && b as f64 * BIN <= smax && o.0 >= 3)
            .map(|(&b, _)| b)
            .collect();
        if keys.len() < 4 {
            continue;
        }
        let mut ts: Vec<f64> = keys
            .iter()
            .map(|b| {
                let o = bins[b];
                0.25 * (o.1 + o.2) + 0.5 * (o.3 / o.0 as f64)
            })
            .collect();
        for _ in 0..3 {
            let prev = ts.clone();
            for j in 0..ts.len() {
                let (mut a, mut c) = (0.0, 0);
                for k in -2isize..=2 {
                    let idx = j as isize + k;
                    if idx >= 0 && (idx as usize) < prev.len() {
                        a += prev[idx as usize];
                        c += 1;
                    }
                }
                ts[j] = a / c as f64;
            }
        }
        let mut pts: Vec<[f64; 2]> = keys
            .iter()
            .enumerate()
            .map(|(j, &b)| {
                let gx = mx + b as f64 * BIN * ux + ts[j] * vx;
                let gy = my + b as f64 * BIN * uy + ts[j] * vy;
                [grid.px(gx), grid.py(gy)]
            })
            .collect();
        if pts[pts.len() - 1][0] < pts[0][0] {
            pts.reverse();
        }
        let thick_g: f64 = keys.iter().map(|b| bins[b].2 - bins[b].1).sum::<f64>() / keys.len() as f64;
        let len_px: f64 = pts.windows(2).map(|p| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1])).sum();
        out.push(RealmArc {
            text: r.name.to_uppercase(),
            pts: chaikin_open(pts, 2),
            length_px: len_px,
            thick_px: thick_g * grid.sy,
        });
    }
    out
}

// ---------- Выбор угла легенды (0.89.0 drawLegend) ----------

fn classic_legend_rect(
    grid: &ClassicGrid,
    is_world: bool,
    realms_n: usize,
    setts_n: usize,
    has_roads: bool,
    has_sea_routes: bool,
) -> [f64; 4] {
    let k = grid.scale_k;
    let [fx, fy, fw, fh] = grid.frame;
    let row_h = 20.0 * k;
    let pad = 12.0 * k;
    let rows_cnt = 4
        + if realms_n > 0 { 1 + realms_n.min(8) } else { 0 }
        + if setts_n > 0 { 1 + 3 } else { 0 }
        + if has_roads { 1 } else { 0 }
        + if has_sea_routes { 1 } else { 0 }
        + if realms_n > 0 { 1 } else { 0 };
    let bw = 205.0 * k;
    let bh = (rows_cnt as f64 * row_h + pad * 2.0).min(fh * 0.65);
    let m = 22.0 * k;
    let _ = is_world;
    let cands = [
        [fx + m, fy + fh - bh - m, bw, bh],
        [fx + fw - bw - m, fy + fh - bh - m, bw, bh],
        [fx + m, fy + m, bw, bh],
        [fx + fw - bw - m, fy + m, bw, bh],
    ];
    let mut best = cands[0];
    let mut best_hits = usize::MAX;
    for r in cands {
        let x0 = (((r[0] - fx) / grid.sx).floor() as isize).clamp(0, grid.gw as isize - 1) as usize;
        let x1 = (((r[0] + r[2] - fx) / grid.sx).ceil() as isize).clamp(0, grid.gw as isize) as usize;
        let y0 = (((r[1] - fy) / grid.sy).floor() as isize).clamp(0, grid.gh as isize - 1) as usize;
        let y1 = (((r[1] + r[3] - fy) / grid.sy).ceil() as isize).clamp(0, grid.gh as isize) as usize;
        let mut hits = 0usize;
        for gy in (y0..y1).step_by(2) {
            for gx in (x0..x1).step_by(2) {
                if grid.ocean[gy * grid.gw + gx] == 0 {
                    hits += 1;
                }
            }
        }
        if hits < best_hits {
            best_hits = hits;
            best = r;
        }
    }
    best
}

fn state_rgb(rid: usize) -> [f64; 3] {
    match rid % 6 {
        0 => [186.0, 112.0, 98.0],
        1 => [108.0, 138.0, 158.0],
        2 => [190.0, 154.0, 92.0],
        3 => [128.0, 156.0, 114.0],
        4 => [148.0, 112.0, 138.0],
        _ => [130.0, 150.0, 146.0],
    }
}

// ---------- Сбор POI и подписей ----------

fn collect_classic_pois_world(planet: &Planet, proj: &WorldProj, grid: &ClassicGrid) -> Vec<PoiPin> {
    let [fx, fy, fw, fh] = grid.frame;
    let in_fr = |x: f64, y: f64| x >= fx + 8.0 && x <= fx + fw - 8.0 && y >= fy + 8.0 && y <= fy + fh - 8.0;
    let mut pois = Vec::new();
    for (idx, rg) in planet.geography.mountain_ranges.iter().take(12).enumerate() {
        let (rx, ry) = planet.grid.xy(rg.peak_cell);
        let pr = proj.project(planet.grid.lat_deg(ry), planet.grid.lon_deg(rx));
        if in_fr(pr[0], pr[1]) {
            let name = planet.names.mountain_ranges.get(idx).cloned().unwrap_or_else(|| "Вершина".into());
            pois.push(PoiPin { id: format!("wp_peak_{idx}"), kind: "peak", name, x: pr[0], y: pr[1] });
        }
    }
    for (idx, ps) in planet.geography.passes.iter().take(12).enumerate() {
        let (px, py) = planet.grid.xy(ps.cell);
        let pr = proj.project(planet.grid.lat_deg(py), planet.grid.lon_deg(px));
        if in_fr(pr[0], pr[1]) {
            let name = planet.names.passes.get(idx).cloned().unwrap_or_else(|| "Перевал".into());
            pois.push(PoiPin { id: format!("wp_pass_{idx}"), kind: "pass", name, x: pr[0], y: pr[1] });
        }
    }
    let mut wfs: Vec<(usize, &fms_core::hydrology::Waterfall)> = planet.hydrology.waterfalls.iter().enumerate().collect();
    wfs.sort_by(|a, b| b.1.drop_m.total_cmp(&a.1.drop_m));
    for (idx, wf) in wfs.into_iter().take(10) {
        let (wx, wy) = planet.grid.xy(wf.cell);
        let pr = proj.project(planet.grid.lat_deg(wy), planet.grid.lon_deg(wx));
        if in_fr(pr[0], pr[1]) {
            pois.push(PoiPin {
                id: format!("wp_wf_{idx}"),
                kind: "waterfall",
                name: format!("Водопад ({:.0} м)", wf.drop_m),
                x: pr[0],
                y: pr[1],
            });
        }
    }
    for (idx, &(vx, vy, _)) in grid.volcanoes.iter().enumerate() {
        pois.push(PoiPin {
            id: format!("wp_volc_{idx}"),
            kind: "volcano",
            name: format!("Вулкан #{}", idx + 1),
            x: grid.px(vx),
            y: grid.py(vy),
        });
    }
    pois
}

fn collect_classic_pois_region(planet: &Planet, reg: &Region, proj: &RegionProj, grid: &ClassicGrid) -> Vec<PoiPin> {
    let mut pois = Vec::new();
    for (idx, ps) in reg.passes.iter().take(12).enumerate() {
        let pr = proj.project_cell(ps.x as f64 + 0.5, ps.y as f64 + 0.5);
        pois.push(PoiPin {
            id: format!("wp_rpass_{idx}"),
            kind: "pass",
            name: format!("Перевал {:.0} м", ps.elevation_km * 1000.0),
            x: pr[0],
            y: pr[1],
        });
    }
    for (idx, wf) in reg.waterfalls.iter().take(8).enumerate() {
        let (wx, wy) = reg.xy(wf.cell);
        let pr = proj.project_cell(wx as f64 + 0.5, wy as f64 + 0.5);
        pois.push(PoiPin {
            id: format!("wp_rwf_{idx}"),
            kind: "waterfall",
            name: format!("Водопад ({:.0} м)", wf.drop_m),
            x: pr[0],
            y: pr[1],
        });
    }
    for (idx, &(vx, vy, _)) in grid.volcanoes.iter().enumerate() {
        pois.push(PoiPin {
            id: format!("wp_rvolc_{idx}"),
            kind: "volcano",
            name: format!("Вулкан #{}", idx + 1),
            x: grid.px(vx),
            y: grid.py(vy),
        });
    }
    let _ = planet;
    pois
}

fn settlement_kind(role: SettlementRole, tier: SettlementTier) -> &'static str {
    match tier {
        SettlementTier::Capital => "capital",
        SettlementTier::Metropolis => "metropolis",
        SettlementTier::City => "city",
        _ => match role {
            SettlementRole::Capital => "capital",
            SettlementRole::Port => "port",
            SettlementRole::PassFortress => "fortress",
            SettlementRole::MiningTown => "mine",
            _ => match tier {
                SettlementTier::Town => "town",
                SettlementTier::Village => "village",
                SettlementTier::City => "city",
                SettlementTier::Metropolis => "metropolis",
                SettlementTier::Capital => "capital",
            },
        },
    }
}

fn settlement_subtitle_label(role: SettlementRole, tier: SettlementTier) -> String {
    let tier_s = tier.name();
    let role_s = match role {
        SettlementRole::Capital => "",
        SettlementRole::Port => " · порт",
        SettlementRole::PassFortress => " · крепость",
        SettlementRole::MiningTown => " · рудник",
        SettlementRole::OasisTown => " · оазис",
        SettlementRole::RiverHub => " · речной узел",
        SettlementRole::MarketTown => "",
    };
    format!("{tier_s}{role_s}")
}

fn deposit_meta(kind: ResourceKind) -> (&'static str, &'static str) {
    match kind {
        ResourceKind::Iron => ("iron", kind.name()),
        ResourceKind::CopperGold => ("copper", kind.name()),
        ResourceKind::GemsRare => ("gems", kind.name()),
        ResourceKind::Coal => ("coal", kind.name()),
        ResourceKind::Hydrocarbons => ("oil", kind.name()),
        ResourceKind::Salt => ("salt", kind.name()),
        ResourceKind::Timber => ("timber", kind.name()),
        ResourceKind::Fishery => ("fish", kind.name()),
    }
}

// ---------- Композитинг растра + генерация SVG слоёв из единой модели ----------

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}
impl Rect {
    fn intersects(&self, o: &Self) -> bool {
        self.x < o.x + o.w && self.x + self.w > o.x && self.y < o.y + o.h && self.y + self.h > o.y
    }
    fn contains_rect(&self, o: &Self) -> bool {
        o.x >= self.x && o.y >= self.y && o.x + o.w <= self.x + self.w && o.y + o.h <= self.y + self.h
    }
}

#[inline]
fn text_box(text: &str, cx: f64, cy: f64, fs: f64, align: u8, pad: f64) -> Rect {
    let w = text.chars().count().max(1) as f64 * fs * 0.58 + pad * 2.0;
    let h = fs * 1.2 + pad * 2.0;
    let x = match align {
        0 => cx - pad,
        1 => cx - w + pad,
        _ => cx - w * 0.5,
    };
    Rect { x, y: cy - h * 0.5, w, h }
}

#[allow(clippy::too_many_arguments)]
fn compose_scene(
    style: Style,
    is_world: bool,
    seed: &str,
    grid: &ClassicGrid,
    base_rgb: &[u8],
    land_mask: &[u8],
    _coast_filled: &[Vec<[f64; 2]>],
    coast_strokes: &[(Vec<[f64; 2]>, bool)],
    halo_sets: &[Vec<(Vec<[f64; 2]>, bool)>],
    rivers: &[Vec<[f64; 3]>],
    wadis: &[Vec<[f64; 2]>],
    roads: &RoadScene,
    settlements: &[SettlementPin],
    wild_sites: &[WildSitePin],
    deposits: &[DepositPin],
    pois: &[PoiPin],
    labels: &[MapLabel],
    currents: &[Vec<[f64; 3]>],
    legend_realms: &[(String, [f64; 3])],
    legend_rect: [f64; 4],
    planet: &Planet,
    noise: &Noise2,
) -> (Vec<u8>, String) {
    let th = theme_of(style);
    let w = grid.canvas_w;
    let h = grid.canvas_h;
    let [fx, fy, fw, fh] = grid.frame;
    let k = grid.scale_k;
    let mut flat = base_rgb.to_vec();
    let clip = [
        fx.floor().max(0.0) as usize,
        fy.floor().max(0.0) as usize,
        ((fx + fw).ceil() as usize).min(w),
        ((fy + fh).ceil() as usize).min(h),
    ];
    let mut cv = MiniCanvas { w, clip, rgb: &mut flat };

    let mut svg = String::with_capacity(96 * 1024);
    let _ = writeln!(svg, r#"<defs>"#);
    let _ = writeln!(
        svg,
        r#"  <clipPath id="fmsFrameClip"><rect x="{fx:.1}" y="{fy:.1}" width="{fw:.1}" height="{fh:.1}"/></clipPath>"#
    );

    // Дуговые пути названий государств и морей в <defs>
    let r_arcs = realm_label_paths(planet, grid);
    for (ai, ra) in r_arcs.iter().enumerate() {
        let mut d = format!("M{:.1},{:.1}", ra.pts[0][0], ra.pts[0][1]);
        for p in &ra.pts[1..] {
            let _ = write!(d, " L{:.1},{:.1}", p[0], p[1]);
        }
        let _ = writeln!(svg, r#"  <path id="realmArc{ai}" d="{d}"/>"#);
    }
    let sea_labels: Vec<&MapLabel> = labels.iter().filter(|l| l.kind == "ocean").collect();
    for (si, sl) in sea_labels.iter().enumerate() {
        let f = (if is_world { 22.0 } else { 20.0 }) * k;
        let span = (sl.text.chars().count() as f64 * f * 1.18 + 44.0 * k).clamp(160.0 * k, 460.0 * k);
        let ang = ((si as f64 * 0.65) - 0.3).clamp(-0.45, 0.45);
        let dx = span * 0.5 * ang.cos();
        let dy = span * 0.5 * ang.sin();
        let _ = writeln!(
            svg,
            r#"  <path id="seaArc{si}" d="M{:.1},{:.1} Q{:.1},{:.1} {:.1},{:.1}"/>"#,
            sl.x - dx, sl.y - dy, sl.x, sl.y - 6.0 * k, sl.x + dx, sl.y + dy
        );
    }
    let _ = writeln!(svg, r#"</defs>"#);

    // 1. Детали воды: горизонтальная штриховка (Сепия) или 3 ореола (Ч/Б)
    let _ = writeln!(svg, r#"<g id="layer-water-detail" clip-path="url(#fmsFrameClip)" fill="none" stroke-linecap="round">"#);
    if th.hatch {
        let mut h_rand = Mulberry32::from_seed(&format!("{seed}|draw"));
        let mut b_hi = PathBatch::default();
        let mut b_mid = PathBatch::default();
        let mut b_lo = PathBatch::default();
        let gap = 5.4 * k;
        let mut y = fy + gap;
        let mut line_idx = 0usize;
        while y < fy + fh - gap {
            let reach = 3.2 + 12.5 * h_rand.next().powf(1.2);
            let py_i = (y.round() as usize).min(h - 1);
            let mut run: Option<(f64, f64, f64)> = None;
            let flush = |run: &mut Option<(f64, f64, f64)>, b_hi: &mut PathBatch, b_mid: &mut PathBatch, b_lo: &mut PathBatch, cv: &mut MiniCanvas<'_>| {
                if let Some((x0, x1, dmax)) = *run {
                    if x1 - x0 > 4.0 * k {
                        let a = clamp(0.54 - 0.38 * (dmax / reach), 0.12, 0.54);
                        let dy_j = noise.sample(x0 * 0.02 / k, line_idx as f64) * 0.65 * k;
                        let p0 = [x0, y];
                        let p1 = [x1, y + dy_j];
                        if a >= 0.38 {
                            b_hi.move_line(p0, p1);
                        } else if a >= 0.24 {
                            b_mid.move_line(p0, p1);
                        } else {
                            b_lo.move_line(p0, p1);
                        }
                        cv.stroke_seg(p0, p1, th.ink, 0.88 * k, a);
                    }
                }
                *run = None;
            };

            let step_x = (3.0 * k).max(1.5);
            let mut x = fx + 1.0;
            while x < fx + fw - 1.0 {
                let px_i = (x.round() as usize).min(w - 1);
                let is_water = land_mask[py_i * w + px_i] == 0;
                let gx = (((x - fx) / grid.sx).round() as isize).clamp(0, grid.gw as isize - 1) as usize;
                let gy = (((y - fy) / grid.sy).round() as isize).clamp(0, grid.gh as isize - 1) as usize;
                let d = grid.dist[gy * grid.gw + gx] as f64;
                let gap2 = noise.sample(x * 0.025 / k, line_idx as f64 * 3.1) > 0.5;
                let ok = is_water && d > 0.9 && d < reach * (0.8 + 0.4 * noise.sample(x * 0.01 / k, line_idx as f64 * 1.7)) && !gap2;
                if ok {
                    match &mut run {
                        Some(r) => {
                            r.1 = x + step_x;
                            if d > r.2 { r.2 = d; }
                        }
                        None => run = Some((x, x + step_x, d)),
                    }
                } else {
                    flush(&mut run, &mut b_hi, &mut b_mid, &mut b_lo, &mut cv);
                }
                x += step_x;
            }
            flush(&mut run, &mut b_hi, &mut b_mid, &mut b_lo, &mut cv);
            y += gap;
            line_idx += 1;
        }
        for (op, b) in [(0.48, b_hi), (0.30, b_mid), (0.16, b_lo)] {
            if !b.d.is_empty() {
                let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}" opacity="{op:.2}"/>"#, b.d, th.ink_hex, 0.88 * k);
            }
        }
    }
    for (hi, hset) in halo_sets.iter().take(th.halos).enumerate() {
        let mut hb = PathBatch::default();
        let lw = (1.5 - hi as f64 * 0.4) * k;
        let op = 0.9 - hi as f64 * 0.2;
        for (pts, closed) in hset {
            hb.polyline(pts, *closed);
            cv.stroke_poly(pts, *closed, th.ink, lw, op);
        }
        if !hb.d.is_empty() {
            let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{lw:.2}" opacity="{op:.2}"/>"#, hb.d, th.ink_hex);
        }
    }
    let _ = writeln!(svg, "</g>");

    // 1b. Морской полярный лёд (до береговой линии и рельефа, со сглаженной кромкой)
    {
        let mut ice_raw_f = vec![-1.0f32; grid.gw * grid.gh];
        for i in 0..ice_raw_f.len() {
            ice_raw_f[i] = if grid.polar_ice[i] != 0 { 1.0 } else { -1.0 };
        }
        let mut ice_f = vec![-1.0f32; grid.gw * grid.gh];
        for y in 0..grid.gh {
            for x in 0..grid.gw {
                let mut sum = 0.0f32;
                let mut cnt = 0.0f32;
                for dy in -1isize..=1 {
                    let ny = (y as isize + dy).clamp(0, grid.gh as isize - 1) as usize;
                    for dx in -1isize..=1 {
                        let nx = (x as isize + dx).clamp(0, grid.gw as isize - 1) as usize;
                        sum += ice_raw_f[ny * grid.gw + nx];
                        cnt += 1.0;
                    }
                }
                ice_f[y * grid.gw + x] = sum / cnt;
            }
        }
        let pw = grid.gw + 2;
        let ph = grid.gh + 2;
        let mut ice_padded = vec![-1.0f32; pw * ph];
        for y in 0..grid.gh {
            for x in 0..grid.gw {
                ice_padded[(y + 1) * pw + (x + 1)] = ice_f[y * grid.gw + x];
            }
        }
        let ice_filled = marching_contours(&ice_padded, pw, ph, 0.0);
        let ice_edges = marching_contours(&ice_f, grid.gw, grid.gh, 0.0);
        let (ice_rgb, ice_alpha, ice_fill_svg, ice_stroke_rgb, ice_stroke_alpha, ice_stroke_svg, ice_dash, ice_w) = match style {
            Style::Sepia => (
                [226.0, 219.0, 206.0],
                0.38,
                "rgba(226,219,206,0.38)",
                th.ink,
                0.22,
                th.ink_hex,
                Some((4.0 * k, 4.0 * k)),
                0.8 * k,
            ),
            Style::Ink => (
                [247.0, 247.0, 245.0],
                0.58,
                "rgba(247,247,245,0.58)",
                th.ink,
                0.22,
                th.ink_hex,
                Some((4.0 * k, 4.0 * k)),
                0.8 * k,
            ),
            Style::Color => (
                [228.0, 239.0, 246.0],
                0.62,
                "rgba(228,239,246,0.62)",
                [115.0, 148.0, 172.0],
                0.32,
                "rgba(115,148,172,0.32)",
                None,
                0.9 * k,
            ),
        };
        let _ = writeln!(svg, r#"<g id="layer-ice" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round">"#);
        let mut ice_fill_b = PathBatch::default();
        for (pts, closed) in ice_filled {
            if !closed || pts.len() < 4 {
                continue;
            }
            let lp = hand_loop2(grid, &pts, true, noise, 1.1 * k, true);
            if lp.len() < 4 {
                continue;
            }
            ice_fill_b.polyline(&lp, true);
            cv.fill_poly(&lp, ice_rgb, ice_alpha);
        }
        let mut ice_edge_b = PathBatch::default();
        for (pts, closed) in ice_edges {
            if pts.len() < 4 {
                continue;
            }
            let lp = hand_loop2(grid, &pts, closed, noise, 1.1 * k, false);
            if lp.len() < 4 {
                continue;
            }
            ice_edge_b.polyline(&lp, closed);
            if let Some((d1, d2)) = ice_dash {
                cv.stroke_dashed(&lp, d1, d2, ice_stroke_rgb, ice_w, ice_stroke_alpha);
            } else {
                cv.stroke_poly(&lp, closed, ice_stroke_rgb, ice_w, ice_stroke_alpha);
            }
        }
        if !ice_fill_b.d.is_empty() {
            let _ = writeln!(svg, r#"  <path d="{}" fill="{ice_fill_svg}" stroke="none"/>"#, ice_fill_b.d);
        }
        if !ice_edge_b.d.is_empty() {
            let dash_attr = match ice_dash {
                Some((d1, d2)) => format!(r#" stroke-dasharray="{d1:.1} {d2:.1}" opacity="{ice_stroke_alpha:.2}""#),
                None => String::new(),
            };
            let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{ice_stroke_svg}" stroke-width="{ice_w:.2}"{dash_attr}/>"#, ice_edge_b.d);
        }
        let _ = writeln!(svg, "</g>");
    }

    // 2. Реки и озёра
    let _ = writeln!(svg, r#"<g id="layer-rivers" clip-path="url(#fmsFrameClip)" fill="none" stroke-linecap="round" stroke-linejoin="round">"#);
    {
        let mut lk_raw_f = vec![-1.0f32; grid.gw * grid.gh];
        for i in 0..lk_raw_f.len() {
            if grid.lake[i] != 0 {
                lk_raw_f[i] = 1.0;
            }
        }
        let mut lk_f = vec![-1.0f32; grid.gw * grid.gh];
        for y in 0..grid.gh {
            for x in 0..grid.gw {
                let c = lk_raw_f[y * grid.gw + x];
                let xl = x.saturating_sub(1);
                let xr = (x + 1).min(grid.gw - 1);
                let yu = y.saturating_sub(1);
                let yd = (y + 1).min(grid.gh - 1);
                let nb4 = 0.25 * (lk_raw_f[y * grid.gw + xl] + lk_raw_f[y * grid.gw + xr] + lk_raw_f[yu * grid.gw + x] + lk_raw_f[yd * grid.gw + x]);
                lk_f[y * grid.gw + x] = 0.65 * c + 0.35 * nb4;
            }
        }
        let lk_raw = marching_contours(&lk_f, grid.gw, grid.gh, 0.0);
        let mut lk_b = PathBatch::default();
        let lk_col = if th.is_color { th.river_rgb } else { th.water_near };
        for (pts, closed) in lk_raw {
            if !closed || pts.len() < 4 {
                continue;
            }
            let lp = hand_loop2(grid, &pts, true, noise, 0.95 * k, false);
            lk_b.polyline(&lp, true);
            cv.fill_poly(&lp, lk_col, 0.94);
            cv.stroke_poly(&lp, true, th.coast_rgb, coast_w_est(&th), 0.9);
        }
        if !lk_b.d.is_empty() {
            let lk_fill_hex = if th.is_color { th.river_hex } else if th.hatch { "#cfc7b8" } else { "#ececea" };
            let _ = writeln!(svg, r#"  <path d="{}" fill="{lk_fill_hex}" stroke="{}" stroke-width="{:.2}"/>"#, lk_b.d, th.coast_hex, if th.is_color { 1.0 } else { 1.25 } * k);
        }
    }
    let mut r_buckets: [PathBatch; 4] = Default::default();
    for rv in rivers {
        for seg in rv.windows(2) {
            let w_av = 0.5 * (seg[0][2] + seg[1][2]);
            let lw = (0.58 + 1.85 * w_av.clamp(0.06, 0.90)) * k;
            let b = if w_av < 0.22 { 0 } else if w_av < 0.42 { 1 } else if w_av < 0.65 { 2 } else { 3 };
            r_buckets[b].move_line([seg[0][0], seg[0][1]], [seg[1][0], seg[1][1]]);
            cv.stroke_seg([seg[0][0], seg[0][1]], [seg[1][0], seg[1][1]], th.river_rgb, lw, 0.92);
        }
    }
    for (bi, w_av) in [0.14, 0.32, 0.53, 0.76].iter().enumerate() {
        if !r_buckets[bi].d.is_empty() {
            let lw = (0.58 + 1.85 * w_av) * k;
            let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{lw:.2}" opacity="0.92"/>"#, r_buckets[bi].d, th.river_hex);
        }
    }
    if !wadis.is_empty() {
        let mut wb = PathBatch::default();
        for w_line in wadis {
            if w_line.len() < 5 {
                continue;
            }
            wb.polyline(w_line, false);
            cv.stroke_dashed(w_line, 4.0 * k, 4.5 * k, th.river_rgb, 0.8 * k, 0.48);
        }
        if !wb.d.is_empty() {
            let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1}" opacity="0.48"/>"#, wb.d, th.river_hex, 0.8 * k, 4.0 * k, 4.5 * k);
        }
    }
    let _ = writeln!(svg, "</g>");

    // 3. Дороги, дикие тропы и мосты (под береговой линией, как в 0.89.0)
    let _ = writeln!(svg, r#"<g id="layer-roads" clip-path="url(#fmsFrameClip)" fill="none" stroke-linecap="round" stroke-linejoin="round">"#);
    let mut wt_b = PathBatch::default();
    let mut t_b = PathBatch::default();
    let mut r_b = PathBatch::default();
    let mut h_b = PathBatch::default();
    for pts in &roads.wild_trails {
        wt_b.polyline(pts, false);
        cv.stroke_dashed(pts, 2.2 * k, 4.0 * k, th.ink, 0.9 * k, 0.56);
    }
    for pts in &roads.trails {
        t_b.polyline(pts, false);
        cv.stroke_dashed(pts, 4.5 * k, 3.8 * k, th.ink, if th.is_color { 1.0 } else { 1.25 } * k, 0.88);
    }
    for pts in &roads.roads {
        r_b.polyline(pts, false);
        cv.stroke_poly(pts, false, th.ink, if th.is_color { 1.5 } else { 1.8 } * k, 0.9);
    }
    for pts in &roads.highways {
        h_b.polyline(pts, false);
        if th.is_color {
            cv.stroke_poly(pts, false, [255.0, 255.0, 255.0], 3.6 * k, 0.82);
            cv.stroke_poly(pts, false, [178.0, 40.0, 34.0], 2.0 * k, 0.96);
        } else {
            cv.stroke_poly(pts, false, th.ink, 3.4 * k, 0.92);
            cv.stroke_poly(pts, false, th.paper, 1.3 * k, 1.0);
        }
    }
    if !wt_b.d.is_empty() {
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1}" opacity="0.56"/>"#, wt_b.d, th.ink_hex, 0.9 * k, 2.2 * k, 4.0 * k);
    }
    if !t_b.d.is_empty() {
        let lw = if th.is_color { 1.0 } else { 1.25 } * k;
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{lw:.2}" stroke-dasharray="{:.1} {:.1}" opacity="0.88"/>"#, t_b.d, th.ink_hex, 4.5 * k, 3.8 * k);
    }
    if !r_b.d.is_empty() {
        let lw = if th.is_color { 1.5 } else { 1.8 } * k;
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{lw:.2}" opacity="0.90"/>"#, r_b.d, th.ink_hex);
    }
    if !h_b.d.is_empty() {
        let p_hex = if th.is_color { "#faf7ee" } else { th.sym_paper_hex };
        if th.is_color {
            let _ = writeln!(svg, r#"  <path d="{}" stroke="rgba(255,255,255,0.82)" stroke-width="{:.2}"/>"#, h_b.d, 3.6 * k);
            let _ = writeln!(svg, r#"  <path d="{}" stroke="rgb(178,40,34)" stroke-width="{:.2}"/>"#, h_b.d, 2.0 * k);
        } else {
            let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}" opacity="0.92"/>"#, h_b.d, th.ink_hex, 3.4 * k);
            let _ = writeln!(svg, r#"  <path d="{}" stroke="{p_hex}" stroke-width="{:.2}"/>"#, h_b.d, 1.3 * k);
        }
    }
    let mut br_b = PathBatch::default();
    for &(pt, dir, cls) in &roads.bridges {
        let l = dir[0].hypot(dir[1]).max(1e-6);
        let (ux, uy) = (dir[0] / l, dir[1] / l);
        let (px, py) = (-uy, ux);
        let bw = (3.0 + cls as f64) * k;
        for off in [-2.4 * k, 2.4 * k] {
            let p0 = [pt[0] + ux * off + px * bw, pt[1] + uy * off + py * bw];
            let p1 = [pt[0] + ux * off - px * bw, pt[1] + uy * off - py * bw];
            br_b.move_line(p0, p1);
            cv.stroke_seg(p0, p1, th.ink, 1.3 * k, 0.95);
        }
    }
    if !br_b.d.is_empty() {
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}"/>"#, br_b.d, th.ink_hex, 1.3 * k);
    }
    let _ = writeln!(svg, "</g>");

    // 4. Береговая линия (ручная рябь + Chaikin)
    let _ = writeln!(svg, r#"<g id="layer-coast" clip-path="url(#fmsFrameClip)" fill="none" stroke-linejoin="round" stroke-linecap="round">"#);
    let mut c_b = PathBatch::default();
    let coast_w = (if th.is_color { 1.25 } else { 2.3 }) * k;
    for (pts, closed) in coast_strokes {
        c_b.polyline(pts, *closed);
        cv.stroke_poly(pts, *closed, th.coast_rgb, coast_w, if th.is_color { 0.78 } else { 1.0 });
    }
    if !c_b.d.is_empty() {
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{coast_w:.2}"/>"#, c_b.d, th.coast_hex);
    }
    let _ = writeln!(svg, "</g>");

    // 5. Горы, холмы, увалы, формы рельефа и растительность (0.89.0 render_symbols.js)
    let mut m_form = PathBatch::default();
    {
        let gw = grid.gw;
        let gh = grid.gh;
        let mut sm_h: Vec<f32> = (0..(gw * gh))
            .map(|i| if grid.ocean[i] == 0 { grid.h[i] } else { -0.20 })
            .collect();
        let mut tmp_h = vec![0.0f32; gw * gh];
        for _ in 0..4 {
            for y in 0..gh {
                for x in 0..gw {
                    let mut sum = 0.0f32;
                    let mut cnt = 0.0f32;
                    for dy in -1isize..=1 {
                        let ny = (y as isize + dy).clamp(0, gh as isize - 1) as usize;
                        for dx in -1isize..=1 {
                            let nx = (x as isize + dx).clamp(0, gw as isize - 1) as usize;
                            sum += sm_h[ny * gw + nx];
                            cnt += 1.0;
                        }
                    }
                    tmp_h[y * gw + x] = sum / cnt;
                }
            }
            sm_h.copy_from_slice(&tmp_h);
        }
        for &lvl in &[0.28f32, 0.54] {
            for (pts, closed) in marching_contours(&sm_h, gw, gh, lvl) {
                if pts.len() < 8 {
                    continue;
                }
                let raw_px: Vec<[f64; 2]> = pts.into_iter().map(|[x, y]| [grid.px(x), grid.py(y)]).collect();
                let sm = chaikin_open(raw_px, 1);
                let mut cur_run: Vec<[f64; 2]> = Vec::new();
                for p in &sm {
                    let gx = (((p[0] - fx) / grid.sx).round() as isize).clamp(0, gw as isize - 1) as usize;
                    let gy = (((p[1] - fy) / grid.sy).round() as isize).clamp(0, gh as isize - 1) as usize;
                    let gi = gy * gw + gx;
                    let show = grid.ocean[gi] == 0
                        && grid.lake[gi] == 0
                        && grid.young[gi] < 0.25
                        && noise.sample(p[0] * 0.015 / k + 17.0, p[1] * 0.015 / k + 9.0) > -0.18;
                    if show {
                        cur_run.push(*p);
                    } else if cur_run.len() >= 3 {
                        m_form.polyline(&cur_run, false);
                        cv.stroke_poly(&cur_run, false, th.sym_ink, 0.65 * k, 0.16);
                        cur_run.clear();
                    } else {
                        cur_run.clear();
                    }
                }
                if cur_run.len() >= 3 {
                    let cl = closed && cur_run.len() >= sm.len();
                    m_form.polyline(&cur_run, cl);
                    cv.stroke_poly(&cur_run, cl, th.sym_ink, 0.65 * k, 0.16);
                }
            }
        }
    }

    let feats = place_features(grid, noise, seed);
    let mut m_fill = PathBatch::default();
    let mut m_sh_light = PathBatch::default();
    let mut m_sh_dark = PathBatch::default();
    let mut m_hatch = PathBatch::default();
    let mut m_out = PathBatch::default();
    let mut m_mid = PathBatch::default();
    let mut m_fine = PathBatch::default();
    let mut m_downs = PathBatch::default();

    let mut veg_fill = PathBatch::default();
    let mut veg_stroke = PathBatch::default();
    let mut veg_thin = PathBatch::default();
    let mut veg_soft = PathBatch::default();
    let mut veg_dots = PathBatch::default();

    let base_alpha = if th.is_color { 0.86 } else { 1.0 };

    for it in &feats {
        match it.kind {
            FeatKind::Mountain => {
                if it.s > 0.48 && it.r[10] > 0.45 {
                    let side = if it.r[9] < 0.5 { -1.0 } else { 1.0 };
                    let sc = 0.5 + 0.22 * it.r[8];
                    let mut rr_rev = it.r;
                    rr_rev.reverse();
                    emit_peak(
                        it.x + side * it.w * 0.38,
                        it.y - it.h * 0.04,
                        it.w * sc,
                        it.h * sc,
                        &rr_rev,
                        &th,
                        k,
                        &mut m_fill,
                        &mut m_sh_light,
                        &mut m_sh_dark,
                        &mut m_hatch,
                        &mut m_out,
                        &mut m_mid,
                        &mut m_fine,
                        &mut cv,
                    );
                }
                emit_peak(
                    it.x,
                    it.y,
                    it.w,
                    it.h,
                    &it.r,
                    &th,
                    k,
                    &mut m_fill,
                    &mut m_sh_light,
                    &mut m_sh_dark,
                    &mut m_hatch,
                    &mut m_out,
                    &mut m_mid,
                    &mut m_fine,
                    &mut cv,
                );
            }
            FeatKind::Hill => {
                let hw = it.w * 0.5;
                let curve = quad_curve_pts([it.x - hw, it.y], [it.x - hw * 0.1, it.y - it.h * 2.1], [it.x + hw, it.y], 6);
                m_fill.polyline(&curve, true);
                m_out.polyline(&curve, false);
                cv.fill_poly(&curve, th.sym_paper, base_alpha);
                cv.stroke_poly(&curve, false, th.sym_ink, 1.2 * k, base_alpha);
                let nh = 2 + (it.r[4] * 2.0).floor() as usize;
                for j in 0..nh {
                    let t = 0.55 + j as f64 * 0.13;
                    let sx = it.x + hw * (t - 0.1);
                    let sy = it.y - it.h * (1.0 - t * t * 0.9);
                    let p1 = [sx + it.w * 0.06, it.y - it.h * 0.08];
                    m_hatch.move_line([sx, sy], p1);
                    cv.stroke_seg([sx, sy], p1, th.sym_ink, 0.8 * k, base_alpha);
                }
            }
            FeatKind::Downs => {
                let hw = it.w * 0.5;
                let curve = quad_curve_pts([it.x - hw, it.y], [it.x - hw * 0.15, it.y - it.h * 1.9], [it.x + hw, it.y + it.h * 0.06], 5);
                m_downs.polyline(&curve, false);
                cv.stroke_poly(&curve, false, th.sym_ink, 0.72 * k, 0.44 * base_alpha);
                for j in 0..2 {
                    let t = 0.52 + j as f64 * 0.20;
                    let sx = it.x + hw * (t - 0.12);
                    let sy = it.y - it.h * (1.0 - t * t * 0.85) * 0.9;
                    let p1 = [sx + it.w * 0.05, it.y - it.h * 0.06];
                    m_downs.move_line([sx, sy], p1);
                    cv.stroke_seg([sx, sy], p1, th.sym_ink, 0.55 * k, 0.34 * base_alpha);
                }
            }
            FeatKind::Volcano => {
                let hw = it.w * 0.5;
                let cr = it.w * 0.13;
                let rim_y = it.y - it.h;
                let left_fl = quad_curve_pts([it.x - hw, it.y], [it.x - hw * 0.4, it.y - it.h * 0.12], [it.x - cr, rim_y], 5);
                let right_fl = quad_curve_pts([it.x + cr, rim_y], [it.x + hw * 0.4, it.y - it.h * 0.12], [it.x + hw, it.y], 5);
                let mut body = Vec::new();
                body.extend_from_slice(&left_fl);
                body.extend_from_slice(&right_fl);
                body.push([it.x, it.y + it.h * 0.05]);
                m_fill.polyline(&body, true);
                m_out.polyline(&body, false);
                cv.fill_poly(&body, th.sym_paper, base_alpha);
                let mut shade = vec![[it.x, rim_y]];
                shade.extend_from_slice(&right_fl);
                shade.push([it.x, it.y]);
                m_sh_dark.polyline(&shade, true);
                cv.fill_poly(&shade, th.sym_ink, 0.22 * base_alpha);
                cv.stroke_poly(&body, false, th.sym_ink, 1.25 * k, base_alpha);
                for j in 0..7 {
                    let u = 0.15 + 0.8 * (j as f64 + 0.5) / 7.0;
                    let t0 = 0.3 + 0.15 * ((j * 5) % 3) as f64;
                    let sx = it.x + cr * u;
                    let sy = rim_y + cr * 0.3;
                    let ex = it.x + hw * u;
                    let ey = it.y;
                    let p0 = [sx + (ex - sx) * t0, sy + (ey - sy) * t0];
                    let p1 = [sx + (ex - sx) * 0.95, sy + (ey - sy) * 0.95];
                    m_hatch.move_line(p0, p1);
                    cv.stroke_seg(p0, p1, th.sym_ink, 0.8 * k, 0.85 * base_alpha);
                }
                if it.active {
                    for a in [-0.9f64, 0.0, 0.9] {
                        let ca = a.sin();
                        let co = -a.cos();
                        let p0 = [it.x + ca * cr * 1.15, rim_y + co * cr * 0.55 - cr * 0.1];
                        let p1 = [it.x + ca * cr * 2.1, rim_y + co * cr * 1.5 - cr * 0.1];
                        m_mid.move_line(p0, p1);
                        cv.stroke_seg(p0, p1, th.sym_ink, 1.0 * k, base_alpha);
                    }
                    let smoke = quad_curve_pts([it.x + cr * 0.2, rim_y - cr * 1.8], [it.x - cr * 1.1, rim_y - it.h * 0.55], [it.x + cr * 0.3, rim_y - it.h * 1.05], 5);
                    m_hatch.polyline(&smoke, false);
                    cv.stroke_poly(&smoke, false, th.sym_ink, 0.9 * k, 0.75 * base_alpha);
                }
            }
            FeatKind::Tree => {
                let mut cr = quad_curve_pts([it.x, it.y - it.h], [it.x + it.w * 0.85, it.y - it.h * 0.4], [it.x, it.y - it.h * 0.1], 4);
                let cr2 = quad_curve_pts([it.x, it.y - it.h * 0.1], [it.x - it.w * 0.85, it.y - it.h * 0.4], [it.x, it.y - it.h], 4);
                cr.extend(cr2.into_iter().skip(1));
                veg_fill.polyline(&cr, true);
                veg_stroke.polyline(&cr, true);
                veg_stroke.move_line([it.x, it.y - it.h * 0.1], [it.x, it.y + it.h * 0.05]);
                cv.fill_poly(&cr, th.veg_paper, base_alpha);
                cv.stroke_poly(&cr, true, th.sym_ink, 1.0 * k, base_alpha);
                cv.stroke_seg([it.x, it.y - it.h * 0.1], [it.x, it.y + it.h * 0.05], th.sym_ink, 1.0 * k, base_alpha);
                for j in 0..3 {
                    let yy = it.y - it.h * (0.75 - j as f64 * 0.2);
                    let p0 = [it.x + it.w * 0.08, yy];
                    let p1 = [it.x + it.w * (0.5 - j as f64 * 0.1), yy + it.h * 0.1];
                    veg_thin.move_line(p0, p1);
                    cv.stroke_seg(p0, p1, th.sym_ink, 0.7 * k, base_alpha);
                }
            }
            FeatKind::Conifer => {
                let cr = vec![[it.x, it.y - it.h], [it.x + it.w, it.y - it.h * 0.12], [it.x - it.w, it.y - it.h * 0.12]];
                veg_fill.polyline(&cr, true);
                veg_stroke.polyline(&cr, true);
                veg_thin.move_line([it.x, it.y - it.h * 0.12], [it.x, it.y + it.h * 0.05]);
                veg_thin.move_line([it.x, it.y - it.h * 0.65], [it.x + it.w * 0.45, it.y - it.h * 0.35]);
                veg_thin.move_line([it.x, it.y - it.h * 0.45], [it.x + it.w * 0.65, it.y - it.h * 0.22]);
                cv.fill_poly(&cr, th.veg_paper, base_alpha);
                cv.stroke_poly(&cr, true, th.sym_ink, 1.0 * k, base_alpha);
                cv.stroke_seg([it.x, it.y - it.h * 0.12], [it.x, it.y + it.h * 0.05], th.sym_ink, 0.7 * k, base_alpha);
                cv.stroke_seg([it.x, it.y - it.h * 0.65], [it.x + it.w * 0.45, it.y - it.h * 0.35], th.sym_ink, 0.7 * k, base_alpha);
            }
            FeatKind::Jungle => {
                let mut cr = quad_curve_pts([it.x - it.w, it.y - it.h * 0.45], [it.x - it.w * 0.5, it.y - it.h * 1.1], [it.x, it.y - it.h * 0.95], 4);
                let cr2 = quad_curve_pts([it.x, it.y - it.h * 0.95], [it.x + it.w * 0.6, it.y - it.h * 1.1], [it.x + it.w, it.y - it.h * 0.45], 4);
                let cr3 = quad_curve_pts([it.x + it.w, it.y - it.h * 0.45], [it.x, it.y - it.h * 0.3], [it.x - it.w, it.y - it.h * 0.45], 3);
                cr.extend(cr2.into_iter().skip(1));
                cr.extend(cr3.into_iter().skip(1));
                veg_fill.polyline(&cr, true);
                veg_stroke.polyline(&cr, true);
                veg_stroke.move_line([it.x, it.y - it.h * 0.4], [it.x, it.y + it.h * 0.05]);
                cv.fill_poly(&cr, th.veg_paper, base_alpha);
                cv.stroke_poly(&cr, true, th.sym_ink, 1.0 * k, base_alpha);
                cv.stroke_seg([it.x, it.y - it.h * 0.4], [it.x, it.y + it.h * 0.05], th.sym_ink, 1.0 * k, base_alpha);
            }
            FeatKind::Acacia => {
                let tr = quad_curve_pts([it.x, it.y], [it.x - it.w * 0.05, it.y - it.h * 0.5], [it.x, it.y - it.h * 0.75], 3);
                let cp = quad_curve_pts([it.x - it.w, it.y - it.h * 0.8], [it.x, it.y - it.h * 1.25], [it.x + it.w, it.y - it.h * 0.8], 4);
                veg_stroke.polyline(&tr, false);
                veg_stroke.polyline(&cp, false);
                cv.stroke_poly(&tr, false, th.sym_ink, 1.0 * k, base_alpha);
                cv.stroke_poly(&cp, false, th.sym_ink, 1.0 * k, base_alpha);
            }
            FeatKind::Tuft => {
                for (dx0, dx1, hm) in [(-0.5, -0.55, 0.9), (0.0, 0.0, 1.2), (0.5, 0.6, 0.8)] {
                    let p0 = [it.x + it.w * dx0, it.y];
                    let p1 = [it.x + it.w * dx1, it.y - it.h * hm];
                    veg_soft.move_line(p0, p1);
                    cv.stroke_seg(p0, p1, th.sym_ink, 0.72 * k, 0.52 * base_alpha);
                }
            }
            FeatKind::Dune => {
                let mut d = quad_curve_pts([it.x - it.w, it.y], [it.x - it.w * 0.3, it.y - it.h * 1.6], [it.x + it.w * 0.2, it.y - it.h * 0.2], 4);
                let d2 = quad_curve_pts([it.x + it.w * 0.2, it.y - it.h * 0.2], [it.x + it.w * 0.5, it.y - it.h * 0.9], [it.x + it.w, it.y], 3);
                d.extend(d2.into_iter().skip(1));
                veg_soft.polyline(&d, false);
                cv.stroke_poly(&d, false, th.sym_ink, 0.75 * k, 0.54 * base_alpha);
            }
            FeatKind::Ice => {
                veg_soft.move_line([it.x - it.w * 0.6, it.y], [it.x + it.w * 0.6, it.y - it.h * 0.3]);
                veg_soft.move_line([it.x - it.w * 0.1, it.y - it.h * 0.9], [it.x + it.w * 0.1, it.y + it.h * 0.1]);
                cv.stroke_seg([it.x - it.w * 0.6, it.y], [it.x + it.w * 0.6, it.y - it.h * 0.3], th.sym_ink, 0.65 * k, 0.45 * base_alpha);
            }
            FeatKind::Swamp => {
                veg_soft.move_line([it.x - it.w * 0.9, it.y + it.h * 0.3], [it.x + it.w * 0.3, it.y + it.h * 0.3]);
                veg_soft.move_line([it.x - it.w * 0.5, it.y], [it.x - it.w * 0.55, it.y - it.h * 1.3]);
                veg_soft.move_line([it.x - it.w * 0.25, it.y], [it.x - it.w * 0.2, it.y - it.h * 1.6]);
                veg_dots.move_line([it.x - it.w * 0.2, it.y - it.h * 1.75], [it.x - it.w * 0.2, it.y - it.h * 1.45]);
                cv.stroke_seg([it.x - it.w * 0.2, it.y], [it.x - it.w * 0.2, it.y - it.h * 1.6], th.sym_ink, 0.7 * k, 0.60 * base_alpha);
            }
        }
    }

    let op_attr = if th.is_color { r#" opacity="0.86""# } else { "" };
    let _ = writeln!(svg, r#"<g id="layer-relief" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round"{op_attr}>"#);
    if !m_form.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}" opacity="0.18"/>"#, m_form.d, th.sym_ink_hex, 0.65 * k); }
    if !m_downs.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}" opacity="0.44"/>"#, m_downs.d, th.sym_ink_hex, 0.72 * k); }
    if !m_fill.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="{}"/>"#, m_fill.d, th.sym_paper_hex); }
    if !m_sh_light.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="{}" fill-opacity="0.13"/>"#, m_sh_light.d, th.sym_ink_hex); }
    if !m_sh_dark.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="{}" fill-opacity="0.24"/>"#, m_sh_dark.d, th.sym_ink_hex); }
    if !m_hatch.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}" opacity="0.82"/>"#, m_hatch.d, th.sym_ink_hex, 0.75 * k); }
    if !m_out.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#, m_out.d, th.sym_ink_hex, 1.35 * k); }
    if !m_mid.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#, m_mid.d, th.sym_ink_hex, 1.0 * k); }
    if !m_fine.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}" opacity="0.85"/>"#, m_fine.d, th.sym_ink_hex, 0.8 * k); }
    let _ = writeln!(svg, "</g>");

    let _ = writeln!(svg, r#"<g id="layer-forests" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round"{op_attr}>"#);
    if !veg_soft.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}" opacity="0.54"/>"#, veg_soft.d, th.sym_ink_hex, 0.72 * k); }
    if !veg_fill.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="{}"/>"#, veg_fill.d, th.veg_paper_hex); }
    if !veg_stroke.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#, veg_stroke.d, th.sym_ink_hex, 1.0 * k); }
    if !veg_thin.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#, veg_thin.d, th.sym_ink_hex, 0.75 * k); }
    if !veg_dots.d.is_empty() { let _ = writeln!(svg, r#"  <path d="{}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#, veg_dots.d, th.sym_ink_hex, 1.6 * k); }
    let _ = writeln!(svg, "</g>");

    // 6. Морские течения
    let _ = writeln!(svg, r#"<g id="layer-currents" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round">"#);
    for st in currents {
        if st.len() < 2 {
            continue;
        }
        let mut d = format!("M{:.1},{:.1}", st[0][0], st[0][1]);
        let avg_t = st.iter().map(|p| p[2]).sum::<f64>() / st.len() as f64;
        for p in &st[1..] {
            let _ = write!(d, " L{:.1},{:.1}", p[0], p[1]);
        }
        let col = if avg_t > 0.04 {
            if th.is_color { "rgba(200,70,50,0.78)" } else if th.hatch { "rgba(150,62,40,0.78)" } else { "rgba(60,60,60,0.72)" }
        } else if avg_t < -0.04 {
            if th.is_color { "rgba(40,100,190,0.78)" } else if th.hatch { "rgba(52,88,120,0.78)" } else { "rgba(20,20,20,0.82)" }
        } else {
            "rgba(110,115,120,0.68)"
        };
        let dash = if !th.is_color && !th.hatch && avg_t < -0.04 {
            format!(r#" stroke-dasharray="{:.1} {:.1}""#, 9.0 * k, 6.0 * k)
        } else {
            String::new()
        };
        let _ = writeln!(svg, r#"  <path d="{d}" fill="none" stroke="{col}" stroke-width="{:.2}"{dash}/>"#, 1.5 * k);
    }
    let _ = writeln!(svg, "</g>");

    // 8. Морские пути (выведены от берега + мягкая подложка, чтобы не сливались со штриховкой берега)
    let _ = writeln!(svg, r#"<g id="layer-routes" clip-path="url(#fmsFrameClip)" fill="none" stroke-linecap="round">"#);
    let mut sr_case = PathBatch::default();
    let mut sr_b = PathBatch::default();
    let sr_col = if th.is_color { [24.0, 52.0, 102.0] } else if th.hatch { [42.0, 68.0, 94.0] } else { th.ink };
    let sr_case_col = th.water_near;
    let sr_case_svg = match style {
        Style::Sepia => "rgba(218,214,204,0.62)",
        Style::Ink => "rgba(247,247,245,0.72)",
        Style::Color => "rgba(176,204,228,0.58)",
    };
    for rt in &roads.sea_routes {
        if rt.pts.len() < 2 {
            continue;
        }
        let sm = push_sea_route_offshore(grid, &th, rt.pts.clone());
        sr_case.polyline(&sm, false);
        sr_b.polyline(&sm, false);
        cv.stroke_poly(&sm, false, sr_case_col, 3.0 * k, 0.56);
        cv.stroke_dashed(&sm, 3.6 * k, 5.4 * k, sr_col, 1.65 * k, 0.88);
    }
    if !sr_case.d.is_empty() {
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{sr_case_svg}" stroke-width="{:.2}"/>"#, sr_case.d, 3.0 * k);
    }
    if !sr_b.d.is_empty() {
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1}" opacity="0.90"/>"#, sr_b.d, th.sea_route_hex, 1.65 * k, 3.6 * k, 5.4 * k);
    }
    let _ = writeln!(svg, "</g>");

    // 9. Границы государств
    let borders = border_lines(grid, noise);
    let _ = writeln!(svg, r#"<g id="layer-borders" clip-path="url(#fmsFrameClip)" fill="none" stroke-linecap="round" stroke-linejoin="round">"#);
    if !borders.is_empty() {
        let mut bd = PathBatch::default();
        for b in &borders {
            bd.polyline(b, false);
            cv.stroke_dashed(b, 10.0 * k, 5.0 * k, th.ink, 2.3 * k, 0.90);
        }
        let _ = writeln!(svg, r#"  <path d="{}" stroke="{}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1} {:.1} {:.1}" opacity="0.92"/>"#, bd.d, th.ink_hex, 2.3 * k, 11.0 * k, 4.0 * k, 2.5 * k, 4.0 * k);
    }
    let _ = writeln!(svg, "</g>");

    // 10. Значки городов и важных точек
    let _ = writeln!(svg, r#"<g id="layer-settlements" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round">"#);
    let mut occupied: Vec<Rect> = Vec::new();

    // Поселения, к которым подходят видимые дороги или морские пути, отображаем и на карте мира, чтобы дороги не обрывались
    let is_route_endpoint = |sx: f64, sy: f64| -> bool {
        let thr2 = (14.0 * k) * (14.0 * k);
        let check_poly = |pts: &[[f64; 2]]| -> bool {
            if let (Some(&a), Some(&b)) = (pts.first(), pts.last()) {
                let da = (a[0] - sx) * (a[0] - sx) + (a[1] - sy) * (a[1] - sy);
                let db = (b[0] - sx) * (b[0] - sx) + (b[1] - sy) * (b[1] - sy);
                if da <= thr2 || db <= thr2 {
                    return true;
                }
            }
            false
        };
        roads.highways.iter().any(|p| check_poly(p))
            || roads.roads.iter().any(|p| check_poly(p))
            || roads.trails.iter().any(|p| check_poly(p))
            || roads.sea_routes.iter().any(|r| check_poly(&r.pts))
    };

    let mut ordered_st: Vec<&SettlementPin> = settlements
        .iter()
        .filter(|s| {
            if is_world {
                matches!(s.kind, "capital" | "metropolis" | "city" | "port" | "fortress" | "mine")
                    || is_route_endpoint(s.x, s.y)
            } else {
                true
            }
        })
        .collect();
    let st_rank = |kd: &str| match kd {
        "capital" => 0,
        "metropolis" => 1,
        "city" => 2,
        "port" => 3,
        "town" => 4,
        "fortress" => 5,
        "mine" => 6,
        _ => 7,
    };
    ordered_st.sort_by_key(|s| st_rank(s.kind));

    for st in &ordered_st {
        let (x, y) = (st.x, st.y);
        if x < fx + 6.0 || x > fx + fw - 6.0 || y < fy + 6.0 || y > fy + fh - 6.0 {
            continue;
        }
        occupied.push(Rect { x: x - 8.0 * k, y: y - 8.0 * k, w: 16.0 * k, h: 16.0 * k });
        let paper_hex = if th.is_color { "#faf7ee" } else { th.sym_paper_hex };
        let id_attr = st.id.map(|id| id.to_string()).unwrap_or_default();
        let _ = writeln!(
            svg,
            r#"  <g class="settlement-icon" data-id="{id_attr}" data-name="{}" data-sub="{}" data-kind="{}" data-lat="{:.4}" data-lon="{:.4}" style="cursor:pointer">"#,
            xml_escape(&st.name), xml_escape(&st.subtitle), st.kind, st.lat, st.lon
        );
        let _ = writeln!(svg, r#"    <circle cx="{x:.1}" cy="{y:.1}" r="{:.1}" fill="transparent" stroke="none"/>"#, 8.5 * k);
        match st.kind {
            "capital" => {
                let r = 6.5 * k;
                let pts = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
                cv.fill_poly(&pts, th.paper, 1.0);
                cv.stroke_poly(&pts, true, th.ink, 1.8 * k, 1.0);
                cv.fill_circle(x, y, 2.0 * k, th.ink, 1.0);
                let _ = writeln!(svg, r#"    <polygon points="{x:.1},{:.1} {:.1},{y:.1} {x:.1},{:.1} {:.1},{y:.1}" fill="{paper_hex}" stroke="{}" stroke-width="{:.2}"/><circle cx="{x:.1}" cy="{y:.1}" r="{:.2}" fill="{}"/>"#, y - r, x + r, y + r, x - r, th.ink_hex, 1.8 * k, 2.0 * k, th.ink_hex);
            }
            "metropolis" => {
                let ro = 7.4 * k;
                let r = 5.4 * k;
                let outer = [[x, y - ro], [x + ro, y], [x, y + ro], [x - ro, y]];
                let inner = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
                cv.stroke_poly(&outer, true, th.ink, 1.15 * k, 0.92);
                cv.fill_poly(&inner, th.ink, 1.0);
                let _ = writeln!(svg, r#"    <polygon points="{x:.1},{:.1} {:.1},{y:.1} {x:.1},{:.1} {:.1},{y:.1}" fill="{paper_hex}" stroke="{}" stroke-width="{:.2}"/><polygon points="{x:.1},{:.1} {:.1},{y:.1} {x:.1},{:.1} {:.1},{y:.1}" fill="{}" stroke="{}" stroke-width="{:.2}"/>"#, y - ro, x + ro, y + ro, x - ro, th.ink_hex, 1.15 * k, y - r, x + r, y + r, x - r, th.ink_hex, th.ink_hex, 1.4 * k);
            }
            "city" => {
                let r = 4.6 * k;
                let pts = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
                cv.fill_poly(&pts, th.ink, 1.0);
                let _ = writeln!(svg, r#"    <polygon points="{x:.1},{:.1} {:.1},{y:.1} {x:.1},{:.1} {:.1},{y:.1}" fill="{}" stroke="{}" stroke-width="{:.2}"/>"#, y - r, x + r, y + r, x - r, th.ink_hex, th.ink_hex, 1.4 * k);
            }
            "town" => {
                let r = 3.5 * k;
                let pts = [[x, y - r], [x + r, y], [x, y + r], [x - r, y]];
                cv.fill_poly(&pts, th.paper, 1.0);
                cv.stroke_poly(&pts, true, th.ink, 1.4 * k, 1.0);
                let _ = writeln!(svg, r#"    <polygon points="{x:.1},{:.1} {:.1},{y:.1} {x:.1},{:.1} {:.1},{y:.1}" fill="{paper_hex}" stroke="{}" stroke-width="{:.2}"/>"#, y - r, x + r, y + r, x - r, th.ink_hex, 1.4 * k);
            }
            "village" => {
                cv.fill_circle(x, y, 2.0 * k, th.ink, 0.90);
                let _ = writeln!(svg, r#"    <circle cx="{x:.1}" cy="{y:.1}" r="{:.2}" fill="{}" stroke="{paper_hex}" stroke-width="{:.2}"/>"#, 2.0 * k, th.ink_hex, 0.6 * k);
            }
            "port" => {
                cv.stroke_seg([x, y - 2.1 * k], [x, y + 3.8 * k], th.ink, 1.4 * k, 1.0);
                cv.stroke_seg([x - 2.6 * k, y - 0.6 * k], [x + 2.6 * k, y - 0.6 * k], th.ink, 1.4 * k, 1.0);
                let arc = quad_curve_pts([x - 3.6 * k, y + 1.0 * k], [x, y + 6.5 * k], [x + 3.6 * k, y + 1.0 * k], 4);
                cv.stroke_poly(&arc, false, th.ink, 1.4 * k, 1.0);
                let _ = writeln!(svg, r#"    <g fill="none" stroke="{}" stroke-width="{:.2}"><circle cx="{x:.1}" cy="{:.1}" r="{:.2}"/><path d="M{x:.1},{:.1} L{x:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} Q{x:.1},{:.1} {:.1},{:.1}"/></g>"#, th.ink_hex, 1.4 * k, y - 3.4 * k, 1.3 * k, y - 2.1 * k, y + 3.8 * k, x - 2.6 * k, y - 0.6 * k, x + 2.6 * k, y - 0.6 * k, x - 3.6 * k, y + 1.0 * k, y + 6.5 * k, x + 3.6 * k, y + 1.0 * k);
            }
            "fortress" => {
                let pts = [[x - 3.8 * k, y - 3.0 * k], [x + 3.8 * k, y - 3.0 * k], [x + 3.8 * k, y + 3.6 * k], [x - 3.8 * k, y + 3.6 * k]];
                cv.fill_poly(&pts, th.paper, 1.0);
                cv.stroke_poly(&pts, true, th.ink, 1.5 * k, 1.0);
                let _ = writeln!(svg, r#"    <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{paper_hex}" stroke="{}" stroke-width="{:.2}"/><path d="M{:.1},{:.1} v{:.1} M{x:.1},{:.1} v{:.1} M{:.1},{:.1} v{:.1}" stroke="{}" stroke-width="{:.2}"/>"#, x - 3.8 * k, y - 3.0 * k, 7.6 * k, 6.6 * k, th.ink_hex, 1.5 * k, x - 3.8 * k, y - 3.0 * k, -2.2 * k, y - 3.0 * k, -2.2 * k, x + 3.8 * k, y - 3.0 * k, -2.2 * k, th.ink_hex, 1.4 * k);
            }
            "mine" => {
                cv.stroke_seg([x - 4.0 * k, y - 4.0 * k], [x + 4.0 * k, y + 4.0 * k], th.ink, 1.8 * k, 1.0);
                cv.stroke_seg([x + 4.0 * k, y - 4.0 * k], [x - 4.0 * k, y + 4.0 * k], th.ink, 1.8 * k, 1.0);
                let _ = writeln!(svg, r#"    <path d="M{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#, x - 4.0 * k, y - 4.0 * k, x + 4.0 * k, y + 4.0 * k, x + 4.0 * k, y - 4.0 * k, x - 4.0 * k, y + 4.0 * k, x - 5.5 * k, y - 2.2 * k, x - 2.4 * k, y - 5.4 * k, x + 5.5 * k, y - 2.2 * k, x + 2.4 * k, y - 5.4 * k, th.ink_hex, 1.7 * k);
            }
            _ => {
                cv.fill_circle(x, y, 2.2 * k, th.ink, 1.0);
                let _ = writeln!(svg, r#"    <circle cx="{x:.1}" cy="{y:.1}" r="{:.2}" fill="{}"/>"#, 2.2 * k, th.ink_hex);
            }
        }
        let _ = writeln!(svg, "  </g>");
    }
    let _ = writeln!(svg, "</g>");

    // 10a. Дикие стоянки охотников и древние руины в необжитых биомах
    let _ = writeln!(svg, r#"<g id="layer-wildsites" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round">"#);
    for ws in wild_sites {
        let (x, y) = (ws.x, ws.y);
        if x < fx + 6.0 || x > fx + fw - 6.0 || y < fy + 6.0 || y > fy + fh - 6.0 {
            continue;
        }
        occupied.push(Rect { x: x - 6.0 * k, y: y - 6.0 * k, w: 12.0 * k, h: 12.0 * k });
        match ws.kind {
            "camp" => {
                let s = 3.8 * k;
                let tent = [[x - s, y + s * 0.7], [x, y - s * 0.9], [x + s, y + s * 0.7]];
                cv.stroke_poly(&tent, true, th.ink, 1.15 * k, 0.78);
                cv.stroke_seg([x, y - s * 0.9], [x, y + s * 0.7], th.ink, 0.85 * k, 0.70);
                let _ = writeln!(
                    svg,
                    r#"  <g opacity="0.78"><path d="M{:.1},{:.1} L{x:.1},{:.1} L{:.1},{:.1} Z M{x:.1},{:.1} L{x:.1},{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/><title>{}</title></g>"#,
                    x - s, y + s * 0.7, y - s * 0.9, x + s, y + s * 0.7, y - s * 0.9, y + s * 0.7, th.ink_hex, 1.15 * k, xml_escape(&ws.name)
                );
            }
            _ => {
                let s = 3.5 * k;
                cv.stroke_seg([x - s, y + s * 0.7], [x + s, y + s * 0.7], th.ink, 1.1 * k, 0.78);
                for dx in [-s * 0.65, 0.0, s * 0.65] {
                    cv.stroke_seg([x + dx, y + s * 0.7], [x + dx, y - s * 0.6], th.ink, 1.1 * k, 0.78);
                }
                let _ = writeln!(
                    svg,
                    r#"  <g opacity="0.78"><path d="M{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1} M{x:.1},{:.1} L{x:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/><title>{}</title></g>"#,
                    x - s, y + s * 0.7, x + s, y + s * 0.7,
                    x - s * 0.65, y + s * 0.7, x - s * 0.65, y - s * 0.65,
                    y + s * 0.7, y - s * 0.35,
                    x + s * 0.65, y + s * 0.7, x + s * 0.65, y - s * 0.8,
                    th.ink_hex, 1.1 * k, xml_escape(&ws.name)
                );
            }
        }
    }
    let _ = writeln!(svg, "</g>");

    // 10b. Природные геометки и туристические ориентиры (POIs)
    let _ = writeln!(svg, r#"<g id="layer-pois" clip-path="url(#fmsFrameClip)" stroke-linecap="round">"#);
    for p in pois {
        let s = 3.6 * k;
        match p.kind {
            "pass" => {
                let _ = writeln!(svg, r#"  <path d="M{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"><title>{}</title></path>"#, p.x - s, p.y - s * 0.7, p.x - s * 0.3, p.y, p.x - s, p.y + s * 0.7, p.x + s, p.y - s * 0.7, p.x + s * 0.3, p.y, p.x + s, p.y + s * 0.7, th.ink_hex, 1.15 * k, xml_escape(&p.name));
            }
            "waterfall" => {
                let _ = writeln!(svg, r#"  <g><line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{}" stroke-width="{:.2}"/><line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{}" stroke-width="{:.2}"/><title>{}</title></g>"#, p.x - s, p.y - s * 0.3, p.x + s, p.y - s * 0.3, th.river_hex, 1.3 * k, p.x - s * 0.6, p.y + s * 0.4, p.x + s * 0.6, p.y + s * 0.4, th.ink_hex, 1.1 * k, xml_escape(&p.name));
            }
            _ => {
                let _ = writeln!(svg, r#"  <circle cx="{:.1}" cy="{:.1}" r="{:.2}" fill="{}" stroke="{}" stroke-width="{:.2}"><title>{}</title></circle>"#, p.x, p.y, 2.2 * k, th.sym_paper_hex, th.ink_hex, 1.0 * k, xml_escape(&p.name));
            }
        }
    }
    let _ = writeln!(svg, "</g>");

    // 10c. Месторождения ресурсов
    let _ = writeln!(svg, r#"<g id="layer-deposits" clip-path="url(#fmsFrameClip)">"#);
    for d in deposits {
        let col = match d.kind {
            "iron" => "#7b8a98",
            "copper" => "#d69c38",
            "gems" => "#3db59b",
            "coal" => "#35312e",
            "oil" => "#8c4e1c",
            "salt" => "#f2ede2",
            _ => "#c4964b",
        };
        let _ = writeln!(svg, r#"  <circle cx="{:.1}" cy="{:.1}" r="{:.2}" fill="{col}" stroke="{}" stroke-width="{:.2}"><title>{} ({:.0}%)</title></circle>"#, d.x, d.y, 3.6 * k, th.ink_hex, 1.0 * k, xml_escape(d.label), d.richness * 100.0);
    }
    let _ = writeln!(svg, "</g>");

    // 11. Названия (державы по дуге + океаны/моря + поселения в Georgia serif без свитков)
    let _ = writeln!(svg, r#"<g id="layer-labels" font-family="Georgia, 'Times New Roman', serif" stroke-linejoin="round" paint-order="stroke fill">"#);
    let halo_col = if th.is_color { "rgba(248,244,232,0.82)" } else { "rgba(221,213,199,0.78)" };
    let halo_ink_col = match style {
        Style::Sepia => "rgba(221,213,199,0.82)",
        Style::Ink => "rgba(247,247,245,0.86)",
        Style::Color => "rgba(245,240,228,0.82)",
    };

    for (ai, ra) in r_arcs.iter().enumerate() {
        let n = ra.text.chars().count().max(1) as f64;
        let target = ra.length_px * 0.84;
        let f = clamp((ra.thick_px * 0.25).min(target / (n * 1.08)), 10.5 * k, 32.0 * k);
        let spacing = clamp((target - n * f * 0.62) / (n - 1.0).max(1.0), f * 0.12, f * 0.48);
        let _ = writeln!(
            svg,
            r##"  <text font-size="{f:.1}" letter-spacing="{spacing:.1}" fill="{}" stroke="{halo_col}" stroke-width="{:.1}"><textPath href="#realmArc{ai}" startOffset="50%" text-anchor="middle">{}</textPath></text>"##,
            th.ink_hex, f * 0.28, xml_escape(&ra.text)
        );
        // Резервируем полосу вдоль всей дуги названия державы, чтобы города не налезали на края надписи
        let plen = ra.pts.len();
        let i0 = plen / 10;
        let i1 = (plen - i0).max(i0 + 1);
        let step_p = ((i1 - i0) / 8).max(1);
        for idx in (i0..i1).step_by(step_p) {
            let p = ra.pts[idx];
            occupied.push(Rect {
                x: p[0] - f * 0.85,
                y: p[1] - f * 0.72,
                w: f * 1.70,
                h: f * 1.44,
            });
        }
    }

    for (si, sl) in sea_labels.iter().enumerate() {
        let f = (if is_world { 20.0 } else { 18.0 }) * k;
        let sp = f * 0.22;
        let _ = writeln!(
            svg,
            r##"  <text font-style="italic" font-size="{f:.1}" letter-spacing="{sp:.1}" fill="{}" stroke="{}" stroke-width="{:.1}"><textPath href="#seaArc{si}" startOffset="50%" text-anchor="middle">{}</textPath></text>"##,
            th.sea_name_hex,
            if th.is_color { "rgba(255,255,255,0.28)" } else { halo_ink_col },
            f * 0.2,
            xml_escape(&sl.text)
        );
    }

    let fr_box = Rect { x: fx + 4.0 * k, y: fy + 4.0 * k, w: fw - 8.0 * k, h: fh - 8.0 * k };
    for st in &ordered_st {
        if st.x < fx + 6.0 || st.x > fx + fw - 6.0 || st.y < fy + 6.0 || st.y > fy + fh - 6.0 {
            continue;
        }
        let fs = match st.kind {
            "capital" => 12.5,
            "metropolis" => 11.8,
            "city" => 11.0,
            "port" | "town" => 10.0,
            "village" => 8.8,
            _ => 9.2,
        } * k;
        let txt = if st.kind == "capital" { st.name.to_uppercase() } else { st.name.clone() };
        let off = 7.5 * k;
        let cands = [
            (st.x + off, st.y - fs * 0.1, 0u8, "start"),
            (st.x - off, st.y - fs * 0.1, 1u8, "end"),
            (st.x, st.y + off + fs * 0.55, 2u8, "middle"),
            (st.x, st.y - off - fs * 0.55, 2u8, "middle"),
        ];
        let mut chosen = None;
        for &(cx, cy, al, anchor) in &cands {
            let b = text_box(&txt, cx, cy, fs, al, 2.5 * k);
            if fr_box.contains_rect(&b) && !occupied.iter().any(|r| r.intersects(&b)) {
                chosen = Some((cx, cy, anchor, b));
                break;
            }
        }
        if chosen.is_none() && st.kind != "capital" {
            continue;
        }
        let (cx, cy, anchor, b) = chosen.unwrap_or_else(|| {
            let (cx, cy, al, anchor) = cands[0];
            (cx, cy, anchor, text_box(&txt, cx, cy, fs, al, 2.5 * k))
        });
        occupied.push(b);
        let bold = if matches!(st.kind, "capital" | "metropolis") { r#" font-weight="700""# } else { "" };
        let ital = if st.kind == "mine" { r#" font-style="italic""# } else { "" };
        let _ = writeln!(
            svg,
            r#"  <text x="{cx:.1}" y="{:.1}" text-anchor="{anchor}" font-size="{fs:.1}"{bold}{ital} fill="{}" stroke="{halo_ink_col}" stroke-width="{:.2}">{}</text>"#,
            cy + fs * 0.33, th.ink_hex, fs * 0.30, xml_escape(&txt)
        );
    }

    for ws in wild_sites {
        if ws.x < fx + 8.0 || ws.x > fx + fw - 8.0 || ws.y < fy + 8.0 || ws.y > fy + fh - 8.0 {
            continue;
        }
        let fs = 8.4 * k;
        let off = 6.0 * k;
        let cands = [
            (ws.x + off, ws.y - fs * 0.1, 0u8, "start"),
            (ws.x - off, ws.y - fs * 0.1, 1u8, "end"),
            (ws.x, ws.y + off + fs * 0.5, 2u8, "middle"),
        ];
        for &(cx, cy, al, anchor) in &cands {
            let b = text_box(&ws.name, cx, cy, fs, al, 2.5 * k);
            if fr_box.contains_rect(&b) && !occupied.iter().any(|r| r.intersects(&b)) {
                occupied.push(b);
                let _ = writeln!(
                    svg,
                    r#"  <text x="{cx:.1}" y="{:.1}" text-anchor="{anchor}" font-size="{fs:.1}" font-style="italic" opacity="0.78" fill="{}" stroke="{halo_ink_col}" stroke-width="{:.2}">{}</text>"#,
                    cy + fs * 0.33, th.ink_hex, fs * 0.28, xml_escape(&ws.name)
                );
                break;
            }
        }
    }

    for lb in labels.iter().filter(|l| matches!(l.kind, "continent" | "range" | "river" | "water")) {
        if lb.x < fx + 12.0 || lb.x > fx + fw - 12.0 || lb.y < fy + 12.0 || lb.y > fy + fh - 12.0 {
            continue;
        }
        let fs = match lb.kind {
            "continent" => 15.0 * k,
            _ => 11.0 * k,
        };
        let b = text_box(&lb.text, lb.x, lb.y, fs, 2, 4.0 * k);
        if !fr_box.contains_rect(&b) || occupied.iter().any(|r| r.intersects(&b)) {
            continue;
        }
        occupied.push(b);
        let fill = if lb.kind == "water" || lb.kind == "river" { th.sea_name_hex } else { th.ink_hex };
        let extra = if lb.kind == "continent" {
            r#" font-weight="700" letter-spacing="3""#
        } else {
            r#" font-style="italic""#
        };
        let _ = writeln!(
            svg,
            r#"  <text x="{:.1}" y="{:.1}" text-anchor="middle" font-size="{fs:.1}"{extra} fill="{fill}" stroke="{halo_ink_col}" stroke-width="{:.2}">{}</text>"#,
            lb.x, lb.y, fs * 0.28, xml_escape(&lb.text)
        );
    }
    let _ = writeln!(svg, "</g>");

    // 12. Двойная рамка (0.89.0: 3.2px внешняя + 1.0px внутренняя со сдвигом 8px; в Ч/Б отсутствует)
    let _ = writeln!(svg, r#"<g id="layer-frame">"#);
    if th.frame {
        let ins = 8.0 * k;
        let _ = writeln!(
            svg,
            r#"  <rect x="{fx:.1}" y="{fy:.1}" width="{fw:.1}" height="{fh:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#,
            th.ink_hex, 3.2 * k,
            fx + ins, fy + ins, (fw - ins * 2.0).max(4.0), (fh - ins * 2.0).max(4.0), th.ink_hex, 1.0 * k
        );
        let mut fc = MiniCanvas { w, clip: [0, 0, w, h], rgb: &mut flat };
        let r0 = [[fx, fy], [fx + fw, fy], [fx + fw, fy + fh], [fx, fy + fh]];
        let r1 = [[fx + ins, fy + ins], [fx + fw - ins, fy + ins], [fx + fw - ins, fy + fh - ins], [fx + ins, fy + fh - ins]];
        fc.stroke_poly(&r0, true, th.ink, 3.2 * k, 1.0);
        fc.stroke_poly(&r1, true, th.ink, 1.0 * k, 1.0);
    }
    let _ = writeln!(svg, "</g>");

    // 13. Карточка легенды (точно в стиле 0.89.0)
    {
        let card = legend_rect;
        let pad = 12.0 * k;
        let row_h = 20.0 * k;
        let fs = 12.5 * k;
        let leg_bg = format!("rgba({},{},{},0.92)", th.paper[0] as u8, th.paper[1] as u8, th.paper[2] as u8);
        let _ = writeln!(
            svg,
            r#"<g id="layer-legend" font-family="Georgia, serif">
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{leg_bg}" stroke="{}" stroke-width="{:.2}"/>"#,
            card[0], card[1], card[2], card[3], th.ink_hex, 1.5 * k
        );
        let mut cy = card[1] + pad + row_h * 0.5;
        let x0 = card[0] + pad;
        let xt = x0 + 34.0 * k;

        if !legend_realms.is_empty() {
            let _ = writeln!(svg, r#"  <text x="{x0:.1}" y="{cy:.1}" font-weight="700" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Государства</text>"#, th.ink_hex);
            cy += row_h;
            for (idx, (rname, rrgb)) in legend_realms.iter().enumerate() {
                let col = if !th.is_color && !th.hatch {
                    let g = 115 + (idx * 24) % 108;
                    format!("rgb({g},{g},{g})")
                } else {
                    format!("rgb({:.0},{:.0},{:.0})", rrgb[0], rrgb[1], rrgb[2])
                };
                let _ = writeln!(
                    svg,
                    r#"  <rect x="{x0:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{col}" fill-opacity="0.78" stroke="{}" stroke-width="{:.2}"/>
  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">{}</text>"#,
                    cy - 6.0 * k, 24.0 * k, 12.0 * k, th.ink_hex, 0.8 * k, th.ink_hex, xml_escape(rname)
                );
                cy += row_h;
            }
        }
        if !settlements.is_empty() {
            let _ = writeln!(svg, r#"  <text x="{x0:.1}" y="{cy:.1}" font-weight="700" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Поселения</text>"#, th.ink_hex);
            cy += row_h;
            for (lbl, kind) in [("Столица", 0), ("Город", 1), ("Порт", 2)] {
                let ix = x0 + 12.0 * k;
                match kind {
                    0 => { let _ = writeln!(svg, r#"  <polygon points="{ix:.1},{:.1} {:.1},{cy:.1} {ix:.1},{:.1} {:.1},{cy:.1}" fill="{}" stroke="{}" stroke-width="{:.2}"/>"#, cy - 5.0 * k, ix + 5.0 * k, cy + 5.0 * k, ix - 5.0 * k, th.sym_paper_hex, th.ink_hex, 1.4 * k); }
                    1 => { let _ = writeln!(svg, r#"  <polygon points="{ix:.1},{:.1} {:.1},{cy:.1} {ix:.1},{:.1} {:.1},{cy:.1}" fill="{}" stroke="{}" stroke-width="{:.2}"/>"#, cy - 4.2 * k, ix + 4.2 * k, cy + 4.2 * k, ix - 4.2 * k, th.ink_hex, th.ink_hex, 1.2 * k); }
                    _ => {
                        let _ = writeln!(
                            svg,
                            r#"  <g fill="none" stroke="{}" stroke-width="{:.2}"><circle cx="{ix:.1}" cy="{:.1}" r="{:.2}"/><path d="M{ix:.1},{:.1} L{ix:.1},{:.1} M{:.1},{:.1} L{:.1},{:.1} M{:.1},{:.1} Q{ix:.1},{:.1} {:.1},{:.1}"/></g>"#,
                            th.ink_hex, 1.2 * k, cy - 3.0 * k, 1.1 * k, cy - 1.9 * k, cy + 3.2 * k, ix - 2.2 * k, cy - 0.5 * k, ix + 2.2 * k, cy - 0.5 * k, ix - 3.0 * k, cy + 0.8 * k, cy + 5.2 * k, ix + 3.0 * k, cy + 0.8 * k
                        );
                    }
                }
                let _ = writeln!(svg, r#"  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">{lbl}</text>"#, th.ink_hex);
                cy += row_h;
            }
        }
        let _ = writeln!(svg, r#"  <text x="{x0:.1}" y="{cy:.1}" font-weight="700" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Обозначения</text>"#, th.ink_hex);
        cy += row_h;
        if !legend_realms.is_empty() {
            let _ = writeln!(svg, r#"  <line x1="{x0:.1}" y1="{cy:.1}" x2="{:.1}" y2="{cy:.1}" stroke="{}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1} {:.1} {:.1}"/>
  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Граница государства</text>"#, x0 + 26.0 * k, th.ink_hex, 2.0 * k, 8.0 * k, 3.0 * k, 2.0 * k, 3.0 * k, th.ink_hex);
            cy += row_h;
        }
        if !roads.roads.is_empty() || !roads.highways.is_empty() || !roads.trails.is_empty() || !roads.wild_trails.is_empty() {
            let _ = writeln!(svg, r#"  <line x1="{x0:.1}" y1="{cy:.1}" x2="{:.1}" y2="{cy:.1}" stroke="{}" stroke-width="{:.2}"/>
  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Дорога</text>"#, x0 + 26.0 * k, th.ink_hex, 1.8 * k, th.ink_hex);
            cy += row_h;
        }
        let _ = writeln!(svg, r#"  <line x1="{x0:.1}" y1="{cy:.1}" x2="{:.1}" y2="{cy:.1}" stroke="{}" stroke-width="{:.2}"/>
  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Река</text>"#, x0 + 26.0 * k, th.river_hex, 1.5 * k, th.ink_hex);
        cy += row_h;
        if !roads.sea_routes.is_empty() {
            let _ = writeln!(svg, r#"  <line x1="{x0:.1}" y1="{cy:.1}" x2="{:.1}" y2="{cy:.1}" stroke="{}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1}"/>
  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Морской путь</text>"#, x0 + 26.0 * k, th.sea_route_hex, 2.0 * k, 2.0 * k, 5.0 * k, th.ink_hex);
            cy += row_h;
        }
        let ice_leg_col = match style {
            Style::Sepia => "#e2dbce",
            Style::Ink => "#f7f7f5",
            Style::Color => "rgb(228,239,246)",
        };
        let _ = writeln!(svg, r#"  <rect x="{x0:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{ice_leg_col}" stroke="{}" stroke-width="{:.2}"/>
  <text x="{xt:.1}" y="{cy:.1}" font-size="{fs:.1}" dominant-baseline="middle" fill="{}">Полярный лёд</text>"#, cy - 6.0 * k, 24.0 * k, 12.0 * k, th.ink_hex, 0.8 * k, th.ink_hex);
        let _ = writeln!(svg, "</g>");
    }

    (flat, svg)
}

fn to_currents_sampled(planet: &Planet, grid: &ClassicGrid, is_world: bool, proj_inv: impl Fn(f64, f64) -> Option<(f64, f64)>) -> Vec<Vec<[f64; 3]>> {
    let gw = planet.grid.w;
    let gh = planet.grid.h;
    let mut sg = SampledGrid {
        w: grid.gw,
        h: grid.gh,
        is_world,
        ui_scale: grid.scale_k,
        frame: grid.frame,
        inside: vec![1u8; grid.gw * grid.gh],
        elev: grid.h.clone(),
        is_land: grid.ocean.iter().map(|&o| if o == 0 { 1 } else { 0 }).collect(),
        is_lake: grid.lake.clone(),
        is_salt_flat: vec![0u8; grid.gw * grid.gh],
        polar_ice: grid.polar_ice.clone(),
        glacier: vec![0.0; grid.gw * grid.gh],
        aridity: vec![0.5; grid.gw * grid.gh],
        forest_cov: vec![0.0; grid.gw * grid.gh],
        wetland_cov: vec![0.0; grid.gw * grid.gh],
        ink_bio: vec![[0.0; 3]; grid.gw * grid.gh],
        cloud_mottle: vec![0.0; grid.gw * grid.gh],
        realm_id: grid.realm_id.clone(),
        coast_dist: grid.dist.clone(),
        land_coast_dist: vec![0.0; grid.gw * grid.gh],
        border_dist: vec![0.0; grid.gw * grid.gh],
    };
    sg.w = grid.canvas_w;
    sg.h = grid.canvas_h;
    sg.inside = vec![0u8; grid.canvas_w * grid.canvas_h];
    sg.is_land = vec![0u8; grid.canvas_w * grid.canvas_h];
    sg.polar_ice = vec![0u8; grid.canvas_w * grid.canvas_h];
    sg.coast_dist = vec![0.0f32; grid.canvas_w * grid.canvas_h];
    let [fx, fy, fw, fh] = grid.frame;
    for y in 0..grid.canvas_h {
        let yf = y as f64 + 0.5;
        if yf < fy || yf > fy + fh {
            continue;
        }
        let gy = (((yf - fy) / grid.sy).round() as usize).min(grid.gh - 1);
        for x in 0..grid.canvas_w {
            let xf = x as f64 + 0.5;
            if xf < fx || xf > fx + fw {
                continue;
            }
            let gx = (((xf - fx) / grid.sx).round() as usize).min(grid.gw - 1);
            let gi = gy * grid.gw + gx;
            let ci = y * grid.canvas_w + x;
            sg.inside[ci] = 1;
            sg.is_land[ci] = if grid.ocean[gi] == 0 { 1 } else { 0 };
            sg.polar_ice[ci] = grid.polar_ice[gi];
            sg.coast_dist[ci] = grid.dist[gi] * grid.sx as f32;
        }
    }
    let _ = (gw, gh);
    trace_ocean_currents(planet, &sg, proj_inv)
}

fn collect_classic_world_labels(planet: &Planet, proj: &WorldProj, grid: &ClassicGrid, hubs: &[[f64; 2]]) -> Vec<MapLabel> {
    // Как в эталоне 0.89.0: на общей карте мира не перегружаем сушу капсовыми названиями материков и мелких хребтов —
    // подписываем только океаны и моря курсивом по дуге (государства и города добавляются слоем цивилизации).
    let _ = (proj, grid, LandmassKind::Continent);
    let mut out = Vec::new();
    let mut rng_o = Rng::sub(&planet.seed, "classic-oceans");
    let mut used = HashSet::new();
    for (oc, &[hx, hy]) in hubs.iter().take(3).enumerate() {
        let stem = fms_core::toponymy::generate_proper_name((oc * 3 + 1) as u8, &mut rng_o, 2, 3, &mut used);
        let title = if oc == 0 { format!("Океан {stem}") } else { format!("Море {stem}") };
        out.push(MapLabel { text: title, kind: "ocean", x: hx, y: hy, prio: 950.0 });
    }
    let _ = generate_world_ocean_labels;
    out
}

pub(crate) fn render_classic_world(planet: &Planet, seed: &str, opt: &RenderOptions) -> RenderOutput {
    let proj = WorldProj::fit(planet, opt.target_width.clamp(320, 4096));
    let grid = ClassicGrid::sample_world(planet, &proj);
    let noise = Noise2::new(&format!("{seed}|wobble"));
    let th = theme_of(opt.style);

    let (coast_filled, coast_strokes, halo_sets) = coast_contours(&grid, &noise);
    let land_mask = rasterize_land_mask(grid.canvas_w, grid.canvas_h, &coast_filled);
    let base_rgb = paint_base_raster(&grid, &th, &land_mask, &noise, seed);

    let rivers = trace_river_polylines(planet, &proj, &grid, &noise);
    let wadis = collect_world_wadis(planet, &proj);
    let roads = build_world_roads(planet, &proj, &grid, &noise);
    let settlements: Vec<SettlementPin> = planet
        .civilization
        .settlements
        .iter()
        .map(|s| {
            let (sx, sy) = planet.grid.xy(s.cell);
            let lat = planet.grid.lat_deg(sy);
            let lon = planet.grid.lon_deg(sx);
            let pr = proj.project(lat, lon);
            SettlementPin {
                id: Some(s.id),
                name: s.name.clone(),
                subtitle: settlement_subtitle_label(s.role, s.tier),
                lat,
                lon,
                x: pr[0],
                y: pr[1],
                kind: settlement_kind(s.role, s.tier),
                score: s.population_score as f64,
            }
        })
        .collect();
    let wild_sites: Vec<WildSitePin> = planet
        .civilization
        .wild_sites
        .iter()
        .map(|ws| {
            let (wx, wy) = planet.grid.xy(ws.cell);
            let lat = planet.grid.lat_deg(wy);
            let lon = planet.grid.lon_deg(wx);
            let pr = proj.project(lat, lon);
            WildSitePin {
                id: format!("wild_{}", ws.id),
                name: ws.name.clone(),
                kind: match ws.kind {
                    WildSiteKind::HunterCamp => "camp",
                    WildSiteKind::Ruins => "ruins",
                },
                x: pr[0],
                y: pr[1],
                lat,
                lon,
            }
        })
        .collect();
    let deposits: Vec<DepositPin> = planet
        .resources
        .deposits
        .iter()
        .map(|d| {
            let (dx, dy) = planet.grid.xy(d.cell);
            let pr = proj.project(planet.grid.lat_deg(dy), planet.grid.lon_deg(dx));
            let (kind, label) = deposit_meta(d.kind);
            DepositPin { x: pr[0], y: pr[1], kind, label, richness: d.richness }
        })
        .collect();
    let waterfalls: Vec<WaterfallPin> = planet
        .hydrology
        .waterfalls
        .iter()
        .map(|wf| {
            let (wx, wy) = planet.grid.xy(wf.cell);
            let pr = proj.project(planet.grid.lat_deg(wy), planet.grid.lon_deg(wx));
            WaterfallPin { x: pr[0], y: pr[1], drop_m: wf.drop_m, discharge_m3s: wf.discharge_m3s }
        })
        .collect();
    let pois = collect_classic_pois_world(planet, &proj, &grid);

    let mut hub_sg = SampledGrid {
        w: grid.gw,
        h: grid.gh,
        is_world: true,
        ui_scale: grid.scale_k,
        frame: grid.frame,
        inside: vec![1u8; grid.gw * grid.gh],
        elev: grid.h.clone(),
        is_land: grid.ocean.iter().map(|&o| if o == 0 { 1 } else { 0 }).collect(),
        is_lake: grid.lake.clone(),
        is_salt_flat: vec![0u8; grid.gw * grid.gh],
        polar_ice: grid.polar_ice.clone(),
        glacier: vec![0.0; grid.gw * grid.gh],
        aridity: vec![0.5; grid.gw * grid.gh],
        forest_cov: vec![0.0; grid.gw * grid.gh],
        wetland_cov: vec![0.0; grid.gw * grid.gh],
        ink_bio: vec![[0.0; 3]; grid.gw * grid.gh],
        cloud_mottle: vec![0.0; grid.gw * grid.gh],
        realm_id: grid.realm_id.clone(),
        coast_dist: grid.dist.clone(),
        land_coast_dist: vec![0.0; grid.gw * grid.gh],
        border_dist: vec![0.0; grid.gw * grid.gh],
    };
    let hubs_g = pick_ocean_hub(&hub_sg, true);
    let hubs: Vec<[f64; 2]> = hubs_g.into_iter().map(|[x, y]| [grid.px(x), grid.py(y)]).collect();
    let _ = &mut hub_sg;

    let labels = collect_classic_world_labels(planet, &proj, &grid, &hubs);
    let currents = to_currents_sampled(planet, &grid, true, |px, py| proj.inverse(px, py));
    let legend_realms: Vec<(String, [f64; 3])> = planet
        .civilization
        .realms
        .iter()
        .take(8)
        .map(|r| (r.name.clone(), state_rgb(r.id as usize)))
        .collect();
    let has_roads = !roads.roads.is_empty() || !roads.highways.is_empty() || !roads.trails.is_empty() || !roads.wild_trails.is_empty();
    let has_sea = !roads.sea_routes.is_empty();
    let legend_rect = classic_legend_rect(&grid, true, legend_realms.len(), settlements.len(), has_roads, has_sea);

    let (flat_rgb, classic_svg_layers) = compose_scene(
        opt.style,
        true,
        seed,
        &grid,
        &base_rgb,
        &land_mask,
        &coast_filled,
        &coast_strokes,
        &halo_sets,
        &rivers,
        &wadis,
        &roads,
        &settlements,
        &wild_sites,
        &deposits,
        &pois,
        &labels,
        &currents,
        &legend_realms,
        legend_rect,
        planet,
        &noise,
    );

    let mut graticule = Vec::new();
    let lon_start = wrap_lon_deg(proj.center_lon_deg - 180.0 + 0.01);
    for lat_i in [-60.0f64, -30.0, 0.0, 30.0, 60.0] {
        graticule.push((0..=72).map(|s| proj.project(lat_i, wrap_lon_deg(lon_start + s as f64 / 72.0 * 359.98))).collect());
    }
    let overlay = OverlayModel {
        width: grid.canvas_w,
        height: grid.canvas_h,
        is_world: true,
        style: opt.style,
        title: opt.title.clone().unwrap_or_else(|| opt.style.title().to_string()),
        frame: grid.frame,
        subtitle: String::new(),
        graticule,
        routes: roads.sea_routes,
        settlements,
        wild_sites,
        deposits,
        waterfalls,
        pois,
        labels,
        currents,
        legend_realms: legend_realms.into_iter().map(|(n, c)| (n, [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0])).collect(),
        legend_rect,
        seam_lon_deg: proj.seam_lon_deg,
        center_lon_deg: proj.center_lon_deg,
        classic_svg_layers,
    };
    RenderOutput {
        width: grid.canvas_w,
        height: grid.canvas_h,
        style: opt.style,
        base_rgb,
        flat_rgb,
        overlay,
    }
}

pub(crate) fn render_classic_region(
    planet: &Planet,
    reg: &Region,
    reg_opt: &RegionOptions,
    seed: &str,
    opt: &RenderOptions,
) -> RenderOutput {
    let proj = RegionProj::new(reg, reg_opt, opt.target_width.clamp(320, 4096));
    let grid = ClassicGrid::sample_region(planet, reg, &proj);
    let noise = Noise2::new(&format!("{seed}|wobble"));
    let th = theme_of(opt.style);

    let (coast_filled, coast_strokes, halo_sets) = coast_contours(&grid, &noise);
    let land_mask = rasterize_land_mask(grid.canvas_w, grid.canvas_h, &coast_filled);
    let base_rgb = paint_base_raster(&grid, &th, &land_mask, &noise, seed);

    let (rivers, _) = trace_region_rivers(reg, &proj, &grid, &noise);
    let wadis = collect_region_wadis(reg, &proj);
    let roads = build_region_roads(planet, reg, &proj, &grid, &noise);
    let settlements: Vec<SettlementPin> = reg
        .settlements
        .iter()
        .map(|s| {
            let pr = proj.project_cell(s.x as f64 + 0.5, s.y as f64 + 0.5);
            let gs = s
                .global_id
                .and_then(|gid| planet.civilization.settlements.get(gid as usize));
            let score = gs.map(|g| g.population_score as f64).unwrap_or(40.0);
            let (lat, lon) = proj.inverse(pr[0], pr[1]).unwrap_or((reg.center_lat_deg, reg.center_lon_deg));
            SettlementPin {
                id: s.global_id,
                name: s.name.clone(),
                subtitle: settlement_subtitle_label(s.role, s.tier),
                lat,
                lon,
                x: pr[0],
                y: pr[1],
                kind: settlement_kind(s.role, s.tier),
                score,
            }
        })
        .collect();
    let wild_sites: Vec<WildSitePin> = planet
        .civilization
        .wild_sites
        .iter()
        .filter_map(|ws| {
            let (wx, wy) = planet.grid.xy(ws.cell);
            let lat = planet.grid.lat_deg(wy);
            let lon = planet.grid.lon_deg(wx);
            proj.project_lat_lon(lat, lon).map(|pr| WildSitePin {
                id: format!("wild_{}", ws.id),
                name: ws.name.clone(),
                kind: match ws.kind {
                    WildSiteKind::HunterCamp => "camp",
                    WildSiteKind::Ruins => "ruins",
                },
                x: pr[0],
                y: pr[1],
                lat,
                lon,
            })
        })
        .collect();
    let deposits: Vec<DepositPin> = reg
        .deposits
        .iter()
        .map(|d| {
            let pr = proj.project_cell(d.x as f64 + 0.5, d.y as f64 + 0.5);
            let (kind, label) = deposit_meta(d.kind);
            DepositPin { x: pr[0], y: pr[1], kind, label, richness: d.richness }
        })
        .collect();
    let waterfalls: Vec<WaterfallPin> = reg
        .waterfalls
        .iter()
        .map(|wf| {
            let (wx, wy) = reg.xy(wf.cell);
            let pr = proj.project_cell(wx as f64 + 0.5, wy as f64 + 0.5);
            WaterfallPin { x: pr[0], y: pr[1], drop_m: wf.drop_m, discharge_m3s: wf.discharge_m3s }
        })
        .collect();
    let pois = collect_classic_pois_region(planet, reg, &proj, &grid);

    let mut labels = Vec::new();
    for (idx, rg) in planet.geography.mountain_ranges.iter().enumerate() {
        let (rx, ry) = planet.grid.xy(rg.peak_cell);
        if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(ry), planet.grid.lon_deg(rx)) {
            labels.push(MapLabel {
                text: planet.names.mountain_ranges[idx].clone(),
                kind: "range",
                x: pr[0],
                y: pr[1] - 12.0 * grid.scale_k,
                prio: 550.0,
            });
        }
    }
    let currents = to_currents_sampled(planet, &grid, false, |px, py| proj.inverse(px, py));
    let mut seen_r = BTreeMap::new();
    for &rid in &grid.realm_id {
        if rid >= 0 {
            *seen_r.entry(rid as usize).or_insert(0usize) += 1;
        }
    }
    let legend_realms: Vec<(String, [f64; 3])> = seen_r
        .into_iter()
        .filter(|&(rid, cnt)| cnt > 25 && rid < planet.civilization.realms.len())
        .take(5)
        .map(|(rid, _)| (planet.civilization.realms[rid].name.clone(), state_rgb(rid)))
        .collect();
    let has_roads = !roads.roads.is_empty() || !roads.highways.is_empty() || !roads.trails.is_empty() || !roads.wild_trails.is_empty();
    let has_sea = !roads.sea_routes.is_empty();
    let legend_rect = classic_legend_rect(&grid, false, legend_realms.len(), settlements.len(), has_roads, has_sea);

    let (flat_rgb, classic_svg_layers) = compose_scene(
        opt.style,
        false,
        seed,
        &grid,
        &base_rgb,
        &land_mask,
        &coast_filled,
        &coast_strokes,
        &halo_sets,
        &rivers,
        &wadis,
        &roads,
        &settlements,
        &wild_sites,
        &deposits,
        &pois,
        &labels,
        &currents,
        &legend_realms,
        legend_rect,
        planet,
        &noise,
    );

    let _ = choose_region_window;
    let overlay = OverlayModel {
        width: grid.canvas_w,
        height: grid.canvas_h,
        is_world: false,
        style: opt.style,
        title: opt.title.clone().unwrap_or_else(|| opt.style.title().to_string()),
        frame: grid.frame,
        subtitle: String::new(),
        graticule: Vec::new(),
        routes: roads.sea_routes,
        settlements,
        wild_sites,
        deposits,
        waterfalls,
        pois,
        labels,
        currents,
        legend_realms: legend_realms.into_iter().map(|(n, c)| (n, [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0])).collect(),
        legend_rect,
        seam_lon_deg: 0.0,
        center_lon_deg: reg.center_lon_deg,
        classic_svg_layers,
    };
    RenderOutput {
        width: grid.canvas_w,
        height: grid.canvas_h,
        style: opt.style,
        base_rgb,
        flat_rgb,
        overlay,
    }
}

use fms_core::region::RegionOptions;

fn collect_world_wadis(planet: &Planet, proj: &WorldProj) -> Vec<Vec<[f64; 2]>> {
    let n = planet.grid.len();
    let mut in_w = vec![0u8; n];
    for c in 0..n {
        if planet.hydrology.is_wadi[c] == 0 { continue; }
        let r = planet.hydrology.receiver[c];
        if r >= 0 && planet.hydrology.is_wadi[r as usize] != 0 { in_w[r as usize] = 1; }
    }
    let mut out = Vec::new();
    let mut vis = vec![0u8; n];
    for s in 0..n {
        if planet.hydrology.is_wadi[s] == 0 || in_w[s] != 0 { continue; }
        let mut ch = Vec::new();
        let mut prev_dl: Option<f64> = None;
        let mut cur = s;
        for _ in 0..48 {
            let (cx, cy) = planet.grid.xy(cur);
            let lon = planet.grid.lon_deg(cx);
            let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
            if let Some(pd) = prev_dl {
                if (dlon - pd).abs() > 120.0 {
                    if ch.len() >= 2 { out.push(std::mem::take(&mut ch)); } else { ch.clear(); }
                }
            }
            ch.push(proj.project(planet.grid.lat_deg(cy), lon));
            prev_dl = Some(dlon);
            if vis[cur] != 0 { break; }
            vis[cur] = 1;
            let r = planet.hydrology.receiver[cur];
            if r < 0 || planet.hydrology.is_ocean[r as usize] != 0 { break; }
            cur = r as usize;
            if planet.hydrology.is_wadi[cur] == 0 {
                let (rx, ry) = planet.grid.xy(cur);
                ch.push(proj.project(planet.grid.lat_deg(ry), planet.grid.lon_deg(rx)));
                break;
            }
        }
        if ch.len() >= 2 { out.push(ch); }
    }
    out
}

fn collect_region_wadis(reg: &Region, proj: &RegionProj) -> Vec<Vec<[f64; 2]>> {
    let n = reg.w * reg.h;
    let mut in_w = vec![0u8; n];
    for c in 0..n {
        if reg.is_wadi[c] == 0 { continue; }
        let r = reg.receiver[c];
        if r >= 0 && reg.is_wadi[r as usize] != 0 { in_w[r as usize] = 1; }
    }
    let mut out = Vec::new();
    let mut vis = vec![0u8; n];
    for s in 0..n {
        if reg.is_wadi[s] == 0 || in_w[s] != 0 { continue; }
        let mut ch = Vec::new();
        let mut cur = s;
        for _ in 0..96 {
            let (cx, cy) = reg.xy(cur);
            ch.push(proj.project_cell(cx as f64 + 0.5, cy as f64 + 0.5));
            if vis[cur] != 0 { break; }
            vis[cur] = 1;
            let r = reg.receiver[cur];
            if r < 0 || reg.is_ocean[r as usize] != 0 { break; }
            cur = r as usize;
            if reg.is_wadi[cur] == 0 {
                let (rx, ry) = reg.xy(cur);
                ch.push(proj.project_cell(rx as f64 + 0.5, ry as f64 + 0.5));
                break;
            }
        }
        if ch.len() >= 2 { out.push(ch); }
    }
    out
}

pub(crate) fn render_classic_svg(
    base_rgb: &[u8],
    ov: &OverlayModel,
    embed_png_inline: bool,
    image_href: Option<&str>,
) -> String {
    let w = ov.width;
    let h = ov.height;
    let mut s = String::with_capacity(ov.classic_svg_layers.len() + 4096);
    let _ = writeln!(
        s,
        r#"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {w} {h}" width="{w}" height="{h}">"#
    );
    if embed_png_inline {
        let png = crate::png::encode_png_rgb(w, h, base_rgb);
        let b64 = base64_encode(&png);
        let _ = writeln!(
            s,
            r#"<image id="layer-base" x="0" y="0" width="{w}" height="{h}" href="data:image/png;base64,{b64}"/>"#
        );
    } else if let Some(href) = image_href {
        let _ = writeln!(
            s,
            r#"<image id="layer-base" x="0" y="0" width="{w}" height="{h}" href="{}"/>"#,
            xml_escape(href)
        );
    }
    s.push_str(&ov.classic_svg_layers);
    s.push_str("</svg>\n");
    s
}

#[allow(dead_code)]
fn _unused_silencer() {
    let _ = (PI, TAU);
}
