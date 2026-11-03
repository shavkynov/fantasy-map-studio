window.FM = window.FM || {};
FM.VERSION = '0.89.0-test.4blocks.5';
FM.BUILD_CHANNEL = 'TEST';
FM.BUILD_ID = '4blocks-ab1';
(function () {
  'use strict';
  function applyTestUI() {
    document.title = 'Fantasy Map Studio TEST — ' + FM.VERSION;
    document.documentElement.setAttribute('data-build-channel', 'TEST');
    const epochs = document.getElementById('epochs');
    if (epochs) {
      epochs.type = 'hidden'; epochs.disabled = true; epochs.setAttribute('aria-hidden', 'true');
      const label = document.getElementById('epochsV');
      if (label && label.parentElement) { label.parentElement.hidden = true; label.parentElement.style.setProperty('display', 'none', 'important'); }
    }
    const calendar = document.getElementById('calSec');
    if (calendar) {
      calendar.hidden = true; calendar.inert = true; calendar.setAttribute('aria-hidden', 'true');
      calendar.style.setProperty('display', 'none', 'important');
      calendar.querySelectorAll('input, select, button, textarea').forEach(el => { el.disabled = true; });
      calendar.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); }, true);
    }
    if (!document.getElementById('testBuildBanner')) {
      const box = document.createElement('div'); box.id = 'testBuildBanner'; box.setAttribute('role', 'navigation');
      box.style.cssText = 'position:fixed;top:8px;right:12px;z-index:1000000;max-width:90vw;padding:10px 14px;background:#203b49;color:#fff;border:2px solid #edb35a;border-radius:6px;font:14px system-ui';
      const text = document.createElement('strong'); text.textContent = 'TEST ' + FM.VERSION + ' · ' + FM.BUILD_ID; box.appendChild(text);
      for (const item of [['equal-area-ab.html', 'Сравнение A/B'], ['equal-area-candidate.html', 'Прежний EA1'], ['four-block-prototype.html', 'hires3']]) {
        const link = document.createElement('a'); link.href = item[0]; link.textContent = item[1]; link.style.cssText = 'color:#9fe8ff;margin-left:12px;white-space:nowrap'; box.appendChild(link);
      }
      document.body.appendChild(box);
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', applyTestUI, { once: true }); else applyTestUI();
})();
