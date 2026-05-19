#!/usr/bin/env bun
/**
 * Exit-code monitor for cron.healthchecks.io / Uptime Kuma / systemd OnFailure.
 * Checks proxy, auth health, and unattended cycle failure streak.
 *
 * Usage:
 *   bun scripts/monitor-auth-stack.mjs
 *   bun scripts/monitor-auth-stack.mjs --json
 *   bun scripts/monitor-auth-stack.mjs --alert   # also fire webhook if configured
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAuthStackPreflight } from "./auth-stack-preflight.mjs";
import { readAutomationPolicy } from "./automation-policy.mjs";
import { defaultCycleStatePath, isCycleInBackoff, readCycleState } from "./cycle-state.mjs";
import { localProxyBaseUrl } from "./proxy-client-utils.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const jsonOnly = process.argv.includes("--json");
const sendAlert = process.argv.includes("--alert");
const workerOrigin = process.env.WORKER_ORIGIN ?? localProxyBaseUrl();
const stateFile = defaultCycleStatePath(workerRoot);
const policy = readAutomationPolicy();
const failureThreshold = Number(process.env.F402_ALERT_FAILURE_THRESHOLD ?? 3);

async function main() {
  const findings = [];
  const warnings = [];
  const cycle = readCycleState(stateFile);

  if (cycle?.consecutiveFailures >= failureThreshold) {
    findings.push(
      `unattended cycle: ${cycle.consecutiveFailures} consecutive failures (threshold ${failureThreshold})`,
    );
  }
  if (isCycleInBackoff(cycle)) {
    warnings.push(`cycle in backoff until ${cycle.nextEligibleAt}`);
  }

  const preflight = await runAuthStackPreflight({ workerOrigin, refresh: false });
  if (!preflight.ok) {
    findings.push(`auth preflight failed: ${preflight.findings.join("; ") || "not ready"}`);
  }

  const report = {
    status: findings.length ? "unhealthy" : "healthy",
    timestamp: new Date().toISOString(),
    workerOrigin,
    preflight: { ok: preflight.ok, status: preflight.status, findings: preflight.findings },
    cycle: cycle
      ? {
          lastStatus: cycle.lastStatus,
          consecutiveFailures: cycle.consecutiveFailures,
          nextEligibleAt: cycle.nextEligibleAt,
          lastRunAt: cycle.lastRunAt,
        }
      : null,
    policy: {
      jwtRefreshBufferSec: policy.jwtRefreshBufferSec,
      jwtIngestMinTtlSec: policy.jwtIngestMinTtlSec,
    },
    findings,
    warnings,
  };

  if (sendAlert && cycle && findings.length) {
    const { maybeSendCycleAlert, markCycleAlertSent } = await import("./cycle-alerts.mjs");
    const alert = await maybeSendCycleAlert(cycle);
    if (alert.sent) markCycleAlertSent(stateFile, cycle);
    report.alert = alert;
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Fantasy402 monitor: ${report.status.toUpperCase()}\n`);
    if (cycle) {
      console.log(
        `  Cycle: ${cycle.lastStatus} · failures=${cycle.consecutiveFailures} · last=${cycle.lastRunAt ?? "—"}`,
      );
    }
    if (warnings.length) {
      console.log("  Warnings:");
      for (const w of warnings) console.log(`    - ${w}`);
    }
    if (findings.length) {
      console.log("  Findings:");
      for (const f of findings) console.log(`    - ${f}`);
    }
    console.log(`  Preflight: ${preflight.ok ? "OK" : "FAILED"}`);
  }

  process.exit(findings.length ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
