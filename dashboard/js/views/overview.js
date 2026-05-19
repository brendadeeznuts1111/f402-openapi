// dashboard/js/views/overview.js

import { $ } from '../dom.js';
import { escapeHtml } from '../dom.js';
import { fmt, usd, ago } from '../format.js';
import { renderErrorState, storeTTL } from '../ui.js';
import { getRefreshInterval, getChartColors, chartFillColor, renderEmptyState } from '../design-system.js';
import { announceChartStatus } from '../chart-dom.js';
import { resolveVolumeChartType } from '../utils.js';
import { ensureChart, flushDeferredCharts, resizeAllCharts } from '../charts.js';
import { ensureChartMarkup, showChartReady, showChartError, showChartMessage } from '../chart-dom.js';
import { chartDataFromAggregates, mountLineBarTable } from '../chart-data.js';
import { SortableTable } from '../sortable-table.js';

let agentTable = null;

const VOLUME_MOUNT = { wrapId: 'volumeChartWrap', canvasId: 'volumeChart', plotSize: 'lg' };
const CHART_HOURS = 24;

export async function loadOverview(ctx) {
  $('lastUpdate').textContent = new Date().toLocaleTimeString();
  await loadStatCards(ctx);
  await Promise.all([
    renderVolumeChart(ctx),
    loadAgentTable(ctx),
    loadEventTimeline(ctx),
  ]);
  scheduleOverviewChartResize();
}

function scheduleOverviewChartResize() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      flushDeferredCharts();
      resizeAllCharts();
    });
  });
}

async function loadStatCards(ctx) {
  try {
    const data = await ctx.store.fetch(
      '/summary',
      () => ctx.api('/summary?days=1'),
      storeTTL(getRefreshInterval('/summary')),
    );
    const windowHint = data.window?.label
      ? `<p class="ds-stat-grid__hint">${escapeHtml(data.window.label)}</p>`
      : '';
    $('statCards').innerHTML = `${windowHint}
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
  const mount = ensureChartMarkup(VOLUME_MOUNT);
  if (!mount) return;

  try {
    const agg = await ctx.api(`/chart-aggregates?hours=${CHART_HOURS}`);
    const derived = chartDataFromAggregates(agg);
    if (!derived.volumeLabels.length) {
      showChartMessage(VOLUME_MOUNT.wrapId, renderEmptyState({ message: 'No wager data for chart' }));
      mountLineBarTable('volumeChartData', 'Volume trend', [], [], 'Volume ($)');
      return;
    }

    const chartColors = getChartColors();
    const { type: volumeType, fill } = resolveVolumeChartType(ctx.settings.get('chartType'));
    const volumeChart = ensureChart('volume', 'volumeChart', volumeType);
    showChartReady(mount);

    const isBar = volumeType === 'bar';
    const chartData = {
      labels: derived.volumeLabels,
      datasets: [{
        label: 'Volume ($)',
        data: derived.volumeValues,
        borderColor: chartColors.success,
        backgroundColor: isBar ? chartColors.success : (fill ? chartFillColor(chartColors.success) : 'transparent'),
        fill: !isBar && fill,
        tension: volumeType === 'line' ? 0.4 : 0,
      }],
    };

    mountLineBarTable('volumeChartData', 'Volume trend (24h)', derived.volumeLabels, derived.volumeValues, 'Volume ($)');

    if (volumeChart.hasChart) {
      volumeChart.update(chartData);
    } else {
      volumeChart.data = chartData;
      await volumeChart.render();
    }
    announceChartStatus(`Volume chart loaded, ${derived.volumeLabels.length} hourly buckets from server aggregates`);
  } catch (e) {
    const msg = e.message?.includes('CDN') || e.message?.includes('vendor')
      ? 'Chart library failed to load. Check network or use offline vendor bundle.'
      : e.message;
    showChartError(VOLUME_MOUNT.wrapId, msg, '/chart-aggregates');
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
      $('eventTimeline').innerHTML = renderEmptyState({ icon: '📭', message: 'No recent events' });
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
