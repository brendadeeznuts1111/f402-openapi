// dashboard/js/views/logs.js

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { usd, ago } from '../format.js';
import { renderErrorState } from '../ui.js';
import { renderEmptyState } from '../design-system.js';
import { SortableTable } from '../sortable-table.js';

let agentLogTable = null;

export async function loadLogs(ctx) {
  await Promise.all([loadLogTimeline(ctx), loadAgentLogTable(ctx), loadSystemLog(ctx)]);
}

async function loadLogTimeline(ctx) {
  try {
    const status = $('logStatus').value;
    const [wagers, alerts] = await Promise.all([
      ctx.api('/bet-ticker-wagers?limit=20').catch(() => ({ wagers: [] })),
      ctx.api('/alert-log?limit=20').catch(() => ({ entries: [] })),
    ]);
    let events = [
      ...(wagers.wagers || []).map((w) => ({ time: w.captured_at, title: `Wager ${w.wager_number}`, meta: `${w.login} — ${usd(w.amount_wagered)}`, status: 'ok' })),
      ...(alerts.entries || []).map((a) => ({ time: a.created_at, title: `Alert: ${a.metric}`, meta: `${a.agent_id}`, status: 'warn' })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time));

    if (status) events = events.filter((e) => e.status === status);

    if (!events.length) {
      $('logTimeline').innerHTML = '<div class="ds-empty-state"><div class="ds-empty-state__icon">📭</div><div class="ds-empty-state__message">No events</div></div>';
      return;
    }
    $('logTimeline').innerHTML = events.map((e) => `
      <div class="ds-timeline__item">
        <span class="ds-timeline__dot ds-timeline__dot--${escapeHtml(e.status)}"></span>
        <div class="ds-timeline__content">
          <div class="ds-timeline__time">${ago(e.time)}</div>
          <div class="ds-timeline__title">${escapeHtml(e.title)}</div>
          <div class="ds-timeline__meta">${escapeHtml(e.meta)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) { $('logTimeline').innerHTML = renderErrorState(e.message); }
}

async function loadAgentLogTable(ctx) {
  if (!agentLogTable) {
    agentLogTable = new SortableTable('agentLogTable', [
      { key: 'agent_id', label: 'Agent', type: 'string' },
      { key: 'total_wagers', label: 'Wagers', type: 'number' },
      { key: 'total_volume', label: 'Volume', type: 'number', formatter: (v) => usd(v) },
      { key: 'win_rate', label: 'Win%', type: 'number', formatter: (v) => (v ? v.toFixed(1) + '%' : '-') },
    ]);
  }
  try {
    const d = await ctx.api('/performance?limit=50');
    agentLogTable.setData(d.records || []);
  } catch (e) { $('agentLogTable').innerHTML = renderErrorState(e.message, '/performance'); }
}

export async function loadSystemLog(ctx) {
  try {
    const status = ctx.statusPoller.status;
    const run = status?.latestRun;
    const failures = status?.recentFailures || [];
    const events = [
      { time: new Date().toISOString(), title: 'Dashboard initialized', meta: 'v3.1 — view modules', type: 'success' },
      { time: status?.timestamp, title: 'Endpoint status poll', meta: `Worker: ${status?.worker || 'unknown'}`, type: 'info' },
    ];
    if (run) {
      events.push({ time: run.started_at, title: `Ingestion run ${run.status}`, meta: `${run.endpoints_succeeded || 0} succeeded, ${run.endpoints_failed || 0} failed`, type: run.status === 'success' ? 'success' : 'warning' });
    }
    for (const f of failures.slice(0, 5)) {
      events.push({ time: f.last_failure, title: `Failure: ${f.endpoint_key || 'unknown'}`, meta: `${f.failure_count} failures in last 24h`, type: 'error' });
    }
    events.sort((a, b) => new Date(b.time || 0) - new Date(a.time || 0));

    $('systemLog').innerHTML = events.map((e) => `
      <div class="ds-timeline__item">
        <span class="ds-timeline__dot ds-timeline__dot--${escapeHtml(e.type)}"></span>
        <div class="ds-timeline__content">
          <div class="ds-timeline__time">${ago(e.time)}</div>
          <div class="ds-timeline__title">${escapeHtml(e.title)}</div>
          <div class="ds-timeline__meta">${escapeHtml(e.meta)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) { $('systemLog').innerHTML = renderErrorState(e.message); }
}
