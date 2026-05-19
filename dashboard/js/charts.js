// dashboard/js/charts.js — Chart.js instance registry

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
  if (!instances[name]) {
    instances[name] = new ChartWrapper(canvasId, type);
  }
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

export { ChartWrapper };
