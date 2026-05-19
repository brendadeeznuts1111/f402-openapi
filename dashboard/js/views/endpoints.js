// dashboard/js/views/endpoints.js

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { ago } from '../format.js';
import { renderErrorState } from '../ui.js';
import { renderEmptyState, getZoneBadgeClass } from '../design-system.js';

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
    </tr>`;
  }).join('');
  const contentHeader = showUpstreamMeta ? '<th>Content type</th>' : '';
  return `<table class="ds-table-sm"><thead><tr><th>Zone</th><th>Method</th><th>Path</th><th>Description</th>${contentHeader}<th>Refresh</th><th>Configured</th></tr></thead><tbody>${rows}</tbody></table>`;
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
  $('endpointsCount').textContent = `${filtered.length} / ${routes.length} ${label}${configuredHint}`;
}

export async function loadEndpoints(ctx) {
  try {
    const [manifest, upstream, health] = await Promise.all([
      ctx.store.fetch('endpoints-manifest', () => ctx.api('/endpoints'), 60000),
      ctx.store.fetch('upstream-endpoints', () => ctx.api('/upstream-endpoints'), 60000),
      ctx.api('/endpoint-status').catch(() => ({ latestRun: null, recentFailures: [] })),
    ]);

    workerRoutes = manifest?.routes || [];
    upstreamRoutes = upstream?.routes || [];
    upstreamMeta = {
      configuredCount: upstream?.configuredCount,
      implementedCount: upstream?.implementedCount,
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
    let healthHtml = '';
    if (run) {
      const statusDot = run.status === 'success' ? '🟢' : '🔴';
      healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot ds-timeline__dot--${run.status === 'success' ? 'success' : 'error'}"></span><div class="ds-timeline__content"><div class="ds-timeline__time">${ago(run.finished_at || run.started_at)}</div><div class="ds-timeline__title">${statusDot} Run ${run.status}</div><div class="ds-timeline__meta">${run.endpoints_succeeded || 0} OK · ${run.endpoints_failed || 0} failed</div></div></div>`;
    }
    if (failures.length) {
      for (const f of failures.slice(0, 5)) {
        healthHtml += `<div class="ds-timeline__item"><span class="ds-timeline__dot ds-timeline__dot--error"></span><div class="ds-timeline__content"><div class="ds-timeline__time">${ago(f.last_failure)}</div><div class="ds-timeline__title">Failed: ${escapeHtml(f.endpoint_key || '?')}</div><div class="ds-timeline__meta">${f.failure_count}x in 24h</div></div></div>`;
      }
    }
    $('endpointHealth').innerHTML = healthHtml
      ? `<div class="ds-timeline">${healthHtml}</div>`
      : renderEmptyState({ message: 'No ingestion data', hint: 'Trigger an ingestion run from Quick Actions.' });
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
    await ctx.apiPost('/ingest/local', { source: 'dashboard' });
    ctx.showAlert('Ingestion triggered', 'info');
    loadEndpoints(ctx);
  } catch (e) {
    ctx.showAlert(`Ingestion failed: ${e.message}`, 'error');
  }
}

export async function refreshAuth(ctx) {
  try {
    const result = await ctx.apiPost('/refresh-auth', {});
    const mode = result?.mode === 'renew'
      ? 'Token renewed'
      : result?.mode === 'session'
        ? 'Session refreshed'
        : 'Auth overlay updated';
    ctx.showAlert(`${mode}`, 'info');
  } catch (e) {
    ctx.showAlert(`Auth refresh failed: ${e.message}`, 'error');
  }
}

export function updateCookieHealth(ctx) {
  const status = ctx.statusPoller.status;
  const failures = status?.recentFailures || [];
  const cookieFailures = failures.filter((f) => (f.path || f.endpoint_key || '').includes('cookie') || (f.path || f.endpoint_key || '').includes('refresh'));
  const el = $('cookieHealth');
  if (cookieFailures.length) {
    el.innerHTML = `<span class="ds-badge ds-badge--error">${cookieFailures.length} cookie/auth failures (24h)</span>`;
  } else {
    el.innerHTML = '<span class="ds-badge ds-badge--success">Cookie health OK</span>';
  }
}
