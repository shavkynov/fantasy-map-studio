use fms_core::planet::{self, PlanetOptions};
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
        assert!(w_svg.contains("id=\"layer-water-detail\""));
        assert!(w_svg.contains("id=\"layer-rivers\""));
        assert!(w_svg.contains("id=\"layer-coast\""));
        assert!(w_svg.contains("id=\"layer-relief\""));
        assert!(w_svg.contains("id=\"layer-forests\""));
        assert!(w_svg.contains("id=\"layer-currents\""));
        assert!(w_svg.contains("id=\"layer-deposits\""));
        assert!(w_svg.contains("id=\"layer-pois\""));
        assert!(w_svg.contains("id=\"layer-labels\""));
        assert!(w_svg.contains("id=\"layer-legend\""));

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
        style: Style::Sepia,
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
            style: Style::Sepia,
            target_width: 900,
            title: None,
        },
    );
    assert_eq!(&out.to_png_bytes()[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    assert!(out.to_svg_standalone(&pack).contains("<svg "));
}

#[test]
fn classic_089_styles_invariants() {
    let pack = AssetPack::load_default().expect("assets must load");
    let mut opt = Options::new("smoke");
    opt.w = 180;
    let phys = planet::generate_physical_with_options(&PlanetOptions::from_tectonic(opt)).expect("physical planet");

    // Сепия на чистой физической планете (без границ и городов)
    let sepia = render_world_with_options(
        &phys,
        "smoke",
        &pack,
        &RenderOptions {
            style: Style::Sepia,
            target_width: 800,
            title: None,
        },
    );
    let mut warm_paper = 0usize;
    for px in sepia.base_rgb.chunks_exact(3) {
        if px[0] >= px[1] && px[1] >= px[2] && px[0] > 180 {
            warm_paper += 1;
        }
    }
    assert!(warm_paper > 40_000, "expected sepia paper, got {warm_paper}");
    let sepia_svg = sepia.to_svg_standalone(&pack);
    assert!(sepia_svg.contains("id=\"layer-water-detail\""));
    assert!(sepia_svg.contains("<rect "));
    let b_start = sepia_svg.find("id=\"layer-borders\"").unwrap();
    let b_end = sepia_svg[b_start..].find("</g>").unwrap();
    assert!(!sepia_svg[b_start..b_start + b_end].contains("<path "));

    // Ч/Б: монохром, ореолы и отсутствие рамки
    let ink = render_world_with_options(
        &phys,
        "smoke",
        &pack,
        &RenderOptions {
            style: Style::Ink,
            target_width: 800,
            title: None,
        },
    );
    for px in ink.flat_rgb.chunks_exact(3) {
        assert!((px[0] as i16 - px[2] as i16).abs() <= 14, "ink pixel not bw: {:?}", px);
    }
    let ink_svg = ink.to_svg_standalone(&pack);
    let fr_start = ink_svg.find("id=\"layer-frame\"").unwrap();
    let fr_end = ink_svg[fr_start..].find("</g>").unwrap();
    assert!(!ink_svg[fr_start..fr_start + fr_end].contains("<rect "), "Ink theme must omit frame");

    // Цветной: голубая вода и зелёно-охристая суша
    let color = render_world_with_options(
        &phys,
        "smoke",
        &pack,
        &RenderOptions {
            style: Style::Color,
            target_width: 800,
            title: None,
        },
    );
    let mut blue_ocean = 0usize;
    let mut green_land = 0usize;
    for px in color.base_rgb.chunks_exact(3) {
        if px[2] > px[0].saturating_add(25) {
            blue_ocean += 1;
        }
        if px[1] > px[2].saturating_add(15) {
            green_land += 1;
        }
    }
    assert!(blue_ocean > 20_000 && green_land > 10_000, "expected ocean {blue_ocean} and land {green_land}");
}
