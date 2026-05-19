// Parse DevTools fetch()/curl captures into /refresh-auth payloads.

const BROWSER_HEADER_NAMES = [
  'accept',
  'accept-language',
  'origin',
  'priority',
  'referer',
  'sec-ch-ua',
  'sec-ch-ua-mobile',
  'sec-ch-ua-platform',
  'sec-fetch-dest',
  'sec-fetch-mode',
  'sec-fetch-site',
  'user-agent',
  'x-requested-with',
];

function unescapeJsString(value) {
  return value
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, '\\');
}

function parseObjectStringField(text, field) {
  const match = text.match(new RegExp(`["']${field}["']\\s*:\\s*(["'])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1\\s*,?`, 'm'));
  return match ? unescapeJsString(match[2]).trim() : '';
}

function parseBrowserFetch(text) {
  const match = text.match(/fetch\(\s*(["'`])([\s\S]*?)\1\s*,\s*\{/m);
  if (!match) return null;

  const snippet = text.slice(match.index ?? 0);
  const headers = {};
  const headersBlock = snippet.match(/["']headers["']\s*:\s*\{([\s\S]*?)\}\s*,/m)?.[1] ?? '';
  try {
    const parsedHeaders = JSON.parse(`{${headersBlock}}`);
    if (parsedHeaders && typeof parsedHeaders === 'object' && !Array.isArray(parsedHeaders)) {
      for (const [name, value] of Object.entries(parsedHeaders)) {
        if (typeof value === 'string') headers[name.toLowerCase()] = value.trim();
      }
    }
  } catch {
    for (const headerMatch of headersBlock.matchAll(/["']([^"']+)["']\s*:\s*(["'])((?:\\.|(?!\2)[\s\S])*?)\2\s*,?/gm)) {
      headers[headerMatch[1].toLowerCase()] = unescapeJsString(headerMatch[3]).trim();
    }
  }

  let url = null;
  try {
    url = new URL(unescapeJsString(match[2]));
  } catch {
    url = null;
  }

  return {
    headers,
    body: parseObjectStringField(snippet, 'body'),
    referer: parseObjectStringField(snippet, 'referrer') || headers.referer || '',
    url,
  };
}

function parseCookies(cookieHeader) {
  const out = {};
  for (const part of (cookieHeader || '').split(';')) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return out;
}

function cookieWithoutCloudflare(cookies) {
  const names = Object.keys(cookies).filter((n) => n !== 'cf_clearance' && n !== '__cf_bm');
  if (!names.length) return '';
  return names.map((n) => `${n}=${cookies[n]}`).join('; ');
}

function isCloudflareChallengePath(pathname) {
  return /cdn-cgi|challenge-platform|__cf_chl/i.test(pathname || '');
}

/**
 * @param {string} text DevTools fetch() snippet or curl with headers
 * @returns {Record<string, unknown>}
 */
export function parseBrowserCapture(text) {
  const raw = (text || '').trim();
  if (!raw) {
    throw new Error('Paste a fetch() snippet from DevTools (Network → Copy → Copy as fetch)');
  }

  const fetchSnippet = parseBrowserFetch(raw);
  if (!fetchSnippet) {
    throw new Error('Could not parse fetch() snippet. Copy as fetch from a successful /cloud/api/* request.');
  }

  const headers = { ...fetchSnippet.headers };
  const cookie = headers.cookie || '';
  const cookies = parseCookies(cookie);
  const browserHeaders = {};
  for (const name of BROWSER_HEADER_NAMES) {
    if (headers[name]) browserHeaders[name] = headers[name];
  }
  if (fetchSnippet.referer && !browserHeaders.referer) {
    browserHeaders.referer = fetchSnippet.referer;
  }

  const payload = {
    sourcePath: fetchSnippet.url?.pathname || '',
    authorization: headers.authorization || '',
    sessionCookie: cookieWithoutCloudflare(cookies),
    cfClearance: cookies.cf_clearance || '',
    cfBm: cookies.__cf_bm || '',
    browserHeaders,
    referer: fetchSnippet.referer || headers.referer || '',
    userAgent: headers['user-agent'] || '',
    expiresInSeconds: 3600,
  };

  if (cookie && !payload.sessionCookie) {
    payload.cookieHeader = cookie;
  }

  validateBrowserCapture(payload);
  return toRefreshAuthPayload(payload);
}

function validateBrowserCapture(payload) {
  const findings = [];
  if (isCloudflareChallengePath(payload.sourcePath)) {
    findings.push('capture looks like a Cloudflare challenge, not an API call');
  }
  if (!payload.sourcePath?.includes('/cloud/api/')) {
    findings.push('copy a successful Fantasy402 /cloud/api/* request');
  }
  if (!payload.authorization) {
    findings.push('missing Authorization header');
  }
  if (!payload.cfClearance || !payload.cfBm) {
    findings.push('missing cf_clearance or __cf_bm cookies');
  }
  const expiry = jwtExpiryStatus(payload.authorization);
  if (expiry === 'expired') {
    findings.push('authorization JWT is expired');
  }
  if (findings.length) {
    throw new Error(findings.join('; '));
  }
}

function jwtExpiryStatus(authorization) {
  const token = (authorization || '').replace(/^Bearer\s+/i, '').trim();
  const parts = token.split('.');
  if (parts.length < 2) return 'unknown';
  try {
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    if (!payload.exp) return 'unknown';
    return payload.exp * 1000 > Date.now() ? 'valid' : 'expired';
  } catch {
    return 'unknown';
  }
}

export function toRefreshAuthPayload(payload) {
  const out = {};
  for (const key of [
    'authorization',
    'sessionCookie',
    'cfClearance',
    'cfBm',
    'browserHeaders',
    'userAgent',
    'referer',
    'customerId',
    'expiresInSeconds',
    'cookieHeader',
  ]) {
    if (payload[key] !== undefined && payload[key] !== '') {
      out[key] = payload[key];
    }
  }
  return out;
}
