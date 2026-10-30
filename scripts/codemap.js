#!/usr/bin/env node
// Генерирует CODEMAP.md: для каждого src/*.js — размер, первая строка-описание и список верхнеуровневых функций/экспортов с номерами строк.
// Зачем: чтобы по задаче читать только нужные диапазоны строк, а не файлы целиком. Запуск: node scripts/codemap.js (его вызывает scripts/release.js)
const fs = require('fs'), path = require('path');
const src = path.join(__dirname, '..', 'src'), out = [];
out.push('# CODEMAP (генерируется: node scripts/codemap.js — не править руками)\n');
out.push('Порядок подключения — в `src/index.html`. Формат: `имя:строка`. Читай нужный диапазон: Read file offset=строка limit=60.\n');
for (const f of fs.readdirSync(src).filter(f => f.endsWith('.js')).sort()) {
  const lines = fs.readFileSync(path.join(src, f), 'utf8').split('\n');
  const desc = (lines.find(l => /^\s*\/\/ /.test(l)) || '').replace(/^\s*\/\/\s*/, '').slice(0, 110);
  const names = [];
  lines.forEach((l, i) => {
    let m;
    if ((m = l.match(/^  (?:async )?function\s+(\w+)/))) names.push(`${m[1]}:${i + 1}`);
    else if ((m = l.match(/^  FM\.(\w+)\s*=/))) names.push(`FM.${m[1]}:${i + 1}`);
    else if ((m = l.match(/^  const (\w+)\s*=\s*(?:\(|function|async|[a-zA-Z_]+\s*=>)/))) names.push(`${m[1]}:${i + 1}`);
    else if ((m = l.match(/^  \/\/ -{3,}\s*(.+?)\s*-{3,}/))) names.push(`§${m[1]}:${i + 1}`);
  });
  out.push(`## ${f} (${lines.length} стр.)${desc ? ' — ' + desc : ''}`);
  out.push(names.join(', ') || '—');
  out.push('');
}
fs.writeFileSync(path.join(__dirname, '..', 'CODEMAP.md'), out.join('\n'));
console.log('CODEMAP.md обновлён');
