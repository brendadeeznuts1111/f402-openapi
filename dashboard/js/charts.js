// Chart.js instance registry

import { ChartWrapper } from './chart-wrapper.js';

const instances = {
  volume: null,
  traffic: null,
  latency: null,
  type: null,
  agent: null,
};

export function getChart(name) {
  return instances[name];
}

export function setChart(name, chart) {
  instances[name] = chart;
}

export function ensureChart(name, canvasId, type) {
  const existing = instances[name];
  if (existing && existing.canvasId === canvasId && existing.type === type) {
    return existing;
  }
  if (existing) {
    existing.destroy();
  }
  instances[name] = new ChartWrapper(canvasId, type);
  return instances[name];
}

export function destroyAllCharts() {
  for (const key of Object.keys(instances)) {
    if (instances[key]) {
      instances[key].destroy();
      instances[key] = null;
    }
  }
}

export function resizeAllCharts() {
  for (const chart of Object.values(instances)) {
    if (!chart?.hasChart) continue;
    chart.resize();
  }
}

let plotResizeObserver = null;
let resizeDebounce = null;

/** Observe .ds-chart-plot size changes (sidebar collapse, flex layout). */
export function initChartPlotResizeObserver(onResize) {
  if (typeof ResizeObserver === 'undefined') return;
  if (plotResizeObserver) return;
  plotResizeObserver = new ResizeObserver(() => {
    if (resizeDebounce) clearTimeout(resizeDebounce);
    resizeDebounce = setTimeout(() => {
      resizeDebounce = null;
      onResize();
    }, 150);
  });
  document.querySelectorAll('.ds-chart-plot').forEach((plot) => {
    plotResizeObserver.observe(plot);
  });
}

export { ChartWrapper };
