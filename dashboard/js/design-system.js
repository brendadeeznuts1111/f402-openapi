// dashboard/js/design-system.js
// Factory functions and helpers that use constants.js

import {
  ZONE_COLORS,
  CHART_COLORS,
  WAGER_TYPE_CHART_COLORS,
  ENDPOINT_ZONE_MAP,
  REFRESH_INTERVALS,
  getZoneColor,
  getRefreshInterval,
  getZone,
} from './constants.js';

export {
  getZoneColor,
  getRefreshInterval,
  getZone as getZoneName,
  CHART_COLORS,
  WAGER_TYPE_CHART_COLORS,
};

// ── Component Descriptor Factory ─────────────────────────────────

export class ComponentFactory {
  static createCard(endpoint, title, dataFn, options = {}) {
    const zone = getZoneName(endpoint);
    const refreshMs = getRefreshInterval(endpoint);
    return {
      zone,
      endpoint,
      title,
      dataFn,
      refreshMs,
      ...options,
    };
  }

  static createTable(endpoint, columns, dataFn, options = {}) {
    const zone = getZoneName(endpoint);
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
