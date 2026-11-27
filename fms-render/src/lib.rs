//! Иллюстрированный картографический рендерер Fantasy Map Studio:
//! спрайтовые горы, леса, города, мосты и роза ветров поверх гладкой подложки `fms-core`,
//! с экспортом в PNG и многослойный SVG.

pub mod assets;
pub mod classic;
pub mod png;
pub mod proj;
pub mod svg;
pub mod terrain;

pub use assets::AssetPack;
pub use proj::{RegionProj, WorldProj};
pub use terrain::{
    choose_region_window, DepositPin, MapLabel, OverlayModel, OverlayRoute, PoiPin,
    RenderOptions, SettlementPin, Style, WaterfallPin, WildSitePin,
};

use fms_core::planet::Planet;
use fms_core::region::{Region, RegionOptions};

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

/// Рендерит карту мира с настройками по умолчанию (`Style::Sepia`, ширина 2200 px).
pub fn render_world(planet: &Planet, seed: &str, style: Style) -> Result<RenderOutput, String> {
    let pack = AssetPack::load_default_or_empty();
    let opt = RenderOptions {
        style,
        ..Default::default()
    };
    Ok(render_world_with_options(planet, seed, &pack, &opt))
}

/// Рендерит карту мира в классической линейке 0.89.0 («Сепия» / «Ч/Б» / «Цветной»).
pub fn render_world_with_options(
    planet: &Planet,
    seed: &str,
    _pack: &AssetPack,
    opt: &RenderOptions,
) -> RenderOutput {
    classic::render_classic_world(planet, seed, opt)
}

/// Рендерит региональный масштаб с настройками по умолчанию (`target_width = 1680`).
pub fn render_region(
    planet: &Planet,
    reg: &Region,
    reg_opt: &RegionOptions,
    seed: &str,
    style: Style,
) -> Result<RenderOutput, String> {
    let pack = AssetPack::load_default_or_empty();
    let opt = RenderOptions {
        style,
        target_width: 1680,
        title: None,
    };
    Ok(render_region_with_options(planet, reg, reg_opt, seed, &pack, &opt))
}

/// Рендерит детальный региональный лист в классической линейке 0.89.0.
pub fn render_region_with_options(
    planet: &Planet,
    reg: &Region,
    reg_opt: &RegionOptions,
    seed: &str,
    _pack: &AssetPack,
    opt: &RenderOptions,
) -> RenderOutput {
    classic::render_classic_region(planet, reg, reg_opt, seed, opt)
}
