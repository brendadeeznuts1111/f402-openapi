#!/usr/bin/env bun
/**
 * Smart unattended cycle: backoff → preflight → refresh-if-needed → ingest (auto loops).
 *
 * Usage:
 *   bun scripts/run-unattended-cycle.mjs
 *   bun scripts/run-unattended-cycle.mjs --loops 3
 *   bun scripts/run-unattended-cycle.mjs --force
 *   bun scripts/run-unattended-cycle.mjs --skip-refresh
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runAuthStackPreflight } from "./auth-stack-preflight.mjs";
import {
  canRunIngestWithLocalAuth,
  ingestLoopsFromCatalog,
  loadLocalJwtSummary,
  shouldRefreshAuth,
} from "./automation-policy.mjs";
import {
  defaultCycleStatePath,
  isCycleInBackoff,
  readCycleState,
  recordCycleOutcomeWithAlerts,
} from "./cycle-state.mjs";
import {
  localProxyBaseUrl,
  workerAuthorizationHeaders,
} from "./proxy-client-utils.mjs";
import { readTokenFile } from "./browser-auth-utils.mjs";

const workerRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workerOrigin = process.env.WORKER_ORIGIN ?? localProxyBaseUrl();
const stateFile = defaultCycleStatePath(workerRoot);
const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? path.join(workerRoot, "fantasy402/browser-auth.json");
const operatorToken =
  process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();

function hasFlag(name) {
  return process.argv.includes(name);
}

function forwardBatchArgs() {
  const skip = new Set(["--skip-refresh", "--skip-preflight", "--force", "--auto-loops"]);
  return process.argv.slice(2).filter((arg) => !skip.has(arg));
}

async function fetchCatalog() {
  const headers = {
    ...workerAuthorizationHeaders(operatorToken, workerOrigin),
    Accept: "application/json",
  };
  const res = await fetch(`${workerOrigin}/ingest/catalog-status`, {
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) return null;
  return res.json();
}

async function main() {
  const steps = {};
  console.error(`Unattended cycle (WORKER_ORIGIN=${workerOrigin})\n`);

  if (!hasFlag("--force")) {
    const prior = readCycleState(stateFile);
    if (isCycleInBackoff(prior)) {
      const payload = {
        status: "skipped",
        reason: "backoff",
        nextEligibleAt: prior.nextEligibleAt,
        consecutiveFailures: prior.consecutiveFailures,
      };
      console.log(JSON.stringify(payload, null, 2));
      process.exit(0);
    }
  }

  if (!hasFlag("--skip-preflight")) {
    console.error("Step: preflight");
    steps.preflight = await runAuthStackPreflight({ workerOrigin, refresh: false });
    if (!steps.preflight.ok) {
      console.error("  preflight not ready:", steps.preflight.findings.join("; "));
    }
  }

  const local = steps.preflight?.local ?? loadLocalJwtSummary(authFile);

  if (!hasFlag("--skip-refresh")) {
    const refreshDecision = shouldRefreshAuth({
      preflight: steps.preflight,
      local,
      force: hasFlag("--force"),
      autoOnFailure: process.env.F402_AUTO_REFRESH_AUTH === "1" || process.env.F402_AUTO_REFRESH_AUTH === "true",
    });
    steps.refreshDecision = refreshDecision;
    if (refreshDecision.run) {
      console.error(`Step: auth:refresh-full (${refreshDecision.reason})`);
      const refresh = spawnSync("npm", ["run", "auth:refresh-full"], {
        cwd: workerRoot,
        stdio: "inherit",
        env: { ...process.env, WORKER_ORIGIN: workerOrigin },
      });
      steps.refreshExit = refresh.status ?? 1;
      if (refresh.status !== 0) {
        await recordCycleOutcomeWithAlerts(stateFile, {
          status: "failed",
          steps,
          message: "auth:refresh-full failed",
        });
        process.exit(refresh.status ?? 1);
      }
      steps.preflight = await runAuthStackPreflight({ workerOrigin, refresh: false });
    } else {
      console.error(`Step: refresh skipped (${refreshDecision.reason})`);
    }
  }

  const localAfter = steps.preflight?.local ?? loadLocalJwtSummary(authFile);
  const ingestGate = canRunIngestWithLocalAuth(localAfter);
  if (!ingestGate.ok) {
    const payload = { status: "failed", reason: ingestGate.reason, steps };
    await recordCycleOutcomeWithAlerts(stateFile, { status: "failed", steps, message: ingestGate.reason });
    console.log(JSON.stringify(payload, null, 2));
    process.exit(1);
  }

  if (steps.preflight && !steps.preflight.ok) {
    await recordCycleOutcomeWithAlerts(stateFile, {
      status: "failed",
      steps,
      message: "preflight still not ready after refresh",
    });
    console.error(JSON.stringify({ status: "failed", step: "preflight", preflight: steps.preflight }, null, 2));
    process.exit(1);
  }

  let loops = 1;
  const catalog = await fetchCatalog();
  steps.catalog = catalog
    ? { pendingCount: catalog.pendingCount, catalogSize: catalog.catalogSize }
    : null;

  if (hasFlag("--auto-loops") || hasFlag("--all") || !forwardBatchArgs().some((a) => a === "--loops")) {
    loops = ingestLoopsFromCatalog(catalog);
    if (catalog?.pendingCount) console.error(`Auto loops from catalog: ${loops} (${catalog.pendingCount} pending)`);
  }

  const batchArgs = ["run", "ingest:local-batch", "--", "--skip-preflight"];
  if (hasFlag("--all")) batchArgs.push("--all");
  else if (loops > 1) batchArgs.push("--loops", String(loops));
  batchArgs.push(...forwardBatchArgs().filter((a) => a !== "--auto-loops"));

  console.error(`Step: ingest:local-batch ${batchArgs.slice(3).join(" ")}`);
  const batch = spawnSync("npm", batchArgs, {
    cwd: workerRoot,
    stdio: "inherit",
    env: { ...process.env, WORKER_ORIGIN: workerOrigin },
  });
  steps.ingestExit = batch.status ?? 1;

  const status = batch.status === 0 ? "ok" : "partial";
  const { state: recorded, alert } = await recordCycleOutcomeWithAlerts(stateFile, {
    status,
    steps,
    summary: { loops, catalogPending: catalog?.pendingCount ?? null },
    message: batch.status === 0 ? null : "ingest batch exited non-zero",
  });

  console.log(
    JSON.stringify(
      { status, steps: { refresh: steps.refreshDecision, catalog: steps.catalog }, cycle: recorded, alert },
      null,
      2,
    ),
  );
  process.exit(batch.status ?? 1);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
