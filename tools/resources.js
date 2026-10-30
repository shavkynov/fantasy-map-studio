#!/usr/bin/env node
// Проверка ресурсов: число месторождений по видам на нескольких seed, «законы природы» (биом/рельеф/геология каждого вида), настройки, статус государств.
// node tools/resources.js [--special]
const { open, ready, populate } = require('./lib');
(async () => {
  const { b, p, errs } = await open('?seed=a'); await ready(p);
  const out = await p.evaluate((special) => {
    const res = { kinds: {}, viol: [], cfg: {}, states: [] }, seeds = ['alpha', 'beta', 'gamma', 'delta'];
    const cfg = FM.defaultResCfg(); if (special) cfg.on.special = true;
    for (const sd of seeds) {
      const m = FM.generate({ seed: sd, plateCount: 9, landRatio: 0.34, epochs: 2, continents: 3, W: 480, H: 320 }), R = FM.getResources(m, sd, cfg);
      for (const d of R.deposits) {
        const k = res.kinds[d.k] || (res.kinds[d.k] = { n: 0, acc: [0, 0, 0, 0, 0], biomes: {}, amt: 0, cat: d.t }); k.n++; k.acc[d.acc]++; k.amt += d.amt;
        const i = Math.round(d.y) * m.W + Math.round(d.x), bm = m.biome[i]; k.biomes[bm] = (k.biomes[bm] || 0) + 1;
        const kd = FM.RES_KINDS[d.k]; if (kd.biomesOK && !kd.biomesOK.includes(bm)) res.viol.push(d.k + ' в биоме ' + bm + ' (' + sd + ')');
      }
    }
    for (const k in res.kinds) res.kinds[k].amt = +(res.kinds[k].amt / res.kinds[k].n).toFixed(2);
    // настройки: выключенная категория не даёт месторождений; обильность монотонна; фэнтези по умолчанию выключено
    const m = FM.generate({ seed: 'alpha', plateCount: 9, landRatio: 0.34, epochs: 2, continents: 3, W: 480, H: 320 });
    const cnt = (c) => FM.getResources(m, 'alpha', c).deposits.length, d0 = FM.defaultResCfg();
    res.cfg.defaultSpecial = FM.getResources(m, 'alpha', d0).deposits.filter(d => d.t === 'special').length;
    const lo = FM.defaultResCfg(); for (const c of FM.RES_CATS) lo.amt[c] = 0.5; const hi = FM.defaultResCfg(); for (const c of FM.RES_CATS) hi.amt[c] = 2;
    res.cfg.counts = [cnt(lo), cnt(d0), cnt(hi)];
    const off = FM.defaultResCfg(); off.on.metal = false; res.cfg.metalOff = FM.getResources(m, 'alpha', off).deposits.filter(d => d.t === 'metal').length;
    const one = FM.defaultResCfg(); one.off = { iron: true }; res.cfg.ironOff = FM.getResources(m, 'alpha', FM.normResCfg(one)).deposits.filter(d => d.k === 'iron').length;
    return res;
  }, process.argv.includes('--special'));
  const rows = Object.entries(out.kinds).sort((a, b) => a[1].cat.localeCompare(b[1].cat) || b[1].n - a[1].n);
  const BN = { 1: 'лед', 2: 'тунд', 3: 'тайг', 4: 'лес', 5: 'равн', 6: 'пуст', 7: 'сав', 8: 'джун', 9: 'болт', 10: 'горы' };
  for (const [k, v] of rows) console.log(v.cat.padEnd(7), k.padEnd(12), String(v.n).padStart(4), 'дост.1-4:', v.acc.slice(1).join('/'), ' богатство', v.amt, ' биомы:', Object.entries(v.biomes).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([b2, n]) => BN[b2] + ' ' + Math.round(n / v.n * 100) + '%').join(' '));
  console.log('видов с месторождениями:', rows.length, '/', await p.evaluate(() => FM.RES_KIND_LIST.length), '(при special', process.argv.includes('--special') ? 'вкл)' : 'выкл)');
  console.log('нарушения ограничений биомов:', out.viol.length ? out.viol.slice(0, 10) : 'нет');
  console.log('настройки:', JSON.stringify(out.cfg));
  await b.close();
  // статус государств ↔ ресурсы: у каждого государства тип соответствует базе (империя не может иметь только камень)
  let bad = 0, total = 0, emp = 0;
  for (const seed of ['zeta', 'omega', 'kappa']) {
    const o = await open('?seed=' + seed); await ready(o.p, seed); await populate(o.p);
    const r = await o.p.evaluate(() => { const st = __state, prof = FM.stateResources(st.map, st.pol, st.seed, st.resCfg), out = [];
      for (const s of st.pol.states) { const p = prof.by.get(s.id); out.push({ type: s.type, ok: s.type === 'nomads' || FM.stateFits(s.type, p, prof.enabledCore), div: p.div, cats: Object.keys(p.cats).length }); } return out; });
    for (const q of r) { total++; if (!q.ok) bad++; if (q.type === 'empire') { emp++; if (q.div < 4) bad++; } }
    console.log('  ' + seed + ': государств ' + r.length + ', типы: ' + [...new Set(r.map(q => q.type))].join('/') + ', несоответствий ' + r.filter(q => !q.ok).length);
    errs.push(...o.errs); await o.b.close();
  }
  console.log('статус ↔ ресурсы: проверено ' + total + ', империй ' + emp + ', несоответствий ' + bad);
  if (bad) errs.push('статус не соответствует ресурсам');
  console.log(errs.length ? 'ОШИБКИ: ' + errs.length : 'ошибок нет'); process.exit(errs.length ? 1 : 0);
})();
