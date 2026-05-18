import fs from "node:fs";
import { jwtExpiryDiagnostics } from "./browser-auth-utils.mjs";

const EXPECTED_BROWSER_HEADER_NAMES = [
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
];

const defaultOrigin = "https://fantasy402-ingestion.utahj4754.workers.dev";
const fantasyOrigin = new URL(process.env.FANTASY402_BASE_URL ?? "https://fantasy402.com");
const workerOrigin = new URL(process.env.WORKER_ORIGIN ?? defaultOrigin);
const operatorToken = process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN || readTokenFile();
const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? process.argv[2] ?? "fantasy402/browser-auth.json";
const endpointKeys = (process.env.FANTASY402_INGESTION_ENDPOINTS ?? "getAccountInfoOwner,getAuthorizations,getBetTicker,getAgentPositionData,getAgentPositionList")
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

const endpoints = {
  getAccountInfoOwner: { path: "/cloud/api/Manager/getAccountInfoOwner", operation: "getAccountInfoOwner", contentType: "json", accountOwnerOnly: true },
  getAuthorizations: { path: "/cloud/api/Manager/getAuthorizations", operation: "getAuthorizations", contentType: "form", omitDateRange: true },
  getConfigWebReports: { path: "/cloud/api/Manager/getConfigWebReports", operation: "getConfigWebReports", contentType: "form", omitDateRange: true },
  getConfigWebReportsPending: { path: "/cloud/api/Manager/getConfigWebReportsPending", operation: "getConfigWebReportsPending", contentType: "form", omitDateRange: true },
  getSportsType: { path: "/cloud/api/Manager/getSportsType", operation: "getSportsType", contentType: "form", omitDateRange: true },
  getMessage: { path: "/cloud/api/Manager/getMessage", operation: "getMessage", contentType: "form", omitDateRange: true, accountMessage: true },
  getNewEmailsCount: { path: "/cloud/api/Manager/getNewEmailsCount", operation: "getNewEmailsCount", contentType: "form", omitDateRange: true, accountMessage: true },
  getWeeklyFigureByAgentLite: { path: "/cloud/api/Manager/getWeeklyFigureByAgentLite", operation: "getWeeklyFigureByAgentLite", contentType: "form", omitDateRange: true, weeklyFigure: true },
  getAgentPerformance: { path: "/cloud/api/Manager/getAgentPerformance", operation: "getAgentPerformance", contentType: "form" },
  getAgentBilling: { path: "/cloud/api/Manager/getAgentBilling", operation: "getAgentBilling", contentType: "form" },
  getEnterTransactions: { path: "/cloud/api/Manager/getEnterTransactions", operation: "getEnterTransactions", contentType: "form" },
  getPlayers: { path: "/cloud/api/Manager/getPlayers", operation: "getPlayers", contentType: "form" },
  getAddedInfo: { path: "/cloud/api/Manager/getAddedInfo", operation: "getAddedInfo", contentType: "form" },
  getListAgenstByAgent: { path: "/cloud/api/Manager/getListAgenstByAgent", operation: "getListAgenstByAgent", contentType: "form", agentType: "M", omitDateRange: true },
  getLineTypes: { path: "/cloud/api/Manager/getLineTypes", operation: "getLineTypes", contentType: "form" },
  getHeriarchy: { path: "/cloud/api/Manager/getHeriarchy", operation: "getHeriarchy", contentType: "form" },
  getPending: { path: "/cloud/api/Manager/getPending", operation: "getPending", contentType: "json", requiresCustomerId: true },
  getBetTicker: { path: "/cloud/api/Manager/getBetTicker", operation: "getBetTicker", contentType: "form", omitDateRange: true },
  getBetTickerConfig: { path: "/cloud/api/Manager/getBetTickerConfig", operation: "getBetTickerConfig", contentType: "form", omitDateRange: true },
  getAgentPositionData: { path: "/cloud/api/Manager/getAgentPositionData", operation: "getAgentPositionData", contentType: "form", omitDateRange: true },
  getAgentPositionList: { path: "/cloud/api/Manager/getAgentPositionList", operation: "getAgentPositionList", contentType: "form", omitDateRange: true },
  getSubSportByReport: { path: "/cloud/api/Manager/getSubSportByReport", operation: "getSubSportByReport", contentType: "form", omitDateRange: true },
  getPropWagers: { path: "/cloud/api/Manager/getPropWagers", operation: "getPropWagers", contentType: "form", omitDateRange: true },
  getGraded: { path: "/cloud/api/Manager/getGraded", operation: "getGraded", contentType: "form", omitDateRange: true },
  getWagaerDetailShort: { path: "/cloud/api/Manager/getWagaerDetailShort", operation: "getWagaerDetailShort", contentType: "form", omitDateRange: true },
  getAgentPermissionSetting: { path: "/cloud/api/Manager/getAgentPermissionSetting", operation: "getAgentPermissionSetting", contentType: "form", omitDateRange: true },
  getTransactionHistory: { path: "/cloud/api/Manager/getTransactionHistory", operation: "getTransactionHistory", contentType: "form" },
  getTransactionList: { path: "/cloud/api/Manager/getTransactionList", operation: "getTransactionList", contentType: "form", omitDateRange: true },
  getGradedWagerByCustomer: { path: "/cloud/api/Report/getGradedWagerByCustomer", operation: "getGradedWagerByCustomer", contentType: "form", omitDateRange: true },
  getWagersByFigureDate: { path: "/cloud/api/Report/getWagersByFigureDate", operation: "getWagersByFigureDate", contentType: "form", omitDateRange: true },
  getWagerDetailTransaction: { path: "/cloud/api/Report/getWagerDetailTransaction", operation: "getWagerDetailTransaction", contentType: "form", omitDateRange: true },
  getPendingByTicket: { path: "/cloud/api/Report/getPendingByTicket", operation: "getPendingByTicket", contentType: "form", omitDateRange: true },
};
const endpointsByPath = new Map(Object.entries(endpoints).map(([key, endpoint]) => [endpoint.path, key]));

if (!operatorToken) {
  fail("Missing INGESTION_TRIGGER_TOKEN or ARCHIVE_AUTH_TOKEN. Set one as an environment variable or create .archive-auth-token.");
}
if (isPlaceholderToken(operatorToken)) {
  fail("INGESTION_TRIGGER_TOKEN/ARCHIVE_AUTH_TOKEN looks like a placeholder. Use the real operator bearer token or omit the env var so .archive-auth-token can be used.");
}

const authPayload = readAuthPayload(authFile);
validateBrowserAuthPayload(authPayload, authFile);
const authorizationExpiry = jwtExpiryDiagnostics(authPayload.authorization);
const browserHeaderShape = browserHeaderPresence(normalizeBrowserHeaders(authPayload.browserHeadersJson ?? authPayload.browserHeaders), authPayload);
const agentId = process.env.FANTASY402_AGENT_ID || authPayload.agentId || authPayload.customerId || "";
const customerId = process.env.FANTASY402_CUSTOMER_ID || authPayload.customerId || "";
if (!agentId) fail("Missing agent id. Set FANTASY402_AGENT_ID or add agentId to the browser auth JSON file.");

const startedAt = new Date();

const refresh = await callWorkerJson("/refresh-auth", {
  method: "POST",
  body: refreshPayload(authPayload),
  expectedStatuses: [200],
});

const fetched = [];
for (const key of endpointKeys) {
  const endpoint = endpoints[key];
  if (!endpoint) fail(`Unknown local ingestion endpoint: ${key}`);
  if (endpoint.requiresCustomerId && !customerId) fail(`${key} requires FANTASY402_CUSTOMER_ID or customerId in ${authFile}`);
  fetched.push(await fetchFantasy402Endpoint(key, endpoint));
}

const upload = await callWorkerJson("/ingest/local", {
  method: "POST",
  body: { capturedAt: startedAt.toISOString(), results: fetched },
  expectedStatuses: [202, 500],
});

const diagnostics = await callWorkerJson("/diagnostics", {
  method: "GET",
  expectedStatuses: [200],
});

const summary = {
  status: upload.httpStatus === 202 && upload.body?.status === "success" ? "ok" : "upload-failed",
  workerOrigin: workerOrigin.origin,
  fantasyOrigin: fantasyOrigin.origin,
  startedAt: startedAt.toISOString(),
  authRefresh: {
    accepted: refresh.body?.accepted ?? [],
    expiresAt: refresh.body?.expiresAt,
    ttlSeconds: refresh.body?.ttlSeconds,
  },
  authorizationExpiry,
  browserHeaderShape,
  localFetch: fetched.map((item) => ({
    endpointKey: item.endpointKey,
    httpStatus: item.httpStatus,
    itemCount: countItems(item.data),
  })),
  upload: sanitizeUpload(upload),
  diagnostics: {
    bindings: diagnostics.body?.bindings,
    auth: diagnostics.body?.auth,
    optionalSecrets: diagnostics.body?.optionalSecrets,
  },
};

console.log(JSON.stringify(summary, null, 2));
if (summary.status !== "ok") process.exitCode = 1;

async function fetchFantasy402Endpoint(endpointKey, endpoint) {
  const now = new Date();
  const body = requestBody(endpoint, now);
  const encoded = encodeBody(endpoint, body);
  const response = await fetch(new URL(endpoint.path, fantasyOrigin), {
    method: "POST",
    body: encoded.body,
    headers: upstreamHeaders(encoded.contentType),
    signal: AbortSignal.timeout(60_000),
  });
  const text = await response.text();
  const data = parseJson(text);
  if (!response.ok) {
    const report = writeUpstreamFailureReport({
      endpointKey,
      endpoint,
      response,
      responseText: text,
      responseData: data,
      requestBody: body,
      contentType: encoded.contentType,
    });
    fail(`${endpointKey} returned HTTP ${response.status}. Wrote sanitized diagnostics to ${report.path}. ${diagnosticHint(endpointKey, response.status, text)}`);
  }
  return {
    endpointKey,
    httpStatus: response.status,
    capturedAt: now.toISOString(),
    data,
  };
}

function writeUpstreamFailureReport({ endpointKey, endpoint, response, responseText, responseData, requestBody, contentType }) {
  const path = "fantasy402/last-failure.json";
  fs.mkdirSync("fantasy402", { recursive: true });
  const report = {
    failedAt: new Date().toISOString(),
    endpointKey,
    url: new URL(endpoint.path, fantasyOrigin).toString(),
    httpStatus: response.status,
    statusText: response.statusText,
    responseHeaders: safeHeaders(response.headers),
    responseBodyLength: responseText.length,
    responseBodySnippet: safeBodySnippet(responseText, responseData),
    request: {
      contentType,
      bodyKeys: Object.keys(requestBody).sort(),
      operation: requestBody.operation,
      hasAgentID: Boolean(requestBody.agentID),
      hasAgentOwner: Boolean(requestBody.agentOwner),
      hasRRO: String(requestBody.RRO) === "1",
      hasCustomerID: Boolean(requestBody.customerID),
      sourcePath: authPayload.sourcePath,
      sourceOperation: authPayload.sourceOperation,
      sourceContentType: authPayload.sourceContentType,
      sourceEndpointKey: authPayload.sourcePath ? endpointsByPath.get(authPayload.sourcePath) ?? null : null,
    },
    authShape: {
      hasAuthorization: Boolean(authPayload.authorization),
      hasSessionCookie: hasNonCloudflareCookie(authPayload.sessionCookie),
      hasCfClearance: Boolean(authPayload.cfClearance),
      hasCfBm: Boolean(authPayload.cfBm),
      cookieNames: cookieNames(cookieHeader(authPayload)),
      browserHeaderCount: Object.keys(normalizeBrowserHeaders(authPayload.browserHeadersJson ?? authPayload.browserHeaders)).length,
      browserHeaders: browserHeaderShape,
    },
  };
  fs.writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
  return { path, report };
}

function safeHeaders(headers) {
  const allowed = new Set(["cache-control", "cf-cache-status", "cf-ray", "content-length", "content-type", "date", "server", "vary", "www-authenticate"]);
  const output = {};
  headers.forEach((value, key) => {
    if (allowed.has(key.toLowerCase()) || key.toLowerCase().startsWith("x-")) {
      output[key.toLowerCase()] = value.slice(0, 500);
    }
  });
  return output;
}

function safeBodySnippet(text, data) {
  const source = data && typeof data === "object" && "raw" in data ? data.raw : text;
  return String(source ?? "").replace(/[A-Za-z0-9_-]{24,}/g, "[REDACTED_LONG_TOKEN]").slice(0, 1000);
}

function diagnosticHint(endpointKey, status, text) {
  const sourceKey = authPayload.sourcePath ? endpointsByPath.get(authPayload.sourcePath) : null;
  const sourceHint = sourceKey && sourceKey !== endpointKey
    ? `Copied cURL came from ${sourceKey}; try FANTASY402_INGESTION_ENDPOINTS=${sourceKey} npm run ingest:browser first.`
    : "";
  const statusHint = status >= 500
    ? "Upstream returned an application error; inspect whether copied cURL operation/path matches the endpoint being replayed."
    : "";
  const authHint = status === 401
    ? "Upstream rejected the browser authorization; copy a fresh successful authenticated /cloud/api/* request."
    : "";
  const bodyHint = text.trim().length === 0 ? "Response body was empty." : "";
  return [authHint, statusHint, bodyHint, sourceHint].filter(Boolean).join(" ");
}

function requestBody(endpoint, now) {
  if (endpoint.accountOwnerOnly) {
    return {
      operation: endpoint.operation,
      agentOwner: agentId,
    };
  }
  if (endpoint.contentType === "json") {
    return {
      RRO: 1,
      agentID: agentId,
      agentOwner: agentId,
      customerID: customerId,
      date: now.toISOString(),
      path: "",
      wagerType: "",
      sort: "",
      typeSort: "",
      week: 0,
    };
  }
  const date = now.toISOString().slice(0, 10);
  const body = {
    RRO: 1,
    agentID: agentId,
    agentOwner: agentId,
    operation: endpoint.operation,
    ...(endpoint.agentType ? { agentType: endpoint.agentType } : {}),
    ...(endpoint.accountMessage ? { acc: agentId } : {}),
    ...(endpoint.operation === "getMessage" ? { type: 0 } : {}),
    ...(endpoint.weeklyFigure ? { week: 0, type: "A", layout: "byDay" } : {}),
  };
  if (!endpoint.omitDateRange) {
    body.startDate = date;
    body.endDate = date;
    body.start = date;
    body.end = date;
  }
  return body;
}

function encodeBody(endpoint, body) {
  if (endpoint.contentType === "json") {
    return { body: JSON.stringify(body), contentType: "application/json" };
  }
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(body)) form.set(key, String(value));
  return { body: form, contentType: "application/x-www-form-urlencoded; charset=UTF-8" };
}

function upstreamHeaders(contentType) {
  const browserHeaders = normalizeBrowserHeaders(authPayload.browserHeadersJson ?? authPayload.browserHeaders);
  const headers = {
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: fantasyOrigin.origin,
    Referer: authPayload.referer || `${fantasyOrigin.origin}/manager.html`,
    "User-Agent": authPayload.userAgent || browserHeaders["user-agent"] || "Mozilla/5.0",
    "X-Requested-With": "XMLHttpRequest",
    ...canonicalizeHeaders(browserHeaders),
    "Content-Type": contentType,
    Cookie: cookieHeader(authPayload),
  };
  const authorization = normalizeAuthorization(authPayload.authorization);
  if (authorization) headers.Authorization = authorization;
  return headers;
}

function browserHeaderPresence(headers, payload) {
  const normalized = {};
  for (const [name, value] of Object.entries(headers)) {
    if (typeof value === "string" && value.trim()) normalized[name.toLowerCase()] = value.trim();
  }
  if (payload.userAgent && !normalized["user-agent"]) normalized["user-agent"] = payload.userAgent;
  if (payload.referer && !normalized.referer) normalized.referer = payload.referer;
  const present = EXPECTED_BROWSER_HEADER_NAMES.filter((name) => normalized[name]);
  const missing = EXPECTED_BROWSER_HEADER_NAMES.filter((name) => !normalized[name]);
  return { present, missing, count: present.length, complete: missing.length === 0 };
}

function refreshPayload(payload) {
  const out = {};
  for (const key of ["authorization", "sessionCookie", "cfClearance", "cfBm", "browserHeadersJson", "browserHeaders", "userAgent", "referer", "customerId", "expiresInSeconds"]) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

async function callWorkerJson(path, options) {
  const headers = {
    Authorization: `Bearer ${operatorToken}`,
    Accept: "application/json",
  };
  const init = {
    method: options.method,
    headers,
    signal: AbortSignal.timeout(120_000),
  };
  if (options.body) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(options.body);
  }
  const response = await fetch(new URL(path, workerOrigin), init);
  const text = await response.text();
  const body = parseJson(text);
  if (!options.expectedStatuses.includes(response.status)) {
    fail(`${path} returned HTTP ${response.status}: ${String(body?.message || body?.error || text).slice(0, 240)}`);
  }
  return { httpStatus: response.status, body };
}

function cookieHeader(payload) {
  const cookies = splitCookieHeader(payload.sessionCookie || "");
  appendCookieIfMissing(cookies, "cf_clearance", payload.cfClearance);
  appendCookieIfMissing(cookies, "__cf_bm", payload.cfBm);
  return cookies.join("; ");
}

function normalizeBrowserHeaders(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return {};
    }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function canonicalizeHeaders(headers) {
  const allowed = new Set(["accept", "accept-language", "origin", "priority", "referer", "sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform", "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "user-agent", "x-requested-with"]);
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    const normalized = name.toLowerCase();
    if (!allowed.has(normalized) || typeof value !== "string") continue;
    out[canonicalHeaderName(normalized)] = value;
  }
  return out;
}

function canonicalHeaderName(name) {
  if (name === "sec-ch-ua") return "Sec-CH-UA";
  if (name === "sec-ch-ua-mobile") return "Sec-CH-UA-Mobile";
  if (name === "sec-ch-ua-platform") return "Sec-CH-UA-Platform";
  return name.split("-").map((part) => part ? `${part[0].toUpperCase()}${part.slice(1)}` : part).join("-");
}

function splitCookieHeader(value) {
  return String(value).split(";").map((part) => part.trim()).filter(Boolean);
}

function appendCookieIfMissing(cookies, name, value) {
  const clean = normalizeCookieValue(name, value);
  if (!clean) return;
  if (cookies.some((cookie) => cookieName(cookie)?.toLowerCase() === name.toLowerCase())) return;
  cookies.push(clean);
}

function cookieNames(header) {
  return splitCookieHeader(header).map(cookieName).filter(Boolean);
}

function cookieName(cookie) {
  const index = String(cookie).indexOf("=");
  return index > 0 ? String(cookie).slice(0, index).trim() : null;
}

function hasNonCloudflareCookie(value) {
  return cookieNames(value || "").some((name) => !isCloudflareCookieName(name));
}

function isCloudflareCookieName(name) {
  const normalized = String(name).toLowerCase();
  return normalized === "cf_clearance" || normalized === "__cf_bm";
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

function sanitizeUpload(result) {
  const body = result.body && typeof result.body === "object" ? result.body : {};
  return {
    httpStatus: result.httpStatus,
    runId: body.runId,
    status: body.status,
    endpointsSucceeded: body.endpointsSucceeded,
    endpointsFailed: body.endpointsFailed,
    stored: Array.isArray(body.stored) ? body.stored : [],
    message: body.message,
  };
}

function countItems(data) {
  if (Array.isArray(data)) return data.length;
  if (data && typeof data === "object") {
    for (const value of Object.values(data)) {
      if (Array.isArray(value)) return value.length;
    }
  }
  return null;
}

function readAuthPayload(path) {
  let raw;
  try {
    raw = fs.readFileSync(path, "utf8");
  } catch (error) {
    fail(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) fail(`${path} must contain a JSON object`);
    return parsed;
  } catch (error) {
    fail(`${path} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function validateBrowserAuthPayload(payload, path) {
  const findings = [];
  for (const field of ["authorization", "cfClearance", "cfBm"]) {
    const value = payload[field];
    if (typeof value !== "string" || !value.trim()) {
      findings.push(`${field} is missing`);
      continue;
    }
    if (isPlaceholderToken(value)) findings.push(`${field} still looks like a placeholder`);
  }
  const expiry = jwtExpiryDiagnostics(payload.authorization);
  if (expiry.status === "expired") {
    findings.push(`authorization JWT expired at ${expiry.expiresAt}`);
  }
  if (payload.sessionCookie && isPlaceholderToken(payload.sessionCookie)) {
    findings.push("sessionCookie still looks like a placeholder");
  } else if (payload.sessionCookie && !hasNonCloudflareCookie(payload.sessionCookie)) {
    findings.push("sessionCookie contains only Cloudflare cookies; omit it or include a real application cookie");
  }
  if (!payload.browserHeaders && !payload.browserHeadersJson && !payload.userAgent) {
    findings.push("browserHeaders/browserHeadersJson or userAgent is missing");
  }
  if (findings.length > 0) {
    fail(`${path} is not ready for local ingestion: ${findings.join("; ")}. Paste fresh values from an authenticated browser Network request.`);
  }
}

function hasBearerCloudflareAuth(payload) {
  return Boolean(
    normalizeAuthorization(payload.authorization) &&
      normalizeCookieValue("cf_clearance", payload.cfClearance) &&
      normalizeCookieValue("__cf_bm", payload.cfBm),
  );
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

function readTokenFile() {
  try {
    return fs.readFileSync(".archive-auth-token", "utf8").trim();
  } catch {
    return "";
  }
}

function isPlaceholderToken(value) {
  const trimmed = String(value).trim();
  return trimmed === "..." || /^<.+>$/.test(trimmed) || /redacted|placeholder|changeme/i.test(trimmed);
}

function fail(message) {
  console.error(JSON.stringify({ status: "failed", message }, null, 2));
  process.exit(1);
}
