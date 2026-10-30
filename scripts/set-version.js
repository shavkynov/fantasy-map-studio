#!/usr/bin/env node
// Использование: node scripts/set-version.js 0.5.0
// Обновляет номер версии в package.json и src/version.js (единый источник — package.json).
const fs = require('fs'), path = require('path');
const v = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(v || '')) { console.error('Укажите версию вида 0.5.0'); process.exit(1); }
const root = path.join(__dirname, '..');
const pj = path.join(root, 'package.json');
const j = JSON.parse(fs.readFileSync(pj, 'utf8')); j.version = v;
fs.writeFileSync(pj, JSON.stringify(j, null, 2) + '\n');
fs.writeFileSync(path.join(root, 'src', 'version.js'), `window.FM = window.FM || {};\nFM.VERSION = '${v}';\n`);
console.log('Версия:', v, '(package.json, src/version.js)');
