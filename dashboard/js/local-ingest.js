// Browser-side local ingestion: fetch fantasy402.com from the user's session, upload to Worker.

import { debugLog } from './debug-log.js';
import { ensureCustomerIdInPlan } from './customer-id-resolve.js';

const FANTASY402_ORIGIN = 'https://fantasy402.com';

export class LocalIngestBlockedError extends Error {
  constructor(message, cause) {
    super(message);
    this.name = 'LocalIngestBlockedError';
    this.cause = cause;
  }
}

function buildCookieHeader(authPayload) {
  const parts = [];
  if (authPayload.sessionCookie) parts.push(authPayload.sessionCookie);
  if (authPayload.cfClearance) {
    parts.push(authPayload.cfClearance.includes('=') ? authPayload.cfClearance : `cf_clearance=${authPayload.cfClearance}`);
  }
  if (authPayload.cfBm) {
    parts.push(authPayload.cfBm.includes('=') ? authPayload.cfBm : `__cf_bm=${authPayload.cfBm}`);
  }
  return parts.filter(Boolean).join('; ');
}

function upstreamHeaders(authPayload, contentType) {
  const browserHeaders = authPayload.browserHeaders || {};
  const headers = {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: FANTASY402_ORIGIN,
    Referer: authPayload.referer || `${FANTASY402_ORIGIN}/manager.html`,
    'User-Agent': authPayload.userAgent || browserHeaders['user-agent'] || navigator.userAgent,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': contentType,
    Cookie: buildCookieHeader(authPayload),
    ...browserHeaders,
  };
  if (authPayload.authorization) {
    headers.Authorization = authPayload.authorization.startsWith('Bearer ')
      ? authPayload.authorization
      : `Bearer ${authPayload.authorization}`;
  }
  headers['Content-Type'] = contentType;
  return headers;
}

function encodeBody(spec) {
  if (spec.contentType?.includes('json')) {
    return { body: JSON.stringify(spec.body), contentType: spec.contentType };
  }
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(spec.body || {})) {
    form.set(key, String(value));
  }
  return {
    body: form,
    contentType: spec.contentType || 'application/x-www-form-urlencoded; charset=UTF-8',
  };
}

async function fetchEndpointSpec(authPayload, spec) {
  const encoded = encodeBody(spec);
  const response = await fetch(new URL(spec.path, FANTASY402_ORIGIN), {
    method: spec.method || 'POST',
    headers: upstreamHeaders(authPayload, encoded.contentType),
    body: encoded.body,
    credentials: 'omit',
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 4000) };
  }
  if (!response.ok) {
    const err = new Error(`${spec.key} returned HTTP ${response.status}`);
    err.httpStatus = response.status;
    err.endpointKey = spec.key;
    throw err;
  }
  return {
    endpointKey: spec.key,
    httpStatus: response.status,
    capturedAt: new Date().toISOString(),
    data,
  };
}

function isCorsBlock(error) {
  return error instanceof TypeError && /fetch|network|cors/i.test(error.message);
}

/**
 * @param {object} ctx dashboard context
 * @param {object} authPayload refresh-auth shaped payload (authorization, cfClearance, cfBm, browserHeaders, referer)
 * @param {{ onProgress?: (msg: string) => void, advanceCursor?: boolean }} options
 */
export async function runLocalBrowserIngest(ctx, authPayload, options = {}) {
  let plan = await ctx.api('/ingest/local/plan');
  let prepared = await ensureCustomerIdInPlan(ctx, authPayload, plan, fetchEndpointSpec);
  plan = prepared.plan;
  const specs = prepared.specs;
  const prefetchKeys = new Set(prepared.prefetchResults.map((r) => r.endpointKey));
  // #region agent log
  debugLog('local-ingest.js:runLocalBrowserIngest', 'plan loaded', {
    specCount: specs.length,
    cursor: plan?.batch?.cursor,
    prefetched: [...prefetchKeys],
    hostname: typeof window !== 'undefined' ? window.location.hostname : '',
  }, 'H2');
  // #endregion
  if (!specs.length) {
    if (plan?.unsupported?.length && options.advanceCursor !== false) {
      await ctx.apiPost('/ingestion/advance-cursor', {});
    }
    return {
      status: 'skipped',
      message: 'No fetchable endpoints in current batch',
      plan: plan?.batch,
      unsupported: plan?.unsupported || [],
    };
  }

  const results = [...prepared.prefetchResults];
  const failures = [];
  for (const spec of specs) {
    if (prefetchKeys.has(spec.key)) continue;
    options.onProgress?.(`Fetching ${spec.key}…`);
    try {
      results.push(await fetchEndpointSpec(authPayload, spec));
    } catch (error) {
      if (isCorsBlock(error)) {
        // #region agent log
        debugLog('local-ingest.js:fetchEndpointSpec', 'CORS block on fetch', {
          key: spec.key,
          errorMessage: error.message,
        }, 'H2');
        // #endregion
        throw new LocalIngestBlockedError(
          'Browser blocked cross-origin fetch to fantasy402.com. Use **Console script** on manager.html or `npm run ingest:local-batch` from your machine.',
          error,
        );
      }
      failures.push({ key: spec.key, message: error.message, httpStatus: error.httpStatus });
    }
  }

  if (!results.length) {
    return {
      status: 'failed',
      message: failures.length ? failures.map((f) => `${f.key}: ${f.message}`).join('; ') : 'No endpoints fetched',
      failures,
      plan: plan?.batch,
    };
  }

  options.onProgress?.(`Uploading ${results.length} snapshot(s)…`);
  const upload = await ctx.apiPost(
    '/ingest/local',
    { results, advanceCursor: options.advanceCursor !== false && results.length > 0 },
    { acceptStatuses: [202, 500] },
  );

  const outcome = {
    status: upload?.status === 'success' ? 'ok' : 'partial',
    plan: plan?.batch,
    fetched: results.map((r) => r.endpointKey),
    failures,
    upload,
    cursorAdvanced: upload?.cursorAdvanced ?? null,
  };
  // #region agent log
  debugLog('local-ingest.js:runLocalBrowserIngest', 'upload complete', {
    status: outcome.status,
    fetchedCount: outcome.fetched.length,
    failureCount: failures.length,
    cursorAdvanced: outcome.cursorAdvanced,
  }, 'H2');
  // #endregion
  return outcome;
}

/**
 * Run multiple local ingest batches sequentially.
 * @param {object} ctx
 * @param {object} authPayload
 * @param {{ loops?: number | 'all' }} options
 */
export async function runLocalIngestLoops(ctx, authPayload, options = {}) {
  const firstPlan = await ctx.api('/ingest/local/plan');
  const catalogSize = firstPlan?.batch?.catalogSize || 86;
  const batchSize = firstPlan?.batch?.batchSize || 12;
  const loops = options.loops === 'all'
    ? Math.ceil(catalogSize / batchSize)
    : Math.max(1, Math.min(20, Number(options.loops) || 1));

  let totalOk = 0;
  const batches = [];
  for (let i = 0; i < loops; i += 1) {
    options.onProgress?.(`Batch ${i + 1}/${loops}…`);
    const result = await runLocalBrowserIngest(ctx, authPayload, {
      advanceCursor: true,
      onProgress: options.onProgress,
    });
    batches.push(result);
    totalOk += result.upload?.endpointsSucceeded ?? result.fetched?.length ?? 0;
    if (result.status === 'failed') break;
    if (result.status === 'skipped') continue;
  }
  return { status: 'ok', loops, totalOk, batches };
}
