//! Локальная картографическая студия поверх `fms-core` и `fms-render`.

pub mod server;

#[cfg(target_os = "macos")]
pub mod desktop;

#[cfg(target_os = "windows")]
pub mod windows_app;
