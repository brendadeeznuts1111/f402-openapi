// dashboard/js/api-client.js
// Fetch wrapper with deduplication, TTL cache, and structured errors.

import { getRefreshInterval } from './constants.js';

const BASE = '/api';
const inFlight = new Map();
const responseCache = new Map();
let globalErrorHandler = null;
let missingTokenAlertShown = false;

export const API_ERROR_MISSING_TOKEN = 'MISSING_PAGES_TOKEN';
export const API_ERROR_UNAUTHORIZED = 'PROXY_UNAUTHORIZED';

export class ApiError extends Error {
  constructor(message, { status, code, path, method } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.path = path;
    this.method = method;
  }
}

export function isMissingTokenError(err) {
  if (!err) return false;
  if (err.code === API_ERROR_MISSING_TOKEN) return true;
  return /missing token/i.test(String(err.message || ''));
}

export function isUnauthorizedProxyError(err) {
  if (!err) return false;
  if (err.code === API_ERROR_UNAUTHORIZED) return true;
  return err.status === 401 && /unauthorized/i.test(String(err.message || ''));
}

export function setGlobalErrorHandler(fn) {
  globalErrorHandler = fn;
}

export function resetMissingTokenAlert() {
  missingTokenAlertShown = false;
}

function ttlFor(path) {
  const interval = getRefreshInterval(path);
  return interval === 'realtime' ? 2000 : Math.max(interval * 0.8, 2000);
}

async function parseErrorResponse(res, meta) {
  let message = `HTTP ${res.status}`;
  let code;
  let hint;
  const text = await res.text();
  try {
    const body = JSON.parse(text);
    if (body.message) message = body.message;
    if (body.code) code = body.code;
    if (body.hint) hint = body.hint;
  } catch {
    if (text) message = text.slice(0, 200);
  }
  const err = new ApiError(message, { status: res.status, code, path: meta.path, method: meta.method });
  if (hint) err.hint = hint;
  return err;
}

async function doFetch(url, options, meta = {}) {
  const res = await fetch(url, options);
  const acceptStatuses = meta.acceptStatuses;
  if (!res.ok && !(Array.isArray(acceptStatuses) && acceptStatuses.includes(res.status))) {
    throw await parseErrorResponse(res, meta);
  }
  const ct = res.headers.get('Content-Type') || '';
  if (ct.includes('application/json') || ct.includes('+json')) {
    return res.json();
  }
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function notifyError(err, path, method, silent) {
  if (silent || !globalErrorHandler) return;
  if (isMissingTokenError(err) || isUnauthorizedProxyError(err)) {
    if (missingTokenAlertShown) return;
    missingTokenAlertShown = true;
    if (isUnauthorizedProxyError(err)) err.code = err.code || API_ERROR_UNAUTHORIZED;
    globalErrorHandler(err, path);
    return;
  }
  globalErrorHandler(err, path, method);
}

export async function api(path, options = {}) {
  const { silent = false, acceptStatuses, ...fetchOptions } = options;
  const url = `${BASE}${path}`;
  const method = fetchOptions.method || 'GET';
  const cacheKey = `${method}:${path}`;
  const dedupeKey = cacheKey + (fetchOptions.body || '');
  const isRead = method === 'GET';
  const now = Date.now();

  if (inFlight.has(dedupeKey)) {
    return inFlight.get(dedupeKey);
  }

  if (isRead && responseCache.has(cacheKey)) {
    const cached = responseCache.get(cacheKey);
    if (now - cached.ts < cached.ttl) {
      return Promise.resolve(cached.data);
    }
  }

  const promise = doFetch(url, fetchOptions, { path, method, acceptStatuses })
    .then((data) => {
      if (isRead) {
        responseCache.set(cacheKey, { data, ts: now, ttl: ttlFor(path) });
      } else {
        responseCache.delete(cacheKey);
        responseCache.delete(`GET:${path}`);
      }
      return data;
    })
    .catch((err) => {
      notifyError(err, path, method, silent);
      throw err;
    })
    .finally(() => {
      inFlight.delete(dedupeKey);
    });

  inFlight.set(dedupeKey, promise);
  return promise;
}

/**
 * Probe Pages proxy: health (public) then summary (needs token).
 * @returns {'ok'|'missing_token'|'unauthorized'|'unreachable'}
 */
export async function probeApiProxy() {
  const health = await checkApiHealth();
  if (!health.ok) {
    if (health.status === 500) {
      try {
        const res = await fetch(`${BASE}/health`);
        const body = await res.json();
        if (body.code === API_ERROR_MISSING_TOKEN) return 'missing_token';
      } catch { /* ignore */ }
    }
    return 'unreachable';
  }
  try {
    bustCache('/summary');
    await api('/summary', { silent: true });
    return 'ok';
  } catch (err) {
    if (isMissingTokenError(err)) return 'missing_token';
    if (isUnauthorizedProxyError(err)) return 'unauthorized';
    return 'unreachable';
  }
}

/** Public proxy route — works even when INGESTION_TRIGGER_TOKEN is unset. */
export async function checkApiHealth() {
  try {
    const res = await fetch(`${BASE}/health`, { headers: { Accept: 'application/json' } });
    if (!res.ok) {
      return { ok: false, status: res.status, worker: null };
    }
    const data = await res.json();
    return { ok: true, status: res.status, worker: data };
  } catch (err) {
    return { ok: false, status: 0, worker: null, error: err.message };
  }
}

export function bustCache(path) {
  responseCache.delete(`GET:${path}`);
}

export function bustAllCache() {
  responseCache.clear();
}

export async function apiPost(path, body = {}, options = {}) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
    ...options,
  });
}

export async function apiPatch(path, body, options = {}) {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...options.headers },
    body: JSON.stringify(body),
    ...options,
  });
}

export async function apiDelete(path, options = {}) {
  return api(path, { method: 'DELETE', ...options });
}

// ── Mock Mode (local dev) ──────────────────────────────────────

let mockMode = false;
export function enableMockMode() { mockMode = true; }
export function disableMockMode() { mockMode = false; }

function isLocalDevHost() {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h.endsWith('.localhost');
}

if (typeof window !== 'undefined' && isLocalDevHost()) {
  const originalFetch = window.fetch;
  window.fetch = async function interceptedFetch(url, options) {
    if (mockMode && typeof url === 'string' && url.includes('/api/')) {
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 100));
      const pathname = new URL(url, location.origin).pathname.replace(/^\/api/, '') || '/';
      const mock = MOCK_RESPONSES[pathname.split('?')[0]];
      if (mock) {
        return new Response(JSON.stringify(mock), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return originalFetch.call(this, url, options);
  };
}

const MOCK_RESPONSES = {
  '/summary': {
    liveWagers: { total: 1078, volume: 747000, agents: 140, types: 4 },
    gradedWagers: { total: 45, pnl: 12500 },
    topAgents: [{ agent_id: 'BILLY666' }],
    topSports: [{ sport_name: 'NFL', volume: 250000 }],
  },
  '/performance': {
    records: [
      { agent_id: 'BILLY666', total_wagers: 342, total_volume: 450000, win_rate: 58.3 },
      { agent_id: 'TOPDAWG', total_wagers: 211, total_volume: 320000, win_rate: 52.1 },
    ],
  },
  '/chart-aggregates': {
    hours: 24,
    since: new Date(Date.now() - 86400000).toISOString(),
    hourly: [
      { hour: new Date().toISOString().slice(0, 13) + ':00', count: 12, volume_cents: 450000 },
    ],
    byType: { S: 8, P: 2, M: 1, L: 1 },
    topAgents: [{ agent_id: 'BILLY666', count: 10, volume_cents: 300000 }],
  },
  '/upstream-endpoints': {
    count: 86,
    configuredCount: 2,
    implementedCount: 86,
    spec: '../../.o11y/fantasy402-redacted-deep/api-spec-secured/openapi.secured.examples.json',
    routes: [
      { key: 'getBetTicker', path: '/cloud/api/Manager/getBetTicker', method: 'POST', zone: 'upstream', configured: true, implemented: true, contentType: 'application/x-www-form-urlencoded', operationId: 'post_cloud_api_Manager_getBetTicker', description: 'post_cloud_api_Manager_getBetTicker', refreshMs: 'ingestion' },
      { key: 'getAgentPerformance', path: '/cloud/api/Manager/getAgentPerformance', method: 'POST', zone: 'upstream', configured: true, implemented: true, contentType: 'application/x-www-form-urlencoded', operationId: 'post_cloud_api_Manager_getAgentPerformance', description: 'post_cloud_api_Manager_getAgentPerformance', refreshMs: 'ingestion' },
    ],
  },
  '/bet-ticker-wagers': {
    wagers: [
      {
        id: 'mock-1',
        login: 'player1',
        wager_type: 'S',
        amount_wagered: 10000,
        captured_at: new Date().toISOString(),
      },
    ],
  },
  '/graded-wagers': {
    wagers: [
      { wager_number: 'W123', login: 'player1', amount_wagered: 10000, net_amount: 5000, result: 'W', grade_date_time: new Date().toISOString() },
    ],
  },
  '/authorizations': {
    records: [
      { agent_id: 'BILLY666', master_agent_id: 'MASTER', commission_type: 'Standard' },
    ],
  },
  '/endpoint-status': {
    worker: 'ok',
    latestRun: null,
    recentFailures: [],
    routeLatency: [],
    timestamp: new Date().toISOString(),
  },
  '/health': {
    worker: 'ok',
    d1: 'ok',
    durable_object: 'ok',
    upstream: 'ok',
    timestamp: new Date().toISOString(),
  },
};
