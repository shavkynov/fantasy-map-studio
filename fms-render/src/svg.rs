//! Многослойный SVG-рендерер атласа: океанические течения, сетка, морские пути, свитки,
//! дуговые названия океанов, антиколлизионные подписи, роза ветров и карточка легенды.

use crate::assets::AssetPack;
use crate::png::{base64_encode, encode_png_rgb, encode_png_rgba};
use crate::terrain::{OverlayModel, Style};
use std::fmt::Write as _;

#[derive(Clone, Copy)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

impl Rect {
    fn inset(self, dx: f64, dy: f64) -> Self {
        Self {
            x: self.x + dx,
            y: self.y + dy,
            w: (self.w - 2.0 * dx).max(0.0),
            h: (self.h - 2.0 * dy).max(0.0),
        }
    }

    fn contains_rect(self, o: Self) -> bool {
        o.x >= self.x && o.y >= self.y && o.x + o.w <= self.x + self.w && o.y + o.h <= self.y + self.h
    }

    fn contains_pt(self, x: f64, y: f64) -> bool {
        x >= self.x && y >= self.y && x <= self.x + self.w && y <= self.y + self.h
    }

    fn intersects(self, o: Self) -> bool {
        self.x < o.x + o.w && self.x + self.w > o.x && self.y < o.y + o.h && self.y + self.h > o.y
    }
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

struct SvgTheme {
    font_serif: &'static str,
    frame_outer: &'static str,
    frame_gold: &'static str,
    grat_col: &'static str,
    sea_lane: &'static str,
    header_col: &'static str,
    sub_col: &'static str,
    text_continent: &'static str,
    text_realm: &'static str,
    text_land: &'static str,
    text_water: &'static str,
    text_muted: &'static str,
    halo_land: &'static str,
    halo_water: &'static str,
    banner_lit: &'static str,
    banner_edge: &'static str,
    banner_tail: &'static str,
    banner_ink: &'static str,
    rose_accent: &'static str,
}

fn theme_of(style: Style) -> SvgTheme {
    match style {
        Style::Expedition => SvgTheme {
            font_serif: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
            frame_outer: "#33291f",
            frame_gold: "#8f7047",
            grat_col: "rgba(71,61,51,0.14)",
            sea_lane: "rgba(51,66,74,0.56)",
            header_col: "#2e2117",
            sub_col: "#574736",
            text_continent: "#2b2117",
            text_realm: "#85241c",
            text_land: "#261c12",
            text_water: "#244761",
            text_muted: "#3d3024",
            halo_land: "rgba(232,224,201,0.92)",
            halo_water: "rgba(194,189,171,0.84)",
            banner_lit: "#f0e3c4",
            banner_edge: "#ccb88a",
            banner_tail: "#99855c",
            banner_ink: "#2b1c0f",
            rose_accent: "#a83629",
        },
        Style::Ink => SvgTheme {
            font_serif: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
            frame_outer: "#181818",
            frame_gold: "#4a4a4a",
            grat_col: "rgba(24,24,24,0.12)",
            sea_lane: "rgba(24,24,24,0.62)",
            header_col: "#141414",
            sub_col: "#3c3c3c",
            text_continent: "#141414",
            text_realm: "#2a2a2a",
            text_land: "#141414",
            text_water: "#2a2a2a",
            text_muted: "#303030",
            halo_land: "rgba(250,250,250,0.92)",
            halo_water: "rgba(250,250,250,0.88)",
            banner_lit: "#f6f6f6",
            banner_edge: "#9a9a9a",
            banner_tail: "#6a6a6a",
            banner_ink: "#141414",
            rose_accent: "#2a2a2a",
        },
        Style::Painted => SvgTheme {
            font_serif: "Palatino, 'Palatino Linotype', 'Book Antiqua', Georgia, serif",
            frame_outer: "#1f140d",
            frame_gold: "#c79942",
            grat_col: "rgba(219,204,163,0.10)",
            sea_lane: "rgba(219,235,230,0.44)",
            header_col: "#f5e6b8",
            sub_col: "#d6c294",
            text_continent: "#f5ebc7",
            text_realm: "#fae0a3",
            text_land: "#faf5e0",
            text_water: "#d6f2fa",
            text_muted: "#f0e6c2",
            halo_land: "rgba(26,20,13,0.80)",
            halo_water: "rgba(18,36,51,0.82)",
            banner_lit: "#f2e0b3",
            banner_edge: "#c9a870",
            banner_tail: "#997a4d",
            banner_ink: "#291a0d",
            rose_accent: "#cc3829",
        },
    }
}

fn current_rgba_str(t: f64, scale: f64) -> String {
    let neutral = (69.0, 61.0, 54.0, 0.56);
    let (r, g, b, a) = if t >= 0.0 {
        let u = (t / scale).min(1.0);
        let warm = (168.0, 59.0, 46.0, 0.78);
        (
            neutral.0 + (warm.0 - neutral.0) * u,
            neutral.1 + (warm.1 - neutral.1) * u,
            neutral.2 + (warm.2 - neutral.2) * u,
            neutral.3 + (warm.3 - neutral.3) * u,
        )
    } else {
        let u = (-t / scale).min(1.0);
        let cold = (43.0, 97.0, 143.0, 0.78);
        (
            neutral.0 + (cold.0 - neutral.0) * u,
            neutral.1 + (cold.1 - neutral.1) * u,
            neutral.2 + (cold.2 - neutral.2) * u,
            neutral.3 + (cold.3 - neutral.3) * u,
        )
    };
    format!("rgba({},{},{},{:.2})", r.round() as u8, g.round() as u8, b.round() as u8, a)
}

#[inline]
fn approx_text_size(text: &str, font_size: f64, tracking: f64) -> (f64, f64) {
    let chars = text.chars().count().max(1) as f64;
    let w = chars * (font_size * 0.56) + (chars - 1.0).max(0.0) * tracking;
    let h = font_size * 1.15;
    (w, h)
}

fn append_scroll_banner(s: &mut String, rect: Rect, th: &SvgTheme) {
    let x0 = rect.x + 6.0;
    let x1 = rect.x + rect.w - 6.0;
    let y0 = rect.y;
    let y1 = rect.y + rect.h;
    let mx = rect.x + rect.w * 0.5;
    let my = (y0 + y1) * 0.5;
    let arch = (rect.h * 0.12).min(2.8);

    let _ = writeln!(
        s,
        r#"<g filter="url(#fmsShadow)">
<path d="M{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} Z" fill="{}" stroke="{}" stroke-width="1.0"/>
<path d="M{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} L{:.1},{:.1} Z" fill="{}" stroke="{}" stroke-width="1.0"/>
<path d="M{:.1},{:.1} Q{:.1},{:.1} {:.1},{:.1} L{:.1},{:.1} Q{:.1},{:.1} {:.1},{:.1} Z" fill="url(#fmsBannerGrad)" stroke="{}" stroke-width="1.15"/>
</g>"#,
        x0 + 4.0,
        y1 - 2.0,
        x0 - 9.0,
        y1 + 2.0,
        x0 - 4.5,
        my + 2.0,
        x0 - 9.5,
        y0 + 4.0,
        x0 + 4.0,
        y0 + 1.5,
        th.banner_tail,
        th.banner_ink,
        x1 - 4.0,
        y1 - 2.0,
        x1 + 9.0,
        y1 + 2.0,
        x1 + 4.5,
        my + 2.0,
        x1 + 9.5,
        y0 + 4.0,
        x1 - 4.0,
        y0 + 1.5,
        th.banner_tail,
        th.banner_ink,
        x0,
        y1,
        mx,
        y1 - arch,
        x1,
        y1,
        x1 + 2.0,
        y0,
        mx,
        y0 - arch,
        x0 - 2.0,
        y0,
        th.banner_ink
    );
}

/// Генерирует многослойный SVG-документ поверх базового растра.
pub fn render_svg(
    base_rgb: &[u8],
    ov: &OverlayModel,
    pack: &AssetPack,
    embed_png_inline: bool,
    image_href: Option<&str>,
) -> String {
    if ov.style == Style::Ink {
        let ink_pack = pack.ink_variant();
        let raw = render_svg_impl(base_rgb, ov, &ink_pack, embed_png_inline, image_href);
        return crate::ink::grayscale_svg(&raw);
    }
    render_svg_impl(base_rgb, ov, pack, embed_png_inline, image_href)
}

fn render_svg_impl(
    base_rgb: &[u8],
    ov: &OverlayModel,
    pack: &AssetPack,
    embed_png_inline: bool,
    image_href: Option<&str>,
) -> String {
    let w = ov.width;
    let h = ov.height;
    let th = theme_of(ov.style);
    let fr = Rect {
        x: ov.frame[0],
        y: ov.frame[1],
        w: ov.frame[2],
        h: ov.frame[3],
    };
    let us = (w as f64 / if ov.is_world { 2200.0 } else { 1680.0 }).clamp(0.32, 1.5);
    let rose_cx = fr.x + fr.w - 66.0 * us;
    let rose_cy = fr.y + fr.h - 68.0 * us;
    let rose_sz = (if ov.is_world { 78.0 } else { 70.0 }) * us;
    let rose_r = rose_sz * 0.5;

    let mut s = String::with_capacity(64 * 1024);
    let _ = writeln!(
        s,
        r##"<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 {w} {h}" width="{w}" height="{h}">
<defs>
  <clipPath id="fmsFrameClip"><rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}"/></clipPath>
  <linearGradient id="fmsBannerGrad" x1="0%" y1="0%" x2="100%" y2="0%">
    <stop offset="0%" stop-color="{}"/>
    <stop offset="50%" stop-color="{}"/>
    <stop offset="100%" stop-color="{}"/>
  </linearGradient>
  <filter id="fmsShadow" x="-15%" y="-15%" width="130%" height="140%">
    <feDropShadow dx="1.4" dy="2.0" stdDeviation="2.2" flood-color="#0a0805" flood-opacity="0.45"/>
  </filter>"##,
        fr.x, fr.y, fr.w, fr.h, th.banner_edge, th.banner_lit, th.banner_edge
    );

    // Заранее готовим дуги <path> для океанских названий
    let mut ocean_arc_idx = 0usize;
    let mut labels = ov.labels.clone();
    for st in &ov.settlements {
        if st.kind == "capital" {
            labels.push(crate::terrain::MapLabel {
                text: st.name.clone(),
                kind: "capital",
                x: st.x,
                y: st.y,
                prio: 680.0 + st.score,
            });
        } else if !ov.is_world || st.score >= 58.0 || st.kind == "port" {
            labels.push(crate::terrain::MapLabel {
                text: st.name.clone(),
                kind: "city",
                x: st.x,
                y: st.y,
                prio: 360.0 + st.score,
            });
        }
    }
    labels.sort_by(|a, b| b.prio.total_cmp(&a.prio));

    let mut occupied: Vec<Rect> = Vec::new();
    let leg_r = Rect {
        x: ov.legend_rect[0],
        y: ov.legend_rect[1],
        w: ov.legend_rect[2],
        h: ov.legend_rect[3],
    };
    occupied.push(leg_r.inset(-8.0 * us, -8.0 * us));
    occupied.push(Rect {
        x: rose_cx - rose_r - 8.0 * us,
        y: rose_cy - rose_r - 16.0 * us,
        w: rose_sz + 16.0 * us,
        h: rose_sz + 24.0 * us,
    });
    for st in &ov.settlements {
        if !fr.inset(12.0 * us, 12.0 * us).contains_pt(st.x, st.y) {
            continue;
        }
        if st.kind == "capital" {
            let hw = (if ov.is_world { 22.0 } else { 34.0 }) * us;
            let hh = (if ov.is_world { 30.0 } else { 44.0 }) * us;
            occupied.push(Rect {
                x: st.x - hw,
                y: st.y - hh,
                w: hw * 2.0,
                h: hh + 10.0 * us,
            });
        } else if !ov.is_world || st.score >= 58.0 || st.kind == "port" {
            let hw = (if ov.is_world { 14.0 } else { 22.0 }) * us;
            let hh = (if ov.is_world { 18.0 } else { 28.0 }) * us;
            occupied.push(Rect {
                x: st.x - hw,
                y: st.y - hh,
                w: hw * 2.0,
                h: hh + 8.0 * us,
            });
        }
    }

    struct PlacedLabel<'a> {
        text: &'a str,
        cx: f64,
        cy: f64,
        rect: Rect,
        font_sz: f64,
        track: f64,
        italic: bool,
        bold: bool,
        use_banner: bool,
        fill: &'a str,
        halo: &'a str,
        halo_w: f64,
        ocean_arc_id: Option<usize>,
    }

    let mut placed_labels: Vec<PlacedLabel<'_>> = Vec::new();
    for lb in &labels {
        if !fr.inset(14.0 * us, 14.0 * us).contains_pt(lb.x, lb.y) {
            continue;
        }
        let (font_sz, track, italic, bold, use_banner, mut fill, mut halo, halo_w) = match lb.kind {
            "ocean" => (
                (if ov.is_world { 15.5 } else { 16.5 }) * us,
                4.2 * us,
                true,
                false,
                false,
                if ov.style.is_archival() { "#294d6b" } else { th.text_water },
                th.halo_water,
                3.0 * us,
            ),
            "continent" => (
                (if ov.is_world { 17.5 } else { 18.0 }) * us,
                (if ov.style.is_archival() { 5.2 } else { 3.4 }) * us,
                false,
                true,
                false,
                th.text_continent,
                th.halo_water,
                3.2 * us,
            ),
            "realm" => (
                (if ov.is_world { 14.0 } else { 17.0 }) * us,
                1.4 * us,
                false,
                true,
                false,
                th.text_realm,
                th.halo_land,
                4.8 * us,
            ),
            "capital" => (
                (if ov.is_world { 13.0 } else { 15.5 }) * us,
                0.4 * us,
                false,
                true,
                true,
                th.banner_ink,
                th.halo_land,
                0.0,
            ),
            "range" => (
                (if ov.is_world { 12.0 } else { 14.0 }) * us,
                0.6 * us,
                true,
                false,
                false,
                th.text_muted,
                th.halo_land,
                2.8 * us,
            ),
            "river" | "water" => (
                (if ov.is_world { 12.0 } else { 14.0 }) * us,
                0.4 * us,
                true,
                false,
                false,
                th.text_water,
                th.halo_water,
                2.8 * us,
            ),
            _ => {
                let ub = !ov.is_world && lb.prio >= 440.0;
                (
                    (if ov.is_world { 11.0 } else { 12.8 }) * us,
                    0.15 * us,
                    false,
                    false,
                    ub,
                    if ub { th.banner_ink } else { th.text_land },
                    th.halo_land,
                    if ub { 0.0 } else { 2.8 * us },
                )
            }
        };

        let (tw, th_px) = approx_text_size(&lb.text, font_sz, track);
        let is_city = lb.kind == "capital" || lb.kind == "city";
        let offsets: &[(f64, f64)] = if use_banner {
            &[
                (0.0, if ov.is_world { 21.0 } else { 25.0 }),
                (0.0, if ov.is_world { -38.0 } else { -50.0 }),
                (tw * 0.5 + 32.0, -4.0),
                (-tw * 0.5 - 32.0, -4.0),
            ]
        } else if is_city {
            &[
                (0.0, if ov.is_world { -22.0 } else { -30.0 }),
                (0.0, if ov.is_world { 16.0 } else { 20.0 }),
                (tw * 0.5 + 22.0, 0.0),
                (-tw * 0.5 - 22.0, 0.0),
            ]
        } else if lb.kind == "ocean" {
            &[(0.0, 0.0), (0.0, -26.0), (0.0, 26.0), (64.0, 0.0), (-64.0, 0.0)]
        } else {
            &[(0.0, 0.0), (0.0, -18.0), (0.0, 18.0)]
        };
        let pad_x = (if use_banner { 19.0 } else if is_city { 5.5 } else { 7.5 }) * us;
        let pad_y = (if use_banner { 5.5 } else { 3.5 }) * us;

        let mut chosen: Option<(f64, f64, Rect)> = None;
        for &(dx, dy) in offsets {
            let cx = lb.x + dx * us;
            let cy = lb.y + dy * us;
            let cand = Rect {
                x: cx - tw * 0.5 - pad_x,
                y: cy - th_px * 0.62 - pad_y,
                w: tw + pad_x * 2.0,
                h: th_px + pad_y * 2.0,
            };
            if !fr.inset(10.0 * us, 8.0 * us).contains_rect(cand) {
                continue;
            }
            if !occupied.iter().any(|r| r.intersects(cand)) {
                chosen = Some((cx, cy, cand));
                break;
            }
        }
        let Some((cx, cy, rect)) = chosen else { continue; };
        occupied.push(rect);

        // Адаптивный светлый контраст по средней яркости базового растра под текстом
        if !use_banner && matches!(lb.kind, "continent" | "water" | "river" | "range") {
            let x0 = (rect.x + 4.0).clamp(0.0, (w - 1) as f64) as usize;
            let x1 = (rect.x + rect.w - 4.0).clamp(x0 as f64, (w - 1) as f64) as usize;
            let py = (cy.round() as isize).clamp(0, h as isize - 1) as usize;
            let mut lsum = 0.0;
            let mut lcnt = 0;
            for ix in 0..5 {
                let px = x0 + ((x1 - x0) * ix) / 4;
                let off = (py * w + px) * 3;
                lsum += (0.299 * base_rgb[off] as f64 + 0.587 * base_rgb[off + 1] as f64 + 0.114 * base_rgb[off + 2] as f64) / 255.0;
                lcnt += 1;
            }
            if (lsum / lcnt.max(1) as f64) < 0.42 {
                fill = "#f5f0db";
                halo = "rgba(18,36,51,0.84)";
            }
        }

        let arc_id = if lb.kind == "ocean" {
            let aid = ocean_arc_idx;
            ocean_arc_idx += 1;
            let span = (tw * 0.58 + 20.0 * us).max(40.0);
            let arch_amp = 9.0 * us;
            let _ = writeln!(
                s,
                r#"  <path id="oceanArc{aid}" d="M{:.1},{:.1} Q{:.1},{:.1} {:.1},{:.1}"/>"#,
                cx - span,
                cy + arch_amp * 0.45,
                cx,
                cy - arch_amp,
                cx + span,
                cy + arch_amp * 0.45
            );
            Some(aid)
        } else {
            None
        };

        placed_labels.push(PlacedLabel {
            text: &lb.text,
            cx,
            cy,
            rect,
            font_sz,
            track,
            italic,
            bold,
            use_banner,
            fill,
            halo,
            halo_w,
            ocean_arc_id: arc_id,
        });
    }
    let _ = writeln!(s, "</defs>");

    // 1. Базовый растр (спрайты + реки + дороги + берега + бумага)
    if embed_png_inline {
        let png = encode_png_rgb(w, h, base_rgb);
        let b64 = base64_encode(&png);
        let _ = writeln!(s, r#"<image id="layer-base" x="0" y="0" width="{w}" height="{h}" href="data:image/png;base64,{b64}"/>"#);
    } else if let Some(href) = image_href {
        let _ = writeln!(
            s,
            r#"<image id="layer-base" x="0" y="0" width="{w}" height="{h}" href="{}"/>"#,
            xml_escape(href)
        );
    }

    // 2. Векторная координатная сетка
    let _ = writeln!(s, r#"<g id="layer-graticule" clip-path="url(#fmsFrameClip)" fill="none" stroke="{}" stroke-width="{:.2}">"#, th.grat_col, 0.7 * us.max(0.6));
    for line in &ov.graticule {
        if line.len() < 2 {
            continue;
        }
        let mut d = format!("M{:.1},{:.1}", line[0][0], line[0][1]);
        for p in &line[1..] {
            let _ = write!(d, " L{:.1},{:.1}", p[0], p[1]);
        }
        let _ = writeln!(s, r#"  <path d="{d}"/>"#);
    }
    let _ = writeln!(s, "</g>");

    // 3. Океанические течения Стоммела со стрелками (в обоих стилях с поддержкой отключения слоя)
    {
        let lw = (if ov.is_world { 1.0 } else { 1.25 }) * us.max(0.6);
        let t_scale = if ov.is_world { 0.30 } else { 0.14 };
        let g_opacity = if ov.style.is_archival() { 0.96 } else { 0.58 };
        let _ = writeln!(s, r#"<g id="layer-currents" clip-path="url(#fmsFrameClip)" stroke-linecap="round" stroke-linejoin="round" opacity="{g_opacity:.2}">"#);
        for st in ov.currents.iter().filter(|_| ov.style != Style::Ink) {
            if st.len() < 2 {
                continue;
            }
            let mut dist_since_arrow = 34.0 * us;
            for k in 0..(st.len() - 1) {
                let p0 = [st[k][0], st[k][1]];
                let p1 = [st[k + 1][0], st[k + 1][1]];
                let mx = 0.5 * (p0[0] + p1[0]);
                let my = 0.5 * (p0[1] + p1[1]);
                if leg_r.inset(-6.0 * us, -6.0 * us).contains_pt(mx, my) || ((mx - rose_cx).powi(2) + (my - rose_cy).powi(2)).sqrt() < rose_r + 12.0 * us {
                    dist_since_arrow = 0.0;
                    continue;
                }
                let col = current_rgba_str(0.5 * (st[k][2] + st[k + 1][2]), t_scale);
                let _ = writeln!(
                    s,
                    r#"  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{col}" stroke-width="{lw:.2}"/>"#,
                    p0[0], p0[1], p1[0], p1[1]
                );
                let dx = p1[0] - p0[0];
                let dy = p1[1] - p0[1];
                let seg_len = dx.hypot(dy);
                dist_since_arrow += seg_len;
                if dist_since_arrow >= 62.0 * us && seg_len > 1.5 * us {
                    let ux = dx / seg_len;
                    let uy = dy / seg_len;
                    let nx = -uy;
                    let ny = ux;
                    let len = (if ov.is_world { 5.2 } else { 5.8 }) * us;
                    let hw = (if ov.is_world { 2.1 } else { 2.4 }) * us;
                    let _ = writeln!(
                        s,
                        r#"  <polygon points="{:.1},{:.1} {:.1},{:.1} {:.1},{:.1} {:.1},{:.1}" fill="{col}"/>"#,
                        mx + ux * len * 0.55,
                        my + uy * len * 0.55,
                        mx - ux * len * 0.45 + nx * hw,
                        my - uy * len * 0.45 + ny * hw,
                        mx - ux * len * 0.22,
                        my - uy * len * 0.22,
                        mx - ux * len * 0.45 - nx * hw,
                        my - uy * len * 0.45 - ny * hw,
                    );
                    dist_since_arrow = 0.0;
                }
            }
        }
        let _ = writeln!(s, "</g>");
    }

    // 4. Морские торговые пути
    let _ = writeln!(
        s,
        r#"<g id="layer-routes" clip-path="url(#fmsFrameClip)" fill="none" stroke="{}" stroke-width="{:.2}" stroke-linecap="round" stroke-dasharray="{:.1} {:.1}">"#,
        th.sea_lane,
        (if ov.is_world { 1.15 } else { 1.45 }) * us.max(0.6),
        2.5 * us,
        4.8 * us
    );
    for rt in &ov.routes {
        if !rt.is_sea || rt.pts.len() < 2 {
            continue;
        }
        let mut d = format!("M{:.1},{:.1}", rt.pts[0][0], rt.pts[0][1]);
        for p in &rt.pts[1..] {
            let _ = write!(d, " L{:.1},{:.1}", p[0], p[1]);
        }
        let _ = writeln!(s, r#"  <path d="{d}"/>"#);
    }
    let _ = writeln!(s, "</g>");

    // 5. Рамка и шапка карты
    let _ = writeln!(s, r#"<g id="layer-frame">"#);
    if ov.style.is_archival() {
        let out_pad = 5.5 * us;
        let mid_pad = 2.2 * us;
        let _ = writeln!(
            s,
            r#"  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#,
            fr.x, fr.y, fr.w, fr.h, th.frame_outer, 1.8 * us,
            fr.x - out_pad, fr.y - out_pad, fr.w + out_pad * 2.0, fr.h + out_pad * 2.0, th.frame_outer, 1.1 * us,
            fr.x - mid_pad, fr.y - mid_pad, fr.w + mid_pad * 2.0, fr.h + mid_pad * 2.0, th.frame_gold, 0.65 * us,
        );
        for (tx, ty) in [
            (fr.x - out_pad, fr.y - out_pad),
            (fr.x + fr.w + out_pad, fr.y - out_pad),
            (fr.x - out_pad, fr.y + fr.h + out_pad),
            (fr.x + fr.w + out_pad, fr.y + fr.h + out_pad),
        ] {
            let td = 3.8 * us;
            let _ = writeln!(
                s,
                r#"  <polygon points="{tx:.1},{:.1} {:.1},{ty:.1} {tx:.1},{:.1} {:.1},{ty:.1}" fill="{}"/>"#,
                ty - td, tx + td, ty + td, tx - td, th.frame_gold
            );
        }
    } else {
        let out_pad = 7.5 * us;
        let mid_pad = 3.5 * us;
        let _ = writeln!(
            s,
            r#"  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{}" stroke-width="{:.2}"/>"#,
            fr.x, fr.y, fr.w, fr.h, th.frame_outer, 2.0 * us,
            fr.x - out_pad, fr.y - out_pad, fr.w + out_pad * 2.0, fr.h + out_pad * 2.0, th.frame_outer, 1.2 * us,
            fr.x - mid_pad, fr.y - mid_pad, fr.w + mid_pad * 2.0, fr.h + mid_pad * 2.0, th.frame_gold, 1.05 * us,
        );
        let title_w = approx_text_size(&ov.title, 18.0 * us, 1.8 * us).0 + 36.0 * us;
        let b_rect = Rect {
            x: fr.x + 4.0 * us,
            y: fr.y - 42.0 * us,
            w: title_w,
            h: 28.0 * us,
        };
        append_scroll_banner(&mut s, b_rect, &th);
    }

    let head_y = fr.y - 23.0 * us;
    let title_x = if ov.style.is_archival() {
        fr.x + 2.0
    } else {
        fr.x + 4.0 * us + (approx_text_size(&ov.title, 18.0 * us, 1.8 * us).0 + 36.0 * us) * 0.5
    };
    let anchor_title = if ov.style.is_archival() { "start" } else { "middle" };
    let title_col = if ov.style.is_archival() { th.header_col } else { th.banner_ink };
    let _ = writeln!(
        s,
        r#"  <text x="{title_x:.1}" y="{head_y:.1}" text-anchor="{anchor_title}" font-family="{}" font-weight="700" font-size="{:.1}" letter-spacing="{:.1}" fill="{title_col}">{}</text>
  <text x="{:.1}" y="{head_y:.1}" text-anchor="end" font-family="{}" font-size="{:.1}" fill="{}">{}</text>
</g>"#,
        th.font_serif,
        18.0 * us,
        1.8 * us,
        xml_escape(&ov.title),
        fr.x + fr.w,
        th.font_serif,
        12.0 * us,
        th.sub_col,
        xml_escape(&ov.subtitle)
    );

    // 6. Иллюстрированная роза ветров
    let comp_png = encode_png_rgba(pack.compass.w, pack.compass.h, &pack.compass.rgba);
    let comp_b64 = base64_encode(&comp_png);
    let _ = writeln!(
        s,
        r#"<g id="layer-compass" filter="url(#fmsShadow)">
  <image x="{:.1}" y="{:.1}" width="{rose_sz:.1}" height="{rose_sz:.1}" href="data:image/png;base64,{comp_b64}"/>
  <text x="{rose_cx:.1}" y="{:.1}" text-anchor="middle" font-family="{}" font-weight="700" font-size="{:.1}" fill="{}" stroke="{}" stroke-width="{:.1}" paint-order="stroke fill">С</text>
</g>"#,
        rose_cx - rose_r,
        rose_cy - rose_r,
        rose_cy - rose_r - 3.0 * us,
        th.font_serif,
        12.5 * us,
        th.rose_accent,
        th.halo_water,
        2.6 * us,
    );

    // 7. Легенда атласа (в обоих стилях с адаптивной палитрой карточки)
    {
        let card = leg_r;
        let (card_bg, card_inner, hdr_c, txt_c, sep_c) = if ov.style.is_archival() {
            ("rgba(237,230,209,0.95)", th.frame_outer, "#302417", "#574533", "rgba(92,71,51,0.55)")
        } else {
            ("rgba(28,22,16,0.92)", th.frame_gold, "#f5e6b8", "#dfd0ad", "rgba(199,153,66,0.45)")
        };
        let _ = writeln!(s, r#"<g id="layer-legend">"#);
        let _ = writeln!(
            s,
            r#"  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="{card_bg}" stroke="{}" stroke-width="{:.2}" filter="url(#fmsShadow)"/>
  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="none" stroke="{card_inner}" stroke-width="{:.2}"/>"#,
            card.x, card.y, card.w, card.h, th.frame_outer, 1.3 * us,
            card.x + 2.5 * us, card.y + 2.5 * us, card.w - 5.0 * us, card.h - 5.0 * us, 0.65 * us,
        );
        let x_pad = card.x + 9.0 * us;
        let text_x = x_pad + 21.0 * us;
        let mut cy = card.y + 15.0 * us;
        let _ = writeln!(
            s,
            r##"  <text x="{x_pad:.1}" y="{cy:.1}" font-family="{}" font-weight="700" font-size="{:.1}" fill="{hdr_c}">УСЛОВНЫЕ ОБОЗНАЧЕНИЯ</text>
  <line x1="{x_pad:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{sep_c}" stroke-width="{:.2}"/>"##,
            th.font_serif, 9.6 * us, cy + 4.0 * us, card.x + card.w - 9.0 * us, cy + 4.0 * us, 0.6 * us,
        );
        cy += 16.0 * us;

        if !ov.legend_realms.is_empty() {
            let _ = writeln!(s, r##"  <text x="{x_pad:.1}" y="{cy:.1}" font-family="{}" font-weight="700" font-size="{:.1}" fill="{hdr_c}">Государства</text>"##, th.font_serif, 8.6 * us);
            cy += 11.5 * us;
            for (name, rgb) in &ov.legend_realms {
                let sw_y = cy - 6.8 * us;
                let _ = writeln!(
                    s,
                    r##"  <rect x="{:.1}" y="{sw_y:.1}" width="{:.1}" height="{:.1}" fill="rgba({},{},{},0.86)" stroke="#473b2e" stroke-width="{:.2}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">{}</text>"##,
                    x_pad + 1.0 * us, 13.0 * us, 7.2 * us,
                    (rgb[0] * 255.0).round() as u8, (rgb[1] * 255.0).round() as u8, (rgb[2] * 255.0).round() as u8,
                    0.55 * us, th.font_serif, 8.4 * us, xml_escape(name),
                );
                cy += 11.2 * us;
            }
            cy += 2.0 * us;
        }
        if ov.is_world {
            let _ = writeln!(s, r##"  <text x="{x_pad:.1}" y="{cy:.1}" font-family="{}" font-weight="700" font-size="{:.1}" fill="{hdr_c}">Поселения</text>"##, th.font_serif, 8.6 * us);
            cy += 11.5 * us;
            for (label, icon) in [("Столица", 0), ("Город", 1), ("Порт", 2), ("Крепость", 3)] {
                let icx = x_pad + 7.5 * us;
                let icy = cy - 3.0 * us;
                match icon {
                    0 => { let _ = writeln!(s, r##"  <circle cx="{icx:.1}" cy="{icy:.1}" r="{:.1}" fill="#b83829" stroke="#302417" stroke-width="{:.2}"/>"##, 3.1 * us, 0.7 * us); }
                    1 => { let _ = writeln!(s, r##"  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="#dbccb0" stroke="#302417" stroke-width="{:.2}"/><polygon points="{:.1},{:.1} {icx:.1},{:.1} {:.1},{:.1}" fill="#ad4d3d"/>"##, icx - 2.8 * us, icy - 1.5 * us, 5.6 * us, 4.0 * us, 0.6 * us, icx - 3.4 * us, icy - 1.5 * us, icy - 4.2 * us, icx + 3.4 * us, icy - 1.5 * us); }
                    2 => { let _ = writeln!(s, r##"  <circle cx="{icx:.1}" cy="{icy:.1}" r="{:.1}" fill="none" stroke="#4590ba" stroke-width="{:.2}"/>"##, 2.5 * us, 1.1 * us); }
                    _ => { let _ = writeln!(s, r##"  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="#8c806f" stroke="#302417" stroke-width="{:.2}"/>"##, icx - 2.6 * us, icy - 2.6 * us, 5.2 * us, 5.2 * us, 0.65 * us); }
                }
                let _ = writeln!(s, r##"  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">{label}</text>"##, th.font_serif, 8.4 * us);
                cy += 11.2 * us;
            }
            cy += 2.0 * us;
        }

        let _ = writeln!(s, r##"  <text x="{x_pad:.1}" y="{cy:.1}" font-family="{}" font-weight="700" font-size="{:.1}" fill="{hdr_c}">Обозначения</text>"##, th.font_serif, 8.6 * us);
        cy += 11.5 * us;
        let ly = |y: f64| y - 3.0 * us;
        let bdr_c = if ov.style.is_archival() { "#472e26" } else { "#c24438" };
        let _ = writeln!(
            s,
            r##"  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{bdr_c}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1} {:.1} {:.1}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">Граница государства</text>"##,
            x_pad + 1.0 * us, ly(cy), x_pad + 15.0 * us, ly(cy), 1.1 * us, 4.5 * us, 2.0 * us, 1.2 * us, 2.0 * us, th.font_serif, 8.4 * us
        );
        cy += 11.2 * us;
        let _ = writeln!(
            s,
            r##"  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#4d4030" stroke-width="{:.2}"/>
  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#d9d1b8" stroke-width="{:.2}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">Дорога / тракт</text>"##,
            x_pad + 1.0 * us, ly(cy), x_pad + 15.0 * us, ly(cy), 2.5 * us,
            x_pad + 1.0 * us, ly(cy), x_pad + 15.0 * us, ly(cy), 1.3 * us, th.font_serif, 8.4 * us
        );
        cy += 11.2 * us;
        let _ = writeln!(
            s,
            r##"  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#382e24" stroke-width="{:.2}"/>
  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#70a6bd" stroke-width="{:.2}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">Река / порог</text>"##,
            x_pad + 1.0 * us, ly(cy), x_pad + 15.0 * us, ly(cy), 2.4 * us,
            x_pad + 1.0 * us, ly(cy), x_pad + 15.0 * us, ly(cy), 1.25 * us, th.font_serif, 8.4 * us
        );
        cy += 11.2 * us;
        let sea_c = if ov.style.is_archival() { "#3d4d52" } else { "#cfe3de" };
        let _ = writeln!(
            s,
            r##"  <line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="{sea_c}" stroke-width="{:.2}" stroke-dasharray="{:.1} {:.1}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">Морской путь</text>"##,
            x_pad + 1.0 * us, ly(cy), x_pad + 15.0 * us, ly(cy), 1.05 * us, 1.8 * us, 2.8 * us, th.font_serif, 8.4 * us
        );
        cy += 11.2 * us;
        for (lbl, col) in [("Тёплое течение", "#c44b3b"), ("Холодное течение", "#3d82b8")] {
            let y0 = ly(cy);
            let _ = writeln!(
                s,
                r##"  <line x1="{:.1}" y1="{y0:.1}" x2="{:.1}" y2="{y0:.1}" stroke="{col}" stroke-width="{:.2}"/>
  <polygon points="{:.1},{y0:.1} {:.1},{:.1} {:.1},{:.1}" fill="{col}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">{lbl}</text>"##,
                x_pad + 1.0 * us, x_pad + 13.5 * us, 1.1 * us,
                x_pad + 15.5 * us, x_pad + 11.2 * us, y0 - 2.1 * us, x_pad + 11.2 * us, y0 + 2.1 * us,
                th.font_serif, 8.4 * us
            );
            cy += 11.2 * us;
        }
        {
            let icx1 = x_pad + 4.8 * us;
            let icx2 = x_pad + 12.2 * us;
            let icy = ly(cy);
            let _ = writeln!(
                s,
                r##"  <circle cx="{icx1:.1}" cy="{icy:.1}" r="{:.1}" fill="#e0a83e" stroke="#1f1811" stroke-width="{:.2}"/>
  <polygon points="{icx2:.1},{:.1} {:.1},{icy:.1} {icx2:.1},{:.1} {:.1},{icy:.1}" fill="#40b89e" stroke="#1f1811" stroke-width="{:.2}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">Месторождение</text>"##,
                2.5 * us, 0.7 * us, icy - 2.9 * us, icx2 + 2.6 * us, icy + 2.9 * us, icx2 - 2.6 * us, 0.7 * us, th.font_serif, 8.4 * us
            );
            cy += 11.2 * us;
        }
        if ov.is_world {
            let _ = writeln!(
                s,
                r##"  <rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" fill="#d4e2ea" stroke="#42382e" stroke-width="{:.2}"/>
  <text x="{text_x:.1}" y="{cy:.1}" font-family="{}" font-size="{:.1}" fill="{txt_c}">Полярный морской лёд</text>"##,
                x_pad + 1.0 * us, cy - 6.8 * us, 13.0 * us, 7.2 * us, 0.65 * us, th.font_serif, 8.4 * us
            );
        }
        let _ = writeln!(s, "</g>");
    }

    // 7b. Месторождения полезных ископаемых и крупные водопады
    let _ = writeln!(s, r#"<g id="layer-deposits" clip-path="url(#fmsFrameClip)">"#);
    let dep_r = (if ov.is_world { 4.2 } else { 5.4 }) * us.max(0.55);
    for wf in &ov.waterfalls {
        if leg_r.inset(-6.0 * us, -6.0 * us).contains_pt(wf.x, wf.y)
            || ((wf.x - rose_cx).powi(2) + (wf.y - rose_cy).powi(2)).sqrt() < rose_r + 12.0 * us
        {
            continue;
        }
        let s_wf = (if ov.is_world { 3.8 } else { 5.0 }) * us.max(0.6);
        let _ = writeln!(
            s,
            r##"  <g><line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#1f2c36" stroke-width="{:.2}" stroke-linecap="round"/><line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#eef9fc" stroke-width="{:.2}" stroke-linecap="round"/><line x1="{:.1}" y1="{:.1}" x2="{:.1}" y2="{:.1}" stroke="#4da6cc" stroke-width="{:.2}" stroke-linecap="round"/><title>Водопад ({:.0} м, {:.0} м³/с)</title></g>"##,
            wf.x - s_wf, wf.y - s_wf * 0.45, wf.x + s_wf, wf.y - s_wf * 0.45, 2.3 * us,
            wf.x - s_wf, wf.y - s_wf * 0.45, wf.x + s_wf, wf.y - s_wf * 0.45, 1.2 * us,
            wf.x - s_wf * 0.65, wf.y + s_wf * 0.48, wf.x + s_wf * 0.65, wf.y + s_wf * 0.48, 1.3 * us,
            wf.drop_m, wf.discharge_m3s
        );
    }
    for d in &ov.deposits {
        if leg_r.inset(-6.0 * us, -6.0 * us).contains_pt(d.x, d.y)
            || ((d.x - rose_cx).powi(2) + (d.y - rose_cy).powi(2)).sqrt() < rose_r + 12.0 * us
        {
            continue;
        }
        let pct = (d.richness * 100.0).round() as i32;
        let fill = match d.kind {
            "iron" => "#748696",
            "copper" => "#e0a83e",
            "gems" => "#40b89e",
            "coal" => "#353230",
            "oil" => "#94521e",
            "salt" => "#f4efe4",
            _ => "#c89b52",
        };
        let stroke = if d.kind == "coal" { "#d8cfbc" } else { "#1f1811" };
        let shape = match d.kind {
            "gems" | "salt" => format!(
                r#"<polygon points="{:.1},{:.1} {:.1},{:.1} {:.1},{:.1} {:.1},{:.1}" fill="{fill}" stroke="{stroke}" stroke-width="{:.2}"/>"#,
                d.x,
                d.y - dep_r * 1.15,
                d.x + dep_r * 1.0,
                d.y,
                d.x,
                d.y + dep_r * 1.15,
                d.x - dep_r * 1.0,
                d.y,
                1.1 * us
            ),
            "coal" | "iron" => format!(
                r#"<rect x="{:.1}" y="{:.1}" width="{:.1}" height="{:.1}" rx="{:.1}" fill="{fill}" stroke="{stroke}" stroke-width="{:.2}"/>"#,
                d.x - dep_r * 0.85,
                d.y - dep_r * 0.85,
                dep_r * 1.7,
                dep_r * 1.7,
                1.4 * us,
                1.1 * us
            ),
            _ => format!(
                r#"<circle cx="{:.1}" cy="{:.1}" r="{:.2}" fill="{fill}" stroke="{stroke}" stroke-width="{:.2}"/>"#,
                d.x,
                d.y,
                dep_r * 0.95,
                1.1 * us
            ),
        };
        let _ = writeln!(s, r#"  <g>{shape}<title>{} ({pct}%)</title></g>"#, xml_escape(d.label));
    }
    let _ = writeln!(s, "</g>");

    // 8. Подписи, свитки городов и дуговые названия океанов
    let _ = writeln!(s, r#"<g id="layer-labels">"#);
    for pl in placed_labels {
        if pl.use_banner {
            append_scroll_banner(&mut s, pl.rect, &th);
        }
        let fw_attr = if pl.bold { "700" } else { "400" };
        let fs_attr = if pl.italic { "italic" } else { "normal" };
        if let Some(aid) = pl.ocean_arc_id {
            let _ = writeln!(
                s,
                r##"  <text font-family="{}" font-style="italic" font-size="{:.1}" letter-spacing="{:.1}" fill="{}" stroke="{}" stroke-width="{:.1}" stroke-linejoin="round" paint-order="stroke fill"><textPath href="#oceanArc{aid}" startOffset="50%" text-anchor="middle">{}</textPath></text>"##,
                th.font_serif, pl.font_sz, pl.track, pl.fill, pl.halo, pl.halo_w, xml_escape(pl.text)
            );
        } else {
            let base_y = pl.cy + pl.font_sz * 0.34;
            let _ = writeln!(
                s,
                r#"  <text x="{:.1}" y="{base_y:.1}" text-anchor="middle" font-family="{}" font-weight="{fw_attr}" font-style="{fs_attr}" font-size="{:.1}" letter-spacing="{:.1}" fill="{}" stroke="{}" stroke-width="{:.1}" stroke-linejoin="round" paint-order="stroke fill">{}</text>"#,
                pl.cx, th.font_serif, pl.font_sz, pl.track, pl.fill, pl.halo, pl.halo_w, xml_escape(pl.text)
            );
        }
    }
    let _ = writeln!(s, "</g>");
    let _ = writeln!(s, "</svg>");
    s
}
