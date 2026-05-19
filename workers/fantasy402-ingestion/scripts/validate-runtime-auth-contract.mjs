import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(workerRoot, "../..");
const testDir = path.join(workerRoot, "test");
const allTests = fs
  .readdirSync(testDir)
  .filter((name) => name.endsWith(".test.ts"))
  .map((name) => fs.readFileSync(path.join(testDir, name), "utf8"))
  .join("\n");

const filePaths = {
  source: path.join(workerRoot, "src/index.ts"),
  readme: path.join(workerRoot, "README.md"),
  workerOpenapi: path.join(workerRoot, "openapi.worker.json"),
  securedSite: path.join(repoRoot, ".o11y/fantasy402-redacted-deep/api-spec-secured/site/index.html"),
};

const contents = Object.fromEntries(
  Object.entries(filePaths).map(([key, filePath]) => [key, fs.readFileSync(filePath, "utf8")]),
);
contents.tests = allTests;
const workerOpenapi = JSON.parse(contents.workerOpenapi);
const findings = [];

requireText(contents.source, "appendCookieHeaderIfMissing(cookies, env.FANTASY402_SESSION_COOKIE);", "source must append configured session cookie");
requireText(contents.source, "appendCookieHeaderIfMissing(cookies, sessionCookie);", "source must append refreshed/login session cookie");
requireText(contents.source, 'appendCookieIfMissing(cookies, "cf_clearance", env.FANTASY402_CF_CLEARANCE);', "source must append cf_clearance cookie");
requireText(contents.source, 'appendCookieIfMissing(cookies, "__cf_bm", env.FANTASY402_CF_BM);', "source must append __cf_bm cookie");
requireText(contents.source, "hasSessionCookie: cookieNames.some((name) => !isCloudflareCookieName(name))", "failure diagnostics must report non-Cloudflare app-cookie presence generically");
requireText(contents.source, 'hasCfClearance: hasCookieName("cf_clearance")', "failure diagnostics must report cf_clearance presence");
requireText(contents.source, 'hasCfBm: hasCookieName("__cf_bm")', "failure diagnostics must report __cf_bm presence");
requireText(contents.source, "cookieNames,", "failure diagnostics must include sanitized cookie names");
requireText(contents.source, "function isCloudflareCookieName", "source must classify Cloudflare cookie names explicitly");
requireText(contents.source, "const upstreamAuthShape = upstreamAuthDiagnostics(env);", "diagnostics must expose sanitized upstream auth shape");
requireText(contents.source, "function upstreamAuthDiagnostics", "source must define sanitized upstream auth diagnostics");
requireText(contents.source, "ingestionReadiness", "diagnostics must expose ingestion readiness derived from auth shape");
requireText(contents.source, "missing bearer authorization plus cf_clearance and __cf_bm", "diagnostics must name usable upstream auth requirements");
requireText(contents.source, 'normalizeAuthorization(env.FANTASY402_AUTHORIZATION)', "source must skip fallback login when browser bearer auth is configured");
requireText(contents.source, "function hasBearerCloudflareAuth", "source must allow observed bearer plus Cloudflare-cookie browser auth");
requireText(contents.source, '/cloud/api/System/authenticateCustomer', "source must use browser-observed authenticateCustomer fallback");
requireText(contents.source, '/cloud/api/System/renewToken', "source must implement browser-observed renewToken flow");
requireText(contents.source, "async function cacheFantasy402Auth", "source must cache app-level Fantasy402 auth in AUTH_CACHE");
requireText(contents.source, "await env.AUTH_CACHE.put(AUTH_CACHE_KEY", "source must write authenticated tokens into AUTH_CACHE");
if (contents.source.includes("/cloud/api/Auth/login")) {
  findings.push("source must not use obsolete /cloud/api/Auth/login fallback");
}
requireOrdered(
  contents.source,
  [
    "appendCookieHeaderIfMissing(cookies, env.FANTASY402_SESSION_COOKIE);",
    "appendCookieHeaderIfMissing(cookies, sessionCookie);",
    'appendCookieIfMissing(cookies, "cf_clearance", env.FANTASY402_CF_CLEARANCE);',
    'appendCookieIfMissing(cookies, "__cf_bm", env.FANTASY402_CF_BM);',
  ],
  "source must preserve upstream cookie assembly order",
);
requireText(contents.source, "cookieName(existing)?.toLowerCase() === name.toLowerCase()", "source must dedupe cookies by cookie name");
requireText(contents.source, "if (cached.sessionCookie) overlaid.FANTASY402_SESSION_COOKIE = cached.sessionCookie;", "AUTH_CACHE sessionCookie overlay must override configured secret");
requireText(contents.source, '"FANTASY402_SESSION_COOKIE"', "Secrets Store materialization must include FANTASY402_SESSION_COOKIE");
requireText(contents.source, "hasNonCloudflareCookieHeader", "source must distinguish app session cookies from Cloudflare-only cookies");
requireText(contents.source, "omit it for bearer plus cf_clearance and __cf_bm browser auth", "refresh-auth must allow observed bearer plus Cloudflare-cookie browser auth");
requireText(contents.source, 'url.pathname === "/auth/health"', "source must expose public GET /auth/health");
requireText(contents.source, "authCacheOverlay", "auth health must report AUTH_CACHE overlay status");
requireText(contents.tests, "auth-health is public and returns sanitized readiness", "tests must cover GET /auth/health");

requireText(contents.tests, "ingestion keeps configured session cookie when appending Cloudflare cookies", "tests must cover configured session cookie plus Cloudflare cookies");
requireText(contents.tests, "ingestion uses browser bearer plus Cloudflare cookies when app session cookie is absent", "tests must cover observed bearer plus Cloudflare-cookie auth");
requireText(contents.tests, "refresh-auth rejects Cloudflare-only session cookies before poisoning AUTH_CACHE", "tests must reject explicitly bad sessionCookie payloads");
requireText(contents.tests, "url.endsWith(\"/cloud/api/System/authenticateCustomer\")), false", "tests must assert valid bearer plus Cloudflare-cookie auth skips authenticateCustomer");
requireText(contents.tests, "authenticateCustomer fallback caches bearer token and app session in AUTH_CACHE", "tests must cover authenticateCustomer fallback cache writes");
requireText(contents.tests, "ingestion renews near-expired cached token before upstream calls", "tests must cover renewToken before upstream calls");
requireText(contents.tests, "ingestion keeps near-expired cached session when renewToken fails", "tests must cover renewToken failure fallback");
requireText(contents.tests, "cf_clearance=clearance-token; __cf_bm=bm-token", "tests must assert combined Cookie header shape");
requireText(contents.tests, "failure archive records upstream cookie shape without cookie values", "tests must cover sanitized failure archive cookie diagnostics");
requireText(contents.tests, "archived.upstream.request.hasSessionCookie, true", "tests must assert failure archive hasSessionCookie");
requireText(contents.tests, "ingestion prefers refresh-auth KV overlay over configured secrets", "tests must cover AUTH_CACHE overlay precedence");
requireText(contents.tests, "cf_clearance=kv-clearance; __cf_bm=kv-bm", "tests must assert overlay Cookie header shape");

requireText(contents.readme, "### Upstream Auth And Cookie Assembly", "README must document upstream auth and cookie assembly");
requireText(contents.readme, "Adds `FANTASY402_SESSION_COOKIE` when set.", "README must document configured session cookie inclusion");
requireText(contents.readme, "app_session=<redacted>; cf_clearance=<redacted>; __cf_bm=<redacted>", "README must document sanitized Cookie shape");
requireText(contents.readme, "production ingestion accepts bearer auth plus Cloudflare cookies", "README must document current auth interpretation");
requireText(contents.readme, "/cloud/api/System/authenticateCustomer", "README must document browser-observed auth fallback endpoint");
requireText(contents.readme, "/cloud/api/System/renewToken", "README must document browser-observed token renewal endpoint");
requireText(contents.readme, "stores them in `AUTH_CACHE`", "README must document app-auth caching");
requireText(contents.readme, "npm run ingest:dry-run", "README must document sanitized ingestion dry-run");

const checkAuth = fs.readFileSync(path.join(workerRoot, "scripts/check-browser-auth.mjs"), "utf8");
const dryRun = fs.readFileSync(path.join(workerRoot, "scripts/ingestion-dry-run.mjs"), "utf8");
requireText(checkAuth, "contains only Cloudflare cookies", "auth check must warn when sessionCookie has only Cloudflare cookies");
requireText(checkAuth, "appSessionCookie", "auth check must report non-Cloudflare app session cookie presence");
requireText(dryRun, "callsFantasy402: false", "dry-run must explicitly avoid calling Fantasy402");
requireText(dryRun, "hasSessionCookie", "dry-run must report hasSessionCookie");
requireText(dryRun, "ingestionReadiness", "dry-run must report ingestion readiness");
requireText(dryRun, "bodyKeys", "dry-run must report per-endpoint bodyKeys");
const localBrowserIngest = fs.readFileSync(path.join(workerRoot, "scripts/local-browser-ingest.mjs"), "utf8");
requireText(localBrowserIngest, "function hasBearerCloudflareAuth", "local browser ingest must allow bearer plus Cloudflare-cookie auth");
requireText(localBrowserIngest, "omit it or include a real application cookie", "local browser ingest must describe optional app session auth");
requireText(localBrowserIngest, "cookieNames: cookieNames(cookieHeader(authPayload))", "local browser ingest failure reports must include sanitized cookie names");

requireText(contents.securedSite, "<h2>Upstream Cookie Assembly</h2>", "secured HTML docs must include Upstream Cookie Assembly section");
requireText(contents.securedSite, "Always included when present.", "secured HTML docs must state session cookie inclusion behavior");
requireText(contents.securedSite, "Endpoint calls accept bearer authorization plus Cloudflare cookies", "secured HTML docs must reflect current observed login flow");

const refreshSchema = workerOpenapi.components?.schemas?.RefreshAuthRequest;
if (!refreshSchema) {
  findings.push("worker OpenAPI must define RefreshAuthRequest");
} else {
  const sessionCookie = refreshSchema.properties?.sessionCookie;
  const anyOf = refreshSchema.anyOf ?? [];
  if (
    !anyOf.some((branch) =>
      ["authorization", "cfClearance", "cfBm"].every((name) => branch.required?.includes(name)),
    )
  ) {
    findings.push("RefreshAuthRequest.anyOf must allow bearer plus cfClearance and cfBm without sessionCookie");
  }
  if (!sessionCookie) findings.push("RefreshAuthRequest must include sessionCookie");
  if (sessionCookie?.writeOnly !== true) findings.push("RefreshAuthRequest.sessionCookie must be writeOnly");
  if (sessionCookie?.["x-sensitive"] !== true) findings.push("RefreshAuthRequest.sessionCookie must be x-sensitive");
  if (sessionCookie?.["x-security-review-required"] !== true) {
    findings.push("RefreshAuthRequest.sessionCookie must require security review");
  }
  if (!/upstream Cookie header alongside Cloudflare cookies/.test(sessionCookie?.description ?? "")) {
    findings.push("RefreshAuthRequest.sessionCookie description must document Cookie header assembly");
  }
  if (!/optional non-Cloudflare application\/session Cookie/.test(sessionCookie?.description ?? "")) {
    findings.push("RefreshAuthRequest.sessionCookie description must document optional non-Cloudflare app-session behavior");
  }
  if (!/bearer plus Cloudflare cookies/.test(sessionCookie?.description ?? "")) {
    findings.push("RefreshAuthRequest.sessionCookie description must document bearer plus Cloudflare cookie readiness");
  }
}

const upstreamAuthShape = workerOpenapi.components?.schemas?.DiagnosticsResponse?.properties?.upstreamAuthShape;
if (!upstreamAuthShape?.properties?.ingestionReadiness) {
  findings.push("DiagnosticsResponse.upstreamAuthShape must include ingestionReadiness");
}

const serializedOpenapi = JSON.stringify(workerOpenapi);
if (/ASP\.NET_SessionId|backdoor69|billy666/i.test(serializedOpenapi)) {
  findings.push("worker OpenAPI must not contain credential-shaped literal examples");
}

if (findings.length > 0) {
  console.error(JSON.stringify({ status: "failed", findings }, null, 2));
  process.exit(1);
}

console.log(
  JSON.stringify(
    {
      status: "ok",
      contract: "runtime-auth",
      checks: [
        "cookie assembly order",
        "cookie-name dedupe",
        "sanitized failure cookie diagnostics",
        "diagnostics auth-shape",
        "local dry-run auth-shape",
        "AUTH_CACHE overlay precedence",
        "bearer plus Cloudflare-cookie auth",
        "browser-observed authenticateCustomer fallback",
        "AUTH_CACHE app-auth writes",
        "renewToken refresh path",
        "renewToken failure fallback",
        "session-cookie tests",
        "operator docs",
        "worker OpenAPI sensitivity metadata",
      ],
    },
    null,
    2,
  ),
);

function requireText(text, expected, message) {
  if (!text.includes(expected)) findings.push(message);
}

function requireOrdered(text, expectedParts, message) {
  let previous = -1;
  for (const part of expectedParts) {
    const index = text.indexOf(part);
    if (index === -1 || index <= previous) {
      findings.push(message);
      return;
    }
    previous = index;
  }
}
