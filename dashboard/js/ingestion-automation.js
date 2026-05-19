// dashboard/js/ingestion-automation.js

import { debugLog } from './debug-log.js';
import { parseBrowserCapture } from './browser-auth.js';
import { isFantasy402Origin, installManagerAutoRunner } from './manager-console-runner.js';
import {
  readLiveSessionAuth,
  renewLiveSessionToken,
  toRefreshAuthPayload,
} from './live-session-auth.js';
import { LocalIngestBlockedError, runLocalBrowserIngest, runLocalIngestLoops } from './local-ingest.js';
import { fetchWorkerAuthHealth, needsAuthRefreshFromAuthHealth } from './auth-stack.js';
import {
  classifyAutomationPlane,
  formatAutomationPlaneHint,
  isAuthDegradedForAutomation,
  setAutoIngestBackoff,
  clearAutoIngestBackoff,
  shouldDashboardAutomateIngest,
} from './automation-plane.js';

export const BROWSER_CAPTURE_KEY = 'f402-browser-capture';
export const BROWSER_AUTH_KEY = 'f402-browser-auth-payload';
export const AUTO_RUNNER_INSTALLED_KEY = 'f402-auto-runner-installed';
export const AUTO_RUNNER_PENDING_KEY = 'f402-auto-runner-pending';

export function isJwtExpired(payload) {
  if (!payload?.authorization) return true;
  const token = payload.authorization.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return false;
  try {
    const body = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!body.exp) return false;
    return body.exp * 1000 <= Date.now();
  } catch {
    return false;
  }
}

export async function fetchCatalogStatus(ctx) {
  try {
    return await ctx.api('/ingest/catalog-status', { silent: true });
  } catch {
    return null;
  }
}

export function catalogBackfillLoops(catalog) {
  if (!catalog?.pendingCount) return 1;
  const batchSize = catalog.batchSize || 12;
  return Math.min(20, Math.max(1, Math.ceil(catalog.pendingCount / batchSize) + 1));
}

export function formatAutomationStatus() {
  const pending = localStorage.getItem(AUTO_RUNNER_PENDING_KEY);
  const installed = localStorage.getItem(AUTO_RUNNER_INSTALLED_KEY);
  if (installed) {
    return { label: 'Auto-runner installed', className: 'ds-badge--success', hint: 'Ingest runs on manager.html schedule' };
  }
  if (pending) {
    return { label: 'Paste auto-runner on manager.html', className: 'ds-badge--warn', hint: 'Script copied — paste in DevTools Console on manager tab' };
  }
  if (isFantasy402Origin()) {
    return { label: 'On manager.html — ingest direct', className: 'ds-badge--success', hint: '' };
  }
  return { label: 'Dashboard delegates to manager', className: 'ds-badge', hint: 'Click Install auto-runner once' };
}

export function markAutoRunnerInstalled() {
  try {
    localStorage.setItem(AUTO_RUNNER_INSTALLED_KEY, new Date().toISOString());
    localStorage.removeItem(AUTO_RUNNER_PENDING_KEY);
  } catch { /* ignore */ }
}

export async function delegateToManagerAutoRunner(ctx, { silent = true, loops } = {}) {
  const intervalMs = ctx.settings.get('ingestIntervalMs') || 300_000;
  let batchLoops = loops;
  if (!batchLoops) {
    const catalog = await fetchCatalogStatus(ctx);
    batchLoops = catalogBackfillLoops(catalog);
  }
  await installManagerAutoRunner(window.location.origin, { intervalMs, loops: batchLoops });
  try { localStorage.setItem(AUTO_RUNNER_PENDING_KEY, new Date().toISOString()); } catch { /* ignore */ }
  // #region agent log
  debugLog('ingestion-automation.js:delegateToManagerAutoRunner', 'delegated', { silent, intervalMs, runId: 'post-fix' }, 'H4');
  // #endregion
  if (!silent) {
    ctx.showAlert(`Auto-runner copied (${batchLoops} batch loops) — paste in DevTools on manager tab`, 'info');
  } else if (!sessionStorage.getItem('f402-runner-toast-shown')) {
    ctx.showAlert('Auto-runner copied — paste in DevTools on the manager tab (auth refreshes automatically)', 'info');
    sessionStorage.setItem('f402-runner-toast-shown', '1');
  }
  return { status: 'delegated', reason: 'cors' };
}

export function loadStoredAuthPayload() {
  try {
    const raw = localStorage.getItem(BROWSER_AUTH_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function saveStoredAuthPayload(payload) {
  if (!payload?.authorization && !payload?.cfClearance) return;
  try {
    localStorage.setItem(BROWSER_AUTH_KEY, JSON.stringify({
      authorization: payload.authorization,
      sessionCookie: payload.sessionCookie,
      cfClearance: payload.cfClearance,
      cfBm: payload.cfBm,
      browserHeaders: payload.browserHeaders,
      referer: payload.referer,
      userAgent: payload.userAgent,
      savedAt: new Date().toISOString(),
    }));
  } catch {
    /* ignore */
  }
}

export function loadStoredCapture() {
  try {
    return localStorage.getItem(BROWSER_CAPTURE_KEY) || '';
  } catch {
    return '';
  }
}

export function saveStoredCapture(text) {
  if (!text?.trim()) return;
  try {
    localStorage.setItem(BROWSER_CAPTURE_KEY, text);
  } catch {
    /* quota or private mode */
  }
}

export function clearStoredCapture() {
  try {
    localStorage.removeItem(BROWSER_CAPTURE_KEY);
  } catch {
    /* ignore */
  }
}

export function parseRunMeta(run) {
  if (!run) return { skipped: 0 };
  if (typeof run.endpoints_skipped === 'number') {
    return { skipped: run.endpoints_skipped, note: run.skip_note || undefined };
  }
  if (!run.error_message) return { skipped: 0 };
  try {
    const parsed = JSON.parse(run.error_message);
    if (parsed && typeof parsed.skipped === 'number') {
      return { skipped: parsed.skipped, note: parsed.note };
    }
  } catch {
    /* legacy plain text */
  }
  return { skipped: 0, note: run.error_message };
}

export function formatBatchProgress(plan) {
  if (!plan?.batching || !plan.catalogSize) return '';
  const pct = Math.round(((plan.cursor || 0) / plan.catalogSize) * 100);
  return `${pct}% through catalog (cursor ${plan.cursor}/${plan.catalogSize})`;
}

export function formatAuthStatus(storedAuth) {
  if (!storedAuth?.authorization) {
    return { label: 'No stored auth', className: 'ds-badge--warn' };
  }
  const token = storedAuth.authorization.replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return { label: 'Auth stored', className: 'ds-badge--success' };
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return { label: 'Auth stored', className: 'ds-badge--success' };
    const remaining = payload.exp * 1000 - Date.now();
    if (remaining <= 0) return { label: 'JWT expired', className: 'ds-badge--error' };
    const mins = Math.ceil(remaining / 60_000);
    if (mins <= 5) return { label: `JWT expiring (${mins}m)`, className: 'ds-badge--warn' };
    return { label: `JWT valid (${mins}m)`, className: 'ds-badge--success' };
  } catch {
    return { label: 'Auth stored', className: 'ds-badge--success' };
  }
}

export function formatIngestionBatchLabel(plan) {
  if (!plan?.keys?.length) return 'No endpoints configured';
  if (!plan.batching) return `${plan.keys.length} endpoints (full catalog)`;
  const end = plan.cursor + plan.batchSize - 1;
  return `Batch ${plan.cursor + 1}–${end + 1} / ${plan.catalogSize} · next: ${plan.keys.slice(0, 3).join(', ')}${plan.keys.length > 3 ? '…' : ''}`;
}

export function needsAuthRefresh(diagnostics) {
  const readiness = diagnostics?.upstreamAuthShape?.ingestionReadiness?.status;
  const expiry = diagnostics?.upstreamAuthShape?.authorizationExpiry;
  const result = (readiness && readiness !== 'ready')
    || expiry?.status === 'expired'
    || expiry?.status === 'expiring';
  // #region agent log
  debugLog('ingestion-automation.js:needsAuthRefresh', 'auth refresh check', {
    readiness,
    expiryStatus: expiry?.status,
    result,
  }, 'H3');
  // #endregion
  return result;
}

export function formatRunHealthLine(run) {
  if (!run) return '';
  const skipped = parseRunMeta(run).skipped;
  const ok = run.endpoints_succeeded || 0;
  const fail = run.endpoints_failed || 0;
  const parts = [`${ok} OK`];
  if (skipped > 0) parts.push(`${skipped} skipped`);
  if (fail > 0) parts.push(`${fail} failed`);
  return parts.join(' · ');
}

export function needsIngestionRun(health, staleMs = 10 * 60_000) {
  const run = health?.latestRun;
  if (!run) return true;
  const finishedAt = run.finished_at || run.started_at;
  if (!finishedAt) return true;
  const ageMs = Date.now() - new Date(finishedAt).getTime();
  const succeeded = run.endpoints_succeeded || 0;
  const skipped = run.endpoints_skipped || 0;
  const workerOnly = succeeded === 0 && skipped > 0;
  const stale = ageMs > staleMs;
  // #region agent log
  debugLog('ingestion-automation.js:needsIngestionRun', 'ingest stale check', {
    ageMs,
    stale,
    workerOnly,
    succeeded,
    skipped,
  }, 'H3');
  // #endregion
  return stale || workerOnly;
}

export function shouldAutomateIngest(ctx, diagnostics, health, catalog, authHealth, storedAuth) {
  const autoIngest = ctx.settings.get('autoIngestOnEndpoints') !== false;
  const autoSync = ctx.settings.get('autoSyncOnEndpoints') !== false;
  const authDegraded = isAuthDegradedForAutomation(diagnostics, authHealth) || needsAuthRefresh(diagnostics);
  const ingestStale = needsIngestionRun(health, ctx.settings.get('ingestIntervalMs') || 300_000);
  const catalogPending = (catalog?.pendingCount ?? 0) > 0;
  const plane = classifyAutomationPlane({
    authHealth,
    storedAuth: storedAuth ?? loadStoredAuthPayload(),
    diagnostics,
  });
  const decision = shouldDashboardAutomateIngest({
    plane,
    authDegraded,
    ingestStale,
    catalogPending,
    autoIngest,
    autoSync,
  });
  return {
    run: decision.run,
    authDegraded,
    ingestStale,
    catalogPending,
    plane,
    reason: decision.reason,
    hint: decision.hint ?? formatAutomationPlaneHint(plane),
  };
}

function progressHandler(ctx) {
  return (msg) => {
    const el = document.getElementById('ingestionProgress');
    if (el) el.textContent = msg;
  };
}

/** Resolve auth from live manager session, localStorage, worker bootstrap, or stored capture. */
export async function resolveAuthPayload(ctx) {
  if (isFantasy402Origin()) {
    let live = readLiveSessionAuth();
    if (live?.authorization) {
      try {
        const renewed = await renewLiveSessionToken(live);
        live = renewed.auth;
        debugLog('ingestion-automation.js:resolveAuthPayload', 'live session', {
          renewed: renewed.renewed,
          ttlSeconds: renewed.ttlSeconds,
          runId: 'post-fix',
        }, 'H1');
      } catch (e) {
        debugLog('ingestion-automation.js:resolveAuthPayload', 'live renew failed', { message: e.message }, 'H2');
      }
      saveStoredAuthPayload(live);
      return live;
    }
    debugLog('ingestion-automation.js:resolveAuthPayload', 'manager origin no sessionStorage', {}, 'H5');
  }

  const stored = loadStoredAuthPayload();
  if (stored?.authorization) return stored;

  try {
    const bootstrap = await ctx.api('/ingest/local/bootstrap', { silent: true });
    if (bootstrap?.authorization) {
      const payload = {
        authorization: bootstrap.authorization,
        sessionCookie: bootstrap.sessionCookie,
        cfClearance: bootstrap.cfClearance,
        cfBm: bootstrap.cfBm,
        browserHeaders: bootstrap.browserHeaders,
        referer: bootstrap.referer,
        userAgent: bootstrap.userAgent,
        customerId: bootstrap.customerId,
      };
      saveStoredAuthPayload(payload);
      // #region agent log
      debugLog('ingestion-automation.js:resolveAuthPayload', 'worker bootstrap', {
        hasAuth: true,
        runId: 'post-fix',
      }, 'H6');
      // #endregion
      return payload;
    }
  } catch {
    /* bootstrap unavailable */
  }

  const capture = loadStoredCapture()?.trim()
    || document.getElementById('browserCaptureInput')?.value?.trim()
    || '';
  if (capture) {
    return parseBrowserCapture(capture, { mergeStored: stored });
  }
  return null;
}

/** Unified automated ingest: stored auth, local fetch, or manager auto-runner fallback. */
export async function runAutomatedIngest(ctx, { silent = true, loops = 1 } = {}) {
  let authPayload = await resolveAuthPayload(ctx);
  const capture = loadStoredCapture()?.trim() || document.getElementById('browserCaptureInput')?.value?.trim() || '';
  // #region agent log
  debugLog('ingestion-automation.js:runAutomatedIngest', 'entry', {
    silent,
    loops,
    hasAuthPayload: Boolean(authPayload?.authorization),
    hasCapture: Boolean(capture),
    origin: typeof window !== 'undefined' ? window.location.hostname : '',
    runId: 'post-fix',
  }, 'H2');
  // #endregion

  if (!authPayload?.authorization) {
    return { status: 'skipped', reason: 'no-auth' };
  }

  if (isJwtExpired(authPayload) && !capture) {
    // #region agent log
    debugLog('ingestion-automation.js:runAutomatedIngest', 'jwt expired no capture', {}, 'H5');
    // #endregion
    if (!silent) ctx.showAlert('JWT expired — paste a fresh /cloud/api/* capture in Endpoints tab', 'warn');
    return { status: 'skipped', reason: 'jwt-expired' };
  }

  try {
    if (capture) {
      const parsed = parseBrowserCapture(capture, { mergeStored: authPayload });
      if (ctx.settings.get('persistBrowserCapture') !== false) saveStoredCapture(capture);
      saveStoredAuthPayload(parsed);
      await ctx.apiPost('/refresh-auth', parsed);
      authPayload = parsed;
    } else if (isFantasy402Origin() && authPayload?.authorization) {
      await ctx.apiPost('/refresh-auth', toRefreshAuthPayload(authPayload));
    } else {
      await ctx.apiPost('/refresh-auth', authPayload).catch(() => ctx.apiPost('/refresh-auth', {}));
    }
  } catch (e) {
    // #region agent log
    debugLog('ingestion-automation.js:runAutomatedIngest', 'auth refresh failed', { message: e.message }, 'H5');
    // #endregion
    if (!silent) ctx.showAlert(`Auth refresh failed: ${e.message}`, 'error');
    return { status: 'failed', reason: 'auth', message: e.message };
  }

  const onProgress = progressHandler(ctx);
  const catalog = await fetchCatalogStatus(ctx);
  const ingestLoops = loops === 'all' || loops > 1
    ? loops
    : (catalog?.pendingCount > 0 ? catalogBackfillLoops(catalog) : 1);

  try {
    if (isFantasy402Origin()) {
      const result = ingestLoops === 'all' || ingestLoops > 1
        ? await runLocalIngestLoops(ctx, authPayload, { loops: ingestLoops === 'all' ? 'all' : ingestLoops, onProgress })
        : await runLocalBrowserIngest(ctx, authPayload, { advanceCursor: true, onProgress });
      // #region agent log
      debugLog('ingestion-automation.js:runAutomatedIngest', 'manager origin ingest ok', {
        status: result.status,
        totalOk: result.totalOk ?? result.fetched?.length,
        runId: 'post-fix',
      }, 'H2');
      // #endregion
      if (!silent) ctx.showAlert(`Automated ingest: ${result.totalOk ?? result.fetched?.length ?? 0} endpoints`, 'info');
      return result;
    }

    const local = await runLocalBrowserIngest(ctx, authPayload, { advanceCursor: true, onProgress });
    // #region agent log
    debugLog('ingestion-automation.js:runAutomatedIngest', 'local ingest ok', {
      status: local.status,
      fetched: local.fetched?.length,
      runId: 'post-fix',
    }, 'H2');
    // #endregion
    if (!silent) {
      const ok = local.upload?.endpointsSucceeded ?? local.fetched?.length ?? 0;
      ctx.showAlert(`Automated ingest: ${ok} OK`, local.status === 'ok' ? 'info' : 'warn');
    }
    return local;
  } catch (e) {
    if (!(e instanceof LocalIngestBlockedError)) throw e;
    // #region agent log
    debugLog('ingestion-automation.js:runAutomatedIngest', 'CORS delegating to auto-runner', { silent, ingestLoops, runId: 'post-fix' }, 'H4');
    // #endregion
    return delegateToManagerAutoRunner(ctx, { silent, loops: ingestLoops });
  }
}

export async function maybeAutoIngest(ctx) {
  const capture = loadStoredCapture();
  let storedAuth = loadStoredAuthPayload();
  if (!storedAuth?.authorization) {
    storedAuth = await resolveAuthPayload(ctx);
  }
  // #region agent log
  debugLog('ingestion-automation.js:maybeAutoIngest', 'entry', {
    autoSync: ctx.settings.get('autoSyncOnEndpoints'),
    autoIngest: ctx.settings.get('autoIngestOnEndpoints'),
    hasStoredAuth: Boolean(storedAuth?.authorization),
    hasCapture: Boolean(capture?.trim()),
    runId: 'post-fix',
  }, 'H1');
  // #endregion

  if (!storedAuth?.authorization && !capture?.trim()) {
    // #region agent log
    debugLog('ingestion-automation.js:maybeAutoIngest', 'skip: no auth source', {}, 'H6');
    // #endregion
    return false;
  }

  let diagnostics = null;
  let health = null;
  let catalog = null;
  let authHealth = null;
  try {
    [diagnostics, health, catalog, authHealth] = await Promise.all([
      ctx.api('/diagnostics', { silent: true }),
      ctx.api('/endpoint-status', { silent: true }),
      fetchCatalogStatus(ctx),
      fetchWorkerAuthHealth(ctx),
    ]);
  } catch {
    /* continue with null diagnostics */
  }

  const decision = shouldAutomateIngest(ctx, diagnostics, health, catalog, authHealth, storedAuth);
  if (!decision.run) {
    // #region agent log
    debugLog('ingestion-automation.js:maybeAutoIngest', 'skip: not needed', decision, 'H3');
    // #endregion
    return false;
  }

  // #region agent log
  debugLog('ingestion-automation.js:maybeAutoIngest', 'running automated ingest', decision, 'H1');
  // #endregion
  try {
    await runAutomatedIngest(ctx, {
      silent: true,
      loops: catalog?.pendingCount > 0 ? catalogBackfillLoops(catalog) : 1,
    });
    clearAutoIngestBackoff();
    return true;
  } catch (e) {
    setAutoIngestBackoff();
    debugLog('ingestion-automation.js:maybeAutoIngest', 'failed — backoff', { message: e.message }, 'H3');
    throw e;
  }
}

/** @deprecated use maybeAutoIngest */
export async function maybeAutoSync(ctx, { syncFromBrowserAndIngest } = {}) {
  if (syncFromBrowserAndIngest) {
    const ran = await maybeAutoIngest(ctx);
    if (ran) return true;
  }
  return maybeAutoIngest(ctx);
}

export function initCapturePersistence(ctx) {
  const textarea = document.getElementById('browserCaptureInput');
  const persistCheckbox = document.getElementById('persistCaptureCheckbox');
  const autoSyncCheckbox = document.getElementById('autoSyncOnEndpointsCheckbox');
  const autoIngestCheckbox = document.getElementById('autoIngestOnEndpointsCheckbox');
  const preferLocalCheckbox = document.getElementById('preferLocalIngestCheckbox');

  if (persistCheckbox) {
    persistCheckbox.checked = ctx.settings.get('persistBrowserCapture') !== false;
    persistCheckbox.addEventListener('change', () => {
      ctx.settings.set('persistBrowserCapture', persistCheckbox.checked);
      if (persistCheckbox.checked && textarea?.value) saveStoredCapture(textarea.value);
      else clearStoredCapture();
    });
  }

  if (autoSyncCheckbox) {
    autoSyncCheckbox.checked = ctx.settings.get('autoSyncOnEndpoints') !== false;
    autoSyncCheckbox.addEventListener('change', () => {
      ctx.settings.set('autoSyncOnEndpoints', autoSyncCheckbox.checked);
    });
  }

  if (autoIngestCheckbox) {
    autoIngestCheckbox.checked = ctx.settings.get('autoIngestOnEndpoints') !== false;
    autoIngestCheckbox.addEventListener('change', () => {
      ctx.settings.set('autoIngestOnEndpoints', autoIngestCheckbox.checked);
    });
  }

  if (preferLocalCheckbox) {
    preferLocalCheckbox.checked = ctx.settings.get('preferLocalIngest') !== false;
    preferLocalCheckbox.addEventListener('change', () => {
      ctx.settings.set('preferLocalIngest', preferLocalCheckbox.checked);
    });
  }

  const stored = loadStoredCapture();
  if (stored && textarea && !textarea.value.trim()) textarea.value = stored;

  let saveTimer;
  textarea?.addEventListener('input', () => {
    if (ctx.settings.get('persistBrowserCapture') === false) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveStoredCapture(textarea.value), 400);
  });
}
