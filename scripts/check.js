'use strict';

// Быстрая проверка проекта одной командой: npm run check
// Синтаксис всех файлов программы и скриптов, затем поиск необъявленных имён в src/.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
let failed = 0;
const fail = (msg) => { failed += 1; console.error(`✗ ${msg}`); };

function syntax(file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) fail(`синтаксис ${path.relative(root, file)}\n${r.stderr}`);
}

for (const f of ['main.js', 'preload.js']) syntax(path.join(root, f));
for (const dir of ['src', 'scripts', 'tools']) {
  for (const f of fs.readdirSync(path.join(root, dir))) if (f.endsWith('.js')) syntax(path.join(root, dir, f));
}

const lint = spawnSync(process.execPath, [path.join(__dirname, 'lint-undef.js')], { encoding: 'utf8' });
process.stdout.write(lint.stdout || '');
if (lint.status !== 0) fail(`необъявленные имена\n${lint.stderr}`);

const flowHistoryTest = spawnSync(process.execPath, [path.join(root, 'tools', 'terrain-edit-flow-history-test.cjs')], { encoding: 'utf8' });
process.stdout.write(flowHistoryTest.stdout || '');
if (flowHistoryTest.status !== 0) fail(`история стока\n${flowHistoryTest.stderr}`);

const flowClassificationTest = spawnSync(process.execPath, [path.join(root, 'tools', 'runoff-flow-classification-test.cjs')], { encoding: 'utf8' });
process.stdout.write(flowClassificationTest.stdout || '');
if (flowClassificationTest.status !== 0) fail(`классификация стока\n${flowClassificationTest.stderr}`);

const forcingRealCoreTest = spawnSync(process.execPath, [path.join(root, 'tools', 'terrain-edit-forcing-real-core-test.cjs')], { encoding: 'utf8' });
process.stdout.write(forcingRealCoreTest.stdout || '');
if (forcingRealCoreTest.status !== 0) fail(`переменные воздействия на реальном водном ядре\n${forcingRealCoreTest.stderr}`);

const waterScheduleTest = spawnSync(process.execPath, [path.join(root, 'tools', 'terrain-edit-water-schedule-test.cjs')], { encoding: 'utf8' });
process.stdout.write(waterScheduleTest.stdout || '');
if (waterScheduleTest.status !== 0) fail(`расписание водной сессии\n${waterScheduleTest.stderr}`);

if (failed) { console.error(`\nПроверка не пройдена: ${failed}`); process.exit(1); }
console.log('✓ Проверка пройдена');
