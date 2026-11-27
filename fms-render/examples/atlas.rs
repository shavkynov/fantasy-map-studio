//! Экспорт карты мира и регионального зума 4× в PNG и многослойный SVG.
//! Запуск: `cargo run --release -p fms-render --example atlas -- [seed] [prefix] [sepia|ink|color|all]`

use fms_core::planet;
use fms_core::region;
use fms_core::tectonic::Options;
use fms_render::{choose_region_window, render_region, render_world, AssetPack, Style};
use std::time::Instant;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seed = args.get(1).map(|s| s.as_str()).unwrap_or("e");
    let prefix = args.get(2).map(|s| s.as_str()).unwrap_or("atlas_out");
    let style_arg = args.get(3).map(|s| s.as_str()).unwrap_or("all");

    let mut opt = Options::new(seed);
    opt.w = 720;
    let t0 = Instant::now();
    let planet = planet::generate(&opt).expect("planet generate");
    let r_opt = choose_region_window(&planet);
    let reg = region::generate_region(&planet, &r_opt).expect("region generate");
    let pack = AssetPack::load_default().expect("load default asset pack");
    println!("Планета сид='{seed}' + регион сгенерированы за {:?}", t0.elapsed());

    for style in Style::ALL {
        if style_arg != "all" && style_arg != style.slug() {
            continue;
        }
        let tw = Instant::now();
        let world_out = render_world(&planet, seed, style).expect("render world");
        let w_png = format!("{prefix}_world_{}.png", style.slug());
        let w_svg = format!("{prefix}_world_{}.svg", style.slug());
        world_out.write_png(&w_png).expect("write world png");
        world_out.write_svg_standalone(&w_svg, &pack).expect("write world svg");

        let reg_out = render_region(&planet, &reg, &r_opt, seed, style).expect("render region");
        let r_png = format!("{prefix}_region_{}.png", style.slug());
        let r_svg = format!("{prefix}_region_{}.svg", style.slug());
        reg_out.write_png(&r_png).expect("write region png");
        reg_out.write_svg_standalone(&r_svg, &pack).expect("write region svg");
        println!(
            "{} ({}) -> мир {}x{}, регион {}x{} за {:?}",
            style.slug(),
            style.title(),
            world_out.width,
            world_out.height,
            reg_out.width,
            reg_out.height,
            tw.elapsed()
        );
    }
}
