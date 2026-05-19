// dashboard/js/views/analytics.js

import { $ } from '../dom.js';
import { renderErrorState } from '../ui.js';
import { CHART_COLORS, WAGER_TYPE_CHART_COLORS } from '../design-system.js';
import { ensureChart, getChart, setChart } from '../charts.js';
import { JsonViewer } from '../json-viewer.js';

let jsonViewer = null;

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
  document.querySelectorAll('#view-analytics .ds-tab-content').forEach((c) => { c.style.display = ''; });
  document.querySelectorAll('[data-chart-tab]').forEach((t) => {
    t.classList.toggle('ds-active', t.dataset.chartTab === 'traffic');
  });

  try {
    const [wagersRes, statusRes] = await Promise.all([
      ctx.api('/bet-ticker-wagers?limit=100'),
      ctx.api('/endpoint-status').catch(() => ({ routeLatency: [] })),
    ]);
    const wagers = wagersRes.wagers || [];
    if (!wagers.length) {
      ['trafficChartWrap', 'latencyChartWrap', 'typeChartWrap', 'agentChartWrap'].forEach((id) => {
        $(id).innerHTML = '<div class="ds-loading">No data</div>';
      });
      return;
    }

    const hourBuckets = {};
    for (const w of wagers) { const h = w.captured_at?.slice(11, 13) + ':00'; hourBuckets[h] = (hourBuckets[h] || 0) + 1; }
    const hours = Object.keys(hourBuckets).sort();
    const trafficData = { labels: hours, datasets: [{ label: 'Wagers', data: hours.map((h) => hourBuckets[h]), backgroundColor: CHART_COLORS.info }] };

    const typeBuckets = { S: 0, P: 0, M: 0, L: 0 };
    for (const w of wagers) typeBuckets[w.wager_type] = (typeBuckets[w.wager_type] || 0) + 1;
    const typeData = {
      labels: ['Straight', 'Parlay', 'Moneyline', 'Live'],
      datasets: [{ data: [typeBuckets.S, typeBuckets.P, typeBuckets.M, typeBuckets.L], backgroundColor: [...WAGER_TYPE_CHART_COLORS] }],
    };

    const agentBuckets = {};
    for (const w of wagers) agentBuckets[w.agent_id] = (agentBuckets[w.agent_id] || 0) + (w.amount_wagered || 0);
    const topAgents = Object.entries(agentBuckets).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const agentData = {
      labels: topAgents.map((a) => a[0]),
      datasets: [{ label: 'Volume', data: topAgents.map((a) => a[1] / 100), backgroundColor: CHART_COLORS.accent }],
    };

    const trafficChart = ensureChart('traffic', 'trafficChart', 'bar');
    $('trafficChartWrap').style.display = 'none';
    $('trafficChart').style.display = 'block';
    trafficChart.data = trafficData;
    await trafficChart.render();

    await renderLatencyChart(ctx, statusRes.routeLatency || []);

    const typeChart = ensureChart('type', 'typeChart', 'doughnut');
    $('typeChartWrap').style.display = 'none';
    $('typeChart').style.display = 'block';
    typeChart.data = typeData;
    if ($('tab-distribution')?.style.display === 'block') await typeChart.render();

    const agentChart = ensureChart('agent', 'agentChart', 'bar');
    $('agentChartWrap').style.display = 'none';
    $('agentChart').style.display = 'block';
    agentChart.data = agentData;
    if ($('tab-distribution')?.style.display === 'block') await agentChart.render();
  } catch (e) {
    ['trafficChartWrap', 'latencyChartWrap', 'typeChartWrap', 'agentChartWrap'].forEach((id) => {
      $(id).innerHTML = renderErrorState(e.message);
    });
  }
}

export async function renderLatencyChart(ctx, routeLatency) {
  const prev = getChart('latency');
  if (prev) { prev.destroy(); setChart('latency', null); }

  if (!routeLatency?.length) {
    $('latencyChart').style.display = 'none';
    $('latencyChartWrap').style.display = 'block';
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

  const latencyChart = ensureChart('latency', 'latencyChart', 'line');
  $('latencyChartWrap').innerHTML = [
    '<div class="ds-skeleton ds-skeleton-row"></div>',
    '<div class="ds-skeleton ds-skeleton-row ds-skeleton-row--medium"></div>',
    '<div class="ds-skeleton ds-skeleton-row ds-skeleton-row--short"></div>',
  ].join('');
  $('latencyChartWrap').style.display = 'none';
  $('latencyChart').style.display = 'block';
  latencyChart.data = {
    labels,
    datasets: [{
      label: 'Avg latency (ms)',
      data: values,
      borderColor: CHART_COLORS.warning,
      backgroundColor: 'rgba(255, 215, 0, 0.25)',
      tension: 0.3,
    }],
  };
  await latencyChart.render();
}

export function onChartTabVisible(name, ctx) {
  if (name === 'traffic' && getChart('traffic')) getChart('traffic').render();
  if (name === 'latency') {
    ctx.api('/endpoint-status')
      .then((s) => renderLatencyChart(ctx, s.routeLatency || []))
      .catch(() => renderLatencyChart(ctx, []));
  }
  if (name === 'distribution') {
    const typeChart = getChart('type');
    const agentChart = getChart('agent');
    if (typeChart) {
      $('typeChartWrap').style.display = 'none';
      $('typeChart').style.display = 'block';
      typeChart.render();
    }
    if (agentChart) {
      $('agentChartWrap').style.display = 'none';
      $('agentChart').style.display = 'block';
      agentChart.render();
    }
  }
}
