// dashboard/js/design-system.js
// Design tokens, UI primitives, and component factories.

import { escapeHtml } from './dom.js';
import {
  getChartColors,
  getWagerTypeChartColors,
  getZoneColor,
  getRefreshInterval,
  getZone,
  CHART_COLORS,
  WAGER_TYPE_CHART_COLORS,
} from './constants.js';

export {
  getZoneColor,
  getRefreshInterval,
  getZone as getZoneName,
  CHART_COLORS,
  WAGER_TYPE_CHART_COLORS,
  getChartColors,
  getWagerTypeChartColors,
};

/** Read a CSS custom property from :root (theme-aware). */
export function readDesignToken(name, fallback = '') {
  if (typeof document === 'undefined') return fallback;
  const key = name.startsWith('--') ? name : `--${name}`;
  const v = getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  return v || fallback;
}

/** Chart dataset fill using --chart-fill-alpha token. */
export function chartFillColor(color) {
  const alpha = parseFloat(readDesignToken('chart-fill-alpha', '0.12'));
  const hex = color.replace('#', '');
  if (hex.length === 6) {
    const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255)
      .toString(16)
      .padStart(2, '0');
    return `#${hex}${a}`;
  }
  return color;
}

const ZONE_BADGE_CLASS = {
  ingestion: 'ds-zone-badge--ingestion',
  query: 'ds-zone-badge--query',
  auth: 'ds-zone-badge--auth',
  do: 'ds-zone-badge--do',
  data: 'ds-zone-badge--data',
  network: 'ds-zone-badge--network',
  cookie: 'ds-zone-badge--cookie',
  worker: 'ds-zone-badge--worker',
  upstream: 'ds-zone-badge--upstream',
};

export function getZoneBadgeClass(zone) {
  return ZONE_BADGE_CLASS[zone] || ZONE_BADGE_CLASS.worker;
}

/**
 * Standard empty state markup (matches empty-state.css).
 * @param {{ icon?: string, message: string, hint?: string }} opts
 */
export function renderEmptyState({ icon = '', message, hint = '' }) {
  const iconHtml = icon ? `<div class="ds-empty-state__icon">${icon}</div>` : '';
  const hintHtml = hint ? `<div class="ds-empty-state__hint">${escapeHtml(hint)}</div>` : '';
  return `<div class="ds-empty-state">${iconHtml}<div class="ds-empty-state__message">${escapeHtml(message)}</div>${hintHtml}</div>`;
}

/**
 * Accessible HTML legend for charts (pairs with .ds-chart-legend CSS).
 * @param {{ label: string, color: string }[]} items
 */
export function renderChartLegend(items) {
  if (!items?.length) return '';
  const rows = items.map(
    (item) => [
      '<span class="ds-chart-legend__item" role="listitem">',
      `<span class="ds-chart-legend__swatch" style="background:${escapeHtml(item.color)}"></span>`,
      `<span>${escapeHtml(item.label)}</span>`,
      '</span>',
    ].join(''),
  );
  return `<div class="ds-chart-legend" role="list">${rows.join('')}</div>`;
}

export class ComponentFactory {
  static createCard(endpoint, title, dataFn, options = {}) {
    const zone = getZone(endpoint);
    const refreshMs = getRefreshInterval(endpoint);
    return { zone, endpoint, title, dataFn, refreshMs, ...options };
  }

  static createTable(endpoint, columns, dataFn, options = {}) {
    const zone = getZone(endpoint);
    const refreshMs = getRefreshInterval(endpoint);
    return {
      zone,
      endpoint,
      columns,
      dataFn,
      refreshMs,
      sortable: true,
      filterable: true,
      ...options,
    };
  }

  static createBadge(status) {
    const map = {
      ok: 'ds-badge--success',
      success: 'ds-badge--success',
      warn: 'ds-badge--warning',
      warning: 'ds-badge--warning',
      error: 'ds-badge--error',
      info: 'ds-badge--info',
    };
    return map[status] || 'ds-badge--info';
  }
}
