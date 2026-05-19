// dashboard/js/views/settings.js

import { $ } from '../dom.js';
import { JsonViewer } from '../json-viewer.js';

let configViewer = null;

export function syncDrawerFromSettings(ctx) {
  const s = ctx.settings.getAll();
  $('drawerChartType').value = s.chartType;
  $('drawerLogLevel').value = s.logLevel;
  $('drawerNotifications').value = String(s.notifications);
}

export function loadSettings(ctx) {
  const s = ctx.settings.getAll();
  $('settingTheme').value = s.theme;
  $('settingNotifications').value = String(s.notifications);
  $('settingSound').value = String(s.soundAlerts);
  $('settingApiBase').value = s.apiBase;
  $('settingRefresh').value = s.refreshInterval;
  $('settingMaxItems').value = s.maxTickerItems;
  $('settingChartType').value = s.chartType;
  $('settingLogLevel').value = s.logLevel;
  syncDrawerFromSettings(ctx);

  if (!configViewer) configViewer = new JsonViewer('configViewer', s);
  configViewer.setData(s);
}

export function saveGeneral(ctx) {
  ctx.settings.set('theme', $('settingTheme').value);
  ctx.settings.set('notifications', $('settingNotifications').value === 'true');
  ctx.settings.set('soundAlerts', $('settingSound').value === 'true');
  ctx.applyTheme();
  ctx.onChartsThemeChange();
  ctx.showAlert('General settings saved', 'info');
}

export function saveApi(ctx) {
  const base = $('settingApiBase').value.trim();
  if (!base || !base.startsWith('/')) { ctx.showAlert('API base must start with /', 'error'); return; }
  const refresh = parseInt($('settingRefresh').value);
  if (isNaN(refresh) || refresh < 1000 || refresh > 60000) { ctx.showAlert('Refresh interval must be 1000-60000ms', 'error'); return; }
  const maxItems = parseInt($('settingMaxItems').value);
  if (isNaN(maxItems) || maxItems < 10 || maxItems > 1000) { ctx.showAlert('Max items must be 10-1000', 'error'); return; }
  ctx.settings.set('apiBase', base);
  ctx.settings.set('refreshInterval', refresh);
  ctx.settings.set('maxTickerItems', maxItems);
  ctx.registerOverviewRefresh();
  ctx.showAlert('API settings saved', 'info');
}

export function saveAppearance(ctx) {
  ctx.settings.set('chartType', $('settingChartType').value);
  ctx.settings.set('logLevel', $('settingLogLevel').value);
  ctx.onChartsThemeChange();
  ctx.showAlert('Appearance settings saved', 'info');
}

export function clearCache(ctx) {
  ctx.store.invalidateAll();
  ctx.showAlert('Cache cleared', 'info');
}

export function exportConfig(ctx) {
  const blob = new Blob([JSON.stringify(ctx.settings.getAll(), null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'f402-config.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function initDropzone(ctx, el) {
  el.addEventListener('dragover', (e) => { e.preventDefault(); el.classList.add('ds-dropzone--dragover'); });
  el.addEventListener('dragleave', () => el.classList.remove('ds-dropzone--dragover'));

  function handleFile(file) {
    if (!file) return;
    if (file.size > 1024 * 1024) { ctx.showAlert('File too large (max 1MB)', 'error'); return; }
    if (file.type !== 'application/json' && !file.name.endsWith('.json')) {
      ctx.showAlert('Only JSON files accepted', 'error'); return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (typeof data !== 'object' || data === null) throw new Error('Not an object');
        Object.entries(data).forEach(([k, v]) => ctx.settings.set(k, v));
        ctx.showAlert('Config imported successfully', 'info');
        loadSettings(ctx);
      } catch (err) { ctx.showAlert('Invalid config file: ' + err.message, 'error'); }
    };
    reader.onerror = () => ctx.showAlert('Failed to read file', 'error');
    reader.readAsText(file);
  }

  el.addEventListener('drop', (e) => {
    e.preventDefault();
    el.classList.remove('ds-dropzone--dragover');
    handleFile(e.dataTransfer.files[0]);
  });

  el.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.onchange = (e) => handleFile(e.target.files[0]);
    input.click();
  });
}
