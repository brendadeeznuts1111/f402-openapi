#!/usr/bin/env bun
/**
 * Full unattended auth stack validation (files, proxy, health, browser-auth shape).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jwtExpiryDiagnostics, readTokenFile, validateBrowserAuthPayload } from "./browser-auth-utils.mjs";
import { runAuthStackPreflight } from "./auth-stack-preflight.mjs";
import {
  isLocalIngestProxyUrl,
  localProxyBaseUrl,
  resolveUpstreamWorkerOrigin,
} from "./proxy-client-utils.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const offline = process.argv.includes("--offline");
const findings = [];
const warnings = [];

function check(name, ok, detail) {
  if (ok) console.log(`  OK   ${name}${detail ? `: ${detail}` : ""}`);
  else {
    console.log(`  FAIL ${name}${detail ? `: ${detail}` : ""}`);
    findings.push(`${name}: ${detail || "failed"}`);
  }
}

function warn(name, detail) {
  console.log(`  WARN ${name}: ${detail}`);
  warnings.push(`${name}: ${detail}`);
}

const workerOrigin = process.env.WORKER_ORIGIN ?? localProxyBaseUrl();
const upstream = resolveUpstreamWorkerOrigin(workerOrigin);
const proxyMode = isLocalIngestProxyUrl(workerOrigin);
const token = process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();

console.log(`Fantasy402 auth stack check${offline ? " (offline)" : ""}\n`);
console.log(`  WORKER_ORIGIN=${workerOrigin}`);
console.log(`  upstream=${upstream}`);
console.log(`  proxyMode=${proxyMode}\n`);

const requiredScripts = [
  "scripts/local-ingest-proxy.ts",
  "scripts/auth-stack-preflight.mjs",
  "scripts/auth-refresh-if-needed.mjs",
  "scripts/automation-policy.mjs",
  "scripts/cycle-state.mjs",
  "scripts/cycle-alerts.mjs",
  "scripts/monitor-auth-stack.mjs",
  "scripts/run-unattended-cycle.mjs",
  "scripts/refresh-auth-full/refresh-auth-full.ts",
  "scripts/run-with-ingestion-env.sh",
  "scripts/proxy-client-utils.mjs",
];
for (const rel of requiredScripts) {
  check(rel, fs.existsSync(path.join(workerRoot, rel)));
}
check("docs/ops/auth-stack-runbook.md", fs.existsSync(path.join(workerRoot, "../../docs/ops/auth-stack-runbook.md")));
check(
  "docs/ops/automation-architecture.md",
  fs.existsSync(path.join(workerRoot, "../../docs/ops/automation-architecture.md")),
);

if (offline) {
  warn("network", "skipped — re-run without --offline on a machine with proxy + deployed Worker");
  console.log("");
  if (findings.length) {
    console.log(JSON.stringify({ status: "failed", findings, warnings }, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify({ status: "ok", mode: "offline", warnings }, null, 2));
  process.exit(0);
}

check("operator token or proxy mode", proxyMode || Boolean(token?.trim()), proxyMode ? "proxy injects token" : "missing token");

const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? path.join(workerRoot, "fantasy402/browser-auth.json");
const stateFile = process.env.FANTASY402_AUTH_STATE_FILE ?? path.join(workerRoot, "fantasy402/.auth-refresh-state.json");

for (const [label, p] of [
  ["browser-auth.json", authFile],
  [".auth-refresh-state.json", stateFile],
]) {
  check(label, fs.existsSync(p), fs.existsSync(p) ? "present" : "missing — run auth:refresh-full");
}

if (fs.existsSync(authFile)) {
  try {
    const payload = JSON.parse(fs.readFileSync(authFile, "utf8"));
    validateBrowserAuthPayload(payload, authFile);
    check("browser-auth.json shape", true, "valid");
    const exp = jwtExpiryDiagnostics(payload.authorization);
    if (exp.status === "expiring") warn("JWT", `expires at ${exp.expiresAt}`);
    if (exp.status === "expired") check("JWT", false, `expired at ${exp.expiresAt}`);
  } catch (error) {
    check("browser-auth.json shape", false, error instanceof Error ? error.message : String(error));
  }
}

if (proxyMode) {
  try {
    const res = await fetch(`${workerOrigin}/`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json();
    check("local proxy discovery", res.ok && body.service === "fantasy402-local-ingest-proxy");
  } catch (error) {
    check("local proxy discovery", false, error instanceof Error ? error.message : String(error));
  }
}

try {
  const upstreamHealth = await fetch(`${upstream}/auth/health`, { signal: AbortSignal.timeout(15_000) });
  const body = await upstreamHealth.json();
  check("worker GET /auth/health", upstreamHealth.status === 200 || upstreamHealth.status === 503, `HTTP ${upstreamHealth.status}`);
  if (body.status !== "ready") warn("worker auth", body.ingestionReadiness?.blocker || body.status);
  if (upstreamHealth.status === 404) warn("deploy", "Worker missing /auth/health — wrangler deploy");
} catch (error) {
  check("worker GET /auth/health", false, error instanceof Error ? error.message : String(error));
}

if (proxyMode) {
  const preflight = await runAuthStackPreflight({
    workerOrigin,
    operatorToken: token,
    refresh: false,
  });
  check("auth preflight", preflight.ok, preflight.findings.join("; ") || preflight.status);
} else {
  warn("preflight", "skipped — set WORKER_ORIGIN=http://127.0.0.1:8791 with ingest:proxy running");
}

const envExample = path.join(workerRoot, "deploy/systemd/ingestion.env.example");
check("ingestion.env.example", fs.existsSync(envExample));

console.log("");
if (findings.length) {
  console.log(JSON.stringify({ status: "failed", findings, warnings }, null, 2));
  process.exit(1);
}
console.log(JSON.stringify({ status: "ok", warnings }, null, 2));
