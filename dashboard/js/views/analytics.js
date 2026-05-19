// dashboard/js/views/analytics.js

import { $ } from '../dom.js';
import { renderErrorState } from '../ui.js';
import { CHART_COLORS, WAGER_TYPE_CHART_COLORS } from '../design-system.js';
import { ensureChart, getChart, setChart } from '../charts.js';
import { JsonViewer } from '../json-viewer.js';

let jsonViewer = null;
let activeChartTab = 'traffic';
let analyticsData = null;

export function getActiveChartTab() {
  const tab = document.querySelector('[data-chart-tab].ds-active');
  return tab?.dataset.chartTab || activeChartTab;
}

export function setActiveChartTab(name) {
  activeChartTab = name;
}

function isTabPanelVisible(tabId) {
  const el = document.getElementById(tabId);
  if (!el) return false;
  return getComputedStyle(el).display !== 'none';
}

function showChartCanvas(wrapId, canvasId) {
  const wrap = $(wrapId);
  const canvas = $(canvasId);
  if (wrap) wrap.style.display = 'none';
  if (canvas) canvas.style.display = 'block';
}

export async function loadAnalytics(ctx) {
  await renderAnalyticsCharts(ctx);
  try {
    const d = await ctx.api('/summary');
    if (!jsonViewer) jsonViewer = new JsonViewer('jsonViewer', d);
    jsonViewer.setData(d);
  } catch (e) {
    $('jsonViewer').innerHTML = renderErrorState(e.message, '/summary');
  }
}

export async function renderAnalyticsCharts(ctx) {
  const tab = getActiveChartTab();

  try {
    const [wagersRes, statusRes] = await Promise.all([
      ctx.api('/bet-ticker-wagers?limit=100'),
      ctx.api('/endpoint-status').catch(() => ({ routeLatency: [] })),
    ]);
    const wagers = wagersRes.wagers || [];
    analyticsData = { wagers, routeLatency: statusRes.routeLatency || [] };

    if (!wagers.length) {
      ['trafficChartWrap', 'latencyChartWrap', 'typeChartWrap', 'agentChartWrap'].forEach((id) => {
        const el = $(id);
        if (el) el.innerHTML = '<div class="ds-empty-state"><div class="ds-empty-state__message">No wager data</div></div>';
      });
      return;
    }

    const hourBuckets = {};
    for (const w of wagers) {
      const h = w.captured_at?.slice(11, 13) + ':00';
      hourBuckets[h] = (hourBuckets[h] || 0) + 1;
    }
    const hours = Object.keys(hourBuckets).sort();
    const trafficData = {
      labels: hours,
      datasets: [{ label: 'Wagers', data: hours.map((h) => hourBuckets[h]), backgroundColor: CHART_COLORS.info }],
    };

    const typeBuckets = { S: 0, P: 0, M: 0, L: 0 };
    for (const w of wagers) typeBuckets[w.wager_type] = (typeBuckets[w.wager_type] || 0) + 1;
    const typeData = {
      labels: ['Straight', 'Parlay', 'Moneyline', 'Live'],
      datasets: [{
        data: [typeBuckets.S, typeBuckets.P, typeBuckets.M, typeBuckets.L],
        backgroundColor: [...WAGER_TYPE_CHART_COLORS],
      }],
    };

    const agentBuckets = {};
    for (const w of wagers) {
      agentBuckets[w.agent_id] = (agentBuckets[w.agent_id] || 0) + (w.amount_wagered || 0);
    }
    const topAgents = Object.entries(agentBuckets).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const agentData = {
      labels: topAgents.map((a) => a[0]),
      datasets: [{ label: 'Volume', data: topAgents.map((a) => a[1] / 100), backgroundColor: CHART_COLORS.accent }],
    };

    const trafficChart = ensureChart('traffic', 'trafficChart', 'bar');
    showChartCanvas('trafficChartWrap', 'trafficChart');
    trafficChart.data = trafficData;
    if (tab === 'traffic') await trafficChart.render();

    const typeChart = ensureChart('type', 'typeChart', 'doughnut');
    showChartCanvas('typeChartWrap', 'typeChart');
    typeChart.data = typeData;

    const agentChart = ensureChart('agent', 'agentChart', 'bar');
    showChartCanvas('agentChartWrap', 'agentChart');
    agentChart.data = agentData;

    if (tab === 'latency') {
      await renderLatencyChart(ctx, analyticsData.routeLatency);
    } else if (tab === 'distribution') {
      await typeChart.render();
      await agentChart.render();
    }
  } catch (e) {
    ['trafficChartWrap', 'latencyChartWrap', 'typeChartWrap', 'agentChartWrap'].forEach((id) => {
      const el = $(id);
      if (el) el.innerHTML = renderErrorState(e.message);
    });
  }
}

export async function renderLatencyChart(ctx, routeLatency) {
  const prev = getChart('latency');
  if (prev) {
    prev.destroy();
    setChart('latency', null);
  }

  if (!routeLatency?.length) {
    $('latencyChart').style.display = 'none';
    $('latencyChartWrap').style.display = 'flex';
    $('latencyChartWrap').innerHTML = [
      '<div class="ds-empty-state">',
      '<div class="ds-empty-state__icon">&#9201;</div>',
      '<div class="ds-empty-state__message">No ingestion run latency data yet. Trigger an ingestion run to populate metrics.</div>',
      '</div>',
    ].join('');
    return;
  }

  const labels = routeLatency.map((r) => r.path || r.endpoint_key);
  const values = routeLatency.map((r) => Number(r.avg_duration_ms) || 0);

  $('latencyChartWrap').innerHTML = [
    '<div class="ds-skeleton ds-skeleton-row"></div>',
    '<div class="ds-skeleton ds-skeleton-row ds-skeleton-row--medium"></div>',
    '<div class="ds-skeleton ds-skeleton-row ds-skeleton-row--short"></div>',
  ].join('');
  $('latencyChartWrap').style.display = 'none';

  const latencyChart = ensureChart('latency', 'latencyChart', 'line');
  showChartCanvas('latencyChartWrap', 'latencyChart');
  latencyChart.data = {
    labels,
    datasets: [{
      label: 'Avg latency (ms)',
      data: values,
      borderColor: CHART_COLORS.warning,
      backgroundColor: 'rgba(255, 215, 0, 0.25)',
      tension: 0.3,
      fill: true,
    }],
  };
  await latencyChart.render();
}

export function onChartTabVisible(name, ctx) {
  setActiveChartTab(name);
  if (name === 'traffic') {
    const chart = getChart('traffic');
    if (chart) chart.render();
  }
  if (name === 'latency') {
    const latency = analyticsData?.routeLatency;
    if (latency) {
      renderLatencyChart(ctx, latency);
    } else {
      ctx.api('/endpoint-status')
        .then((s) => renderLatencyChart(ctx, s.routeLatency || []))
        .catch(() => renderLatencyChart(ctx, []));
    }
  }
  if (name === 'distribution') {
    const typeChart = getChart('type');
    const agentChart = getChart('agent');
    if (typeChart) {
      showChartCanvas('typeChartWrap', 'typeChart');
      typeChart.render();
    }
    if (agentChart) {
      showChartCanvas('agentChartWrap', 'agentChart');
      agentChart.render();
    }
  }
}
