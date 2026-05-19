/**
 * Live Fantasy402 session auth from manager.html (sessionStorage + same-origin renewToken).
 * Avoids stale worker bootstrap / expired pasted captures.
 */

import { debugLog } from './debug-log.js';

const FANTASY402_ORIGIN = 'https://fantasy402.com';
const RENEW_THRESHOLD_SECONDS = 300;

export function jwtTtlSeconds(authorization) {
  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return 3600;
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return 3600;
    return Math.max(60, Math.min(28800, payload.exp - Math.floor(Date.now() / 1000)));
  } catch {
    return 3600;
  }
}

export function jwtExpiryStatus(authorization) {
  const ttl = jwtTtlSeconds(authorization);
  const token = String(authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!token.includes('.')) return 'unknown';
  return ttl > 0 ? 'valid' : 'expired';
}

export function readLiveSessionJwt() {
  try {
    const raw = sessionStorage.getItem('credentials');
    if (raw) {
      const cred = JSON.parse(raw);
      if (cred?.code) return String(cred.code).trim();
    }
  } catch {
    /* ignore */
  }
  return '';
}

export function readLiveCustomerId() {
  try {
    return sessionStorage.getItem('customerID')?.trim() || '';
  } catch {
    return '';
  }
}

export function cookiePairFromDocument(name) {
  const prefix = `${name}=`;
  for (const part of document.cookie.split(';')) {
    const t = part.trim();
    if (t.startsWith(prefix)) return t;
  }
  return '';
}

export function buildAuthFromLiveSession(jwt) {
  const authorization = jwt.startsWith('Bearer ') ? jwt : `Bearer ${jwt}`;
  return {
    authorization,
    sessionCookie: '',
    cfClearance: cookiePairFromDocument('cf_clearance'),
    cfBm: cookiePairFromDocument('__cf_bm'),
    browserHeaders: {},
    referer: `${FANTASY402_ORIGIN}/manager.html`,
    userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    customerId: readLiveCustomerId(),
  };
}

export function extractBearerTokenFromResponse(data) {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.code === 'string' && data.code.split('.').length === 3) return data.code;
  for (const value of Object.values(data)) {
    if (typeof value === 'string' && value.split('.').length === 3) return value;
    if (value && typeof value === 'object') {
      const nested = extractBearerTokenFromResponse(value);
      if (nested) return nested;
    }
  }
  return '';
}

function fantasy402Headers(auth, contentType) {
  const cookieParts = [];
  if (auth.cfClearance) cookieParts.push(auth.cfClearance.includes('=') ? auth.cfClearance : `cf_clearance=${auth.cfClearance}`);
  if (auth.cfBm) cookieParts.push(auth.cfBm.includes('=') ? auth.cfBm : `__cf_bm=${auth.cfBm}`);
  for (const part of document.cookie.split(';')) {
    const t = part.trim();
    if (t.startsWith('cf_clearance=') || t.startsWith('__cf_bm=')) {
      if (!cookieParts.some((p) => p.startsWith(t.split('=')[0] + '='))) cookieParts.push(t);
    }
  }
  return {
    Accept: '*/*',
    'Accept-Language': 'en-US,en;q=0.9',
    Origin: FANTASY402_ORIGIN,
    Referer: auth.referer || `${FANTASY402_ORIGIN}/manager.html`,
    'User-Agent': auth.userAgent || navigator.userAgent,
    'X-Requested-With': 'XMLHttpRequest',
    'Content-Type': contentType,
    Cookie: cookieParts.filter(Boolean).join('; '),
    Authorization: auth.authorization.startsWith('Bearer ') ? auth.authorization : `Bearer ${auth.authorization}`,
  };
}

export function updateLiveSessionJwt(jwt) {
  try {
    const raw = sessionStorage.getItem('credentials');
    if (!raw) return false;
    const cred = JSON.parse(raw);
    cred.code = jwt.replace(/^Bearer\s+/i, '').trim();
    sessionStorage.setItem('credentials', JSON.stringify(cred));
    return true;
  } catch {
    return false;
  }
}

/** Same-origin renewToken — mirrors Fantasy402 frontend ~5 min refresh. */
export async function renewLiveSessionToken(auth) {
  const ttl = jwtTtlSeconds(auth.authorization);
  if (ttl > RENEW_THRESHOLD_SECONDS) {
    return { auth, renewed: false, ttlSeconds: ttl };
  }

  const res = await fetch(`${FANTASY402_ORIGIN}/cloud/api/System/renewToken`, {
    method: 'POST',
    headers: fantasy402Headers(auth, 'application/x-www-form-urlencoded; charset=UTF-8'),
    body: new URLSearchParams(),
  });
  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { raw: text.slice(0, 500) };
  }

  if (!res.ok) {
    debugLog('live-session-auth.js:renewLiveSessionToken', 'renew failed', { status: res.status }, 'H2');
    return { auth, renewed: false, ttlSeconds: ttl, error: `renewToken HTTP ${res.status}` };
  }

  const newJwt = extractBearerTokenFromResponse(data);
  if (!newJwt) {
    debugLog('live-session-auth.js:renewLiveSessionToken', 'no token in response', {}, 'H2');
    return { auth, renewed: false, ttlSeconds: ttl, error: 'renewToken returned no JWT' };
  }

  updateLiveSessionJwt(newJwt);
  const next = buildAuthFromLiveSession(newJwt);
  debugLog('live-session-auth.js:renewLiveSessionToken', 'renewed', { ttlSeconds: jwtTtlSeconds(next.authorization) }, 'H2');
  return { auth: next, renewed: true, ttlSeconds: jwtTtlSeconds(next.authorization) };
}

export function toRefreshAuthPayload(auth) {
  const payload = {
    authorization: auth.authorization,
    userAgent: auth.userAgent,
    referer: auth.referer,
    expiresInSeconds: jwtTtlSeconds(auth.authorization),
  };
  if (auth.cfClearance) {
    payload.cfClearance = auth.cfClearance.includes('=')
      ? auth.cfClearance.split('=').slice(1).join('=')
      : auth.cfClearance;
  }
  if (auth.cfBm) {
    payload.cfBm = auth.cfBm.includes('=') ? auth.cfBm.split('=').slice(1).join('=') : auth.cfBm;
  }
  if (auth.customerId) payload.customerId = auth.customerId;
  if (auth.browserHeaders && Object.keys(auth.browserHeaders).length) {
    payload.browserHeaders = auth.browserHeaders;
  }
  return payload;
}

/** Read live manager session when available; null if not logged in on fantasy402.com. */
export function readLiveSessionAuth() {
  const jwt = readLiveSessionJwt();
  if (!jwt) return null;
  return buildAuthFromLiveSession(jwt);
}

/**
 * Self-contained JS snippet for manager.html console scripts (no ES imports).
 * Injected into manager-console-runner embeddedRuntime.
 */
export const LIVE_SESSION_AUTH_EMBEDDED = `
  function jwtTtlSeconds(authorization) {
    const token = String(authorization || '').replace(/^Bearer\\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length < 2) return 3600;
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      if (!payload.exp) return 3600;
      return Math.max(60, Math.min(28800, payload.exp - Math.floor(Date.now() / 1000)));
    } catch { return 3600; }
  }

  function readLiveSessionJwt() {
    try {
      const raw = sessionStorage.getItem('credentials');
      if (raw) {
        const cred = JSON.parse(raw);
        if (cred && cred.code) return String(cred.code).trim();
      }
    } catch {}
    return '';
  }

  function readLiveCustomerId() {
    try { return (sessionStorage.getItem('customerID') || '').trim(); } catch { return ''; }
  }

  function cookiePairFromDocument(name) {
    const prefix = name + '=';
    for (const part of document.cookie.split(';')) {
      const t = part.trim();
      if (t.startsWith(prefix)) return t;
    }
    return '';
  }

  function buildAuthFromLiveSession(jwt) {
    const authorization = jwt.startsWith('Bearer ') ? jwt : 'Bearer ' + jwt;
    return {
      authorization,
      sessionCookie: '',
      cfClearance: cookiePairFromDocument('cf_clearance'),
      cfBm: cookiePairFromDocument('__cf_bm'),
      browserHeaders: {},
      referer: F402 + '/manager.html',
      userAgent: navigator.userAgent,
      customerId: readLiveCustomerId(),
    };
  }

  function extractBearerTokenFromResponse(data) {
    if (!data || typeof data !== 'object') return '';
    if (typeof data.code === 'string' && data.code.split('.').length === 3) return data.code;
    for (const value of Object.values(data)) {
      if (typeof value === 'string' && value.split('.').length === 3) return value;
      if (value && typeof value === 'object') {
        const nested = extractBearerTokenFromResponse(value);
        if (nested) return nested;
      }
    }
    return '';
  }

  function updateLiveSessionJwt(jwt) {
    try {
      const raw = sessionStorage.getItem('credentials');
      if (!raw) return false;
      const cred = JSON.parse(raw);
      cred.code = jwt.replace(/^Bearer\\s+/i, '').trim();
      sessionStorage.setItem('credentials', JSON.stringify(cred));
      return true;
    } catch { return false; }
  }

  async function renewLiveSessionToken(auth) {
    const ttl = jwtTtlSeconds(auth.authorization);
    if (ttl > 300) return { auth, renewed: false };
    const res = await fetch(F402 + '/cloud/api/System/renewToken', {
      method: 'POST',
      headers: headers(auth, 'application/x-www-form-urlencoded; charset=UTF-8'),
      body: new URLSearchParams(),
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = {}; }
    if (!res.ok) {
      console.warn('[f402] renewToken failed', res.status);
      return { auth, renewed: false };
    }
    const newJwt = extractBearerTokenFromResponse(data);
    if (!newJwt) return { auth, renewed: false };
    updateLiveSessionJwt(newJwt);
    console.log('[f402] JWT renewed via sessionStorage (ttl', jwtTtlSeconds('Bearer ' + newJwt), 's)');
    return { auth: buildAuthFromLiveSession(newJwt), renewed: true };
  }

  function toRefreshAuthPayload(auth) {
    const payload = {
      authorization: auth.authorization,
      userAgent: auth.userAgent,
      referer: auth.referer,
      expiresInSeconds: jwtTtlSeconds(auth.authorization),
    };
    if (auth.cfClearance) {
      payload.cfClearance = auth.cfClearance.includes('=') ? auth.cfClearance.split('=').slice(1).join('=') : auth.cfClearance;
    }
    if (auth.cfBm) {
      payload.cfBm = auth.cfBm.includes('=') ? auth.cfBm.split('=').slice(1).join('=') : auth.cfBm;
    }
    if (auth.customerId) payload.customerId = auth.customerId;
    return payload;
  }

  async function syncAuthToWorker(auth) {
    await api('/refresh-auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(toRefreshAuthPayload(auth)),
    });
  }
`;
