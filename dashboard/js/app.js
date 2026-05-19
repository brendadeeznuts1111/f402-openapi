// dashboard/js/app.js — Fantasy402 Dashboard entry

import {
  api,
  apiPost,
  setGlobalErrorHandler,
  checkApiHealth,
  probeApiProxy,
  isMissingTokenError,
  isUnauthorizedProxyError,
} from './api-client.js';
import {
  PRODUCTION_DASHBOARD,
  isEphemeralPagesHost,
  redirectToProductionDashboard,
} from './deploy.js';
import { WagerSocket, PollingFallback } from './websocket-client.js';
import { getRefreshInterval } from './design-system.js';
import { AutoRefreshManager } from './utils.js';
import { DataStore } from './store.js';
import { SettingsManager } from './settings-manager.js';
import { StatusPoller } from './status-poller.js';
import { destroyAllCharts, resizeAllCharts, initChartPlotResizeObserver, flushDeferredCharts } from './charts.js';
import { createTicker } from './ticker.js';
import { applyTheme, initTheme } from './theme.js';
import {
  showAlert,
  showConfigBanner,
  renderErrorState,
  updateBreadcrumbs,
  openDrawer,
  closeDrawer,
  switchChartTab,
  switchLogTab,
  switchSettingsTab,
  requestNotificationPermission,
  initChartTabKeyboard,
  initDataTabKeyboard,
  initAlertsTabKeyboard,
} from './ui.js';
import { $, debounce } from './dom.js';
import { loadOverview, renderVolumeChart } from './views/overview.js';
import {
  loadAnalytics,
  renderAnalyticsCharts,
  onChartTabVisible,
  setActiveChartTab,
} from './views/analytics.js';
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
  syncFromBrowserAndIngest,
  runLocalIngestOnly,
  runLocalIngestAllBatches,
  copyConsoleIngestScript,
  installAutoRunner,
  confirmAutoRunnerInstalled,
  probeWorkerAuthHealthAction,
  copyVpsAuthStackCommands,
  runAutomatedIngest,
  updateCookieHealth,
  onEndpointTabChange,
} from './views/endpoints.js';
import { loadDataView, setDataTab } from './views/data.js';
import { loadAlertsView, onAlertsTabChange, createAlertRule, triggerTestAlert } from './views/alerts.js';
import { loadActivityView, initActivityView } from './views/customer-activity.js';
import { loadCustomersView } from './views/customers.js';
import {
  initPendingView,
  loadPendingWagersView,
  registerPendingAutoRefresh,
  unregisterPendingAutoRefresh,
  applyPendingFilters,
} from './views/pending-wagers.js';
import { installNavigationBridge } from './lib/navigation.js';
import { maybeAutoIngest } from './ingestion-automation.js';

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

let resizeChartsTimer = null;
function scheduleResizeCharts() {
  if (resizeChartsTimer) clearTimeout(resizeChartsTimer);
  resizeChartsTimer = setTimeout(() => {
    resizeChartsTimer = null;
    flushDeferredCharts();
    resizeAllCharts();
  }, 150);
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

installNavigationBridge({
  showError: (msg) => ctx.showAlert(msg, 'error'),
  onCustomer: (customerId, login) => {
    switchView('customers');
    loadCustomersView(ctx).then(() => {
      ctx.loadCustomerProfile?.(customerId, login);
    });
  },
  onAgent: (agentId) => {
    switchView('customers');
    const input = $('customerSearchInput');
    if (input) {
      input.value = agentId;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  },
  onWager: ({ login, customerId }) => {
    switchView('pending');
    applyPendingFilters({
      login: login ?? '',
      customer_id: customerId ?? '0',
    });
    loadPendingWagersView(ctx);
  },
});

function showProxyConfigBanner(kind) {
  if (kind === 'missing_token') {
    showConfigBanner(
      'This deployment has no API token (stale preview URL?). Use production or run ./scripts/set-pages-secrets.sh then redeploy.',
      'error',
    );
    return;
  }
  if (kind === 'unauthorized') {
    showConfigBanner(
      'Preview API token does not match the Worker. Run ./scripts/set-pages-secrets.sh (syncs from 1Password) and redeploy.',
      'error',
    );
    return;
  }
  if (kind === 'unreachable') {
    showConfigBanner('Cannot reach the ingestion Worker via /api. Check Worker status or network.', 'warn');
  }
}

setGlobalErrorHandler((err, path) => {
  if (isMissingTokenError(err)) {
    showProxyConfigBanner('missing_token');
    return;
  }
  if (isUnauthorizedProxyError(err)) {
    showProxyConfigBanner('unauthorized');
    return;
  }
  ctx.showAlert(`${path || 'API'}: ${err.message}`, 'error');
});

statusPoller.onUpdate = (status) => {
  renderSidebarStatus(status);
  updateCookieHealth(ctx);
};

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
  unregisterPendingAutoRefresh();
  destroyAllCharts();
  document.querySelectorAll('.ds-sidebar__item').forEach((item) => {
    const isActive = item.dataset.view === name;
    item.classList.toggle('ds-sidebar__item--active', isActive);
    if (isActive) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  });
  document.querySelectorAll('.ds-view').forEach((v) => {
    v.classList.toggle('ds-view--active', v.id === `view-${name}`);
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
  } else if (name === 'activity') {
    ticker.stopSSE();
    loadActivityView(ctx);
  } else if (name === 'data') {
    ticker.stopSSE();
    loadDataView(ctx);
  } else if (name === 'alerts') {
    ticker.stopSSE();
    loadAlertsView(ctx);
  } else if (name === 'customers') {
    ticker.stopSSE();
    loadCustomersView(ctx);
  } else if (name === 'pending') {
    ticker.stopSSE();
    registerPendingAutoRefresh(ctx);
    loadPendingWagersView(ctx);
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
  scheduleResizeCharts();
});

window.addEventListener('resize', scheduleResizeCharts);
initChartPlotResizeObserver(scheduleResizeCharts);

document.querySelectorAll('.ds-sidebar__item').forEach((item) => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

document.querySelectorAll('[data-chart-tab]').forEach((t) => {
  t.addEventListener('click', () => {
    setActiveChartTab(t.dataset.chartTab);
    switchChartTab(t.dataset.chartTab, (name) => onChartTabVisible(name, ctx));
  });
});
initChartTabKeyboard();
initDataTabKeyboard();
initAlertsTabKeyboard();
initActivityView(ctx);
initPendingView(ctx);



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
document.querySelectorAll('[data-endpoint-tab]').forEach((t) => {
  t.addEventListener('click', () => onEndpointTabChange(t.dataset.endpointTab));
});

document.querySelectorAll('[data-data-tab]').forEach((t) => {
  t.addEventListener('click', () => {
    setDataTab(t.dataset.dataTab);
    loadDataView(ctx);
  });
});

document.querySelectorAll('[data-alerts-tab]').forEach((t) => {
  t.addEventListener('click', () => onAlertsTabChange(t.dataset.alertsTab, ctx));
});

$('applyAlertFiltersBtn')?.addEventListener('click', () => loadAlertsView(ctx));

$('createAlertRuleBtn')?.addEventListener('click', () => createAlertRule(ctx));

$('sendTestAlertBtn')?.addEventListener('click', () => triggerTestAlert(ctx));
$('triggerIngestBtn').addEventListener('click', () => triggerIngestion(ctx));
$('refreshAuthBtn').addEventListener('click', () => refreshAuth(ctx));
$('syncBrowserIngestBtn').addEventListener('click', () => syncFromBrowserAndIngest(ctx));
$('localIngestBtn').addEventListener('click', () => runLocalIngestOnly(ctx));
$('localIngestAllBtn')?.addEventListener('click', () => runLocalIngestAllBatches(ctx));
$('copyConsoleScriptBtn')?.addEventListener('click', () => copyConsoleIngestScript(ctx));
$('installAutoRunnerBtn')?.addEventListener('click', () => installAutoRunner(ctx));
$('confirmAutoRunnerBtn')?.addEventListener('click', () => confirmAutoRunnerInstalled(ctx));
$('probeWorkerAuthBtn')?.addEventListener('click', () => probeWorkerAuthHealthAction(ctx));
$('copyVpsSetupBtn')?.addEventListener('click', () => copyVpsAuthStackCommands(ctx));

let ingestSchedulerId = null;
function resetIngestionScheduler() {
  if (ingestSchedulerId) clearInterval(ingestSchedulerId);
  ingestSchedulerId = null;
  if (settings.get('autoIngestOnEndpoints') === false) return;
  const ms = Math.max(60_000, settings.get('ingestIntervalMs') || 300_000);
  ingestSchedulerId = setInterval(() => {
    maybeAutoIngest(ctx);
  }, ms);
}
settings.onChange((key) => {
  if (key === 'autoIngestOnEndpoints' || key === 'ingestIntervalMs' || key === '*') {
    resetIngestionScheduler();
  }
});

initDropzone(ctx, $('importDropzone'));

async function init() {
  requestNotificationPermission();
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  document.querySelectorAll('.ds-view').forEach((v) => {
    v.classList.toggle('ds-view--active', v.id === 'view-overview');
  });
  updateBreadcrumbs('overview');
  syncDrawerFromSettings(ctx);

  if (isEphemeralPagesHost() && !location.search.includes('stay=1')) {
    redirectToProductionDashboard();
    return;
  }

  let proxyState = await probeApiProxy();
  if (proxyState !== 'ok') {
    showProxyConfigBanner(proxyState);
    if (proxyState === 'missing_token' || proxyState === 'unauthorized') {
      ticker.updateConn('degraded');
    } else {
      ticker.updateConn('error');
    }
  }

  const health = await checkApiHealth();
  if (!health.ok && proxyState === 'ok') {
    ctx.showAlert('Worker health check failed — proxy or Worker may be down.', 'error');
    ticker.updateConn('error');
  } else if (health.worker?.durable_object !== 'ok') {
    ticker.updateConn('degraded');
    ctx.showAlert('Live wager broadcaster unavailable (Durable Object). SSE may not connect.', 'warn');
  }

  if (proxyState === 'ok') {
    statusPoller.silent = false;
    statusPoller.start();
    await loadOverview(ctx);
    resetIngestionScheduler();
    maybeAutoIngest(ctx);
  } else {
    statusPoller.silent = true;
    statusPoller.stop();
    $('statCards').innerHTML = renderErrorState(
      `API unavailable on this URL. Open production (${PRODUCTION_DASHBOARD}) or redeploy after ./scripts/set-pages-secrets.sh`,
      '/summary',
    );
  }
  ticker.startSSE();
  registerOverviewRefresh();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    AutoRefreshManager.pause();
  } else {
    if (currentView === 'overview') {
      loadOverview(ctx);
      registerOverviewRefresh();
    } else if (currentView === 'pending') {
      registerPendingAutoRefresh(ctx);
      loadPendingWagersView(ctx);
    } else {
      registerOverviewRefresh();
    }
  }
});

init();
