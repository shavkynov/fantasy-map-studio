//! Многослойный SVG-рендерер классического атласа.

use crate::assets::AssetPack;
use crate::terrain::OverlayModel;

/// Генерирует многослойный SVG-документ поверх базового растра.
pub fn render_svg(
    base_rgb: &[u8],
    ov: &OverlayModel,
    _pack: &AssetPack,
    embed_png_inline: bool,
    image_href: Option<&str>,
) -> String {
    crate::classic::render_classic_svg(base_rgb, ov, embed_png_inline, image_href)
}
