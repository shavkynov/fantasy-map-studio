#!/usr/bin/env node
// Выпуск версии: node scripts/release.js 0.90.0 "Что изменилось"
// Делает: проверку (npm run check) → номер версии в package.json и src/version.js → запись в конец CHANGELOG.txt.
// Затем: git commit, git tag v0.90.0, git push --tags. По метке GitHub соберёт установщики и приложит их к выпуску.
const fs = require('fs'), path = require('path'), cp = require('child_process');
const v = process.argv[2], note = process.argv[3];
if (!/^\d+\.\d+\.\d+$/.test(v || '') || !note) { console.error('Использование: node scripts/release.js X.Y.Z "что изменилось"'); process.exit(1); }
const root = path.join(__dirname, '..'), run = (c) => cp.execSync(c, { cwd: root, stdio: 'inherit' });
run(`node scripts/set-version.js ${v}`);
const cl = path.join(root, 'CHANGELOG.txt'), c = fs.readFileSync(cl, 'utf8').replace(/\s+$/, '');
const lines = note.split('\n').map((l) => (l.startsWith('- ') ? l : '- ' + l)).join('\n');
fs.writeFileSync(cl, `${c}\n\n${v}\n${lines}\n`);
run('node scripts/check.js');
console.log(`Готово. Дальше:\n  git add -A && git commit -m "Версия ${v}" && git tag v${v} && git push && git push --tags`);
