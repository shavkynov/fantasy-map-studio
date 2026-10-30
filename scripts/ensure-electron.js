#!/usr/bin/env node
// Проверяет, что бинарник Electron установлен, и чинит установку, если нет.
// Нужен потому, что на новых версиях Node/npm скрипт установки Electron может быть заблокирован
// или молча не распаковать архив. Запускается автоматически перед `npm start`.
const fs = require('fs');
const path = require('path');
const os = require('os');
const cp = require('child_process');

const root = path.join(__dirname, '..');
const eDir = path.join(root, 'node_modules', 'electron');
const plat = process.platform;
const arch = process.env.npm_config_arch || process.arch;
const PATH_TXT = { darwin: 'Electron.app/Contents/MacOS/Electron', linux: 'electron', win32: 'electron.exe' }[plat];

function ok() {
  try {
    const p = fs.readFileSync(path.join(eDir, 'path.txt'), 'utf8').trim();
    return fs.existsSync(path.join(eDir, 'dist', p));
  } catch (e) { return false; }
}
function findZip(dir, name) {
  let found = null;
  (function walk(d, depth) {
    if (found || depth > 3) return;
    let list; try { list = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const f of list) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p, depth + 1);
      else if (f.name === name) { found = p; return; }
    }
  })(dir, 0);
  return found;
}

if (!fs.existsSync(path.join(eDir, 'package.json'))) {
  console.error('\n[fantasy-map-studio] Не найдена папка node_modules/electron.\nСначала выполните:  npm install\n');
  process.exit(1);
}
if (ok()) process.exit(0);

console.log('[fantasy-map-studio] Electron не распакован, чиню установку…');
// 1) штатный установщик (скачает архив в кэш и попробует распаковать)
try { cp.execFileSync(process.execPath, [path.join(eDir, 'install.js')], { stdio: 'inherit' }); } catch (e) { /* пойдём дальше */ }
if (ok()) { console.log('[fantasy-map-studio] Готово.'); process.exit(0); }

// 2) ручная распаковка архива из кэша
const version = JSON.parse(fs.readFileSync(path.join(eDir, 'package.json'), 'utf8')).version;
const zipName = `electron-v${version}-${plat}-${arch}.zip`;
const cacheDirs = {
  darwin: [path.join(os.homedir(), 'Library', 'Caches', 'electron')],
  linux: [path.join(os.homedir(), '.cache', 'electron')],
  win32: [path.join(process.env.LOCALAPPDATA || '', 'electron', 'Cache')]
}[plat] || [];
let zip = null;
for (const d of cacheDirs) { zip = findZip(d, zipName); if (zip) break; }
if (!zip) {
  console.error(`\n[fantasy-map-studio] Не нашёл архив ${zipName} в кэше и не смог скачать.\nПроверьте интернет и запустите снова:  npm start\n`);
  process.exit(1);
}
const dist = path.join(eDir, 'dist');
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
try {
  if (plat === 'darwin') cp.execFileSync('ditto', ['-x', '-k', zip, dist], { stdio: 'inherit' });   // ditto сохраняет симлинки пакета .app
  else cp.execFileSync('unzip', ['-q', '-o', zip, '-d', dist], { stdio: 'inherit' });
  fs.writeFileSync(path.join(eDir, 'path.txt'), PATH_TXT);
} catch (e) {
  console.error('[fantasy-map-studio] Не удалось распаковать вручную:', e.message);
  process.exit(1);
}
if (!ok()) { console.error('[fantasy-map-studio] Установка Electron так и не заработала.'); process.exit(1); }
console.log('[fantasy-map-studio] Electron починен.');
