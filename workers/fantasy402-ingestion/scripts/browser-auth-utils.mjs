import fs from "node:fs";
import { execFileSync } from "node:child_process";

export function parseBrowserCurl(text) {
  const fetchSnippet = parseBrowserFetch(text);
  const headers = { ...fetchSnippet.headers };
  const headerMatches = text.matchAll(/(?:^|\s)(?:-H|--header)\s+(["'])(.*?)\1/gms);
  for (const match of headerMatches) {
    const raw = unescapeShell(match[2]).trim();
    const index = raw.indexOf(":");
    if (index <= 0) continue;
    headers[raw.slice(0, index).trim().toLowerCase()] = raw.slice(index + 1).trim();
  }
  if (fetchSnippet.referrer && !headers.referer) headers.referer = fetchSnippet.referrer;

  const cookie = parseCookieFlag(text) || headers.cookie || "";
  const cookies = parseCookies(cookie);
  const bodyText = parseDataRaw(text) || fetchSnippet.body;
  const form = parseFormBody(bodyText);
  const sourceUrl = parseCurlUrl(text) || fetchSnippet.url;

  const browserHeaders = {};
  for (const name of [
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
  ]) {
    if (headers[name]) browserHeaders[name] = headers[name];
  }

  const result = {
    sourcePath: sourceUrl?.pathname || "",
    sourceOperation: form.operation || "",
    sourceContentType: headers["content-type"] || "",
    agentId: form.agentID || form.agentOwner || form.customerID || "",
    customerId: form.customerID || "",
    authorization: headers.authorization || "",
    sessionCookie: cookieWithoutCloudflare(cookies),
    cfClearance: cookies.cf_clearance || "",
    cfBm: cookies.__cf_bm || "",
    browserHeaders,
    expiresInSeconds: 3600,
  };

  for (const key of Object.keys(result)) {
    if (result[key] === "" || (key === "browserHeaders" && Object.keys(result[key]).length === 0)) {
      delete result[key];
    }
  }
  return result;
}

function parseBrowserFetch(text) {
  const match = text.match(/fetch\(\s*(["'`])([\s\S]*?)\1\s*,\s*\{/m);
  if (!match) return { headers: {}, body: "", referrer: "", url: null };

  const snippet = text.slice(match.index ?? 0);
  const headers = {};
  const headersBlock = snippet.match(/["']headers["']\s*:\s*\{([\s\S]*?)\}\s*,/m)?.[1] ?? "";
  try {
    const parsedHeaders = JSON.parse(`{${headersBlock}}`);
    if (parsedHeaders && typeof parsedHeaders === "object" && !Array.isArray(parsedHeaders)) {
      for (const [name, value] of Object.entries(parsedHeaders)) {
        if (typeof value === "string") headers[name.toLowerCase()] = value.trim();
      }
    }
  } catch {
    for (const headerMatch of headersBlock.matchAll(/["']([^"']+)["']\s*:\s*(["'])((?:\\.|(?!\2)[\s\S])*?)\2\s*,?/gm)) {
      headers[headerMatch[1].toLowerCase()] = unescapeJsString(headerMatch[3]).trim();
    }
  }

  const body = parseObjectStringField(snippet, "body");
  const referrer = parseObjectStringField(snippet, "referrer");
  let url = null;
  try {
    url = new URL(unescapeJsString(match[2]));
  } catch {
    url = null;
  }
  return { headers, body, referrer, url };
}

function parseObjectStringField(text, field) {
  const match = text.match(new RegExp(`["']${field}["']\\s*:\\s*(["'])((?:\\\\.|(?!\\1)[\\s\\S])*?)\\1\\s*,?`, "m"));
  return match ? unescapeJsString(match[2]).trim() : "";
}

export function readBrowserCurlInput(path) {
  if (path === "-") {
    return fs.readFileSync(0, "utf8");
  }
  try {
    return fs.readFileSync(path, "utf8");
  } catch (error) {
    if (path === "fantasy402/browser-request.curl") {
      const pasted = readMacClipboard();
      if (pasted) return pasted;
      throw new Error(
        `Could not read ${path}, and the macOS clipboard did not contain a curl command. Copy a successful browser request as cURL, then rerun this command, or pipe it with: pbpaste | npm run auth:import-curl -- -`,
      );
    }
    throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function validateBrowserAuthPayload(payload, label = "browser auth") {
  const findings = [];
  if (isCloudflareChallengePath(payload.sourcePath)) {
    findings.push("sourcePath is Cloudflare challenge telemetry; copy a successful authenticated /cloud/api/* request instead");
  }
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
    throw new Error(`${label} is not ingestion-ready: ${findings.join("; ")}`);
  }
}

export function refreshPayload(payload) {
  const out = {};
  for (const key of [
    "authorization",
    "sessionCookie",
    "cfClearance",
    "cfBm",
    "browserHeadersJson",
    "browserHeaders",
    "userAgent",
    "referer",
    "customerId",
    "expiresInSeconds",
  ]) {
    if (payload[key] !== undefined) out[key] = payload[key];
  }
  return out;
}

export function authShape(payload) {
  const authorizationExpiry = jwtExpiryDiagnostics(payload.authorization);
  return {
    hasAuthorization: Boolean(normalizeAuthorization(payload.authorization)),
    authorizationExpiry,
    hasSessionCookie: hasNonCloudflareCookie(payload.sessionCookie),
    hasCfClearance: Boolean(normalizeCookieValue("cf_clearance", payload.cfClearance)),
    hasCfBm: Boolean(normalizeCookieValue("__cf_bm", payload.cfBm)),
    cookieNames: cookieNames(cookieHeader(payload)),
    browserHeaderCount: Object.keys(normalizeBrowserHeaders(payload.browserHeadersJson ?? payload.browserHeaders)).length,
  };
}

export function cookieHeader(payload) {
  const cookies = splitCookieHeader(payload.sessionCookie || "");
  appendCookieIfMissing(cookies, "cf_clearance", payload.cfClearance);
  appendCookieIfMissing(cookies, "__cf_bm", payload.cfBm);
  return cookies.join("; ");
}

export function readTokenFile(path = ".archive-auth-token") {
  try {
    return fs.readFileSync(path, "utf8").trim();
  } catch {
    return "";
  }
}

export function isPlaceholderToken(value) {
  const trimmed = String(value).trim();
  return trimmed === "..." || /^<.+>$/.test(trimmed) || /redacted|placeholder|changeme/i.test(trimmed);
}

export function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: String(text).slice(0, 500) };
  }
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

export function normalizeAuthorization(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return /^Bearer\s+/i.test(trimmed) ? trimmed : `Bearer ${trimmed}`;
}

export function jwtExpiryDiagnostics(value, nowMs = Date.now()) {
  const token = normalizeAuthorization(value)?.replace(/^Bearer\s+/i, "") ?? "";
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" && Number.isFinite(payload.exp) ? payload.exp : null;
  if (!exp) return { status: "unknown", expiresAt: null, secondsRemaining: null };

  const secondsRemaining = Math.floor(exp - nowMs / 1000);
  const expiresAt = new Date(exp * 1000).toISOString();
  if (secondsRemaining <= 0) return { status: "expired", expiresAt, secondsRemaining };
  if (secondsRemaining <= 300) return { status: "expiring", expiresAt, secondsRemaining };
  return { status: "valid", expiresAt, secondsRemaining };
}

export function hasNonCloudflareCookie(value) {
  return cookieNames(value || "").some((name) => !isCloudflareCookieName(name));
}

function isCloudflareChallengePath(path) {
  return String(path || "").startsWith("/cdn-cgi/challenge-platform/");
}

function decodeJwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length < 2) return null;
  try {
    const base64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    return JSON.parse(Buffer.from(padded, "base64").toString("utf8"));
  } catch {
    return null;
  }
}

function parseCurlUrl(text) {
  const match = text.match(/curl\s+(["'])(.*?)\1/ms) || text.match(/curl\s+(\S+)/m);
  const raw = match?.[2] || match?.[1] || "";
  try {
    return new URL(unescapeShell(raw));
  } catch {
    return null;
  }
}

function parseCookieFlag(text) {
  const match = text.match(/(?:^|\s)(?:-b|--cookie)\s+(["'])(.*?)\1/ms);
  return match ? unescapeShell(match[2]).trim() : "";
}

function parseDataRaw(text) {
  const match = text.match(/(?:^|\s)(?:--data-raw|--data)\s+(["'])(.*?)\1/ms);
  return match ? unescapeShell(match[2]).trim() : "";
}

function parseFormBody(text) {
  if (!text) return {};
  if (text.startsWith("{")) {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  }
  const output = {};
  const params = new URLSearchParams(text);
  for (const [key, value] of params.entries()) output[key] = value;
  return output;
}

function parseCookies(value) {
  const output = {};
  for (const part of value.split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const index = trimmed.indexOf("=");
    if (index <= 0) continue;
    output[trimmed.slice(0, index)] = trimmed.slice(index + 1);
  }
  return output;
}

function cookieWithoutCloudflare(cookies) {
  return Object.entries(cookies)
    .filter(([name]) => !isCloudflareCookieName(name))
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function unescapeShell(value) {
  return value.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

function unescapeJsString(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\'/g, "'")
    .replace(/\\\\/g, "\\");
}

function readMacClipboard() {
  try {
    const pasted = execFileSync("pbpaste", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return pasted.includes("curl ") ? pasted : "";
  } catch {
    return "";
  }
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

function isCloudflareCookieName(name) {
  const normalized = String(name).toLowerCase();
  return normalized === "cf_clearance" || normalized === "__cf_bm";
}

function normalizeCookieValue(name, value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const trimmed = value.trim();
  return trimmed.includes("=") ? trimmed : `${name}=${trimmed}`;
}
