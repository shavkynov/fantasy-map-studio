'use strict';
// Интегрированная тестовая сборка: основное приложение + Natural World v3 (единственная модель) + мировой атлас, размер мира всегда самый большой.
// Меняет рабочее дерево (запускать в чистой копии/CI): включает v3, ставит genVersion 3 в параметры генерации, подключает атлас,
// вырезает прототипы, кандидатные страницы и модули, не подключённые из index.html, и переименовывает сборку.
// Запуск: node scripts/prepare-test-build.cjs [--label natural-v3-atlas.1]
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const root = path.resolve(__dirname, '..'), src = path.join(root, 'src');
const label = (i => i > 0 ? process.argv[i + 1] : 'natural-v3-atlas.1')(process.argv.indexOf('--label'));
const run = (f) => cp.execFileSync(process.execPath, [path.join(__dirname, f)], { cwd: root, stdio: 'inherit' });
const once = (file, before, after) => { const p = path.join(root, file), s = fs.readFileSync(p, 'utf8'); if (s.split(before).length !== 2) throw Error('Contract changed in ' + file + ': ' + before.slice(0, 60)); fs.writeFileSync(p, s.replace(before, () => after)); };

run('enable-natural-v3.cjs'); run('prepare-world-atlas.cjs');
// мост сферического генератора (genVersion 4): подключение модулей и маршрут в генераторе; v3 остаётся только как поставщик финализатора
once('src/index.html', '<script src="natural-world-v3.js"></script>', '<script src="natural-world-v3.js"></script>\n  <script src="terrain-edit-spherical-base.js"></script>\n  <script src="spherical-moisture-transport.js"></script>\n  <script src="spherical-drainage.js"></script>\n  <script src="basin-spill-hierarchy.js"></script>\n  <script src="basin-fill-spill.js"></script>\n  <script src="coupled-basin-water.js"></script>\n  <script src="spherical-bridge.js"></script>');
once('src/generator.js', 'if (params.genVersion === 3) return yield* FM.naturalWorld.stages(params);', 'if (params.genVersion === 4) return yield* FM.sphericalBridge.stages(params);\n    if (params.genVersion === 3) return yield* FM.naturalWorld.stages(params);');
once('src/generator.js', "if (params.genVersion === 3 || (params.continents || 0) < 2 || (params.plates && params.plates.length)) return generateOnce(params);", "if (params.genVersion === 3 || params.genVersion === 4 || (params.continents || 0) < 2 || (params.plates && params.plates.length)) return generateOnce(params);");
once('src/generator.js', "if (params.genVersion === 3 || (params.continents || 0) < 2 || (params.plates && params.plates.length)) return step(params, 0);", "if (params.genVersion === 3 || params.genVersion === 4 || (params.continents || 0) < 2 || (params.plates && params.plates.length)) return step(params, 0);");
once('src/natural-world-v3.js', 'anchor.before(label,select,hint);', '/* выбор модели мира в тестовой сборке скрыт: всегда сферический мост */');
once('src/app.js', "view: 'map', theme: 'sepia', lang: 'ru',", "view: 'map', theme: 'atlas', lang: 'ru',");   // тема «Мировой атлас» по умолчанию
once('src/app.js', "seed: state.seed, plateCount: state.plateCount, landRatio: state.land / 100,", "genVersion: 4, seed: state.seed, plateCount: state.plateCount, landRatio: state.land / 100,");

// Раскладка материков для карты-полосы. Исходный генератор ставит центры «максимально далеко друг от друга» по всей сфере: при K=4 получается решётка (тетраэдр), при K=7 — шахматный порядок,
// а после ухода суши от полюсов всё ложится в одну линию вдоль экватора. Здесь центры ставятся случайно в поясе |широта|<42° с минимальным зазором по угловым радиусам материков
// (по площади), поэтому встречаются и группы, и одиночные материки; число материков до 8 (прежний предел 7 вешал генерацию с ошибкой). Форма материков (эллипс + гармоники) не меняется.
{ const p = path.join(src, 'terrain-edit-spherical-base.js'), t = fs.readFileSync(p, 'utf8'), i = t.indexOf('function layout(p,attempt){'), j = t.indexOf('function motion(');
  if (i < 0 || j < i || !t.includes('p.continents>7')) throw Error('terrain-edit-spherical-base.js contract changed (layout)');
  const layout = `function layout(p,attempt){
 const r=random(p.seed+'|'+LAYOUT_VERSION+'|layout|'+attempt),centers=[],ZB=Math.sin(42*Math.PI/180),share=p.landRatio/p.continents;
 const point=()=>{const z=(2*r()-1)*ZB,a=2*Math.PI*r(),c=Math.sqrt(1-z*z);return [c*Math.cos(a),c*Math.sin(a),z];};
 for(let k=0;k<p.continents;k++){
  const size=.88+.24*r(),rho=Math.acos(clamp(1-2*share*size*1.2,-1,1));let best=null,fallback=null,fb=-Infinity;
  for(let j=0;j<400&&!best;j++){const q=point(),gap=.1*(1-j/400);let ok=true,m=Infinity;for(const c of centers){const d=Math.acos(clamp(dot(c.center,q),-1,1)),need=c.rho+rho+gap;if(d<need)ok=false;m=Math.min(m,d-need);}if(ok)best=q;else if(m>fb){fb=m;fallback=q;}}
  best=best||fallback||point();
  const e=unit(cross(Math.abs(best[2])<.9?[0,0,1]:[1,0,0],best)),n=cross(best,e);centers.push({center:best,e,n,rho,phase:2*Math.PI*r(),stretch:.82+.36*r(),size,a:2*Math.PI*r(),b:2*Math.PI*r(),c:2*Math.PI*r()});
 }return centers;
}
`;
  fs.writeFileSync(p, (t.slice(0, i) + layout + t.slice(j)).replace('p.continents>7', 'p.continents>8').replace("Continents must be 1..7", "Continents must be 1..8")); }

// main.js: без меню «Прототип» и без окон прототипов
let m = fs.readFileSync(path.join(root, 'main.js'), 'utf8');
const a = m.indexOf('function openThreeBlockPrototype'), b = m.indexOf("ipcMain.handle('save-png'");
if (a < 0 || b < a) throw Error('main.js contract changed (prototype functions)');
m = m.slice(0, a) + m.slice(b);
const mi = m.indexOf("    { label: 'Прототип'"), mj = m.indexOf("    { role: 'windowMenu' }");
if (mi < 0 || mj < mi) throw Error('main.js contract changed (prototype menu)');
fs.writeFileSync(path.join(root, 'main.js'), m.slice(0, mi) + m.slice(mj));

// src: оставить только index.html, style.css и скрипты, подключённые из index.html
const html = fs.readFileSync(path.join(src, 'index.html'), 'utf8'), used = new Set([...html.matchAll(/<script src="([^"]+)"/g)].map(x => x[1]).concat(['index.html', 'style.css']));
for (const s of used) if (!fs.existsSync(path.join(src, s))) throw Error('index.html refers to missing ' + s);
const removed = []; for (const f of fs.readdirSync(src)) if (!used.has(f)) { fs.rmSync(path.join(src, f), { recursive: true }); removed.push(f); }

// имя и версия сборки
const pj = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')), ver = pj.version + '-test.' + label;
pj.build.extraMetadata = { version: ver, buildChannel: 'TEST', buildId: label };
pj.build.dmg.title = 'Fantasy Map Studio TEST ' + ver;
const an = 'FantasyMapStudio-TEST-' + label + '-${version}'; pj.build.artifactName = an + '.${ext}'; pj.build.nsis.artifactName = an + '-Setup.${ext}'; pj.build.linux.artifactName = an + '-linux-x64.${ext}';
// src/version.js: версия сборки и без плашки со ссылками на экспериментальные страницы (их в сборке нет)
{ const p = path.join(src, 'version.js'); let v = fs.readFileSync(p, 'utf8');
  const i = v.indexOf("    if (!document.getElementById('testBuildBanner')) {"), j = v.indexOf('  if (document.readyState');
  if (i < 0 || j < i) throw Error('version.js contract changed (banner)');
  v = v.slice(0, i) + '  }\n' + v.slice(j);
  const set = (k, val) => { const re = new RegExp("FM\\." + k + " = '[^']*';"); if (!re.test(v)) throw Error('version.js contract changed: ' + k); v = v.replace(re, "FM." + k + " = '" + val + "';"); };
  set('VERSION', ver); set('BUILD_ID', label);
  v += "\n(function(){ window.addEventListener('load', function(){ var s = document.getElementById('themeSeg'); if (s) [].forEach.call(s.children, function(b){ b.classList.toggle('on', b.dataset.t === 'atlas'); }); }); })();   // тема по умолчанию — «Мировой атлас»: подсветить её кнопку\n"; fs.writeFileSync(p, v); }
for (const k of Object.keys(pj.scripts)) if (k === 'prestart' || k === 'prepare:contacts' || k.startsWith('predist')) delete pj.scripts[k];   // кандидатных страниц в сборке нет, атлас уже подключён
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pj));
console.log(JSON.stringify({ version: ver, kept: used.size, removed: removed.length, removedFiles: removed }));
