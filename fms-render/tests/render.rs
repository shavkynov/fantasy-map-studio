use fms_core::planet;
use fms_core::region;
use fms_core::tectonic::Options;
use fms_render::{
    choose_region_window, render_region_with_options, render_world_with_options, AssetPack, RenderOptions, Style,
};

#[test]
fn render_world_and_region_both_styles_png_and_svg() {
    let pack = AssetPack::load_default().expect("assets must load");
    let mut opt = Options::new("smoke");
    opt.w = 180;
    let planet = planet::generate(&opt).expect("planet");
    let r_opt = choose_region_window(&planet);
    let mut r_opt_fast = r_opt.clone();
    r_opt_fast.scale = 2;
    let reg = region::generate_region(&planet, &r_opt_fast).expect("region");

    for style in Style::ALL {
        let w_out = render_world_with_options(
            &planet,
            "smoke",
            &pack,
            &RenderOptions {
                style,
                target_width: 640,
                title: None,
            },
        );
        let w_png = w_out.to_png_bytes();
        assert_eq!(&w_png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        let w_svg = w_out.to_svg_standalone(&pack);
        assert!(w_svg.contains("<svg "));
        assert!(w_svg.contains("id=\"layer-labels\""));
        assert!(w_svg.contains("id=\"layer-compass\""));
        assert!(w_svg.contains("id=\"layer-currents\""));
        assert!(w_svg.contains("id=\"layer-deposits\""));
        assert!(w_svg.contains("id=\"layer-legend\""));
        assert!(w_svg.contains("oceanArc"));

        let r_out = render_region_with_options(
            &planet,
            &reg,
            &r_opt_fast,
            "smoke",
            &pack,
            &RenderOptions {
                style,
                target_width: 600,
                title: None,
            },
        );
        let r_png = r_out.to_png_bytes();
        assert_eq!(&r_png[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
        let r_svg = r_out.to_svg_with_image_href(&pack, "/api/region/map.png");
        assert!(r_svg.contains("href=\"/api/region/map.png\""));
    }
}

#[test]
fn render_is_deterministic() {
    let pack = AssetPack::load_default().expect("assets");
    let mut opt = Options::new("det");
    opt.w = 180;
    let p = planet::generate(&opt).expect("planet");
    let ro = RenderOptions {
        style: Style::Expedition,
        target_width: 520,
        title: None,
    };
    let a = render_world_with_options(&p, "det", &pack, &ro);
    let b = render_world_with_options(&p, "det", &pack, &ro);
    assert_eq!(a.flat_rgb, b.flat_rgb);
    assert_eq!(a.to_svg_with_image_href(&pack, "x.png"), b.to_svg_with_image_href(&pack, "x.png"));
}

#[test]
fn six_continents_projection_frame_invertible() {
    let pack = AssetPack::load_default().expect("assets");
    let mut opt = Options::new("e");
    opt.w = 180;
    opt.target_continents = 6;
    let planet = planet::generate(&opt).expect("planet tc=6");
    let proj = fms_render::WorldProj::fit(&planet, 1100);
    let [fx, fy, fw, fh] = proj.frame;
    for gy in 0..=4 {
        for gx in 0..=4 {
            let px = fx + 1.0 + (fw - 2.0) * (gx as f64 / 4.0);
            let py = fy + 1.0 + (fh - 2.0) * (gy as f64 / 4.0);
            assert!(
                proj.inverse(px, py).is_some(),
                "frame point ({px:.1}, {py:.1}) should map back inside sphere"
            );
        }
    }
    let out = render_world_with_options(
        &planet,
        "e",
        &pack,
        &RenderOptions {
            style: Style::Expedition,
            target_width: 900,
            title: None,
        },
    );
    assert_eq!(&out.to_png_bytes()[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    assert!(out.to_svg_standalone(&pack).contains("<svg "));
}

#[test]
fn sketch_style_parchment_pencil_invariants() {
    let pack = AssetPack::load_default().expect("assets must load");
    let mut opt = Options::new("smoke");
    opt.w = 180;
    let planet = planet::generate(&opt).expect("planet");
    let out = render_world_with_options(
        &planet,
        "smoke",
        &pack,
        &RenderOptions {
            style: Style::Sketch,
            target_width: 960,
            title: None,
        },
    );

    let mut warm_paper_px = 0usize;
    let mut dark_pencil_px = 0usize;
    for px in out.base_rgb.chunks_exact(3) {
        let [r, g, b] = [px[0], px[1], px[2]];
        assert!(
            (r as i16 - b as i16).abs() <= 45,
            "sketch pixel too saturated: rgb=({r},{g},{b})"
        );
        if r >= g && g >= b && r > 225 {
            warm_paper_px += 1;
        }
        if r < 110 && g < 110 && b < 110 {
            dark_pencil_px += 1;
        }
    }
    assert!(warm_paper_px > 50_000, "expected warm parchment area, got {warm_paper_px}");
    assert!(dark_pencil_px > 1_000, "expected crisp pencil strokes, got {dark_pencil_px}");

    let svg = out.to_svg_standalone(&pack);
    assert!(svg.contains("id=\"layer-legend\""));
    let cur_start = svg.find("id=\"layer-currents\"").expect("currents group");
    let cur_end = svg[cur_start..].find("</g>").expect("currents group close");
    assert!(
        !svg[cur_start..cur_start + cur_end].contains("<line "),
        "sketch style must omit ocean current arrows"
    );
}
