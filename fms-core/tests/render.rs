use fms_core::planet;
use fms_core::render::{self, Style};
use fms_core::tectonic::Options;

#[test]
fn render_all_styles_produces_varied_images() {
    let mut opt = Options::new("render-test");
    opt.w = 90;
    let p = planet::generate(&opt).expect("planet generation failed");
    let scale = 3;
    let mut seen = Vec::new();
    for style in Style::ALL {
        let img = render::render(&p, style, scale);
        assert_eq!(img.w, p.grid.w * scale);
        assert_eq!(img.h, p.grid.h * scale);
        assert_eq!(img.rgb.len(), img.w * img.h * 3);
        let first = [img.rgb[0], img.rgb[1], img.rgb[2]];
        assert!(img.rgb.chunks(3).any(|px| px != first), "{} is a flat image", style.slug());
        seen.push(img.rgb);
    }
    // стили действительно различаются между собой
    for i in 0..seen.len() {
        for j in i + 1..seen.len() {
            assert_ne!(seen[i], seen[j]);
        }
    }
}

#[test]
fn png_has_valid_signature_and_chunks() {
    let img = render::Image { w: 2, h: 2, rgb: vec![255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255] };
    let path = std::env::temp_dir().join("fms_render_test.png");
    img.write_png(path.to_str().unwrap()).unwrap();
    let data = std::fs::read(&path).unwrap();
    assert_eq!(&data[..8], &[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    assert_eq!(&data[12..16], b"IHDR");
    assert_eq!(&data[data.len() - 8..data.len() - 4], b"IEND");
    let _ = std::fs::remove_file(path);
}
