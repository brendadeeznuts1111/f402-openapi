// dashboard/js/views/endpoints.js

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { ago } from '../format.js';
import { renderErrorState } from '../ui.js';
import { renderEmptyState, getZoneBadgeClass } from '../design-system.js';
import { debugLog } from '../debug-log.js';
import { parseBrowserCapture } from '../browser-auth.js';
import { LocalIngestBlockedError, runLocalBrowserIngest, runLocalIngestLoops } from '../local-ingest.js';
import { isFantasy402Origin, installManagerAutoRunner, copyManagerConsoleScript, copySelfBootstrappingAutoRunner } from '../manager-console-runner.js';
import {
  formatAuthStatus,
  formatAutomationStatus,
  formatBatchProgress,
  markAutoRunnerInstalled,
  formatIngestionBatchLabel,
  formatRunHealthLine,
  parseRunMeta,
  initCapturePersistence,
  maybeAutoIngest,
  runAutomatedIngest,
  resolveAuthPayload,
  loadStoredAuthPayload,
  saveStoredAuthPayload,
  saveStoredCapture,
  fetchCatalogStatus,
  catalogBackfillLoops,
} from '../ingestion-automation.js';
import {
  copyVpsSetupCommands,
  fetchWorkerAuthHealth,
  formatAuthHealthTimelineHtml,
  formatAuthStackHint,
  formatWorkerAuthHealthBadge,
} from '../auth-stack.js';
import { classifyAutomationPlane, formatAutomationPlaneHint } from '../automation-plane.js';

export { runAutomatedIngest };

let capturePersistenceReady = false;

let endpointManifestTab = 'worker';
let workerRoutes = [];
let upstreamRoutes = [];
let upstreamMeta = {};

export function setEndpointManifestTab(name) {
  endpointManifestTab = name === 'upstream' ? 'upstream' : 'worker';
}

export function getEndpointManifestTab() {
  return endpointManifestTab;
}

function renderRoutesTable(routes) {
  if (!routes.length) {
    return renderEmptyState({ message: 'No endpoints match filter' });
  }
  const showUpstreamMeta = endpointManifestTab === 'upstream';
  const rows = routes.map((r) => {
    const zoneClass = getZoneBadgeClass(r.zone || 'worker');
    const configured = r.configured === true
      ? '<span class="ds-badge ds-badge--success">yes</span>'
      : r.configured === false
        ? '<span class="ds-badge ds-badge--warn">no</span>'
        : '—';
    const online = showUpstreamMeta
      ? (r.online === true
        ? `<span class="ds-badge ds-badge--success" title="${escapeHtml(r.lastSnapshotAt || '')}">online</span>`
        : '<span class="ds-badge ds-badge--warn">pending</span>')
      : '';
    const contentType = showUpstreamMeta && r.contentType
      ? `<td class="ds-cell-sm"><code>${escapeHtml(r.contentType)}</code></td>`
      : '';
    return `<tr>
      <td><span class="ds-zone-badge ${zoneClass}">${escapeHtml(r.zone || 'worker')}</span></td>
      <td><code>${escapeHtml(r.method)}</code></td>
      <td><code>${escapeHtml(r.path)}</code></td>
      <td class="ds-cell-sm">${escapeHtml(r.description || r.key || '')}</td>
      ${contentType}
      <td class="ds-cell-sm">${r.refreshMs === 'realtime' ? '⚡ live' : r.refreshMs === 'manual' ? '—' : r.refreshMs === 'ingestion' ? 'ingest' : (typeof r.refreshMs === 'number' ? (r.refreshMs / 1000) + 's' : '—')}</td>
      <td>${configured}</td>
      ${showUpstreamMeta ? `<td>${online}</td>` : ''}
    </tr>`;
  }).join('');
  const contentHeader = showUpstreamMeta ? '<th>Content type</th>' : '';
  const onlineHeader = showUpstreamMeta ? '<th>Online</th>' : '';
  return `<table class="ds-table-sm"><thead><tr><th>Zone</th><th>Method</th><th>Path</th><th>Description</th>${contentHeader}<th>Refresh</th><th>Configured</th>${onlineHeader}</tr></thead><tbody>${rows}</tbody></table>`;
}

function filterRoutes(routes) {
  const zoneFilter = $('endpointZoneFilter').value;
  const methodFilter = $('endpointMethodFilter').value;
  let list = routes;
  if (zoneFilter) list = list.filter((r) => r.zone === zoneFilter);
  if (methodFilter) list = list.filter((r) => r.method === methodFilter);
  return list;
}

function paintEndpointsTable() {
  const routes = endpointManifestTab === 'upstream' ? upstreamRoutes : workerRoutes;
  const filtered = filterRoutes(routes);
  $('endpointsTable').innerHTML = renderRoutesTable(filtered);
    const label = endpointManifestTab === 'upstream' ? 'upstream Fantasy402' : 'Worker API';
  const configuredHint = endpointManifestTab === 'upstream' && upstreamMeta.configuredCount != null
    ? ` · ${upstreamMeta.configuredCount} configured`
    : '';
  const onlineHint = endpointManifestTab === 'upstream' && upstreamMeta.onlineCount != null
    ? ` · ${upstreamMeta.onlineCount} online`
    : '';
  $('endpointsCount').textContent = `${filtered.length} / ${routes.length} ${label}${configuredHint}${onlineHint}`;
}

export async function loadEndpoints(ctx) {
  if (!capturePersistenceReady) {
    initCapturePersistence(ctx);
    capturePersistenceReady = true;
  }

  try {
    const [manifest, upstream, health, catalog, authHealth] = await Promise.all([
      ctx.store.fetch('endpoints-manifest', () => ctx.api('/endpoints'), 60000),
      ctx.store.fetch('upstream-endpoints', () => ctx.api('/upstream-endpoints'), 60000),
      ctx.api('/endpoint-status').catch(() => ({ latestRun: null, recentFailures: [], ingestion: null })),
      ctx.api('/ingest/catalog-status').catch(() => null),
      fetchWorkerAuthHealth(ctx),
    ]);

    workerRoutes = manifest?.routes || [];
    upstreamRoutes = upstream?.routes || [];
    upstreamMeta = {
      configuredCount: upstream?.configuredCount,
      implementedCount: upstream?.implementedCount,
      onlineCount: upstream?.onlineCount,
    };

    document.querySelectorAll('[data-endpoint-tab]').forEach((t) => {
      const on = t.dataset.endpointTab === endpointManifestTab;
      t.classList.toggle('ds-active', on);
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.setAttribute('tabindex', on ? '0' : '-1');
    });

    paintEndpointsTable();

    const run = health?.latestRun;
    const failures = health?.recentFailures || [];
    const ingestionPlan = health?.ingestion;
    let healthHtml = formatAuthHealthTimelineHtml(authHealth);

    if (ingestionPlan) {
      const progress = formatBatchProgress(ingestionPlan);
      healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot"></span><div class="ds-timeline__content"><div class="ds-timeline__title">Next batch</div><div class="ds-timeline__meta">${escapeHtml(formatIngestionBatchLabel(ingestionPlan))}</div>${progress ? `<div class="ds-timeline__meta">${escapeHtml(progress)}</div>` : ''}<div class="ds-timeline__meta ds-help-text">Worker /trigger skips IP-bound routes · use local ingest</div></div></div>`;
    }

    if (catalog) {
      const authBlock = catalog.auth?.ingestionReadiness?.status !== 'ready'
        ? `<div class="ds-timeline__meta ds-help-text">Auth: ${escapeHtml(catalog.auth?.ingestionReadiness?.blocker || 'blocked')} — paste fresh capture</div>`
        : '';
      const blockerLines = (catalog.blockers || []).slice(0, 3).map((b) =>
        `<div class="ds-timeline__meta ds-help-text"><strong>${escapeHtml(b.code)}</strong>: ${escapeHtml(b.message)}</div>`,
      ).join('');
      healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot ${catalog.pendingCount ? 'ds-timeline__dot--warn' : ''}"></span><div class="ds-timeline__content"><div class="ds-timeline__title">Catalog ${catalog.onlineCount}/${catalog.catalogSize} online</div><div class="ds-timeline__meta">${catalog.pendingCount} pending · ~${catalog.batchesRemaining} batches left</div>${authBlock}${blockerLines}</div></div>`;
    }

    paintAuthStatus(ingestionPlan, authHealth);
    paintAutomationStatus();

    if (run) {
      const skipped = run.endpoints_skipped ?? parseRunMeta(run).skipped ?? 0;
      const succeeded = run.endpoints_succeeded || 0;
      const failed = run.endpoints_failed || 0;
      let displayStatus = 'failed';
      if (failed > 0 && succeeded > 0) displayStatus = 'partial';
      else if (failed > 0) displayStatus = 'failed';
      else if (skipped > 0 && succeeded === 0) displayStatus = 'skipped';
      else if (succeeded > 0) displayStatus = 'success';
      else displayStatus = run.status === 'success' ? 'success' : 'failed';

      const statusDot = displayStatus === 'success' ? '🟢' : displayStatus === 'partial' ? '🟡' : displayStatus === 'skipped' ? '⏭️' : '🔴';
      const dotClass = displayStatus === 'success'
        ? 'success'
        : displayStatus === 'partial' || displayStatus === 'skipped'
          ? 'warn'
          : 'error';
      const skipNote = run.skip_note || parseRunMeta(run).note;
      const metaLine = [formatRunHealthLine(run), skipNote].filter(Boolean).join(' · ');
      healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot ds-timeline__dot--${dotClass}"></span><div class="ds-timeline__content"><div class="ds-timeline__time">${ago(run.finished_at || run.started_at)}</div><div class="ds-timeline__title">${statusDot} Run ${displayStatus}</div><div class="ds-timeline__meta">${escapeHtml(metaLine)}</div></div></div>`;
    }
    if (failures.length) {
      healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot"></span><div class="ds-timeline__content"><div class="ds-timeline__title">Historical failures (24h)</div><div class="ds-timeline__meta ds-help-text">Worker /trigger 403s — not current route health</div></div></div>`;
      for (const f of failures.slice(0, 5)) {
        const isOnline = upstreamRoutes.some((r) => r.key === f.endpoint_key && r.online);
        healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot ds-timeline__dot--${isOnline ? 'warn' : 'error'}"></span><div class="ds-timeline__content"><div class="ds-timeline__time">${ago(f.last_failure)}</div><div class="ds-timeline__title">${isOnline ? 'Hist.' : 'Failed'}: ${escapeHtml(f.endpoint_key || '?')}${isOnline ? ' (online via local)' : ''}</div><div class="ds-timeline__meta">${f.failure_count}x in 24h</div></div></div>`;
      }
    }
    $('endpointHealth').innerHTML = healthHtml
      ? `<div class="ds-timeline">${healthHtml}</div>`
      : renderEmptyState({ message: 'No ingestion data', hint: 'Trigger an ingestion run from Quick Actions.' });

    await maybeAutoIngest(ctx);
  } catch (e) {
    $('endpointsTable').innerHTML = renderErrorState(e.message, '/endpoints');
  }
}

export function onEndpointTabChange(name) {
  setEndpointManifestTab(name);
  paintEndpointsTable();
}

export async function triggerIngestion(ctx) {
  try {
    const result = await ctx.apiPost('/trigger', {}, { acceptStatuses: [200, 202, 500] });
    const ok = result?.endpoints_succeeded ?? result?.endpointsSucceeded ?? 0;
    const fail = result?.endpoints_failed ?? result?.endpointsFailed ?? 0;
    const skipped = result?.endpoints_skipped ?? result?.endpointsSkipped ?? 0;
    const status = result?.status || 'unknown';
    const parts = [`${ok} OK`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (fail > 0) parts.push(`${fail} failed`);
    ctx.showAlert(
      `Ingestion ${status}: ${parts.join(' · ')}${result?.runId ? ` (${result.runId.slice(0, 8)}…)` : ''}`,
      status === 'failed' ? 'warn' : 'info',
    );
    loadEndpoints(ctx);
    return result;
  } catch (e) {
    ctx.showAlert(`Ingestion failed: ${e.message}`, 'error');
    throw e;
  }
}

export async function refreshAuth(ctx) {
  const capture = $('browserCaptureInput')?.value?.trim();
  if (capture) {
    return syncFromBrowserAndIngest(ctx, { triggerAfterRefresh: false });
  }
  try {
    const result = await ctx.apiPost('/refresh-auth', {});
    const mode = result?.mode === 'renew'
      ? 'Token renewed'
      : result?.mode === 'session'
        ? 'Session refreshed'
        : 'Auth overlay updated';
    ctx.showAlert(mode, 'info');
    updateCookieHealth(ctx);
  } catch (e) {
    ctx.showAlert(`Auth refresh failed: ${e.message}`, 'error');
  }
}

/** Parse capture → refresh auth → local browser fetch → /ingest/local upload. */
export async function syncFromBrowserAndIngest(ctx, { triggerAfterRefresh = true, silent = false } = {}) {
  const capture = $('browserCaptureInput')?.value?.trim();
  const storedAuth = loadStoredAuthPayload();
  // #region agent log
  debugLog('endpoints.js:syncFromBrowserAndIngest', 'entry', {
    silent,
    triggerAfterRefresh,
    hasCapture: Boolean(capture),
    hasStoredAuth: Boolean(storedAuth?.authorization),
    preferLocal: ctx.settings.get('preferLocalIngest') !== false,
    origin: typeof window !== 'undefined' ? window.location.hostname : '',
  }, 'H2');
  // #endregion
  if (!capture) {
    if (!silent) ctx.showAlert('Paste a fetch() snippet from DevTools first', 'warn');
    return;
  }

  const syncBtn = $('syncBrowserIngestBtn');
  const ingestBtn = $('triggerIngestBtn');
  const localBtn = $('localIngestBtn');
  if (syncBtn) syncBtn.disabled = true;
  if (ingestBtn) ingestBtn.disabled = true;
  if (localBtn) localBtn.disabled = true;

  const preferLocal = ctx.settings.get('preferLocalIngest') !== false;

  try {
    const storedAuth = loadStoredAuthPayload();
    const payload = parseBrowserCapture(capture, { mergeStored: storedAuth });
    if (ctx.settings.get('persistBrowserCapture') !== false) saveStoredCapture(capture);
    saveStoredAuthPayload(payload);

    const refresh = await ctx.apiPost('/refresh-auth', payload);
    const accepted = (refresh?.accepted || []).join(', ') || refresh?.mode || 'ok';
    if (!silent) ctx.showAlert(`Auth synced (${accepted})`, 'info');

    if (!triggerAfterRefresh) {
      updateCookieHealth(ctx);
      loadEndpoints(ctx);
      return { auth: refresh };
    }

    if (preferLocal) {
      try {
        const local = await runLocalBrowserIngest(ctx, payload, {
          onProgress: (msg) => {
            const el = $('ingestionProgress');
            if (el) el.textContent = msg;
          },
        });
        const ok = local.upload?.endpointsSucceeded ?? local.fetched?.length ?? 0;
        const fail = local.upload?.endpointsFailed ?? local.failures?.length ?? 0;
        if (!silent) {
          ctx.showAlert(
            local.status === 'ok'
              ? `Local ingest: ${ok} OK${local.cursorAdvanced ? ' · cursor advanced' : ''}`
              : `Local ingest ${local.status}: ${ok} OK · ${fail} failed`,
            local.status === 'ok' ? 'info' : 'warn',
          );
        }
        if (local.status === 'skipped' && !silent) {
          ctx.showAlert(local.message, 'warn');
        }
        updateCookieHealth(ctx);
        loadEndpoints(ctx);
        // #region agent log
        debugLog('endpoints.js:syncFromBrowserAndIngest', 'local ingest done', {
          status: local.status,
          ok: local.upload?.endpointsSucceeded ?? local.fetched?.length ?? 0,
          cursorAdvanced: local.cursorAdvanced,
        }, 'H2');
        // #endregion
        return { auth: refresh, local };
      } catch (e) {
        if (e instanceof LocalIngestBlockedError) {
          // #region agent log
          debugLog('endpoints.js:syncFromBrowserAndIngest', 'CORS blocked', { silent, errorName: e.name }, 'H2');
          // #endregion
          ctx.showAlert(e.message, 'warn');
          if (!silent) {
            await copyConsoleIngestScript(ctx);
            ctx.showAlert('Console script copied — paste in DevTools on fantasy402.com/manager.html', 'info');
          }
          updateCookieHealth(ctx);
          loadEndpoints(ctx);
          // #region agent log
          debugLog('endpoints.js:syncFromBrowserAndIngest', 'returning corsBlocked', { silent }, 'H4');
          // #endregion
          return { auth: refresh, corsBlocked: true };
        }
        throw e;
      }
    }

    const result = await ctx.apiPost('/trigger', {}, { acceptStatuses: [200, 202, 500] });
    const ok = result?.endpointsSucceeded ?? 0;
    const skipped = result?.endpointsSkipped ?? 0;
    const parts = [`${ok} OK`];
    if (skipped > 0) parts.push(`${skipped} skipped`);
    if (!silent) ctx.showAlert(`Worker ingest: ${parts.join(' · ')}`, skipped && !ok ? 'warn' : 'info');
    updateCookieHealth(ctx);
    loadEndpoints(ctx);
    return { auth: refresh, ingestion: result };
  } catch (e) {
    if (!silent) ctx.showAlert(`Sync failed: ${e.message}`, 'error');
    throw e;
  } finally {
    if (syncBtn) syncBtn.disabled = false;
    if (ingestBtn) ingestBtn.disabled = false;
    if (localBtn) localBtn.disabled = false;
    const el = $('ingestionProgress');
    if (el) el.textContent = '';
  }
}

export async function runLocalIngestOnly(ctx) {
  const storedAuth = loadStoredAuthPayload();
  if (!storedAuth?.authorization) {
    ctx.showAlert('Sync auth first with a /cloud/api/* capture', 'warn');
    return;
  }
  const localBtn = $('localIngestBtn');
  if (localBtn) localBtn.disabled = true;
  try {
    const local = await runLocalBrowserIngest(ctx, storedAuth, {
      onProgress: (msg) => {
        const el = $('ingestionProgress');
        if (el) el.textContent = msg;
      },
    });
    const ok = local.upload?.endpointsSucceeded ?? local.fetched?.length ?? 0;
    ctx.showAlert(
      local.status === 'ok' ? `Local ingest: ${ok} OK` : `Local ingest: ${local.message || local.status}`,
      local.status === 'ok' ? 'info' : 'warn',
    );
    loadEndpoints(ctx);
    return local;
  } catch (e) {
    if (e instanceof LocalIngestBlockedError) {
      await copyConsoleIngestScript(ctx);
      ctx.showAlert('CORS blocked — console script copied. Paste in DevTools on manager.html', 'warn');
      return;
    }
    ctx.showAlert(e.message, 'error');
    throw e;
  } finally {
    if (localBtn) localBtn.disabled = false;
    const el = $('ingestionProgress');
    if (el) el.textContent = '';
  }
}

export function updateCookieHealth(ctx) {
  const status = ctx.statusPoller.status;
  const failures = status?.recentFailures || [];
  const cookieFailures = failures.filter((f) => (f.path || f.endpoint_key || '').includes('cookie') || (f.path || f.endpoint_key || '').includes('refresh'));
  const el = $('cookieHealth');
  if (!el) return;
  const auth = formatAuthStatus(loadStoredAuthPayload());
  const parts = [`<span class="ds-badge ${auth.className}">${escapeHtml(auth.label)}</span>`];
  if (cookieFailures.length) {
    parts.push(`<span class="ds-badge ds-badge--error">${cookieFailures.length} cookie/auth failures (24h)</span>`);
  } else {
    parts.push('<span class="ds-badge ds-badge--success">Cookie health OK</span>');
  }
  if (!isFantasy402Origin()) {
    parts.push('<span class="ds-badge">Use console script on manager.html</span>');
  }
  el.innerHTML = parts.join(' ');
}

function paintAutomationStatus() {
  const el = $('automationStatus');
  if (!el) return;
  const status = formatAutomationStatus();
  el.innerHTML = [
    `<span class="ds-badge ${status.className}">${escapeHtml(status.label)}</span>`,
    status.hint ? `<span class="ds-help-text">${escapeHtml(status.hint)}</span>` : '',
  ].filter(Boolean).join(' ');
}

export async function probeWorkerAuthHealthAction(ctx) {
  const authHealth = await fetchWorkerAuthHealth(ctx);
  if (!authHealth) {
    ctx.showAlert('Worker /auth/health unreachable (deploy Worker or check API token)', 'warn');
  } else {
    const badge = formatWorkerAuthHealthBadge(authHealth);
    ctx.showAlert(badge.label, authHealth.status === 'ready' ? 'info' : 'warn');
  }
  await loadEndpoints(ctx);
}

export function copyVpsAuthStackCommands(ctx) {
  return copyVpsSetupCommands(ctx);
}

function paintAuthStatus(ingestionPlan, authHealth) {
  const el = $('authStatus');
  if (!el) return;
  const stored = loadStoredAuthPayload();
  const auth = formatAuthStatus(stored);
  const workerAuth = formatWorkerAuthHealthBadge(authHealth);
  const plane = classifyAutomationPlane({ authHealth, storedAuth: stored });
  const progress = ingestionPlan ? formatBatchProgress(ingestionPlan) : '';
  const stackHint = formatAuthStackHint(authHealth);
  const planeHint = formatAutomationPlaneHint(plane);
  el.innerHTML = [
    `<span class="ds-badge ${auth.className}">${escapeHtml(auth.label)}</span>`,
    `<span class="ds-badge ${workerAuth.className}">${escapeHtml(workerAuth.label)}</span>`,
    `<span class="ds-badge ds-badge--info">${escapeHtml(plane.replace(/-/g, ' '))}</span>`,
    stored?.savedAt ? `<span class="ds-help-text">saved ${escapeHtml(stored.savedAt.slice(0, 16).replace('T', ' '))}</span>` : '',
    workerAuth.hint ? `<span class="ds-help-text">${escapeHtml(workerAuth.hint)}</span>` : '',
    progress ? `<span class="ds-help-text">${escapeHtml(progress)}</span>` : '',
    `<span class="ds-help-text">${escapeHtml(planeHint)}</span>`,
    stackHint ? `<span class="ds-help-text">${escapeHtml(stackHint)}</span>` : '',
  ].filter(Boolean).join(' ');
}

export async function installAutoRunner(ctx) {
  try {
    const catalog = await fetchCatalogStatus(ctx);
    const loops = catalogBackfillLoops(catalog);
    await installManagerAutoRunner(window.location.origin, {
      intervalMs: ctx.settings.get('ingestIntervalMs') || 300_000,
      loops,
    });
    try { localStorage.setItem('f402-auto-runner-pending', new Date().toISOString()); } catch { /* ignore */ }
    ctx.showAlert(`Auto-runner copied (${loops} backfill loops) — paste in DevTools on manager tab`, 'info');
    paintAutomationStatus();
  } catch (e) {
    ctx.showAlert(`Install failed: ${e.message}`, 'error');
  }
}

export async function confirmAutoRunnerInstalled(ctx) {
  markAutoRunnerInstalled();
  paintAutomationStatus();
  ctx.showAlert('Auto-runner marked installed — ingest runs on manager.html every 5 min', 'info');
}

export async function copyConsoleIngestScript(ctx, { loops = 1, autoRun = false } = {}) {
  if (autoRun) return installAutoRunner(ctx);

  let auth = loadStoredAuthPayload();
  if (!auth?.authorization) {
    auth = await resolveAuthPayload(ctx);
    if (!auth?.authorization) {
      ctx.showAlert('Sync auth first with a /cloud/api/* capture', 'warn');
      return;
    }
  }
  try {
    await copyManagerConsoleScript(window.location.origin, auth, { loops });
    ctx.showAlert(
      loops > 1
        ? `Copied ${loops}-batch console script — paste in DevTools on manager.html`
        : 'Copied console script — paste in DevTools on fantasy402.com/manager.html',
      'info',
    );
  } catch (e) {
    ctx.showAlert(`Copy failed: ${e.message}`, 'error');
  }
}

export async function runLocalIngestAllBatches(ctx) {
  const stored = loadStoredAuthPayload();
  if (!stored?.authorization) {
    ctx.showAlert('Sync auth first with a /cloud/api/* capture', 'warn');
    return;
  }
  const btn = $('localIngestAllBtn');
  const localBtn = $('localIngestBtn');
  if (btn) btn.disabled = true;
  if (localBtn) localBtn.disabled = true;
  try {
    if (isFantasy402Origin()) {
      const result = await runLocalIngestLoops(ctx, stored, {
        loops: 'all',
        onProgress: (msg) => {
          const el = $('ingestionProgress');
          if (el) el.textContent = msg;
        },
      });
      ctx.showAlert(`Full catalog: ${result.totalOk} endpoints across ${result.loops} batches`, 'info');
      loadEndpoints(ctx);
      return result;
    }
    const firstPlan = await ctx.api('/ingest/local/plan');
    const catalogSize = firstPlan?.batch?.catalogSize || 86;
    const batchSize = firstPlan?.batch?.batchSize || 12;
    const loops = Math.ceil(catalogSize / batchSize);
    await copySelfBootstrappingAutoRunner(window.location.origin, { loops });
    ctx.showAlert(`Full-catalog auto-runner copied (${loops} batches × ${batchSize} endpoints) — paste in DevTools on manager.html`, 'info');
  } catch (e) {
    ctx.showAlert(e instanceof LocalIngestBlockedError ? e.message : e.message, 'error');
    throw e;
  } finally {
    if (btn) btn.disabled = false;
    if (localBtn) localBtn.disabled = false;
    const el = $('ingestionProgress');
    if (el) el.textContent = '';
  }
}
