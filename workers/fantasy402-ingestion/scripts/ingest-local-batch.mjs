#!/usr/bin/env bun
/**
 * Fetch Worker ingestion batches locally (browser IP) and upload via /ingest/local.
 * Usage:
 *   bun scripts/ingest-local-batch.mjs
 *   bun scripts/ingest-local-batch.mjs --loops 5
 *   bun scripts/ingest-local-batch.mjs --all
 */
import { spawnSync } from "node:child_process";
import { readTokenFile } from "./browser-auth-utils.mjs";
import {
  isLocalIngestProxyUrl,
  requireOperatorTokenUnlessProxy,
  workerAuthorizationHeaders,
} from "./proxy-client-utils.mjs";
import { runAuthStackPreflight } from "./auth-stack-preflight.mjs";
import { resolveDefaultWorkerOrigin } from "./automation-policy.mjs";
import { localProxyBaseUrl } from "./proxy-client-utils.mjs";

let workerOrigin = process.env.WORKER_ORIGIN?.replace(/\/$/, "") ?? "";
if (!workerOrigin) {
  workerOrigin = await resolveDefaultWorkerOrigin();
}
const operatorToken = process.env.INGESTION_TRIGGER_TOKEN ?? process.env.ARCHIVE_AUTH_TOKEN ?? readTokenFile();
let proxyMode = isLocalIngestProxyUrl(workerOrigin);
const authFile = process.env.FANTASY402_BROWSER_AUTH_FILE ?? "fantasy402/browser-auth.json";

function parseArgs(argv) {
  let loops = 1;
  let all = false;
  let skipPreflight = false;
  let refreshAuth = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--all") all = true;
    if (argv[i] === "--skip-preflight") skipPreflight = true;
    if (argv[i] === "--refresh-auth") refreshAuth = true;
    if (argv[i] === "--loops" && argv[i + 1]) {
      loops = Math.max(1, Math.min(30, Number.parseInt(argv[i + 1], 10) || 1));
      i += 1;
    }
  }
  return { loops, all, skipPreflight, refreshAuth };
}

function workerHeaders() {
  return { ...workerAuthorizationHeaders(operatorToken, workerOrigin), Accept: "application/json" };
}

async function fetchWithRetry(url, init, retries = 2) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(url, init);
      if (res.status >= 500 && attempt < retries) {
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      return res;
    } catch (error) {
      lastError = error;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
  throw lastError ?? new Error("fetch failed");
}

async function fetchPlan() {
  const planRes = await fetchWithRetry(`${workerOrigin}/ingest/local/plan`, {
    headers: workerHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  const planBody = await planRes.json();
  if (!planRes.ok) {
    throw new Error(`Could not load ingest plan: ${JSON.stringify(planBody).slice(0, 200)}`);
  }
  return planBody;
}

async function advanceCursor() {
  const advanceRes = await fetchWithRetry(`${workerOrigin}/ingestion/advance-cursor`, {
    method: "POST",
    headers: workerHeaders(),
    signal: AbortSignal.timeout(30_000),
  });
  return advanceRes.json();
}

async function runOneBatch(planBody) {
  const specs = planBody.endpoints ?? [];
  const batch = planBody.batch;

  if (!specs.length) {
    console.error("No fetchable endpoints; advancing cursor only");
    const advanced = await advanceCursor();
    console.log(JSON.stringify({ status: "skipped", batch, advanced }, null, 2));
    return { status: "skipped", ok: 0, fail: 1 };
  }

  console.error(`Local batch ${batch.cursor + 1}-${batch.cursor + batch.batchSize}/${batch.catalogSize}: ${specs.map((s) => s.key).join(",")}`);
  if (planBody.unsupported?.length) {
    console.error(`Worker-only in batch: ${planBody.unsupported.join(",")}`);
  }

  const childEnv = {
    ...process.env,
    F402_UPSTREAM_LOG: process.env.F402_UPSTREAM_LOG,
    FANTASY402_BROWSER_AUTH_FILE: authFile,
    FANTASY402_LOCAL_PLAN_JSON: JSON.stringify(planBody),
    WORKER_ORIGIN: workerOrigin,
    SKIP_REFRESH_AUTH: process.env.SKIP_REFRESH_AUTH ?? "1",
  };
  if (!proxyMode && operatorToken) childEnv.INGESTION_TRIGGER_TOKEN = operatorToken;

  const result = spawnSync(process.execPath, ["scripts/local-browser-ingest.mjs", authFile], {
    stdio: "inherit",
    env: childEnv,
  });

  return { status: result.status === 0 ? "ok" : "failed", ok: result.status === 0 ? 1 : 0, fail: result.status === 0 ? 0 : 1 };
}

try {
  requireOperatorTokenUnlessProxy(operatorToken, workerOrigin);
} catch (error) {
  console.error(JSON.stringify({ status: "failed", message: error.message }, null, 2));
  process.exit(1);
}

if (proxyMode) {
  console.error("Proxy mode: WORKER_ORIGIN is local ingest proxy — Bearer not required in CLI env.");
}

const { loops: loopsArg, all, skipPreflight, refreshAuth } = parseArgs(process.argv.slice(2));
let loops = loopsArg;

if (!skipPreflight) {
  const preflight = await runAuthStackPreflight({
    workerOrigin,
    refresh: refreshAuth,
    smartRefresh: true,
  });
  if (!preflight.ok) {
    console.error(JSON.stringify({ status: "failed", message: "Auth preflight failed", preflight }, null, 2));
    process.exit(1);
  }
  if (preflight.refreshed) console.error("Preflight: auth refreshed successfully.");
}

if (all) {
  const firstPlan = await fetchPlan();
  const batch = firstPlan.batch ?? {};
  loops = batch.batching
    ? Math.ceil((batch.catalogSize || 86) / (batch.batchSize || 12))
    : 1;
  console.error(`--all: running ${loops} batch(es) across catalog of ${batch.catalogSize ?? "?"}`);
}

const summary = { status: "ok", loops, batches: [], totalOk: 0, totalFailed: 0 };

for (let i = 0; i < loops; i += 1) {
  console.error(`\n=== Local ingest batch ${i + 1}/${loops} ===`);
  const planBody = await fetchPlan();
  const outcome = await runOneBatch(planBody);
  summary.batches.push({
    index: i + 1,
    cursor: planBody.batch?.cursor,
    status: outcome.status,
  });
  if (outcome.status === "ok") summary.totalOk += 1;
  else summary.totalFailed += 1;
  // Keep rotating on partial CLI failures so --all can finish the catalog.
  if (outcome.status === "failed" && summary.totalOk === 0 && i === 0) {
    summary.status = "partial";
    break;
  }
  if (outcome.status === "failed") summary.status = "partial";
}

console.log(JSON.stringify(summary, null, 2));
process.exit(summary.totalFailed > 0 ? 1 : 0);
