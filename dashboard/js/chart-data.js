// Map chart payloads and API aggregates to accessible data tables.

import { escapeHtml } from './dom.js';
import { usd, fmt } from './format.js';

function tableHtml(caption, headers, rows) {
  const head = headers.map((h) => `<th scope="col">${escapeHtml(h)}</th>`).join('');
  const body = rows.map((cells) => {
    const tds = cells.map((c, i) => {
      const text = escapeHtml(String(c));
      return i === 0 ? `<th scope="row">${text}</th>` : `<td>${text}</td>`;
    }).join('');
    return `<tr>${tds}</tr>`;
  }).join('');
  return [
    `<table class="ds-chart-data-table">`,
    `<caption>${escapeHtml(caption)}</caption>`,
    `<thead><tr>${head}</tr></thead>`,
    `<tbody>${body}</tbody>`,
    `</table>`,
  ].join('');
}

/** @param {string} mountId */
export function mountLineBarTable(mountId, caption, labels, values, valueLabel) {
  const el = document.getElementById(mountId);
  if (!el) return;
  if (!labels?.length) {
    el.innerHTML = '';
    return;
  }
  const rows = labels.map((label, i) => [label, values[i] ?? '']);
  el.innerHTML = tableHtml(caption, ['Period', valueLabel], rows);
}

export function mountTypeTable(mountId, labels, values) {
  const el = document.getElementById(mountId);
  if (!el) return;
  const rows = labels.map((label, i) => [label, fmt(values[i] ?? 0)]);
  el.innerHTML = tableHtml('Wager type distribution', ['Type', 'Count'], rows);
}

export function mountAgentTable(mountId, labels, valuesCents) {
  const el = document.getElementById(mountId);
  if (!el) return;
  const rows = labels.map((label, i) => [label, usd(valuesCents[i] ?? 0)]);
  el.innerHTML = tableHtml('Agent volume', ['Agent', 'Volume'], rows);
}

export function mountLatencyTable(mountId, routeLatency) {
  const el = document.getElementById(mountId);
  if (!el) return;
  if (!routeLatency?.length) {
    el.innerHTML = '';
    return;
  }
  const rows = routeLatency.map((r) => [
    r.path || r.endpoint_key || '?',
    `${Number(r.avg_duration_ms) || 0} ms`,
    `${Number(r.max_duration_ms) || 0} ms`,
  ]);
  el.innerHTML = tableHtml('Route latency', ['Route', 'Avg', 'Max'], rows);
}

/** Normalize GET /chart-aggregates for dashboard charts. */
export function chartDataFromAggregates(agg) {
  const hourly = agg?.hourly || [];
  const labels = hourly.map((h) => h.hour);
  return {
    volumeLabels: labels,
    volumeValues: hourly.map((h) => (Number(h.volume_cents) || 0) / 100),
    trafficLabels: labels,
    trafficCounts: hourly.map((h) => Number(h.count) || 0),
    typeLabels: ['Straight', 'Parlay', 'Moneyline', 'Live'],
    typeValues: [
      agg?.byType?.S ?? 0,
      agg?.byType?.P ?? 0,
      agg?.byType?.M ?? 0,
      agg?.byType?.L ?? 0,
    ],
    agentLabels: (agg?.topAgents || []).map((a) => a.agent_id),
    agentVolumes: (agg?.topAgents || []).map((a) => (Number(a.volume_cents) || 0) / 100),
  };
}
