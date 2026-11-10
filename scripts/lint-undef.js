#!/usr/bin/env node
// Проверка необъявленных имён; известные UMD-экспорты страницы объявлены явно.
const fs = require('fs'), path = require('path');
let ts; for (const p of ['typescript', '/opt/npm-tools/node_modules/typescript']) { try { ts = require(p); break; } catch (e) {} }
if (!ts) { console.log('typescript не найден — проверка пропущена'); process.exit(0); }
const src = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(src).filter(f => f.endsWith('.js')).map(f => path.join(src, f));
const browserModules = [
  'ThreeBlockPrototype', 'EqualAreaABCandidate', 'RegionalMaterialTerrain',
  'MaterialReliefLayer', 'RegionalReliefIntegration', 'TerrainEditSession',
  'TerrainEditCore', 'SphericalDrainage', 'BasinSpillHierarchy',
  'CoupledBasinWater', 'BasinFillSpill',
  'RainfallRunoffRouting', 'RunoffReachNetwork', 'RunoffReachDisplay'
];
const shim = path.join(require('os').tmpdir(), 'fm-shim.d.ts');
fs.writeFileSync(shim, 'declare var FM: any;\ninterface Window { FM: any; api: any; __state: any }\n' + browserModules.map(name => 'declare var ' + name + ': any;').join('\n') + '\n');
const prog = ts.createProgram([shim, ...files], { allowJs: true, checkJs: true, noEmit: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], target: ts.ScriptTarget.ES2022, skipLibCheck: true, strict: false, noImplicitAny: false });
let n = 0;
for (const d of ts.getPreEmitDiagnostics(prog)) {
  if (![2304, 2552].includes(d.code) || !d.file || !files.includes(d.file.fileName)) continue;
  const { line } = d.file.getLineAndCharacterOfPosition(d.start);
  console.log(`${path.basename(d.file.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`); n++;
}
console.log(n ? `Найдено проблем: ${n}` : 'OK: необъявленных имён нет');
process.exit(n ? 1 : 0);
