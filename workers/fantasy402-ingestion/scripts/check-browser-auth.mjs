import fs from "node:fs";

const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? process.argv[2] ?? "fantasy402/browser-auth.json";
const auth = readJson(authFile);
const findings = [];
const warnings = [];

for (const field of ["authorization", "cfClearance", "cfBm"]) {
  const value = auth[field];
  if (typeof value !== "string" || !value.trim()) {
    findings.push(`${field} is missing`);
  } else if (isPlaceholder(value)) {
    findings.push(`${field} still looks like a placeholder`);
  }
}

if (auth.sessionCookie && isPlaceholder(auth.sessionCookie)) {
  findings.push("sessionCookie still looks like a placeholder");
} else if (auth.sessionCookie && !hasNonCloudflareCookie(auth.sessionCookie)) {
  findings.push("sessionCookie contains only Cloudflare cookies. Omit it or include a real application cookie.");
}

if (!auth.browserHeaders && !auth.browserHeadersJson && !auth.userAgent) {
  findings.push("browserHeaders/browserHeadersJson or userAgent is missing");
}

if (!auth.agentId && !auth.customerId && !process.env.FANTASY402_AGENT_ID) {
  findings.push("agentId/customerId is missing");
}

const summary = {
  status: findings.length === 0 ? "ok" : "failed",
  file: authFile,
  fieldPresence: {
    agentId: Boolean(auth.agentId || process.env.FANTASY402_AGENT_ID),
    customerId: Boolean(auth.customerId || process.env.FANTASY402_CUSTOMER_ID),
    authorization: Boolean(auth.authorization),
    sessionCookie: Boolean(auth.sessionCookie),
    appSessionCookie: Boolean(auth.sessionCookie && hasNonCloudflareCookie(auth.sessionCookie)),
    cfClearance: Boolean(auth.cfClearance),
    cfBm: Boolean(auth.cfBm),
    browserHeaders: Boolean(auth.browserHeaders || auth.browserHeadersJson || auth.userAgent),
  },
  findings,
  warnings,
};

console.log(JSON.stringify(summary, null, 2));
if (findings.length > 0) process.exit(1);

function readJson(path) {
  try {
    return JSON.parse(fs.readFileSync(path, "utf8"));
  } catch (error) {
    console.error(JSON.stringify({ status: "failed", message: `Could not read ${path}: ${error instanceof Error ? error.message : String(error)}` }, null, 2));
    process.exit(1);
  }
}

function isPlaceholder(value) {
  const trimmed = String(value).trim();
  return trimmed === "..." || /^<.+>$/.test(trimmed) || /redacted|placeholder|changeme/i.test(trimmed);
}

function hasNonCloudflareCookie(value) {
  if (typeof value !== "string" || !value.trim()) return false;
  return String(value)
    .split(";")
    .map((part) => part.trim())
    .map((cookie) => cookie.slice(0, cookie.indexOf("=")).trim().toLowerCase())
    .some((name) => name && name !== "cf_clearance" && name !== "__cf_bm");
}

function hasBearerCloudflareAuth(auth) {
  return Boolean(
    auth.authorization &&
      !isPlaceholder(auth.authorization) &&
      auth.cfClearance &&
      !isPlaceholder(auth.cfClearance) &&
      auth.cfBm &&
      !isPlaceholder(auth.cfBm),
  );
}
