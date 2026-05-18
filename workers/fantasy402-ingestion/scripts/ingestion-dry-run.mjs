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

const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? process.argv[2] ?? "fantasy402/browser-auth.json";
const endpointKeys = (process.env.FANTASY402_INGESTION_ENDPOINTS ?? readWranglerEndpointKeys())
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
  Pending: { path: "/cloud/api/Report/Pending", operation: "Pending", contentType: "form", requiresCustomerId: true },
  getCommunicationMessages: { path: "/cloud/api/Customer/getCommunicationMessages", operation: "getCommunicationMessages", contentType: "form", requiresCustomerId: true },
  getBetTicker: { path: "/cloud/api/Manager/getBetTicker", operation: "getBetTicker", contentType: "form", omitDateRange: true, extraFields: { wagerNumber: 1 } },
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

const auth = readAuthPayload(authFile);
const agentId = process.env.FANTASY402_AGENT_ID || auth.agentId || auth.customerId || "";
const customerId = process.env.FANTASY402_CUSTOMER_ID || auth.customerId || "";
const authShape = authDiagnostics(auth);
const authorizationExpiry = jwtExpiryDiagnostics(auth.authorization);
const browserHeaders = normalizeBrowserHeaders(auth.browserHeadersJson ?? auth.browserHeaders);
const browserHeaderCount = Object.keys(browserHeaders).length + (auth.userAgent ? 1 : 0) + (auth.referer ? 1 : 0);
const browserHeaderShape = browserHeaderPresence(browserHeaders, auth);

const findings = [];
const warnings = [];
if (!agentId) findings.push("missing agentId/customerId for agentID and agentOwner");
if (!auth.authorization || isPlaceholder(auth.authorization)) findings.push("authorization is missing or placeholder");
if (authorizationExpiry.status === "expired") findings.push(`authorization JWT expired at ${authorizationExpiry.expiresAt}`);
if (authorizationExpiry.status === "expiring") warnings.push(`authorization JWT expires soon at ${authorizationExpiry.expiresAt}`);
if (!auth.cfClearance || isPlaceholder(auth.cfClearance)) findings.push("cfClearance is missing or placeholder");
if (!auth.cfBm || isPlaceholder(auth.cfBm)) findings.push("cfBm is missing or placeholder");
if (auth.sessionCookie && isPlaceholder(auth.sessionCookie)) {
  findings.push("sessionCookie is placeholder");
} else if (auth.sessionCookie && !authShape.hasSessionCookie) {
  findings.push("sessionCookie contains only Cloudflare cookie names; omit it or include a real application cookie");
}
if (browserHeaderCount === 0) findings.push("browser headers/userAgent are missing");
if (!browserHeaderShape.complete) warnings.push(`browser header capture is missing: ${browserHeaderShape.missing.join(", ")}`);

const now = new Date();
const endpointsOut = endpointKeys.map((key) => {
  const endpoint = endpoints[key];
  if (!endpoint) {
    findings.push(`unknown endpoint ${key}`);
    return { endpointKey: key, status: "failed", findings: ["unknown endpoint"] };
  }
  const endpointFindings = [];
  if (endpoint.requiresCustomerId && !customerId) endpointFindings.push("missing customerId for customer-scoped endpoint");
  const body = requestBody(endpoint, now);
  return {
    endpointKey: key,
    path: endpoint.path,
    contentType: endpoint.contentType === "json" ? "application/json" : "application/x-www-form-urlencoded; charset=UTF-8",
    bodyKeys: Object.keys(body).sort(),
    operation: body.operation ?? endpoint.operation,
    hasRRO: String(body.RRO) === "1",
    hasAgentID: Boolean(body.agentID),
    hasAgentOwner: Boolean(body.agentOwner),
    hasCustomerID: Boolean(body.customerID),
    authShape,
    browserHeaderCount,
    browserHeaderShape,
    status: endpointFindings.length === 0 ? "ok" : "failed",
    findings: endpointFindings,
  };
});

const endpointFailures = endpointsOut.flatMap((endpoint) => endpoint.findings?.map((finding) => `${endpoint.endpointKey}: ${finding}`) ?? []);
const allFindings = [...findings, ...endpointFailures];
const output = {
  status: allFindings.length === 0 ? "ok" : "failed",
  mode: "dry-run",
  callsFantasy402: false,
  authFile,
  endpointCount: endpointsOut.length,
  authShape,
  authorizationExpiry,
  ingestionReadiness: {
    status: authShape.hasAuthorization && authShape.hasCfClearance && authShape.hasCfBm ? "ready" : "blocked",
    blocker: authShape.hasAuthorization && authShape.hasCfClearance && authShape.hasCfBm ? null : "missing bearer authorization plus cf_clearance and __cf_bm",
  },
  browserHeaderCount,
  browserHeaderShape,
  findings: allFindings,
  warnings,
  endpoints: endpointsOut,
};

console.log(JSON.stringify(output, null, 2));
if (allFindings.length > 0) process.exit(1);

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
    ...(endpoint.extraFields ?? {}),
  };
  if (!endpoint.omitDateRange) {
    body.startDate = date;
    body.endDate = date;
    body.start = date;
    body.end = date;
  }
  return body;
}

function authDiagnostics(payload) {
  const cookieNames = splitCookieHeader(payload.sessionCookie || "")
    .concat(normalizeCookieValue("cf_clearance", payload.cfClearance) ? [normalizeCookieValue("cf_clearance", payload.cfClearance)] : [])
    .concat(normalizeCookieValue("__cf_bm", payload.cfBm) ? [normalizeCookieValue("__cf_bm", payload.cfBm)] : [])
    .map(cookieName)
    .filter(Boolean);
  const hasCookieName = (name) => cookieNames.some((cookie) => cookie.toLowerCase() === name.toLowerCase());
  const hasAuthorization = Boolean(payload.authorization && !isPlaceholder(payload.authorization));
  const hasCfClearance = hasCookieName("cf_clearance");
  const hasCfBm = hasCookieName("__cf_bm");
  return {
    hasAuthorization,
    authorizationExpiry: jwtExpiryDiagnostics(payload.authorization),
    hasCookie: cookieNames.length > 0,
    hasSessionCookie: cookieNames.some((name) => !isCloudflareCookieName(name)),
    hasCfClearance,
    hasCfBm,
    hasBearerCloudflareAuth: hasAuthorization && hasCfClearance && hasCfBm,
    cookieNames,
  };
}

function readAuthPayload(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", message: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}` }, null, 2));
    process.exit(1);
  }
}

function readWranglerEndpointKeys() {
  const config = fs.readFileSync("wrangler.toml", "utf8");
  return config.match(/FANTASY402_INGESTION_ENDPOINTS\s*=\s*"([^"]+)"/)?.[1] ?? "getAccountInfoOwner,getAuthorizations";
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

function splitCookieHeader(value) {
  return String(value).split(";").map((part) => part.trim()).filter(Boolean);
}

function normalizeCookieValue(name, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.includes("=") ? trimmed : `${name}=${trimmed}`;
}

function cookieName(cookie) {
  const index = String(cookie).indexOf("=");
  return index > 0 ? String(cookie).slice(0, index).trim() : null;
}

function isCloudflareCookieName(name) {
  const normalized = String(name).toLowerCase();
  return normalized === "cf_clearance" || normalized === "__cf_bm";
}

function isPlaceholder(value) {
  const trimmed = String(value ?? "").trim();
  return !trimmed || trimmed === "..." || /^<.+>$/.test(trimmed) || /redacted|placeholder|changeme/i.test(trimmed);
}
