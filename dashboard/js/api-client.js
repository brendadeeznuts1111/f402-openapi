// dashboard/js/api-client.js
// Fetch wrapper with deduplication, TTL-based caching, mock support, and global error handler.

import { getRefreshInterval } from './constants.js';

const BASE = '/api';
const inFlight = new Map();
const responseCache = new Map();
let globalErrorHandler = null;

export function setGlobalErrorHandler(fn) {
  globalErrorHandler = fn;
}

function ttlFor(path) {
  const interval = getRefreshInterval(path);
  return interval === 'realtime' ? 2000 : Math.max(interval * 0.8, 2000);
}

async function doFetch(url, options) {
  const res = await fetch(url, options);
  if (!res.ok) {
    let message = `HTTP ${res.status}`;
    try {
      const body = await res.json();
      if (body.message) message = body.message;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}

export async function api(path, options = {}) {
  const url = `${BASE}${path}`;
  const method = options.method || 'GET';
  const cacheKey = `${method}:${path}`;
  const dedupeKey = cacheKey + (options.body || '');
  const isRead = method === 'GET';
  const now = Date.now();

  // Deduplicate in-flight requests (all methods)
  if (inFlight.has(dedupeKey)) {
    return inFlight.get(dedupeKey);
  }

  // Return cached response if still fresh (GET only)
  if (isRead && responseCache.has(cacheKey)) {
    const cached = responseCache.get(cacheKey);
    if (now - cached.ts < cached.ttl) {
      return Promise.resolve(cached.data);
    }
  }

  const promise = doFetch(url, options)
    .then((data) => {
      if (isRead) {
        responseCache.set(cacheKey, { data, ts: now, ttl: ttlFor(path) });
      } else {
        // Bust cache for this endpoint on mutation
        responseCache.delete(cacheKey);
      }
      return data;
    })
    .catch((err) => {
      if (globalErrorHandler) globalErrorHandler(err, path, method);
      throw err;
    })
    .finally(() => {
      inFlight.delete(dedupeKey);
    });

  inFlight.set(dedupeKey, promise);
  return promise;
}

export function bustCache(path) {
  const cacheKey = `GET:${path}`;
  responseCache.delete(cacheKey);
}

export function bustAllCache() {
  responseCache.clear();
}

export async function apiPost(path, body, options = {}) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...options,
  });
}

export async function apiPatch(path, body, options = {}) {
  return api(path, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    ...options,
  });
}

export async function apiDelete(path, options = {}) {
  return api(path, { method: 'DELETE', ...options });
}

// ── Mock Mode (dev only) ──────────────────────────────────────

let mockMode = false;
export function enableMockMode() { mockMode = true; }
export function disableMockMode() { mockMode = false; }

if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
  const originalFetch = window.fetch;
  window.fetch = async function interceptedFetch(url, options) {
    if (mockMode && typeof url === 'string' && url.includes('/api/')) {
      await new Promise((r) => setTimeout(r, 200 + Math.random() * 100));
      const pathname = new URL(url, location.origin).pathname.replace('/api', '');
      const mock = MOCK_RESPONSES[pathname];
      if (mock) {
        return new Response(JSON.stringify(mock), {
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
    return originalFetch.call(this, url, options);
  };
}

const MOCK_RESPONSES = {
  '/summary': {
    liveWagers: { total: 1078, volume: 747000, agents: 140 },
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
};
