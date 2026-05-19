// dashboard/js/status-poller.js
// Periodically fetches /endpoint-status and emits structured health updates.
// Used by the sidebar to show per-zone health indicators.

import { DataStore } from './store.js';

const STATUS_INTERVAL = 30000;
const ENDPOINT_STATUS_KEY = 'endpoint-status';

export class StatusPoller {
  constructor(api, store, interval = STATUS_INTERVAL) {
    this._api = api;
    this._store = store || new DataStore();
    this._interval = interval;
    this._timer = null;
    this._onUpdate = null;
    this._status = {
      worker: 'unknown',
      latestRun: null,
      recentFailures: [],
      routeLatency: [],
      zones: {},
      timestamp: null,
    };
  }

  get status() {
    return { ...this._status };
  }

  set onUpdate(fn) {
    this._onUpdate = fn;
  }

  start() {
    this._poll();
    this._timer = setInterval(() => this._poll(), this._interval);
  }

  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
  }

  async _poll() {
    try {
      const data = await this._api('/endpoint-status');
      this._status.worker = data.worker || 'unknown';
      this._status.latestRun = data.latestRun || null;
      this._status.recentFailures = data.recentFailures || [];
      this._status.routeLatency = data.routeLatency || [];
      this._status.timestamp = data.timestamp || new Date().toISOString();
      this._status.zones = this._deriveZones(data);

      this._store.set(ENDPOINT_STATUS_KEY, { ...this._status }, this._interval * 1.5);
      this._onUpdate?.({ ...this._status });
    } catch (e) {
      console.warn('[StatusPoller] poll failed', e);
    }
  }

  _deriveZones(data) {
    const zones = {};

    // worker zone is always ok if we got a response
    zones['worker'] = { status: 'ok', endpoints: ['/', '/live-wagers'] };

    // from recent failures, mark affected zones
    const failedZones = new Set();
    if (data.recentFailures) {
      for (const f of data.recentFailures) {
        const zone = this._zoneForPath(f.path || f.endpoint_key);
        failedZones.add(zone);
      }
    }

    const allZones = ['ingestion', 'query', 'auth', 'do', 'network', 'cookie', 'data', 'upstream'];
    for (const zone of allZones) {
      zones[zone] = {
        status: failedZones.has(zone) ? 'degraded' : 'ok',
        failures: data.recentFailures?.filter(
          (f) => this._zoneForPath(f.path || f.endpoint_key) === zone,
        ) || [],
      };
    }

    return zones;
  }

  _zoneForPath(path) {
    if (!path) return 'worker';
    if (path.includes('/cloud/api/')) return 'upstream';
    if (path.startsWith('/ingest')) return 'ingestion';
    if (path.startsWith('/bet-ticker') || path.startsWith('/performance') ||
        path.startsWith('/graded') || path.startsWith('/prop') ||
        path.startsWith('/summary') || path.startsWith('/position') ||
        path.startsWith('/authorizations') || path.startsWith('/players'))
      return 'query';
    if (path.startsWith('/alert') || path.startsWith('/health') ||
        path.startsWith('/diagnostics') || path.startsWith('/runs') ||
        path.startsWith('/endpoint'))
      return 'auth';
    if (path.startsWith('/scan') || path.startsWith('/scanner'))
      return 'network';
    if (path.startsWith('/live-wagers') || path.startsWith('/broadcast'))
      return 'do';
    if (path.startsWith('/update-cookies'))
      return 'cookie';
    return 'worker';
  }
}
