import fs from "node:fs";

const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? process.argv[2] ?? "fantasy402/browser-auth.json";
const endpointKeys = (process.env.FANTASY402_INGESTION_ENDPOINTS ?? readWranglerEndpointKeys())
  .split(",")
  .map((part) => part.trim())
  .filter(Boolean);

const endpoints = {
  getAgentPerformance: { path: "/cloud/api/Manager/getAgentPerformance", operation: "getAgentPerformance", contentType: "form" },
  getAgentBilling: { path: "/cloud/api/Manager/getAgentBilling", operation: "getAgentBilling", contentType: "form" },
  getEnterTransactions: { path: "/cloud/api/Manager/getEnterTransactions", operation: "getEnterTransactions", contentType: "form" },
  getPlayers: { path: "/cloud/api/Manager/getPlayers", operation: "getPlayers", contentType: "form" },
  getAddedInfo: { path: "/cloud/api/Manager/getAddedInfo", operation: "getAddedInfo", contentType: "form" },
  getLineTypes: { path: "/cloud/api/Manager/getLineTypes", operation: "getLineTypes", contentType: "form" },
  getHeriarchy: { path: "/cloud/api/Manager/getHeriarchy", operation: "getHeriarchy", contentType: "form" },
  getPending: { path: "/cloud/api/Manager/getPending", operation: "getPending", contentType: "json", requiresCustomerId: true },
  Pending: { path: "/cloud/api/Report/Pending", operation: "Pending", contentType: "form", requiresCustomerId: true },
  getCommunicationMessages: { path: "/cloud/api/Customer/getCommunicationMessages", operation: "getCommunicationMessages", contentType: "form", requiresCustomerId: true },
};

const auth = readAuthPayload(authFile);
const agentId = process.env.FANTASY402_AGENT_ID || auth.agentId || auth.customerId || "";
const customerId = process.env.FANTASY402_CUSTOMER_ID || auth.customerId || "";
const authShape = authDiagnostics(auth);
const browserHeaders = normalizeBrowserHeaders(auth.browserHeadersJson ?? auth.browserHeaders);
const browserHeaderCount = Object.keys(browserHeaders).length + (auth.userAgent ? 1 : 0) + (auth.referer ? 1 : 0);

const findings = [];
const warnings = [];
if (!agentId) findings.push("missing agentId/customerId for agentID and agentOwner");
if (!auth.authorization || isPlaceholder(auth.authorization)) findings.push("authorization is missing or placeholder");
if (!auth.cfClearance || isPlaceholder(auth.cfClearance)) findings.push("cfClearance is missing or placeholder");
if (!auth.cfBm || isPlaceholder(auth.cfBm)) findings.push("cfBm is missing or placeholder");
if (!auth.sessionCookie || isPlaceholder(auth.sessionCookie)) {
  findings.push("sessionCookie is missing or placeholder");
} else if (!authShape.hasSessionCookie) {
  findings.push("sessionCookie contains only Cloudflare cookie names; include the app session cookie such as ASP.NET_SessionId");
}
if (browserHeaderCount === 0) findings.push("browser headers/userAgent are missing");

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
  ingestionReadiness: {
    status: authShape.hasAuthorization && authShape.hasCfClearance && authShape.hasCfBm && authShape.hasSessionCookie ? "ready" : "blocked",
    blocker: authShape.hasSessionCookie ? null : "missing non-Cloudflare app session cookie",
  },
  browserHeaderCount,
  findings: allFindings,
  warnings,
  endpoints: endpointsOut,
};

console.log(JSON.stringify(output, null, 2));
if (allFindings.length > 0) process.exit(1);

function requestBody(endpoint, now) {
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
  return {
    RRO: 1,
    agentID: agentId,
    agentOwner: agentId,
    startDate: date,
    endDate: date,
    start: date,
    end: date,
    operation: endpoint.operation,
  };
}

function authDiagnostics(payload) {
  const cookieNames = splitCookieHeader(payload.sessionCookie || "")
    .concat(normalizeCookieValue("cf_clearance", payload.cfClearance) ? [normalizeCookieValue("cf_clearance", payload.cfClearance)] : [])
    .concat(normalizeCookieValue("__cf_bm", payload.cfBm) ? [normalizeCookieValue("__cf_bm", payload.cfBm)] : [])
    .map(cookieName)
    .filter(Boolean);
  const hasCookieName = (name) => cookieNames.some((cookie) => cookie.toLowerCase() === name.toLowerCase());
  return {
    hasAuthorization: Boolean(payload.authorization && !isPlaceholder(payload.authorization)),
    hasCookie: cookieNames.length > 0,
    hasSessionCookie: cookieNames.some((name) => !isCloudflareCookieName(name)),
    hasCfClearance: hasCookieName("cf_clearance"),
    hasCfBm: hasCookieName("__cf_bm"),
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
  return config.match(/FANTASY402_INGESTION_ENDPOINTS\s*=\s*"([^"]+)"/)?.[1] ?? "getAgentPerformance,getAgentBilling,getEnterTransactions,getPlayers,getAddedInfo,getLineTypes,getHeriarchy";
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
