//! Многопоточный HTTP-сервер картографической студии (`std::net`) без внешних зависимостей.

use fms_core::biomes::Bedrock;
use fms_core::civilization::{
    route_land_road, route_sea_lane, CivilizationOptions, SettlementRole, SettlementTier,
    WildSiteKind,
};
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
struct PhysWorldKey {
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
struct CivKey {
    realms: bool,
    cities: bool,
    routes: bool,
    target_realms: usize,
    salt: u32,
}

impl CivKey {
    fn any(&self) -> bool {
        self.realms || self.cities || self.routes
    }

    fn to_options(&self) -> CivilizationOptions {
        CivilizationOptions {
            include_realms: self.realms,
            include_cities: self.cities,
            include_routes: self.routes,
            target_realms: self.target_realms,
            salt: self.salt,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct WorldKey {
    phys: PhysWorldKey,
    civ: CivKey,
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

#[derive(Clone, Debug)]
struct WaypointDto {
    id: String,
    kind: &'static str,
    subkind: &'static str,
    name: String,
    subtitle: String,
    lat: f64,
    lon: f64,
    x: f64,
    y: f64,
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
    phys_planets: HashMap<PhysWorldKey, Arc<Planet>>,
    phys_lru: VecDeque<PhysWorldKey>,
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
            phys_planets: HashMap::new(),
            phys_lru: VecDeque::new(),
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

    fn parse_bool(q: &HashMap<String, String>, key: &str) -> bool {
        q.get(key)
            .map(|s| matches!(s.trim().to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
            .unwrap_or(false)
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

        let realms = Self::parse_bool(q, "civ_realms");
        let cities = Self::parse_bool(q, "civ_cities");
        let routes = Self::parse_bool(q, "civ_routes");
        let target_realms = q
            .get("target_realms")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(0)
            .min(18);
        let salt = q
            .get("civ_salt")
            .and_then(|s| s.parse::<u32>().ok())
            .unwrap_or(0);

        let mut opt = PlanetOptions::new(&seed);
        opt.tectonic.w = w;
        opt.tectonic.target_continents = continents;
        opt.tectonic.activity = activity;
        opt.tectonic.water_depth_km = water_depth;
        opt.climate.axial_tilt_deg = tilt;
        opt.climate.solar_offset_c = solar;
        opt.climate.rotation_rate = rot;
        opt.target_realms = target_realms;

        let phys = PhysWorldKey {
            seed,
            w,
            continents,
            activity_milli: (activity * 1000.0).round() as i64,
            water_milli: (water_depth * 1000.0).round() as i64,
            tilt_tenths: (tilt * 10.0).round() as i64,
            solar_tenths: (solar * 10.0).round() as i64,
            rot_milli: (rot * 1000.0).round() as i64,
        };
        let civ = CivKey { realms, cities, routes, target_realms, salt };
        (WorldKey { phys, civ }, opt)
    }

    fn parse_style(q: &HashMap<String, String>) -> Style {
        q.get("style")
            .and_then(|s| Style::from_slug(s))
            .unwrap_or(Style::Sepia)
    }

    fn world_query_string(k: &WorldKey, style: Style, target_w: usize) -> String {
        let p = &k.phys;
        let c = &k.civ;
        format!(
            "seed={}&w={}&continents={}&activity={:.3}&water_depth={:.3}&tilt={:.1}&solar={:.1}&rotation={:.3}&civ_realms={}&civ_cities={}&civ_routes={}&target_realms={}&civ_salt={}&style={}&target_w={}",
            url_encode(&p.seed),
            p.w,
            p.continents,
            p.activity_milli as f64 / 1000.0,
            p.water_milli as f64 / 1000.0,
            p.tilt_tenths as f64 / 10.0,
            p.solar_tenths as f64 / 10.0,
            p.rot_milli as f64 / 1000.0,
            if c.realms { 1 } else { 0 },
            if c.cities { 1 } else { 0 },
            if c.routes { 1 } else { 0 },
            c.target_realms,
            c.salt,
            style.slug(),
            target_w
        )
    }

    fn get_or_build_physical(&self, pkey: &PhysWorldKey, opt: &PlanetOptions) -> Result<Arc<Planet>, String> {
        {
            let guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
            if let Some(p) = guard.phys_planets.get(pkey) {
                return Ok(Arc::clone(p));
            }
        }
        let planet = Arc::new(planet::generate_physical_with_options(opt)?);
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.phys_planets, &mut cache.phys_lru, pkey.clone(), Arc::clone(&planet), 3);
        Ok(planet)
    }

    fn get_or_build_planet(&self, key: &WorldKey, opt: &PlanetOptions) -> Result<Arc<Planet>, String> {
        let phys = self.get_or_build_physical(&key.phys, opt)?;
        if !key.civ.any() {
            return Ok(phys);
        }
        {
            let guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
            if let Some(p) = guard.planets.get(key) {
                return Ok(Arc::clone(p));
            }
        }
        let populated = Arc::new(planet::populate_civilization(&phys, &key.civ.to_options()));
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.planets, &mut cache.planet_lru, key.clone(), Arc::clone(&populated), 6);
        Ok(populated)
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
        let out = render_world_with_options(&planet, &wkey.phys.seed, &self.pack, &ropt);
        let png_href = format!("/api/world/map.png?{qs}");
        let cached = Arc::new(CachedRender::from_world(out, &planet, &self.pack, &png_href));
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.world_renders, &mut cache.world_lru, rkey, Arc::clone(&cached), 6);
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
            .clamp(6.0, 100.0);
        let scale = q
            .get("scale")
            .and_then(|s| s.parse::<usize>().ok())
            .unwrap_or(4)
            .clamp(2, 16);
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
        let span_lat = (span * 0.68).clamp(4.0, 70.0);
        let reg_opt = RegionOptions::new(lat, lon, span, span_lat, scale);
        let reg = Arc::new(region::generate_region(&planet, &reg_opt)?);
        let ropt = RenderOptions {
            style,
            target_width: target_w,
            title: None,
        };
        let out = render_region_with_options(&planet, &reg, &reg_opt, &wkey.phys.seed, &self.pack, &ropt);
        let png_href = format!("/api/region/map.png?{full_qs}");
        let cached = Arc::new(CachedRender::from_region(out, reg, &reg_opt, &self.pack, &png_href));
        let mut guard = self.cache.lock().map_err(|_| "cache poisoned".to_string())?;
        let cache = &mut *guard;
        StudioCache::insert_bounded(&mut cache.region_renders, &mut cache.region_lru, rkey, Arc::clone(&cached), 8);
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
                        disposition: Some(format!("attachment; filename=\"atlas_{}_{}.png\"", sanitize_filename(&wkey.phys.seed), st)),
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
                        disposition: Some(format!("attachment; filename=\"atlas_{}_{}.svg\"", sanitize_filename(&wkey.phys.seed), st)),
                        body: cached.standalone_svg.as_bytes().to_vec(),
                    }
                }
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/region" => match self.get_or_render_region(q) {
                Ok((_, planet, cached, qs)) => StudioResponse::json(build_region_json(&planet, &cached, &qs)),
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
                        disposition: Some(format!("attachment; filename=\"region_{}_{}.png\"", sanitize_filename(&wkey.phys.seed), st)),
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
                        disposition: Some(format!("attachment; filename=\"region_{}_{}.svg\"", sanitize_filename(&wkey.phys.seed), st)),
                        body: cached.standalone_svg.as_bytes().to_vec(),
                    }
                }
                Err(e) => StudioResponse::err(400, &e),
            },
            "/api/world/project" => self.handle_world_project(q),
            "/api/world/unproject" => self.handle_world_unproject(q),
            "/api/inspect" => self.handle_inspect(q),
            "/api/route_road" => self.handle_route_road(q),
            _ => StudioResponse::err(404, "Not found"),
        }
    }

    /// Широта/долгота → пиксели мировой карты (проекция Паттерсона нелинейна по широте, поэтому считаем на сервере).
    fn handle_world_project(&self, q: &HashMap<String, String>) -> StudioResponse {
        let (Some(lat), Some(lon)) = (
            q.get("lat").and_then(|s| s.parse::<f64>().ok()),
            q.get("lon").and_then(|s| s.parse::<f64>().ok()),
        ) else {
            return StudioResponse::err(400, "Specify lat/lon");
        };
        match self.get_or_render_world(q) {
            Ok((_, p, cached, _)) => {
                let wp = WorldProj::fit(&p, cached.width);
                let [x, y] = wp.project(lat.clamp(-89.9, 89.9), lon);
                let [fx, fy, fw, fh] = wp.frame;
                let inside = x >= fx && x <= fx + fw && y >= fy && y <= fy + fh;
                StudioResponse::json(format!("{{\"x\":{x:.3},\"y\":{y:.3},\"in_bounds\":{inside}}}"))
            }
            Err(e) => StudioResponse::err(400, &e),
        }
    }

    /// Пиксели мировой карты → широта/долгота.
    fn handle_world_unproject(&self, q: &HashMap<String, String>) -> StudioResponse {
        let (Some(px), Some(py)) = (
            q.get("px").and_then(|s| s.parse::<f64>().ok()),
            q.get("py").and_then(|s| s.parse::<f64>().ok()),
        ) else {
            return StudioResponse::err(400, "Specify px/py");
        };
        match self.get_or_render_world(q) {
            Ok((_, p, cached, _)) => {
                let wp = WorldProj::fit(&p, cached.width);
                match wp.inverse(px, py) {
                    Some((lat, lon)) => StudioResponse::json(format!(
                        "{{\"in_bounds\":true,\"lat\":{lat:.5},\"lon\":{lon:.5}}}"
                    )),
                    None => StudioResponse::json("{\"in_bounds\":false}".into()),
                }
            }
            Err(e) => StudioResponse::err(400, &e),
        }
    }

    fn handle_inspect(&self, q: &HashMap<String, String>) -> StudioResponse {
        let mode = q.get("mode").map(|s| s.as_str()).unwrap_or("world");
        let px = q.get("px").and_then(|s| s.parse::<f64>().ok());
        let py = q.get("py").and_then(|s| s.parse::<f64>().ok());
        let settlement_id = q.get("settlement_id").and_then(|s| s.parse::<u32>().ok());

        let (planet, lat_lon): (Arc<Planet>, Option<(f64, f64)>) = if let Some(sid) = settlement_id {
            let (wkey, popt) = Self::parse_world_opts(q);
            match self.get_or_build_planet(&wkey, &popt) {
                Ok(p) => {
                    let ll = p.civilization.settlements.get(sid as usize).map(|st| {
                        let (sx, sy) = p.grid.xy(st.cell);
                        (p.grid.lat_deg(sy), p.grid.lon_deg(sx))
                    });
                    (p, ll)
                }
                Err(e) => return StudioResponse::err(400, &e),
            }
        } else if let (Some(lat), Some(lon)) = (
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
            return StudioResponse::err(400, "Specify lat/lon, settlement_id, or px/py");
        };

        let Some((lat, lon)) = lat_lon else {
            return StudioResponse::json("{\"in_bounds\":false}".into());
        };
        StudioResponse::json(build_inspect_json(&planet, lat, lon, settlement_id))
    }

    fn handle_route_road(&self, q: &HashMap<String, String>) -> StudioResponse {
        let mode = q.get("mode").map(|s| s.as_str()).unwrap_or("world");
        let allow_sea = q.get("allow_sea").map(|s| s != "0").unwrap_or(true);
        let to_px = q.get("to_px").and_then(|s| s.parse::<f64>().ok());
        let to_py = q.get("to_py").and_then(|s| s.parse::<f64>().ok());
        let to_lat_arg = q.get("to_lat").and_then(|s| s.parse::<f64>().ok());
        let to_lon_arg = q.get("to_lon").and_then(|s| s.parse::<f64>().ok());
        let req_target_name = q.get("target_name").map(|s| s.trim()).filter(|s| !s.is_empty());

        if mode == "region" {
            let Ok((_, planet, cached, _)) = self.get_or_render_region(q) else {
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

            let explicit_to = to_lat_arg
                .zip(to_lon_arg)
                .or_else(|| to_px.zip(to_py).and_then(|(x, y)| rp.inverse(x, y)));

            if let Some((t_lat, t_lon)) = explicit_to {
                if let Some(tc) = snap_region_land_cell(reg, rp.span_lon_deg, t_lat, t_lon) {
                    let to_placed = rp.project_cell((tc % reg.w) as f64 + 0.5, (tc / reg.w) as f64 + 0.5);
                    if let Some(rd) = route_region_road(reg, from_cell, tc, None) {
                        let (len_km, max_elev) = region_road_stats(reg, &rd.cells);
                        let pts: Vec<[f64; 2]> = rd.pts.iter().map(|p| rp.project_cell(p[0] as f64, p[1] as f64)).collect();
                        let geo_pts: Vec<[f64; 2]> = rd.cells.iter().map(|&c| region_cell_latlon(reg, rp.span_lon_deg, c)).collect();
                        return StudioResponse::json(build_road_json(
                            placed,
                            to_placed,
                            false,
                            req_target_name.unwrap_or("Выбранная точка"),
                            len_km,
                            max_elev * 1000.0,
                            &pts,
                            &geo_pts,
                        ));
                    }
                    if allow_sea {
                        if let (Some(wc0), Some(wc1)) = (snap_world_land_cell(&planet, f_lat, f_lon), snap_world_land_cell(&planet, t_lat, t_lon)) {
                            if let Some(sea_cells) = route_sea_lane(&planet, wc0, wc1) {
                                let (len_km, mut pts, mut geo_pts) = (world_path_len(&planet, &sea_cells), Vec::new(), Vec::new());
                                pts.push(placed);
                                geo_pts.push([f_lat, f_lon]);
                                for &c in &sea_cells {
                                    let (gx, gy) = planet.grid.xy(c);
                                    let (la, lo) = (planet.grid.lat_deg(gy), planet.grid.lon_deg(gx));
                                    if let Some(pr) = rp.project_lat_lon(la, lo) {
                                        pts.push(pr);
                                    }
                                    geo_pts.push([la, lo]);
                                }
                                pts.push(to_placed);
                                geo_pts.push([t_lat, t_lon]);
                                return StudioResponse::json(build_road_json(
                                    placed,
                                    to_placed,
                                    true,
                                    req_target_name.unwrap_or("Морской маршрут"),
                                    len_km,
                                    0.0,
                                    &pts,
                                    &geo_pts,
                                ));
                            }
                        }
                    }
                }
                return StudioResponse::json("{\"ok\":false,\"error\":\"Нет сухопутного или морского прохода между точками\"}".into());
            }

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
                    let (len_km, max_elev) = region_road_stats(reg, &rd.cells);
                    let to_placed = rp.project_cell((tc % reg.w) as f64 + 0.5, (tc / reg.w) as f64 + 0.5);
                    let pts: Vec<[f64; 2]> = rd.pts.iter().map(|p| rp.project_cell(p[0] as f64, p[1] as f64)).collect();
                    let geo_pts: Vec<[f64; 2]> = rd.cells.iter().map(|&c| region_cell_latlon(reg, rp.span_lon_deg, c)).collect();
                    return StudioResponse::json(build_road_json(
                        placed,
                        to_placed,
                        false,
                        nm,
                        len_km,
                        max_elev * 1000.0,
                        &pts,
                        &geo_pts,
                    ));
                }
            }
            return StudioResponse::json(build_road_json(placed, placed, false, "", 0.0, reg.elevation_km[from_cell] * 1000.0, &[], &[]));
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
        let (fr_lat, fr_lon) = (planet.grid.lat_deg(fcy), planet.grid.lon_deg(fcx));
        let placed = wp.project(fr_lat, fr_lon);

        let explicit_to = to_lat_arg
            .zip(to_lon_arg)
            .or_else(|| to_px.zip(to_py).and_then(|(x, y)| wp.inverse(x, y)));

        if let Some((t_lat, t_lon)) = explicit_to {
            if let Some(tc) = snap_world_land_cell(&planet, t_lat, t_lon) {
                let (tcx, tcy) = planet.grid.xy(tc);
                let (to_lat_s, to_lon_s) = (planet.grid.lat_deg(tcy), planet.grid.lon_deg(tcx));
                let to_placed = wp.project(to_lat_s, to_lon_s);
                if let Some(cells) = route_land_road(&planet, from_cell, tc, None) {
                    let len_km = world_path_len(&planet, &cells);
                    let max_elev = cells.iter().map(|&c| planet.erosion.elevation_km[c]).fold(f32::NEG_INFINITY, f32::max);
                    let pts: Vec<[f64; 2]> = cells.iter().map(|&c| {
                        let (cx, cy) = planet.grid.xy(c);
                        wp.project(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx))
                    }).collect();
                    let geo_pts: Vec<[f64; 2]> = cells.iter().map(|&c| {
                        let (cx, cy) = planet.grid.xy(c);
                        [planet.grid.lat_deg(cy), planet.grid.lon_deg(cx)]
                    }).collect();
                    return StudioResponse::json(build_road_json(
                        placed,
                        to_placed,
                        false,
                        req_target_name.unwrap_or("Выбранная точка"),
                        len_km,
                        max_elev * 1000.0,
                        &pts,
                        &geo_pts,
                    ));
                }
                if allow_sea {
                    if let Some(sea_cells) = route_sea_lane(&planet, from_cell, tc) {
                        let len_km = world_path_len(&planet, &sea_cells);
                        let mut pts = Vec::with_capacity(sea_cells.len() + 2);
                        let mut geo_pts = Vec::with_capacity(sea_cells.len() + 2);
                        pts.push(placed);
                        geo_pts.push([fr_lat, fr_lon]);
                        for &c in &sea_cells {
                            let (cx, cy) = planet.grid.xy(c);
                            let (la, lo) = (planet.grid.lat_deg(cy), planet.grid.lon_deg(cx));
                            pts.push(wp.project(la, lo));
                            geo_pts.push([la, lo]);
                        }
                        pts.push(to_placed);
                        geo_pts.push([to_lat_s, to_lon_s]);
                        return StudioResponse::json(build_road_json(
                            placed,
                            to_placed,
                            true,
                            req_target_name.unwrap_or("Морской путь"),
                            len_km,
                            0.0,
                            &pts,
                            &geo_pts,
                        ));
                    }
                }
            }
            return StudioResponse::json("{\"ok\":false,\"error\":\"Нет сухопутного или морского прохода между точками\"}".into());
        }

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
                let len_km = world_path_len(&planet, &cells);
                let max_elev = cells.iter().map(|&c| planet.erosion.elevation_km[c]).fold(f32::NEG_INFINITY, f32::max);
                let (tcx, tcy) = planet.grid.xy(tc);
                let to_placed = wp.project(planet.grid.lat_deg(tcy), planet.grid.lon_deg(tcx));
                let pts: Vec<[f64; 2]> = cells.iter().map(|&c| {
                    let (cx, cy) = planet.grid.xy(c);
                    wp.project(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx))
                }).collect();
                let geo_pts: Vec<[f64; 2]> = cells.iter().map(|&c| {
                    let (cx, cy) = planet.grid.xy(c);
                    [planet.grid.lat_deg(cy), planet.grid.lon_deg(cx)]
                }).collect();
                return StudioResponse::json(build_road_json(
                    placed,
                    to_placed,
                    false,
                    nm,
                    len_km,
                    max_elev * 1000.0,
                    &pts,
                    &geo_pts,
                ));
            }
        }
        StudioResponse::json(build_road_json(placed, placed, false, "", 0.0, planet.erosion.elevation_km[from_cell] * 1000.0, &[], &[]))
    }
}

pub fn serve(cfg: StudioConfig) -> Result<(), String> {
    serve_with_browser(cfg, false)
}

/// Запускает локальный HTTP-сервер студии и при `open_browser = true` открывает UI в системном браузере.
pub fn serve_with_browser(cfg: StudioConfig, open_browser: bool) -> Result<(), String> {
    let addr = format!("{}:{}", cfg.host, cfg.port);
    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(err) if open_browser && cfg.port != 0 => {
            let fallback = format!("{}:0", cfg.host);
            TcpListener::bind(&fallback).map_err(|e| format!("bind {addr} ({err}) and {fallback}: {e}"))?
        }
        Err(err) => return Err(format!("bind {addr}: {err}")),
    };
    let bound_addr = listener.local_addr().map_err(|e| format!("local_addr: {e}"))?;
    let url = format!("http://{bound_addr}");
    let app = Arc::new(StudioApp::new()?);
    println!("Fantasy Map Studio запущена: {url}");
    if open_browser {
        let launch_url = url.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(150));
            open_system_browser(&launch_url);
        });
    }
    for stream in listener.incoming() {
        let Ok(stream) = stream else { continue };
        let app = Arc::clone(&app);
        std::thread::spawn(move || {
            let _ = handle_connection(stream, &app);
        });
    }
    Ok(())
}

fn open_system_browser(url: &str) {
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn();
    }
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open").arg(url).spawn();
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let _ = std::process::Command::new("xdg-open").arg(url).spawn();
    }
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

fn region_road_stats(reg: &Region, cells: &[usize]) -> (f64, f32) {
    let mut len_km = 0.0f64;
    let mut max_elev = f32::NEG_INFINITY;
    for &c in cells {
        max_elev = max_elev.max(reg.elevation_km[c]);
    }
    for w in cells.windows(2) {
        let (ax, ay) = reg.xy(w[0]);
        let (bx, by) = reg.xy(w[1]);
        len_km += ((bx as f64 - ax as f64) * reg.dx_km_row[ay]).hypot((by as f64 - ay as f64) * reg.dy_km);
    }
    (len_km, max_elev)
}

fn world_path_len(planet: &Planet, cells: &[usize]) -> f64 {
    cells.windows(2).map(|w| {
        let (ax, ay) = planet.grid.xy(w[0]);
        let (bx, by) = planet.grid.xy(w[1]);
        planet.grid.spherical_dist_km(planet.grid.unit_vec(ax, ay), planet.grid.unit_vec(bx, by))
    }).sum()
}

fn region_cell_latlon(reg: &Region, span_lon_deg: f64, cell: usize) -> [f64; 2] {
    let (cx, cy) = reg.xy(cell);
    let lat = reg.lat_max_deg - ((cy as f64 + 0.5) / reg.h as f64) * (reg.lat_max_deg - reg.lat_min_deg);
    let lon = reg.center_lon_deg + (((cx as f64 + 0.5) / reg.w as f64) - 0.5) * span_lon_deg;
    [lat, ((lon + 540.0).rem_euclid(360.0) - 180.0)]
}

fn collect_world_waypoints(planet: &Planet, wp: &WorldProj) -> Vec<WaypointDto> {
    let mut out = Vec::new();
    let mut seen_cells = std::collections::HashSet::new();
    let [fx, fy, fw, fh] = wp.frame;
    let in_fr = |p: [f64; 2]| p[0] >= fx + 4.0 && p[0] <= fx + fw - 4.0 && p[1] >= fy + 4.0 && p[1] <= fy + fh - 4.0;

    for s in &planet.civilization.settlements {
        let (cx, cy) = planet.grid.xy(s.cell);
        let (lat, lon) = (planet.grid.lat_deg(cy), planet.grid.lon_deg(cx));
        let p = wp.project(lat, lon);
        if !in_fr(p) { continue; }
        seen_cells.insert(s.cell);
        out.push(WaypointDto {
            id: format!("st_{}", s.id),
            kind: "settlement",
            subkind: match s.tier {
                SettlementTier::Capital => "capital",
                SettlementTier::Metropolis => "metropolis",
                SettlementTier::City => "city",
                SettlementTier::Town => "town",
                SettlementTier::Village => "village",
            },
            name: s.name.clone(),
            subtitle: format!("{} · {}", s.tier.name(), settlement_role_name(s.role)),
            lat,
            lon,
            x: p[0],
            y: p[1],
        });
    }

    for ws in &planet.civilization.wild_sites {
        let (wx, wy) = planet.grid.xy(ws.cell);
        let (lat, lon) = (planet.grid.lat_deg(wy), planet.grid.lon_deg(wx));
        let p = wp.project(lat, lon);
        if !in_fr(p) { continue; }
        seen_cells.insert(ws.cell);
        let (sk, sub) = match ws.kind {
            WildSiteKind::HunterCamp => ("camp", "стоянка охотников"),
            WildSiteKind::Ruins => ("ruins", "древние руины"),
        };
        out.push(WaypointDto {
            id: format!("ws_{}", ws.id),
            kind: "wild",
            subkind: sk,
            name: ws.name.clone(),
            subtitle: sub.to_string(),
            lat,
            lon,
            x: p[0],
            y: p[1],
        });
    }

    let mut try_push = |id: String, kind: &'static str, subkind: &'static str, name: String, subtitle: String, raw_cell: usize| {
        let (cx, cy) = planet.grid.xy(raw_cell);
        let (lat0, lon0) = (planet.grid.lat_deg(cy), planet.grid.lon_deg(cx));
        let Some(c) = snap_world_land_cell(planet, lat0, lon0) else { return; };
        if !seen_cells.insert(c) { return; }
        let (dx, dy) = planet.grid.xy(c);
        let (lat, lon) = (planet.grid.lat_deg(dy), planet.grid.lon_deg(dx));
        let p = wp.project(lat, lon);
        if !in_fr(p) { return; }
        out.push(WaypointDto { id, kind, subkind, name, subtitle, lat, lon, x: p[0], y: p[1] });
    };

    for (idx, rg) in planet.geography.mountain_ranges.iter().take(12).enumerate() {
        let nm = planet.names.mountain_ranges.get(idx).cloned().unwrap_or_else(|| format!("Вершина #{}", idx + 1));
        try_push(format!("geo_peak_{idx}"), "geo", "peak", nm, format!("вершина {:.0} м", rg.max_elevation_km * 1000.0), rg.peak_cell);
    }
    for (idx, ps) in planet.geography.passes.iter().take(12).enumerate() {
        let nm = planet.names.passes.get(idx).cloned().unwrap_or_else(|| format!("Перевал #{}", idx + 1));
        try_push(format!("geo_pass_{idx}"), "geo", "pass", nm, format!("перевал {:.0} м", ps.elevation_km * 1000.0), ps.cell);
    }
    for (idx, lk) in planet.geography.lakes.iter().take(8).enumerate() {
        let nm = planet.names.lakes.get(idx).cloned().unwrap_or_else(|| format!("Озеро #{}", idx + 1));
        try_push(format!("geo_lake_{idx}"), "geo", "lake", nm, "берег озера".into(), lk.center_cell);
    }
    for (idx, ist) in planet.geography.isthmuses.iter().take(6).enumerate() {
        let nm = planet.names.isthmuses.get(idx).cloned().unwrap_or_else(|| format!("Перешеек #{}", idx + 1));
        try_push(format!("geo_isth_{idx}"), "geo", "isthmus", nm, "перешеек".into(), ist.cell);
    }

    let mut wfs: Vec<(usize, &fms_core::hydrology::Waterfall)> = planet.hydrology.waterfalls.iter().enumerate().collect();
    wfs.sort_by(|a, b| b.1.drop_m.total_cmp(&a.1.drop_m));
    for (idx, wf) in wfs.into_iter().take(10) {
        try_push(format!("lm_wf_{idx}"), "landmark", "waterfall", format!("Водопад ({:.0} м)", wf.drop_m), "важное место".into(), wf.cell);
    }
    let mut deps: Vec<(usize, &fms_core::resources::Deposit)> = planet.resources.deposits.iter().enumerate().collect();
    deps.sort_by(|a, b| b.1.richness.total_cmp(&a.1.richness));
    for (idx, dep) in deps.into_iter().take(10) {
        try_push(format!("lm_dep_{idx}"), "landmark", "deposit", dep.kind.name().to_string(), format!("месторождение {:.0}%", dep.richness * 100.0), dep.cell);
    }
    for (o_idx, cell) in planet.hydrology.is_oasis.iter().enumerate().filter_map(|(i, &v)| (v != 0).then_some(i)).take(6).enumerate() {
        try_push(format!("lm_oasis_{o_idx}"), "landmark", "oasis", format!("Оазис #{}", o_idx + 1), "важное место".into(), cell);
    }
    out
}

fn collect_region_waypoints(planet: &Planet, reg: &Region, rp: &RegionProj) -> Vec<WaypointDto> {
    let mut out = Vec::new();
    let mut seen_cells = std::collections::HashSet::new();
    let [fx, fy, fw, fh] = rp.frame;
    let in_fr = |p: [f64; 2]| p[0] >= fx + 4.0 && p[0] <= fx + fw - 4.0 && p[1] >= fy + 4.0 && p[1] <= fy + fh - 4.0;

    for (idx, s) in reg.settlements.iter().enumerate() {
        let p = rp.project_cell(s.x as f64 + 0.5, s.y as f64 + 0.5);
        if !in_fr(p) { continue; }
        let [lat, lon] = region_cell_latlon(reg, rp.span_lon_deg, s.cell);
        seen_cells.insert(s.cell);
        let id = s
            .global_id
            .map(|gid| format!("st_{gid}"))
            .unwrap_or_else(|| format!("rst_{idx}"));
        out.push(WaypointDto {
            id,
            kind: "settlement",
            subkind: match s.tier {
                SettlementTier::Capital => "capital",
                SettlementTier::Metropolis => "metropolis",
                SettlementTier::City => "city",
                SettlementTier::Town => "town",
                SettlementTier::Village => "village",
            },
            name: s.name.clone(),
            subtitle: format!("{} · {}", s.tier.name(), settlement_role_name(s.role)),
            lat,
            lon,
            x: p[0],
            y: p[1],
        });
    }

    for ws in &planet.civilization.wild_sites {
        let (wx, wy) = planet.grid.xy(ws.cell);
        let (lat, lon) = (planet.grid.lat_deg(wy), planet.grid.lon_deg(wx));
        if let Some(p) = rp.project_lat_lon(lat, lon) {
            if in_fr(p) {
                let (sk, sub) = match ws.kind {
                    WildSiteKind::HunterCamp => ("camp", "стоянка охотников"),
                    WildSiteKind::Ruins => ("ruins", "древние руины"),
                };
                out.push(WaypointDto {
                    id: format!("ws_{}", ws.id),
                    kind: "wild",
                    subkind: sk,
                    name: ws.name.clone(),
                    subtitle: sub.to_string(),
                    lat,
                    lon,
                    x: p[0],
                    y: p[1],
                });
            }
        }
    }

    let mut try_push = |id: String, kind: &'static str, subkind: &'static str, name: String, subtitle: String, raw_cell: usize| {
        let [lat0, lon0] = region_cell_latlon(reg, rp.span_lon_deg, raw_cell);
        let Some(c) = snap_region_land_cell(reg, rp.span_lon_deg, lat0, lon0) else { return; };
        if !seen_cells.insert(c) { return; }
        let p = rp.project_cell((c % reg.w) as f64 + 0.5, (c / reg.w) as f64 + 0.5);
        if !in_fr(p) { return; }
        let [lat, lon] = region_cell_latlon(reg, rp.span_lon_deg, c);
        out.push(WaypointDto { id, kind, subkind, name, subtitle, lat, lon, x: p[0], y: p[1] });
    };

    for (idx, ps) in reg.passes.iter().take(12).enumerate() {
        try_push(format!("rgeo_pass_{idx}"), "geo", "pass", format!("Перевал {:.0} м", ps.elevation_km * 1000.0), "горный перевал".into(), ps.cell);
    }
    for (idx, wf) in reg.waterfalls.iter().take(10).enumerate() {
        try_push(format!("rlm_wf_{idx}"), "landmark", "waterfall", format!("Водопад ({:.0} м)", wf.drop_m), "важное место".into(), wf.cell);
    }
    for (idx, dep) in reg.deposits.iter().take(10).enumerate() {
        try_push(format!("rlm_dep_{idx}"), "landmark", "deposit", dep.kind.name().to_string(), format!("месторождение {:.0}%", dep.richness * 100.0), dep.cell);
    }
    for (idx, rg) in planet.geography.mountain_ranges.iter().enumerate() {
        let (rx, ry) = planet.grid.xy(rg.peak_cell);
        let (la, lo) = (planet.grid.lat_deg(ry), planet.grid.lon_deg(rx));
        if let Some(c) = snap_region_land_cell(reg, rp.span_lon_deg, la, lo) {
            let p = rp.project_cell((c % reg.w) as f64 + 0.5, (c / reg.w) as f64 + 0.5);
            if in_fr(p) && seen_cells.insert(c) {
                let nm = planet.names.mountain_ranges.get(idx).cloned().unwrap_or_else(|| "Вершина".into());
                let [lat, lon] = region_cell_latlon(reg, rp.span_lon_deg, c);
                out.push(WaypointDto { id: format!("rgeo_peak_{idx}"), kind: "geo", subkind: "peak", name: nm, subtitle: format!("вершина {:.0} м", rg.max_elevation_km * 1000.0), lat, lon, x: p[0], y: p[1] });
            }
        }
    }
    out
}

fn push_waypoints_json(out: &mut String, wps: &[WaypointDto]) {
    out.push_str(",\"waypoints\":[");
    for (i, w) in wps.iter().enumerate() {
        if i > 0 { out.push(','); }
        out.push_str("{\"id\":");
        push_json_str(out, &w.id);
        out.push_str(",\"kind\":");
        push_json_str(out, w.kind);
        out.push_str(",\"subkind\":");
        push_json_str(out, w.subkind);
        out.push_str(",\"name\":");
        push_json_str(out, &w.name);
        out.push_str(",\"subtitle\":");
        push_json_str(out, &w.subtitle);
        let _ = write!(
            out,
            ",\"lat\":{:.4},\"lon\":{:.4},\"x\":{:.2},\"y\":{:.2}}}",
            w.lat, w.lon, w.x, w.y
        );
    }
    out.push(']');
}

fn build_world_json(wkey: &WorldKey, planet: &Planet, cached: &CachedRender, qs: &str) -> String {
    let sug = choose_region_window(planet);
    let cont_cnt = planet
        .geography
        .landmasses
        .iter()
        .filter(|l| l.kind == LandmassKind::Continent)
        .count();
    let wp = WorldProj::fit(planet, cached.width);
    let waypoints = collect_world_waypoints(planet, &wp);

    let mut out = String::with_capacity(4096);
    let _ = write!(out, "{{\"seed\":");
    push_json_str(&mut out, &wkey.phys.seed);
    let _ = write!(
        out,
        ",\"width\":{},\"height\":{},\"grid_w\":{},\"grid_h\":{},\"continents_count\":{},\"rivers_count\":{},\"waterfalls_count\":{},\"settlements_count\":{},\"realms_count\":{},\"deposits_count\":{},\"px_per_deg_lon\":{:.6},\"proj\":{{\"center_lon\":{:.6},\"px_per_unit\":{:.6},\"origin_x_rad\":{:.8},\"origin_y_pat\":{:.8},\"frame\":[{:.3},{:.3},{:.3},{:.3}]}},\"suggested_region\":{{\"lat\":{:.4},\"lon\":{:.4},\"span\":{:.1}}},\"map_png_url\":",
        cached.width,
        cached.height,
        planet.grid.w,
        planet.grid.h,
        cont_cnt,
        cached.rivers_count,
        planet.hydrology.waterfalls.len(),
        cached.settlements_count,
        planet.civilization.realms.len(),
        planet.resources.deposits.len(),
        wp.px_per_unit * std::f64::consts::PI / 180.0,
        wp.center_lon_deg,
        wp.px_per_unit,
        wp.origin_x_rad,
        wp.origin_y_pat,
        wp.frame[0], wp.frame[1], wp.frame[2], wp.frame[3],
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
    out.push(']');
    push_waypoints_json(&mut out, &waypoints);
    out.push('}');
    out
}

fn build_region_json(planet: &Planet, cached: &CachedRender, qs: &str) -> String {
    let mut out = String::with_capacity(2048);
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
    if let Some(rp) = &cached.reg_proj {
        let _ = write!(
            out,
            ",\"frame\":[{:.3},{:.3},{:.3},{:.3}],\"span_lon_deg\":{:.4}",
            rp.frame[0], rp.frame[1], rp.frame[2], rp.frame[3], rp.span_lon_deg
        );
        if let Some(reg) = &cached.region {
            let wps = collect_region_waypoints(planet, reg, rp);
            push_waypoints_json(&mut out, &wps);
        }
    }
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

fn build_inspect_json(planet: &Planet, lat_deg: f64, lon_deg: f64, settlement_id: Option<u32>) -> String {
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
    let is_wild = planet.civilization.is_wild.get(cell).copied().unwrap_or(0) != 0;
    let wild_reason = if !is_wild {
        ""
    } else if is_ocean {
        "открытое море"
    } else if planet.climate.temp_c[cell] < -4.0 || planet.climate.permafrost[cell] > 0.45 {
        "вечная мерзлота и суровые морозы"
    } else if planet.erosion.elevation_km[cell] > 2.4 {
        "высокогорье и скалистые хребты"
    } else if planet.climate.aridity_index[cell] > 0.72 {
        "засуха и дефицит пресной воды"
    } else if planet.biomes.soil_fertility[cell] < 0.20 {
        "бедные почвы и скудное пропитание"
    } else {
        "отдалённые необжитые просторы"
    };

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
    let mut matched_settlement: Option<&fms_core::civilization::Settlement> =
        settlement_id.and_then(|id| planet.civilization.settlements.get(id as usize));
    for st in &planet.civilization.settlements {
        let (sx, sy) = planet.grid.xy(st.cell);
        let d = planet.grid.spherical_dist_km(u_pt, planet.grid.unit_vec(sx, sy));
        if d < nearest_dist {
            nearest_dist = d;
            nearest_label = format!("{} ({})", st.name, st.tier.name());
            if matched_settlement.is_none() && d <= 45.0 {
                matched_settlement = Some(st);
            }
        }
    }
    if !nearest_dist.is_finite() {
        nearest_dist = 0.0;
    }

    let mut nearest_wild = String::new();
    let mut nearest_wild_dist = f64::INFINITY;
    for ws in &planet.civilization.wild_sites {
        let (wx, wy) = planet.grid.xy(ws.cell);
        let d = planet.grid.spherical_dist_km(u_pt, planet.grid.unit_vec(wx, wy));
        if d < nearest_wild_dist {
            nearest_wild_dist = d;
            let k = match ws.kind {
                WildSiteKind::HunterCamp => "стоянка",
                WildSiteKind::Ruins => "руины",
            };
            nearest_wild = format!("{} ({k})", ws.name);
        }
    }
    if !nearest_wild_dist.is_finite() {
        nearest_wild_dist = 0.0;
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

    let mut nearest_wf_dist = f64::INFINITY;
    let mut nearest_wf_drop = 0.0f32;
    for wf in &planet.hydrology.waterfalls {
        let (wx, wy) = planet.grid.xy(wf.cell);
        let d = planet.grid.spherical_dist_km(u_pt, planet.grid.unit_vec(wx, wy));
        if d < nearest_wf_dist {
            nearest_wf_dist = d;
            nearest_wf_drop = wf.drop_m;
        }
    }
    if !nearest_wf_dist.is_finite() {
        nearest_wf_dist = 0.0;
    }

    let r = &planet.resources;
    let mut out = String::with_capacity(1408);
    let _ = write!(
        out,
        "{{\"in_bounds\":true,\"lat\":{:.4},\"lon\":{:.4},\"is_ocean\":{},\"is_wild\":{},\"is_wadi\":{},\"is_oasis\":{},\"is_delta\":{},\"elevation_m\":{:.1},\"temp_c\":{:.2},\"temp_jan_c\":{:.2},\"temp_jul_c\":{:.2},\"precip_mm\":{:.1},\"aridity_index\":{:.3},\"permafrost\":{:.3},\"soil_fertility\":{:.3},\"discharge_m3s\":{:.1},\"river_order\":{},\"habitability\":{:.3},\"nearest_dist_km\":{:.1},\"nearest_wild_dist_km\":{:.1},\"nearest_deposit_dist_km\":{:.1},\"nearest_deposit_richness\":{:.3},\"nearest_waterfall_dist_km\":{:.1},\"nearest_waterfall_drop_m\":{:.0}",
        lat_deg,
        lon_deg,
        is_ocean,
        is_wild,
        planet.hydrology.is_wadi[cell] != 0,
        planet.hydrology.is_oasis[cell] != 0,
        planet.hydrology.is_delta[cell] != 0,
        elev_m,
        planet.climate.temp_c[cell],
        planet.climate.temp_jan_c[cell],
        planet.climate.temp_jul_c[cell],
        planet.climate.precip_mm[cell],
        planet.climate.aridity_index[cell],
        planet.climate.permafrost[cell],
        planet.biomes.soil_fertility[cell],
        planet.hydrology.discharge_m3s[cell],
        planet.hydrology.river_order[cell],
        planet.civilization.habitability[cell],
        nearest_dist,
        nearest_wild_dist,
        nearest_dep_dist,
        nearest_dep_rich,
        nearest_wf_dist,
        nearest_wf_drop
    );
    out.push_str(",\"wild_reason\":");
    push_json_str(&mut out, wild_reason);
    out.push_str(",\"nearest_wild_site\":");
    push_json_str(&mut out, &nearest_wild);
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
    if let Some(st) = matched_settlement {
        let (sx, sy) = planet.grid.xy(st.cell);
        let slat = planet.grid.lat_deg(sy);
        let slon = planet.grid.lon_deg(sx);
        let s_realm = planet
            .civilization
            .realms
            .get(st.realm_id as usize)
            .map(|rm| rm.name.as_str())
            .unwrap_or("");
        let _ = write!(
            out,
            ",\"settlement\":{{\"id\":{},\"lat\":{:.4},\"lon\":{:.4},\"population_score\":{},\"trade_degree\":{},\"resource_score\":{:.3},\"food_score\":{:.3},\"water_score\":{:.3},\"timber_score\":{:.3},\"mineral_score\":{:.3},\"name\":",
            st.id,
            slat,
            slon,
            st.population_score,
            st.trade_degree,
            st.resource_score,
            st.food_score,
            st.water_score,
            st.timber_score,
            st.mineral_score
        );
        push_json_str(&mut out, &st.name);
        out.push_str(",\"tier\":");
        push_json_str(&mut out, st.tier.name());
        out.push_str(",\"role\":");
        push_json_str(&mut out, settlement_role_name(st.role));
        out.push_str(",\"realm\":");
        push_json_str(&mut out, s_realm);
        out.push('}');
    }
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
    from_placed: [f64; 2],
    to_placed: [f64; 2],
    is_sea: bool,
    target_name: &str,
    length_km: f64,
    max_elev_m: f32,
    pts: &[[f64; 2]],
    geo_pts: &[[f64; 2]],
) -> String {
    let mut out = String::with_capacity(512 + pts.len() * 32);
    let _ = write!(
        out,
        "{{\"ok\":true,\"is_sea\":{is_sea},\"placed\":[{:.2},{:.2}],\"from_placed\":[{:.2},{:.2}],\"to_placed\":[{:.2},{:.2}],\"length_km\":{:.1},\"max_elev_m\":{:.0},\"target_name\":",
        from_placed[0], from_placed[1], from_placed[0], from_placed[1], to_placed[0], to_placed[1], length_km, max_elev_m
    );
    push_json_str(&mut out, target_name);
    out.push_str(",\"pts\":[");
    for (i, p) in pts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[{:.2},{:.2}]", p[0], p[1]);
    }
    out.push_str("],\"geo_pts\":[");
    for (i, g) in geo_pts.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        let _ = write!(out, "[{:.4},{:.4}]", g[0], g[1]);
    }
    out.push_str("]}");
    out
}
