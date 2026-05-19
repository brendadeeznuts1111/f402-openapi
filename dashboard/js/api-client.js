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
  '/weekly-figures': {
    records: [{
      agent_id: 'BILLY666',
      week: 20,
      type: 'lite',
      wager_count: 321,
      volume: 1250000,
      net_amount: -21968,
      captured_at: new Date().toISOString(),
    }],
  },
  '/search-customers': {
    total: 2,
    records: [
      { customer_id: 'C001', login: 'ABC506', name_first: 'Andruw J', agent_id: 'BILLY666', captured_at: new Date().toISOString() },
      { customer_id: 'C002', login: 'BM28241', name_first: 'Player One', agent_id: 'TOPDAWG', captured_at: new Date().toISOString() },
    ],
  },
  '/customer-profile': {
    customerId: 'C001',
    player: { customer_id: 'C001', login: 'ABC506', name_first: 'Andruw J', agent_id: 'BILLY666' },
    account: { snapshotId: 'snap-1', capturedAt: new Date().toISOString(), data: { balance: 5000 } },
    facets: { getInfoPlayer: { INFO: { customerID: 'C001', status: 'active' } } },
    live: {
      status: 'ok',
      agent_id: 'BILLY666',
      getInfoPlayer: {
        ok: true,
        data: { Login: 'ABC506', CurrentBalance: 500000, PendingWagerCount: 2, Active: 'Y' },
        balance: { AvailableBalance: 450000 },
      },
      getPerformancePlayer: {
        ok: true,
        rows: [{ SportType: 'Football', Win: 3, Loss: 1, Net: 20000 }],
        total: 1,
      },
      getReportPlayerAnalysis: {
        ok: true,
        rows: [
          {
            posted_at: '2026-05-06 00:18:05.250',
            sport: 'NBA',
            description: 'Basketball #564 Spurs -9½ -105',
            risk: 15750,
            to_win: 15000,
            win_lose: 15000,
            wager_status: 'W',
          },
        ],
        total: 1,
        summary: { wins: 1, losses: 0, pushes: 0 },
      },
      analysis_filters: { start_date: '2026-05-05', end_date: '2026-05-19', report_type: 2, line_type: 2 },
      fetched_at: new Date().toISOString(),
    },
    sources: {
      blocks: [
        { id: 'player', label: 'Player identity', activeSource: 'seeded', ingestKey: 'getPlayers', schedule: 'Worker */15 cron', seeded: { capturedAt: new Date().toISOString(), snapshotId: null }, live: null },
        { id: 'getInfoPlayer', label: 'Account & balance (info)', activeSource: 'live', ingestKey: 'getInfoPlayer', schedule: 'Live on profile load', dashboardRefreshMs: 30000, seeded: null, live: { ok: true, fetchedAt: new Date().toISOString() } },
        { id: 'getPerformancePlayer', label: 'Performance by sport', activeSource: 'live', ingestKey: 'getPerformancePlayer', schedule: 'Live on profile load', dashboardRefreshMs: 30000, seeded: null, live: { ok: true, fetchedAt: new Date().toISOString() } },
        { id: 'getReportPlayerAnalysis', label: 'Wager analysis', activeSource: 'live', ingestKey: 'getReportPlayerAnalysis', schedule: 'Live on profile load', dashboardRefreshMs: 30000, seeded: null, live: { ok: true, fetchedAt: new Date().toISOString() } },
      ],
      schedules: {
        workerIngestion: 'Disabled on worker (skip) — browser ingest',
        authRefresh: 'Worker */5 cron',
        alertEvaluation: 'Worker */2 cron',
        urlScan: 'Worker every 6 hours',
        dashboardProfile: '30s while Customers profile open',
        dailyProfileWarmup: 'Worker 06:00 UTC daily',
      },
      facetKeys: ['getInfoPlayer', 'getCryptoInfo', 'getMail', 'getTeaserProfile'],
    },
    webLogs: { lastCapturedAt: new Date().toISOString(), count24h: 2 },
    recentWebLogs: [
      { operation: 'login', ip_address: '1.2.3.4', access_date_time: new Date().toISOString() },
    ],
  },
  '/customer-profile/seed': {
    status: 'ok',
    snapshotId: 'seed-mock',
    facets: [
      { facet: 'getInfoPlayer', ok: true },
      { facet: 'getCryptoInfo', ok: true },
      { facet: 'getMail', ok: true },
      { facet: 'getTeaserProfile', ok: true },
    ],
  },
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
  '/agent-performance-live': {
    status: 'ok',
    source: 'live',
    type: 'CP',
    type_label: 'Customer Performance',
    cached: false,
    fetched_at: new Date().toISOString(),
    total: 2,
    rows: [
      {
        customer_id: 'C001',
        login: 'ABC506 (pw:test)',
        agent_id: 'BILLY666',
        wager_count: 12,
        volume: 50000,
        net: 1200.5,
      },
      {
        customer_id: 'C002',
        login: 'BM28241',
        agent_id: 'BILLY666',
        wager_count: 8,
        volume: 32000,
        net: -450,
      },
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
  '/transactions-live': {
    status: 'ok',
    type: 'player',
    type_label: 'Player Transactions',
    source: 'mock',
    rows: [
      {
        posted_at: '2026-05-19 14:22:00.000',
        login: 'HT5031',
        customer_id: 'HT5031',
        description: 'Deposit',
        transaction_type: 'D',
        amount: 25000,
        balance: 125000,
        reference: 'REF-1001',
      },
      {
        posted_at: '2026-05-19 11:05:00.000',
        login: 'SLA101',
        customer_id: 'SLA101',
        description: 'Withdrawal',
        transaction_type: 'W',
        amount: -10000,
        balance: 90000,
        reference: 'REF-1002',
      },
    ],
    cached: false,
    fetched_at: new Date().toISOString(),
  },
  '/pending-wagers': {
    status: 'ok',
    source: 'mock',
    total: 2,
    wagers: [
      {
        ticket_number: 1011970361,
        login: 'HT5031',
        agent_login: 'HT',
        wager_type: 'P',
        wager_status: 'O',
        amount_wagered: 25000,
        to_win_amount: 50802,
        description: 'Baseball #913 Dodgers -170 - For 1st 5 Innings',
        accepted_at: '2026-05-19 12:51:08.333',
        sport_type: 'Baseball',
        game_date_time: '2026-05-19 21:40:00.000',
      },
      {
        ticket_number: 1011950560,
        login: 'SLA101',
        agent_login: 'ALSLAMMA',
        wager_type: 'P',
        wager_status: 'O',
        amount_wagered: 20000,
        to_win_amount: 410629,
        description: 'Baseball parlay — 5 picks',
        accepted_at: '2026-05-19 10:07:48.173',
        sport_type: 'Baseball',
        game_date_time: '2026-05-19 19:05:00.000',
      },
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
