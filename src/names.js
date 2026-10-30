// Названия: фэнтезийные, строятся по фонетике расы (люди, эльфы, гномы, орки), без корней реальных языков.
// Имена собираются в латинской записи и при языке интерфейса «ru» переводятся в кириллицу (FM.translit).
(function (FM) {
  'use strict';
  const RACES = {
    human: {
      label: 'Люди',
      C: ['b', 'd', 'g', 'k', 'l', 'm', 'n', 'r', 's', 't', 'v', 'z', 'br', 'dr', 'gr', 'kr', 'tr', 'st', 'sk', 'vr'], V: ['a', 'a', 'e', 'e', 'o', 'o', 'i', 'u'], K: ['n', 'r', 'l', 's', 'm', 'd', 't', 'k'], codaP: 0.45, maxCons: 3,
      city: ['ros', 'dan', 'vel', 'mar', 'nor', 'ras', 'kan', 'sel', 'dis', 'tren', 'vos', 'gar', 'dova', 'mira', 'sena'],
      state: ['ria', 'dia', 'nora', 'vena', 'tia', 'sara', 'nia', 'gora', 'dania', 'kasia', 'vora']
    },
    elf: {
      label: 'Эльфы',
      C: ['l', 'r', 'n', 's', 'th', 'v', 'f', 'm', 'sh', 'h'], V: ['a', 'e', 'i', 'o', 'ai', 'ei', 'ia', 'ie', 'io', 'a', 'e'], K: ['l', 'n', 'r', 's', 'th', 'l', 'n'], codaP: 0.3, maxCons: 2,
      city: ['iel', 'alis', 'erin', 'ilis', 'ethel', 'orin', 'aris', 'iras', 'elis', 'alar', 'ilan', 'ennis'],
      state: ['ialis', 'ethra', 'elonia', 'ilar', 'orelle', 'iana', 'aleth', 'ionel', 'ethiel']
    },
    dwarf: {
      label: 'Гномы',
      C: ['b', 'd', 'g', 'k', 'm', 'r', 'z', 't', 'th', 'kh', 'br', 'dr', 'gr', 'kr', 'thr', 'zh'], V: ['a', 'o', 'u', 'o', 'a', 'u', 'i'], K: ['k', 'r', 'g', 'm', 'n', 'd', 'z', 'rk', 'gr', 'nd', 'rn'], codaP: 0.75, maxCons: 3,
      city: ['dum', 'grim', 'gar', 'kaz', 'zul', 'mor', 'drak', 'rok', 'bar', 'thum', 'dun', 'gund', 'brok', 'zund'],
      state: ['garn', 'dorn', 'kazur', 'morak', 'zundar', 'khorn', 'bordun', 'tharum', 'grunor']
    },
    orc: {
      label: 'Орки',
      C: ['g', 'k', 'z', 'm', 'r', 'sh', 'gr', 'kr', 'zh', 'dr', 'ug', 'th', 'd', 'b'], V: ['u', 'o', 'a', 'u', 'o'], K: ['g', 'k', 'r', 'sh', 'z', 'rk', 'gh', 'ng', 'd'], codaP: 0.7, maxCons: 3,
      city: ['gash', 'nak', 'mog', 'zul', 'rok', 'dush', 'bag', 'gul', 'krag', 'mash', 'thrak', 'zug'],
      state: ['gorash', 'murzak', 'zugdar', 'kragash', 'dushkar', 'bagrum', 'ushgor']
    }
  };
  FM.RACES = RACES;
  FM.uiLang = 'ru';

  // ---------- латиница → кириллица ----------
  const DG = [['sh', 'ш'], ['zh', 'ж'], ['kh', 'х'], ['ch', 'ч'], ['th', 'т'], ['ng', 'нг'], ['ai', 'ай'], ['ei', 'эй'], ['oi', 'ой'], ['gh', 'г']];
  const SG = { a: 'а', b: 'б', d: 'д', f: 'ф', g: 'г', h: 'х', i: 'и', j: 'дж', k: 'к', l: 'л', m: 'м', n: 'н', o: 'о', p: 'п', q: 'к', r: 'р', s: 'с', t: 'т', u: 'у', v: 'в', w: 'в', x: 'кс', y: 'и', z: 'з', c: 'к' };
  const VOW = 'aeiouy';
  FM.translit = function (s) {
    const t = s.toLowerCase(); let out = '';
    for (let i = 0; i < t.length;) {
      const pair = t.substr(i, 2), prev = i ? t[i - 1] : '';
      if (pair === 'ia' || pair === 'io' || pair === 'ie') {                 // ия на конце, иа/ио/ие внутри
        const r = pair === 'ia' ? (i + 2 >= t.length ? 'ия' : 'иа') : pair === 'io' ? 'ио' : 'ие'; out += r; i += 2; continue;
      }
      const dg = DG.find(d => d[0] === pair);
      if (dg) { out += dg[1]; i += 2; continue; }
      const ch = t[i++];
      if (ch === 'e') { out += (!prev || VOW.includes(prev)) ? 'э' : 'е'; continue; }
      out += SG[ch] !== undefined ? SG[ch] : ch;
    }
    return out.charAt(0).toUpperCase() + out.slice(1);
  };
  const finish = n => FM.uiLang === 'ru' ? FM.translit(n) : n.charAt(0).toUpperCase() + n.slice(1);
  const pick = (r, a) => a[Math.floor(r() * a.length)];

  function syllable(rand, ph, first) {
    const on = (first || rand() < 0.7) ? pick(rand, ph.C) : '';
    return on + pick(rand, ph.V) + (rand() < ph.codaP ? pick(rand, ph.K) : '');
  }
  function build(rand, race, kind) {
    const ph = RACES[race] || RACES.human, sufs = ph[kind];
    const nsyl = kind === 'state' ? 1 : (rand() < (race === 'dwarf' || race === 'orc' ? 0.35 : 0.55) ? 2 : 1);
    let base = ''; for (let i = 0; i < nsyl; i++) base += syllable(rand, ph, i === 0);
    const suf = pick(rand, sufs), V = 'aeiou';
    if (V.includes(base[base.length - 1]) && V.includes(suf[0])) base = base.slice(0, -1);
    if (!V.includes(base[base.length - 1]) && !V.includes(suf[0]) && rand() < 0.5) base += pick(rand, ph.V);   // три согласных подряд на стыке — смягчаем гласной
    let n = base + suf;
    n = n.replace(/(.)\1\1+/g, '$1$1');
    return n;
  }
  const ELF_PAIRS = ['ai', 'ei', 'ia', 'ie', 'io'];
  const ok = (n, ph, race) => {
    if (n.length < 4 || n.length > 9) return false;
    const m = n.match(/[aeiou]{2,}/g) || [];
    for (const v of m) if (race !== 'elf' || v.length > 2 || !ELF_PAIRS.includes(v)) return false;
    if (m.length > 1) return false;
    return !new RegExp('[bdfghklmnprstvz]{' + (ph.maxCons + 1) + ',}').test(n.replace(/sh|th|kh|zh|ch|gh|ng/g, 'S'));
  };
  function make(rand, used, race, kind) {
    const ph = RACES[race] || RACES.human;
    for (let t = 0; t < 80; t++) {
      const raw = build(rand, race, kind); if (!ok(raw, ph, race)) continue;
      const n = finish(raw);
      if (!used.has(n)) { used.add(n); return n; }
    }
    return (kind === 'state' ? 'Земля ' : 'Город ') + (used.size + 1);
  }
  FM.cityName = (rand, used, race) => make(rand, used, race || 'human', 'city');
  FM.stateName = (rand, used, race) => make(rand, used, race || 'human', 'state');

  // раса государства по местности вокруг столицы: горы — гномы, лес — эльфы, пустыня/степь/тундра — орки, остальное — люди (с долей случайности)
  // сродство рас с биомами: эльфы — леса/умеренный пояс, гномы — горы и холмы, орки — степи/пустоши/тундра, люди — равнины и побережья
  FM.raceAffinity = function (map, x, y, R) {
    const { W, H } = map; R = R || Math.max(4, Math.round(10 * W / 480));
    const a = { human: 0, elf: 0, dwarf: 0, orc: 0 }; let n = 0;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const nx = Math.round(x) + dx, ny = Math.round(y) + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const i = ny * W + nx; if (map.h[i] <= 0) continue; n++;
      const b = map.biome[i], mount = map.young[i] > 0.25 || map.old[i] > 0.4 || map.h[i] > 0.9, hill = map.h[i] > 0.6;
      if (mount) a.dwarf += 2.2; else if (hill) a.dwarf += 0.8;
      if (b === 4 || b === 3) a.elf += 1.3; else if (b === 8) a.elf += 0.9; else if (b === 5 && map.moist[i] > 0.5) a.elf += 0.3;
      if (b === 6 || b === 7 || b === 2) a.orc += 1.8; else if (b === 10) a.orc += 0.3; else if (b === 9) a.orc += 0.6;
      if (b === 5 || b === 7) a.human += 0.7; if (b === 4) a.human += 0.25; if (map.dist && map.dist[i] <= 4) a.human += 0.6; if (map.riverMask && map.riverMask[i]) a.human += 0.5;
    }
    n = Math.max(1, n); for (const k in a) a[k] /= n; return a;
  };
  FM.raceAt = function (map, x, y, rand) {
    const a = FM.raceAffinity(map, x, y); a.human += 0.1;   // люди — «по умолчанию» везде понемногу
    let t = 0; for (const k in a) t += a[k] ** 2; let r = rand() * t;
    for (const k in a) { r -= a[k] ** 2; if (r <= 0) return k; }
    return 'human';
  };
})(window.FM = window.FM || {});
