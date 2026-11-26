//! Иллюстрированный картографический рендерер Fantasy Map Studio:
//! спрайтовые горы, леса, города, мосты и роза ветров поверх гладкой подложки `fms-core`,
//! с экспортом в PNG и многослойный SVG.

pub mod assets;
pub mod png;
pub mod proj;
pub mod svg;
pub mod terrain;

pub use assets::AssetPack;
pub use proj::{RegionProj, WorldProj};
pub use terrain::{
    choose_region_window, DepositPin, MapLabel, OverlayModel, OverlayRoute, RenderOptions,
    SettlementPin, Style, WaterfallPin,
};

use fms_core::civilization::SettlementRole;
use fms_core::planet::Planet;
use fms_core::region::{Region, RegionOptions};
use fms_core::resources::ResourceKind;
use fms_core::rng::{Noise, Rng};
use proj::wrap_lon_deg;
use terrain::{
    build_region_grid, build_world_grid, choose_legend_rect, collect_region_labels, collect_world_labels,
    compute_legend_realms, extract_region_anchors, extract_world_anchors, generate_world_ocean_labels,
    paint_terrain_rivers_roads, pick_ocean_hub, rasterize_overlay_finish, stamp_all_assets, trace_ocean_currents,
};

/// Результат рендеринга: базовый растр (для интерактивных слоёв SVG), аннотации и экспорт в PNG/SVG.
pub struct RenderOutput {
    pub width: usize,
    pub height: usize,
    pub style: Style,
    /// Чистый растр ландшафта, рек, дорог и спрайтов (без векторных слоёв поверх).
    pub base_rgb: Vec<u8>,
    /// Итоговый растр с наложенными течениями, рамкой и розой ветров.
    pub flat_rgb: Vec<u8>,
    pub overlay: OverlayModel,
}

impl RenderOutput {
    /// Кодирует итоговый растр с рамкой и розой ветров в PNG.
    pub fn to_png_bytes(&self) -> Vec<u8> {
        png::encode_png_rgb(self.width, self.height, &self.flat_rgb)
    }

    /// Кодирует чистую растровую подложку (для использования как подложка под интерактивный SVG) в PNG.
    pub fn to_base_png_bytes(&self) -> Vec<u8> {
        png::encode_png_rgb(self.width, self.height, &self.base_rgb)
    }

    /// Сохраняет итоговый PNG-файл на диск.
    pub fn write_png(&self, path: &str) -> std::io::Result<()> {
        png::write_png_rgb(path, self.width, self.height, &self.flat_rgb)
    }

    /// Собирает полностью автономный SVG со встроенным PNG и всеми векторными слоями.
    pub fn to_svg_standalone(&self, pack: &AssetPack) -> String {
        svg::render_svg(&self.base_rgb, &self.overlay, pack, true, None)
    }

    /// Собирает облегчённый интерактивный SVG со ссылкой `image_href` на внешний растр.
    pub fn to_svg_with_image_href(&self, pack: &AssetPack, image_href: &str) -> String {
        svg::render_svg(&self.base_rgb, &self.overlay, pack, false, Some(image_href))
    }

    /// Сохраняет автономный SVG-файл на диск.
    pub fn write_svg_standalone(&self, path: &str, pack: &AssetPack) -> std::io::Result<()> {
        let doc = self.to_svg_standalone(pack);
        png::write_svg_file(path, &doc)
    }
}

fn deposit_kind_meta(kind: ResourceKind) -> (&'static str, &'static str) {
    let slug = match kind {
        ResourceKind::Iron => "iron",
        ResourceKind::CopperGold => "copper",
        ResourceKind::GemsRare => "gems",
        ResourceKind::Coal => "coal",
        ResourceKind::Hydrocarbons => "oil",
        ResourceKind::Salt => "salt",
        ResourceKind::Timber => "timber",
        ResourceKind::Fishery => "fish",
    };
    (slug, kind.name())
}

/// Рендерит карту мира с настройками по умолчанию (`Style::Expedition`, ширина 2200 px).
pub fn render_world(planet: &Planet, seed: &str, style: Style) -> Result<RenderOutput, String> {
    let pack = AssetPack::load_default()?;
    let opt = RenderOptions {
        style,
        ..Default::default()
    };
    Ok(render_world_with_options(planet, seed, &pack, &opt))
}

fn append_delta_branches(rivers_out: &mut Vec<Vec<[f64; 3]>>, seg: &[[f64; 3]], spread_px: f64) {
    let n = seg.len();
    if n < 4 {
        return;
    }
    let split = n.saturating_sub(4);
    let p_start = seg[split];
    let p_end = seg[n - 1];
    let dx = p_end[0] - p_start[0];
    let dy = p_end[1] - p_start[1];
    let len = dx.hypot(dy);
    if len < 1.5 || len > spread_px * 18.0 {
        return;
    }
    let nx = -dy / len;
    let ny = dx / len;
    for sign in [-1.0f64, 1.0] {
        let mut branch = Vec::with_capacity(n - split);
        for (k, pt) in seg[split..].iter().enumerate() {
            let t = k as f64 / (n - 1 - split).max(1) as f64;
            let off = sign * spread_px * t.powf(1.15);
            branch.push([pt[0] + nx * off, pt[1] + ny * off, (pt[2] * 0.56).max(0.42)]);
        }
        rivers_out.push(branch);
    }
}

/// Рендерит карту мира в изотропной цилиндрической проекции Паттерсона с указанным паком ассетов.
pub fn render_world_with_options(planet: &Planet, seed: &str, pack: &AssetPack, opt: &RenderOptions) -> RenderOutput {
    let sketch_pack;
    let pack = if opt.style == Style::Sketch {
        sketch_pack = pack.sketch_variant();
        &sketch_pack
    } else {
        pack
    };
    let mut rng_n = Rng::sub(seed, "art-render");
    let noise = Noise::new(&mut rng_n);
    let proj = WorldProj::fit(planet, opt.target_width.clamp(320, 4096));
    let wg = build_world_grid(planet, &proj, &noise);

    let gw = planet.grid.w as f64;
    let gh = planet.grid.h as f64;
    let mut w_rivers = Vec::new();
    for riv in &planet.hydrology.rivers {
        if riv.smoothed_pts.len() < 2 || riv.max_discharge_m3s < 650.0 {
            continue;
        }
        let has_delta = riv.cells.len() >= 2 && planet.hydrology.is_delta[riv.cells[riv.cells.len() - 2]] != 0;
        let mut cur = Vec::new();
        let mut prev_dlon: Option<f64> = None;
        for (idx, pt) in riv.smoothed_pts.iter().enumerate() {
            let lon = wrap_lon_deg(((pt[0] as f64 / gw) - 0.5) * 360.0);
            let lat = 90.0 - (pt[1] as f64 / gh) * 180.0;
            let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
            let pr = proj.project(lat, lon);
            let wid = riv.widths.get(idx).copied().unwrap_or(0.6) as f64;
            if let Some(pd) = prev_dlon {
                if (dlon - pd).abs() > 120.0 {
                    if cur.len() >= 2 {
                        w_rivers.push(std::mem::take(&mut cur));
                    } else {
                        cur.clear();
                    }
                }
            }
            cur.push([pr[0], pr[1], wid]);
            prev_dlon = Some(dlon);
        }
        if cur.len() >= 2 {
            if has_delta {
                append_delta_branches(&mut w_rivers, &cur, 4.2 * wg.ui_scale);
            }
            w_rivers.push(cur);
        }
    }

    let mut w_wadis: Vec<Vec<[f64; 2]>> = Vec::new();
    {
        let n_cells = planet.grid.len();
        let mut in_wadi = vec![0u8; n_cells];
        for c in 0..n_cells {
            if planet.hydrology.is_wadi[c] == 0 {
                continue;
            }
            let r = planet.hydrology.receiver[c];
            if r >= 0 && planet.hydrology.is_wadi[r as usize] != 0 {
                in_wadi[r as usize] = 1;
            }
        }
        let mut vis_w = vec![0u8; n_cells];
        for start in 0..n_cells {
            if planet.hydrology.is_wadi[start] == 0 || in_wadi[start] != 0 {
                continue;
            }
            let mut chain = Vec::new();
            let mut prev_dlon: Option<f64> = None;
            let mut cur_c = start;
            for _ in 0..64 {
                let (cx, cy) = planet.grid.xy(cur_c);
                let lat = planet.grid.lat_deg(cy);
                let lon = planet.grid.lon_deg(cx);
                let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
                if let Some(pd) = prev_dlon {
                    if (dlon - pd).abs() > 120.0 {
                        if chain.len() >= 2 {
                            w_wadis.push(std::mem::take(&mut chain));
                        } else {
                            chain.clear();
                        }
                    }
                }
                chain.push(proj.project(lat, lon));
                prev_dlon = Some(dlon);
                if vis_w[cur_c] != 0 {
                    break;
                }
                vis_w[cur_c] = 1;
                let r = planet.hydrology.receiver[cur_c];
                if r < 0 || planet.hydrology.is_ocean[r as usize] != 0 {
                    break;
                }
                let ru = r as usize;
                if planet.hydrology.is_wadi[ru] == 0 {
                    let (rx, ry) = planet.grid.xy(ru);
                    let rlon = planet.grid.lon_deg(rx);
                    if (wrap_lon_deg(rlon - proj.center_lon_deg) - dlon).abs() <= 120.0 {
                        chain.push(proj.project(planet.grid.lat_deg(ry), rlon));
                    }
                    break;
                }
                cur_c = ru;
            }
            if chain.len() >= 2 {
                w_wadis.push(chain);
            }
        }
    }
    let w_oases: Vec<[f64; 2]> = (0..planet.grid.len())
        .filter(|&i| planet.hydrology.is_oasis[i] != 0)
        .map(|i| {
            let (ox, oy) = planet.grid.xy(i);
            proj.project(planet.grid.lat_deg(oy), planet.grid.lon_deg(ox))
        })
        .collect();

    let mut w_routes = Vec::new();
    let mut w_land_roads = Vec::new();
    for tr in &planet.civilization.trade_routes {
        let mut cur = Vec::new();
        let mut cur_sea = false;
        let mut prev_dlon: Option<f64> = None;
        for &c in &tr.cells {
            let (cx, cy) = planet.grid.xy(c);
            let lat = planet.grid.lat_deg(cy);
            let lon = planet.grid.lon_deg(cx);
            let dlon = wrap_lon_deg(lon - proj.center_lon_deg);
            let pr = proj.project(lat, lon);
            let is_sea = planet.hydrology.is_ocean[c] != 0 || planet.hydrology.is_lake[c] != 0;
            if let Some(pd) = prev_dlon {
                let jump = (dlon - pd).abs() > 120.0;
                if jump || is_sea != cur_sea {
                    let lp = if !jump { cur.last().copied() } else { None };
                    if cur.len() >= 2 {
                        if !cur_sea {
                            w_land_roads.push(cur.clone());
                        }
                        w_routes.push(OverlayRoute {
                            is_sea: cur_sea,
                            pts: std::mem::take(&mut cur),
                        });
                    } else {
                        cur.clear();
                    }
                    if let Some(p) = lp {
                        cur.push(p);
                    }
                }
            }
            cur_sea = is_sea;
            cur.push(pr);
            prev_dlon = Some(dlon);
        }
        if cur.len() >= 2 {
            if !cur_sea {
                w_land_roads.push(cur.clone());
            }
            w_routes.push(OverlayRoute {
                is_sea: cur_sea,
                pts: cur,
            });
        }
    }

    let settlements: Vec<SettlementPin> = planet
        .civilization
        .settlements
        .iter()
        .map(|s| {
            let (sx, sy) = planet.grid.xy(s.cell);
            let pr = proj.project(planet.grid.lat_deg(sy), planet.grid.lon_deg(sx));
            let kind = match s.role {
                SettlementRole::Capital => "capital",
                SettlementRole::Port => "port",
                SettlementRole::PassFortress => "pass",
                _ => "town",
            };
            SettlementPin {
                name: s.name.clone(),
                x: pr[0],
                y: pr[1],
                kind,
                score: s.population_score as f64,
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
            let (kind, label) = deposit_kind_meta(d.kind);
            DepositPin {
                x: pr[0],
                y: pr[1],
                kind,
                label,
                richness: d.richness,
            }
        })
        .collect();
    let waterfalls: Vec<WaterfallPin> = planet
        .hydrology
        .waterfalls
        .iter()
        .map(|wf| {
            let (wx, wy) = planet.grid.xy(wf.cell);
            let pr = proj.project(planet.grid.lat_deg(wy), planet.grid.lon_deg(wx));
            WaterfallPin {
                x: pr[0],
                y: pr[1],
                drop_m: wf.drop_m,
                discharge_m3s: wf.discharge_m3s,
            }
        })
        .collect();
    let sett_pos: Vec<(f64, f64, SettlementRole, f64)> = planet
        .civilization
        .settlements
        .iter()
        .zip(settlements.iter())
        .map(|(s, pin)| (pin.x, pin.y, s.role, pin.score))
        .collect();
    let (w_peaks, w_forests, w_hills) = extract_world_anchors(planet, &wg, &proj);

    let (mut base_rgb, r_dist, rd_dist, bridges) = paint_terrain_rivers_roads(
        &wg,
        opt.style,
        &pack.paper_tex,
        &w_rivers,
        &w_wadis,
        &w_oases,
        &w_land_roads,
    );
    stamp_all_assets(
        &mut base_rgb,
        &wg,
        pack,
        opt.style,
        &r_dist,
        &rd_dist,
        &bridges,
        &w_forests,
        &w_peaks,
        &w_hills,
        &sett_pos,
    );

    let mut graticule = Vec::new();
    let lon_start = wrap_lon_deg(proj.center_lon_deg - 180.0 + 0.01);
    for lat_i in [-60.0f64, -30.0, 0.0, 30.0, 60.0] {
        graticule.push(
            (0..=72)
                .map(|s| proj.project(lat_i, wrap_lon_deg(lon_start + (s as f64 / 72.0) * 359.98)))
                .collect(),
        );
    }
    for step in -5..=5 {
        let lon = wrap_lon_deg(proj.center_lon_deg + step as f64 * 30.0);
        graticule.push((0..=36).map(|s| proj.project(-90.0 + (s as f64 / 36.0) * 180.0, lon)).collect());
    }

    let currents = if opt.style == Style::Sketch {
        Vec::new()
    } else {
        trace_ocean_currents(planet, &wg, |px, py| proj.inverse(px, py))
    };
    let legend_rect = choose_legend_rect(&wg, true, opt.style);
    let legend_realms = if opt.style == Style::Sketch {
        Vec::new()
    } else {
        compute_legend_realms(planet, &wg, 6)
    };
    let hubs = pick_ocean_hub(&wg, true);
    let mut labels = collect_world_labels(planet, &wg, &proj);
    labels.extend(generate_world_ocean_labels(seed, &wg, legend_rect, &hubs));
    labels.sort_by(|a, b| b.prio.total_cmp(&a.prio));

    let subtitle = format!(
        "Сид «{}» · прямоугольная без искажений (шов {:.0}°) · суша {:.0}% · держав: {}",
        seed,
        proj.seam_lon_deg,
        planet.tectonic.stats.land_fraction * 100.0,
        planet.civilization.realms.len()
    );
    let overlay = OverlayModel {
        width: wg.w,
        height: wg.h,
        is_world: true,
        style: opt.style,
        title: opt.title.clone().unwrap_or_else(|| opt.style.title().to_uppercase()),
        frame: wg.frame,
        subtitle,
        graticule,
        routes: w_routes,
        settlements,
        deposits,
        waterfalls,
        labels,
        currents,
        legend_realms: legend_realms
            .into_iter()
            .map(|(n, c)| (n, [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0]))
            .collect(),
        legend_rect,
        seam_lon_deg: proj.seam_lon_deg,
        center_lon_deg: proj.center_lon_deg,
    };
    let flat_rgb = rasterize_overlay_finish(&base_rgb, &overlay, pack);
    RenderOutput {
        width: wg.w,
        height: wg.h,
        style: opt.style,
        base_rgb,
        flat_rgb,
        overlay,
    }
}

/// Рендерит региональный масштаб с настройками по умолчанию (`target_width = 1680`).
pub fn render_region(
    planet: &Planet,
    reg: &Region,
    reg_opt: &RegionOptions,
    seed: &str,
    style: Style,
) -> Result<RenderOutput, String> {
    let pack = AssetPack::load_default()?;
    let opt = RenderOptions {
        style,
        target_width: 1680,
        title: None,
    };
    Ok(render_region_with_options(planet, reg, reg_opt, seed, &pack, &opt))
}

/// Рендерит детальный региональный лист (гидрология, леса, горы, города и течения).
pub fn render_region_with_options(
    planet: &Planet,
    reg: &Region,
    reg_opt: &RegionOptions,
    seed: &str,
    pack: &AssetPack,
    opt: &RenderOptions,
) -> RenderOutput {
    let sketch_pack;
    let pack = if opt.style == Style::Sketch {
        sketch_pack = pack.sketch_variant();
        &sketch_pack
    } else {
        pack
    };
    let mut rng_n = Rng::sub(seed, "art-render");
    let noise = Noise::new(&mut rng_n);
    let proj = RegionProj::new(reg, reg_opt, opt.target_width.clamp(320, 4096));
    let rg = build_region_grid(planet, reg, &proj, &noise);

    let mut kept_rivers: Vec<&fms_core::hydrology::River> = reg
        .rivers
        .iter()
        .filter(|riv| {
            riv.max_discharge_m3s >= 420.0
                && (riv.length_km >= 55.0 || riv.max_discharge_m3s >= 1100.0 || riv.order >= 3)
        })
        .collect();
    if kept_rivers.len() < 12 {
        let mut fallback: Vec<&fms_core::hydrology::River> = reg
            .rivers
            .iter()
            .filter(|riv| riv.length_km >= 35.0 || riv.max_discharge_m3s >= 220.0 || riv.order >= 2)
            .collect();
        fallback.sort_by(|a, b| b.max_discharge_m3s.total_cmp(&a.max_discharge_m3s));
        fallback.truncate(32);
        kept_rivers = fallback;
    }
    let mut r_rivers: Vec<Vec<[f64; 3]>> = Vec::with_capacity(kept_rivers.len() + 4);
    for riv in &kept_rivers {
        let seg: Vec<[f64; 3]> = riv
            .smoothed_pts
            .iter()
            .enumerate()
            .map(|(pi, pt)| {
                let pr = proj.project_cell(pt[0] as f64, pt[1] as f64);
                [pr[0], pr[1], riv.widths.get(pi).copied().unwrap_or(0.6) as f64]
            })
            .collect();
        let has_delta = riv.cells.len() >= 2 && reg.is_delta[riv.cells[riv.cells.len() - 2]] != 0;
        if has_delta {
            append_delta_branches(&mut r_rivers, &seg, 6.2 * rg.ui_scale);
        }
        r_rivers.push(seg);
    }

    let mut r_wadis: Vec<Vec<[f64; 2]>> = Vec::new();
    {
        let rn = reg.w * reg.h;
        let mut in_wadi = vec![0u8; rn];
        for c in 0..rn {
            if reg.is_wadi[c] == 0 {
                continue;
            }
            let r = reg.receiver[c];
            if r >= 0 && reg.is_wadi[r as usize] != 0 {
                in_wadi[r as usize] = 1;
            }
        }
        let mut vis_w = vec![0u8; rn];
        for start in 0..rn {
            if reg.is_wadi[start] == 0 || in_wadi[start] != 0 {
                continue;
            }
            let mut chain = Vec::new();
            let mut cur_c = start;
            for _ in 0..128 {
                let (cx, cy) = reg.xy(cur_c);
                chain.push(proj.project_cell(cx as f64 + 0.5, cy as f64 + 0.5));
                if vis_w[cur_c] != 0 {
                    break;
                }
                vis_w[cur_c] = 1;
                let r = reg.receiver[cur_c];
                if r < 0 || reg.is_ocean[r as usize] != 0 {
                    break;
                }
                let ru = r as usize;
                if reg.is_wadi[ru] == 0 {
                    let (rx, ry) = reg.xy(ru);
                    chain.push(proj.project_cell(rx as f64 + 0.5, ry as f64 + 0.5));
                    break;
                }
                cur_c = ru;
            }
            if chain.len() >= 2 {
                r_wadis.push(chain);
            }
        }
    }
    let r_oases: Vec<[f64; 2]> = (0..(reg.w * reg.h))
        .filter(|&i| reg.is_oasis[i] != 0)
        .map(|i| {
            let (ox, oy) = reg.xy(i);
            proj.project_cell(ox as f64 + 0.5, oy as f64 + 0.5)
        })
        .collect();

    let mut r_routes = Vec::new();
    let mut r_land_roads = Vec::new();
    for rd in &reg.roads {
        if rd.pts.len() < 2 {
            continue;
        }
        let pts: Vec<[f64; 2]> = rd
            .pts
            .iter()
            .map(|pt| proj.project_cell(pt[0] as f64, pt[1] as f64))
            .collect();
        r_land_roads.push(pts.clone());
        r_routes.push(OverlayRoute { is_sea: false, pts });
    }
    for tr in &planet.civilization.trade_routes {
        let mut cur = Vec::new();
        for &c in &tr.cells {
            let (cx, cy) = planet.grid.xy(c);
            let is_sea = planet.hydrology.is_ocean[c] != 0 || planet.hydrology.is_lake[c] != 0;
            if !is_sea {
                if cur.len() >= 2 {
                    r_routes.push(OverlayRoute {
                        is_sea: true,
                        pts: std::mem::take(&mut cur),
                    });
                } else {
                    cur.clear();
                }
                continue;
            }
            if let Some(pr) = proj.project_lat_lon(planet.grid.lat_deg(cy), planet.grid.lon_deg(cx)) {
                cur.push(pr);
            } else if cur.len() >= 2 {
                r_routes.push(OverlayRoute {
                    is_sea: true,
                    pts: std::mem::take(&mut cur),
                });
            } else {
                cur.clear();
            }
        }
        if cur.len() >= 2 {
            r_routes.push(OverlayRoute {
                is_sea: true,
                pts: cur,
            });
        }
    }

    let mut settlements = Vec::new();
    let mut sett_pos = Vec::new();
    for s in &reg.settlements {
        let pr = proj.project_cell(s.x as f64 + 0.5, s.y as f64 + 0.5);
        let score = s
            .global_id
            .and_then(|gid| planet.civilization.settlements.get(gid as usize))
            .map(|gs| gs.population_score as f64)
            .unwrap_or(50.0);
        let kind = match s.role {
            SettlementRole::Capital => "capital",
            SettlementRole::Port => "port",
            SettlementRole::PassFortress => "pass",
            _ => "town",
        };
        settlements.push(SettlementPin {
            name: s.name.clone(),
            x: pr[0],
            y: pr[1],
            kind,
            score,
        });
        sett_pos.push((pr[0], pr[1], s.role, score));
    }
    let deposits: Vec<DepositPin> = reg
        .deposits
        .iter()
        .map(|d| {
            let pr = proj.project_cell(d.x as f64 + 0.5, d.y as f64 + 0.5);
            let (kind, label) = deposit_kind_meta(d.kind);
            DepositPin {
                x: pr[0],
                y: pr[1],
                kind,
                label,
                richness: d.richness,
            }
        })
        .collect();

    let waterfalls: Vec<WaterfallPin> = reg
        .waterfalls
        .iter()
        .map(|wf| {
            let (wx, wy) = reg.xy(wf.cell);
            let pr = proj.project_cell(wx as f64 + 0.5, wy as f64 + 0.5);
            WaterfallPin {
                x: pr[0],
                y: pr[1],
                drop_m: wf.drop_m,
                discharge_m3s: wf.discharge_m3s,
            }
        })
        .collect();

    let (r_peaks, r_forests, r_hills) = extract_region_anchors(reg, &rg, &proj, terrain::plains_shift_km(planet));
    let (mut base_rgb, r_dist, rd_dist, bridges) = paint_terrain_rivers_roads(
        &rg,
        opt.style,
        &pack.paper_tex,
        &r_rivers,
        &r_wadis,
        &r_oases,
        &r_land_roads,
    );
    stamp_all_assets(
        &mut base_rgb,
        &rg,
        pack,
        opt.style,
        &r_dist,
        &rd_dist,
        &bridges,
        &r_forests,
        &r_peaks,
        &r_hills,
        &sett_pos,
    );

    let [fx0, fy0, fw, fh] = proj.frame;
    let mut graticule = Vec::new();
    let mut lat = (reg.lat_min_deg / 5.0).ceil() as i32 * 5;
    while lat <= (reg.lat_max_deg / 5.0).floor() as i32 * 5 {
        let fy = (reg.lat_max_deg - lat as f64) / (reg.lat_max_deg - reg.lat_min_deg).max(1e-9);
        graticule.push(vec![[fx0, fy0 + fy * fh], [fx0 + fw, fy0 + fy * fh]]);
        lat += 5;
    }
    let mut cur_lon = (reg.lon_min_deg / 5.0).ceil() * 5.0;
    while cur_lon <= reg.lon_min_deg + proj.span_lon_deg {
        let x = fx0 + ((cur_lon - reg.lon_min_deg) / proj.span_lon_deg) * fw;
        graticule.push(vec![[x, fy0], [x, fy0 + fh]]);
        cur_lon += 5.0;
    }

    let currents = if opt.style == Style::Sketch {
        Vec::new()
    } else {
        trace_ocean_currents(planet, &rg, |px, py| proj.inverse(px, py))
    };
    let legend_rect = choose_legend_rect(&rg, false, opt.style);
    let legend_realms = if opt.style == Style::Sketch {
        Vec::new()
    } else {
        compute_legend_realms(planet, &rg, 3)
    };
    let mut labels = collect_region_labels(planet, &rg, &proj);
    labels.sort_by(|a, b| b.prio.total_cmp(&a.prio));

    let ns = if reg.center_lat_deg >= 0.0 { "с.ш." } else { "ю.ш." };
    let ew = if reg.center_lon_deg >= 0.0 { "в.д." } else { "з.д." };
    let subtitle = format!(
        "Региональный масштаб {}× · центр {:.1}° {}, {:.1}° {} · детальных рек: {}",
        reg_opt.scale,
        reg.center_lat_deg.abs(),
        ns,
        reg.center_lon_deg.abs(),
        ew,
        kept_rivers.len()
    );
    let overlay = OverlayModel {
        width: rg.w,
        height: rg.h,
        is_world: false,
        style: opt.style,
        title: opt.title.clone().unwrap_or_else(|| opt.style.title().to_uppercase()),
        frame: rg.frame,
        subtitle,
        graticule,
        routes: r_routes,
        settlements,
        deposits,
        waterfalls,
        labels,
        currents,
        legend_realms: legend_realms
            .into_iter()
            .map(|(n, c)| (n, [c[0] / 255.0, c[1] / 255.0, c[2] / 255.0]))
            .collect(),
        legend_rect,
        seam_lon_deg: 0.0,
        center_lon_deg: reg.center_lon_deg,
    };
    let flat_rgb = rasterize_overlay_finish(&base_rgb, &overlay, pack);
    RenderOutput {
        width: rg.w,
        height: rg.h,
        style: opt.style,
        base_rgb,
        flat_rgb,
        overlay,
    }
}
