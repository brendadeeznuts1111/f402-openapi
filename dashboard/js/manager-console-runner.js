// Generate DevTools console scripts for https://fantasy402.com/manager.html (same-origin fetch).

import { LIVE_SESSION_AUTH_EMBEDDED } from './live-session-auth.js';
import { validateIngestSpec, validateLocalIngestPayload } from './lib/ingest-spec-validate.js';

const FANTASY402_ORIGIN = 'https://fantasy402.com';
const MANAGER_URL = `${FANTASY402_ORIGIN}/manager.html`;

export function isFantasy402Origin() {
  try {
    return window.location.hostname === 'fantasy402.com' || window.location.hostname === 'www.fantasy402.com';
  } catch {
    return false;
  }
}

/** Shared runtime helpers embedded in generated console scripts. */
function embeddedRuntime(apiBase) {
  return `
  const API = ${JSON.stringify(apiBase)};
  const F402 = ${JSON.stringify(FANTASY402_ORIGIN)};

  async function api(path, init) {
    const res = await fetch(API + path, init);
    const text = await res.text();
    let body;
    try { body = JSON.parse(text); } catch { body = { raw: text.slice(0, 500) }; }
    if (!res.ok) throw new Error(path + ' HTTP ' + res.status + ': ' + (body.message || text.slice(0, 120)));
    return body;
  }

  ${LIVE_SESSION_AUTH_EMBEDDED}

  async function loadAuth() {
    const liveJwt = readLiveSessionJwt();
    if (liveJwt) {
      let auth = buildAuthFromLiveSession(liveJwt);
      const renewed = await renewLiveSessionToken(auth);
      auth = renewed.auth;
      await syncAuthToWorker(auth);
      console.log('[f402] live session auth (renewed:', renewed.renewed + ', ttl', jwtTtlSeconds(auth.authorization) + 's)');
      return auth;
    }
    const b = await api('/ingest/local/bootstrap');
    if (!b.authorization) {
      throw new Error('Not logged in on manager.html and no worker auth — log in to Fantasy402 or paste a fresh capture on the dashboard');
    }
    console.warn('[f402] no sessionStorage.credentials — using worker bootstrap (may be stale)');
    return {
      authorization: b.authorization,
      sessionCookie: b.sessionCookie || '',
      cfClearance: b.cfClearance || '',
      cfBm: b.cfBm || '',
      browserHeaders: b.browserHeaders || {},
      referer: b.referer || F402 + '/manager.html',
      userAgent: b.userAgent || navigator.userAgent,
    };
  }

  function cookieHeader(auth) {
    const parts = [];
    if (auth.sessionCookie) parts.push(auth.sessionCookie);
    for (const part of document.cookie.split(';')) {
      const t = part.trim();
      if (t.startsWith('cf_clearance=') || t.startsWith('__cf_bm=')) parts.push(t);
    }
    if (auth.cfClearance && !parts.some((p) => p.startsWith('cf_clearance='))) {
      parts.push(auth.cfClearance.includes('=') ? auth.cfClearance : 'cf_clearance=' + auth.cfClearance);
    }
    if (auth.cfBm && !parts.some((p) => p.startsWith('__cf_bm='))) {
      parts.push(auth.cfBm.includes('=') ? auth.cfBm : '__cf_bm=' + auth.cfBm);
    }
    return parts.filter(Boolean).join('; ');
  }

  function headers(auth, contentType) {
    const h = {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      Origin: F402,
      Referer: auth.referer,
      'User-Agent': auth.userAgent || navigator.userAgent,
      'X-Requested-With': 'XMLHttpRequest',
      'Content-Type': contentType,
      Cookie: cookieHeader(auth),
      ...(auth.browserHeaders || {}),
    };
    if (auth.authorization) {
      h.Authorization = auth.authorization.startsWith('Bearer ') ? auth.authorization : 'Bearer ' + auth.authorization;
    }
    h['Content-Type'] = contentType;
    return h;
  }

  async function fetchSpec(auth, spec) {
    const contentType = spec.contentType || 'application/x-www-form-urlencoded; charset=UTF-8';
    let body;
    if (contentType.includes('json')) body = JSON.stringify(spec.body);
    else body = new URLSearchParams(Object.entries(spec.body || {}).map(([k, v]) => [k, String(v)]));
    const res = await fetch(F402 + spec.path, { method: spec.method || 'POST', headers: headers(auth, contentType), body });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 4000) }; }
    if (!res.ok) throw new Error(spec.key + ' HTTP ' + res.status);
    return { endpointKey: spec.key, httpStatus: res.status, capturedAt: new Date().toISOString(), data };
  }

  function extractPlayerCustomerId(data) {
    if (!data || typeof data !== 'object') return null;
    const list = data.LIST;
    if (!Array.isArray(list) || !list.length) return null;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      for (const field of ['customerID', 'CustomerID']) {
        const v = item[field];
        if (typeof v === 'string' && v.trim() && v.trim() !== '__REDACTED__') return v.trim();
      }
    }
    return null;
  }

  async function ensureCustomerIdInPlan(plan) {
    let specs = plan.endpoints || [];
    if (!specs.some((s) => s.requiresCustomerIdResolution)) return { plan, specs, prefetched: [] };
    let gpSpec = specs.find((s) => s.key === 'getPlayers' && s.body);
    if (!gpSpec) {
      plan = await api('/ingest/local/plan');
      specs = plan.endpoints || [];
      gpSpec = specs.find((s) => s.key === 'getPlayers' && s.body);
    }
    if (!gpSpec) throw new Error('Plan missing getPlayers for customer ID resolution');
    const auth = await loadAuth();
    const gpResult = await fetchSpec(auth, gpSpec);
    await api('/ingest/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results: [gpResult], advanceCursor: false }),
    });
    plan = await api('/ingest/local/plan');
    specs = plan.endpoints || [];
    if (specs.some((s) => s.requiresCustomerIdResolution)) {
      throw new Error('Customer ID unresolved after getPlayers');
    }
    return { plan, specs, prefetched: [gpResult] };
  }

  async function catalogBatchLoops() {
    try {
      const s = await api('/ingest/catalog-status');
      if (!s.pendingCount) return 1;
      return Math.min(20, Math.ceil(s.pendingCount / (s.batchSize || 12)) + 1);
    } catch { return LOOPS; }
  }

  async function runOneBatch() {
    const auth = await loadAuth();
    let plan = await api('/ingest/local/plan');
    const prepared = await ensureCustomerIdInPlan(plan);
    plan = prepared.plan;
    const specs = prepared.specs;
    const skip = new Set(prepared.prefetched.map((r) => r.endpointKey));
    if (!specs.length) {
      await api('/ingestion/advance-cursor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      return prepared.prefetched.length;
    }
    const results = [...prepared.prefetched];
    for (const spec of specs) {
      if (skip.has(spec.key)) continue;
      try {
        results.push(await fetchSpec(auth, spec));
        console.log('[f402] OK', spec.key);
      } catch (e) {
        console.warn('[f402] skip', spec.key, e.message);
      }
    }
    if (!results.length) throw new Error('No endpoints fetched in batch');
    const upload = await api('/ingest/local', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ results, advanceCursor: true }),
    });
    console.log('[f402] uploaded', upload.endpointsSucceeded, 'cursor', upload.cursorAdvanced);
    return upload.endpointsSucceeded || results.length;
  }`;
}

/**
 * Self-bootstrapping auto-runner: reads live JWT from sessionStorage on manager.html,
 * renews via same-origin renewToken, syncs to worker each batch.
 * Paste once on manager.html while logged in — no dashboard capture needed.
 */
export function buildSelfBootstrappingAutoRunner(dashboardOrigin, options = {}) {
  const apiBase = `${dashboardOrigin.replace(/\/$/, '')}/api`;
  const intervalMs = Math.max(60_000, Number(options.intervalMs) || 300_000);
  const loops = Math.max(1, Math.min(20, Number(options.loops) || 1));

  return `(async () => {
  ${embeddedRuntime(apiBase)}
  const INTERVAL = ${intervalMs};
  const LOOPS = ${loops};

  if (window.__F402_AUTO_RUNNER) {
    console.log('[f402] auto-runner already active');
    return { status: 'already-running' };
  }

  async function runBatch() {
    const dynamicLoops = await catalogBatchLoops();
    let total = 0;
    for (let i = 0; i < dynamicLoops; i++) total += await runOneBatch();
    return total;
  }

  const first = await runBatch();
  console.log('[f402] initial batch:', first, 'endpoints');
  window.__F402_AUTO_RUNNER = setInterval(async () => {
    try {
      const n = await runBatch();
      console.log('[f402] scheduled batch:', n);
    } catch (e) {
      console.warn('[f402] scheduled batch failed:', e.message);
    }
  }, INTERVAL);
  sessionStorage.setItem('f402-auto-runner', String(Date.now()));
  console.log('[f402] auto-runner active every', INTERVAL, 'ms (dynamic catalog backfill loops)');
  return { status: 'ok', first };
})();`;
}

/**
 * Legacy one-shot / multi-loop script with embedded auth snapshot.
 */
export function buildManagerConsoleScript(dashboardOrigin, authPayload, options = {}) {
  if (options.autoRun && !options.embedAuth) {
    return buildSelfBootstrappingAutoRunner(dashboardOrigin, options);
  }

  if (Array.isArray(options.endpointSpecs)) {
    options.endpointSpecs.forEach((spec, i) => validateIngestSpec(spec, i));
  }

  const apiBase = `${dashboardOrigin.replace(/\/$/, '')}/api`;
  const loops = Math.max(1, Math.min(20, Number(options.loops) || 1));
  const autoRun = options.autoRun === true;
  const intervalMs = Math.max(60_000, Number(options.intervalMs) || 300_000);
  const auth = {
    authorization: authPayload?.authorization || '',
    sessionCookie: authPayload?.sessionCookie || '',
    cfClearance: authPayload?.cfClearance || '',
    cfBm: authPayload?.cfBm || '',
    browserHeaders: authPayload?.browserHeaders || {},
    referer: authPayload?.referer || `${FANTASY402_ORIGIN}/manager.html`,
    userAgent: authPayload?.userAgent || '',
  };

  return `(async () => {
  ${embeddedRuntime(apiBase)}
  let AUTH = ${JSON.stringify(auth)};
  const LOOPS = ${loops};

  async function runBatch() {
    let batchOk = 0;
    for (let loop = 0; loop < LOOPS; loop++) {
      const plan = await api('/ingest/local/plan');
      const specs = plan.endpoints || [];
      if (!specs.length) {
        await api('/ingestion/advance-cursor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        continue;
      }
      const results = [];
      for (const spec of specs) {
        try {
          results.push(await fetchSpec(AUTH, spec));
          console.log('[f402] OK', spec.key);
        } catch (e) {
          console.warn('[f402] skip', spec.key, e.message);
        }
      }
      if (!results.length) throw new Error('No endpoints fetched in batch');
      const upload = await api('/ingest/local', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ results, advanceCursor: true }),
      });
      batchOk += upload.endpointsSucceeded || results.length;
    }
    return batchOk;
  }

  const totalOk = await runBatch();
  console.log('[f402] done', totalOk, 'endpoints');
  ${autoRun ? `
  if (!window.__F402_AUTO_RUNNER) {
    window.__F402_AUTO_RUNNER = setInterval(async () => {
      try { AUTH = await loadAuth(); } catch (e) { console.warn('[f402] auth refresh', e.message); }
      try { console.log('[f402] auto batch', await runBatch()); } catch (e) { console.warn('[f402]', e.message); }
    }, ${intervalMs});
    sessionStorage.setItem('f402-auto-runner', String(Date.now()));
    console.log('[f402] auto-runner active every ${intervalMs}ms');
  }` : ''}
  return { status: 'ok', totalOk };
})();`;
}

export function getManagerInstallUrl() {
  return MANAGER_URL;
}

export async function copySelfBootstrappingAutoRunner(dashboardOrigin, options = {}) {
  const script = buildSelfBootstrappingAutoRunner(dashboardOrigin, options);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(script);
    return script;
  }
  throw new Error('Clipboard unavailable');
}

export async function copyManagerAutoRunnerScript(dashboardOrigin, _authPayload, options = {}) {
  return copySelfBootstrappingAutoRunner(dashboardOrigin, {
    ...options,
    loops: 1,
  });
}

export async function copyManagerConsoleScript(dashboardOrigin, authPayload, options = {}) {
  const script = buildManagerConsoleScript(dashboardOrigin, authPayload, options);
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(script);
    return script;
  }
  throw new Error('Clipboard unavailable');
}

/** Open manager.html and copy self-bootstrapping auto-runner. */
export async function installManagerAutoRunner(dashboardOrigin, options = {}) {
  await copySelfBootstrappingAutoRunner(dashboardOrigin, options);
  if (!sessionStorage.getItem('f402-manager-tab-opened')) {
    window.open(MANAGER_URL, '_blank', 'noopener');
    sessionStorage.setItem('f402-manager-tab-opened', '1');
  }
}
