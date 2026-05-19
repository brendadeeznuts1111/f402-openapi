// dashboard/js/design-system.js
// Factory functions and helpers that use constants.js

import {
  ZONE_COLORS,
  ENDPOINT_ZONE_MAP,
  REFRESH_INTERVALS,
  getZoneColor,
  getRefreshInterval,
  getZone,
} from './constants.js';

export { getZoneColor, getRefreshInterval, getZone as getZoneName };

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
      ok: 'badge--ok',
      warn: 'badge--warn',
      error: 'badge--error',
      info: 'badge--info',
    };
    return map[status] || 'badge--neutral';
  }
}
