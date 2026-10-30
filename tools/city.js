#!/usr/bin/env node
// Карта города отдельным PNG. node tools/city.js [тип: capital|city|town|village|port|fortress|mine|ruin] [--seed s] [--theme sepia] [--out /tmp/city.png]
const { open, ready, populate } = require('./lib');
const a = process.argv.slice(2), arg = (k, d) => { const i = a.indexOf('--' + k); return i >= 0 ? a[i + 1] : d; };
(async () => {
  const type = a[0] && a[0][0] !== '-' ? a[0] : 'city', seed = arg('seed', 'zeta'), { b, p, errs } = await open(`?seed=${seed}`);
  await ready(p, seed); await populate(p);
  const r = await p.evaluate(([t, th]) => { const s = __state, all = FM.allCities(s.pol), c = all.find(q => q.type === t) || all[0]; const cv = FM.renderCity(FM.cityPlan(s.map, s.pol, c, {}), { theme: th, scale: 1 }); return c.type + '|' + c.name + '|' + cv.toDataURL('image/png'); }, [type, arg('theme', 'sepia')]);
  const [t, n, d] = r.split('|'), out = arg('out', '/tmp/city.png'); require('fs').writeFileSync(out, Buffer.from(d.split(',')[1], 'base64'));
  console.log(t, n, '→', out, errs.length ? `ОШИБОК: ${errs.length}` : ''); await b.close(); process.exit(errs.length ? 1 : 0);
})();
