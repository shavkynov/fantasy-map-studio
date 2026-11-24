//! Рендер карты мира в нескольких стилях.
//!
//! Использование: `cargo run --release --example render -- [seed] [ширина сетки] [пикселей на ячейку] [префикс] [стиль]`
//! Стили: classic, parchment, political, relief (по умолчанию — все).

use fms_core::planet;
use fms_core::render::{self, Style};
use fms_core::tectonic::Options;
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed = args.get(1).map(|s| s.as_str()).unwrap_or("a");
    let width: usize = args.get(2).and_then(|s| s.parse().ok()).unwrap_or(720);
    let scale: usize = args.get(3).and_then(|s| s.parse().ok()).unwrap_or(4);
    let prefix = args.get(4).map(|s| s.as_str()).unwrap_or("map");
    let only = args.get(5).map(|s| s.as_str());

    let mut opt = Options::new(seed);
    opt.w = width;
    let t0 = Instant::now();
    let p = planet::generate(&opt).expect("planet generation failed");
    println!("planet seed={seed} grid={}x{} generated in {:?}", p.grid.w, p.grid.h, t0.elapsed());

    for style in Style::ALL {
        if let Some(o) = only {
            if o != style.slug() {
                continue;
            }
        }
        let t = Instant::now();
        let img = render::render(&p, style, scale);
        let path = format!("{prefix}_{}.png", style.slug());
        img.write_png(&path).expect("failed to write png");
        println!("{} ({}) -> {path} {}x{} in {:?}", style.slug(), style.title(), img.w, img.h, t.elapsed());
    }
}
