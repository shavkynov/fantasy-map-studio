#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
APP_NAME="Fantasy Map Studio.app"
APP_DIR="$ROOT_DIR/$APP_NAME"
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RES_DIR="$CONTENTS_DIR/Resources"

cd "$ROOT_DIR"
cargo build --release -p fms-studio

rm -rf "$APP_DIR"
mkdir -p "$MACOS_DIR" "$RES_DIR"

cp "$ROOT_DIR/target/release/fms-studio" "$MACOS_DIR/fms-studio"
chmod +x "$MACOS_DIR/fms-studio"
cp -R "$ROOT_DIR/fms-render/assets" "$RES_DIR/assets"

cat > "$CONTENTS_DIR/Info.plist" << 'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>ru</string>
  <key>CFBundleExecutable</key>
  <string>fms-studio</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>io.fantasymapstudio.app</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Fantasy Map Studio</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>0.1.0</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

ICONSET_TMP="$(mktemp -d /tmp/fms_iconset.XXXXXX)"
ICONSET_DIR="$ICONSET_TMP/AppIcon.iconset"
mkdir -p "$ICONSET_DIR"

python3 - "$ROOT_DIR/fms-render/assets/sprites/compass_0.rgba" "$ICONSET_DIR/icon_512x512@2x.png" << 'PY'
import struct, sys, zlib

spr_path, out_png = sys.argv[1], sys.argv[2]
with open(spr_path, "rb") as f:
    w, h, _, _ = struct.unpack("<IIff", f.read(16))
    rgba = f.read(w * h * 4)

S = 1024
buf = bytearray(S * S * 4)
R = 220
CR = 220
# Rounded dark walnut parchment badge with double gold rim
for y in range(S):
    dy = max(0, abs(y - S / 2 + 0.5) - (S / 2 - R))
    row_off = y * S * 4
    for x in range(S):
        dx = max(0, abs(x - S / 2 + 0.5) - (S / 2 - R))
        d = (dx * dx + dy * dy) ** 0.5
        if d > CR:
            continue
        edge_a = min(1.0, max(0.0, CR - d))
        grad = (x + y) / (2.0 * S)
        # gold bezel between CR-24 and CR-6
        if CR - 24 <= d <= CR - 6:
            r, g, b = int(212 - 42 * grad), int(166 - 38 * grad), int(86 - 24 * grad)
        else:
            r, g, b = int(42 - 16 * grad), int(33 - 12 * grad), int(23 - 9 * grad)
        idx = row_off + x * 4
        buf[idx] = r
        buf[idx + 1] = g
        buf[idx + 2] = b
        buf[idx + 3] = int(round(edge_a * 255))

# Composite scaled compass sprite at center
target_sz = int(S * 0.72)
ox = (S - target_sz) // 2
oy = (S - target_sz) // 2
for ty in range(target_sz):
    sy = min(h - 1, int(ty * h / target_sz))
    for tx in range(target_sz):
        sx = min(w - 1, int(tx * w / target_sz))
        si = (sy * w + sx) * 4
        sa = rgba[si + 3] / 255.0
        if sa <= 0.01:
            continue
        di = ((oy + ty) * S + (ox + tx)) * 4
        da = buf[di + 3] / 255.0
        if da <= 0.01:
            continue
        sr = min(255, int(rgba[si] * 1.18 + 26))
        sg = min(255, int(rgba[si + 1] * 1.12 + 20))
        sb = min(255, int(rgba[si + 2] * 1.05 + 10))
        buf[di] = int(buf[di] * (1.0 - sa) + sr * sa)
        buf[di + 1] = int(buf[di + 1] * (1.0 - sa) + sg * sa)
        buf[di + 2] = int(buf[di + 2] * (1.0 - sa) + sb * sa)

def chunk(tag, data):
    return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

raw_rows = b"".join(b"\x00" + bytes(buf[y * S * 4 : (y + 1) * S * 4]) for y in range(S))
png = (
    b"\x89PNG\r\n\x1a\n"
    + chunk(b"IHDR", struct.pack(">IIBBBBB", S, S, 8, 6, 0, 0, 0))
    + chunk(b"IDAT", zlib.compress(raw_rows, 6))
    + chunk(b"IEND", b"")
)
with open(out_png, "wb") as f:
    f.write(png)
PY

sips -z 16 16     "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32     "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64     "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256   "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512   "$ICONSET_DIR/icon_512x512@2x.png" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
cp "$ICONSET_DIR/icon_512x512@2x.png" "$ICONSET_DIR/icon_512x512.png"

iconutil -c icns "$ICONSET_DIR" -o "$RES_DIR/AppIcon.icns"
rm -rf "$ICONSET_TMP"

codesign --force --deep --sign - "$APP_DIR"
echo "Готово: $APP_DIR"
