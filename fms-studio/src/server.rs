//! Многопоточный HTTP-сервер картографической студии (`std::net`) без внешних зависимостей.

use fms_core::biomes::Bedrock;
use fms_core::civilization::{route_land_road, SettlementRole};
use fms_core::geography::{LandmassKind, MarineZone};
use fms_core::planet::{self, Planet, PlanetOptions};
use fms_core::region::{self, route_region_road, Region, RegionOptions};
use fms_render::{
    choose_region_window, render_region_with_options, render_world_with_options, AssetPack,
    RegionProj, RenderOptions, RenderOutput, Style, WorldProj,
};
use std::collections::{HashMap, VecDeque};
use std::fmt::Write as _;
use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::{Arc, Mutex};

const INDEX_HTML: &str = include_str!("../web/index.html");

#[derive(Clone, Debug)]
pub struct StudioConfig {
    pub host: String,
    pub port: u16,
}

#[derive(Clone, Debug)]
pub struct StudioResponse {
    pub status: u16,
    pub content_type: &'static str,
    pub disposition: Option<String>,
    pub body: Vec<u8>,
}

impl StudioResponse {
    fn json(body: String) -> Self {
        Self {
            status: 200,
            content_type: "application/json; charset=utf-8",
            disposition: None,
            body: body.into_bytes(),
        }
    }

    fn err(status: u16, msg: &str) -> Self {
        let mut s = String::from("{\"error\":");
        push_json_str(&mut s, msg);
        s.push('}');
        Self {
            status,
            content_type: "application/json; charset=utf-8",
            disposition: None,
            body: s.into_bytes(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct WorldKey {
    seed: String,
    w: usize,
    continents: u8,
    activity_milli: i64,
    water_milli: i64,
    tilt_tenths: i64,
    solar_tenths: i64,
    rot_milli: i64,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct RenderKey {
    world: WorldKey,
    style: &'static str,
    target_w: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct RegionKey {
    world: WorldKey,
    lat_milli: i64,
    lon_milli: i64,
    span_tenths: i64,
    scale: usize,
    style: &'static str,
    target_w: usize,
}

struct CachedRender {
    width: usize,
    height: usize,
    rivers_count: usize,
    passes_count: usize,
    settlements_count: usize,
    center_lat_deg: f64,
    center_lon_deg: f64,
    lat_min_deg: f64,
    lat_max_deg: f64,
    lon_min_deg: f64,
    lon_max_deg: f64,
    base_png: Vec<u8>,
    full_png: Vec<u8>,
    overlay_svg: String,
    standalone_svg: String,
    reg_proj: Option<RegionProj>,
    region: Option<Arc<Region>>,
}

impl CachedRender {
    fn from_world(out: RenderOutput, planet: &Planet, pack: &AssetPack, png_href: &str) -> Self {
        let base_png = out.to_base_png_bytes();
        let full_png = out.to_png_bytes();
        let overlay_svg = out.to_svg_with_image_href(pack, png_href);
        let standalone_svg = out.to_svg_standalone(pack);
        Self {
            width: out.width,
            height: out.height,
            rivers_count: planet.hydrology.rivers.len(),
            passes_count: planet.geography.passes.len(),
            settlements_count: planet.civilization.settlements.len(),
            center_lat_deg: 0.0,
            center_lon_deg: out.overlay.center_lon_deg,
            lat_min_deg: -90.0,
            lat_max_deg: 90.0,
            lon_min_deg: -180.0,
            lon_max_deg: 180.0,
            base_png,
            full_png,
            overlay_svg,
            standalone_svg,
            reg_proj: None,
            region: None,
        }
    }

    fn from_region(
        out: RenderOutput,
        reg: Arc<Region>,
        reg_opt: &RegionOptions,
        pack: &AssetPack,
        png_href: &str,
    ) -> Self {
        let base_png = out.to_base_png_bytes();
        let full_png = out.to_png_bytes();
        let overlay_svg = out.to_svg_with_image_href(pack, png_href);
        let standalone_svg = out.to_svg_standalone(pack);
        let reg_proj = RegionProj::new(&reg, reg_opt, out.width);
        Self {
            width: out.width,
            height: out.height,
            rivers_count: reg.rivers.len(),
            passes_count: reg.passes.len(),
            settlements_count: reg.settlements.len(),
            center_lat_deg: reg.center_lat_deg,
            center_lon_deg: reg.center_lon_deg,
            lat_min_deg: reg.lat_min_deg,
            lat_max_deg: reg.lat_max_deg,
            lon_min_deg: reg.lon_min_deg,
            lon_max_deg: reg.lon_max_deg,
            base_png,
            full_png,
            overlay_svg,
            standalone_svg,
            reg_proj: Some(reg_proj),
            region: Some(reg),
        }
    }
}

struct StudioCache {
    planets: HashMap<WorldKey, Arc<Planet>>,
    planet_lru: VecDeque<WorldKey>,
    world_renders: HashMap<RenderKey, Arc<CachedRender>>,
    world_lru: VecDeque<RenderKey>,
    region_renders: HashMap<RegionKey, Arc<CachedRender>>,
    region_lru: VecDeque<RegionKey>,
}

impl StudioCache {
    fn new() -> Self {
        Self {
            planets: HashMap::new(),
            planet_lru: VecDeque::new(),
            world_renders: HashMap::new(),
            world_lru: VecDeque::new(),
            region_renders: HashMap::new(),
            region_lru: VecDeque::new(),
        }
    }

    fn insert_bounded<K: Eq + std::hash::Hash + Clone, V>(
        map: &mut HashMap<K, V>,
        lru: &mut VecDeque<K>,
        key: K,
        val: V,
        cap: usize,
    ) {
        if !map.contains_key(&key) {
            lru.push_back(key.clone());
            while lru.len() > cap {
                if let Some(old) = lru.pop_front() {
                    map.remove(&old);
                }
            }
        }
        map.insert(key, val);
    }
}

/// Состояние веб-студии с потокобезопасным кэшем планет и рендеров.
pub struct StudioApp {
    pack: AssetPack,
    cache: Mutex<StudioCache>,
}

impl StudioApp {
    pub fn new() -> Result<Self, String> {
        let pack = AssetPack::load_default()?;
        Ok(Self {
            pack,
            cache: Mutex::new(StudioCache::new()),
        })
    }

    fn parse_world_opts(q: &HashMap<String, String>) -> (WorldKey, PlanetOptions) {
        let seed = q
            .get("seed")
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .unwrap_or("e")
            .to_string();
        let w = q
            .get("w")
            .and_then(|s| s.parse::<usize>().ok())
            .map(|v| (v.clamp(90, 720) / 2) * 2)
            .unwrap_or(360);
        let continents = q
            .get("continents")
            .and_then(|s| s.parse::<u8>().ok())
            .map(|v| v.min(6))
            .unwrap_or(0);
        let activity = q
            .get("activity")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(1.0)
            .clamp(0.75, 1.35);
        let water_depth = q
            .get("water_depth")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(2.62)
            .clamp(2.20, 3.05);
        let tilt = q
            .get("tilt")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(23.4)
            .clamp(15.0, 30.0);
        let solar = q
            .get("solar")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(0.0)
            .clamp(-3.5, 3.5);
        let rot = q
            .get("rotation")
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(1.0)
            .clamp(0.70, 1.40);

        let mut opt = PlanetOptions::new(&seed);
        opt.tectonic.w = w;
        opt.tectonic.target_continents = continents;
        opt.tectonic.activity = activity;
        opt.tectonic.water_depth_km = water_depth;
        opt.climate.axial_tilt_deg = tilt;
        opt.climate.solar_offset_c = solar;
        opt.climate.rotation_rate = rot;

        let key = WorldKey {
            seed,
            w,
            continents,
            activity_milli: (activity * 1000.0).round() as i64,
            water_milli: (water_depth * 1000.0).round() as i64,
            tilt_tenths: (tilt * 10.0).round() as i64,
            solar_tenths: (solar * 10.0).round() as i64,
            rot_milli: (rot * 1000.0).round() as i64,
        };
        (key, opt)
    }

    fn parse_style(q: &HashMap<String, String>) -> Style {
        q.get("style")
            .and_then(|s| Style::from_slug(s))
            .unwrap_or(Style::Expedition)
    }

    fn world_query_string(k: &WorldKey, style: Style, target_w: usize) -> String {
        format!(
            "seed={}&w={}&continents={}&activity={:.3}&water_depth={:.3}&tilt={:.1}&solar={:.1}&rotation={:.3}&style={}&target_w={}",
            url_encode(&k.seed),
            k.w,
            k.continents,
            k.activity_milli as f64 / 1000.0,
            k.water_milli as f64 / 1000.0,
            k.tilt_tenths as f64 / 10.0,
            k.solar_tenths as f64 / 10.0,
            k.rot_milli as f64 / 1000.0,
            style.slug(),
            target_w
        )
    }

    fn get_or_build_planet(&self, key: &WorldKey, opt: &PlanetOptions) -> Result<Arc<Planet>, String> {
        {
            let guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
            if let Some(p) = guard.planets.get(key) {
                return Ok(Arc::clone(p));
            }
        }
        let planet = Arc::new(planet::generate_with_options(opt)?);
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.planets, &mut cache.planet_lru, key.clone(), Arc::clone(&planet), 3);
        Ok(planet)
    }

    fn get_or_render_world(
        &self,
        q: &HashMap<String, String>,
    ) -> Result<(WorldKey, Arc<Planet>, Arc<CachedRender>, String), String> {
        let (wkey, popt) = Self::parse_world_opts(q);
        let style = Self::parse_style(q);
        let target_w = q
            .get("target_w")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(2200)
            .clamp(600, 3200);
        let rkey = RenderKey {
            world: wkey.clone(),
            style: style.slug(),
            target_w,
        };
        let qs = Self::world_query_string(&wkey, style, target_w);
        let planet = self.get_or_build_planet(&wkey, &popt)?;
        {
            let guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
            if let Some(r) = guard.world_renders.get(&rkey) {
                return Ok((wkey, planet, Arc::clone(r), qs));
            }
        }
        let ropt = RenderOptions {
            style,
            target_width: target_w,
            title: None,
        };
        let out = render_world_with_options(&planet, &wkey.seed, &self.pack, &ropt);
        let png_href = format!("/api/world/map.png?{qs}");
        let cached = Arc::new(CachedRender::from_world(out, &planet, &self.pack, &png_href));
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.world_renders, &mut cache.world_lru, rkey, Arc::clone(&cached), 4);
        Ok((wkey, planet, cached, qs))
    }

    fn get_or_render_region(
        &self,
        q: &HashMap<String, String>,
    ) -> Result<(WorldKey, Arc<Planet>, Arc<CachedRender>, String), String> {
        let (wkey, popt) = Self::parse_world_opts(q);
        let style = Self::parse_style(q);
        let planet = self.get_or_build_planet(&wkey, &popt)?;
        let default_win = choose_region_window(&planet);
        let lat = q
            .get("lat")
            .or_else(|| q.get("reg_lat"))
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(default_win.center_lat_deg)
            .clamp(-82.0, 82.0);
        let lon = q
            .get("lon")
            .or_else(|| q.get("reg_lon"))
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(default_win.center_lon_deg);
        let span = q
            .get("span")
            .or_else(|| q.get("reg_span"))
            .and_then(|s| s.parse::<f64>().ok())
            .unwrap_or(default_win.span_lon_deg)
            .clamp(6.0, 72.0);
        let scale = q
            .get("scale")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(4)
            .clamp(2, 8);
        let target_w = q
            .get("target_w")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(1680)
            .clamp(600, 2800);

        let rkey = RegionKey {
            world: wkey.clone(),
            lat_milli: (lat * 1000.0).round() as i64,
            lon_milli: (lon * 1000.0).round() as i64,
            span_tenths: (span * 10.0).round() as i64,
            scale,
            style: style.slug(),
            target_w,
        };
        let base_qs = Self::world_query_string(&wkey, style, target_w);
        let full_qs = format!("{base_qs}&lat={lat:.4}&lon={lon:.4}&span={span:.1}&scale={scale}");
        {
            let guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
            if let Some(r) = guard.region_renders.get(&rkey) {
                return Ok((wkey, planet, Arc::clone(r), full_qs));
            }
        }
        let span_lat = (span * 0.68).clamp(4.0, 56.0);
        let reg_opt = RegionOptions::new(lat, lon, span, span_lat, scale);
        let reg = Arc::new(region::generate_region(&planet, &reg_opt)?);
        let ropt = RenderOptions {
            style,
            target_width: target_w,
            title: None,
        };
        let out = render_region_with_options(&planet, &reg, &reg_opt, &wkey.seed, &self.pack, &ropt);
        let png_href = format!("/api/region/map.png?{full_qs}");
        let cached = Arc::new(CachedRender::from_region(out, reg, &reg_opt, &self.pack, &png_href));
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.region_renders, &mut cache.region_lru, rkey, Arc::clone(&cached), 4);
        Ok((wkey, planet, cached, full_qs))
    }

    pub fn handle_raw_target(&self, raw_target: &str) -> StudioResponse {
        let (path, q) = parse_target(raw_target);
        self.handle_get(path, &q)
    }

    pub fn handle_get(&self, path: &str, q: &HashMap<String, String>) -> StudioResponse {
        match path {
            "/" | "/index.html" => StudioResponse {
                status: 200,
                content_type: "text/html; charset=utf-8",
                disposition: None,
                body: INDEX_HTML.as_bytes().to_vec(),
            },
            "/favicon.ico" => StudioResponse {
                status: 204,
                content_type: "text/plain",
                disposition: None,
                body: Vec::new(),
            },
            "/api/world" => match self.get_or_render_world(q) {
                Ok((wkey, planet, cached, qs)) => StudioResponse::json(build_world_json(&wkey, &planet, &cached, &qs)),
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/world/map.png" => match self.get_or_render_world(q) {
                Ok((_, _, cached, _)) => StudioResponse {
                    status: 200,
                    content_type: "image/png",
                    disposition: None,
                    body: cached.base_png.clone(),
                },
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/world/overlay.svg" => match self.get_or_render_world(q) {
                Ok((_, _, cached, _)) => StudioResponse {
                    status: 200,
                    content_type: "image/svg+xml; charset=utf-8",
                    disposition: None,
                    body: cached.overlay_svg.as_bytes().to_vec(),
                },
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/world/download.png" => match self.get_or_render_world(q) {
                Ok((wkey, _, cached, _)) => {
                    let st = Self::parse_style(q).slug();
                    StudioResponse {
                        status: 200,
                        content_type: "image/png",
                        disposition: Some(format!("attachment; filename=\"atlas_{}_{}.png\"", sanitize_filename(&wkey.seed), st)),
                        body: cached.full_png.clone(),
                    }
                }
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/world/download.svg" => match self.get_or_render_world(q) {
                Ok((wkey, _, cached, _)) => {
                    let st = Self::parse_style(q).slug();
                    StudioResponse {
                        status: 200,
                        content_type: "image/svg+xml; charset=utf-8",
                        disposition: Some(format!("attachment; filename=\"atlas_{}_{}.svg\"", sanitize_filename(&wkey.seed), st)),
                        body: cached.standalone_svg.as_bytes().to_vec(),
                    }
                }
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/region" => match self.get_or_render_region(q) {
                Ok((_, _, cached, qs)) => StudioResponse::json(build_region_json(&cached, &qs)),
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/region/map.png" => match self.get_or_render_region(q) {
                Ok((_, _, cached, _)) => StudioResponse {
                    status: 200,
                    content_type: "image/png",
                    disposition: None,
                    body: cached.base_png.clone(),
                },
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/region/overlay.svg" => match self.get_or_render_region(q) {
                Ok((_, _, cached, _)) => StudioResponse {
                    status: 200,
                    content_type: "image/svg+xml; charset=utf-8",
                    disposition: None,
                    body: cached.overlay_svg.as_bytes().to_vec(),
                },
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/region/download.png" => match self.get_or_render_region(q) {
                Ok((wkey, _, cached, _)) => {
                    let st = Self::parse_style(q).slug();
                    StudioResponse {
                        status: 200,
                        content_type: "image/png",
                        disposition: Some(format!("attachment; filename=\"region_{}_{}.png\"", sanitize_filename(&wkey.seed), st)),
                        body: cached.full_png.clone(),
                    }
                }
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/region/download.svg" => match self.get_or_render_region(q) {
                Ok((wkey, _, cached, _)) => {
                    let st = Self::parse_style(q).slug();
                    StudioResponse {
                        status: 200,
                        content_type: "image/svg+xml; charset=utf-8",
                        disposition: Some(format!("attachment; filename=\"region_{}_{}.svg\"", sanitize_filename(&wkey.seed), st)),
                        body: cached.standalone_svg.as_bytes().to_vec(),
                    }
                }
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/inspect" => self.handle_inspect(q),
            "/api/route_road" => self.handle_route_road(q),
            _ => StudioResponse::err(404, "Not found"),
        }
    }

    fn handle_inspect(&self, q: &HashMap<String, String>) -> StudioResponse {
        let mode = q.get("mode").map(|s| s.as_str()).unwrap_or("world");
        let px = q.get("px").and_then(|s| s.parse::<f64>().ok());
        let py = q.get("py").and_then(|s| s.parse::<f64>().ok());

        let (planet, lat_lon): (Arc<Planet>, Option<(f64, f64)>) = if let (Some(lat), Some(lon)) = (
            q.get("lat").and_then(|s| s.parse::<f64>().ok()),
            q.get("lon").and_then(|s| s.parse::<f64>().ok()),
        ) {
            let (wkey, popt) = Self::parse_world_opts(q);
            match self.get_or_build_planet(&wkey, &popt) {
                Ok(p) => (p, Some((lat.clamp(-89.9, 89.9), lon))),
                Err(e) => return StudioResponse::err(400, &e),
            }
        } else if let (Some(px), Some(py)) = (px, py) {
            if mode == "region" {
                match self.get_or_render_region(q) {
                    Ok((_, p, cached, _)) => {
                        let ll = cached.reg_proj.as_ref().and_then(|rp| rp.inverse(px, py));
                        (p, ll)
                    }
                    Err(e) => return StudioResponse::err(400, &e),
                }
            } else {
                match self.get_or_render_world(q) {
                    Ok((_, p, cached, _)) => {
                        let wp = WorldProj::fit(&p, cached.width);
                        let ll = wp.inverse(px, py);
                        (p, ll)
                    }
                    Err(e) => return StudioResponse::err(400, &e),
                }
            }
        } else {
            return StudioResponse::err(400, "Specify lat/lon or px/py");
        };

        let Some((lat, lon)) = lat_lon else {
            return StudioResponse::json("{\"in_bounds\":false}".into());
        };
        StudioResponse::json(build_inspect_json(&planet, lat, lon))
    }

    fn handle_route_road(&self, q: &HashMap<String, String>) -> StudioResponse {
        let mode = q.get("mode").map(|s| s.as_str()).unwrap_or("world");
        let to_px = q.get("to_px").and_then(|s| s.parse::<f64>().ok());
        let to_py = q.get("to_py").and_then(|s| s.parse::<f64>().ok());
        let to_lat_arg = q.get("to_lat").and_then(|s| s.parse::<f64>().ok());
        let to_lon_arg = q.get("to_lon").and_then(|s| s.parse::<f64>().ok());

        if mode == "region" {
            let Ok((_, _, cached, _)) = self.get_or_render_region(q) else {
                return StudioResponse::err(400, "Failed to load region");
            };
            let (Some(reg), Some(rp)) = (&cached.region, &cached.reg_proj) else {
                return StudioResponse::err(500, "Missing region projection");
            };
            let from_ll = if let (Some(lat), Some(lon)) = (
                q.get("from_lat").and_then(|s| s.parse::<f64>().ok()),
                q.get("from_lon").and_then(|s| s.parse::<f64>().ok()),
            ) {
                Some((lat, lon))
            } else if let (Some(px), Some(py)) = (
                q.get("from_px").and_then(|s| s.parse::<f64>().ok()),
                q.get("from_py").and_then(|s| s.parse::<f64>().ok()),
            ) {
                rp.inverse(px, py)
            } else {
                None
            };
            let Some((f_lat, f_lon)) = from_ll else {
                return StudioResponse::json("{\"ok\":false,\"error\":\"Точка вне карты\"}".into());
            };
            let Some(from_cell) = snap_region_land_cell(reg, rp.span_lon_deg, f_lat, f_lon) else {
                return StudioResponse::json("{\"ok\":false,\"error\":\"Поселение и дорога требуют суши\"}".into());
            };
            let placed = rp.project_cell((from_cell % reg.w) as f64 + 0.5, (from_cell / reg.w) as f64 + 0.5);

            let mut routed = None;
            let mut target_name = String::new();
            if let Some((t_lat, t_lon)) = to_lat_arg.zip(to_lon_arg).or_else(|| to_px.zip(to_py).and_then(|(x, y)| rp.inverse(x, y))) {
                if let Some(tc) = snap_region_land_cell(reg, rp.span_lon_deg, t_lat, t_lon) {
                    if let Some(rd) = route_region_road(reg, from_cell, tc, None) {
                        target_name = "Выбранный город".to_string();
                        routed = Some(rd);
                    }
                }
            } else {
                let fx = from_cell % reg.w;
                let fy = from_cell / reg.w;
                let mut cands: Vec<(usize, f64, &str)> = reg
                    .settlements
                    .iter()
                    .filter(|s| s.cell != from_cell)
                    .map(|s| {
                        let d = ((s.x as f64 - fx as f64) * reg.dx_km_row[fy])
                            .hypot((s.y as f64 - fy as f64) * reg.dy_km);
                        (s.cell, d, s.name.as_str())
                    })
                    .collect();
                cands.sort_by(|a, b| a.1.total_cmp(&b.1));
                for (tc, _, nm) in cands.into_iter().take(4) {
                    if let Some(rd) = route_region_road(reg, from_cell, tc, None) {
                        target_name = nm.to_string();
                        routed = Some(rd);
                        break;
                    }
                }
            }

            if let Some(rd) = routed {
                let mut len_km = 0.0f64;
                let mut max_elev = f32::NEG_INFINITY;
                for &c in &rd.cells {
                    max_elev = max_elev.max(reg.elevation_km[c]);
                }
                for w in rd.cells.windows(2) {
                    let (ax, ay) = reg.xy(w[0]);
                    let (bx, by) = reg.xy(w[1]);
                    len_km += ((bx as f64 - ax as f64) * reg.dx_km_row[ay])
                        .hypot((by as f64 - ay as f64) * reg.dy_km);
                }
                let pts: Vec<[f64; 2]> = rd
                    .pts
                    .iter()
                    .map(|p| rp.project_cell(p[0] as f64, p[1] as f64))
                    .collect();
                return StudioResponse::json(build_road_json(
                    placed,
                    &target_name,
                    len_km,
                    max_elev * 1000.0,
                    &pts,
                ));
            }
            return StudioResponse::json(build_road_json(placed, "", 0.0, reg.elevation_km[from_cell] * 1000.0, &[]));
        }

        let Ok((_, planet, cached, _)) = self.get_or_render_world(q) else {
            return StudioResponse::err(400, "Failed to load world");
        };
        let wp = WorldProj::fit(&planet, cached.width);
        let from_ll = if let (Some(lat), Some(lon)) = (
            q.get("from_lat").and_then(|s| s.parse::<f64>().ok()),
            q.get("from_lon").and_then(|s| s.parse::<f64>().ok()),
        ) {
            Some((lat, lon))
        } else if let (Some(px), Some(py)) = (
            q.get("from_px").and_then(|s| s.parse::<f64>().ok()),
            q.get("from_py").and_then(|s| s.parse::<f64>().ok()),
        ) {
            wp.inverse(px, py)
        } else {
            None
        };
        let Some((f_lat, f_lon)) = from_ll else {
            return StudioResponse::json("{\"ok\":false,\"error\":\"Точка вне карты\"}".into());
        };
        let Some(from_cell) = snap_world_land_cell(&planet, f_lat, f_lon) else {
            return StudioResponse::json("{\"ok\":false,\"error\":\"Поселение и дорога требуют суши\"}".into());
        };
        let (fcx, fcy) = planet.grid.xy(from_cell);
        let placed = wp.project(planet.grid.lat_deg(fcy), planet.grid.lon_deg(fcx));

        let mut routed = None;
        let mut target_name = String::new();
        if let Some((t_lat, t_lon)) = to_lat_arg.zip(to_lon_arg).or_else(|| to_px.zip(to_py).and_then(|(x, y)| wp.inverse(x, y))) {
            if let Some(tc) = snap_world_land_cell(&planet, t_lat, t_lon) {
                if let Some(cells) = route_land_road(&planet, from_cell, tc, None) {
                    target_name = "Выбранный город".to_string();
                    routed = Some(cells);
                }
            }
        } else {
            let u_from = planet.grid.unit_vec(fcx, fcy);
            let mut cands: Vec<(usize, f64, &str)> = planet
                .civilization
                .settlements
                .iter()
                .filter(|s| s.cell != from_cell)
                .map(|s| {
                    let (sx, sy) = planet.grid.xy(s.cell);
                    let d = planet.grid.spherical_dist_km(u_from, planet.grid.unit_vec(sx, sy));
                    (s.cell, d, s.name.as_str())
                })
                .collect();
            cands.sort_by(|a, b| a.1.total_cmp(&b.1));
            for (tc, _, nm) in cands.into_iter().take(4) {
                if let Some(cells) = route_land_road(&planet, from_cell, tc, None) {
                    target_name = nm.to_string();
                    routed = Some(cells);
                    break;
                }
            }
        }

        if let Some(cells) = routed {
            let mut len_km = 0.0f64;
            let mut max_elev = f32::NEG_INFINITY;
            for &c in &cells {
                max_elev = max_elev.max(planet.erosion.elevation_km[c]);
            }
            for w in cells.windows(2) {
                let (ax, ay) = planet.grid.xy(w[0]);
                let (bx, by) = planet.grid.xy(w[1]);
                len_km += planet.grid.spherical_dist_km(planet.grid.unit_vec(ax, ay), planet.grid.unit_vec(bx, by));
            }
            let pts: Vec<[f64; 2]> = cells
                .iter()
                .map(|&c| {
                    let (cx, cy) = planet.grid.xy(c);
                    wp.project(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx))
                })
                .collect();
            return StudioResponse::json(build_road_json(
                placed,
                &target_name,
                len_km,
                max_elev * 1000.0,
                &pts,
            ));
        }
        StudioResponse::json(build_road_json(placed, "", 0.0, planet.erosion.elevation_km[from_cell] * 1000.0, &[]))
    }
}

pub fn serve(cfg: StudioConfig) -> Result<(), String> {
    let addr = format!("{}:{}", cfg.host, cfg.port);
    let listener = TcpListener::bind(&addr).map_err(|e| format!("bind {addr}: {e}"))?;
    let app = Arc::new(StudioApp::new()?);
    println!("Fantasy Map Studio запущена: http://{addr}");
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let app = Arc::clone(&app);
        std::thread::spawn(move || {
            let _ = handle_connection(stream, &app);
        });
    }
    Ok(())
}

fn handle_connection(mut stream: TcpStream, app: &StudioApp) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut req_line = String::new();
    if reader.read_line(&mut req_line)? == 0 {
        return Ok(());
    }
    loop {
        let mut hdr = String::new();
        let n = reader.read_line(&mut hdr)?;
        if n == 0 || hdr == "\r\n" || hdr == "\n" {
            break;
        }
    }
    let mut parts = req_line.split_whitespace();
    let method = parts.next().unwrap_or("");
    let raw_target = parts.next().unwrap_or("/");
    let resp = if method != "GET" {
        StudioResponse::err(405, "Only GET is supported")
    } else {
        app.handle_raw_target(raw_target)
    };

    let reason = match resp.status {
        200 => "OK",
        204 => "No Content",
        400 => "Bad Request",
        404 => "Not Found",
        405 => "Method Not Allowed",
        _ => "Internal Server Error",
    };
    let mut head = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: {}\r\nContent-Length: {}\r\nCache-Control: no-store\r\nConnection: close\r\n",
        resp.status,
        reason,
        resp.content_type,
        resp.body.len()
    );
    if let Some(disp) = &resp.disposition {
        let _ = write!(head, "Content-Disposition: {disp}\r\n");
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    if !resp.body.is_empty() {
        stream.write_all(&resp.body)?;
    }
    stream.flush()
}

fn parse_target(raw: &str) -> (&str, HashMap<String, String>) {
    let mut q = HashMap::new();
    let Some((path, qs)) = raw.split_once('?') else {
        return (raw, q);
    };
    for pair in qs.split('&') {
        if pair.is_empty() {
            continue;
        }
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        q.insert(percent_decode(k), percent_decode(v));
    }
    (path, q)
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len() => {
                if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                    out.push((h << 4) | l);
                    i += 3;
                } else {
                    out.push(bytes[i]);
                    i += 1;
                }
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

fn url_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
            out.push(b as char);
        } else {
            let _ = write!(out, "%{b:02X}");
        }
    }
    out
}

fn sanitize_filename(s: &str) -> String {
    let clean: String = s
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    if clean.is_empty() {
        "world".to_string()
    } else {
        clean
    }
}

fn push_json_str(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", c as u32);
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

fn realm_color(rid: u32) -> [u8; 3] {
    const PAL: [[u8; 3]; 6] = [
        [186, 112, 98],
        [108, 138, 158],
        [190, 154, 92],
        [128, 156, 114],
        [148, 112, 138],
        [130, 150, 146],
    ];
    PAL[rid as usize % PAL.len()]
}

fn build_world_json(wkey: &WorldKey, planet: &Planet, cached: &CachedRender, qs: &str) -> String {
    let sug = choose_region_window(planet);
    let cont_cnt = planet
        .geography
        .landmasses
        .iter()
        .filter(|l| l.kind == LandmassKind::Continent)
        .count();

    let mut out = String::with_capacity(2048);
    let _ = write!(out, "{{\"seed\":");
    push_json_str(&mut out, &wkey.seed);
    let _ = write!(
        out,
        ",\"width\":{},\"height\":{},\"grid_w\":{},\"grid_h\":{},\"continents_count\":{},\"rivers_count\":{},\"settlements_count\":{},\"realms_count\":{},\"deposits_count\":{},\"suggested_region\":{{\"lat\":{:.4},\"lon\":{:.4},\"span\":{:.1}}},\"map_png_url\":",
        cached.width,
        cached.height,
        planet.grid.w,
        planet.grid.h,
        cont_cnt,
        cached.rivers_count,
        cached.settlements_count,
        planet.civilization.realms.len(),
        planet.resources.deposits.len(),
        sug.center_lat_deg,
        sug.center_lon_deg,
        sug.span_lon_deg
    );
    push_json_str(&mut out, &format!("/api/world/map.png?{qs}"));
    out.push_str(",\"overlay_svg_url\":");
    push_json_str(&mut out, &format!("/api/world/overlay.svg?{qs}"));
    out.push_str(",\"download_png_url\":");
    push_json_str(&mut out, &format!("/api/world/download.png?{qs}"));
    out.push_str(",\"download_svg_url\":");
    push_json_str(&mut out, &format!("/api/world/download.svg?{qs}"));
    out.push_str(",\"realms\":[");
    for (idx, r) in planet.civilization.realms.iter().enumerate() {
        if idx > 0 {
            out.push(',');
        }
        let (cx, cy) = planet.grid.xy(r.capital_cell);
        let lat = planet.grid.lat_deg(cy);
        let lon = planet.grid.lon_deg(cx);
        let cap_name = planet
            .civilization
            .settlements
            .iter()
            .find(|s| s.id == r.capital_settlement_id)
            .map(|s| s.name.as_str())
            .unwrap_or("—");
        let c = realm_color(r.id);
        out.push_str("{\"name\":");
        push_json_str(&mut out, &r.name);
        out.push_str(",\"capital\":");
        push_json_str(&mut out, cap_name);
        let _ = write!(
            out,
            ",\"lat\":{:.4},\"lon\":{:.4},\"color\":[{},{},{}]}}",
            lat, lon, c[0], c[1], c[2]
        );
    }
    out.push_str("]}");
    out
}

fn build_region_json(cached: &CachedRender, qs: &str) -> String {
    let mut out = String::with_capacity(1024);
    let _ = write!(
        out,
        "{{\"width\":{},\"height\":{},\"center_lat_deg\":{:.4},\"center_lon_deg\":{:.4},\"lat_min_deg\":{:.4},\"lat_max_deg\":{:.4},\"lon_min_deg\":{:.4},\"lon_max_deg\":{:.4},\"rivers_count\":{},\"passes_count\":{},\"settlements_count\":{},\"map_png_url\":",
        cached.width,
        cached.height,
        cached.center_lat_deg,
        cached.center_lon_deg,
        cached.lat_min_deg,
        cached.lat_max_deg,
        cached.lon_min_deg,
        cached.lon_max_deg,
        cached.rivers_count,
        cached.passes_count,
        cached.settlements_count
    );
    push_json_str(&mut out, &format!("/api/region/map.png?{qs}"));
    out.push_str(",\"overlay_svg_url\":");
    push_json_str(&mut out, &format!("/api/region/overlay.svg?{qs}"));
    out.push_str(",\"download_png_url\":");
    push_json_str(&mut out, &format!("/api/region/download.png?{qs}"));
    out.push_str(",\"download_svg_url\":");
    push_json_str(&mut out, &format!("/api/region/download.svg?{qs}"));
    out.push('}');
    out
}

fn bedrock_name(b: Bedrock) -> &'static str {
    match b {
        Bedrock::OceanicBasalt => "Океанический базальт",
        Bedrock::CratonShield => "Древний кристаллический щит",
        Bedrock::SedimentaryPlatform => "Осадочный чехол платформы",
        Bedrock::OrogenicFold => "Складчатый пояс",
        Bedrock::VolcanicProvince => "Вулканическая провинция",
        Bedrock::RiftBasin => "Рифтовая впадина",
        Bedrock::AlluvialPlain => "Аллювиальная равнина",
    }
}

fn marine_zone_name(m: MarineZone) -> &'static str {
    match m {
        MarineZone::Land => "Суша",
        MarineZone::OpenOcean => "Открытый океан",
        MarineZone::MarginalSea => "Окраинное море",
        MarineZone::Strait => "Пролив",
        MarineZone::Bay => "Залив",
    }
}

fn settlement_role_name(r: SettlementRole) -> &'static str {
    match r {
        SettlementRole::Capital => "столица",
        SettlementRole::Port => "порт",
        SettlementRole::RiverHub => "речной узел",
        SettlementRole::PassFortress => "крепость",
        SettlementRole::OasisTown => "оазис",
        SettlementRole::MiningTown => "рудный город",
        SettlementRole::MarketTown => "торговый город",
    }
}

fn build_inspect_json(planet: &Planet, lat_deg: f64, lon_deg: f64) -> String {
    let w = planet.grid.w;
    let h = planet.grid.h;
    let fy = ((90.0 - lat_deg) / 180.0 * h as f64 - 0.5).clamp(0.0, (h - 1) as f64);
    let lon_norm = (lon_deg + 180.0).rem_euclid(360.0);
    let fx = (lon_norm / 360.0 * w as f64 - 0.5).rem_euclid(w as f64);
    let x = (fx.round() as usize) % w;
    let y = (fy.round() as usize).min(h - 1);
    let cell = planet.grid.idx(x, y);

    let is_ocean = planet.hydrology.is_ocean[cell] != 0;
    let elev_m = planet.erosion.elevation_km[cell] * 1000.0;
    let biome = planet.biomes.biome[cell].name();
    let bedrock = bedrock_name(planet.biomes.bedrock[cell]);
    let marine_zone = marine_zone_name(planet.geography.marine_zone[cell]);
    let livelihood = planet.civilization.livelihood[cell].name();

    let realm_name = {
        let rid = planet.civilization.realm_id[cell];
        if rid >= 0 {
            planet
                .civilization
                .realms
                .get(rid as usize)
                .map(|r| r.name.as_str())
                .unwrap_or("")
        } else {
            ""
        }
    };
    let culture_name = {
        let cid = planet.civilization.culture_id[cell];
        if cid >= 0 {
            planet
                .civilization
                .cultures
                .get(cid as usize)
                .map(|c| c.name.as_str())
                .unwrap_or("")
        } else {
            ""
        }
    };
    let landmass_name = {
        let lid = planet.geography.landmass_id[cell];
        if lid >= 0 {
            planet
                .names
                .landmasses
                .get(lid as usize)
                .map(|s| s.as_str())
                .unwrap_or("")
        } else {
            ""
        }
    };

    let u_pt = planet.grid.unit_vec_f(fx, fy);
    let mut nearest_label = String::new();
    let mut nearest_dist = f64::INFINITY;
    for st in &planet.civilization.settlements {
        let (sx, sy) = planet.grid.xy(st.cell);
        let d = planet.grid.spherical_dist_km(u_pt, planet.grid.unit_vec(sx, sy));
        if d < nearest_dist {
            nearest_dist = d;
            nearest_label = format!("{} ({})", st.name, settlement_role_name(st.role));
        }
    }
    if !nearest_dist.is_finite() {
        nearest_dist = 0.0;
    }

    let mut nearest_dep_name = String::new();
    let mut nearest_dep_dist = f64::INFINITY;
    let mut nearest_dep_rich = 0.0f32;
    for dep in &planet.resources.deposits {
        let (dx, dy) = planet.grid.xy(dep.cell);
        let d = planet.grid.spherical_dist_km(u_pt, planet.grid.unit_vec(dx, dy));
        if d < nearest_dep_dist {
            nearest_dep_dist = d;
            nearest_dep_name = dep.kind.name().to_string();
            nearest_dep_rich = dep.richness;
        }
    }
    if !nearest_dep_dist.is_finite() {
        nearest_dep_dist = 0.0;
    }

    let r = &planet.resources;
    let mut out = String::with_capacity(1024);
    let _ = write!(
        out,
        "{{\"in_bounds\":true,\"lat\":{:.4},\"lon\":{:.4},\"is_ocean\":{},\"elevation_m\":{:.1},\"temp_c\":{:.2},\"temp_jan_c\":{:.2},\"temp_jul_c\":{:.2},\"precip_mm\":{:.1},\"aridity_index\":{:.3},\"soil_fertility\":{:.3},\"discharge_m3s\":{:.1},\"river_order\":{},\"habitability\":{:.3},\"nearest_dist_km\":{:.1},\"nearest_deposit_dist_km\":{:.1},\"nearest_deposit_richness\":{:.3}",
        lat_deg,
        lon_deg,
        is_ocean,
        elev_m,
        planet.climate.temp_c[cell],
        planet.climate.temp_jan_c[cell],
        planet.climate.temp_jul_c[cell],
        planet.climate.precip_mm[cell],
        planet.climate.aridity_index[cell],
        planet.biomes.soil_fertility[cell],
        planet.hydrology.discharge_m3s[cell],
        planet.hydrology.river_order[cell],
        planet.civilization.habitability[cell],
        nearest_dist,
        nearest_dep_dist,
        nearest_dep_rich
    );
    out.push_str(",\"biome\":");
    push_json_str(&mut out, biome);
    out.push_str(",\"bedrock\":");
    push_json_str(&mut out, bedrock);
    out.push_str(",\"marine_zone\":");
    push_json_str(&mut out, marine_zone);
    out.push_str(",\"livelihood\":");
    push_json_str(&mut out, livelihood);
    out.push_str(",\"realm_name\":");
    push_json_str(&mut out, realm_name);
    out.push_str(",\"culture_name\":");
    push_json_str(&mut out, culture_name);
    out.push_str(",\"landmass_name\":");
    push_json_str(&mut out, landmass_name);
    out.push_str(",\"nearest_settlement\":");
    push_json_str(&mut out, &nearest_label);
    out.push_str(",\"nearest_deposit\":");
    push_json_str(&mut out, &nearest_dep_name);
    let _ = write!(
        out,
        ",\"resources\":{{\"iron\":{:.3},\"copper_gold\":{:.3},\"gems_rare\":{:.3},\"coal\":{:.3},\"hydrocarbons\":{:.3},\"salt\":{:.3},\"timber\":{:.3},\"fishery\":{:.3}}}}}",
        r.iron[cell],
        r.copper_gold[cell],
        r.gems_rare[cell],
        r.coal[cell],
        r.hydrocarbons[cell],
        r.salt[cell],
        r.timber[cell],
        r.fishery[cell]
    );
    out
}

fn snap_world_land_cell(planet: &Planet, lat_deg: f64, lon_deg: f64) -> Option<usize> {
    let w = planet.grid.w;
    let h = planet.grid.h;
    let fy = ((90.0 - lat_deg) / 180.0 * h as f64 - 0.5).clamp(0.0, (h - 1) as f64);
    let lon_norm = (lon_deg + 180.0).rem_euclid(360.0);
    let fx = (lon_norm / 360.0 * w as f64 - 0.5).rem_euclid(w as f64);
    let x0 = (fx.round() as usize) % w;
    let y0 = (fy.round() as usize).min(h - 1);
    let mut best = None;
    let mut best_d = 999.0f64;
    for dy in -2isize..=2 {
        let yy = y0 as isize + dy;
        if yy < 0 || yy >= h as isize {
            continue;
        }
        for dx in -2isize..=2 {
            let xx = planet.grid.wrap_x(x0 as isize + dx);
            let c = planet.grid.idx(xx, yy as usize);
            if planet.hydrology.is_ocean[c] == 0 && planet.hydrology.is_lake[c] == 0 {
                let d = (dx as f64).hypot(dy as f64);
                if d < best_d {
                    best_d = d;
                    best = Some(c);
                }
            }
        }
    }
    best
}

fn snap_region_land_cell(reg: &Region, span_lon_deg: f64, lat_deg: f64, lon_deg: f64) -> Option<usize> {
    let dlon = (lon_deg - reg.center_lon_deg + 540.0).rem_euclid(360.0) - 180.0;
    let fx = ((dlon / span_lon_deg.max(1e-6) + 0.5) * reg.w as f64 - 0.5).clamp(0.0, (reg.w - 1) as f64);
    let fy = ((reg.lat_max_deg - lat_deg) / (reg.lat_max_deg - reg.lat_min_deg).max(1e-6) * reg.h as f64 - 0.5)
        .clamp(0.0, (reg.h - 1) as f64);
    let x0 = (fx.round() as usize).min(reg.w - 1);
    let y0 = (fy.round() as usize).min(reg.h - 1);
    let mut best = None;
    let mut best_d = 999.0f64;
    for dy in -2isize..=2 {
        let yy = y0 as isize + dy;
        if yy < 0 || yy >= reg.h as isize {
            continue;
        }
        for dx in -2isize..=2 {
            let xx = x0 as isize + dx;
            if xx < 0 || xx >= reg.w as isize {
                continue;
            }
            let c = reg.idx(xx as usize, yy as usize);
            if reg.is_ocean[c] == 0 && reg.is_lake[c] == 0 {
                let d = (dx as f64).hypot(dy as f64);
                if d < best_d {
                    best_d = d;
                    best = Some(c);
                }
            }
        }
    }
    best
}

fn build_road_json(
    placed: [f64; 2],
    target_name: &str,
    length_km: f64,
    max_elev_m: f32,
    pts: &[[f64; 2]],
) -> String {
    let mut out = String::with_capacity(512 + pts.len() * 18);
    let _ = write!(
        out,
        "{{\"ok\":true,\"placed\":[{:.2},{:.2}],\"length_km\":{:.1},\"max_elev_m\":{:.0},\"target_name\":",
        placed[0], placed[1], length_km, max_elev_m
    );
    push_json_str(&mut out, target_name);
    out.push_str(",\"pts\":[");
    for (i, p) in pts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[{:.2},{:.2}]", p[0], p[1]);
    }
    out.push_str("]}");
    out
}
