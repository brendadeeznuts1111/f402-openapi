#!/usr/bin/env bun
/**
 * Human-readable status for proxy + local auth + Worker auth health.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readTokenFile } from "./browser-auth-utils.mjs";
import { fetchAuthHealth, isLocalIngestProxyUrl, localProxyBaseUrl, resolveWorkerApiOrigin } from "./proxy-client-utils.mjs";
import { readAutomationPolicy, loadLocalJwtSummary } from "./automation-policy.mjs";
import { defaultCycleStatePath, isCycleInBackoff, readCycleState } from "./cycle-state.mjs";
import { readAlertConfig } from "./cycle-alerts.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function probeProxy(fetchImpl, origin) {
  try {
    const res = await fetchImpl(`${origin}/`, { signal: AbortSignal.timeout(5_000) });
    const body = await res.json();
    return { up: res.ok, service: body.service ?? "unknown" };
  } catch (error) {
    return { up: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function main() {
  const workerOrigin = process.env.WORKER_ORIGIN ?? localProxyBaseUrl();
  const apiOrigin = resolveWorkerApiOrigin(workerOrigin);
  const proxyMode = isLocalIngestProxyUrl(workerOrigin);
  const tokenPresent = Boolean(
    process.env.INGESTION_TRIGGER_TOKEN || process.env.ARCHIVE_AUTH_TOKEN || readTokenFile(),
  );

  const policy = readAutomationPolicy();
  const alertCfg = readAlertConfig();
  const cyclePath = defaultCycleStatePath(workerRoot);
  const cycle = readCycleState(cyclePath);
  const localJwt = loadLocalJwtSummary(
    process.env.FANTASY402_BROWSER_AUTH_FILE ?? path.join(workerRoot, "fantasy402/browser-auth.json"),
  );

  console.log("Fantasy402 auth stack status\n");
  console.log(`  WORKER_ORIGIN (CLI):     ${workerOrigin}`);
  console.log(`  API target:              ${apiOrigin}${proxyMode ? " (local proxy)" : ""}`);
  console.log(`  Operator token in env:   ${tokenPresent ? "yes" : "no"}${proxyMode ? " (optional for CLI)" : ""}`);

  if (proxyMode) {
    const proxy = await probeProxy(globalThis.fetch, apiOrigin);
    console.log(`  Local proxy:             ${proxy.up ? "up" : "down"}${proxy.error ? ` (${proxy.error})` : ""}`);
  }

  const statePath = path.join(workerRoot, "fantasy402", ".auth-refresh-state.json");
  const authPath = path.join(workerRoot, "fantasy402", "browser-auth.json");
  console.log("\n  Automation policy:");
  console.log(`    JWT refresh buffer:  ${policy.jwtRefreshBufferSec}s`);
  console.log(`    JWT ingest minimum:  ${policy.jwtIngestMinTtlSec}s`);
  console.log(`    Max loops / cycle:   ${policy.maxIngestLoopsPerCycle}`);
  console.log(`    Local JWT:           ${localJwt.jwtStatus} (ttl ${localJwt.jwtTtlSeconds ?? "—"}s)`);
  if (alertCfg.webhookUrl) {
    console.log(`    Alert webhook:       configured (threshold ${alertCfg.failureThreshold})`);
  } else {
    console.log("    Alert webhook:       not set (F402_ALERT_WEBHOOK_URL)");
  }

  if (cycle) {
    const backoff = isCycleInBackoff(cycle);
    console.log("\n  Unattended cycle state:");
    console.log(`    last:      ${cycle.lastStatus} @ ${cycle.lastRunAt ?? "—"}`);
    console.log(`    failures:  ${cycle.consecutiveFailures ?? 0} consecutive`);
    console.log(`    backoff:   ${backoff ? `until ${cycle.nextEligibleAt}` : "no"}`);
    if (cycle.message) console.log(`    message:   ${cycle.message}`);
  } else {
    console.log("\n  Unattended cycle state: (no .unattended-cycle-state.json yet)");
  }

  for (const [label, p] of [
    ["browser-auth.json", authPath],
    [".auth-refresh-state.json", statePath],
  ]) {
    try {
      const stat = fs.statSync(p);
      console.log(`  ${label}: exists (mtime ${stat.mtime.toISOString()})`);
    } catch {
      console.log(`  ${label}: missing`);
    }
  }

  try {
    const health = await fetchAuthHealth(globalThis.fetch, apiOrigin);
    console.log(`\n  GET ${apiOrigin}/auth/health → HTTP ${health.httpStatus}`);
    console.log(JSON.stringify(health.body, null, 2));
  } catch (error) {
    console.error(`\n  auth/health failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

main();
