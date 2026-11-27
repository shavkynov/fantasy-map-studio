//! Нативное десктопное окно Windows (`WebView2` через `tao` + `wry` + `rfd`),
//! открывающее студию в отдельном окне без консоли, системного браузера и сетевого порта.

use crate::server::StudioApp;
use std::path::PathBuf;
use std::sync::Arc;
use tao::dpi::LogicalSize;
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoop};
use tao::window::{Icon, Theme, WindowBuilder};
use wry::http::{header, Response};
use wry::{WebContext, WebViewBuilder, WebViewBuilderExtWindows};

pub fn run() -> Result<(), String> {
    let app = Arc::new(StudioApp::new()?);

    let event_loop = EventLoop::new();
    let icon = build_compass_icon();
    let mut wb = WindowBuilder::new()
        .with_title("Fantasy Map Studio")
        .with_inner_size(LogicalSize::new(1440.0, 920.0))
        .with_min_inner_size(LogicalSize::new(1020.0, 680.0))
        .with_theme(Some(Theme::Dark))
        .with_background_color((23, 19, 14, 255));
    if let Some(ic) = icon {
        wb = wb.with_window_icon(Some(ic));
    }
    let window = wb.build(&event_loop).map_err(|e| format!("Ошибка создания окна Windows: {e}"))?;

    let data_dir = webview2_data_dir();
    let _ = std::fs::create_dir_all(&data_dir);
    let mut web_context = WebContext::new(Some(data_dir));

    let proto_app = Arc::clone(&app);
    let ipc_app = Arc::clone(&app);

    let builder = WebViewBuilder::new_with_web_context(&mut web_context)
        .with_background_color((23, 19, 14, 255))
        .with_theme(wry::Theme::Dark)
        .with_devtools(true)
        .with_asynchronous_custom_protocol("fms".into(), move |_id, request, responder| {
            let target = request
                .uri()
                .path_and_query()
                .map(|pq| pq.as_str().to_string())
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "/".to_string());
            let app_ref = Arc::clone(&proto_app);
            let resp_slot = Arc::new(std::sync::Mutex::new(Some(responder)));
            let resp_worker = Arc::clone(&resp_slot);
            let spawn_res = std::thread::Builder::new()
                .name("fms-wv2-req".into())
                .stack_size(8 * 1024 * 1024)
                .spawn(move || {
                    let resp = app_ref.handle_raw_target(&target);
                    let mut rb = Response::builder()
                        .status(resp.status)
                        .header(header::CONTENT_TYPE, resp.content_type)
                        .header(header::CACHE_CONTROL, "no-store");
                    if let Some(disp) = &resp.disposition {
                        rb = rb.header(header::CONTENT_DISPOSITION, disp.as_str());
                    }
                    let http_resp = rb.body(resp.body).unwrap_or_else(|_| {
                        Response::builder()
                            .status(500)
                            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                            .body(b"Internal response build error".to_vec())
                            .unwrap()
                    });
                    if let Ok(mut guard) = resp_worker.lock() {
                        if let Some(r) = guard.take() {
                            r.respond(http_resp);
                        }
                    }
                });
            if spawn_res.is_err() {
                if let Ok(mut guard) = resp_slot.lock() {
                    if let Some(r) = guard.take() {
                        let err_resp = Response::builder()
                            .status(500)
                            .header(header::CONTENT_TYPE, "text/plain; charset=utf-8")
                            .body(b"Failed to spawn worker thread".to_vec())
                            .unwrap();
                        r.respond(err_resp);
                    }
                }
            }
        })
        .with_ipc_handler(move |req| {
            let payload = req.body().as_str();
            if let Some(rest) = payload.strip_prefix("SAVE_B64\n") {
                if let Some((filename, b64)) = rest.split_once('\n') {
                    let filename = sanitize_save_name(filename);
                    let bytes = decode_base64(b64);
                    if !bytes.is_empty() {
                        spawn_save_dialog(filename, bytes);
                    }
                }
            } else if let Some(rest) = payload.strip_prefix("SAVE_URL\n") {
                if let Some((filename, raw_url)) = rest.split_once('\n') {
                    let filename = sanitize_save_name(filename);
                    let target = strip_custom_origin(raw_url);
                    let app_ref = Arc::clone(&ipc_app);
                    let _ = std::thread::Builder::new()
                        .name("fms-wv2-save".into())
                        .stack_size(8 * 1024 * 1024)
                        .spawn(move || {
                            let resp = app_ref.handle_raw_target(&target);
                            if resp.status == 200 && !resp.body.is_empty() {
                                show_save_dialog_and_write(&filename, &resp.body);
                            }
                        });
                }
            }
        })
        .with_url("http://fms.localhost/");

    let webview = match builder.build(&window) {
        Ok(wv) => wv,
        Err(err) => {
            let msg = format!(
                "Не удалось инициализировать встроенное окно Microsoft Edge WebView2.\n\n\
                 Установите WebView2 Evergreen Runtime (https://developer.microsoft.com/microsoft-edge/webview2/) \
                 или запустите программу в веб-режиме: FantasyMapStudio.exe --web\n\nДетали: {err}"
            );
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("Fantasy Map Studio — ошибка запуска WebView2")
                .set_description(&msg)
                .show();
            return Err(format!("WebView2 build error: {err}"));
        }
    };

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        let _ = (&webview, &web_context);
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
}

fn webview2_data_dir() -> PathBuf {
    if let Some(base) = std::env::var_os("LOCALAPPDATA") {
        if !base.is_empty() {
            return PathBuf::from(base).join("FantasyMapStudio").join("WebView2");
        }
    }
    std::env::temp_dir().join("FantasyMapStudio-WebView2")
}

fn sanitize_save_name(name: &str) -> String {
    let cleaned: String = name
        .trim()
        .chars()
        .map(|c| if matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') { '_' } else { c })
        .collect();
    if cleaned.is_empty() {
        "map.png".to_string()
    } else {
        cleaned
    }
}

fn strip_custom_origin(raw: &str) -> String {
    for prefix in ["http://fms.localhost", "https://fms.localhost", "fms://app"] {
        if let Some(rest) = raw.strip_prefix(prefix) {
            return if rest.starts_with('/') {
                rest.to_string()
            } else {
                format!("/{rest}")
            };
        }
    }
    if raw.starts_with('/') {
        raw.to_string()
    } else {
        format!("/{raw}")
    }
}

fn spawn_save_dialog(filename: String, bytes: Vec<u8>) {
    let _ = std::thread::Builder::new()
        .name("fms-save-dlg".into())
        .spawn(move || {
            show_save_dialog_and_write(&filename, &bytes);
        });
}

fn show_save_dialog_and_write(filename: &str, bytes: &[u8]) {
    if let Some(path) = rfd::FileDialog::new()
        .set_title("Сохранить карту")
        .set_file_name(filename)
        .save_file()
    {
        if let Err(e) = std::fs::write(&path, bytes) {
            rfd::MessageDialog::new()
                .set_level(rfd::MessageLevel::Error)
                .set_title("Ошибка сохранения")
                .set_description(&format!("Не удалось записать файл {}: {e}", path.display()))
                .show();
        }
    }
}

fn decode_base64(input: &str) -> Vec<u8> {
    fn val(b: u8) -> Option<u8> {
        match b {
            b'A'..=b'Z' => Some(b - b'A'),
            b'a'..=b'z' => Some(b - b'a' + 26),
            b'0'..=b'9' => Some(b - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity((input.len() * 3) / 4);
    let mut buf = [0u8; 4];
    let mut len = 0usize;
    for &b in input.as_bytes() {
        if b == b'=' {
            break;
        }
        if let Some(v) = val(b) {
            buf[len] = v;
            len += 1;
            if len == 4 {
                out.push((buf[0] << 2) | (buf[1] >> 4));
                out.push((buf[1] << 4) | (buf[2] >> 2));
                out.push((buf[2] << 6) | buf[3]);
                len = 0;
            }
        }
    }
    if len == 2 {
        out.push((buf[0] << 2) | (buf[1] >> 4));
    } else if len == 3 {
        out.push((buf[0] << 2) | (buf[1] >> 4));
        out.push((buf[1] << 4) | (buf[2] >> 2));
    }
    out
}

fn build_compass_icon() -> Option<Icon> {
    const S: usize = 64;
    let mut rgba = vec![0u8; S * S * 4];
    let c = (S as f64 - 1.0) * 0.5;
    let r = 28.0;
    for y in 0..S {
        for x in 0..S {
            let dx = x as f64 - c;
            let dy = y as f64 - c;
            let dist = dx.hypot(dy);
            if dist > r {
                continue;
            }
            let edge = (r - dist).clamp(0.0, 1.0);
            let idx = (y * S + x) * 4;
            let (mut pr, mut pg, mut pb) = if dist >= r - 3.5 {
                (212u8, 166u8, 86u8)
            } else {
                (40u8, 31u8, 22u8)
            };
            // Четырёхконечная картографическая звезда компаса в центре
            let ax = dx.abs();
            let ay = dy.abs();
            let in_star = (ax < 18.0 && ay <= (18.0 - ax) * 0.28)
                || (ay < 18.0 && ax <= (18.0 - ay) * 0.28);
            if in_star {
                if (dx >= 0.0) == (dy <= 0.0) {
                    pr = 232;
                    pg = 196;
                    pb = 128;
                } else {
                    pr = 166;
                    pg = 132;
                    pb = 74;
                }
            }
            rgba[idx] = pr;
            rgba[idx + 1] = pg;
            rgba[idx + 2] = pb;
            rgba[idx + 3] = (edge * 255.0).round() as u8;
        }
    }
    Icon::from_rgba(rgba, S as u32, S as u32).ok()
}
