// dashboard/js/views/overview.js

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { fmt, usd, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval, CHART_COLORS } from '../design-system.js';
import { ensureChart } from '../charts.js';
import { SortableTable } from '../sortable-table.js';

let agentTable = null;

export async function loadOverview(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  await Promise.all([
    loadStatCards(ctx),
    renderVolumeChart(ctx),
    loadAgentTable(ctx),
    loadEventTimeline(ctx),
  ]);
}

async function loadStatCards(ctx) {
  try {
    const data = await ctx.store.fetch('/summary', () => ctx.api('/summary'), storeTTL(getRefreshInterval('/summary')));
    $('statCards').innerHTML = `
      <div class="ds-stat-card"><div class="ds-stat-card__icon">🎰</div><div class="ds-stat-card__value">${fmt(data.liveWagers.total)}</div><div class="ds-stat-card__label">Live Wagers</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">✅</div><div class="ds-stat-card__value">${fmt(data.gradedWagers.total)}</div><div class="ds-stat-card__label">Graded</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">💰</div><div class="ds-stat-card__value">${usd(data.liveWagers.volume)}</div><div class="ds-stat-card__label">Volume</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">👥</div><div class="ds-stat-card__value">${fmt(data.liveWagers.agents)}</div><div class="ds-stat-card__label">Agents</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">📈</div><div class="ds-stat-card__value">${usd(data.gradedWagers.pnl)}</div><div class="ds-stat-card__label">PNL</div></div>
      <div class="ds-stat-card"><div class="ds-stat-card__icon">⚠️</div><div class="ds-stat-card__value">${fmt(data.liveWagers.types || 0)}</div><div class="ds-stat-card__label">Wager Types</div></div>
    `;
  } catch (e) {
    $('statCards').innerHTML = renderErrorState(e.message, '/summary');
  }
}

export async function renderVolumeChart(ctx) {
  try {
    const d = await ctx.api('/bet-ticker-wagers?limit=100');
    if (!d.wagers?.length) { $('volumeChartWrap').innerHTML = '<div class="ds-loading">No data</div>'; return; }
    const buckets = {};
    for (const w of d.wagers) {
      const hour = w.captured_at?.slice(0, 13) + ':00';
      buckets[hour] = (buckets[hour] || 0) + (w.amount_wagered || 0);
    }
    const labels = Object.keys(buckets).sort();
    const values = labels.map((l) => buckets[l] / 100);

    const volumeChart = ensureChart('volume', 'volumeChart', 'line');
    $('volumeChartWrap').style.display = 'none';
    $('volumeChart').style.display = 'block';
    volumeChart.data = {
      labels,
      datasets: [{
        label: 'Volume ($)',
        data: values,
        borderColor: CHART_COLORS.success,
        backgroundColor: 'rgba(0, 255, 136, 0.1)',
        fill: true,
        tension: 0.4,
      }],
    };
    await volumeChart.render();
  } catch (e) {
    $('volumeChartWrap').innerHTML = renderErrorState(e.message);
  }
}

async function loadAgentTable(ctx) {
  if (!agentTable) {
    agentTable = new SortableTable('agentTable', [
      { key: 'agent_id', label: 'Agent', type: 'string' },
      { key: 'total_wagers', label: 'Wagers', type: 'number' },
      { key: 'total_volume', label: 'Volume', type: 'number', formatter: (v) => usd(v) },
      { key: 'win_rate', label: 'Win%', type: 'number', formatter: (v) => (v ? v.toFixed(1) + '%' : '-') },
    ]);
  }
  try {
    const d = await ctx.store.fetch('/performance', () => ctx.api('/performance?limit=20'), storeTTL(getRefreshInterval('/performance')));
    agentTable.setData(d.records || []);
  } catch (e) {
    $('agentTable').innerHTML = renderErrorState(e.message, '/performance');
  }
}

async function loadEventTimeline(ctx) {
  try {
    const [wagers, alerts] = await Promise.all([
      ctx.api('/bet-ticker-wagers?limit=10').catch(() => ({ wagers: [] })),
      ctx.api('/alert-log?limit=10').catch(() => ({ entries: [] })),
    ]);
    const events = [
      ...(wagers.wagers || []).map((w) => ({ time: w.captured_at, title: `Wager ${w.wager_number}`, meta: `${w.login} — ${usd(w.amount_wagered)}`, type: 'success' })),
      ...(alerts.entries || []).map((a) => ({ time: a.created_at, title: `Alert: ${a.metric}`, meta: `${a.agent_id} — ${a.actual_value}/${a.threshold}`, type: 'warning' })),
    ].sort((a, b) => new Date(b.time) - new Date(a.time)).slice(0, 10);

    if (!events.length) {
      $('eventTimeline').innerHTML = '<div class="ds-empty-state"><div class="ds-empty-state__icon">📭</div><div class="ds-empty-state__message">No recent events</div></div>';
      return;
    }
    $('eventTimeline').innerHTML = events.map((e) => `
      <div class="ds-timeline__item">
        <span class="ds-timeline__dot ds-timeline__dot--${escapeHtml(e.type)}"></span>
        <div class="ds-timeline__content">
          <div class="ds-timeline__time">${ago(e.time)}</div>
          <div class="ds-timeline__title">${escapeHtml(e.title)}</div>
          <div class="ds-timeline__meta">${escapeHtml(e.meta)}</div>
        </div>
      </div>
    `).join('');
  } catch (e) {
    $('eventTimeline').innerHTML = renderErrorState(e.message);
  }
}
