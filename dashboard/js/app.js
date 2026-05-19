// dashboard/js/app.js — Fantasy402 Dashboard entry

import { api, apiPost, setGlobalErrorHandler, checkApiHealth, isMissingTokenError } from './api-client.js';
import { WagerSocket, PollingFallback } from './websocket-client.js';
import { getRefreshInterval } from './design-system.js';
import { AutoRefreshManager } from './utils.js';
import { DataStore } from './store.js';
import { SettingsManager } from './settings-manager.js';
import { StatusPoller } from './status-poller.js';
import { destroyAllCharts } from './charts.js';
import { createTicker } from './ticker.js';
import { applyTheme, initTheme } from './theme.js';
import {
  showAlert,
  updateBreadcrumbs,
  openDrawer,
  closeDrawer,
  switchChartTab,
  switchLogTab,
  switchSettingsTab,
  requestNotificationPermission,
} from './ui.js';
import { $, debounce } from './dom.js';
import { loadOverview, renderVolumeChart } from './views/overview.js';
import { loadAnalytics, renderAnalyticsCharts, onChartTabVisible } from './views/analytics.js';
import { loadLogs } from './views/logs.js';
import {
  loadSettings,
  syncDrawerFromSettings,
  saveGeneral,
  saveApi,
  saveAppearance,
  clearCache,
  exportConfig,
  initDropzone,
} from './views/settings.js';
import {
  loadEndpoints,
  triggerIngestion,
  refreshAuth,
  updateCookieHealth,
} from './views/endpoints.js';

const store = new DataStore();
const settings = new SettingsManager();

let currentView = 'overview';

const wagerSocket = new WagerSocket('/api');
const pollFallback = new PollingFallback('/api', 5000);

const statusPoller = new StatusPoller(api, store);

const ticker = createTicker({
  settings,
  api,
  wagerSocket,
  pollFallback,
});

wagerSocket.onWager = (wager) => ticker.add(wager);
wagerSocket.onStatusChange = (status) => {
  if (status === 'connected') {
    wagerSocket.cancelFallback();
    pollFallback.stop();
    ticker.updateConn('connected');
    return;
  }
  if (status === 'polling') {
    ticker.updateConn('polling');
    return;
  }
  if (status === 'degraded') {
    ticker.updateConn('degraded');
    return;
  }
  ticker.updateConn(status);
};
pollFallback.onStatusChange = (status) => {
  if (status === 'polling') ticker.updateConn('polling');
};
pollFallback.onWager = (wager) => ticker.add(wager);

function getOverviewRefreshMs() {
  const fromSettings = settings.get('refreshInterval');
  if (typeof fromSettings === 'number' && fromSettings >= 1000) return fromSettings;
  return getRefreshInterval('/summary');
}

function registerOverviewRefresh() {
  AutoRefreshManager.register('overview', () => loadOverview(ctx), getOverviewRefreshMs());
}

function onChartsThemeChange() {
  destroyAllCharts();
  if (currentView === 'overview') renderVolumeChart(ctx);
  if (currentView === 'analytics') renderAnalyticsCharts(ctx);
}

const ctx = {
  api,
  apiPost,
  store,
  settings,
  wagerSocket,
  pollFallback,
  statusPoller,
  ticker,
  get currentView() { return currentView; },
  showAlert: (msg, severity) => showAlert(msg, severity, settings),
  applyTheme: () => applyTheme(settings),
  onChartsThemeChange,
  registerOverviewRefresh,
};

setGlobalErrorHandler((err, path) => {
  if (isMissingTokenError(err)) {
    ctx.showAlert(
      'API proxy missing INGESTION_TRIGGER_TOKEN. Run dashboard/scripts/set-pages-secrets.sh then redeploy. Live wagers (SSE) may still work.',
      'error',
    );
    return;
  }
  ctx.showAlert(`${path || 'API'}: ${err.message}`, 'error');
});

statusPoller.onUpdate = (status) => {
  renderSidebarStatus(status);
  updateCookieHealth(ctx);
};
statusPoller.start();

function renderSidebarStatus(status) {
  const el = $('sidebarStatus');
  if (!status?.zones) { el.innerHTML = '<div class="ds-loading">Loading...</div>'; return; }
  el.innerHTML = Object.entries(status.zones).map(([zone, info]) => {
    const dot = `ds-sidebar__status-dot--${info.status}`;
    const label = zone.charAt(0).toUpperCase() + zone.slice(1);
    return `<div class="ds-sidebar__status-item"><span class="ds-sidebar__status-dot ${dot}"></span> ${label}</div>`;
  }).join('');
}

function switchView(name) {
  currentView = name;
  destroyAllCharts();
  document.querySelectorAll('.ds-sidebar__item').forEach((item) => {
    const isActive = item.dataset.view === name;
    item.classList.toggle('ds-sidebar__item--active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.ds-view').forEach((v) => {
    v.style.display = v.id === `view-${name}` ? 'block' : 'none';
  });

  updateBreadcrumbs(name);

  if (name === 'overview') {
    ticker.startSSE();
    loadOverview(ctx);
  } else if (name === 'analytics') {
    ticker.stopSSE();
    loadAnalytics(ctx);
  } else if (name === 'logs') {
    ticker.stopSSE();
    loadLogs(ctx);
  } else if (name === 'settings') {
    ticker.stopSSE();
    loadSettings(ctx);
  } else if (name === 'endpoints') {
    ticker.stopSSE();
    loadEndpoints(ctx);
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme') || 'dark';
  const next = current === 'light' ? 'dark' : 'light';
  settings.set('theme', next);
  applyTheme(settings);
  onChartsThemeChange();
}

initTheme(settings, onChartsThemeChange);

// ── Event wiring ──
$('themeToggle').addEventListener('click', toggleTheme);
$('drawerToggle').addEventListener('click', openDrawer);
$('drawerClose').addEventListener('click', closeDrawer);
$('drawerBackdrop').addEventListener('click', closeDrawer);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && $('settingsDrawer').classList.contains('ds-drawer--open')) closeDrawer();
});

$('drawerSaveBtn').addEventListener('click', () => {
  settings.set('chartType', $('drawerChartType').value);
  settings.set('logLevel', $('drawerLogLevel').value);
  settings.set('notifications', $('drawerNotifications').value === 'true');
  onChartsThemeChange();
  ctx.showAlert('Settings saved', 'info');
  closeDrawer();
});

document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (btn?.dataset.action === 'dismiss-toast') btn.closest('.ds-toast-item')?.remove();
});

$('sidebarToggle').addEventListener('click', () => {
  document.querySelector('.ds-sidebar').classList.toggle('ds-sidebar--collapsed');
  const collapsed = document.querySelector('.ds-sidebar').classList.contains('ds-sidebar--collapsed');
  $('sidebarToggle').innerHTML = collapsed ? '&raquo;' : '&laquo;';
  $('sidebarToggle').title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';
});

document.querySelectorAll('.ds-sidebar__item').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

document.querySelectorAll('[data-chart-tab]').forEach((t) => {
  t.addEventListener('click', () => switchChartTab(t.dataset.chartTab, (name) => onChartTabVisible(name, ctx)));
});

document.querySelectorAll('[data-log-tab]').forEach((t) => {
  t.addEventListener('click', () => switchLogTab(t.dataset.logTab));
});

document.querySelectorAll('[data-settings-tab]').forEach((t) => {
  t.addEventListener('click', () => switchSettingsTab(t.dataset.settingsTab));
});

$('tickerType').addEventListener('change', () => ticker.render());
$('tickerMin').addEventListener('input', debounce(() => ticker.render(), 300));
$('logStatus').addEventListener('change', () => loadLogs(ctx));
$('saveGeneralBtn').addEventListener('click', () => saveGeneral(ctx));
$('saveApiBtn').addEventListener('click', () => saveApi(ctx));
$('saveAppearanceBtn').addEventListener('click', () => saveAppearance(ctx));
$('clearCacheBtn').addEventListener('click', () => clearCache(ctx));
$('exportConfigBtn').addEventListener('click', () => exportConfig(ctx));
$('endpointZoneFilter').addEventListener('change', () => loadEndpoints(ctx));
$('endpointMethodFilter').addEventListener('change', () => loadEndpoints(ctx));
$('triggerIngestBtn').addEventListener('click', () => triggerIngestion(ctx));
$('refreshAuthBtn').addEventListener('click', () => refreshAuth(ctx));

initDropzone(ctx, $('importDropzone'));

async function init() {
  requestNotificationPermission();
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  document.getElementById('view-overview').style.display = 'block';
  updateBreadcrumbs('overview');
  syncDrawerFromSettings(ctx);

  const health = await checkApiHealth();
  if (!health.ok) {
    ctx.showAlert('Worker health check failed — proxy or Worker may be down.', 'error');
    ticker.updateConn('error');
  } else if (health.worker?.durable_object !== 'ok') {
    ticker.updateConn('error');
    ctx.showAlert('Live wager broadcaster unavailable (Durable Object). SSE may not connect.', 'warn');
  }

  await loadOverview(ctx);
  ticker.startSSE();
  registerOverviewRefresh();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    AutoRefreshManager.pause();
  } else {
    if (currentView === 'overview') loadOverview(ctx);
    registerOverviewRefresh();
  }
});

init();
