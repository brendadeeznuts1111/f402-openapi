// dashboard/js/views/endpoints.js

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { ago } from '../format.js';
import { renderErrorState } from '../ui.js';

export async function loadEndpoints(ctx) {
  try {
    const [manifest, health] = await Promise.all([
      ctx.store.fetch('endpoints-manifest', () => ctx.api('/endpoints'), 60000),
      ctx.api('/endpoint-status').catch(() => ({ latestRun: null, recentFailures: [] })),
    ]);
    $('endpointsCount').textContent = `${manifest?.count || 0} routes`;

    const zoneFilter = $('endpointZoneFilter').value;
    const methodFilter = $('endpointMethodFilter').value;
    let routes = manifest?.routes || [];
    if (zoneFilter) routes = routes.filter((r) => r.zone === zoneFilter);
    if (methodFilter) routes = routes.filter((r) => r.method === methodFilter);

    if (!routes.length) {
      $('endpointsTable').innerHTML = '<div class="ds-loading">No endpoints match filter</div>';
    } else {
      const rows = routes.map((r) => {
        const zoneColor = r.zone ? `ds-zone-badge--${r.zone}` : 'ds-zone-badge--worker';
        return `<tr>
          <td><span class="ds-zone-badge ${zoneColor}">${escapeHtml(r.zone || 'worker')}</span></td>
          <td><code>${escapeHtml(r.method)}</code></td>
          <td><code>${escapeHtml(r.path)}</code></td>
          <td class="ds-cell-sm">${escapeHtml(r.description)}</td>
          <td class="ds-cell-sm">${r.refreshMs === 'realtime' ? '⚡ live' : r.refreshMs === 'manual' ? '—' : (r.refreshMs / 1000) + 's'}</td>
        </tr>`;
      }).join('');
      $('endpointsTable').innerHTML = `<table class="ds-table-sm"><thead><tr><th>Zone</th><th>Method</th><th>Path</th><th>Description</th><th>Refresh</th></tr></thead><tbody>${rows}</tbody></table>`;
    }

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
    $('endpointHealth').innerHTML = healthHtml ? `<div class="ds-timeline">${healthHtml}</div>` : '<div class="ds-loading">No ingestion data</div>';
  } catch (e) {
    $('endpointsTable').innerHTML = renderErrorState(e.message, '/endpoints');
  }
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
    await ctx.apiPost('/refresh-auth');
    ctx.showAlert('Auth refresh triggered', 'info');
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
    el.innerHTML = `<span class="ds-badge ds-badge--warn">⚠️ ${cookieFailures.length} cookie failure(s) in 24h</span>`;
  } else {
    el.innerHTML = `<span class="ds-badge ds-badge--info">🍪 Cookies OK</span>`;
  }
}
