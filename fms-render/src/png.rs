//! Кодировщик PNG (RGB и RGBA, без внешних зависимостей) и Base64 для автономного SVG.

use std::fs::File;
use std::io::{BufWriter, Write};

fn adler32(data: &[u8]) -> u32 {
    let (mut a, mut b) = (1u32, 0u32);
    for chunk in data.chunks(5552) {
        for &v in chunk {
            a += v as u32;
            b += a;
        }
        a %= 65521;
        b %= 65521;
    }
    (b << 16) | a
}

fn crc32(parts: &[&[u8]]) -> u32 {
    let mut table = [0u32; 256];
    for (i, t) in table.iter_mut().enumerate() {
        let mut c = i as u32;
        for _ in 0..8 {
            c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
        }
        *t = c;
    }
    let mut crc = 0xFFFF_FFFFu32;
    for part in parts {
        for &b in *part {
            crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
        }
    }
    !crc
}

fn push_chunk(out: &mut Vec<u8>, kind: &[u8; 4], data: &[u8]) {
    out.extend_from_slice(&(data.len() as u32).to_be_bytes());
    out.extend_from_slice(kind);
    out.extend_from_slice(data);
    out.extend_from_slice(&crc32(&[kind, data]).to_be_bytes());
}

fn encode_png_rows(w: usize, h: usize, color_type: u8, channels: usize, px: &[u8]) -> Vec<u8> {
    let stride = w * channels;
    let mut raw = Vec::with_capacity((stride + 1) * h);
    for y in 0..h {
        raw.push(0u8);
        raw.extend_from_slice(&px[y * stride..(y + 1) * stride]);
    }
    let mut z = Vec::with_capacity(raw.len() + 64);
    z.push(0x78u8);
    z.push(0x01u8);
    let mut pos = 0usize;
    while pos < raw.len() {
        let n = (raw.len() - pos).min(65535);
        let last = pos + n == raw.len();
        z.push(last as u8);
        z.extend_from_slice(&(n as u16).to_le_bytes());
        z.extend_from_slice(&(!(n as u16)).to_le_bytes());
        z.extend_from_slice(&raw[pos..pos + n]);
        pos += n;
    }
    z.extend_from_slice(&adler32(&raw).to_be_bytes());

    let mut out = Vec::with_capacity(z.len() + 128);
    out.extend_from_slice(&[0x89, b'P', b'N', b'G', 0x0D, 0x0A, 0x1A, 0x0A]);
    let mut ihdr = Vec::with_capacity(13);
    ihdr.extend_from_slice(&(w as u32).to_be_bytes());
    ihdr.extend_from_slice(&(h as u32).to_be_bytes());
    ihdr.extend_from_slice(&[8, color_type, 0, 0, 0]);
    push_chunk(&mut out, b"IHDR", &ihdr);
    push_chunk(&mut out, b"IDAT", &z);
    push_chunk(&mut out, b"IEND", &[]);
    out
}

/// Кодирует буфер RGB (3 байта/пиксель) в валидный PNG.
pub fn encode_png_rgb(w: usize, h: usize, rgb: &[u8]) -> Vec<u8> {
    assert_eq!(rgb.len(), w * h * 3);
    encode_png_rows(w, h, 2, 3, rgb)
}

/// Кодирует буфер straight-RGBA (4 байта/пиксель) в валидный PNG.
pub fn encode_png_rgba(w: usize, h: usize, rgba: &[u8]) -> Vec<u8> {
    assert_eq!(rgba.len(), w * h * 4);
    encode_png_rows(w, h, 6, 4, rgba)
}

/// Сохраняет RGB PNG на диск.
pub fn write_png_rgb(path: &str, w: usize, h: usize, rgb: &[u8]) -> std::io::Result<()> {
    let bytes = encode_png_rgb(w, h, rgb);
    let mut out = BufWriter::new(File::create(path)?);
    out.write_all(&bytes)
}

/// Сохраняет строковый XML/SVG-документ на диск.
pub fn write_svg_file(path: &str, svg: &str) -> std::io::Result<()> {
    let mut out = BufWriter::new(File::create(path)?);
    out.write_all(svg.as_bytes())
}

/// Базовое Base64-кодирование (RFC 4648).
pub fn base64_encode(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(((data.len() + 2) / 3) * 4);
    let mut i = 0;
    while i < data.len() {
        let b0 = data[i] as u32;
        let b1 = if i + 1 < data.len() { data[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < data.len() { data[i + 2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[((triple >> 18) & 0x3F) as usize] as char);
        out.push(TABLE[((triple >> 12) & 0x3F) as usize] as char);
        out.push(if i + 1 < data.len() { TABLE[((triple >> 6) & 0x3F) as usize] as char } else { '=' });
        out.push(if i + 2 < data.len() { TABLE[(triple & 0x3F) as usize] as char } else { '=' });
        i += 3;
    }
    out
}
