#!/usr/bin/env node
// Статическая проверка «необъявленных имён» во всех src/*.js (ловит опечатки и забытые импорты после правок/разбиения модулей).
// Использование: node scripts/lint-undef.js   (нужен пакет typescript: ищется локально, затем в /opt/npm-tools)
const fs = require('fs'), path = require('path');
let ts; for (const p of ['typescript', '/opt/npm-tools/node_modules/typescript']) { try { ts = require(p); break; } catch (e) {} }
if (!ts) { console.log('typescript не найден — проверка пропущена'); process.exit(0); }
const src = path.join(__dirname, '..', 'src');
const files = fs.readdirSync(src).filter(f => f.endsWith('.js')).map(f => path.join(src, f));
const shim = path.join(require('os').tmpdir(), 'fm-shim.d.ts'); fs.writeFileSync(shim, 'declare var FM: any;\ninterface Window { FM: any; api: any; __state: any }\n');
const prog = ts.createProgram([shim, ...files], { allowJs: true, checkJs: true, noEmit: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'], target: ts.ScriptTarget.ES2022, skipLibCheck: true, strict: false, noImplicitAny: false });
let n = 0;
for (const d of ts.getPreEmitDiagnostics(prog)) {
  if (![2304, 2552].includes(d.code) || !d.file || !files.includes(d.file.fileName)) continue;   // Cannot find name
  const { line } = d.file.getLineAndCharacterOfPosition(d.start);
  console.log(`${path.basename(d.file.fileName)}:${line + 1}: ${ts.flattenDiagnosticMessageText(d.messageText, ' ')}`); n++;
}
console.log(n ? `Найдено проблем: ${n}` : 'OK: необъявленных имён нет');
process.exit(n ? 1 : 0);
