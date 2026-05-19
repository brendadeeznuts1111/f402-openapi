// Ensures chart plot + frame + canvas exist (handles legacy HTML without full markup).

import { renderErrorState } from './ui.js';
import { renderChartLegend } from './design-system.js';

export { renderChartLegend };

/**
 * @param {{ wrapId: string, canvasId: string, plotSize?: 'sm'|'md'|'lg' }} opts
 */
export function ensureChartMarkup({ wrapId, canvasId, plotSize = 'lg' }) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return null;

  const container = wrap.closest('.ds-chart-container') || wrap.parentElement;
  let plot = wrap.closest('.ds-chart-plot');

  if (!plot && container) {
    plot = document.createElement('div');
    plot.className = `ds-chart-plot ds-chart-plot--${plotSize}`;
    container.appendChild(plot);
    plot.appendChild(wrap);
  }

  if (!plot) return null;

  let frame = plot.querySelector(':scope > .ds-chart-plot__frame');
  if (!frame) {
    frame = document.createElement('div');
    frame.className = 'ds-chart-plot__frame';
    plot.appendChild(frame);
  }

  let canvas = document.getElementById(canvasId);
  if (!canvas) {
    canvas = document.createElement('canvas');
    canvas.id = canvasId;
    canvas.className = 'ds-chart-canvas';
    canvas.style.display = 'none';
    frame.appendChild(canvas);
  } else if (!frame.contains(canvas)) {
    frame.appendChild(canvas);
  }

  return { wrap, plot, frame, canvas, container };
}

export function showChartReady(mount) {
  if (!mount) return;
  if (mount.wrap) mount.wrap.style.display = 'none';
  if (mount.frame) mount.frame.style.display = 'block';
  if (mount.canvas) mount.canvas.style.display = 'block';
}

export function showChartMessage(wrapId, html) {
  const wrap = document.getElementById(wrapId);
  if (!wrap) return;
  const plot = wrap.closest('.ds-chart-plot');
  const frame = plot?.querySelector(':scope > .ds-chart-plot__frame');
  const canvas = plot?.querySelector('canvas.ds-chart-canvas');
  if (frame) frame.style.display = 'none';
  if (canvas) canvas.style.display = 'none';
  wrap.style.display = 'flex';
  wrap.innerHTML = html;
}

export function showChartError(wrapId, message, endpoint = '') {
  showChartMessage(wrapId, renderErrorState(message, endpoint));
}

/** Mount HTML legend below a chart container (e.g. #typeChartLegend). */
export function mountChartLegend(legendId, items) {
  const el = document.getElementById(legendId);
  if (!el) return;
  if (!items?.length) {
    el.innerHTML = '';
    el.setAttribute('aria-hidden', 'true');
    return;
  }
  el.innerHTML = renderChartLegend(items);
  el.setAttribute('aria-hidden', 'false');
}

/** Announce chart state to screen readers. */
export function announceChartStatus(message) {
  const el = document.getElementById('chartLiveStatus');
  if (!el) return;
  el.textContent = '';
  requestAnimationFrame(() => {
    el.textContent = message;
  });
}
