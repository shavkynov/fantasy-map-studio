#!/usr/bin/env node
// Доли биомов на суше по нескольким seed (для проверки реалистичности климата). node tools/biomes.js [continents=2] [W=480]
const { open, ready } = require('./lib');
(async () => {
  const K = +(process.argv[2] || 2), W = +(process.argv[3] || 480), { b, p } = await open('?seed=a'); await ready(p);
  const out = await p.evaluate(([K, W]) => {
    const names = ['ocean', 'лёд', 'тундра', 'тайга', 'лес', 'степь', 'пустыня', 'саванна', 'джунгли', 'болото', 'альп'], tot = new Float64Array(11), rows = [];
    for (const seed of ['a1', 'b2', 'c3', 'd4', 'e5', 'f6']) {
      const m = FM.generate({ seed, plateCount: 9, landRatio: 0.34, epochs: 2, continents: K, W, H: Math.round(W * 2 / 3) }), c = new Float64Array(11); let land = 0;
      for (let i = 0; i < m.h.length; i++) if (m.h[i] > 0) { c[m.biome[i]]++; land++; }
      rows.push(seed + ': ' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => names[k] + ' ' + Math.round(c[k] / land * 100)).join(' | ')); for (let k = 0; k < 11; k++) tot[k] += c[k] / land / 6;
    }
    rows.push('СРЕДНЕЕ: ' + [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(k => names[k] + ' ' + Math.round(tot[k] * 100)).join(' | ')); return rows;
  }, [K, W]);
  console.log(out.join('\n')); await b.close();
})();
