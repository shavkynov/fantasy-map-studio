(function (root) {
'use strict';
// Editor panel "Шкала высот": shows and sets the physical scale of the current map and imports a height raster in metres.
// Works on the workspace object (info, setScale, stageImported, hold, subscribe); no height or water logic lives here.

const MAX_FILE_BYTES = 32 * 1024 * 1024;

function installUI(doc, win, getWork, repaint) {
  const Scale = win.ElevationScale, Imp = win.ElevationImport, Files = win.ElevationRasterFile;
  if (!Scale || !Imp || !Files) return null;
  const importer = Imp.create(Scale), fieldset = doc.querySelector('fieldset');
  if (!fieldset) return null;
  const panel = doc.createElement('section');
  panel.innerHTML = '<h2>Шкала высот · метры и километры</h2>'
    + '<pre id="elevStatus" role="status"></pre>'
    + '<p><label>Радиус планеты, км <input id="elevRadius" type="number" min="' + Scale.MIN_RADIUS_KM + '" max="' + Scale.MAX_RADIUS_KM + '" step="1" value="' + Scale.EARTH_RADIUS_KM + '"></label> '
    + '<label>Метров на единицу высоты <input id="elevMpu" type="number" min="1" step="100" value="' + Scale.DEFAULT_METERS_PER_UNIT + '"></label> '
    + '<button id="elevApply" disabled>Задать шкалу карте</button> <button id="elevClear" disabled>Снять шкалу</button></p>'
    + '<p><label>Растр высот (16-битный серый PNG или JSON) <input id="elevFile" type="file" accept=".png,.json,application/json,image/png" disabled></label></p>'
    + '<p><label>PNG: метры для чёрного <input id="elevMin" type="number" value="-500"></label> <label>для белого <input id="elevMax" type="number" value="8500"></label> '
    + '<label>Уровень воды, м <input id="elevSea" type="number" value="0"></label></p>'
    + '<p id="elevMessage" role="status">Импорт заменяет текущую карту; радиус и метры на единицу берутся из полей выше. Океан в растре (ниже уровня воды) глубины не сохраняет.</p>';
  fieldset.before(panel);
  const get = id => doc.getElementById(id);
  let timer = null, subscribed = null;

  function sphereStats(work) {
    const info = work.info(), s = work.session.snapshot(), Relief = win.RegionalReliefIntegration;
    if (!info.scale || !Relief) return null;
    return Scale.fromRecord(info.scale).describe(Relief.build({ w: s.w, h: s.h, land: s.land }, s.height));
  }
  function render() {
    timer = null;
    const work = getWork(); if (!work) return;
    const info = work.info(), snap = work.session.snapshot(), busy = snap.busy;
    for (const id of ['elevApply', 'elevClear', 'elevFile']) get(id).disabled = busy;
    get('elevClear').disabled = busy || !info.scale;
    if (!info.scale) { get('elevStatus').textContent = 'Шкала не задана: высоты условные (относительные единицы).'; return; }
    let d = null; try { d = sphereStats(work); } catch (e) { get('elevStatus').textContent = 'Шкала задана, но сводка недоступна: ' + e.message; return; }
    const r = info.scale, n = v => Math.round(v).toLocaleString('ru-RU');
    get('elevStatus').textContent = 'Радиус ' + n(r.radiusKm) + ' км; 1,0 = ' + n(r.metersPerUnit) + ' м; уровень воды 0 м.\n'
      + 'Клетка у экватора ≈ ' + n(d.equatorCellWidthKm) + ' км (значение клетки = среднее по клетке, не пики).\n'
      + (d.landCells ? 'Суша: ' + n(d.landAreaKm2) + ' км² (' + (d.landFraction * 100).toFixed(1) + '%); высота: мин. ' + n(d.minLandHeightM) + ' м, среднее по площади ' + n(d.meanLandHeightM) + ' м, макс. ' + n(d.maxLandHeightM) + ' м.' : 'Суши нет.');
  }
  const schedule = () => { if (timer === null) timer = win.setTimeout(render, 150); };
  function currentScale() {
    return Scale.create({ radiusKm: Number(get('elevRadius').value), metersPerUnit: Number(get('elevMpu').value) });
  }
  get('elevApply').onclick = () => {
    const work = getWork(); if (!work || get('elevApply').disabled) return;
    try { const changed = work.setScale(currentScale().record); get('elevMessage').textContent = changed ? 'Шкала задана карте. Сохраните карту, чтобы шкала попала в файл.' : 'Шкала уже такая.'; }
    catch (e) { get('elevMessage').textContent = 'Шкала не задана. ' + e.message; }
    render(); repaint();
  };
  get('elevClear').onclick = () => {
    const work = getWork(); if (!work || get('elevClear').disabled) return;
    try { work.setScale(null); get('elevMessage').textContent = 'Шкала снята: высоты снова условные.'; } catch (e) { get('elevMessage').textContent = e.message; }
    render(); repaint();
  };
  get('elevFile').onchange = async () => {
    const work = getWork(), file = get('elevFile').files[0]; if (!file || !work) return;
    work.hold(true); repaint();
    try {
      if (file.size > MAX_FILE_BYTES) throw Error('Файл больше 32 МиБ');
      const scale = currentScale(), bytes = new Uint8Array(await file.arrayBuffer());
      const raster = await Files.decode(bytes, { minMeters: Number(get('elevMin').value), maxMeters: Number(get('elevMax').value) });
      work.hold(false);   // stageImported refuses to run while the workspace is locked; preparing and committing below are synchronous
      const stage = work.stageImported(raster, scale, importer, { seaLevelMeters: Number(get('elevSea').value) });
      if (work.info().dirty && !win.confirm('В карте есть несохранённые изменения. Заменить её без сохранения?')) { get('elevMessage').textContent = 'Импорт отменён. Прежняя карта сохранена.'; return; }
      stage.commit();
      const r = stage.report, n = v => v === null ? '—' : Math.round(v).toLocaleString('ru-RU');
      get('elevMessage').textContent = 'Импортировано: ' + r.sourceW + '×' + r.sourceH + ' → ' + r.targetW + '×' + r.targetH + (r.factorX > 1 || r.factorY > 1 ? ' (уменьшение блоками ' + r.factorX + '×' + r.factorY + ', среднее по суше)' : '') + '; суша ' + r.landCells + ' клеток (' + (r.landFraction * 100).toFixed(1) + '%); макс. ' + n(r.maxLandMeters) + ' м, среднее ' + n(r.meanLandMeters) + ' м' + (r.clampedToMinimum ? '; поднято до минимума: ' + r.clampedToMinimum : '') + '. Воду можно рассчитать заново.';
    } catch (e) { get('elevMessage').textContent = 'Импорт отклонён. Прежняя карта сохранена. ' + e.message; }
    finally { get('elevFile').value = ''; work.hold(false); repaint(); render(); }
  };
  // follow the workspace; it may be created after this panel
  const poll = win.setInterval(() => {
    const work = getWork(); if (!work || work === subscribed) return;
    subscribed = work; work.subscribe(() => schedule()); render();
  }, 200);
  win.addEventListener('pagehide', () => { win.clearInterval(poll); if (timer !== null) win.clearTimeout(timer); });
  return { render };
}

const api = { installUI };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.ElevationUI = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
