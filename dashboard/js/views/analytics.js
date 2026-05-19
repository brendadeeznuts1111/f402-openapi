// dashboard/js/views/analytics.js

import { $ } from '../dom.js';
import { renderErrorState } from '../ui.js';
import {
  getChartColors,
  getWagerTypeChartColors,
  chartFillColor,
  renderEmptyState,
} from '../design-system.js';
import { ensureChart, getChart } from '../charts.js';
import {
  ensureChartMarkup,
  showChartReady,
  showChartError,
  showChartMessage,
  mountChartLegend,
  announceChartStatus,
} from '../chart-dom.js';
import {
  chartDataFromAggregates,
  mountLineBarTable,
  mountTypeTable,
  mountAgentTable,
  mountLatencyTable,
} from '../chart-data.js';
import { JsonViewer } from '../json-viewer.js';

const CHART_HOURS = 24;

let jsonViewer = null;
let activeChartTab = 'traffic';
let analyticsData = null;

const EMPTY_WAGERS_HTML = renderEmptyState({ message: 'No wager data' });

export function getActiveChartTab() {
  const tab = document.querySelector('[data-chart-tab].ds-active');
  return tab?.dataset.chartTab || activeChartTab;
}

export function setActiveChartTab(name) {
  activeChartTab = name;
}

const CHART_MOUNTS = {
  traffic: { wrapId: 'trafficChartWrap', canvasId: 'trafficChart', plotSize: 'lg' },
  latency: { wrapId: 'latencyChartWrap', canvasId: 'latencyChart', plotSize: 'lg' },
  type: { wrapId: 'typeChartWrap', canvasId: 'typeChart', plotSize: 'md' },
  agent: { wrapId: 'agentChartWrap', canvasId: 'agentChart', plotSize: 'md' },
};

const LATENCY_EMPTY_HTML = renderEmptyState({
  icon: '&#9201;',
  message: 'No ingestion run latency data yet.',
  hint: 'Trigger an ingestion run to populate metrics.',
});

function chartLoadErrorMessage(err) {
  return err?.message?.includes('CDN')
    ? 'Chart library failed to load. Check network or CDN availability.'
    : err?.message || 'Chart failed to load';
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
  const chartColors = getChartColors();

  try {
    const [agg, statusRes] = await Promise.all([
      ctx.api(`/chart-aggregates?hours=${CHART_HOURS}`),
      ctx.api('/endpoint-status').catch(() => ({ routeLatency: [] })),
    ]);
    const derived = chartDataFromAggregates(agg);
    analyticsData = { aggregates: agg, routeLatency: statusRes.routeLatency || [] };

    const hasWagers = derived.trafficLabels.length > 0
      || derived.typeValues.some((v) => v > 0);

    if (!hasWagers) {
      showChartMessage(CHART_MOUNTS.traffic.wrapId, EMPTY_WAGERS_HTML);
      showChartMessage(CHART_MOUNTS.type.wrapId, EMPTY_WAGERS_HTML);
      showChartMessage(CHART_MOUNTS.agent.wrapId, EMPTY_WAGERS_HTML);
      mountLineBarTable('trafficChartData', 'Traffic (24h)', [], [], 'Wagers');
      mountTypeTable('typeChartData', [], []);
      mountAgentTable('agentChartData', [], []);
      if (tab === 'latency') {
        await renderLatencyChart(ctx, analyticsData.routeLatency);
      } else {
        showChartMessage(CHART_MOUNTS.latency.wrapId, LATENCY_EMPTY_HTML);
      }
      return;
    }

    const trafficData = {
      labels: derived.trafficLabels,
      datasets: [{ label: 'Wagers', data: derived.trafficCounts, backgroundColor: chartColors.info }],
    };

    const typeData = {
      labels: derived.typeLabels,
      datasets: [{
        data: derived.typeValues,
        backgroundColor: [...getWagerTypeChartColors()],
      }],
    };

    const agentData = {
      labels: derived.agentLabels,
      datasets: [{ label: 'Volume', data: derived.agentVolumes, backgroundColor: chartColors.accent }],
    };

    mountLineBarTable('trafficChartData', 'Traffic (24h)', derived.trafficLabels, derived.trafficCounts, 'Wagers');
    mountTypeTable('typeChartData', derived.typeLabels, derived.typeValues);
    mountAgentTable('agentChartData', derived.agentLabels, derived.agentVolumes.map((v) => v * 100));

    const trafficMount = ensureChartMarkup(CHART_MOUNTS.traffic);
    const trafficChart = ensureChart('traffic', 'trafficChart', 'bar');
    showChartReady(trafficMount);
    if (tab === 'traffic') {
      if (trafficChart.hasChart) trafficChart.update(trafficData);
      else {
        trafficChart.data = trafficData;
        await trafficChart.render();
      }
    } else {
      trafficChart.data = trafficData;
    }

    const typeMount = ensureChartMarkup(CHART_MOUNTS.type);
    const typeChart = ensureChart('type', 'typeChart', 'doughnut');
    typeChart.data = typeData;

    const agentMount = ensureChartMarkup(CHART_MOUNTS.agent);
    const agentChart = ensureChart('agent', 'agentChart', 'bar');
    agentChart.data = agentData;

    if (tab === 'latency') {
      await renderLatencyChart(ctx, analyticsData.routeLatency);
    } else if (tab === 'distribution') {
      showChartReady(typeMount);
      if (typeChart.hasChart) typeChart.update(typeData);
      else {
        typeChart.data = typeData;
        await typeChart.render();
      }
      mountChartLegend('typeChartLegend', [
        { label: 'Straight', color: getWagerTypeChartColors()[0] },
        { label: 'Parlay', color: getWagerTypeChartColors()[1] },
        { label: 'Moneyline', color: getWagerTypeChartColors()[2] },
        { label: 'Live', color: getWagerTypeChartColors()[3] },
      ]);
      showChartReady(agentMount);
      if (agentChart.hasChart) agentChart.update(agentData);
      else {
        agentChart.data = agentData;
        await agentChart.render();
      }
    } else {
      typeChart.data = typeData;
      agentChart.data = agentData;
    }
  } catch (e) {
    const msg = chartLoadErrorMessage(e);
    showChartError(CHART_MOUNTS.traffic.wrapId, msg);
    showChartError(CHART_MOUNTS.latency.wrapId, msg);
    showChartError(CHART_MOUNTS.type.wrapId, msg);
    showChartError(CHART_MOUNTS.agent.wrapId, msg);
  }
}

export async function renderLatencyChart(ctx, routeLatency) {
  if (!routeLatency?.length) {
    showChartMessage(CHART_MOUNTS.latency.wrapId, LATENCY_EMPTY_HTML);
    return;
  }

  const chartColors = getChartColors();
  const labels = routeLatency.map((r) => r.path || r.endpoint_key);
  const values = routeLatency.map((r) => Number(r.avg_duration_ms) || 0);

  const latencyMount = ensureChartMarkup(CHART_MOUNTS.latency);
  const latencyChart = ensureChart('latency', 'latencyChart', 'line');
  showChartReady(latencyMount);
  const payload = {
    labels,
    datasets: [{
      label: 'Avg latency (ms)',
      data: values,
      borderColor: chartColors.warning,
      backgroundColor: chartFillColor(chartColors.warning),
      tension: 0.3,
      fill: true,
    }],
  };
  mountLatencyTable('latencyChartData', routeLatency);

  if (latencyChart.hasChart) latencyChart.update(payload);
  else {
    latencyChart.data = payload;
    await latencyChart.render();
  }
  announceChartStatus(`Latency chart loaded, ${labels.length} routes`);
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
      showChartReady(ensureChartMarkup(CHART_MOUNTS.type));
      typeChart.render();
      if (analyticsData?.aggregates) {
        mountChartLegend('typeChartLegend', [
          { label: 'Straight', color: getWagerTypeChartColors()[0] },
          { label: 'Parlay', color: getWagerTypeChartColors()[1] },
          { label: 'Moneyline', color: getWagerTypeChartColors()[2] },
          { label: 'Live', color: getWagerTypeChartColors()[3] },
        ]);
      }
    }
    if (agentChart) {
      showChartReady(ensureChartMarkup(CHART_MOUNTS.agent));
      agentChart.render();
    }
  }
}
