/**
 * Shared Fantasy402 upstream URL, headers, and request bodies (mirrors Worker fantasy402ApiHeaders).
 */

export const DEFAULT_FANTASY_BASE_URL = "https://fantasy402.com";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36";

const DEFAULT_SEC_CH_UA = '"Chromium";v="148", "Google Chrome";v="148", "Not/A)Brand";v="99"';

/** Endpoints that require Master agent context in form body or session. */
export const MASTER_AGENT_ENDPOINTS = new Set([
  "getListAgenstByAgent",
  "primaryAgents",
  "primaryAgentsGetAgents",
]);

/** Per-key body fields beyond CommonAgentRequest (aligned with Worker ENDPOINTS.buildBody). */
export const ENDPOINT_BODY_EXTRAS = {
  getListAgenstByAgent: { agentType: "M", omitDateRange: true },
  getMessage: { acc: true, type: 0, omitDateRange: true },
  getNewEmailsCount: { acc: true, omitDateRange: true },
  getWeeklyFigureByAgentLite: { week: 0, type: "A", layout: "byDay", omitDateRange: true },
  getWeeklyFigureByAgent: { week: 0, type: "O", layout: "byDay", bigAmount: 500, omitDateRange: true },
  getBetTicker: { wagerNumber: 1, omitDateRange: true },
  getBetTickerConfig: { omitDateRange: true },
  getAgentPositionData: { omitDateRange: true },
  getAgentPositionList: { omitDateRange: true },
  getPropWagers: { omitDateRange: true },
  getGraded: { omitDateRange: true },
  getSubSportByReport: { omitDateRange: true },
  getAgentPermissionSetting: { omitDateRange: true },
  getTransactionList: { omitDateRange: true },
  reportGetScoresLiveDynamic: { contentType: "json", omitDateRange: true },
  getAccountInfoOwner: { accountOwnerOnly: true, omitDateRange: true },
  getWebLog: { omitDateRange: false },
  getPending: {
    contentType: "json",
    omitDateRange: true,
    path: "/qubic/api/Manager/getPending",
    sort: "1",
    typeSort: "2",
    customerID: "0",
  },
};

export function resolveFantasyBaseUrl(planBaseUrl) {
  const raw =
    planBaseUrl?.trim() ||
    process.env.FANTASY402_BASE_URL?.trim() ||
    process.env.FANTASY_BASE_URL?.trim() ||
    DEFAULT_FANTASY_BASE_URL;
  return raw.replace(/\/$/, "");
}

export function managerReferer(baseUrl, version = Date.now()) {
  return `${baseUrl}/manager.html?v=${version}`;
}

export function defaultBrowserHeaders(baseUrl, userAgent = DEFAULT_USER_AGENT) {
  return {
    accept: "*/*",
    "accept-language": "en-US,en;q=0.9",
    origin: baseUrl,
    priority: "u=1, i",
    referer: managerReferer(baseUrl),
    "sec-ch-ua": DEFAULT_SEC_CH_UA,
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"macOS"',
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    "sec-fetch-site": "same-origin",
    "user-agent": userAgent,
    "x-requested-with": "XMLHttpRequest",
  };
}

export function normalizeBrowserHeaders(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonicalHeaderName(name) {
  if (name === "sec-ch-ua") return "Sec-CH-UA";
  if (name === "sec-ch-ua-mobile") return "Sec-CH-UA-Mobile";
  if (name === "sec-ch-ua-platform") return "Sec-CH-UA-Platform";
  return name
    .split("-")
    .map((part) => (part ? `${part[0].toUpperCase()}${part.slice(1)}` : part))
    .join("-");
}

function canonicalizeBrowserHeaders(headers) {
  const allowed = new Set([
    "accept",
    "accept-language",
    "origin",
    "priority",
    "referer",
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "user-agent",
    "x-requested-with",
  ]);
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!allowed.has(normalized) || typeof value !== "string" || !value.trim()) continue;
    out[canonicalHeaderName(normalized)] = value.trim();
  }
  return out;
}

export function buildUpstreamHeaders(authPayload, contentType, options = {}) {
  const baseUrl = resolveFantasyBaseUrl(options.baseUrl);
  const userAgent = authPayload.userAgent || DEFAULT_USER_AGENT;
  const defaults = defaultBrowserHeaders(baseUrl, userAgent);
  const observed = canonicalizeBrowserHeaders(
    normalizeBrowserHeaders(authPayload.browserHeadersJson ?? authPayload.browserHeaders),
  );

  const headers = {
    Accept: defaults.accept,
    "Accept-Language": defaults["accept-language"],
    Origin: baseUrl,
    Referer: authPayload.referer || observed.Referer || defaults.referer,
    "User-Agent": observed["User-Agent"] || userAgent,
    Priority: observed.Priority || defaults.priority,
    "Sec-CH-UA": observed["Sec-CH-UA"] || defaults["sec-ch-ua"],
    "Sec-CH-UA-Mobile": observed["Sec-CH-UA-Mobile"] || defaults["sec-ch-ua-mobile"],
    "Sec-CH-UA-Platform": observed["Sec-CH-UA-Platform"] || defaults["sec-ch-ua-platform"],
    "Sec-Fetch-Dest": observed["Sec-Fetch-Dest"] || defaults["sec-fetch-dest"],
    "Sec-Fetch-Mode": observed["Sec-Fetch-Mode"] || defaults["sec-fetch-mode"],
    "Sec-Fetch-Site": observed["Sec-Fetch-Site"] || defaults["sec-fetch-site"],
    "X-Requested-With": observed["X-Requested-With"] || defaults["x-requested-with"],
    "Content-Type": contentType,
    Cookie: cookieHeader(authPayload),
  };

  const authorization = normalizeAuthorization(authPayload.authorization);
  if (authorization) headers.Authorization = authorization;
  return headers;
}

export function normalizePlanBody(body, endpointKey, { agentId, customerId, now = new Date() }) {
  const extras = ENDPOINT_BODY_EXTRAS[endpointKey] ?? {};
  const date = now.toISOString().slice(0, 10);
  const normalized = { ...(body && typeof body === "object" ? body : {}) };

  if (!normalized.operation && endpointKey) normalized.operation = endpointKey;
  if (normalized.RRO == null) normalized.RRO = 1;
  if (!normalized.agentID && agentId) normalized.agentID = agentId;
  if (!normalized.agentOwner && agentId) normalized.agentOwner = agentId;

  if (MASTER_AGENT_ENDPOINTS.has(endpointKey) || extras.agentType === "M") {
    normalized.agentType = "M";
  }

  if (extras.acc && agentId && !normalized.acc) normalized.acc = agentId;
  if (extras.type != null && normalized.type == null) normalized.type = extras.type;
  if (extras.week != null && normalized.week == null) normalized.week = extras.week;
  if (extras.layout && !normalized.layout) normalized.layout = extras.layout;
  if (extras.bigAmount != null && normalized.bigAmount == null) normalized.bigAmount = extras.bigAmount;
  if (extras.wagerNumber != null && normalized.wagerNumber == null) normalized.wagerNumber = extras.wagerNumber;
  if (extras.path && !normalized.path) normalized.path = extras.path;
  if (extras.sort != null && normalized.sort == null) normalized.sort = extras.sort;
  if (extras.typeSort != null && normalized.typeSort == null) normalized.typeSort = extras.typeSort;
  if (extras.customerID != null && normalized.customerID == null) normalized.customerID = extras.customerID;

  const omitDateRange = extras.omitDateRange === true;
  if (!omitDateRange && extras.omitDateRange !== true) {
    for (const key of ["startDate", "endDate", "start", "end"]) {
      if (normalized[key] == null || normalized[key] === "") normalized[key] = date;
    }
  }

  if (customerId && bodyRequiresCustomerId(endpointKey) && !normalized.customerID) {
    normalized.customerID = customerId;
  }

  return normalized;
}

function bodyRequiresCustomerId(endpointKey) {
  return ["getInfoPlayer", "getCryptoInfo", "getMail", "getTeaserProfile", "getPending", "getCommunicationMessages"].includes(
    endpointKey,
  );
}

export function encodeUpstreamBody(body, contentType) {
  if (contentType?.includes("json")) {
    return { body: JSON.stringify(body), contentType: "application/json" };
  }
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) {
    if (value == null) continue;
    form.set(key, String(value));
  }
  return { body: form, contentType: "application/x-www-form-urlencoded; charset=UTF-8" };
}

export function logUpstreamRequest(label, url, body, headers) {
  if (process.env.F402_UPSTREAM_LOG !== "1" && process.env.F402_UPSTREAM_LOG !== "true") return;
  const keys = Object.keys(body ?? {}).sort();
  const redactedHeaders = { ...headers };
  if (redactedHeaders.Authorization) redactedHeaders.Authorization = "Bearer [REDACTED]";
  if (redactedHeaders.Cookie) redactedHeaders.Cookie = `[${String(redactedHeaders.Cookie).split(";").length} cookies]`;
  console.error(
    JSON.stringify(
      {
        event: "fantasy402-upstream",
        label,
        url: String(url),
        bodyKeys: keys,
        operation: body?.operation,
        agentType: body?.agentType,
        headers: redactedHeaders,
      },
      null,
      2,
    ),
  );
}

function cookieHeader(payload) {
  const cookies = splitCookieHeader(payload.sessionCookie || "");
  appendCookieIfMissing(cookies, "cf_clearance", payload.cfClearance);
  appendCookieIfMissing(cookies, "__cf_bm", payload.cfBm);
  return cookies.join("; ");
}

function splitCookieHeader(value) {
  return String(value)
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean);
}

function appendCookieIfMissing(cookies, name, value) {
  const clean = normalizeCookieValue(name, value);
  if (!clean) return;
  if (cookies.some((cookie) => cookieName(cookie)?.toLowerCase() === name.toLowerCase())) return;
  cookies.push(clean);
}

function cookieName(cookie) {
  const index = String(cookie).indexOf("=");
  return index > 0 ? String(cookie).slice(0, index).trim() : null;
}

function normalizeCookieValue(name, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.includes("=") ? trimmed : `${name}=${trimmed}`;
}

function normalizeAuthorization(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}
